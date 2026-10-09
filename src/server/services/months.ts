import { endOfMonth, formatMonth, startOfMonth } from "@/domain/dates";
import { goalForMonth } from "@/domain/goals";
import { D, formatMoney } from "@/domain/money";
import { effectiveRate, evaluateMonth, monthOutcomeReason, type Tier } from "@/domain/policies";
import { DomainError } from "@/domain/project";
import {
  C, audit, col, emptyMonth, isSettled, now, ref,
  type CollaboratorDoc, type GoalDoc, type MonthlySalesDoc, type PolicyDoc, type ProjectDoc, type SettlementDoc, type Tx,
} from "@/store";

export interface MonthValidationResult {
  yearMonth: string;
  sales: string;
  goal: string;
  ratio: string;
  reached: boolean;
  assignments: { collaborator: string; project: string; baseRate: string; effectiveRate: string; rule: string }[];
}

/**
 * Valida un mes calendario: fija la elegibilidad de sus proyectos y el porcentaje efectivo de cada asignación.
 * Solo puede hacerse cuando el mes ya terminó (hora de Colombia). Una vez validado, el resultado es inmutable
 * y no depende de las ventas de meses posteriores. Debe llamarse dentro de una transacción (tras `assertNotClosing`).
 */
export async function validateMonth(tx: Tx, yearMonth: string, userId: string, today: string): Promise<MonthValidationResult> {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new DomainError("Mes inválido.");
  if (endOfMonth(yearMonth) >= today) {
    throw new DomainError(`${formatMonth(yearMonth)} aún no termina: solo se pueden validar meses cerrados, porque nuevas ventas todavía pueden cambiar el cumplimiento.`);
  }

  // ───── Lecturas ─────
  const monthSnap = await tx.get(ref(C.monthlySales, yearMonth));
  const month = monthSnap.exists ? (monthSnap.data() as MonthlySalesDoc) : emptyMonth(yearMonth);
  if (month.status === "VALIDATED") throw new DomainError(`${formatMonth(yearMonth)} ya está validado.`);

  const [goalSnap, policySnap, projectSnap] = await Promise.all([
    tx.get(col(C.goals)),
    tx.get(col(C.policies)),
    tx.get(col(C.projects).where("saleMonth", "==", yearMonth)),
  ]);
  const goals = goalSnap.docs.map((d) => d.data() as GoalDoc).map((g) => ({ effectiveFrom: g.effectiveFrom, amount: D(g.amountCOP) })).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const policies = new Map(policySnap.docs.map((d) => [d.id, d.data() as PolicyDoc]));
  const projects = projectSnap.docs.map((d) => d.data() as ProjectDoc).filter((p) => !p.voidedAt);

  const collabIds = [...new Set(projects.flatMap((p) => p.assignments.filter((a) => !a.removedAt).map((a) => a.collaboratorId)))];
  const collabs = new Map<string, CollaboratorDoc>();
  for (const id of collabIds) {
    const s = await tx.get(ref(C.collaborators, id));
    if (s.exists) collabs.set(id, s.data() as CollaboratorDoc);
  }

  // ───── Cálculo ─────
  const sales = projects.reduce((acc, p) => acc.plus(p.saleAmountCOP), D(0)).plus(month.manualAdjustmentCOP);
  const goal = goalForMonth(goals, yearMonth);
  const evaluation = evaluateMonth(yearMonth, sales, goal);

  const t = now();
  const applied: MonthValidationResult["assignments"] = [];
  const updatedProjects: ProjectDoc[] = [];
  for (const p of projects) {
    let touched = false;
    const assignments = p.assignments.map((a) => {
      if (a.removedAt) return a;
      const c = collabs.get(a.collaboratorId);
      const policy = c ? policies.get(c.policyId) : undefined;
      if (!c || !policy) throw new DomainError(`No se encontró el colaborador o la política de una asignación del proyecto ${p.code}.`);
      const tiers: Tier[] = policy.tiers.map((x) => ({ min: x.min, factor: x.factor, effectiveFrom: x.effectiveFrom }));
      const er = effectiveRate(policy.kind, a.baseRate, evaluation, tiers);
      applied.push({ collaborator: c.fullName, project: p.code, baseRate: D(a.baseRate).toFixed(), effectiveRate: er.rate.toFixed(), rule: er.rule });
      touched = true;
      return { ...a, effectiveRate: er.rate.toFixed(), effectiveRateRule: er.rule };
    });
    if (touched) updatedProjects.push({ ...p, assignments, updatedAt: t });
  }

  const reason = monthOutcomeReason(evaluation);
  const after: MonthlySalesDoc = {
    ...month,
    status: "VALIDATED",
    validatedSalesCOP: sales.toFixed(),
    goalSnapshotCOP: goal.toFixed(),
    achievementRatio: evaluation.ratio.toDecimalPlaces(8).toFixed(),
    outcome: evaluation.reached ? "ELIGIBLE" : "NOT_ELIGIBLE",
    outcomeReason: reason,
    validatedAt: t,
    validatedById: userId,
    updatedAt: t,
  };

  // ───── Escrituras ─────
  for (const p of updatedProjects) tx.set(ref(C.projects, p.id), p);
  tx.set(ref(C.monthlySales, yearMonth), after);
  audit(tx, {
    entity: "MonthlySales",
    entityId: yearMonth,
    action: "VALIDATE",
    summary: `Mes ${formatMonth(yearMonth)} validado: ventas ${formatMoney(sales, "COP", 0)} / meta ${formatMoney(goal, "COP", 0)} → ${evaluation.reached ? "elegible" : "no elegible"} (${applied.length} asignaciones fijadas)`,
    before: month,
    after,
    userId,
  });
  return { yearMonth, sales: sales.toFixed(), goal: goal.toFixed(), ratio: evaluation.ratio.toFixed(8), reached: evaluation.reached, assignments: applied };
}

/**
 * Reabre un mes validado (con motivo). No es posible si ya existen comisiones liquidadas de sus proyectos:
 * las liquidaciones cerradas no se modifican; en ese caso las correcciones se hacen con ajustes.
 */
export async function reopenMonth(tx: Tx, yearMonth: string, reason: string, userId: string) {
  const monthSnap = await tx.get(ref(C.monthlySales, yearMonth));
  const month = monthSnap.exists ? (monthSnap.data() as MonthlySalesDoc) : null;
  if (!month || month.status !== "VALIDATED") throw new DomainError("Solo se pueden reabrir meses validados.");
  if (reason.trim().length < 10) throw new DomainError("Explica el motivo de la reapertura (mínimo 10 caracteres).");

  const projects = (await tx.get(col(C.projects).where("saleMonth", "==", yearMonth))).docs.map((d) => d.data() as ProjectDoc);
  for (const p of projects) {
    if (await isSettled(tx, "projectId", p.id)) {
      throw new DomainError(`No se puede reabrir ${formatMonth(yearMonth)}: ya hay comisiones liquidadas de sus proyectos. Las correcciones se registran como ajustes.`);
    }
  }
  // Una liquidación aprobada pudo haber evaluado (incluso con 0 %) recaudos de proyectos de este mes.
  const start = startOfMonth(yearMonth);
  const later = (await tx.get(col(C.settlements).where("periodEnd", ">=", start))).docs
    .map((d) => d.data() as SettlementDoc)
    .find((s) => s.status === "APPROVED" || s.status === "CLOSING");
  if (later) {
    throw new DomainError(`No se puede reabrir ${formatMonth(yearMonth)}: la liquidación ${later.code} ya está aprobada y pudo haber evaluado sus recaudos. Las correcciones se registran como ajustes.`);
  }

  const t = now();
  for (const p of projects) {
    tx.set(ref(C.projects, p.id), { ...p, assignments: p.assignments.map((a) => ({ ...a, effectiveRate: null, effectiveRateRule: null, exception: null })), updatedAt: t });
  }
  const after: MonthlySalesDoc = {
    ...month, status: "REOPENED", outcome: null, outcomeReason: null, validatedSalesCOP: null, goalSnapshotCOP: null, achievementRatio: null,
    validatedAt: null, validatedById: null, updatedAt: t,
  };
  tx.set(ref(C.monthlySales, yearMonth), after);
  audit(tx, { entity: "MonthlySales", entityId: yearMonth, action: "REOPEN", summary: `Mes ${formatMonth(yearMonth)} reabierto. Motivo: ${reason.trim()}`, before: month, after, userId });
}
