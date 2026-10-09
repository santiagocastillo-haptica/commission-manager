import type ExcelJS from "exceljs";
import { COUNTRY_CODES } from "@/domain/countries";
import { isDateOnly, todayBogota } from "@/domain/dates";
import { CURRENCIES, D } from "@/domain/money";

/** Primer día desde el que se carga historia (inicio de la política de comisiones). */
export const HISTORY_START = "2024-09-01";

export interface HistoryAssignment {
  email: string;
  /** Puntos porcentuales: «1» = 1 %. */
  pct: string;
  row: number;
}
export interface HistoryCollection {
  date: string;
  amount: string;
  /** TRM del día del recaudo (solo moneda extranjera). */
  fxRate: string | null;
  isOverpayment: boolean;
  justification: string | null;
  notes: string | null;
}
export interface HistoryInvoice {
  number: string | null;
  status: "PLANNED" | "ISSUED";
  issueDate: string | null;
  dueDate: string | null;
  amount: string;
  netBaseExplicit: string | null;
  notes: string | null;
  collections: HistoryCollection[];
  row: number;
}
export interface HistoryAdjustment {
  invoiceNumber: string | null;
  date: string;
  kind: "CREDIT_NOTE" | "DISCOUNT" | "CONTRACT_REDUCTION" | "PROVIDER_COST";
  reason: string;
  amount: string;
  row: number;
}
export interface HistoryProject {
  code: string;
  client: string;
  country: string;
  saleDate: string;
  currency: "COP" | "USD" | "CLP" | "MXN";
  sale: string;
  costs: string;
  saleRate: string | null;
  expectedInvoices: number;
  notes: string | null;
  assignments: HistoryAssignment[];
  invoices: HistoryInvoice[];
  adjustments: HistoryAdjustment[];
  row: number;
}
export interface HistoryPayment {
  liquidation: string;
  email: string;
  amount: string;
  paidAt: string | null;
  reference: string | null;
  row: number;
}
export interface HistoryPlan {
  projects: HistoryProject[];
  payments: HistoryPayment[];
  emails: string[];
}

export type IssueSeverity = "Bloqueante" | "Decisión" | "Menor" | "Info";
export interface HistoryIssue {
  severity: IssueSeverity;
  type: string;
  sheet: string;
  row: number | string;
  code: string;
  detail: string;
  action: string;
}

const KINDS: Record<string, HistoryAdjustment["kind"]> = {
  NOTA_CREDITO: "CREDIT_NOTE",
  DESCUENTO: "DISCOUNT",
  REDUCCION_CONTRATO: "CONTRACT_REDUCTION",
  COSTO_PROVEEDOR: "PROVIDER_COST",
};

type Row = Record<string, string | number | null> & { _row: number };

function cellValue(c: ExcelJS.CellValue): string | number | null {
  if (c === null || c === undefined) return null;
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  if (typeof c === "object") {
    const o = c as unknown as { result?: ExcelJS.CellValue; text?: string; richText?: { text: string }[] };
    if (o.result !== undefined) return cellValue(o.result);
    if (o.text) return o.text.trim();
    if (o.richText) return o.richText.map((t) => t.text).join("").trim();
    return null;
  }
  if (typeof c === "string") return c.trim() === "" ? null : c.trim();
  return c as number;
}

/** Lee una hoja como filas con las columnas por encabezado (sin asteriscos). Omite filas vacías y de ejemplo. */
function readSheet(wb: ExcelJS.Workbook, name: string): { head: string[]; rows: Row[] } | null {
  const ws = wb.getWorksheet(name);
  if (!ws) return null;
  const head = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((h) => String(cellValue(h) ?? "").replace(/\*/g, "").trim());
  const rows: Row[] = [];
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const row = { _row: i } as Row;
    let any = false;
    head.forEach((h, j) => {
      if (!h) return;
      const v = cellValue(r.getCell(j + 1).value);
      row[h] = v;
      if (v !== null) any = true;
    });
    const first = String(row.codigo ?? row.codigo_proyecto ?? row.liquidacion ?? "");
    if (any && !first.startsWith("EJEMPLO") && !/^colaborador@/.test(String(row.correo_colaborador ?? ""))) rows.push(row);
  });
  return { head, rows };
}

/** Redondea a centavos (Excel arrastra decimales de fórmulas: 63193277.000000004). */
const m2 = (n: number) => String(Math.round(n * 100) / 100);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const dateStr = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m && isDateOnly(m[1]) ? m[1] : "inválida";
};

/** Convierte el código a uno aceptado por la aplicación (letras, números, punto, guion, guion bajo y &). */
export function normalizeCode(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9._&-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Interpreta y valida la plantilla de historia. No toca la base de datos: devuelve el plan de carga y los hallazgos.
 * Facturas puede traer los recaudos «sintetizados» (estado RECAUDADA + fecha_recaudo = recaudo total) y/o una hoja Recaudos.
 */
export function parseHistoryWorkbook(wb: ExcelJS.Workbook, today: string = todayBogota()): { plan: HistoryPlan; issues: HistoryIssue[] } {
  const issues: HistoryIssue[] = [];
  const add = (severity: IssueSeverity, type: string, sheet: string, row: number | string, code: string, detail: string, action: string) =>
    issues.push({ severity, type, sheet, row, code, detail, action });

  const sP = readSheet(wb, "Proyectos");
  if (!sP) {
    add("Bloqueante", "Falta la hoja Proyectos", "Proyectos", "", "", "No se encontró la hoja.", "Usa la plantilla oficial.");
    return { plan: { projects: [], payments: [], emails: [] }, issues };
  }
  const sA = readSheet(wb, "Asignaciones");
  const sF = readSheet(wb, "Facturas");
  const sR = readSheet(wb, "Recaudos");
  const sJ = readSheet(wb, "Ajustes");
  const sG = readSheet(wb, "Pagos_realizados");
  const facturaHead = sF?.head ?? [];
  // En la versión sintetizada la columna 5 de Facturas es «fecha_recaudo»; en la original, «fecha_vencimiento».
  const synthesized = facturaHead.includes("fecha_recaudo");

  // ───── Proyectos ─────
  const projects = new Map<string, HistoryProject>();
  const countByCode = new Map<string, number>();
  for (const r of sP.rows) countByCode.set(str(r.codigo), (countByCode.get(str(r.codigo)) ?? 0) + 1);
  const rawToCode = new Map<string, string>();

  for (const r of sP.rows) {
    const raw = str(r.codigo);
    const code = normalizeCode(raw);
    if (!code || code.length < 3) {
      add("Bloqueante", "Código inválido", "Proyectos", r._row, raw, "El código debe tener al menos 3 caracteres válidos.", "Corrige el código.");
      continue;
    }
    if (code !== raw) add("Menor", "Código normalizado", "Proyectos", r._row, raw, `Se importará como «${code}».`, "Sin acción (o corrígelo en la plantilla).");
    if ((countByCode.get(raw) ?? 0) > 1) {
      add("Bloqueante", "Código repetido", "Proyectos", r._row, raw, `Aparece ${countByCode.get(raw)} veces. Sus asignaciones y facturas no se pueden separar.`, "Dale un código único a cada proyecto, en las tres hojas.");
      continue;
    }
    rawToCode.set(raw, code);
    const client = str(r.cliente);
    if (!client) add("Bloqueante", "Falta cliente", "Proyectos", r._row, code, "Columna obligatoria vacía.", "Escribe el cliente.");
    const country = str(r.pais).toUpperCase();
    if (!(COUNTRY_CODES as string[]).includes(country)) add("Bloqueante", "País no válido", "Proyectos", r._row, code, `País «${str(r.pais)}».`, `Usa uno de: ${COUNTRY_CODES.join(", ")}.`);
    const currency = str(r.moneda).toUpperCase();
    if (!(CURRENCIES as readonly string[]).includes(currency)) add("Bloqueante", "Moneda no válida", "Proyectos", r._row, code, `Moneda «${str(r.moneda)}».`, `Usa una de: ${CURRENCIES.join(", ")}.`);
    const saleDate = dateStr(r.fecha_venta);
    if (!saleDate || saleDate === "inválida") add("Bloqueante", "Fecha de venta inválida", "Proyectos", r._row, code, `Valor «${str(r.fecha_venta)}».`, "Formato AAAA-MM-DD.");
    else if (saleDate < HISTORY_START || saleDate > today) add("Bloqueante", "Fecha de venta fuera de rango", "Proyectos", r._row, code, `${saleDate}: debe estar entre ${HISTORY_START} y hoy.`, "Corrige la fecha.");
    const sale = num(r.valor_venta_sin_iva);
    if (!(sale > 0)) add("Bloqueante", "Valor de venta inválido", "Proyectos", r._row, code, `Valor «${str(r.valor_venta_sin_iva)}».`, "Debe ser un número mayor que cero.");
    let costs = num(r.costos_proveedores_sin_iva);
    if (Number.isNaN(costs)) {
      add("Menor", "Falta costos de proveedores", "Proyectos", r._row, code, "Vacío.", "Se toma como 0.");
      costs = 0;
    } else if (costs > sale) add("Bloqueante", "Costos superan la venta", "Proyectos", r._row, code, `Costos ${costs} > venta ${sale}.`, "La base comisionable no puede ser negativa.");
    const rate = num(r.trm_venta);
    if (currency !== "COP" && !(rate > 0)) add("Bloqueante", "Falta TRM de venta", "Proyectos", r._row, code, `Moneda ${currency} sin trm_venta.`, "Indica la TRM del día de la venta.");
    projects.set(code, {
      code, client, country, saleDate: saleDate ?? "", currency: currency as HistoryProject["currency"], sale: m2(sale), costs: m2(costs),
      saleRate: rate > 0 ? String(rate) : null, expectedInvoices: Math.trunc(num(r.facturas_previstas)) || 0, notes: str(r.observaciones) || null,
      assignments: [], invoices: [], adjustments: [], row: r._row,
    });
  }
  const resolve = (raw: string) => rawToCode.get(raw) ?? null;

  // ───── Asignaciones ─────
  const emails = new Set<string>();
  for (const a of sA?.rows ?? []) {
    const raw = str(a.codigo_proyecto);
    if (!str(a.correo_colaborador) && !str(a.porcentaje)) {
      add("Decisión", "Proyecto sin colaborador", "Asignaciones", a._row, raw, "Fila con solo el código, sin correo ni porcentaje.", "Se importa «sin comisión».");
      continue;
    }
    const code = resolve(raw);
    const p = code ? projects.get(code) : undefined;
    if (!p) {
      add("Bloqueante", "Asignación a proyecto inexistente", "Asignaciones", a._row, raw, "El código no está en Proyectos (o está repetido).", "Corrige el código.");
      continue;
    }
    const email = str(a.correo_colaborador).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      add("Bloqueante", "Correo inválido", "Asignaciones", a._row, raw, `«${str(a.correo_colaborador)}».`, "Escribe el correo del colaborador.");
      continue;
    }
    const pct = num(a.porcentaje);
    if (!(pct > 0 && pct <= 1)) {
      add("Bloqueante", "Porcentaje fuera de rango", "Asignaciones", a._row, raw, `Valor «${str(a.porcentaje)}».`, "Entre 0.0001 y 1 (puntos porcentuales).");
      continue;
    }
    if (p.assignments.some((x) => x.email === email)) {
      add("Bloqueante", "Asignación duplicada", "Asignaciones", a._row, raw, `${email} aparece dos veces en el mismo proyecto.`, "Deja una sola fila.");
      continue;
    }
    p.assignments.push({ email, pct: String(pct), row: a._row });
    emails.add(email);
  }

  // ───── Facturas (con recaudos sintetizados) ─────
  for (const f of sF?.rows ?? []) {
    const raw = str(f.codigo_proyecto);
    const estado = str(f.estado).toUpperCase();
    const amountN = num(f.valor_sin_iva);
    if (!raw) {
      add("Bloqueante", "Factura sin proyecto", "Facturas", f._row, "", `Estado ${estado}, valor ${str(f.valor_sin_iva)}.`, "Indica a qué proyecto pertenece.");
      continue;
    }
    const code = resolve(raw);
    const p = code ? projects.get(code) : undefined;
    if (!p) {
      add("Bloqueante", "Factura a proyecto inexistente", "Facturas", f._row, raw, "El código no está en Proyectos (o está repetido).", "Corrige el código.");
      continue;
    }
    if (!["EMITIDA", "PREVISTA", "RECAUDADA"].includes(estado)) {
      add("Bloqueante", "Estado inválido", "Facturas", f._row, code ?? raw, `Estado «${str(f.estado)}».`, "EMITIDA, PREVISTA o RECAUDADA.");
      continue;
    }
    if (!(amountN > 0)) {
      if (estado === "PREVISTA") add("Menor", "Factura prevista sin valor", "Facturas", f._row, code ?? raw, "No tiene valor.", "Se omite: solo cuenta en facturas_previstas.");
      else add("Bloqueante", "Valor de factura inválido", "Facturas", f._row, code ?? raw, `Valor «${str(f.valor_sin_iva)}».`, "Debe ser mayor que cero.");
      continue;
    }
    const planned = estado === "PREVISTA";
    const number = str(f.numero_factura) || null;
    const issueDate = dateStr(f.fecha_emision);
    if (!planned) {
      if (!number) {
        add("Bloqueante", "Factura emitida sin número", "Facturas", f._row, code ?? raw, "Falta numero_factura.", "Obligatorio para facturas emitidas o recaudadas.");
        continue;
      }
      if (!issueDate || issueDate === "inválida") {
        add("Bloqueante", "Factura emitida sin fecha de emisión", "Facturas", f._row, code ?? raw, `Factura ${number}.`, "Escribe la fecha de emisión (AAAA-MM-DD).");
        continue;
      }
      if (p.invoices.some((i) => i.number === number)) {
        add("Bloqueante", "Número de factura repetido", "Facturas", f._row, code ?? raw, `${number} aparece más de una vez en el proyecto.`, "El número no puede repetirse dentro de un proyecto.");
        continue;
      }
    } else if (number || issueDate) add("Menor", "Prevista con datos", "Facturas", f._row, code ?? raw, "Una factura prevista no lleva número ni fecha: se ignoran.", "Cámbiala a EMITIDA si ya se emitió.");

    const col5 = dateStr(synthesized ? f.fecha_recaudo : f.fecha_vencimiento);
    const inv: HistoryInvoice = {
      number: planned ? null : number, status: planned ? "PLANNED" : "ISSUED", issueDate: planned ? null : issueDate, dueDate: null, amount: m2(amountN),
      netBaseExplicit: num(f.base_neta_explicita) > 0 ? m2(num(f.base_neta_explicita)) : null, notes: str(f.observaciones) || null, collections: [], row: f._row,
    };
    if (estado === "RECAUDADA") {
      if (!col5 || col5 === "inválida") add("Bloqueante", "RECAUDADA sin fecha de recaudo", "Facturas", f._row, code ?? raw, `Factura ${number}.`, "Escribe la fecha del recaudo.");
      else if (inv.issueDate && col5 < inv.issueDate) add("Bloqueante", "Recaudo anterior a la emisión", "Facturas", f._row, code ?? raw, `Factura ${number}: emisión ${inv.issueDate}, recaudo ${col5}.`, "Corrige la fecha (¿error de año?).");
      else if (col5 > today) add("Bloqueante", "Recaudo en el futuro", "Facturas", f._row, code ?? raw, `Factura ${number}: recaudo ${col5}.`, "Un recaudo no puede ser posterior a hoy.");
      else inv.collections.push({ date: col5, amount: m2(amountN), fxRate: null, isOverpayment: false, justification: null, notes: null });
    } else if (estado === "EMITIDA" && col5 && col5 !== "inválida") {
      // En una factura emitida sin recaudar, la fecha de esa columna es el vencimiento.
      inv.dueDate = col5;
    } else if (!synthesized && col5 && col5 !== "inválida") inv.dueDate = col5;
    p.invoices.push(inv);
  }

  // ───── Recaudos (hoja opcional) ─────
  for (const c of sR?.rows ?? []) {
    const raw = str(c.codigo_proyecto);
    const code = resolve(raw);
    const p = code ? projects.get(code) : undefined;
    if (!p) {
      add("Bloqueante", "Recaudo a proyecto inexistente", "Recaudos", c._row, raw, "El código no está en Proyectos (o está repetido).", "Corrige el código.");
      continue;
    }
    const inv = p.invoices.find((i) => i.number === str(c.numero_factura));
    if (!inv) {
      add("Bloqueante", "Recaudo de una factura inexistente", "Recaudos", c._row, code ?? raw, `Factura «${str(c.numero_factura)}».`, "La factura debe estar en la hoja Facturas (EMITIDA).");
      continue;
    }
    const date = dateStr(c.fecha_recaudo);
    const amount = num(c.valor_recibido);
    if (!date || date === "inválida" || !(amount > 0)) {
      add("Bloqueante", "Recaudo incompleto", "Recaudos", c._row, code ?? raw, "Falta fecha o valor válido.", "Completa fecha_recaudo y valor_recibido.");
      continue;
    }
    const over = str(c.es_excedente).toUpperCase() === "SI";
    inv.collections.push({
      date, amount: m2(amount), fxRate: num(c.trm_recaudo) > 0 ? String(num(c.trm_recaudo)) : null, isOverpayment: over,
      justification: str(c.justificacion) || null, notes: str(c.observaciones) || null,
    });
  }

  // ───── Ajustes ─────
  for (const j of sJ?.rows ?? []) {
    const raw = str(j.codigo_proyecto);
    const code = resolve(raw);
    const p = code ? projects.get(code) : undefined;
    if (!p) {
      add("Bloqueante", "Ajuste a proyecto inexistente", "Ajustes", j._row, raw, "El código no está en Proyectos.", "Corrige el código.");
      continue;
    }
    const kind = KINDS[str(j.tipo).toUpperCase()];
    const date = dateStr(j.fecha);
    const amount = num(j.valor);
    if (!kind || !date || date === "inválida" || !(amount > 0) || str(j.motivo).length < 10) {
      add("Bloqueante", "Ajuste incompleto", "Ajustes", j._row, code ?? raw, "Revisa tipo, fecha, valor (> 0) y motivo (10+ caracteres).", "Corrige la fila.");
      continue;
    }
    p.adjustments.push({ invoiceNumber: str(j.numero_factura) || null, date, kind, reason: str(j.motivo), amount: m2(amount), row: j._row });
  }

  // ───── Reglas por proyecto ─────
  for (const p of projects.values()) {
    const sale = D(p.sale);
    const invoiced = p.invoices.reduce((acc, i) => acc.plus(i.amount), D(0));
    if (p.currency === "COP" && invoiced.gt(sale) && invoiced.minus(sale).lte(1)) {
      add("Menor", "Venta ajustada por redondeo", "Proyectos", p.row, p.code, `Facturado ${invoiced.toFixed(2)} vs venta ${p.sale} (diferencia ${invoiced.minus(sale).toFixed(2)}).`, "El valor de venta se sube al facturado.");
      p.sale = invoiced.toFixed(2);
    } else if (p.currency === "COP" && invoiced.gt(sale)) {
      add("Decisión", "Facturado supera la venta", "Proyectos", p.row, p.code, `Venta ${p.sale} · facturado ${invoiced.toFixed()} (diferencia ${invoiced.minus(sale).toFixed(2)}).`, "Sube el valor de venta al facturado, o corrige la factura: la aplicación no permite facturar más que la venta.");
    }
    if (p.expectedInvoices < p.invoices.length) {
      if (p.expectedInvoices === 0) add("Menor", "Falta facturas_previstas", "Proyectos", p.row, p.code, "Columna obligatoria vacía.", `Se usará la cantidad de facturas (${p.invoices.length || 1}).`);
      p.expectedInvoices = Math.max(1, p.invoices.length);
    }
    if (p.expectedInvoices === 0) p.expectedInvoices = Math.max(1, p.invoices.length);
    if (p.assignments.length === 0) add("Menor", "Proyecto sin asignaciones", "Proyectos", p.row, p.code, "No tiene colaboradores.", "Se importará «sin comisión».");
    for (const i of p.invoices) {
      const total = i.collections.reduce((acc, c) => acc.plus(c.amount), D(0));
      if (total.gt(i.amount) && !i.collections.some((c) => c.isOverpayment)) add("Bloqueante", "Recaudo supera la factura", "Facturas", i.row, p.code, `Factura ${i.number}: recaudado ${total.toFixed()} > ${i.amount}.`, "Corrige el valor o marca el excedente.");
      if (p.currency !== "COP") for (const c of i.collections) if (!c.fxRate) add("Bloqueante", "Falta TRM del recaudo", "Facturas", i.row, p.code, `Factura ${i.number}: moneda ${p.currency} sin TRM del día del recaudo.`, "Usa la hoja Recaudos con trm_recaudo, o registra el proyecto en COP.");
    }
  }

  // ───── Pagos realizados ─────
  const payments: HistoryPayment[] = [];
  for (const g of sG?.rows ?? []) {
    const email = str(g.correo_colaborador).toLowerCase();
    const amount = num(g.comision_neta_pagada);
    if (!str(g.liquidacion) || !email || Number.isNaN(amount)) {
      add("Menor", "Pago incompleto", "Pagos_realizados", g._row, "", "Falta liquidación, correo o valor.", "Se omite.");
      continue;
    }
    payments.push({ liquidation: str(g.liquidacion), email, amount: String(amount), paidAt: dateStr(g.fecha_pago), reference: str(g.referencia) || null, row: g._row });
    if (!emails.has(email)) add("Info", "Pago a un correo sin asignaciones", "Pagos_realizados", g._row, "", email, "Solo informativo.");
  }

  return { plan: { projects: [...projects.values()], payments, emails: [...emails].sort() }, issues };
}

export const SEVERITY_ORDER: Record<IssueSeverity, number> = { Bloqueante: 0, Decisión: 1, Menor: 2, Info: 3 };
export const sortIssues = (issues: HistoryIssue[]) =>
  [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.type.localeCompare(b.type) || String(a.row).localeCompare(String(b.row), undefined, { numeric: true }));
