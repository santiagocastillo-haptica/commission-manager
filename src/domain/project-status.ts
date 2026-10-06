import { D, Decimal, type DecimalValue, ZERO } from "./money";

/** Estado de facturación y recaudo de un proyecto. Siempre se DERIVA de facturas y recaudos; nunca se edita a mano. */

export interface InvoiceFacts {
  status: "PLANNED" | "ISSUED";
  amountPreTax: DecimalValue;
  voided: boolean;
  /** Suma de recaudos no anulados de la factura (sin IVA). */
  collected: DecimalValue;
}

export type BillingStatus = "NOT_INVOICED" | "PARTIAL" | "INVOICED";
export type CollectionStatus = "NONE" | "PARTIAL" | "COLLECTED";

export interface ProjectFinancials {
  expectedInvoices: number;
  issuedInvoices: number;
  plannedInvoices: number;
  pendingInvoices: number;
  invoiced: Decimal;
  collected: Decimal;
  pendingToInvoice: Decimal;
  pendingCollection: Decimal;
  billingStatus: BillingStatus;
  collectionStatus: CollectionStatus;
}

export function projectFinancials(
  saleAmount: DecimalValue,
  expectedInvoices: number,
  invoices: InvoiceFacts[],
): ProjectFinancials {
  const live = invoices.filter((i) => !i.voided);
  const issued = live.filter((i) => i.status === "ISSUED");
  const planned = live.filter((i) => i.status === "PLANNED");

  let invoiced = ZERO;
  let collected = ZERO;
  for (const i of issued) {
    invoiced = invoiced.plus(i.amountPreTax);
    collected = collected.plus(i.collected);
  }

  const sale = D(saleAmount);
  const billingStatus: BillingStatus = issued.length === 0 ? "NOT_INVOICED" : invoiced.gte(sale) ? "INVOICED" : "PARTIAL";
  const collectionStatus: CollectionStatus = collected.isZero() ? "NONE" : collected.gte(sale) ? "COLLECTED" : "PARTIAL";

  return {
    expectedInvoices,
    issuedInvoices: issued.length,
    plannedInvoices: planned.length,
    pendingInvoices: Math.max(0, expectedInvoices - issued.length),
    invoiced,
    collected,
    pendingToInvoice: Decimal.max(ZERO, sale.minus(invoiced)),
    pendingCollection: Decimal.max(ZERO, invoiced.minus(collected)),
    billingStatus,
    collectionStatus,
  };
}

export const BILLING_LABEL: Record<BillingStatus, string> = {
  NOT_INVOICED: "Sin facturar",
  PARTIAL: "Facturación parcial",
  INVOICED: "Facturado",
};

export const COLLECTION_LABEL: Record<CollectionStatus, string> = {
  NONE: "Sin recaudo",
  PARTIAL: "Recaudo parcial",
  COLLECTED: "Recaudado",
};
