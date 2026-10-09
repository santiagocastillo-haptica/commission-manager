"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { COUNTRY_CODES } from "@/domain/countries";
import { fail, ok, toFailure, type ActionResult } from "@/server/action-result";
import { requireSession } from "../auth";
import { parseHistoryWorkbook, sortIssues, type HistoryIssue, type HistoryPayment, type HistoryProject } from "../import/history";
import {
  arqueoByQuarter, collaboratorsByEmail, comparePayments, importProject, validateClosedMonths,
  type Arqueo, type ImportProjectResult, type PaymentComparison, type ValidateMonthsResult,
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

const paymentsSchema = z
  .array(z.object({ liquidation: z.string(), email: z.string(), amount: z.string(), paidAt: z.string().nullable(), reference: z.string().nullable(), row: z.number() }))
  .max(5000);

async function runArqueo(input: { projects: HistoryProject[]; payments: HistoryPayment[] }): Promise<Arqueo> {
  const projects = z.array(projectSchema).max(2000).parse(input.projects) as HistoryProject[];
  const payments = paymentsSchema.parse(input.payments) as HistoryPayment[];
  return arqueoByQuarter(projects, payments);
}

/** Arqueo trimestral: plantilla vs aplicación (ventas, facturado, recaudado) y comisión generada vs pagada. Solo lectura. */
export async function arqueoAction(input: { projects: HistoryProject[]; payments: HistoryPayment[] }): Promise<ActionResult<Arqueo>> {
  await requireSession();
  try {
    return ok(await runArqueo(input));
  } catch (e) {
    return toFailure(e);
  }
}

/** Excel del arqueo (base64) para descargar. */
export async function arqueoExcelAction(input: { projects: HistoryProject[]; payments: HistoryPayment[] }): Promise<ActionResult<{ filename: string; base64: string }>> {
  await requireSession();
  try {
    const a = await runArqueo(input);
    const wb = new ExcelJS.Workbook();
    const head = (ws: ExcelJS.Worksheet) =>
      ws.getRow(1).eachCell((c) => {
        c.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF006663" } };
        c.alignment = { wrapText: true, vertical: "middle" };
      });
    const money = { numFmt: "#,##0" };
    const ws = wb.addWorksheet("Arqueo por trimestre", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Trimestre", width: 11 },
      { header: "Proyectos (plantilla)", width: 12 }, { header: "Proyectos (app)", width: 12 },
      { header: "Ventas plantilla", width: 17, style: money }, { header: "Ventas app", width: 17, style: money }, { header: "Dif. ventas", width: 14, style: money },
      { header: "Facturado plantilla", width: 17, style: money }, { header: "Facturado app", width: 17, style: money }, { header: "Dif. facturado", width: 14, style: money },
      { header: "Recaudado plantilla", width: 17, style: money }, { header: "Recaudado app", width: 17, style: money }, { header: "Dif. recaudado", width: 14, style: money },
      { header: "Comisión generada (app)", width: 18, style: money }, { header: "Comisión pagada (hoja de pagos)", width: 20, style: money }, { header: "Dif. generada − pagada", width: 18, style: money },
    ];
    for (const q of a.quarters) {
      const n = (s: string) => Number(s);
      ws.addRow([
        q.quarter, q.plan.projects, q.app.projects,
        n(q.plan.sales), n(q.app.sales), n(q.app.sales) - n(q.plan.sales),
        n(q.plan.invoiced), n(q.app.invoiced), n(q.app.invoiced) - n(q.plan.invoiced),
        n(q.plan.collected), n(q.app.collected), n(q.app.collected) - n(q.plan.collected),
        n(q.commissionGenerated), n(q.commissionPaid), n(q.commissionGenerated) - n(q.commissionPaid),
      ]);
    }
    const total = ws.addRow(["TOTAL", ...Array.from({ length: 14 }, (_, i) => ({ formula: `SUM(${String.fromCharCode(66 + i)}2:${String.fromCharCode(66 + i)}${a.quarters.length + 1})` }))]);
    total.font = { name: "Arial", size: 10, bold: true };
    head(ws);
    ws.eachRow((r, i) => { if (i > 1 && i <= a.quarters.length + 1) r.eachCell((c) => { c.font = { name: "Arial", size: 10 }; }); });

    const wp = wb.addWorksheet("Por colaborador", { views: [{ state: "frozen", ySplit: 1 }] });
    wp.columns = [{ header: "Trimestre del recaudo", width: 14 }, { header: "Colaborador (correo)", width: 36 }, { header: "Nombre", width: 28 }, { header: "Generada (app)", width: 16, style: money }, { header: "Pagada (hoja)", width: 16, style: money }, { header: "Diferencia", width: 16, style: money }];
    for (const r of a.people) wp.addRow([r.quarter, r.email, r.name, Number(r.generated), Number(r.paid), Number(r.difference)]);
    head(wp);
    wp.eachRow((r, i) => { if (i > 1) r.eachCell((c) => { c.font = { name: "Arial", size: 10 }; }); });
    wp.autoFilter = { from: "A1", to: "F1" };

    const wn = wb.addWorksheet("Notas");
    wn.columns = [{ width: 120 }];
    for (const line of [
      "Cortes exactos por trimestre calendario.",
      "Ventas: valor vendido por fecha de venta. Facturado: facturas emitidas por fecha de emisión. Recaudado: recaudos por fecha de recaudo. Todo antes de IVA, en COP.",
      "Comisión generada: la que producen los recaudos del trimestre con los porcentajes efectivos fijados al validar cada mes de venta.",
      "Pagada: hoja Pagos_realizados; los códigos LIQ-AAAA-Q# se toman como el trimestre de los RECAUDOS que se pagaron.",
      ...a.notes,
    ]) wn.addRow([line]).font = { name: "Arial", size: 10 };
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return ok({ filename: "Arqueo-trimestral.xlsx", base64: buf.toString("base64") });
  } catch (e) {
    return toFailure(e);
  }
}
