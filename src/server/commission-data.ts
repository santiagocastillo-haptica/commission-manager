import type { Query, QuerySnapshot } from "firebase-admin/firestore";
import type { DateOnly } from "@/domain/dates";
import type { SettlementProject } from "@/domain/settlement";
import { C, col, type AdjustmentDoc, type InvoiceDoc, type ProjectDoc, type Tx } from "@/store";

export type LoadedProject = SettlementProject & { saleReferenceRate: string; saleDate: DateOnly; client: string };

/** Lector de consultas: con transacción (lecturas consistentes y bloqueadas) o sin ella. */
export interface Reader {
  get(q: Query): Promise<QuerySnapshot>;
}
export const plainReader: Reader = { get: (q) => q.get() };
export const txReader = (tx: Tx): Reader => ({ get: (q) => tx.get(q) });

export async function readAll<T>(r: Reader, name: Parameters<typeof col>[0]): Promise<T[]> {
  return (await r.get(col(name))).docs.map((d) => d.data() as T);
}

/** Construye la vista de cálculo de comisiones a partir de los documentos (función pura). */
export function buildCommissionProjects(
  projects: ProjectDoc[],
  invoices: InvoiceDoc[],
  adjustments: AdjustmentDoc[],
  filter: { projectId?: string; collaboratorId?: string } = {},
): LoadedProject[] {
  const invByProject = new Map<string, InvoiceDoc[]>();
  for (const i of invoices) invByProject.set(i.projectId, [...(invByProject.get(i.projectId) ?? []), i]);
  const adjByProject = new Map<string, AdjustmentDoc[]>();
  for (const a of adjustments) adjByProject.set(a.projectId, [...(adjByProject.get(a.projectId) ?? []), a]);

  return projects
    .filter((p) => !p.voidedAt)
    .filter((p) => !filter.projectId || p.id === filter.projectId)
    .filter((p) => !filter.collaboratorId || p.collaboratorIds.includes(filter.collaboratorId))
    .map((p) => ({
      id: p.id,
      code: p.code,
      client: p.client,
      currency: p.currency,
      saleAmount: p.saleAmount,
      netBase: p.netBase,
      saleReferenceRate: p.saleReferenceRate,
      saleDate: p.saleDate,
      saleMonth: p.saleMonth,
      voided: false,
      assignments: p.assignments.filter((a) => !a.removedAt).map((a) => ({ id: a.id, collaboratorId: a.collaboratorId, baseRate: a.baseRate, effectiveRate: a.effectiveRate })),
      invoices: (invByProject.get(p.id) ?? []).map((i) => ({
        id: i.id,
        number: i.number,
        status: i.status,
        issueDate: i.issueDate,
        amountPreTax: i.amountPreTax,
        netBaseExplicit: i.netBaseExplicit,
        voided: Boolean(i.voidedAt),
        collections: i.collections.map((c) => ({ id: c.id, date: c.date, amountReceived: c.amountReceived, currency: c.currency, fxRate: c.fxRate, voided: Boolean(c.voidedAt) })),
      })),
      adjustments: (adjByProject.get(p.id) ?? []).map((a) => ({ id: a.id, invoiceId: a.invoiceId, amount: a.amount, status: a.status, kind: a.kind, voided: Boolean(a.voidedAt) })),
    }));
}

/** Todos los proyectos con lo necesario para calcular comisiones (asignaciones activas, facturas, recaudos y ajustes). */
export async function loadCommissionProjectsWith(r: Reader, filter: { projectId?: string; collaboratorId?: string } = {}): Promise<LoadedProject[]> {
  const [projects, invoices, adjustments] = await Promise.all([
    readAll<ProjectDoc>(r, C.projects),
    readAll<InvoiceDoc>(r, C.invoices),
    readAll<AdjustmentDoc>(r, C.adjustments),
  ]);
  return buildCommissionProjects(projects, invoices, adjustments, filter);
}
