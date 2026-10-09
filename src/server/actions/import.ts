"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { COUNTRY_CODES } from "@/domain/countries";
import { fail, ok, toFailure, type ActionResult } from "@/server/action-result";
import { requireSession } from "../auth";
import { parseHistoryWorkbook, sortIssues, type HistoryIssue, type HistoryPayment, type HistoryProject } from "../import/history";
import {
  collaboratorsByEmail, comparePayments, importProject, validateClosedMonths,
  type ImportProjectResult, type PaymentComparison, type ValidateMonthsResult,
} from "../import/history-load";

const MAX_BYTES = 10 * 1024 * 1024;

export interface HistoryPreview {
  issues: HistoryIssue[];
  blocking: number;
  projects: HistoryProject[];
  payments: HistoryPayment[];
  stats: { projects: number; assignments: number; invoices: number; collections: number; planned: number; salesCOP: string; collectedCOP: string; emails: number };
  missingCollaborators: string[];
}

/** Paso 1: lee y valida la plantilla SIN guardar nada. */
export async function previewHistoryAction(formData: FormData): Promise<ActionResult<HistoryPreview>> {
  await requireSession();
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Elige el archivo de la plantilla (.xlsx).");
    if (file.size > MAX_BYTES) return fail("El archivo supera 10 MB.");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
    const { plan, issues } = parseHistoryWorkbook(wb);

    const existing = await collaboratorsByEmail();
    const missing = plan.emails.filter((e) => !existing.has(e));
    for (const e of missing) {
      issues.push({ severity: "Bloqueante", type: "Colaborador sin crear", sheet: "Asignaciones", row: "", code: "", detail: `${e} no existe en la aplicación.`, action: "Créalo en Colaboradores con exactamente ese correo." });
    }
    const sorted = sortIssues(issues);
    const sale = plan.projects.reduce((a, p) => a + Number(p.sale), 0);
    const invoices = plan.projects.flatMap((p) => p.invoices);
    const collected = invoices.flatMap((i) => i.collections).reduce((a, c) => a + Number(c.amount), 0);
    return ok(
      {
        issues: sorted,
        blocking: sorted.filter((i) => i.severity === "Bloqueante").length,
        projects: plan.projects,
        payments: plan.payments,
        stats: {
          projects: plan.projects.length,
          assignments: plan.projects.reduce((a, p) => a + p.assignments.length, 0),
          invoices: invoices.filter((i) => i.status === "ISSUED").length,
          collections: invoices.reduce((a, i) => a + i.collections.length, 0),
          planned: invoices.filter((i) => i.status === "PLANNED").length,
          salesCOP: String(sale),
          collectedCOP: String(collected),
          emails: plan.emails.length,
        },
        missingCollaborators: missing,
      },
      "Plantilla revisada.",
    );
  } catch (e) {
    console.error(e);
    return fail("No se pudo leer el archivo. Verifica que sea la plantilla de Excel (.xlsx) sin protección.");
  }
}

const money = z.string().regex(/^\d+(\.\d+)?$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const projectSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9._&-]{3,40}$/),
  client: z.string().min(1).max(200),
  country: z.enum(COUNTRY_CODES),
  saleDate: date,
  currency: z.enum(["COP", "USD", "CLP", "MXN"]),
  sale: money,
  costs: money,
  saleRate: money.nullable(),
  expectedInvoices: z.number().int().min(0).max(120),
  notes: z.string().max(2000).nullable(),
  assignments: z.array(z.object({ email: z.string().email(), pct: money, row: z.number() })).max(20),
  invoices: z
    .array(
      z.object({
        number: z.string().max(60).nullable(),
        status: z.enum(["PLANNED", "ISSUED"]),
        issueDate: date.nullable(),
        dueDate: date.nullable(),
        amount: money,
        netBaseExplicit: money.nullable(),
        notes: z.string().max(2000).nullable(),
        collections: z.array(z.object({ date, amount: money, fxRate: money.nullable(), isOverpayment: z.boolean(), justification: z.string().nullable(), notes: z.string().nullable() })).max(60),
        row: z.number(),
      }),
    )
    .max(200),
  adjustments: z
    .array(z.object({ invoiceNumber: z.string().nullable(), date, kind: z.enum(["CREDIT_NOTE", "DISCOUNT", "CONTRACT_REDUCTION", "PROVIDER_COST"]), reason: z.string().min(10), amount: money, row: z.number() }))
    .max(200),
  row: z.number(),
});

/** Paso 2: carga un proyecto (todo o nada). El cliente llama a esta acción proyecto por proyecto. */
export async function importHistoryProjectAction(input: HistoryProject): Promise<ActionResult<ImportProjectResult>> {
  const session = await requireSession();
  try {
    const project = projectSchema.parse(input) as HistoryProject;
    const result = await importProject(session.userId, project, await collaboratorsByEmail());
    return ok(result);
  } catch (e) {
    return toFailure(e);
  }
}

/** Cierra la importación: refresca las pantallas. */
export async function finishHistoryImportAction(): Promise<ActionResult> {
  await requireSession();
  for (const path of ["/", "/proyectos", "/facturas", "/colaboradores", "/configuracion", "/liquidaciones"]) revalidatePath(path);
  return ok(undefined);
}

/** Paso 3: valida en orden los meses ya terminados. */
export async function validateClosedMonthsAction(): Promise<ActionResult<ValidateMonthsResult>> {
  const session = await requireSession();
  try {
    const res = await validateClosedMonths(session.userId);
    for (const path of ["/", "/proyectos", "/configuracion", "/colaboradores"]) revalidatePath(path);
    return ok(res, `${res.validated.length} mes(es) validado(s).`);
  } catch (e) {
    return toFailure(e);
  }
}

/** Paso 4: compara lo que calcularía la aplicación con lo pagado (no guarda nada). */
export async function comparePaymentsAction(payments: HistoryPayment[]): Promise<ActionResult<PaymentComparison>> {
  await requireSession();
  try {
    const list = z
      .array(z.object({ liquidation: z.string(), email: z.string(), amount: z.string(), paidAt: z.string().nullable(), reference: z.string().nullable(), row: z.number() }))
      .max(5000)
      .parse(payments) as HistoryPayment[];
    return ok(await comparePayments(list));
  } catch (e) {
    return toFailure(e);
  }
}
