import { projectEligibility, type EligibilityStatus } from "@/domain/eligibility";
import type { CountryCode } from "@/domain/countries";
import { D } from "@/domain/money";
import { projectFinancials, type BillingStatus, type CollectionStatus } from "@/domain/project-status";
import type { CollaboratorDoc, InvoiceDoc, MonthlySalesDoc, PolicyDoc, ProjectDoc } from "@/store";
import { groupInvoices, loadAllInvoices, loadAllProjects, loadCollaboratorDocs, loadGoals, loadMonthlySalesDocs, loadPolicyDocs } from "../repo";
import { computeMonthFacts } from "./common";
import type { GoalRow } from "@/domain/goals";

export interface ProjectAssignmentRow {
  id: string;
  collaboratorId: string;
  collaboratorName: string;
  policyCode: string;
  baseRate: string; // fracción
  effectiveRate: string | null;
  effectiveRateRule: string | null;
}

export interface ProjectRow {
  id: string;
  code: string;
  client: string;
  country: CountryCode;
  saleDate: string;
  saleMonth: string;
  currency: "COP" | "USD" | "CLP" | "MXN";
  saleAmount: string;
  providerCosts: string;
  netBase: string;
  saleReferenceRate: string;
  saleAmountCOP: string;
  expectedInvoices: number;
  notes: string | null;
  voided: boolean;
  voidReason: string | null;
  assignments: ProjectAssignmentRow[];
  eligibility: { status: EligibilityStatus; reason: string };
  fin: {
    issuedInvoices: number;
    plannedInvoices: number;
    pendingInvoices: number;
    invoiced: string;
    collected: string;
    pendingToInvoice: string;
    pendingCollection: string;
    /** Suma de facturas no anuladas (previstas + emitidas). */
    scheduled: string;
    invoiceCount: number;
    billingStatus: BillingStatus;
    collectionStatus: CollectionStatus;
  };
}

export interface ProjectFilters {
  q?: string;
  year?: string;
  country?: string;
  collaboratorId?: string;
  eligibility?: string;
  billing?: string; // "pending-invoice" | "pending-collection" | "done"
  showVoided?: boolean;
  id?: string;
}

interface World {
  projects: ProjectDoc[];
  invoices: Map<string, InvoiceDoc[]>;
  collaborators: Map<string, CollaboratorDoc>;
  policies: Map<string, PolicyDoc>;
  months: MonthlySalesDoc[];
  goals: GoalRow[];
}

async function loadWorld(): Promise<World> {
  const [projects, invoices, collaborators, policies, months, goals] = await Promise.all([
    loadAllProjects(),
    loadAllInvoices(),
    loadCollaboratorDocs(),
    loadPolicyDocs(),
    loadMonthlySalesDocs(),
    loadGoals(),
  ]);
  return {
    projects,
    invoices: groupInvoices(invoices),
    collaborators: new Map(collaborators.map((c) => [c.id, c])),
    policies: new Map(policies.map((p) => [p.id, p])),
    months,
    goals,
  };
}

export function toProjectRow(p: ProjectDoc, w: World, facts: ReturnType<typeof computeMonthFacts>): ProjectRow {
  const invoices = w.invoices.get(p.id) ?? [];
  const fin = projectFinancials(
    p.saleAmount,
    p.expectedInvoices,
    invoices.map((i) => ({
      status: i.status,
      amountPreTax: i.amountPreTax,
      voided: Boolean(i.voidedAt),
      collected: i.collections.filter((c) => !c.voidedAt).reduce((acc, c) => acc.plus(c.amountReceived), D(0)).toFixed(),
    })),
  );
  const month = facts.get(p.saleMonth);
  const eligibility = month ? projectEligibility(month) : { status: "PENDING_VALIDATION" as const, reason: "El mes de venta aún no tiene ventas registradas." };
  const live = invoices.filter((i) => !i.voidedAt);

  return {
    id: p.id,
    code: p.code,
    client: p.client,
    country: p.country,
    saleDate: p.saleDate,
    saleMonth: p.saleMonth,
    currency: p.currency,
    saleAmount: D(p.saleAmount).toFixed(),
    providerCosts: D(p.providerCosts).toFixed(),
    netBase: D(p.netBase).toFixed(),
    saleReferenceRate: D(p.saleReferenceRate).toFixed(),
    saleAmountCOP: D(p.saleAmountCOP).toFixed(),
    expectedInvoices: p.expectedInvoices,
    notes: p.notes,
    voided: Boolean(p.voidedAt),
    voidReason: p.voidReason,
    assignments: p.assignments
      .filter((a) => !a.removedAt)
      .map((a) => {
        const c = w.collaborators.get(a.collaboratorId);
        return {
          id: a.id,
          collaboratorId: a.collaboratorId,
          collaboratorName: c?.fullName ?? "(colaborador eliminado)",
          policyCode: c ? (w.policies.get(c.policyId)?.code ?? c.policyId) : "GENERAL",
          baseRate: D(a.baseRate).toFixed(),
          effectiveRate: a.effectiveRate === null ? null : D(a.effectiveRate).toFixed(),
          effectiveRateRule: a.effectiveRateRule,
        };
      }),
    eligibility,
    fin: {
      issuedInvoices: fin.issuedInvoices,
      plannedInvoices: fin.plannedInvoices,
      pendingInvoices: fin.pendingInvoices,
      invoiced: fin.invoiced.toFixed(),
      collected: fin.collected.toFixed(),
      pendingToInvoice: fin.pendingToInvoice.toFixed(),
      pendingCollection: fin.pendingCollection.toFixed(),
      scheduled: live.reduce((acc, i) => acc.plus(i.amountPreTax), D(0)).toFixed(),
      invoiceCount: live.length,
      billingStatus: fin.billingStatus,
      collectionStatus: fin.collectionStatus,
    },
  };
}

export async function listProjects(filters: ProjectFilters = {}): Promise<ProjectRow[]> {
  const w = await loadWorld();
  const facts = computeMonthFacts(w.projects, w.months, w.goals);
  const q = filters.q?.trim().toLowerCase();

  let docs = w.projects.filter((p) => {
    if (filters.id && p.id !== filters.id) return false;
    if (!filters.showVoided && p.voidedAt) return false;
    if (q && ![p.code, p.client].some((v) => v.toLowerCase().includes(q))) return false;
    if (filters.year && !p.saleMonth.startsWith(`${filters.year}-`)) return false;
    if (filters.country && p.country !== filters.country) return false;
    if (filters.collaboratorId && !p.collaboratorIds.includes(filters.collaboratorId)) return false;
    return true;
  });
  docs = docs.sort((a, b) => b.saleDate.localeCompare(a.saleDate) || b.code.localeCompare(a.code)).slice(0, 1000);

  let result = docs.map((p) => toProjectRow(p, w, facts));
  if (filters.eligibility) result = result.filter((r) => r.eligibility.status === filters.eligibility);
  if (filters.billing === "pending-invoice") result = result.filter((r) => r.fin.billingStatus !== "INVOICED");
  if (filters.billing === "pending-collection") result = result.filter((r) => r.fin.collectionStatus !== "COLLECTED" && r.fin.billingStatus !== "NOT_INVOICED");
  if (filters.billing === "done") result = result.filter((r) => r.fin.collectionStatus === "COLLECTED");
  return result;
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const [row] = await listProjects({ id, showVoided: true });
  return row ?? null;
}

export async function projectYears(): Promise<string[]> {
  const projects = await loadAllProjects();
  return Array.from(new Set(projects.map((p) => p.saleMonth.slice(0, 4)))).sort().reverse();
}

export async function existingProjectCodes(year: number): Promise<string[]> {
  return (await loadAllProjects()).filter((p) => p.code.startsWith(`HAP-${year}-`)).map((p) => p.code);
}

export interface FormContext {
  collaborators: { id: string; name: string; policyCode: string; active: boolean }[];
  months: Record<string, { salesCOP: string; goalCOP: string; status: "OPEN" | "VALIDATED" | "REOPENED" }>;
  defaultGoalCOP: string;
}

/** Datos auxiliares del formulario de proyectos: colaboradores y avance de la meta de cada mes (sin contar el proyecto editado). */
export async function projectFormContext(editing?: { saleMonth: string; saleAmountCOP: string }): Promise<FormContext> {
  const w = await loadWorld();
  const facts = computeMonthFacts(w.projects, w.months, w.goals);
  const months: FormContext["months"] = {};
  let defaultGoalCOP = "390000000";
  for (const [ym, f] of [...facts].sort(([a], [b]) => a.localeCompare(b))) {
    let sales = D(f.liveSalesCOP);
    if (editing && editing.saleMonth === ym) sales = sales.minus(editing.saleAmountCOP);
    months[ym] = { salesCOP: sales.toFixed(), goalCOP: String(f.liveGoalCOP), status: f.status };
    defaultGoalCOP = String(f.liveGoalCOP);
  }
  const collaborators = [...w.collaborators.values()]
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "es"))
    .map((c) => ({ id: c.id, name: c.fullName, policyCode: w.policies.get(c.policyId)?.code ?? c.policyId, active: c.status === "ACTIVE" }));
  return { collaborators, months, defaultGoalCOP };
}

export interface RateVersionRow {
  id: string;
  collaboratorName: string;
  baseRate: string;
  reason: string | null;
  at: string; // ISO
}

/** Historial de porcentajes base de cada asignación del proyecto (incluye asignaciones retiradas). */
export async function projectRateHistory(projectId: string): Promise<RateVersionRow[]> {
  const [projects, collaborators] = await Promise.all([loadAllProjects(), loadCollaboratorDocs()]);
  const project = projects.find((p) => p.id === projectId);
  if (!project) return [];
  const names = new Map(collaborators.map((c) => [c.id, c.fullName]));
  return project.assignments
    .flatMap((a) => a.versions.map((v, i) => ({ id: `${a.id}:${i}`, collaboratorName: names.get(a.collaboratorId) ?? "(colaborador eliminado)", baseRate: D(v.baseRate).toFixed(), reason: v.reason, at: v.createdAt })))
    .sort((a, b) => b.at.localeCompare(a.at));
}
