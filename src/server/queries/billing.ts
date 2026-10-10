import { todayBogota } from "@/domain/dates";
import { D, ZERO } from "@/domain/money";
import { C, col, type AdjustmentDoc, type AuditDoc, type CommitmentDoc, type InvoiceDoc, type ProjectDoc } from "@/store";
import type { InvoiceProjectRef } from "@/components/billing/dialogs";
import type { CurrencyCode } from "@/domain/money";
import { loadAllInvoices, loadAllProjects } from "../repo";
import { listProjects } from "./projects";

export interface CollectionRow {
  id: string;
  date: string;
  amountReceived: string;
  currency: "COP" | "USD" | "CLP" | "MXN";
  fxRate: string;
  amountCOP: string;
  isOverpaymentAdjustment: boolean;
  justification: string | null;
  notes: string | null;
  voided: boolean;
  voidReason: string | null;
  /** Ya fue liquidado en una liquidación cerrada: inmutable. */
  locked: boolean;
}

export interface InvoiceRow {
  id: string;
  projectId: string;
  projectCode: string;
  client: string;
  currency: "COP" | "USD" | "CLP" | "MXN";
  number: string | null;
  status: "PLANNED" | "ISSUED";
  issueDate: string | null;
  dueDate: string | null;
  amountPreTax: string;
  netBaseExplicit: string | null;
  /** Base neta comisionable de la factura (explícita o prorrateada), solo para mostrar. */
  netBaseEffective: string;
  notes: string | null;
  voided: boolean;
  voidReason: string | null;
  collected: string;
  balance: string;
  overdue: boolean;
  locked: boolean;
  collections: CollectionRow[];
}

export interface InvoiceFilters {
  projectId?: string;
  q?: string;
  state?: string; // planned | issued | pending | collected | overdue
  year?: string;
}

/** Ids de facturas y recaudos con comisiones ya liquidadas (a partir de los compromisos). */
async function loadLocks(): Promise<{ invoices: Set<string>; collections: Set<string> }> {
  const docs = (await col(C.commitments).get()).docs.map((d) => d.data() as CommitmentDoc);
  const invoices = new Set<string>();
  const collections = new Set<string>();
  for (const c of docs) {
    if (c.invoiceId) invoices.add(c.invoiceId);
    if (c.collectionId) collections.add(c.collectionId);
  }
  return { invoices, collections };
}

const byIssueDesc = (a: InvoiceDoc, b: InvoiceDoc) => (b.issueDate ?? "").localeCompare(a.issueDate ?? "") || b.createdAt.localeCompare(a.createdAt);

export async function listInvoices(filters: InvoiceFilters = {}): Promise<InvoiceRow[]> {
  const [allInvoices, projects, locks] = await Promise.all([loadAllInvoices(), loadAllProjects(), loadLocks()]);
  const byProject = new Map<string, ProjectDoc>(projects.map((p) => [p.id, p]));
  const today = todayBogota();
  const q = filters.q?.trim().toLowerCase();

  let docs = allInvoices.filter((i) => byProject.has(i.projectId));
  if (filters.projectId) docs = docs.filter((i) => i.projectId === filters.projectId);
  else docs = docs.filter((i) => !byProject.get(i.projectId)!.voidedAt);
  if (q) {
    docs = docs.filter((i) => {
      const p = byProject.get(i.projectId)!;
      return [i.number, p.code, p.client].some((v) => v?.toLowerCase().includes(q));
    });
  }
  docs = docs.sort(byIssueDesc).slice(0, 1000);

  let result = docs.map((i): InvoiceRow => {
    const p = byProject.get(i.projectId)!;
    const live = i.collections.filter((c) => !c.voidedAt);
    const collected = live.reduce((acc, c) => acc.plus(c.amountReceived), ZERO);
    const balance = D(i.amountPreTax).minus(collected);
    const ratio = D(p.saleAmount).isZero() ? ZERO : D(p.netBase).div(p.saleAmount);
    const effective = i.netBaseExplicit ? D(i.netBaseExplicit) : D(i.amountPreTax).mul(ratio);
    return {
      id: i.id,
      projectId: i.projectId,
      projectCode: p.code,
      client: p.client,
      currency: i.currency,
      number: i.number,
      status: i.status,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      amountPreTax: D(i.amountPreTax).toFixed(),
      netBaseExplicit: i.netBaseExplicit ? D(i.netBaseExplicit).toFixed() : null,
      netBaseEffective: effective.toDecimalPlaces(2).toFixed(),
      notes: i.notes,
      voided: Boolean(i.voidedAt),
      voidReason: i.voidReason,
      collected: collected.toFixed(),
      balance: balance.toFixed(),
      overdue: i.status === "ISSUED" && !i.voidedAt && balance.gt(0) && i.dueDate !== null && i.dueDate < today,
      locked: locks.invoices.has(i.id),
      collections: [...i.collections]
        .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
        .map((c) => ({
          id: c.id,
          date: c.date,
          amountReceived: D(c.amountReceived).toFixed(),
          currency: c.currency,
          fxRate: D(c.fxRate).toFixed(),
          amountCOP: D(c.amountCOP).toFixed(),
          isOverpaymentAdjustment: c.isOverpaymentAdjustment,
          justification: c.justification,
          notes: c.notes,
          voided: Boolean(c.voidedAt),
          voidReason: c.voidReason,
          locked: locks.collections.has(c.id),
        })),
    };
  });

  if (filters.year) result = result.filter((r) => (r.issueDate ?? "").startsWith(filters.year!));
  if (!filters.projectId) result = result.filter((r) => !r.voided);
  switch (filters.state) {
    case "planned": result = result.filter((r) => r.status === "PLANNED"); break;
    case "issued": result = result.filter((r) => r.status === "ISSUED"); break;
    case "pending": result = result.filter((r) => r.status === "ISSUED" && D(r.balance).gt(0)); break;
    case "collected": result = result.filter((r) => r.status === "ISSUED" && D(r.balance).lte(0)); break;
    case "overdue": result = result.filter((r) => r.overdue); break;
  }
  return result;
}

export interface AdjustmentRow {
  id: string;
  date: string;
  kind: "CREDIT_NOTE" | "DISCOUNT" | "CONTRACT_REDUCTION" | "PROVIDER_COST";
  reason: string;
  amount: string;
  currency: "COP" | "USD" | "CLP" | "MXN";
  status: "PENDING" | "APPLIED";
  invoiceNumber: string | null;
  voided: boolean;
  voidReason: string | null;
}

export async function listAdjustments(projectId: string): Promise<AdjustmentRow[]> {
  const [adjSnap, invSnap] = await Promise.all([
    col(C.adjustments).where("projectId", "==", projectId).get(),
    col(C.invoices).where("projectId", "==", projectId).get(),
  ]);
  const numbers = new Map(invSnap.docs.map((d) => [d.id, (d.data() as InvoiceDoc).number]));
  return adjSnap.docs
    .map((d) => d.data() as AdjustmentDoc)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .map((a) => ({
      id: a.id,
      date: a.date,
      kind: a.kind,
      reason: a.reason,
      amount: D(a.amount).toFixed(),
      currency: a.currency,
      status: a.status,
      invoiceNumber: a.invoiceId ? (numbers.get(a.invoiceId) ?? null) : null,
      voided: Boolean(a.voidedAt),
      voidReason: a.voidReason,
    }));
}

export interface AuditRow {
  id: string;
  at: string; // ISO
  entity: string;
  action: string;
  summary: string | null;
  user: string | null;
}

/** Historial de un proyecto: cambios en el proyecto, sus facturas, recaudos y ajustes. */
export async function projectHistory(projectId: string): Promise<AuditRow[]> {
  const [invSnap, adjSnap] = await Promise.all([
    col(C.invoices).where("projectId", "==", projectId).get(),
    col(C.adjustments).where("projectId", "==", projectId).get(),
  ]);
  const invoices = invSnap.docs.map((d) => d.data() as InvoiceDoc);
  const ids = [projectId, ...invoices.map((i) => i.id), ...invoices.flatMap((i) => i.collections.map((c) => c.id)), ...adjSnap.docs.map((d) => d.id)];

  // Firestore limita `in` a 30 valores: se consulta por tandas y se ordena en memoria.
  const rows: AuditDoc[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await col(C.auditLog).where("entityId", "in", ids.slice(i, i + 30)).get();
    rows.push(...snap.docs.map((d) => d.data() as AuditDoc));
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const top = rows.slice(0, 200);

  const names = new Map<string, string>();
  for (const uid of new Set(top.map((r) => r.userId).filter((x): x is string => Boolean(x)))) {
    const u = await col(C.users).doc(uid).get();
    if (u.exists) names.set(uid, (u.data() as { name: string }).name);
  }
  return top.map((r) => ({ id: r.id, at: r.createdAt, entity: r.entity, action: r.action, summary: r.summary, user: r.userId ? (names.get(r.userId) ?? null) : null }));
}

/** Proyectos con valor aún por facturar (para registrar facturas que faltan desde otras pantallas, p. ej. la revisión de una liquidación). */
export async function invoiceableProjects(): Promise<(InvoiceProjectRef & { client: string })[]> {
  const projects = await listProjects();
  const out: (InvoiceProjectRef & { client: string })[] = [];
  for (const p of projects) {
    const remaining = D(p.saleAmount).minus(p.fin.scheduled);
    if (!remaining.gt(0)) continue;
    out.push({ id: p.id, code: p.code, client: p.client, currency: p.currency as CurrencyCode, remainingToInvoice: remaining.toFixed(), pendingInvoices: Math.max(1, p.expectedInvoices - p.fin.invoiceCount) });
  }
  return out;
}
