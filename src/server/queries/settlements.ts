import type { DateOnly } from "@/domain/dates";
import { D, ZERO } from "@/domain/money";
import { settlementPeriod, type SettlementHalf, type SettlementPeriod } from "@/domain/periods";
import type { AlertSeverity, CalcLine } from "@/domain/settlement";
import { C, col, linesCol, peopleCol, ref, type CollaboratorDoc, type PersonSettlementDoc, type SettlementDoc, type SettlementLineDoc, type SettlementReviewDoc } from "@/store";
import { plainReader } from "../commission-data";
import { personKey, prepareSettlement } from "../services/settlements";
import type { AckedAlert, AdminSnapshot, CollaboratorSnapshot, LineSnapshot } from "../services/settlement-types";

export function parseSettlementCode(code: string): { year: number; half: SettlementHalf } | null {
  const m = /^LIQ-(\d{4})-(04|10)$/.exec(code);
  return m ? { year: Number(m[1]), half: m[2] === "04" ? "APRIL" : "OCTOBER" } : null;
}

export interface LineView {
  key: string;
  type: "COLLECTION" | "ADJUSTMENT";
  projectId: string;
  projectCode: string;
  saleMonth: string;
  invoiceNumber: string | null;
  collectionDate: DateOnly | null;
  amountReceived: string | null;
  currency: string;
  fxRate: string;
  baseRate: string;
  effectiveRate: string;
  netBaseCOP: string;
  commissionCOP: string;
  isLate: boolean;
}

export interface PaymentView {
  id: string;
  paidAt: DateOnly;
  amount: string;
  reference: string;
  notes: string | null;
}

export interface CollaboratorView {
  collaboratorId: string;
  name: string;
  position: string;
  gross: string;
  adjustments: string;
  carryoverIn: string;
  netPayable: string;
  carryoverOut: string;
  /** Identificador de la liquidación individual (para registrar pagos). */
  csId: string | null;
  paymentStatus: "PENDING" | "PARTIAL" | "PAID" | null;
  paid: string;
  lines: LineView[];
  payments: PaymentView[];
}

export interface AlertView {
  key: string;
  severity: AlertSeverity | string;
  message: string;
  code?: string;
  projectId?: string;
}

export interface ProjectReviewLine {
  collaborator: string;
  type: "COLLECTION" | "ADJUSTMENT";
  invoiceNumber: string | null;
  collectionDate: DateOnly | null;
  amountReceived: string | null;
  currency: string;
  netBaseCOP: string;
  baseRate: string;
  effectiveRate: string;
  commissionCOP: string;
}

/** Un proyecto dentro de la liquidación, con su estado de revisión. */
export interface ProjectReviewView {
  projectId: string;
  projectCode: string;
  saleMonth: string;
  people: string[];
  lines: ProjectReviewLine[];
  total: string;
  fingerprint: string;
  /** ACCEPTED: revisado y sin cambios; STALE: se aceptó pero los datos cambiaron; PENDING: sin revisar. */
  review: "ACCEPTED" | "STALE" | "PENDING";
  acceptedAt: string | null;
  acceptedBy: string | null;
}

export interface SettlementView {
  period: SettlementPeriod;
  /** CLOSING: cierre por lotes interrumpido, pendiente de reanudar. */
  status: "NONE" | "DRAFT" | "CLOSING" | "APPROVED";
  settlementId: string | null;
  calculatedAt: string | null;
  approvedAt: string | null;
  approver: string | null;
  /** El borrador guardado ya no coincide con los datos actuales: conviene recalcular. */
  stale: boolean;
  alerts: AlertView[];
  collaborators: CollaboratorView[];
  grand: { gross: string; adjustments: string; netPayable: string };
  paidTotal: string;
  /** Revisión por proyecto (para aceptar que cada uno está bien antes de aprobar). */
  projects: ProjectReviewView[];
}

function lineViewFromCalc(l: CalcLine, i: number): LineView {
  return {
    key: `calc-${i}`,
    type: l.type,
    projectId: l.projectId,
    projectCode: l.detail.projectCode,
    saleMonth: l.detail.saleMonth,
    invoiceNumber: l.detail.invoiceNumber,
    collectionDate: l.detail.collectionDate,
    amountReceived: l.detail.amountReceived,
    currency: l.currency,
    fxRate: l.fxRate.toFixed(),
    baseRate: l.baseRate.toFixed(),
    effectiveRate: l.effectiveRate.toFixed(),
    netBaseCOP: l.netBaseCOP.toFixed(),
    commissionCOP: l.commissionCOP.toFixed(),
    isLate: l.isLate,
  };
}

async function userName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const s = await ref(C.users, id).get();
  return s.exists ? (s.data() as { name: string }).name : null;
}

async function loadStored(code: string) {
  const snap = await ref(C.settlements, code).get();
  if (!snap.exists) return null;
  const settlement = snap.data() as SettlementDoc;
  const [lines, people] = await Promise.all([
    linesCol(code).get().then((s) => s.docs.map((d) => d.data() as SettlementLineDoc)),
    peopleCol(code).get().then((s) => s.docs.map((d) => d.data() as PersonSettlementDoc)),
  ]);
  return { settlement, lines, people };
}

/** Vista de una liquidación: en borrador/sin calcular se calcula en vivo; aprobada se lee lo congelado. */
async function buildSettlementView(year: number, half: SettlementHalf): Promise<Omit<SettlementView, "projects">> {
  const period = settlementPeriod(year, half);
  const stored = await loadStored(period.code);

  if (stored?.settlement.status === "APPROVED") {
    const { settlement: s, lines, people } = stored;
    const collaborators: CollaboratorView[] = people
      .map((cs) => {
        const mine = lines.filter((l) => l.collaboratorId === cs.collaboratorId).map((l): LineView => {
          const sn = l.snapshot as LineSnapshot;
          return {
            key: l.id, type: l.type, projectId: l.projectId, projectCode: sn.projectCode, saleMonth: sn.saleMonth,
            invoiceNumber: sn.invoiceNumber, collectionDate: sn.collectionDate, amountReceived: sn.amountReceived, currency: l.currency, fxRate: D(l.fxRate).toFixed(),
            baseRate: D(l.baseRate).toFixed(), effectiveRate: D(l.effectiveRate).toFixed(), netBaseCOP: D(l.netBaseCOP).toFixed(), commissionCOP: D(l.commissionCOP).toFixed(), isLate: l.isLate,
          };
        });
        const snapshot = cs.snapshot as CollaboratorSnapshot;
        const paid = cs.payments.reduce((a, p) => a.plus(p.amount), ZERO);
        return {
          collaboratorId: cs.collaboratorId, name: snapshot.fullName, position: snapshot.position,
          gross: D(cs.grossCommission).toFixed(), adjustments: D(cs.adjustmentsTotal).toFixed(), carryoverIn: D(cs.carryoverIn).toFixed(),
          netPayable: D(cs.netPayable).toFixed(), carryoverOut: D(cs.carryoverOut).toFixed(), csId: personKey(s.code, cs.collaboratorId), paymentStatus: cs.paymentStatus, paid: paid.toFixed(),
          lines: mine,
          payments: [...cs.payments].sort((a, b) => a.paidAt.localeCompare(b.paidAt)).map((p) => ({ id: p.id, paidAt: p.paidAt, amount: D(p.amount).toFixed(), reference: p.reference, notes: p.notes })),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const acked = (s.acknowledgedAlerts as AckedAlert[] | null) ?? [];
    return {
      period, status: "APPROVED", settlementId: s.id, calculatedAt: s.calculatedAt, approvedAt: s.approvedAt,
      approver: await userName(s.approvedById), stale: false, alerts: acked.map((a) => ({ key: a.key, severity: a.severity, message: a.message })), collaborators,
      grand: { gross: D(s.totalGross).toFixed(), adjustments: D(s.totalAdjustments).toFixed(), netPayable: D(s.totalNet).toFixed() },
      paidTotal: collaborators.reduce((a, c) => a.plus(c.paid), ZERO).toFixed(),
    };
  }

  // Borrador o sin calcular: cálculo en vivo con el estado actual.
  const prepared = await prepareSettlement(plainReader, period);
  const { result } = prepared;
  const wanted = new Set(result.totals.map((t) => t.collaboratorId));
  const collabs = new Map(
    (await col(C.collaborators).get()).docs.map((d) => d.data() as CollaboratorDoc).filter((c) => wanted.has(c.id)).map((c) => [c.id, c]),
  );
  const collaborators: CollaboratorView[] = result.totals
    .map((t): CollaboratorView => ({
      collaboratorId: t.collaboratorId, name: collabs.get(t.collaboratorId)!.fullName, position: collabs.get(t.collaboratorId)!.position,
      gross: t.gross.toFixed(), adjustments: t.adjustments.toFixed(), carryoverIn: t.carryoverIn.toFixed(), netPayable: t.netPayable.toFixed(), carryoverOut: t.carryoverOut.toFixed(),
      csId: null, paymentStatus: null, paid: "0",
      lines: result.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.collaboratorId === t.collaboratorId).map(({ l, i }) => lineViewFromCalc(l, i)),
      payments: [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const s = stored?.settlement ?? null;
  const stale =
    stored !== null &&
    s !== null &&
    (!D(s.totalGross).equals(result.grand.gross.toDecimalPlaces(6)) || !D(s.totalNet).equals(result.grand.netPayable.toDecimalPlaces(6)) || stored.lines.length !== result.lines.length);

  return {
    period, status: s ? (s.status === "CLOSING" ? "CLOSING" : "DRAFT") : "NONE", settlementId: s?.id ?? null, calculatedAt: s?.calculatedAt ?? null, approvedAt: null, approver: null, stale,
    alerts: result.alerts.map((a) => ({ key: a.key, severity: a.severity, message: a.message, code: a.code, projectId: a.projectId })),
    collaborators,
    grand: { gross: result.grand.gross.toFixed(), adjustments: result.grand.adjustments.toFixed(), netPayable: result.grand.netPayable.toFixed() },
    paidTotal: "0",
  };
}

export interface SettlementListItem {
  period: SettlementPeriod;
  status: "NONE" | "DRAFT" | "CLOSING" | "APPROVED";
  totalNet: string | null;
  paid: string;
  pending: string;
  paymentState: "NONE" | "PENDING" | "PARTIAL" | "PAID";
}

export async function listSettlementStates(periods: SettlementPeriod[]): Promise<SettlementListItem[]> {
  const rows = (await col(C.settlements).get()).docs.map((d) => d.data() as SettlementDoc);
  const paidBy = new Map<string, ReturnType<typeof ZERO.plus>>();
  for (const s of rows) {
    const people = (await peopleCol(s.code).get()).docs.map((d) => d.data() as PersonSettlementDoc);
    paidBy.set(s.code, people.reduce((a, p) => a.plus(p.payments.reduce((x, pay) => x.plus(pay.amount), ZERO)), ZERO));
  }
  return periods.map((period) => {
    const s = rows.find((r) => r.year === period.year && r.half === period.half);
    if (!s) return { period, status: "NONE", totalNet: null, paid: "0", pending: "0", paymentState: "NONE" };
    const paid = paidBy.get(s.code) ?? ZERO;
    const net = D(s.totalNet);
    const state = s.status !== "APPROVED" ? "NONE" : net.isZero() ? "PAID" : paid.isZero() ? "PENDING" : paid.lt(net.minus("0.005")) ? "PARTIAL" : "PAID";
    return { period, status: s.status, totalNet: D(s.totalNet).toFixed(), paid: paid.toFixed(), pending: net.minus(paid).toFixed(), paymentState: state };
  });
}

// ───────────── Datos para los reportes (solo liquidaciones aprobadas) ─────────────

export interface ReportData {
  settlement: { id: string; code: string; label: string; period: SettlementPeriod; approvedAt: Date; approver: string | null; totalGross: string; totalAdjustments: string; totalNet: string };
  admin: AdminSnapshot;
  collaborators: {
    csId: string;
    collaboratorId: string;
    snapshot: CollaboratorSnapshot;
    gross: string;
    adjustments: string;
    carryoverIn: string;
    netPayable: string;
    carryoverOut: string;
    paymentStatus: "PENDING" | "PARTIAL" | "PAID";
    paid: string;
    lastPaymentDate: DateOnly | null;
    lines: { id: string; type: "COLLECTION" | "ADJUSTMENT"; baseRate: string; effectiveRate: string; netBaseCOP: string; commissionCOP: string; snapshot: LineSnapshot }[];
  }[];
  alerts: AckedAlert[];
}

export async function getReportData(code: string): Promise<ReportData | null> {
  const parsed = parseSettlementCode(code);
  if (!parsed) return null;
  const stored = await loadStored(code);
  if (!stored || stored.settlement.status !== "APPROVED" || !stored.settlement.approvedAt) return null;
  const { settlement: s, lines, people } = stored;
  const period = settlementPeriod(s.year, s.half);
  const collaborators: ReportData["collaborators"] = people
    .map((cs) => {
      const paid = cs.payments.reduce((a, p) => a.plus(p.amount), ZERO);
      const last = cs.payments.map((p) => p.paidAt).sort().at(-1) ?? null;
      return {
        csId: personKey(s.code, cs.collaboratorId), collaboratorId: cs.collaboratorId, snapshot: cs.snapshot as CollaboratorSnapshot,
        gross: D(cs.grossCommission).toFixed(), adjustments: D(cs.adjustmentsTotal).toFixed(), carryoverIn: D(cs.carryoverIn).toFixed(), netPayable: D(cs.netPayable).toFixed(), carryoverOut: D(cs.carryoverOut).toFixed(),
        paymentStatus: cs.paymentStatus, paid: paid.toFixed(), lastPaymentDate: last,
        lines: lines
          .filter((l) => l.collaboratorId === cs.collaboratorId)
          .map((l) => ({ id: l.id, type: l.type, baseRate: D(l.baseRate).toFixed(), effectiveRate: D(l.effectiveRate).toFixed(), netBaseCOP: D(l.netBaseCOP).toFixed(), commissionCOP: D(l.commissionCOP).toFixed(), snapshot: l.snapshot as LineSnapshot })),
      };
    })
    .sort((a, b) => a.snapshot.fullName.localeCompare(b.snapshot.fullName));
  return {
    settlement: { id: s.id, code: s.code, label: period.label, period, approvedAt: new Date(s.approvedAt as string), approver: await userName(s.approvedById), totalGross: D(s.totalGross).toFixed(), totalAdjustments: D(s.totalAdjustments).toFixed(), totalNet: D(s.totalNet).toFixed() },
    admin: s.adminSnapshot as AdminSnapshot,
    collaborators,
    alerts: (s.acknowledgedAlerts as AckedAlert[] | null) ?? [],
  };
}

export interface CollaboratorSettlementRow {
  code: string;
  paymentDate: DateOnly;
  netPayable: string;
  paymentStatus: "PENDING" | "PARTIAL" | "PAID";
}

/** Liquidaciones individuales de un colaborador (solo aprobadas), de reciente a antigua. */
export async function listCollaboratorSettlements(collaboratorId: string): Promise<CollaboratorSettlementRow[]> {
  const settlements = (await col(C.settlements).get()).docs.map((d) => d.data() as SettlementDoc).filter((s) => s.status === "APPROVED");
  const rows: CollaboratorSettlementRow[] = [];
  for (const s of settlements) {
    const snap = await peopleCol(s.code).doc(collaboratorId).get();
    if (!snap.exists) continue;
    const p = snap.data() as PersonSettlementDoc;
    rows.push({ code: s.code, paymentDate: s.paymentDate, netPayable: D(p.netPayable).toFixed(), paymentStatus: p.paymentStatus });
  }
  return rows.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
}

/** Huella de las líneas de un proyecto: cualquier cambio en cantidad, base o comisión invalida la aceptación. */
export function projectFingerprint(lines: { netBaseCOP: string; commissionCOP: string }[]): string {
  const base = lines.reduce((a, l) => a.plus(l.netBaseCOP), ZERO);
  const total = lines.reduce((a, l) => a.plus(l.commissionCOP), ZERO);
  return `${lines.length}|${base.toFixed(2)}|${total.toFixed(2)}`;
}

export async function projectReviews(collaborators: CollaboratorView[], code: string): Promise<ProjectReviewView[]> {
  const snap = await ref(C.settlementReviews, code).get();
  const doc = snap.exists ? (snap.data() as SettlementReviewDoc) : null;
  const groups = new Map<string, ProjectReviewView>();
  for (const c of collaborators) {
    for (const l of c.lines) {
      let g = groups.get(l.projectId);
      if (!g) {
        g = { projectId: l.projectId, projectCode: l.projectCode, saleMonth: l.saleMonth, people: [], lines: [], total: "0", fingerprint: "", review: "PENDING", acceptedAt: null, acceptedBy: null };
        groups.set(l.projectId, g);
      }
      if (!g.people.includes(c.name)) g.people.push(c.name);
      g.lines.push({ collaborator: c.name, type: l.type, invoiceNumber: l.invoiceNumber, collectionDate: l.collectionDate, amountReceived: l.amountReceived, currency: l.currency, netBaseCOP: l.netBaseCOP, baseRate: l.baseRate, effectiveRate: l.effectiveRate, commissionCOP: l.commissionCOP });
    }
  }
  const names = new Map<string, string | null>();
  const rows = [...groups.values()].sort((a, b) => a.projectCode.localeCompare(b.projectCode, undefined, { numeric: true }));
  for (const g of rows) {
    g.fingerprint = projectFingerprint(g.lines);
    g.total = g.lines.reduce((a, l) => a.plus(l.commissionCOP), ZERO).toFixed();
    const entry = doc?.projects[g.projectCode];
    if (entry) {
      g.review = entry.fingerprint === g.fingerprint ? "ACCEPTED" : "STALE";
      g.acceptedAt = entry.acceptedAt;
      if (entry.acceptedById && !names.has(entry.acceptedById)) names.set(entry.acceptedById, await userName(entry.acceptedById));
      g.acceptedBy = entry.acceptedById ? (names.get(entry.acceptedById) ?? null) : null;
    }
  }
  return rows;
}

export async function getSettlementView(year: number, half: SettlementHalf): Promise<SettlementView> {
  const view = await buildSettlementView(year, half);
  return { ...view, projects: await projectReviews(view.collaborators, view.period.code) };
}
