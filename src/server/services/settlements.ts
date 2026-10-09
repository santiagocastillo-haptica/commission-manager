import { assignmentSummary } from "@/domain/commission";
import { addMonths, formatDate, monthKey } from "@/domain/dates";
import { D, Decimal, formatMoney, ZERO } from "@/domain/money";
import { settlementPeriod, type SettlementHalf, type SettlementPeriod } from "@/domain/periods";
import { DomainError } from "@/domain/project";
import { projectFinancials } from "@/domain/project-status";
import { calculateSettlement, type CalcLine, type SettlementAlert, type SettlementInput, type SettlementResult } from "@/domain/settlement";
import {
  C, audit, col, commitInBatches, commitKey, fitsInOneTx, isAlreadyExists, linesCol, newId, now, peopleCol, ref, runTx, settlementRef, systemStateRef,
  type AdjustmentDoc, type CollaboratorDoc, type CommitmentDoc, type MonthlySalesDoc, type PaymentDoc, type PersonSettlementDoc, type PolicyDoc,
  type SettlementDoc, type SettlementLineDoc, type SystemStateDoc, type Tx, type Writer,
} from "@/store";
import { loadCommissionProjectsWith, plainReader, readAll, txReader, type LoadedProject, type Reader } from "../commission-data";
import type { AckedAlert, AdminSnapshot, CollaboratorSnapshot, LineSnapshot, ProjectStatusEntry } from "./settlement-types";

/** Tolerancia de sub-centavo al comparar pagos con el neto a pagar (que se conserva con 6 decimales). */
const PAY_TOLERANCE = D("0.005");
export const STORAGE_SCALE = 6;

/** Identificador de la liquidación individual: `${código}__${colaborador}` (el código no contiene «__»). */
export const personKey = (code: string, collaboratorId: string) => `${code}__${collaboratorId}`;
export function parsePersonKey(key: string): { code: string; collaboratorId: string } | null {
  const i = key.indexOf("__");
  return i > 0 ? { code: key.slice(0, i), collaboratorId: key.slice(i + 2) } : null;
}

export interface PreparedSettlement {
  period: SettlementPeriod;
  projects: LoadedProject[];
  input: SettlementInput;
  result: SettlementResult;
}

/** Calcula (sin guardar) la liquidación de un período con el estado actual de la base de datos. */
export async function prepareSettlement(r: Reader, period: SettlementPeriod): Promise<PreparedSettlement> {
  const [projects, commitSnap, settlements] = await Promise.all([
    loadCommissionProjectsWith(r),
    r.get(col(C.commitments).where("type", "==", "COLLECTION")),
    readAll<SettlementDoc>(r, C.settlements),
  ]);
  // Los compromisos de esta misma liquidación no cuentan como «previos» (así el cálculo es repetible al reanudar un cierre).
  const commits = commitSnap.docs.map((d) => d.data() as CommitmentDoc).filter((c) => c.settlementCode !== period.code);

  const previous = settlements
    .filter((s) => s.status === "APPROVED" && s.paymentDate < period.paymentDate)
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))[0];
  const carryovers: Record<string, string> = {};
  if (previous) {
    for (const d of (await r.get(peopleCol(previous.code))).docs) {
      const p = d.data() as PersonSettlementDoc;
      if (D(p.carryoverOut).isNegative()) carryovers[p.collaboratorId] = D(p.carryoverOut).toFixed();
    }
  }

  const input: SettlementInput = {
    period: { periodStart: period.periodStart, periodEnd: period.periodEnd },
    projects,
    priorCommits: commits.map((c) => ({ collectionId: c.collectionId!, assignmentId: c.assignmentId })),
    carryovers,
  };
  return { period, projects, input, result: calculateSettlement(input, { storageScale: STORAGE_SCALE }) };
}

const lineId = (l: CalcLine) => commitKey((l.collectionId ?? l.adjustmentId)!, l.assignmentId);

function buildLineDocs(code: string, lines: CalcLine[], projects: LoadedProject[], collabs: Map<string, CollaboratorDoc>, committed: boolean, createdAt: string): SettlementLineDoc[] {
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const collections = new Map<string, { amountReceived: string; fxRate: string }>();
  for (const p of projects) for (const i of p.invoices) for (const c of i.collections) collections.set(c.id, { amountReceived: D(c.amountReceived).toFixed(), fxRate: D(c.fxRate).toFixed() });

  return lines.map((l) => {
    const c = collabs.get(l.collaboratorId)!;
    const p = byProject.get(l.projectId)!;
    const col = l.collectionId ? collections.get(l.collectionId) : undefined;
    const snapshot: LineSnapshot = {
      ...l.detail,
      collaboratorName: c.fullName,
      collaboratorPosition: c.position,
      client: p.client,
      currency: l.currency,
      fxRate: l.fxRate.toFixed(),
      amountReceivedCOP: col ? D(col.amountReceived).mul(p.currency === "COP" ? 1 : col.fxRate).toFixed() : null,
      saleAmountCOP: D(p.saleAmount).mul(p.currency === "COP" ? 1 : p.saleReferenceRate).toFixed(),
      saleDate: p.saleDate,
      type: l.type,
      isLate: l.isLate,
    };
    return {
      id: lineId(l),
      settlementCode: code,
      collaboratorId: l.collaboratorId,
      projectId: l.projectId,
      assignmentId: l.assignmentId,
      invoiceId: l.invoiceId,
      collectionId: l.collectionId,
      adjustmentId: l.adjustmentId,
      type: l.type,
      baseRate: l.baseRate.toFixed(),
      effectiveRate: l.effectiveRate.toFixed(),
      currency: l.currency as SettlementLineDoc["currency"],
      fxRate: l.fxRate.toDecimalPlaces(6).toFixed(),
      netBaseOriginal: l.netBaseOriginal.toFixed(),
      netBaseCOP: l.netBaseCOP.toFixed(),
      commissionCOP: l.commissionCOP.toFixed(),
      isLate: l.isLate,
      committed,
      snapshot,
      createdAt,
    };
  });
}

// ───────────── Borrador ─────────────

/** Genera o regenera el borrador de la liquidación. Es repetible hasta que se aprueba. Llamar tras `assertNotClosing`. */
export async function calculateDraft(tx: Tx, year: number, half: SettlementHalf, userId: string) {
  const period = settlementPeriod(year, half);
  const existingSnap = await tx.get(settlementRef(period.code));
  const existing = existingSnap.exists ? (existingSnap.data() as SettlementDoc) : null;
  if (existing?.status === "APPROVED") throw new DomainError(`${period.label} ya está aprobada y cerrada; no se puede recalcular.`);
  if (existing?.status === "CLOSING") throw new DomainError(`${period.label} está en proceso de cierre.`);

  const prepared = await prepareSettlement(txReader(tx), period);
  const { result } = prepared;
  const collabs = await loadCollaborators(txReader(tx), result.lines.map((l) => l.collaboratorId));
  const oldLines = (await tx.get(linesCol(period.code))).docs;

  const t = now();
  const rows = buildLineDocs(period.code, result.lines, prepared.projects, collabs, false, t);
  const keep = new Set(rows.map((x) => x.id));
  for (const d of oldLines) if (!keep.has(d.id)) tx.delete(d.ref);
  for (const row of rows) tx.set(linesCol(period.code).doc(row.id), row);

  const doc: SettlementDoc = {
    id: period.code, code: period.code, year, half, periodStart: period.periodStart, periodEnd: period.periodEnd, paymentDate: period.paymentDate,
    status: "DRAFT",
    totalGross: result.grand.gross.toFixed(), totalAdjustments: result.grand.adjustments.toFixed(), totalNet: result.grand.netPayable.toFixed(),
    calculatedAt: t, approvedAt: null, approvedById: null, acknowledgedAlerts: null, adminSnapshot: null, closingId: null,
    createdAt: existing?.createdAt ?? t, updatedAt: t,
  };
  tx.set(settlementRef(period.code), doc);
  audit(tx, {
    entity: "Settlement", entityId: period.code, action: "CALCULATE",
    summary: `Liquidación ${period.code} calculada: ${result.lines.length} líneas, bruto ${formatMoney(result.grand.gross, "COP", 2)}, neto a pagar ${formatMoney(result.grand.netPayable, "COP", 2)}`,
    after: doc, userId,
  });
  return { settlementId: period.code, result };
}

async function loadCollaborators(r: Reader, ids: string[]): Promise<Map<string, CollaboratorDoc>> {
  const wanted = new Set(ids);
  const all = await readAll<CollaboratorDoc>(r, C.collaborators);
  return new Map(all.filter((c) => wanted.has(c.id)).map((c) => [c.id, c]));
}

function projectStatusFor(p: LoadedProject, collaboratorId: string, lines: CalcLine[]): ProjectStatusEntry | null {
  const a = p.assignments.find((x) => x.collaboratorId === collaboratorId);
  if (!a || a.effectiveRate === null || D(a.effectiveRate).isZero()) return null;
  const fin = projectFinancials(
    p.saleAmount,
    p.invoices.filter((i) => !i.voided).length,
    p.invoices.map((i) => ({
      status: i.status,
      amountPreTax: i.amountPreTax,
      voided: i.voided,
      collected: i.collections.filter((c) => !c.voided).reduce((acc, c) => acc.plus(c.amountReceived), ZERO).toFixed(),
    })),
  );
  const s = assignmentSummary(
    { saleAmount: p.saleAmount, netBase: p.netBase, currency: p.currency, saleReferenceRate: p.saleReferenceRate, invoices: p.invoices, adjustments: p.adjustments },
    a.baseRate,
    a.effectiveRate,
  );
  const pendingPotential = Decimal.max(ZERO, (s.potentialCOP ?? ZERO).minus(s.generatedCOP));
  const approved = lines.filter((l) => l.projectId === p.id && l.collaboratorId === collaboratorId).reduce((acc, l) => acc.plus(l.commissionCOP), ZERO);
  const pendingInvoice = fin.billingStatus !== "INVOICED";
  const pendingCollection = fin.collectionStatus !== "COLLECTED";
  // Solo aparecen los proyectos con movimiento en esta liquidación o con algo pendiente.
  if (!pendingInvoice && !pendingCollection && approved.isZero()) return null;
  return {
    projectId: p.id, code: p.code, client: p.client, saleMonth: p.saleMonth, currency: p.currency,
    netBase: D(p.netBase).toFixed(), saleAmount: D(p.saleAmount).toFixed(), invoiced: fin.invoiced.toFixed(), collected: fin.collected.toFixed(),
    pendingInvoice, pendingCollection, pendingPotentialCOP: pendingPotential.toFixed(), approvedInThisCOP: approved.toFixed(),
  };
}

// ───────────── Aprobación ─────────────

interface ApprovalPlan {
  settlement: SettlementDoc;
  lines: SettlementLineDoc[];
  commitments: CommitmentDoc[];
  people: PersonSettlementDoc[];
  adjustments: AdjustmentDoc[];
  result: SettlementResult;
  summary: string;
}

interface PlanOptions {
  acknowledgedKeys: string[];
  /** Totales que el administrador revisó; si los datos cambiaron desde entonces, no se aprueba. */
  expected?: { gross: string; net: string };
  /** Al reanudar un cierre ya validado no se vuelven a exigir alertas ni totales. */
  validate: boolean;
  userId: string;
}

/**
 * Valida y construye TODO lo que escribe el cierre (líneas, compromisos, liquidaciones individuales, ajustes aplicados y
 * la liquidación aprobada), sin escribir nada. Es determinista: con los mismos datos produce los mismos documentos.
 */
async function buildApprovalPlan(r: Reader, settlement: SettlementDoc, opts: PlanOptions): Promise<ApprovalPlan> {
  const all = await readAll<SettlementDoc>(r, C.settlements);
  const earlierDraft = all.find((s) => s.status === "DRAFT" && s.paymentDate < settlement.paymentDate);
  if (earlierDraft) throw new DomainError(`Antes hay que aprobar o descartar la liquidación ${earlierDraft.code}: las liquidaciones se cierran en orden cronológico.`);
  const laterApproved = all.find((s) => s.status === "APPROVED" && s.paymentDate > settlement.paymentDate);
  if (laterApproved) throw new DomainError(`Ya existe una liquidación posterior aprobada (${laterApproved.code}); esta no se puede cerrar después.`);

  const period = settlementPeriod(settlement.year, settlement.half);
  const prepared = await prepareSettlement(r, period);
  const { result } = prepared;

  if (opts.validate) {
    if (opts.expected && (!result.grand.gross.toDecimalPlaces(STORAGE_SCALE).equals(D(opts.expected.gross)) || !result.grand.netPayable.toDecimalPlaces(STORAGE_SCALE).equals(D(opts.expected.net)))) {
      throw new DomainError("Los datos cambiaron desde que revisaste la liquidación (cambió el total). Vuelve a revisarla antes de aprobar.");
    }
    const blocking = result.alerts.filter((a) => a.severity === "BLOCKING");
    if (blocking.length > 0) {
      throw new DomainError(`Hay ${blocking.length} alerta(s) bloqueante(s) por corregir antes de aprobar: ${blocking.map((b) => b.message).join(" · ")}`);
    }
    const pendingAck = result.alerts.filter((a: SettlementAlert) => a.severity === "WARNING" && !opts.acknowledgedKeys.includes(a.key));
    if (pendingAck.length > 0) throw new DomainError(`Hay ${pendingAck.length} alerta(s) sin reconocer. Revísalas y márcalas antes de aprobar.`);
    if (result.totals.length === 0) throw new DomainError("No hay comisiones por liquidar en este período.");
  }

  const t = now();
  const collabs = await loadCollaborators(r, result.totals.map((x) => x.collaboratorId));
  const policies = new Map((await readAll<PolicyDoc>(r, C.policies)).map((p) => [p.id, p]));
  const lines = buildLineDocs(period.code, result.lines, prepared.projects, collabs, true, t);
  const commitments: CommitmentDoc[] = result.lines.map((l, i) => ({
    id: lines[i].id, type: l.type, collectionId: l.collectionId, adjustmentId: l.adjustmentId, assignmentId: l.assignmentId, invoiceId: l.invoiceId,
    projectId: l.projectId, collaboratorId: l.collaboratorId, settlementCode: period.code, lineId: lines[i].id, commissionCOP: l.commissionCOP.toFixed(), committedAt: t,
  }));

  const people: PersonSettlementDoc[] = [];
  const adminCollaborators: AdminSnapshot["collaborators"] = [];
  for (const tot of result.totals) {
    const c = collabs.get(tot.collaboratorId)!;
    const mine = result.lines.filter((l) => l.collaboratorId === tot.collaboratorId);
    const entries = prepared.projects
      .filter((p) => p.assignments.some((a) => a.collaboratorId === tot.collaboratorId))
      .map((p) => projectStatusFor(p, tot.collaboratorId, result.lines))
      .filter((e): e is ProjectStatusEntry => e !== null);
    const snapshot: CollaboratorSnapshot = {
      collaboratorId: c.id, fullName: c.fullName, email: c.email, position: c.position, policyCode: policies.get(c.policyId)?.code ?? c.policyId,
      projects: entries.sort((a, b) => a.code.localeCompare(b.code)),
    };
    people.push({
      id: c.id, settlementCode: period.code, collaboratorId: c.id,
      grossCommission: tot.gross.toFixed(), adjustmentsTotal: tot.adjustments.toFixed(), carryoverIn: tot.carryoverIn.toFixed(),
      netPayable: tot.netPayable.toFixed(), carryoverOut: tot.carryoverOut.toFixed(),
      // Sin valor a pagar no hay nada pendiente.
      paymentStatus: tot.netPayable.isZero() ? "PAID" : "PENDING",
      snapshot, payments: [], createdAt: t, updatedAt: t,
    });
    adminCollaborators.push({
      collaboratorId: c.id, fullName: c.fullName, position: c.position,
      projectCodes: [...new Set(mine.map((l) => l.detail.projectCode))].sort(),
      gross: tot.gross.toFixed(), adjustments: tot.adjustments.toFixed(), carryoverIn: tot.carryoverIn.toFixed(), netPayable: tot.netPayable.toFixed(), carryoverOut: tot.carryoverOut.toFixed(),
    });
  }

  // Los ajustes pendientes quedan aplicados en esta liquidación.
  const projectsById = new Map(prepared.projects.map((p) => [p.id, p]));
  const adjustments = (await readAll<AdjustmentDoc>(r, C.adjustments))
    .filter((a) => a.status === "PENDING" && !a.voidedAt && projectsById.has(a.projectId))
    .map((a) => ({ ...a, status: "APPLIED" as const, appliedInSettlementId: period.code }));

  // Indicadores administrativos congelados.
  const firstMonth = monthKey(period.periodStart);
  const lastMonth = monthKey(period.periodEnd);
  const monthsCovered: string[] = [];
  for (let m = firstMonth; m <= lastMonth; m = addMonths(m, 1)) monthsCovered.push(m);
  const months = (await readAll<MonthlySalesDoc>(r, C.monthlySales)).filter((m) => monthsCovered.includes(m.yearMonth));
  const salesInPeriod = months.reduce((acc, m) => acc.plus(m.validatedSalesCOP ?? 0), ZERO);
  const seen = new Set<string>();
  let collected = ZERO;
  for (const l of result.lines) {
    if (l.type !== "COLLECTION" || !l.collectionId || seen.has(l.collectionId)) continue;
    seen.add(l.collectionId);
    collected = collected.plus(D(l.detail.amountReceived ?? 0).mul(l.fxRate));
  }
  const admin: AdminSnapshot = {
    monthsCovered, salesInPeriodCOP: salesInPeriod.toFixed(), collectedCOP: collected.toFixed(),
    collaborators: adminCollaborators.sort((a, b) => a.fullName.localeCompare(b.fullName)),
  };
  const acked: AckedAlert[] = result.alerts.map((a) => ({ key: a.key, severity: a.severity, message: a.message }));

  const approved: SettlementDoc = {
    ...settlement,
    status: "APPROVED",
    totalGross: result.grand.gross.toFixed(), totalAdjustments: result.grand.adjustments.toFixed(), totalNet: result.grand.netPayable.toFixed(),
    calculatedAt: t, approvedAt: t, approvedById: opts.userId, acknowledgedAlerts: acked, adminSnapshot: admin, closingId: null, updatedAt: t,
  };
  const summary = `Liquidación ${period.code} aprobada y cerrada: ${result.lines.length} líneas, ${result.totals.length} colaboradores, bruto ${formatMoney(result.grand.gross, "COP", 2)}, ajustes ${formatMoney(result.grand.adjustments, "COP", 2)}, neto a pagar ${formatMoney(result.grand.netPayable, "COP", 2)}; ${adjustments.length} ajuste(s) aplicados; ${acked.filter((a) => a.severity === "WARNING").length} alerta(s) reconocidas`;
  return { settlement: approved, lines, commitments, people, adjustments, result, summary };
}

const planDocs = (p: ApprovalPlan) => [...p.lines, ...p.commitments, ...p.people, ...p.adjustments, p.settlement];

/** Escrituras del cierre (idempotentes salvo `create` de compromisos, que es la garantía anti pago doble). */
function planOps(code: string, p: ApprovalPlan, oldLineIds: { id: string }[], mode: "tx" | "batch"): ((w: Writer) => void)[] {
  const ops: ((w: Writer) => void)[] = [];
  const keep = new Set(p.lines.map((l) => l.id));
  for (const d of oldLineIds) if (!keep.has(d.id)) ops.push((w) => w.delete(linesCol(code).doc(d.id)));
  for (const l of p.lines) ops.push((w) => w.set(linesCol(code).doc(l.id), l));
  // En el cierre por lotes (reanudable) el compromiso se re-escribe de forma idempotente; en la transacción única se usa create().
  for (const c of p.commitments) ops.push((w) => (mode === "tx" ? w.create(ref(C.commitments, c.id), c) : w.set(ref(C.commitments, c.id), c)));
  for (const x of p.people) ops.push((w) => w.set(peopleCol(code).doc(x.id), x));
  for (const a of p.adjustments) ops.push((w) => w.set(ref(C.adjustments, a.id), a));
  return ops;
}

const CLOSING_MSG = (code: string) => `La liquidación ${code} quedó en proceso de cierre. Reanúdalo para completarlo (no se pierde ni se duplica nada).`;

/**
 * Aprueba y cierra la liquidación. Normalmente en UNA transacción: recalcula con el estado actual, valida las alertas,
 * congela las líneas, crea los compromisos (anti pago doble), las liquidaciones individuales y marca los ajustes como
 * aplicados. Si el cierre no cabe en una transacción (≥ 8 MiB) usa el protocolo por lotes reanudable (estado CLOSING).
 */
export async function approveSettlement(
  code: string,
  userId: string,
  acknowledgedKeys: string[],
  expected?: { gross: string; net: string },
  options: { forceBatches?: boolean; interruptAfterStart?: boolean } = {},
): Promise<{ result: SettlementResult; appliedAdjustments: number; mode: "single" | "batched" }> {
  let outcome: { plan: ApprovalPlan; mode: "single" | "closing" } | undefined;
  try {
    outcome = await runTx(async (tx) => {
      const closing = await tx.get(systemStateRef());
      if (closing.exists && (closing.data() as SystemStateDoc).closing) {
        const c = (closing.data() as SystemStateDoc).closing!;
        throw new DomainError(c.settlementCode === code ? CLOSING_MSG(code) : `Hay un cierre en curso (${c.settlementCode}). Complétalo antes de continuar.`);
      }
      const snap = await tx.get(settlementRef(code));
      if (!snap.exists) throw new DomainError("La liquidación no existe.");
      const settlement = snap.data() as SettlementDoc;
      if (settlement.status === "APPROVED") throw new DomainError("La liquidación ya está aprobada.");
      if (settlement.status === "CLOSING") throw new DomainError(CLOSING_MSG(code));

      const plan = await buildApprovalPlan(txReader(tx), settlement, { acknowledgedKeys, expected, validate: true, userId });
      const oldLines = (await tx.get(linesCol(code))).docs;

      if (!options.forceBatches && fitsInOneTx(planDocs(plan))) {
        for (const op of planOps(code, plan, oldLines, "tx")) op(tx as unknown as Writer);
        tx.set(settlementRef(code), plan.settlement);
        audit(tx, { entity: "Settlement", entityId: code, action: "APPROVE", summary: plan.summary, after: { ...plan.settlement, adminSnapshot: undefined }, userId });
        return { plan, mode: "single" as const };
      }

      // Cierre por lotes: se marca CLOSING y se bloquea el resto de las escrituras de negocio.
      const closingId = newId();
      const t = now();
      tx.set(settlementRef(code), { ...settlement, status: "CLOSING", closingId, updatedAt: t });
      tx.set(systemStateRef(), { id: "state", closing: { settlementCode: code, closingId, startedAt: t }, updatedAt: t } satisfies SystemStateDoc);
      audit(tx, { entity: "Settlement", entityId: code, action: "CLOSING_START", summary: `Cierre por lotes de ${code} iniciado (${planDocs(plan).length} documentos)`, userId });
      return { plan, mode: "closing" as const };
    });
  } catch (e) {
    if (isAlreadyExists(e)) throw new DomainError("Un recaudo de esta liquidación ya fue liquidado por otra operación. Recalcula e inténtalo de nuevo.");
    throw e;
  }

  if (outcome.mode === "single") return { result: outcome.plan.result, appliedAdjustments: outcome.plan.adjustments.length, mode: "single" };
  if (options.interruptAfterStart) throw new Error("interrupción simulada del cierre");
  const done = await finishClosing(code, userId);
  return { result: done.result, appliedAdjustments: done.appliedAdjustments, mode: "batched" };
}

/** Completa (o reanuda) un cierre por lotes: es idempotente, no duplica nada y deja la liquidación APROBADA. */
export async function finishClosing(code: string, userId: string): Promise<{ result: SettlementResult; appliedAdjustments: number }> {
  const stateSnap = await systemStateRef().get();
  const closing = stateSnap.exists ? (stateSnap.data() as SystemStateDoc).closing : null;
  if (!closing || closing.settlementCode !== code) throw new DomainError("No hay un cierre en curso para esa liquidación.");
  const snap = await settlementRef(code).get();
  const settlement = snap.data() as SettlementDoc;
  if (settlement.status !== "CLOSING" || settlement.closingId !== closing.closingId) throw new DomainError("El estado de la liquidación no coincide con el cierre en curso.");

  // Mientras hay un cierre en curso ninguna acción de negocio escribe, así que estas lecturas son estables.
  const plan = await buildApprovalPlan(plainReader, settlement, { acknowledgedKeys: [], validate: false, userId });
  const oldLines = (await linesCol(code).get()).docs;
  await commitInBatches(planOps(code, plan, oldLines, "batch"));

  await runTx(async (tx) => {
    const cur = await tx.get(settlementRef(code));
    const state = await tx.get(systemStateRef());
    const doc = cur.data() as SettlementDoc;
    if (doc.status !== "CLOSING" || doc.closingId !== closing.closingId) throw new DomainError("El cierre ya fue completado o cambió de estado.");
    tx.set(settlementRef(code), plan.settlement);
    tx.set(systemStateRef(), { ...(state.data() as SystemStateDoc), closing: null, updatedAt: now() });
    audit(tx, { entity: "Settlement", entityId: code, action: "APPROVE", summary: plan.summary, after: { ...plan.settlement, adminSnapshot: undefined }, userId });
  });
  return { result: plan.result, appliedAdjustments: plan.adjustments.length };
}

// ───────────── Pagos ─────────────

export interface PaymentInput {
  paidAt: string;
  amount: string;
  reference: string;
  notes?: string;
}

/** Registra un pago de una liquidación individual. La aprobación y el pago son estados distintos. */
export async function registerPayment(tx: Tx, key: string, input: PaymentInput, userId: string) {
  const parsed = parsePersonKey(key);
  if (!parsed) throw new DomainError("La liquidación individual no existe.");
  // La transacción lee el documento: dos pagos simultáneos no pueden leer el mismo saldo (el segundo reintenta).
  const [personSnap, settlementSnap, collabSnap] = await Promise.all([
    tx.get(peopleCol(parsed.code).doc(parsed.collaboratorId)),
    tx.get(settlementRef(parsed.code)),
    tx.get(ref(C.collaborators, parsed.collaboratorId)),
  ]);
  if (!personSnap.exists || !settlementSnap.exists) throw new DomainError("La liquidación individual no existe.");
  const cs = personSnap.data() as PersonSettlementDoc;
  const settlement = settlementSnap.data() as SettlementDoc;
  const collaboratorName = (collabSnap.data() as CollaboratorDoc | undefined)?.fullName ?? parsed.collaboratorId;
  if (settlement.status !== "APPROVED") throw new DomainError("Solo se pueden registrar pagos de liquidaciones aprobadas.");
  if (D(cs.netPayable).isZero()) throw new DomainError("Esta liquidación no tiene valor a pagar.");
  const amount = D(input.amount);
  if (amount.lte(0)) throw new DomainError("El valor pagado debe ser mayor que cero.");
  const reference = input.reference.trim();
  if (!reference) throw new DomainError("La referencia de pago es obligatoria.");
  if (cs.payments.some((p) => p.reference.toLowerCase() === reference.toLowerCase())) {
    throw new DomainError(`Ya existe un pago con la referencia «${reference}» en esta liquidación (posible pago duplicado).`);
  }

  const paid = cs.payments.reduce((acc, p) => acc.plus(p.amount), ZERO);
  const remaining = D(cs.netPayable).minus(paid);
  if (remaining.lte(PAY_TOLERANCE)) throw new DomainError("Esta liquidación ya está pagada en su totalidad.");
  if (amount.gt(remaining.plus(PAY_TOLERANCE))) {
    throw new DomainError(`El pago supera el saldo pendiente (${formatMoney(remaining, "COP", 2)}).`);
  }

  const t = now();
  const payment: PaymentDoc = { id: newId(), paidAt: input.paidAt as PaymentDoc["paidAt"], amount: amount.toFixed(), reference, notes: input.notes || null, createdAt: t, createdById: userId };
  const nowPaid = paid.plus(amount);
  const status = D(cs.netPayable).minus(nowPaid).lte(PAY_TOLERANCE) ? "PAID" : "PARTIAL";
  tx.set(peopleCol(parsed.code).doc(parsed.collaboratorId), { ...cs, payments: [...cs.payments, payment], paymentStatus: status, updatedAt: t });
  audit(tx, {
    entity: "Payment", entityId: payment.id, action: "PAY",
    summary: `Pago de ${formatMoney(amount, "COP", 2)} a ${collaboratorName} (${parsed.code}) el ${formatDate(input.paidAt as PaymentDoc["paidAt"])} · ref. ${reference}${status === "PAID" ? " · liquidación pagada" : " · pago parcial"}`,
    after: payment, userId,
  });
  return { status, remaining: D(cs.netPayable).minus(nowPaid) };
}

/** Descarta un borrador (nunca una liquidación aprobada). */
export async function discardDraft(tx: Tx, code: string, userId: string) {
  const snap = await tx.get(settlementRef(code));
  if (!snap.exists) throw new DomainError("La liquidación no existe.");
  const s = snap.data() as SettlementDoc;
  if (s.status === "APPROVED") throw new DomainError("Una liquidación aprobada no se puede descartar.");
  if (s.status === "CLOSING") throw new DomainError("La liquidación está en proceso de cierre; no se puede descartar.");
  const lines = (await tx.get(linesCol(code))).docs;
  // El borrador se elimina por completo (no deja una liquidación vacía que bloquee las siguientes).
  for (const d of lines) tx.delete(d.ref);
  tx.delete(settlementRef(code));
  tx.delete(ref(C.settlementReviews, code)); // la revisión pertenece a ese borrador
  audit(tx, { entity: "Settlement", entityId: code, action: "DISCARD", summary: `Borrador de ${s.code} descartado`, userId });
}
