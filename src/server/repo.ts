import { D } from "@/domain/money";
import type { GoalRow } from "@/domain/goals";
import { C, col, type CollaboratorDoc, type InvoiceDoc, type MonthlySalesDoc, type PolicyDoc, type ProjectDoc } from "@/store";

/**
 * Lecturas completas de colecciones (no transaccionales). El volumen de la aplicación es pequeño (cientos de proyectos),
 * así que se cargan y se agregan en memoria con las funciones puras del dominio.
 */
const all = async <T>(name: Parameters<typeof col>[0]): Promise<T[]> => (await col(name).get()).docs.map((d) => d.data() as T);

export const loadAllProjects = () => all<ProjectDoc>(C.projects);
export const loadAllInvoices = () => all<InvoiceDoc>(C.invoices);
export const loadCollaboratorDocs = () => all<CollaboratorDoc>(C.collaborators);
export const loadPolicyDocs = () => all<PolicyDoc>(C.policies);
export const loadMonthlySalesDocs = () => all<MonthlySalesDoc>(C.monthlySales);

/** Facturas agrupadas por proyecto. */
export function groupInvoices(invoices: InvoiceDoc[]): Map<string, InvoiceDoc[]> {
  const map = new Map<string, InvoiceDoc[]>();
  for (const i of invoices) map.set(i.projectId, [...(map.get(i.projectId) ?? []), i]);
  return map;
}

/** Metas con vigencia, de más antigua a más reciente. */
export async function loadGoals(): Promise<GoalRow[]> {
  const docs = await all<{ effectiveFrom: string; amountCOP: string }>(C.goals);
  return docs.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).map((g) => ({ effectiveFrom: g.effectiveFrom, amount: D(g.amountCOP) }));
}

