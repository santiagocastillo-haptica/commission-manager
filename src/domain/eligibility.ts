import { formatMonth } from "./dates";
import { D, formatMoney, formatPercent, type DecimalValue } from "./money";

/**
 * Estado de elegibilidad de un proyecto, determinado por el cumplimiento de la meta del mes de venta.
 * Es el estado frente a la POLÍTICA GENERAL; los colaboradores con política de gamificación se evalúan
 * por su escala (porcentaje efectivo por asignación).
 *
 * Regla (confirmada 2026-10-05): la meta se cumple con ventas del mes ≥ meta (inclusivo).
 */

export type EligibilityStatus = "PENDING_VALIDATION" | "ELIGIBLE" | "NOT_ELIGIBLE";

export interface MonthFacts {
  yearMonth: string;
  status: "OPEN" | "VALIDATED" | "REOPENED";
  outcome: "ELIGIBLE" | "NOT_ELIGIBLE" | null;
  /** Foto tomada al validar (nula mientras el mes no esté validado). */
  validatedSalesCOP: DecimalValue | null;
  goalSnapshotCOP: DecimalValue | null;
  achievementRatio: DecimalValue | null;
  outcomeReason: string | null;
  /** Ventas del mes calculadas en vivo (solo para mostrar mientras está pendiente). */
  liveSalesCOP: DecimalValue;
  liveGoalCOP: DecimalValue;
}

export function projectEligibility(m: MonthFacts): { status: EligibilityStatus; reason: string } {
  const month = formatMonth(m.yearMonth);

  if (m.status === "VALIDATED" && m.outcome) {
    const sales = m.validatedSalesCOP ?? m.liveSalesCOP;
    const goal = m.goalSnapshotCOP ?? m.liveGoalCOP;
    const ratio = m.achievementRatio ?? D(sales).div(goal);
    const detail = `Ventas de ${month}: ${formatMoney(sales, "COP", 0)} frente a una meta de ${formatMoney(goal, "COP", 0)} (${formatPercent(ratio, 1)}).`;
    return m.outcome === "ELIGIBLE"
      ? { status: "ELIGIBLE", reason: m.outcomeReason ?? `${detail} La meta se cumplió: el proyecto genera derecho a comisión.` }
      : { status: "NOT_ELIGIBLE", reason: m.outcomeReason ?? `${detail} La meta no se alcanzó: el proyecto no genera comisión bajo la política general.` };
  }

  const ratio = D(m.liveSalesCOP).div(m.liveGoalCOP);
  return {
    status: "PENDING_VALIDATION",
    reason: `El mes de venta (${month}) aún no está validado. Ventas registradas hasta hoy: ${formatMoney(m.liveSalesCOP, "COP", 0)} de ${formatMoney(m.liveGoalCOP, "COP", 0)} (${formatPercent(ratio, 1)}). La elegibilidad se define cuando el administrador valida el mes.`,
  };
}
