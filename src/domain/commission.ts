import { D, Decimal, type DecimalValue, ZERO } from "./money";

/**
 * Cálculo de la comisión de un recaudo (Reglas 2, 4 y 5).
 *
 *   base neta del recaudo = valor recaudado (sin IVA) × (base efectiva de la factura / valor efectivo de la factura)
 *                           acotada para que lo comisionado de la factura nunca supere su base efectiva
 *   comisión (moneda)     = base neta del recaudo × porcentaje efectivo
 *   comisión (COP)        = comisión (moneda) × TRM del día del recaudo
 *
 * Base de la factura = la fijada explícitamente o, por defecto, la prorrata (base neta del proyecto / venta).
 *
 * Ajustes (reducen la base comisionable):
 *   - Notas crédito, descuentos y reducciones contractuales reducen el VALOR de la factura y su base en la misma cuantía
 *     (el cliente deja de deber ese valor, de modo que no se cuenta dos veces).
 *   - Los ajustes de costos de proveedores reducen solo la base.
 *   - Un ajuste sin factura se reparte entre las facturas del proyecto en proporción a su valor, respetando el tope de
 *     base disponible de cada una (el sobrante se redistribuye).
 *
 * No hay redondeo de negocio (decisión D8).
 */

export interface ProjectBase {
  saleAmount: DecimalValue;
  netBase: DecimalValue;
}

export interface InvoiceBase {
  id: string;
  amountPreTax: DecimalValue;
  netBaseExplicit?: DecimalValue | null;
}

export type AdjustmentKind = "CREDIT_NOTE" | "DISCOUNT" | "CONTRACT_REDUCTION" | "PROVIDER_COST";

export interface AdjustmentFact {
  id: string;
  /** Nulo = afecta a todo el proyecto. */
  invoiceId: string | null;
  /** Reducción de la base, positiva. */
  amount: DecimalValue;
  status: "PENDING" | "APPLIED";
  /** Si falta se asume una reducción de ingresos (nota crédito). */
  kind?: AdjustmentKind;
}

const reducesRevenue = (a: AdjustmentFact) => (a.kind ?? "CREDIT_NOTE") !== "PROVIDER_COST";

/** Base neta de una factura antes de ajustes. */
export function invoiceBaseNet(inv: InvoiceBase, project: ProjectBase): Decimal {
  if (inv.netBaseExplicit !== null && inv.netBaseExplicit !== undefined) return D(inv.netBaseExplicit);
  const sale = D(project.saleAmount);
  return sale.isZero() ? ZERO : D(inv.amountPreTax).mul(project.netBase).div(sale);
}

export interface InvoiceState {
  /** Valor efectivo de la factura (tras notas crédito y descuentos). */
  amount: Decimal;
  /** Base comisionable efectiva. */
  base: Decimal;
}

export interface AdjustmentResult {
  states: Map<string, InvoiceState>;
  /** Reducción de base que cada ajuste causó en cada factura (ya acotada). */
  reductions: Map<string, Map<string, Decimal>>;
}

/** Aplica los ajustes en el orden recibido y devuelve el estado efectivo de cada factura. */
export function applyAdjustments(project: ProjectBase, invoices: InvoiceBase[], adjustments: AdjustmentFact[]): AdjustmentResult {
  const states = new Map<string, InvoiceState>();
  for (const inv of invoices) states.set(inv.id, { amount: D(inv.amountPreTax), base: invoiceBaseNet(inv, project) });
  const reductions = new Map<string, Map<string, Decimal>>();

  const capacity = (st: InvoiceState, revenue: boolean) => Decimal.max(ZERO, revenue ? Decimal.min(st.base, st.amount) : st.base);
  const apply = (adjId: string, invId: string, revenue: boolean, r: Decimal) => {
    const st = states.get(invId)!;
    st.base = st.base.minus(r);
    if (revenue) st.amount = st.amount.minus(r);
    const m = reductions.get(adjId) ?? new Map<string, Decimal>();
    m.set(invId, (m.get(invId) ?? ZERO).plus(r));
    reductions.set(adjId, m);
  };

  for (const adj of adjustments) {
    const revenue = reducesRevenue(adj);
    if (adj.invoiceId !== null) {
      if (!states.has(adj.invoiceId)) continue;
      const r = Decimal.min(D(adj.amount), capacity(states.get(adj.invoiceId)!, revenue));
      if (r.gt(0)) apply(adj.id, adj.invoiceId, revenue, r);
      continue;
    }
    // Ajuste de proyecto: reparto proporcional al valor de cada factura con redistribución del sobrante.
    let left = D(adj.amount);
    let active = invoices.filter((i) => capacity(states.get(i.id)!, revenue).gt(0));
    for (let guard = 0; guard <= invoices.length && left.gt(0) && active.length > 0; guard++) {
      const totalWeight = active.reduce((acc, i) => acc.plus(i.amountPreTax), ZERO);
      let assigned = ZERO;
      for (const inv of active) {
        const weight = totalWeight.isZero() ? D(1).div(active.length) : D(inv.amountPreTax).div(totalWeight);
        const r = Decimal.min(left.mul(weight), capacity(states.get(inv.id)!, revenue));
        if (r.gt(0)) {
          apply(adj.id, inv.id, revenue, r);
          assigned = assigned.plus(r);
        }
      }
      left = left.minus(assigned);
      if (assigned.isZero()) break;
      active = active.filter((i) => capacity(states.get(i.id)!, revenue).gt(0));
    }
  }
  return { states, reductions };
}

export interface CollectionBase {
  id: string;
  date: string;
  amountReceived: DecimalValue;
}

/**
 * Base comisionable de cada recaudo de una factura, en orden cronológico. La suma nunca supera la base efectiva de la
 * factura (un recaudo con excedente o posterior a una nota crédito no puede comisionar más allá de ella).
 */
export function collectionBases(state: InvoiceState, collections: CollectionBase[]): Map<string, Decimal> {
  const ordered = [...collections].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const ratio = state.amount.gt(0) ? Decimal.max(ZERO, state.base).div(state.amount) : ZERO;
  let remaining = Decimal.max(ZERO, state.base);
  const out = new Map<string, Decimal>();
  for (const c of ordered) {
    const b = Decimal.min(D(c.amountReceived).mul(ratio), remaining);
    out.set(c.id, b);
    remaining = remaining.minus(b);
  }
  return out;
}

export interface CollectionCommission {
  netBaseOriginal: Decimal;
  netBaseCOP: Decimal;
  commissionOriginal: Decimal;
  commissionCOP: Decimal;
}

export function collectionCommission(args: {
  /** Base neta comisionable del recaudo, en la moneda del proyecto (ver collectionBases). */
  netBaseOriginal: DecimalValue;
  effectiveRate: DecimalValue;
  /** TRM del día del recaudo; 1 para COP. */
  fxRate: DecimalValue;
}): CollectionCommission {
  const netBaseOriginal = D(args.netBaseOriginal);
  const commissionOriginal = netBaseOriginal.mul(args.effectiveRate);
  return {
    netBaseOriginal,
    netBaseCOP: netBaseOriginal.mul(args.fxRate),
    commissionOriginal,
    commissionCOP: commissionOriginal.mul(args.fxRate),
  };
}

export interface ProjectCommissionFacts extends ProjectBase {
  currency: string;
  /** TRM de referencia de la venta (1 para COP). Solo para estimar el potencial. */
  saleReferenceRate: DecimalValue;
  invoices: (InvoiceBase & {
    status: "PLANNED" | "ISSUED";
    voided: boolean;
    collections: { id: string; date: string; amountReceived: DecimalValue; fxRate: DecimalValue; voided: boolean }[];
  })[];
  adjustments: (AdjustmentFact & { voided: boolean })[];
}

export interface AssignmentCommissionSummary {
  /** Comisión potencial estimada (COP): % efectivo × base ajustada del proyecto × TRM de referencia. Nula si el mes no está validado. */
  potentialCOP: Decimal | null;
  /** Cota superior mientras el mes no está validado: % base × base ajustada. */
  potentialIfEligibleCOP: Decimal;
  /** Comisión efectivamente generada por los recaudos recibidos (COP). */
  generatedCOP: Decimal;
  /** Detalle por recaudo (para filtrar por período). */
  collections: { collectionId: string; date: string; commissionCOP: Decimal }[];
}

/**
 * Resumen de una asignación. Las categorías están anidadas, no son sumables:
 * potencial ⊇ generada (lo recaudado) ⊇ liquidada ⊇ pagada.
 */
export function assignmentSummary(
  project: ProjectCommissionFacts,
  baseRate: DecimalValue,
  effectiveRate: DecimalValue | null,
): AssignmentCommissionSummary {
  const liveInvoices = project.invoices.filter((i) => !i.voided);
  const adjustments = project.adjustments.filter((a) => !a.voided);
  const { states, reductions } = applyAdjustments(project, liveInvoices, [...adjustments.filter((a) => a.status === "APPLIED"), ...adjustments.filter((a) => a.status === "PENDING")]);

  let totalReduction = ZERO;
  for (const m of reductions.values()) for (const r of m.values()) totalReduction = totalReduction.plus(r);
  const adjustedBase = Decimal.max(ZERO, D(project.netBase).minus(totalReduction));
  const fx = project.currency === "COP" ? D(1) : D(project.saleReferenceRate);

  let generated = ZERO;
  const detail: AssignmentCommissionSummary["collections"] = [];
  for (const inv of liveInvoices) {
    if (inv.status !== "ISSUED" || effectiveRate === null) continue;
    const live = inv.collections.filter((c) => !c.voided);
    const bases = collectionBases(states.get(inv.id)!, live);
    for (const c of live) {
      const commissionCOP = collectionCommission({ netBaseOriginal: bases.get(c.id)!, effectiveRate, fxRate: c.fxRate }).commissionCOP;
      generated = generated.plus(commissionCOP);
      detail.push({ collectionId: c.id, date: c.date, commissionCOP });
    }
  }

  return {
    potentialCOP: effectiveRate === null ? null : adjustedBase.mul(effectiveRate).mul(fx),
    potentialIfEligibleCOP: adjustedBase.mul(baseRate).mul(fx),
    generatedCOP: generated,
    collections: detail,
  };
}
