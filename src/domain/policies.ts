import { type DateOnly, formatDate, formatMonth, startOfMonth } from "./dates";
import { DomainError } from "./project";
import { D, Decimal, formatMoney, formatPercent, type DecimalValue, ZERO } from "./money";

/**
 * Políticas de comisión.
 *
 *  GENERAL_THRESHOLD   El proyecto genera derecho a comisión si las ventas organizacionales del mes de venta
 *                      alcanzan o superan la meta (inclusivo, decisión 2026-10-05). % efectivo = % base o 0.
 *  GAMIFICATION_TIERS  La escala de cumplimiento REEMPLAZA la compuerta: % efectivo = % base × factor del tramo
 *                      (0 / 0,5 / 1 / 1,5). Límite inferior de cada tramo inclusivo.
 *
 * La política se asocia al registro del colaborador (nunca a su nombre).
 */

export type PolicyKind = "GENERAL_THRESHOLD" | "GAMIFICATION_TIERS";

export interface Tier {
  /** Cumplimiento mínimo (inclusivo) como fracción: 0.7 = 70 %. */
  min: DecimalValue;
  factor: DecimalValue;
  effectiveFrom: DateOnly;
}

export interface MonthEvaluation {
  yearMonth: string;
  sales: Decimal;
  goal: Decimal;
  /** sales / goal (solo informativo; las comparaciones usan multiplicación para evitar redondeos). */
  ratio: Decimal;
  reached: boolean;
}

export function evaluateMonth(yearMonth: string, sales: DecimalValue, goal: DecimalValue): MonthEvaluation {
  const s = D(sales);
  const g = D(goal);
  return { yearMonth, sales: s, goal: g, ratio: g.isZero() ? ZERO : s.div(g), reached: s.gte(g) };
}

/** Conjunto de tramos vigente en el mes (el de mayor `effectiveFrom` ≤ primer día del mes). */
export function tiersForMonth(tiers: Tier[], yearMonth: string): Tier[] {
  const start = startOfMonth(yearMonth);
  const applicable = tiers.filter((t) => t.effectiveFrom <= start);
  if (applicable.length === 0) return [];
  const latest = applicable.map((t) => t.effectiveFrom).sort().at(-1)!;
  return applicable.filter((t) => t.effectiveFrom === latest);
}

/** Factor del tramo: el de mayor `min` tal que ventas ≥ min × meta (comparación exacta, sin dividir). */
export function tierFactor(tiers: Tier[], sales: DecimalValue, goal: DecimalValue): { factor: Decimal; min: Decimal } {
  let chosen: { factor: Decimal; min: Decimal } = { factor: ZERO, min: ZERO };
  const ordered = [...tiers].sort((a, b) => D(a.min).comparedTo(b.min));
  for (const t of ordered) {
    if (D(sales).gte(D(goal).mul(t.min))) chosen = { factor: D(t.factor), min: D(t.min) };
  }
  return chosen;
}

export interface EffectiveRate {
  rate: Decimal;
  rule: string;
}

export function effectiveRate(kind: PolicyKind, baseRate: DecimalValue, month: MonthEvaluation, tiers: Tier[]): EffectiveRate {
  const base = D(baseRate);
  const mes = formatMonth(month.yearMonth);
  const detail = `ventas de ${mes} ${formatMoney(month.sales, "COP", 0)} / meta ${formatMoney(month.goal, "COP", 0)} = ${formatPercent(month.ratio, 2)}`;

  if (kind === "GENERAL_THRESHOLD") {
    return month.reached
      ? { rate: base, rule: `Política general: ${detail}. La meta se alcanzó → porcentaje base ${formatPercent(base)}.` }
      : { rate: ZERO, rule: `Política general: ${detail}. La meta no se alcanzó → 0 %.` };
  }

  const applicable = tiersForMonth(tiers, month.yearMonth);
  if (applicable.length === 0) {
    // Antes del inicio de la gamificación la persona se rige por la política general (decisión confirmada con el negocio).
    const start = tiers.map((t) => t.effectiveFrom).sort()[0];
    if (start && startOfMonth(month.yearMonth) < start) {
      const general = effectiveRate("GENERAL_THRESHOLD", base, month, tiers);
      return { rate: general.rate, rule: `Antes del inicio de la gamificación (desde ${formatDate(start)}) rige la política general. ${general.rule}` };
    }
    throw new DomainError(`No hay una escala de gamificación vigente para ${mes}: configúrala antes de validar el mes.`);
  }
  const { factor, min } = tierFactor(applicable, month.sales, month.goal);
  const rate = base.mul(factor);
  return {
    rate,
    rule: `Gamificación: ${detail} → tramo desde ${formatPercent(min, 0)} → factor ${factor.toFixed()}× sobre ${formatPercent(base)} = ${formatPercent(rate)}.`,
  };
}

/** Resultado del mes frente a la política general (para el estado «Elegible / No elegible» de los proyectos). */
export function monthOutcomeReason(month: MonthEvaluation): string {
  const mes = formatMonth(month.yearMonth);
  const detail = `Ventas de ${mes}: ${formatMoney(month.sales, "COP", 0)} frente a una meta de ${formatMoney(month.goal, "COP", 0)} (${formatPercent(month.ratio, 1)}).`;
  return month.reached
    ? `${detail} La meta se alcanzó: el proyecto genera derecho a comisión.`
    : `${detail} La meta no se alcanzó: el proyecto no genera comisión bajo la política general.`;
}
