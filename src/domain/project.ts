import { D, Decimal, type DecimalValue } from "./money";

export class DomainError extends Error {}

/**
 * Base comisionable = venta antes de IVA − costos de proveedores (sin IVA).
 * Nunca puede ser negativa.
 */
export function computeNetBase(saleAmount: DecimalValue, providerCosts: DecimalValue): Decimal {
  const base = D(saleAmount).minus(providerCosts);
  if (base.isNegative()) {
    throw new DomainError("Los costos de proveedores no pueden superar el valor de la venta.");
  }
  return base;
}

/** Venta convertida a COP con la tasa de referencia (TRM del día de la venta). COP → tasa 1. */
export function saleAmountInCOP(saleAmount: DecimalValue, currency: string, referenceRate: DecimalValue): Decimal {
  return currency === "COP" ? D(saleAmount) : D(saleAmount).mul(referenceRate);
}

/** Código sugerido para un proyecto: HAP-2026-001 */
export function suggestProjectCode(year: number, existingCodes: string[]): string {
  const prefix = `HAP-${year}-`;
  const max = existingCodes
    .filter((c) => c.startsWith(prefix))
    .map((c) => Number(c.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}
