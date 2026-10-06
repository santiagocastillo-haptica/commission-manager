import { type DateOnly } from "./dates";
import { applyAdjustments, collectionBases, collectionCommission, invoiceBaseNet, type AdjustmentFact, type ProjectBase } from "./commission";
import { D, Decimal, type DecimalValue, ZERO } from "./money";

/**
 * Cálculo de una liquidación (pura, sin base de datos).
 *
 * Reglas:
 *  - Entran los recaudos con fecha efectiva ≤ fin del período que aún no estén liquidados para esa asignación.
 *    Los de fecha anterior al inicio son «extemporáneos» (se registraron tarde) y entran igualmente (D10).
 *  - Un recaudo ya liquidado nunca genera otra línea de comisión (anti pago doble). Si después aparece un ajuste que
 *    reduce la base, se genera una línea ADJUSTMENT negativa con las tasas de los recaudos originales (D9);
 *    la línea original no se toca.
 *  - La elegibilidad NO se reevalúa: se usa el porcentaje efectivo fijado al validar el mes de venta.
 *  - El saldo negativo de un colaborador se arrastra a la siguiente liquidación (D9).
 */

export interface SettlementAssignment {
  id: string;
  collaboratorId: string;
  baseRate: DecimalValue;
  /** Fijado al validar el mes de venta; nulo = mes pendiente de validación. */
  effectiveRate: DecimalValue | null;
}

export interface SettlementCollection {
  id: string;
  date: DateOnly;
  amountReceived: DecimalValue;
  currency: string;
  fxRate: DecimalValue;
  voided: boolean;
}

export interface SettlementInvoice {
  id: string;
  number: string | null;
  status: "PLANNED" | "ISSUED";
  issueDate: DateOnly | null;
  amountPreTax: DecimalValue;
  netBaseExplicit?: DecimalValue | null;
  voided: boolean;
  collections: SettlementCollection[];
}

export interface SettlementProject extends ProjectBase {
  id: string;
  code: string;
  name: string;
  currency: string;
  saleMonth: string;
  voided: boolean;
  assignments: SettlementAssignment[];
  invoices: SettlementInvoice[];
  adjustments: (AdjustmentFact & { voided: boolean })[];
}

export interface PriorCommit {
  collectionId: string;
  assignmentId: string;
}

export interface SettlementInput {
  period: { periodStart: DateOnly; periodEnd: DateOnly };
  projects: SettlementProject[];
  /** Líneas COLLECTION ya comprometidas en liquidaciones cerradas. */
  priorCommits: PriorCommit[];
  /** Saldos negativos arrastrados por colaborador (valores ≤ 0). */
  carryovers?: Record<string, DecimalValue>;
}

export interface LineDetail {
  projectCode: string;
  projectName: string;
  saleMonth: string;
  projectNetBase: string;
  invoiceNumber: string | null;
  invoiceDate: DateOnly | null;
  collectionDate: DateOnly | null;
  amountReceived: string | null;
  adjustmentId?: string;
}

export interface CalcLine {
  type: "COLLECTION" | "ADJUSTMENT";
  collaboratorId: string;
  projectId: string;
  assignmentId: string;
  invoiceId: string | null;
  collectionId: string | null;
  adjustmentId: string | null;
  baseRate: Decimal;
  effectiveRate: Decimal;
  currency: string;
  fxRate: Decimal;
  netBaseOriginal: Decimal;
  netBaseCOP: Decimal;
  commissionCOP: Decimal;
  isLate: boolean;
  detail: LineDetail;
}

export type AlertSeverity = "BLOCKING" | "WARNING" | "INFO";
export type AlertCode =
  | "PENDING_VALIDATION"
  | "MISSING_FX"
  | "INCOMPLETE_INVOICE"
  | "PENDING_ADJUSTMENTS"
  | "POSSIBLE_DUPLICATE"
  | "NET_BASE_MISMATCH"
  | "LATE_COLLECTIONS";

export interface SettlementAlert {
  code: AlertCode;
  severity: AlertSeverity;
  message: string;
  projectId?: string;
  /** Identificador estable para registrar el reconocimiento de la alerta al cerrar. */
  key: string;
}

export interface CollaboratorTotals {
  collaboratorId: string;
  gross: Decimal;
  adjustments: Decimal;
  carryoverIn: Decimal;
  /** Total a pagar (nunca negativo). */
  netPayable: Decimal;
  /** Saldo negativo que pasa a la siguiente liquidación (≤ 0). */
  carryoverOut: Decimal;
}

export interface SettlementResult {
  lines: CalcLine[];
  alerts: SettlementAlert[];
  totals: CollaboratorTotals[];
  grand: { gross: Decimal; adjustments: Decimal; netPayable: Decimal };
}

const TOLERANCE = D("0.01");

export interface CalculateOptions {
  /**
   * Decimales a los que se redondean los valores monetarios de cada línea (solo precisión de almacenamiento, no redondeo
   * de negocio). Así los totales guardados son exactamente la suma de las líneas guardadas.
   */
  storageScale?: number;
}

export function calculateSettlement(input: SettlementInput, options: CalculateOptions = {}): SettlementResult {
  const { periodStart, periodEnd } = input.period;
  const committed = new Set(input.priorCommits.map((c) => `${c.collectionId}|${c.assignmentId}`));
  const lines: CalcLine[] = [];
  const alerts: SettlementAlert[] = [];
  const invoiceNumbers = new Map<string, Set<string>>(); // número → proyectos

  for (const project of input.projects) {
    if (project.voided) continue;
    const liveAdj = project.adjustments.filter((a) => !a.voided);
    const adjApplied = liveAdj.filter((a) => a.status === "APPLIED");
    const adjPending = liveAdj.filter((a) => a.status === "PENDING");
    const aliveInvoices = project.invoices.filter((i) => !i.voided);
    const issued = aliveInvoices.filter((i) => i.status === "ISSUED");
    // Estado de las facturas con los ajustes ya aplicados (lo que se pagó antes) y con todos (lo que corresponde ahora).
    const stateApplied = applyAdjustments(project, aliveInvoices, adjApplied);
    const stateAll = applyAdjustments(project, aliveInvoices, [...adjApplied, ...adjPending]);

    let pendingValidationCollections = 0;
    const compensation = new Map<string, { adjustmentId: string; assignment: SettlementAssignment; commission: Decimal; netBase: Decimal; netBaseCOP: Decimal; fxWeighted: Decimal }>();

    for (const inv of issued) {
      if (!inv.number || !inv.issueDate) {
        alerts.push({ code: "INCOMPLETE_INVOICE", severity: "BLOCKING", projectId: project.id, key: `inc:${inv.id}`, message: `Factura sin número o sin fecha de emisión en ${project.code}.` });
      }
      if (inv.number) {
        const set = invoiceNumbers.get(inv.number) ?? new Set<string>();
        set.add(project.id);
        invoiceNumbers.set(inv.number, set);
      }

      const live = inv.collections.filter((c) => !c.voided);
      const basesAll = collectionBases(stateAll.states.get(inv.id)!, live);
      const basesApplied = collectionBases(stateApplied.states.get(inv.id)!, live);

      // Posibles duplicados dentro de la factura: mismo valor y misma fecha.
      const seen = new Map<string, number>();
      for (const c of live) {
        const k = `${c.date}|${D(c.amountReceived).toFixed()}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      for (const [k, n] of seen) {
        if (n > 1) alerts.push({ code: "POSSIBLE_DUPLICATE", severity: "WARNING", projectId: project.id, key: `dup:${inv.id}:${k}`, message: `${n} recaudos con el mismo valor y fecha en la factura ${inv.number} (${project.code}).` });
      }

      for (const c of live) {
        const fx = project.currency === "COP" ? D(1) : D(c.fxRate);
        // Solo importa para recaudos que esta liquidación podría comisionar.
        const candidate = c.date <= periodEnd && project.assignments.some((a) => !committed.has(`${c.id}|${a.id}`));
        if (candidate && project.currency !== "COP" && (fx.lte(0) || fx.equals(1))) {
          alerts.push({ code: "MISSING_FX", severity: "BLOCKING", projectId: project.id, key: `fx:${c.id}`, message: `Recaudo del ${c.date} (factura ${inv.number}, ${project.code}) sin TRM válida.` });
        }

        for (const a of project.assignments) {
          const isCommitted = committed.has(`${c.id}|${a.id}`);
          if (isCommitted) continue;
          if (c.date > periodEnd) continue;
          if (a.effectiveRate === null) {
            pendingValidationCollections++;
            continue;
          }
          const rate = D(a.effectiveRate);
          if (rate.isZero()) continue;
          const calc = collectionCommission({ netBaseOriginal: basesAll.get(c.id)!, effectiveRate: rate, fxRate: fx });
          lines.push({
            type: "COLLECTION",
            collaboratorId: a.collaboratorId,
            projectId: project.id,
            assignmentId: a.id,
            invoiceId: inv.id,
            collectionId: c.id,
            adjustmentId: null,
            baseRate: D(a.baseRate),
            effectiveRate: rate,
            currency: project.currency,
            fxRate: fx,
            netBaseOriginal: calc.netBaseOriginal,
            netBaseCOP: calc.netBaseCOP,
            commissionCOP: calc.commissionCOP,
            isLate: c.date < periodStart,
            detail: {
              projectCode: project.code,
              projectName: project.name,
              saleMonth: project.saleMonth,
              projectNetBase: D(project.netBase).toFixed(),
              invoiceNumber: inv.number,
              invoiceDate: inv.issueDate,
              collectionDate: c.date,
              amountReceived: D(c.amountReceived).toFixed(),
            },
          });
        }
      }

      // Compensación de ajustes pendientes sobre recaudos ya liquidados (con las tasas originales de cada recaudo):
      // diferencia entre lo que se liquidó (estado con ajustes aplicados) y lo que corresponde ahora (con todos).
      if (adjPending.length > 0) {
        const raws = adjPending.map((adj) => ({ adj, raw: stateAll.reductions.get(adj.id)?.get(inv.id) ?? ZERO }));
        const totalRaw = raws.reduce((acc, r) => acc.plus(r.raw), ZERO);
        if (totalRaw.gt(0)) {
          for (const c of live) {
            const fx = project.currency === "COP" ? D(1) : D(c.fxRate);
            const delta = Decimal.max(ZERO, basesApplied.get(c.id)!.minus(basesAll.get(c.id)!));
            if (delta.isZero()) continue;
            for (const a of project.assignments) {
              if (!committed.has(`${c.id}|${a.id}`) || a.effectiveRate === null) continue;
              const rate = D(a.effectiveRate);
              if (rate.isZero()) continue;
              for (const { adj, raw } of raws) {
                if (raw.isZero()) continue;
                const netBase = delta.mul(raw).div(totalRaw);
                const key = `${adj.id}|${a.id}`;
                const entry = compensation.get(key) ?? { adjustmentId: adj.id, assignment: a, commission: ZERO, netBase: ZERO, netBaseCOP: ZERO, fxWeighted: ZERO };
                entry.commission = entry.commission.plus(netBase.mul(rate).mul(fx));
                entry.netBase = entry.netBase.plus(netBase);
                entry.netBaseCOP = entry.netBaseCOP.plus(netBase.mul(fx));
                compensation.set(key, entry);
              }
            }
          }
        }
      }
    }

    if (pendingValidationCollections > 0) {
      alerts.push({ code: "PENDING_VALIDATION", severity: "WARNING", projectId: project.id, key: `val:${project.id}`, message: `El proyecto ${project.code} tiene recaudos del período, pero su mes de venta no está validado: no generan comisión hasta validar el mes.` });
    }
    if (adjPending.length > 0) {
      alerts.push({ code: "PENDING_ADJUSTMENTS", severity: "WARNING", projectId: project.id, key: `adj:${project.id}`, message: `${adjPending.length} ajuste(s) pendiente(s) en ${project.code}: se aplicarán en esta liquidación.` });
    }

    // Consistencia de la base neta entre facturas y proyecto.
    const alive = project.invoices.filter((i) => !i.voided);
    const hasExplicit = alive.some((i) => i.netBaseExplicit !== null && i.netBaseExplicit !== undefined);
    if (hasExplicit && alive.length > 0) {
      const sumNet = alive.reduce((acc, i) => acc.plus(invoiceBaseNet(i, project)), ZERO);
      const sumAmount = alive.reduce((acc, i) => acc.plus(i.amountPreTax), ZERO);
      const expected = sumAmount.gte(project.saleAmount) ? D(project.netBase) : sumAmount.mul(project.netBase).div(project.saleAmount);
      if (sumNet.minus(D(project.netBase)).gt(TOLERANCE) || (sumAmount.gte(project.saleAmount) && sumNet.minus(expected).abs().gt(TOLERANCE))) {
        alerts.push({ code: "NET_BASE_MISMATCH", severity: "WARNING", projectId: project.id, key: `net:${project.id}`, message: `La base neta asignada a las facturas de ${project.code} (${sumNet.toFixed(2)}) no coincide con la base neta del proyecto (${D(project.netBase).toFixed(2)}).` });
      }
    }

    for (const { adjustmentId, assignment, commission, netBase, netBaseCOP } of compensation.values()) {
      if (commission.isZero()) continue;
      const rate = D(assignment.effectiveRate!);
      lines.push({
        type: "ADJUSTMENT",
        collaboratorId: assignment.collaboratorId,
        projectId: project.id,
        assignmentId: assignment.id,
        invoiceId: null,
        collectionId: null,
        adjustmentId,
        baseRate: D(assignment.baseRate),
        effectiveRate: rate,
        currency: project.currency,
        fxRate: netBase.isZero() ? D(1) : netBaseCOP.div(netBase),
        netBaseOriginal: netBase.neg(),
        netBaseCOP: netBaseCOP.neg(),
        commissionCOP: commission.neg(),
        isLate: false,
        detail: {
          projectCode: project.code,
          projectName: project.name,
          saleMonth: project.saleMonth,
          projectNetBase: D(project.netBase).toFixed(),
          invoiceNumber: null,
          invoiceDate: null,
          collectionDate: null,
          amountReceived: null,
          adjustmentId,
        },
      });
    }
  }

  for (const [number, projectIds] of invoiceNumbers) {
    if (projectIds.size > 1) alerts.push({ code: "POSSIBLE_DUPLICATE", severity: "WARNING", key: `dupnum:${number}`, message: `El número de factura ${number} aparece en ${projectIds.size} proyectos distintos.` });
  }
  const late = lines.filter((l) => l.isLate && l.type === "COLLECTION").length;
  if (late > 0) {
    alerts.push({ code: "LATE_COLLECTIONS", severity: "INFO", key: "late", message: `${late} recaudo(s) con fecha anterior al período se registraron tarde y entran en esta liquidación como extemporáneos.` });
  }

  if (options.storageScale !== undefined) {
    for (const l of lines) {
      l.netBaseOriginal = l.netBaseOriginal.toDecimalPlaces(options.storageScale);
      l.netBaseCOP = l.netBaseCOP.toDecimalPlaces(options.storageScale);
      l.commissionCOP = l.commissionCOP.toDecimalPlaces(options.storageScale);
    }
  }

  // Totales por colaborador, con arrastre de saldos negativos.
  const ids = new Set<string>([...lines.map((l) => l.collaboratorId), ...Object.keys(input.carryovers ?? {})]);
  const totals: CollaboratorTotals[] = [];
  for (const collaboratorId of ids) {
    const mine = lines.filter((l) => l.collaboratorId === collaboratorId);
    const gross = mine.filter((l) => l.type === "COLLECTION").reduce((acc, l) => acc.plus(l.commissionCOP), ZERO);
    const adjustments = mine.filter((l) => l.type === "ADJUSTMENT").reduce((acc, l) => acc.plus(l.commissionCOP), ZERO);
    const carryoverIn = D(input.carryovers?.[collaboratorId] ?? 0);
    const net = gross.plus(adjustments).plus(carryoverIn);
    totals.push({
      collaboratorId,
      gross,
      adjustments,
      carryoverIn,
      netPayable: net.isNegative() ? ZERO : net,
      carryoverOut: net.isNegative() ? net : ZERO,
    });
  }

  return {
    lines,
    alerts,
    totals,
    grand: {
      gross: totals.reduce((a, t) => a.plus(t.gross), ZERO),
      adjustments: totals.reduce((a, t) => a.plus(t.adjustments), ZERO),
      netPayable: totals.reduce((a, t) => a.plus(t.netPayable), ZERO),
    },
  };
}
