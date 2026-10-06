import { D, ZERO } from "@/domain/money";
import {
  C, col, linesCol, peopleCol, systemStateRef,
  type AdjustmentDoc, type CommitmentDoc, type InvoiceDoc, type PersonSettlementDoc, type ProjectDoc, type SettlementDoc, type SettlementLineDoc, type SystemStateDoc,
} from "@/store";
import type { LineSnapshot } from "./services/settlement-types";

export interface IntegrityProblem {
  scope: string;
  message: string;
}

export interface IntegrityReport {
  ok: boolean;
  checked: { settlements: number; lines: number; commitments: number; invoices: number; projects: number };
  problems: IntegrityProblem[];
}

const TOLERANCE = D("0.000001");
const near = (a: Parameters<typeof D>[0], b: Parameters<typeof D>[0]) => D(a).minus(b).abs().lte(TOLERANCE);
const all = async <T>(name: Parameters<typeof col>[0]) => (await col(name).get()).docs.map((d) => d.data() as T);

/**
 * Verificación de integridad. En Firestore no hay triggers que impidan modificar lo ya liquidado: esta revisión
 * recalcula y cruza los datos para detectar cualquier alteración o inconsistencia. Solo lee; no modifica nada.
 * Debe ejecutarse en CI y antes de cada cierre (`npm run verify:integrity`).
 */
export async function verifyIntegrity(): Promise<IntegrityReport> {
  const problems: IntegrityProblem[] = [];
  const bad = (scope: string, message: string) => problems.push({ scope, message });

  const [settlements, commitments, projects, invoices, adjustments, state] = await Promise.all([
    all<SettlementDoc>(C.settlements),
    all<CommitmentDoc>(C.commitments),
    all<ProjectDoc>(C.projects),
    all<InvoiceDoc>(C.invoices),
    all<AdjustmentDoc>(C.adjustments),
    systemStateRef().get().then((s) => (s.exists ? (s.data() as SystemStateDoc) : null)),
  ]);

  const commitById = new Map(commitments.map((c) => [c.id, c]));
  const collections = new Map(invoices.flatMap((i) => i.collections.map((c) => [c.id, c] as const)));
  const seenPairs = new Set<string>();
  let lineCount = 0;

  if (state?.closing) bad("sistema", `Hay un cierre por lotes sin completar (${state.closing.settlementCode}); reanúdalo.`);

  // ───── Liquidaciones ─────
  const lineIdsByCode = new Map<string, Set<string>>();
  for (const s of settlements) {
    const scope = `liquidación ${s.code}`;
    const lines = (await linesCol(s.code).get()).docs.map((d) => d.data() as SettlementLineDoc);
    const people = (await peopleCol(s.code).get()).docs.map((d) => d.data() as PersonSettlementDoc);
    lineCount += lines.length;
    lineIdsByCode.set(s.code, new Set(lines.map((l) => l.id)));

    if (s.status === "DRAFT") {
      if (lines.some((l) => l.committed)) bad(scope, "Un borrador tiene líneas marcadas como liquidadas.");
      if (people.length > 0) bad(scope, "Un borrador tiene liquidaciones individuales.");
      continue;
    }
    if (s.status === "CLOSING") continue; // el cierre en curso ya se reporta arriba

    if (lines.some((l) => !l.committed)) bad(scope, "Una liquidación aprobada tiene líneas sin liquidar.");
    if (!s.approvedAt || !s.approvedById) bad(scope, "Una liquidación aprobada no registra quién y cuándo la aprobó.");

    // Totales = suma de las líneas
    const gross = lines.filter((l) => l.type === "COLLECTION").reduce((a, l) => a.plus(l.commissionCOP), ZERO);
    const adj = lines.filter((l) => l.type === "ADJUSTMENT").reduce((a, l) => a.plus(l.commissionCOP), ZERO);
    if (!near(gross, s.totalGross)) bad(scope, `El bruto guardado (${s.totalGross}) no coincide con la suma de sus líneas (${gross.toFixed()}).`);
    if (!near(adj, s.totalAdjustments)) bad(scope, `Los ajustes guardados (${s.totalAdjustments}) no coinciden con la suma de sus líneas (${adj.toFixed()}).`);
    const netSum = people.reduce((a, p) => a.plus(p.netPayable), ZERO);
    if (!near(netSum, s.totalNet)) bad(scope, `El neto guardado (${s.totalNet}) no coincide con la suma de las liquidaciones individuales (${netSum.toFixed()}).`);

    // Cada colaborador
    for (const p of people) {
      const mine = lines.filter((l) => l.collaboratorId === p.collaboratorId);
      const pg = mine.filter((l) => l.type === "COLLECTION").reduce((a, l) => a.plus(l.commissionCOP), ZERO);
      const pa = mine.filter((l) => l.type === "ADJUSTMENT").reduce((a, l) => a.plus(l.commissionCOP), ZERO);
      const who = `${scope} · colaborador ${p.collaboratorId}`;
      if (!near(pg, p.grossCommission)) bad(who, "El bruto no coincide con la suma de sus líneas.");
      if (!near(pa, p.adjustmentsTotal)) bad(who, "Los ajustes no coinciden con la suma de sus líneas.");
      const total = D(p.grossCommission).plus(p.adjustmentsTotal).plus(p.carryoverIn);
      const expectedNet = total.isNegative() ? ZERO : total;
      const expectedOut = total.isNegative() ? total : ZERO;
      if (!near(expectedNet, p.netPayable)) bad(who, `El neto a pagar (${p.netPayable}) no es bruto + ajustes + arrastre (${expectedNet.toFixed()}).`);
      if (!near(expectedOut, p.carryoverOut)) bad(who, `El saldo arrastrado (${p.carryoverOut}) no corresponde (${expectedOut.toFixed()}).`);
      const paid = p.payments.reduce((a, x) => a.plus(x.amount), ZERO);
      if (paid.gt(D(p.netPayable).plus("0.005"))) bad(who, `Los pagos (${paid.toFixed()}) superan el neto a pagar (${p.netPayable}).`);
      const refs = p.payments.map((x) => x.reference.toLowerCase());
      if (new Set(refs).size !== refs.length) bad(who, "Hay pagos con la misma referencia.");
      const expectedStatus = D(p.netPayable).isZero() ? "PAID" : paid.isZero() ? "PENDING" : D(p.netPayable).minus(paid).lte("0.005") ? "PAID" : "PARTIAL";
      if (p.paymentStatus !== expectedStatus) bad(who, `El estado de pago (${p.paymentStatus}) no corresponde a los pagos registrados (${expectedStatus}).`);
    }

    // Cada línea tiene su compromiso, y el recaudo liquidado no fue alterado
    for (const l of lines) {
      const ls = `${scope} · línea ${l.id}`;
      const target = l.collectionId ?? l.adjustmentId;
      if (!target) bad(ls, "La línea no referencia ningún recaudo ni ajuste.");
      const key = `${target}__${l.assignmentId}`;
      if (l.id !== key) bad(ls, "El identificador de la línea no corresponde a su recaudo y asignación.");
      const c = commitById.get(l.id);
      if (!c) bad(ls, "La línea liquidada no tiene su compromiso anti pago doble.");
      else {
        if (c.settlementCode !== s.code) bad(ls, `El compromiso pertenece a otra liquidación (${c.settlementCode}).`);
        if (!near(c.commissionCOP, l.commissionCOP)) bad(ls, "El compromiso y la línea tienen distinta comisión.");
      }
      if (l.type === "COLLECTION" && l.collectionId) {
        if (seenPairs.has(key)) bad(ls, "El mismo recaudo se liquidó dos veces para la misma asignación.");
        seenPairs.add(key);
        const coll = collections.get(l.collectionId);
        const sn = l.snapshot as LineSnapshot | null;
        if (!coll) bad(ls, "El recaudo liquidado ya no existe.");
        else {
          if (coll.voidedAt) bad(ls, "El recaudo liquidado fue anulado.");
          if (sn?.amountReceived != null && !near(coll.amountReceived, sn.amountReceived)) bad(ls, `El recaudo liquidado cambió de valor (${sn.amountReceived} → ${coll.amountReceived}).`);
          if (sn?.collectionDate && coll.date !== sn.collectionDate) bad(ls, `El recaudo liquidado cambió de fecha (${sn.collectionDate} → ${coll.date}).`);
        }
      }
    }
  }

  // ───── Compromisos huérfanos ─────
  for (const c of commitments) {
    const lines = lineIdsByCode.get(c.settlementCode);
    if (!lines?.has(c.id)) bad(`compromiso ${c.id}`, `No tiene línea en la liquidación ${c.settlementCode}.`);
    const s = settlements.find((x) => x.code === c.settlementCode);
    if (s && s.status === "DRAFT") bad(`compromiso ${c.id}`, "Pertenece a un borrador.");
  }

  // ───── Ajustes ─────
  for (const a of adjustments) {
    const committed = commitments.some((c) => c.adjustmentId === a.id);
    if (a.status === "APPLIED" && !a.voidedAt && !committed && !a.appliedInSettlementId) bad(`ajuste ${a.id}`, "Está aplicado pero no indica en qué liquidación.");
    if (committed && a.voidedAt) bad(`ajuste ${a.id}`, "Fue liquidado y está anulado.");
    if (committed && a.status !== "APPLIED") bad(`ajuste ${a.id}`, "Tiene compromiso pero no está marcado como aplicado.");
  }

  // ───── Facturas y proyectos ─────
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const invoicedByProject = new Map<string, ReturnType<typeof D>>();
  for (const i of invoices) {
    const scope = `factura ${i.number ?? i.id}`;
    if (!projectById.has(i.projectId)) bad(scope, "Su proyecto no existe.");
    if (i.collectionIds.length !== i.collections.length || i.collections.some((c) => !i.collectionIds.includes(c.id))) bad(scope, "El índice de recaudos no coincide con sus recaudos.");
    if (i.voidedAt) continue;
    invoicedByProject.set(i.projectId, (invoicedByProject.get(i.projectId) ?? ZERO).plus(i.amountPreTax));
    const received = i.collections.filter((c) => !c.voidedAt).reduce((a, c) => a.plus(c.amountReceived), ZERO);
    const overpaid = i.collections.some((c) => !c.voidedAt && c.isOverpaymentAdjustment);
    if (received.gt(i.amountPreTax) && !overpaid) bad(scope, "Los recaudos superan el valor de la factura sin un excedente justificado.");
    if (i.status === "PLANNED" && received.gt(0)) bad(scope, "Una factura prevista tiene recaudos.");
  }
  for (const p of projects) {
    const scope = `proyecto ${p.code}`;
    if (p.id !== p.code) bad(scope, "El identificador no coincide con el código.");
    if (D(p.netBase).isNegative()) bad(scope, "La base comisionable es negativa.");
    if (!p.voidedAt && (invoicedByProject.get(p.id) ?? ZERO).gt(p.saleAmount)) bad(scope, "Lo facturado supera el valor de la venta.");
    const active = p.assignments.filter((a) => !a.removedAt).map((a) => a.collaboratorId).sort();
    if (JSON.stringify(active) !== JSON.stringify([...p.collaboratorIds].sort())) bad(scope, "El índice de colaboradores activos no coincide con las asignaciones.");
    for (const a of p.assignments) {
      if (D(a.baseRate).gt("0.01") || D(a.baseRate).lte(0)) bad(scope, `Una asignación tiene un porcentaje base fuera de rango (${a.baseRate}).`);
      if (!p.everAssignedIds.includes(a.collaboratorId)) bad(scope, "El índice histórico de colaboradores no incluye una asignación.");
    }
  }

  return {
    ok: problems.length === 0,
    checked: { settlements: settlements.length, lines: lineCount, commitments: commitments.length, invoices: invoices.length, projects: projects.length },
    problems,
  };
}
