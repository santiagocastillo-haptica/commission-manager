import { addMonths, monthKey, todayBogota } from "@/domain/dates";
import { D } from "@/domain/money";
import { C, col, type AuditDoc, type ExchangeRateDoc } from "@/store";
import { loadAllProjects, loadGoals, loadMonthlySalesDocs, loadPolicyDocs } from "../repo";
import { computeMonthFacts, goalForMonth } from "./common";

export interface MonthRow {
  yearMonth: string;
  status: "OPEN" | "VALIDATED" | "REOPENED";
  outcome: "ELIGIBLE" | "NOT_ELIGIBLE" | null;
  salesCOP: string;
  goalCOP: string;
  ratio: string;
  projectCount: number;
  manualAdjustmentCOP: string;
  manualAdjustmentNote: string | null;
}

/** Meses con ventas más los últimos 12 hasta el actual, de reciente a antiguo. */
export async function listMonths(): Promise<MonthRow[]> {
  const [projects, months, goals] = await Promise.all([loadAllProjects(), loadMonthlySalesDocs(), loadGoals()]);
  const facts = computeMonthFacts(projects, months, goals);
  const byMonth = new Map(months.map((m) => [m.yearMonth, m]));
  const counts = new Map<string, number>();
  for (const p of projects) if (!p.voidedAt) counts.set(p.saleMonth, (counts.get(p.saleMonth) ?? 0) + 1);

  const current = monthKey(todayBogota());
  const keys = new Set<string>(facts.keys());
  for (let i = 0; i < 12; i++) keys.add(addMonths(current, -i));

  return Array.from(keys)
    .sort()
    .reverse()
    .map((ym) => {
      const sales = D(facts.get(ym)?.liveSalesCOP ?? 0);
      const goal = goalForMonth(goals, ym);
      const r = byMonth.get(ym);
      return {
        yearMonth: ym,
        status: r?.status ?? "OPEN",
        outcome: r?.outcome ?? null,
        salesCOP: sales.toFixed(),
        goalCOP: goal.toFixed(),
        ratio: goal.isZero() ? "0" : sales.div(goal).toFixed(8),
        projectCount: counts.get(ym) ?? 0,
        manualAdjustmentCOP: D(r?.manualAdjustmentCOP ?? 0).toFixed(),
        manualAdjustmentNote: r?.manualAdjustmentNote ?? null,
      };
    });
}

export async function listGoals() {
  const goals = await loadGoals();
  return goals.map((g) => ({ effectiveFrom: g.effectiveFrom, amount: g.amount.toFixed() })).reverse();
}

export async function listRates() {
  const docs = (await col(C.exchangeRates).get()).docs.map((d) => d.data() as ExchangeRateDoc);
  return docs
    .sort((a, b) => b.date.localeCompare(a.date) || a.currency.localeCompare(b.currency))
    .slice(0, 200)
    .map((r) => ({ id: r.id, currency: r.currency, date: r.date, rate: D(r.rate).toFixed(), source: r.source }));
}

export async function listPolicyTiers() {
  const policies = await loadPolicyDocs();
  return policies
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      kind: p.kind,
      tiers: [...p.tiers]
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || D(a.min).comparedTo(b.min))
        .map((t) => ({ id: `${t.effectiveFrom}_${t.min}`, min: D(t.min).toFixed(), factor: D(t.factor).toFixed(), effectiveFrom: t.effectiveFrom })),
    }));
}

export async function listAudit(limit = 150) {
  const snap = await col(C.auditLog).orderBy("createdAt", "desc").limit(limit).get();
  const users = new Map<string, string>();
  const rows = snap.docs.map((d) => d.data() as AuditDoc);
  for (const id of new Set(rows.map((r) => r.userId).filter((x): x is string => Boolean(x)))) {
    const u = await col(C.users).doc(id).get();
    if (u.exists) users.set(id, (u.data() as { name: string }).name);
  }
  return rows.map((r) => ({ id: r.id, at: r.createdAt, entity: r.entity, action: r.action, summary: r.summary, user: r.userId ? (users.get(r.userId) ?? null) : null }));
}
