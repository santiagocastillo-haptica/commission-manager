import { assignmentSummary } from "@/domain/commission";
import type { DateOnly } from "@/domain/dates";
import { D, Decimal, ZERO } from "@/domain/money";
import { C, col, type CommitmentDoc, type PersonSettlementDoc } from "@/store";
import { loadCommissionProjectsWith, plainReader, type LoadedProject } from "../commission-data";

export type { LoadedProject };

/** Todos los proyectos con lo necesario para calcular comisiones. */
export function loadCommissionProjects(filter: { projectId?: string; collaboratorId?: string } = {}): Promise<LoadedProject[]> {
  return loadCommissionProjectsWith(plainReader, filter);
}

export interface AssignmentCommissionRow {
  projectId: string;
  assignmentId: string;
  collaboratorId: string;
  potentialCOP: string | null;
  potentialIfEligibleCOP: string;
  generatedCOP: string;
}

/** Potencial y generado de cada asignación, indexado por asignación. */
export function summarizeAssignments(projects: LoadedProject[]): Map<string, AssignmentCommissionRow> {
  const map = new Map<string, AssignmentCommissionRow>();
  for (const p of projects) {
    for (const a of p.assignments) {
      const s = assignmentSummary(
        { saleAmount: p.saleAmount, netBase: p.netBase, currency: p.currency, saleReferenceRate: p.saleReferenceRate, invoices: p.invoices, adjustments: p.adjustments },
        a.baseRate,
        a.effectiveRate,
      );
      map.set(a.id, {
        projectId: p.id,
        assignmentId: a.id,
        collaboratorId: a.collaboratorId,
        potentialCOP: s.potentialCOP?.toFixed() ?? null,
        potentialIfEligibleCOP: s.potentialIfEligibleCOP.toFixed(),
        generatedCOP: s.generatedCOP.toFixed(),
      });
    }
  }
  return map;
}

export interface CommissionTotals {
  /** Estimada: % efectivo × base ajustada, de los proyectos vendidos en el rango (solo meses validados). */
  potential: string;
  /** Cota superior para proyectos de meses aún sin validar (% base). */
  potentialUnvalidated: string;
  /** Generada por recaudos cuya fecha cae en el rango. */
  generated: string;
  /** Generada en total (sin rango), para calcular lo pendiente de pago. */
  generatedAllTime: string;
  /** Líneas comprometidas en liquidaciones cerradas (histórico). */
  liquidated: string;
  /** Pagos efectivamente registrados (histórico). */
  paid: string;
  /** Generada (histórico) − pagada. */
  pendingPayment: string;
}

/**
 * Totales de comisiones. Son subconjuntos anidados, no sumables:
 * potencial ⊇ generada ⊇ liquidada ⊇ pagada.
 */
export async function commissionTotals(opts: { collaboratorId?: string; fromMonth?: string; toMonth?: string; from?: DateOnly; to?: DateOnly } = {}): Promise<CommissionTotals> {
  const projects = await loadCommissionProjects();
  const summaries = summarizeAssignments(projects);

  let potential = ZERO;
  let potentialUnvalidated = ZERO;
  let generated = ZERO;
  let generatedAll = ZERO;

  for (const p of projects) {
    const inSaleRange = (!opts.fromMonth || p.saleMonth >= opts.fromMonth) && (!opts.toMonth || p.saleMonth <= opts.toMonth);
    for (const a of p.assignments) {
      if (opts.collaboratorId && a.collaboratorId !== opts.collaboratorId) continue;
      const s = summaries.get(a.id)!;
      if (inSaleRange) {
        if (s.potentialCOP !== null) potential = potential.plus(s.potentialCOP);
        else potentialUnvalidated = potentialUnvalidated.plus(s.potentialIfEligibleCOP);
      }
      generatedAll = generatedAll.plus(s.generatedCOP);
      // Detalle por recaudo para el rango de fechas.
      if (a.effectiveRate !== null) {
        const r = assignmentSummary(
          { saleAmount: p.saleAmount, netBase: p.netBase, currency: p.currency, saleReferenceRate: p.saleReferenceRate, invoices: p.invoices, adjustments: p.adjustments },
          a.baseRate,
          a.effectiveRate,
        );
        for (const c of r.collections) {
          if ((!opts.from || c.date >= opts.from) && (!opts.to || c.date <= opts.to)) generated = generated.plus(c.commissionCOP);
        }
      }
    }
  }

  // Líneas comprometidas = compromisos; pagos = pagos embebidos en las liquidaciones individuales.
  const commitments = (await col(C.commitments).get()).docs.map((d) => d.data() as CommitmentDoc);
  const liquidated = commitments.filter((c) => !opts.collaboratorId || c.collaboratorId === opts.collaboratorId).reduce((acc, c) => acc.plus(c.commissionCOP), ZERO);

  const settlementCodes = (await col(C.settlements).get()).docs.map((d) => d.id);
  let paid = ZERO;
  for (const code of settlementCodes) {
    const people = (await col(C.settlements).doc(code).collection("people").get()).docs.map((d) => d.data() as PersonSettlementDoc);
    for (const p of people) {
      if (opts.collaboratorId && p.collaboratorId !== opts.collaboratorId) continue;
      for (const pay of p.payments) paid = paid.plus(pay.amount);
    }
  }

  const pending: Decimal = Decimal.max(ZERO, generatedAll.minus(paid));
  return {
    potential: potential.toFixed(),
    potentialUnvalidated: potentialUnvalidated.toFixed(),
    generated: generated.toFixed(),
    generatedAllTime: generatedAll.toFixed(),
    liquidated: D(liquidated).toFixed(),
    paid: paid.toFixed(),
    pendingPayment: pending.toFixed(),
  };
}
