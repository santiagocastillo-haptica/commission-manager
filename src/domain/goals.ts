import { type DateOnly, startOfMonth } from "./dates";
import { D, Decimal } from "./money";

export interface GoalRow {
  effectiveFrom: DateOnly;
  amount: Decimal;
}

/** Meta vigente en un mes: la de mayor `effectiveFrom` que no supere el primer día del mes. */
export function goalForMonth(goals: GoalRow[], yearMonth: string): Decimal {
  const start = startOfMonth(yearMonth);
  let current: GoalRow | undefined;
  for (const g of [...goals].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) {
    if (g.effectiveFrom <= start) current = g;
  }
  return (current ?? goals[0])?.amount ?? D(390_000_000);
}
