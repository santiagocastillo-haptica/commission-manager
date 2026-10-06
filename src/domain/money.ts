import Decimal from "decimal.js";

// Precisión alta y redondeo explícito. El negocio NO redondea comisiones (decisión D8);
// el redondeo solo ocurre al mostrar en pantalla.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type DecimalValue = Decimal.Value;

export const D = (value: DecimalValue): Decimal => new Decimal(value);
export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);

export function sum(values: Iterable<DecimalValue>): Decimal {
  let total = ZERO;
  for (const v of values) total = total.plus(v);
  return total;
}

export const CURRENCIES = ["COP", "USD", "CLP", "MXN"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

const SYMBOL: Record<CurrencyCode, string> = { COP: "$", USD: "USD", CLP: "CLP", MXN: "MXN" };

/** Inserta separador de miles (.) en la parte entera de un número en texto. */
function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Formato es-CO: miles con punto, decimales con coma. Usa aritmética decimal (sin pasar por `number`).
 * `decimals` solo afecta lo que se muestra; el valor almacenado no se redondea.
 */
export function formatMoney(
  value: DecimalValue | null | undefined,
  currency: CurrencyCode = "COP",
  decimals = 2,
): string {
  if (value === null || value === undefined) return "—";
  const d = D(value);
  const fixed = d.abs().toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const body = frac ? `${groupThousands(int)},${frac}` : groupThousands(int);
  const sign = d.isNegative() && !d.isZero() && /[1-9]/.test(fixed) ? "-" : "";
  return `${sign}${SYMBOL[currency]} ${body}`;
}

/** Pesos sin decimales (para KPIs y ejes). */
export const formatCOP0 = (v: DecimalValue | null | undefined) => formatMoney(v, "COP", 0);

/** Millones abreviados para gráficos: 390.000.000 → "$390 M". */
export function formatMillions(value: DecimalValue): string {
  const m = D(value).div(1_000_000);
  const txt = m.abs().lt(10) ? m.toFixed(1) : m.toFixed(0);
  return `$${txt.replace(".", ",")} M`;
}

export function formatPercent(fraction: DecimalValue | null | undefined, decimals = 2): string {
  if (fraction === null || fraction === undefined) return "—";
  return `${D(fraction).mul(100).toFixed(decimals).replace(".", ",")} %`;
}

/**
 * Interpreta texto escrito por una persona en formato es-CO ("1.500.000,50") o ya canónico ("1500000.5").
 * Devuelve la cadena canónica con punto decimal, o null si no es un número válido.
 */
export function parseNumberInput(raw: string): string | null {
  const s = raw.trim().replace(/\s/g, "");
  if (s === "") return null;
  let canonical: string;
  if (s.includes(",")) {
    canonical = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    canonical = s.replace(/\./g, ""); // "1.500.000" son miles
  } else {
    canonical = s;
  }
  return /^-?\d+(\.\d+)?$/.test(canonical) ? canonical : null;
}
