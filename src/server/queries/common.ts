import type { MonthFacts } from "@/domain/eligibility";
import { goalForMonth, type GoalRow } from "@/domain/goals";
import { D, Decimal, ZERO } from "@/domain/money";
import type { MonthlySalesDoc, ProjectDoc } from "@/store";
import { loadAllProjects, loadGoals, loadMonthlySalesDocs } from "../repo";

export { goalForMonth, type GoalRow, loadGoals };

/** Ventas organizacionales de cada mes: todos los proyectos no anulados (con o sin colaboradores) + ajuste manual. */
export function computeLiveSales(projects: ProjectDoc[], months: MonthlySalesDoc[]): Map<string, Decimal> {
  const map = new Map<string, Decimal>();
  for (const p of projects) {
    if (p.voidedAt) continue;
    map.set(p.saleMonth, (map.get(p.saleMonth) ?? ZERO).plus(p.saleAmountCOP));
  }
  for (const m of months) map.set(m.yearMonth, (map.get(m.yearMonth) ?? ZERO).plus(m.manualAdjustmentCOP));
  return map;
}

/** Estado de cada mes (para elegibilidad). Función pura: recibe los datos ya cargados. */
export function computeMonthFacts(projects: ProjectDoc[], months: MonthlySalesDoc[], goals: GoalRow[]): Map<string, MonthFacts> {
  const live = computeLiveSales(projects, months);
  const byMonth = new Map(months.map((m) => [m.yearMonth, m]));
  const keys = new Set([...live.keys(), ...byMonth.keys()]);
  const facts = new Map<string, MonthFacts>();
  for (const ym of keys) {
    const r = byMonth.get(ym);
    facts.set(ym, {
      yearMonth: ym,
      status: r?.status ?? "OPEN",
      outcome: r?.outcome ?? null,
      validatedSalesCOP: r?.validatedSalesCOP ?? null,
      goalSnapshotCOP: r?.goalSnapshotCOP ?? null,
      achievementRatio: r?.achievementRatio ?? null,
      outcomeReason: r?.outcomeReason ?? null,
      liveSalesCOP: (live.get(ym) ?? ZERO).toFixed(),
      liveGoalCOP: goalForMonth(goals, ym).toFixed(),
    });
  }
  return facts;
}

export async function liveSalesByMonth(): Promise<Map<string, Decimal>> {
  const [projects, months] = await Promise.all([loadAllProjects(), loadMonthlySalesDocs()]);
  return computeLiveSales(projects, months);
}

export async function loadMonthFacts(): Promise<Map<string, MonthFacts>> {
  const [projects, months, goals] = await Promise.all([loadAllProjects(), loadMonthlySalesDocs(), loadGoals()]);
  return computeMonthFacts(projects, months, goals);
}

export const dec = (v: string | null | undefined): string | null => (v == null ? null : D(v).toFixed());

/** Ajuste manual de ventas por mes (solo los meses pedidos). */
export async function loadManualAdjustments(yearMonths: string[]): Promise<Map<string, string>> {
  const wanted = new Set(yearMonths);
  const months = await loadMonthlySalesDocs();
  return new Map(months.filter((m) => wanted.has(m.yearMonth)).map((m) => [m.yearMonth, D(m.manualAdjustmentCOP).toFixed()]));
}
