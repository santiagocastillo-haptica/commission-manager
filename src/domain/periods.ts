import { type DateOnly, monthKey, yearOf } from "./dates";

/**
 * Períodos de liquidación (Regla 6).
 *   Abril de Y:   1-oct-(Y-1) → 31-mar-Y, pago 15-abr-Y
 *   Octubre de Y: 1-abr-Y     → 30-sep-Y, pago 15-oct-Y
 * El período de cada comisión lo determina la fecha efectiva del recaudo. Límites inclusivos.
 */

export type SettlementHalf = "APRIL" | "OCTOBER";

export interface SettlementPeriod {
  code: string; // LIQ-2026-10
  year: number;
  half: SettlementHalf;
  label: string; // "Octubre 2026"
  periodStart: DateOnly;
  periodEnd: DateOnly;
  paymentDate: DateOnly;
}

export function settlementPeriod(year: number, half: SettlementHalf): SettlementPeriod {
  if (half === "APRIL") {
    return {
      code: `LIQ-${year}-04`,
      year,
      half,
      label: `Abril ${year}`,
      periodStart: `${year - 1}-10-01`,
      periodEnd: `${year}-03-31`,
      paymentDate: `${year}-04-15`,
    };
  }
  return {
    code: `LIQ-${year}-10`,
    year,
    half,
    label: `Octubre ${year}`,
    periodStart: `${year}-04-01`,
    periodEnd: `${year}-09-30`,
    paymentDate: `${year}-10-15`,
  };
}

/** Liquidación a la que pertenece un recaudo según su fecha efectiva. */
export function settlementForCollectionDate(date: DateOnly): SettlementPeriod {
  const month = Number(monthKey(date).slice(5, 7));
  const year = yearOf(date);
  if (month >= 4 && month <= 9) return settlementPeriod(year, "OCTOBER");
  if (month >= 10) return settlementPeriod(year + 1, "APRIL");
  return settlementPeriod(year, "APRIL");
}

/** Próxima liquidación cuya fecha de pago es hoy o posterior. */
export function nextSettlement(today: DateOnly): SettlementPeriod {
  const y = yearOf(today);
  const candidates = [settlementPeriod(y, "APRIL"), settlementPeriod(y, "OCTOBER"), settlementPeriod(y + 1, "APRIL")];
  return candidates.find((c) => c.paymentDate >= today)!;
}

/** Liquidaciones que corresponde mostrar en el selector: las de los años cercanos, ordenadas de reciente a antigua. */
export function settlementOptions(today: DateOnly, yearsBack = 1): SettlementPeriod[] {
  const y = yearOf(today);
  const out: SettlementPeriod[] = [];
  for (let year = y + 1; year >= y - yearsBack; year--) {
    out.push(settlementPeriod(year, "OCTOBER"), settlementPeriod(year, "APRIL"));
  }
  // Solo períodos que ya empezaron (el que está en curso incluido); los futuros aún no tienen recaudos.
  return out.filter((p) => p.periodStart <= today).sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
}

export function isWithinPeriod(date: DateOnly, p: Pick<SettlementPeriod, "periodStart" | "periodEnd">): boolean {
  return date >= p.periodStart && date <= p.periodEnd;
}
