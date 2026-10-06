import { now } from "./tx";
import type { MonthlySalesDoc } from "./types";

/** Documento de un mes calendario aún sin validar. */
export function emptyMonth(yearMonth: string): MonthlySalesDoc {
  const t = now();
  return {
    id: yearMonth,
    yearMonth,
    status: "OPEN",
    manualAdjustmentCOP: "0",
    manualAdjustmentNote: null,
    validatedSalesCOP: null,
    goalSnapshotCOP: null,
    achievementRatio: null,
    outcome: null,
    outcomeReason: null,
    validatedAt: null,
    validatedById: null,
    createdAt: t,
    updatedAt: t,
  };
}
