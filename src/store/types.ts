/**
 * Documentos de Firestore. Convenciones (ver docs/05-migracion-firestore.md):
 *  - Dinero, tasas y porcentajes: TEXTO decimal ("1500000.50"); se calculan con decimal.js, nunca con `number`.
 *  - Fechas de negocio: "YYYY-MM-DD" (fecha civil de Colombia). Instantes: texto ISO-8601 en UTC (ordenable).
 *  - Cada documento guarda su propio `id`.
 */
export type Iso = string;
export type DateOnly = string;
export type Money = string;
export type Currency = "COP" | "USD" | "CLP" | "MXN";
export type Country = "CO" | "CL" | "MX";

export interface Stamped {
  createdAt: Iso;
  updatedAt: Iso;
  createdById: string | null;
  updatedById: string | null;
}

export interface Voidable {
  voidedAt: Iso | null;
  voidedById: string | null;
  voidReason: string | null;
}

// ───────────── Acceso y configuración ─────────────

export interface UserDoc {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: "ADMIN";
  createdAt: Iso;
}

export interface PolicyTierDoc {
  /** Cumplimiento mínimo (inclusivo), como fracción: "0.7". */
  min: string;
  factor: string;
  effectiveFrom: DateOnly;
}

export interface PolicyDoc {
  id: string; // = code
  code: "GENERAL" | "GAMIFICATION";
  name: string;
  kind: "GENERAL_THRESHOLD" | "GAMIFICATION_TIERS";
  tiers: PolicyTierDoc[];
}

export interface GoalDoc {
  id: string; // = effectiveFrom
  amountCOP: Money;
  effectiveFrom: DateOnly;
  createdAt: Iso;
  createdById: string | null;
}

export interface ExchangeRateDoc {
  id: string; // `${currency}_${date}`
  currency: Exclude<Currency, "COP">;
  date: DateOnly;
  rate: string;
  source: string | null;
  notes: string | null;
  createdAt: Iso;
  createdById: string | null;
}

export interface CollaboratorDoc extends Stamped {
  id: string;
  fullName: string;
  email: string;
  position: string;
  status: "ACTIVE" | "INACTIVE";
  /** Código de la política (GENERAL / GAMIFICATION). */
  policyId: PolicyDoc["code"];
  joinDate: DateOnly | null;
  notes: string | null;
}

/** Índice de unicidad (correo de colaborador, número de factura por proyecto…). */
export interface UniqueDoc {
  id: string;
  key: string;
  ref: string;
  createdAt: Iso;
}

// ───────────── Ventas y proyectos ─────────────

export interface MonthlySalesDoc {
  id: string; // = yearMonth
  yearMonth: string;
  status: "OPEN" | "VALIDATED" | "REOPENED";
  manualAdjustmentCOP: Money;
  manualAdjustmentNote: string | null;
  validatedSalesCOP: Money | null;
  goalSnapshotCOP: Money | null;
  achievementRatio: string | null;
  outcome: "ELIGIBLE" | "NOT_ELIGIBLE" | null;
  outcomeReason: string | null;
  validatedAt: Iso | null;
  validatedById: string | null;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface AssignmentVersionDoc {
  baseRate: string;
  reason: string | null;
  createdAt: Iso;
  createdById: string | null;
}

export interface AssignmentDoc {
  id: string;
  collaboratorId: string;
  baseRate: string;
  effectiveRate: string | null;
  effectiveRateRule: string | null;
  removedAt: Iso | null;
  removedReason: string | null;
  versions: AssignmentVersionDoc[];
  createdAt: Iso;
}

export interface ProjectDoc extends Stamped, Voidable {
  id: string; // = code
  code: string;
  name: string;
  client: string;
  country: Country;
  saleDate: DateOnly;
  saleMonth: string;
  currency: Currency;
  saleAmount: Money;
  providerCosts: Money;
  netBase: Money;
  saleReferenceRate: string;
  saleAmountCOP: Money;
  expectedInvoices: number;
  notes: string | null;
  assignments: AssignmentDoc[];
  /** Derivado de `assignments` (para consultas `array-contains`): colaboradores con asignación ACTIVA. */
  collaboratorIds: string[];
  /** Derivado: todos los colaboradores que alguna vez tuvieron asignación (incluye retirados). */
  everAssignedIds: string[];
}

// ───────────── Facturas, recaudos y ajustes ─────────────

export interface CollectionDoc extends Voidable {
  id: string;
  date: DateOnly;
  amountReceived: Money;
  currency: Currency;
  fxRate: string;
  amountCOP: Money;
  isOverpaymentAdjustment: boolean;
  justification: string | null;
  notes: string | null;
  createdAt: Iso;
  updatedAt: Iso;
  createdById: string | null;
  updatedById: string | null;
}

export interface InvoiceDoc extends Stamped, Voidable {
  id: string;
  projectId: string;
  number: string | null;
  issueDate: DateOnly | null;
  currency: Currency;
  amountPreTax: Money;
  netBaseExplicit: Money | null;
  status: "PLANNED" | "ISSUED";
  dueDate: DateOnly | null;
  notes: string | null;
  collections: CollectionDoc[];
  /** Derivado de `collections` (para buscar un recaudo por id con `array-contains`). */
  collectionIds: string[];
}

export interface AdjustmentDoc extends Voidable {
  id: string;
  projectId: string;
  invoiceId: string | null;
  date: DateOnly;
  kind: "CREDIT_NOTE" | "DISCOUNT" | "CONTRACT_REDUCTION" | "PROVIDER_COST";
  reason: string;
  amount: Money;
  currency: Currency;
  status: "PENDING" | "APPLIED";
  appliedInSettlementId: string | null;
  createdAt: Iso;
  createdById: string | null;
}

// ───────────── Liquidaciones ─────────────

export interface SettlementDoc {
  id: string; // = code
  code: string;
  year: number;
  half: "APRIL" | "OCTOBER";
  periodStart: DateOnly;
  periodEnd: DateOnly;
  paymentDate: DateOnly;
  /** CLOSING = cierre por lotes en curso (bloquea el resto de las escrituras de negocio). */
  status: "DRAFT" | "CLOSING" | "APPROVED";
  totalGross: Money;
  totalAdjustments: Money;
  totalNet: Money;
  calculatedAt: Iso | null;
  approvedAt: Iso | null;
  approvedById: string | null;
  acknowledgedAlerts: unknown;
  adminSnapshot: unknown;
  closingId: string | null;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface SettlementLineDoc {
  id: string; // `${recaudo|ajuste}__${asignación}`
  settlementCode: string;
  collaboratorId: string;
  projectId: string;
  assignmentId: string;
  invoiceId: string | null;
  collectionId: string | null;
  adjustmentId: string | null;
  type: "COLLECTION" | "ADJUSTMENT";
  baseRate: string;
  effectiveRate: string;
  currency: Currency;
  fxRate: string;
  netBaseOriginal: Money;
  netBaseCOP: Money;
  commissionCOP: Money;
  isLate: boolean;
  committed: boolean;
  snapshot: unknown;
  createdAt: Iso;
}

export interface PaymentDoc {
  id: string;
  paidAt: DateOnly;
  amount: Money;
  reference: string;
  notes: string | null;
  createdAt: Iso;
  createdById: string | null;
}

export interface PersonSettlementDoc {
  id: string; // = collaboratorId
  settlementCode: string;
  collaboratorId: string;
  grossCommission: Money;
  adjustmentsTotal: Money;
  carryoverIn: Money;
  netPayable: Money;
  carryoverOut: Money;
  paymentStatus: "PENDING" | "PARTIAL" | "PAID";
  snapshot: unknown;
  payments: PaymentDoc[];
  createdAt: Iso;
  updatedAt: Iso;
}

/** Clave anti pago doble: un recaudo (o ajuste) solo puede liquidarse una vez por asignación. */
export interface CommitmentDoc {
  id: string; // `${recaudo|ajuste}__${asignación}`
  type: "COLLECTION" | "ADJUSTMENT";
  collectionId: string | null;
  adjustmentId: string | null;
  assignmentId: string;
  invoiceId: string | null;
  projectId: string;
  collaboratorId: string;
  settlementCode: string;
  lineId: string;
  commissionCOP: Money;
  committedAt: Iso;
}

// ───────────── Trazabilidad ─────────────

export interface GeneratedReportDoc {
  id: string;
  settlementCode: string;
  collaboratorId: string | null;
  kind: "INDIVIDUAL_PDF" | "ADMIN_PDF" | "ADMIN_XLSX";
  sha256: string;
  generatedAt: Iso;
}

export interface AuditDoc {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  summary: string | null;
  before: unknown;
  after: unknown;
  userId: string | null;
  createdAt: Iso;
}

export interface LoginThrottleDoc {
  id: string; // clave codificada
  key: string;
  count: number;
  windowStart: Iso;
}

/** Estado global (documento `system/state`). */
export interface SystemStateDoc {
  id: "state";
  closing: { settlementCode: string; closingId: string; startedAt: Iso } | null;
  updatedAt: Iso;
}
