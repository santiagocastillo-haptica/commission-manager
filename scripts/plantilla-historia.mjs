/**
 * Genera la plantilla de Excel para diligenciar la historia de comisiones (desde septiembre de 2024).
 *   node scripts/plantilla-historia.mjs [ruta-de-salida]
 * Los nombres de hojas y columnas son el contrato con el importador: no los cambies al diligenciarla.
 */
import ExcelJS from "exceljs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/Plantilla-historia-comisiones.xlsx");
const FONT = "Arial";
const BRAND = "FF006663";
const EXAMPLE_FILL = "FFF2F2F2";
const LAST = 3000; // filas con validaciones

const wb = new ExcelJS.Workbook();
wb.creator = "Háptica Commission Manager";

/** Hoja de datos: encabezado, una fila de ejemplo y validaciones en las columnas indicadas. */
function dataSheet(name, columns, example, notes) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
  const head = ws.getRow(1);
  head.height = 32;
  head.eachCell((cell, i) => {
    const c = columns[i - 1];
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    cell.alignment = { vertical: "middle", wrapText: true };
    if (c.required) cell.note = { texts: [{ text: "Obligatorio. " + (c.hint ?? ""), font: { name: FONT, size: 9 } }] };
    else if (c.hint) cell.note = { texts: [{ text: c.hint, font: { name: FONT, size: 9 } }] };
  });
  ws.addRow(example);
  ws.getRow(2).eachCell((cell) => {
    cell.font = { name: FONT, size: 10, italic: true, color: { argb: "FF7F7F7F" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXAMPLE_FILL } };
  });
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.format) col.numFmt = c.format;
    for (let r = 2; r <= LAST; r++) {
      const cell = ws.getCell(r, i + 1);
      if (r > 2) cell.font = { name: FONT, size: 10 };
      if (c.validation) cell.dataValidation = { ...c.validation, allowBlank: !c.required, showErrorMessage: true, errorTitle: "Valor no válido", error: c.validation.error ?? "Revisa el formato de esta columna." };
    }
  });
  if (notes) {
    const nc = columns.length + 2;
    ws.getColumn(nc).width = 60;
    notes.forEach((t, i) => {
      const cell = ws.getCell(i + 1, nc);
      cell.value = t;
      cell.font = { name: FONT, size: 9, italic: true, color: { argb: "FF595959" } };
      cell.alignment = { wrapText: true, vertical: "top" };
    });
  }
  return ws;
}

const list = (items, error) => ({ type: "list", formulae: [`"${items.join(",")}"`], error });
const date = { type: "date", operator: "greaterThanOrEqual", formulae: [new Date(Date.UTC(2024, 8, 1))], error: "Usa una fecha válida desde 2024-09-01 (AAAA-MM-DD)." };
const money = { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], error: "Ingresa un número sin separador de miles y con punto decimal (ej. 125000000 o 1250.50)." };
const positive = { type: "decimal", operator: "greaterThan", formulae: [0], error: "Debe ser un número mayor que cero." };
const FMT_DATE = "yyyy-mm-dd";
const FMT_MONEY = "#,##0.00";

// ───────── Instrucciones ─────────
const ins = wb.addWorksheet("Instrucciones", { views: [{ showGridLines: false }] });
ins.getColumn(1).width = 3;
ins.getColumn(2).width = 28;
ins.getColumn(3).width = 100;
const lines = [
  ["title", "Plantilla de historia de comisiones — Háptica Commission Manager"],
  ["text", "Desde septiembre de 2024. Cada hoja es una tabla; la fila 1 es el encabezado y la fila 2 (gris) es un EJEMPLO que debes borrar o reemplazar. No cambies los nombres de hojas ni de columnas."],
  ["gap"],
  ["h", "Qué celdas llenar"],
  ["kv", "Todas las hojas menos esta", "Llena desde la fila 3 hacia abajo (o reemplaza la fila 2). Las columnas con * son obligatorias. Pasa el cursor sobre el encabezado para ver la ayuda de cada columna."],
  ["kv", "Proyectos", "Una fila por proyecto vendido. El código debe ser único (p. ej. HAP-2024-001). No lleva nombre: el proyecto se identifica por su código y su cliente."],
  ["kv", "Países", "CO Colombia, CL Chile, MX México, GT Guatemala, US Estados Unidos, EC Ecuador, PE Perú. El país no define la moneda: Guatemala, Ecuador, Perú y Estados Unidos se registran en USD o COP."],
  ["kv", "Asignaciones", "Una fila por colaborador y proyecto, con su porcentaje base (1 = 1 %, 0.5 = medio punto). Máximo 1 por persona y proyecto. Se identifica al colaborador por su CORREO, escrito igual que en la aplicación."],
  ["kv", "Facturas", "Una fila por factura. Si aún no se emite, déjala como PREVISTA (sin número ni fechas). El número de factura no se repite dentro de un proyecto."],
  ["kv", "Recaudos", "Una fila por pago recibido de un cliente (totales o parciales), con su fecha. Si la factura es en otra moneda, la TRM del día del recaudo es obligatoria."],
  ["kv", "Ajustes", "Notas crédito, descuentos, reducciones de contrato o costos de proveedor posteriores a la venta."],
  ["kv", "Pagos_realizados", "OPCIONAL pero muy recomendado: lo que realmente se le pagó a cada colaborador en cada liquidación. Sirve para comparar contra lo que calcula la aplicación antes de cerrar cada período."],
  ["gap"],
  ["h", "Formato de los datos"],
  ["kv", "Fechas", "AAAA-MM-DD (por ejemplo 2024-10-15). Pueden ser celdas de fecha de Excel."],
  ["kv", "Valores", "Siempre ANTES de IVA, sin signo $, sin separador de miles y con punto decimal. En la moneda original del proyecto (COP, USD, CLP o MXN)."],
  ["kv", "TRM / tasas", "Pesos colombianos por una unidad de la moneda (ej. 4100.50 para USD). No aplica a COP."],
  ["kv", "Porcentajes", "En puntos porcentuales: 1 significa 1 %, 0.5 significa 0,5 %. Nunca mayor a 1."],
  ["kv", "Colaboradores", "Se crean en la aplicación antes de la importación. Aquí solo se referencian por correo."],
  ["gap"],
  ["h", "Reglas que aplica la aplicación al importar (si algo no cumple, se te informa la fila y el motivo)"],
  ["kv", "Meta mensual", "$390.000.000 para todos los períodos desde septiembre de 2024; se alcanza con ventas iguales o superiores."],
  ["kv", "Gamificación", "La analista comercial se rige por la política general hasta septiembre de 2025 y por la escala de gamificación desde octubre de 2025 (según el mes de venta)."],
  ["kv", "Validación de meses", "Cada mes ya terminado se valida en orden; un mes validado bloquea cambios económicos de sus proyectos."],
  ["kv", "Liquidaciones", "Se calculan y revisan en orden cronológico. Una liquidación aprobada es inmutable; por eso conviene comparar antes con Pagos_realizados."],
  ["kv", "Facturas y recaudos", "La suma de facturas no supera la venta; un recaudo no supera la factura (salvo un excedente justificado) ni es anterior a la emisión ni futuro."],
  ["gap"],
  ["note", "Documentación de las asunciones: las reglas anteriores son las confirmadas por el negocio (meta de $390M para todos los períodos; gamificación desde octubre de 2025). Lo demás sigue docs/02-motor-de-comisiones.md."],
];
let r = 2;
for (const [kind, a, b] of lines) {
  if (kind === "gap") { r++; continue; }
  if (kind === "title") {
    ins.mergeCells(r, 2, r, 3);
    const c = ins.getCell(r, 2);
    c.value = a;
    c.font = { name: FONT, size: 14, bold: true, color: { argb: BRAND } };
    ins.getRow(r).height = 24;
  } else if (kind === "text" || kind === "note") {
    ins.mergeCells(r, 2, r, 3);
    const c = ins.getCell(r, 2);
    c.value = a;
    c.font = { name: FONT, size: 10, italic: kind === "note", color: { argb: kind === "note" ? "FF595959" : "FF000000" } };
    c.alignment = { wrapText: true, vertical: "top" };
    ins.getRow(r).height = kind === "note" ? 30 : 42;
  } else if (kind === "h") {
    ins.mergeCells(r, 2, r, 3);
    const c = ins.getCell(r, 2);
    c.value = a;
    c.font = { name: FONT, size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
  } else {
    const k = ins.getCell(r, 2);
    k.value = a;
    k.font = { name: FONT, size: 10, bold: true };
    k.alignment = { vertical: "top" };
    const v = ins.getCell(r, 3);
    v.value = b;
    v.font = { name: FONT, size: 10 };
    v.alignment = { wrapText: true, vertical: "top" };
    ins.getRow(r).height = Math.max(16, Math.ceil(b.length / 95) * 14);
  }
  r++;
}

// ───────── Proyectos ─────────
dataSheet(
  "Proyectos",
  [
    { header: "codigo*", key: "codigo", width: 16, required: true, hint: "Único. Letras, números, punto, guion. Ej. HAP-2024-001", validation: { type: "textLength", operator: "between", formulae: [3, 40], error: "El código debe tener entre 3 y 40 caracteres." } },
    { header: "cliente*", key: "cliente", width: 26, required: true },
    { header: "pais*", key: "pais", width: 8, required: true, hint: "CO Colombia · CL Chile · MX México · GT Guatemala · US Estados Unidos · EC Ecuador · PE Perú", validation: list(["CO", "CL", "MX", "GT", "US", "EC", "PE"], "Elige un país de la lista (CO, CL, MX, GT, US, EC, PE).") },
    { header: "fecha_venta*", key: "fecha_venta", width: 14, required: true, hint: "AAAA-MM-DD. Define el mes de venta (desde 2024-09-01).", format: FMT_DATE, validation: date },
    { header: "moneda*", key: "moneda", width: 9, required: true, hint: "COP, USD, CLP o MXN", validation: list(["COP", "USD", "CLP", "MXN"], "Elige COP, USD, CLP o MXN.") },
    { header: "valor_venta_sin_iva*", key: "valor", width: 20, required: true, hint: "Antes de IVA, en la moneda original.", format: FMT_MONEY, validation: positive },
    { header: "costos_proveedores_sin_iva*", key: "costos", width: 22, required: true, hint: "Antes de IVA. 0 si no hubo. No puede superar la venta.", format: FMT_MONEY, validation: money },
    { header: "trm_venta", key: "trm", width: 12, hint: "Solo si la moneda no es COP: pesos por unidad el día de la venta.", format: "#,##0.00####", validation: positive },
    { header: "facturas_previstas*", key: "facturas", width: 14, required: true, hint: "Cantidad total de facturas que se emitirán (1 a 120).", validation: { type: "whole", operator: "between", formulae: [1, 120], error: "Número entero entre 1 y 120." } },
    { header: "observaciones", key: "obs", width: 30 },
  ],
  { codigo: "EJEMPLO-001", cliente: "Banco Ejemplo S.A.", pais: "CO", fecha_venta: new Date(Date.UTC(2024, 9, 8)), moneda: "COP", valor: 180000000, costos: 20000000, trm: null, facturas: 2, obs: "Borra esta fila de ejemplo" },
);

// ───────── Asignaciones ─────────
dataSheet(
  "Asignaciones",
  [
    { header: "codigo_proyecto*", key: "proyecto", width: 18, required: true, hint: "Debe existir en la hoja Proyectos." },
    { header: "correo_colaborador*", key: "correo", width: 34, required: true, hint: "El correo con el que se creó el colaborador en la aplicación." },
    { header: "porcentaje*", key: "pct", width: 13, required: true, hint: "En puntos porcentuales: 1 = 1 %, 0.5 = 0,5 %. Máximo 1.", format: "0.00##", validation: { type: "decimal", operator: "between", formulae: [0.0001, 1], error: "Entre 0.0001 y 1 (máximo 1 % por persona y proyecto)." } },
  ],
  { proyecto: "EJEMPLO-001", correo: "colaborador@haptica.co", pct: 1 },
  ["Una fila por colaborador y proyecto.", "Un proyecto puede tener varias filas (varios colaboradores) o ninguna (sin comisión)."],
);

// ───────── Facturas ─────────
dataSheet(
  "Facturas",
  [
    { header: "codigo_proyecto*", key: "proyecto", width: 18, required: true },
    { header: "numero_factura", key: "numero", width: 16, hint: "Obligatorio si es EMITIDA. Único dentro del proyecto. Vacío si es PREVISTA." },
    { header: "estado*", key: "estado", width: 11, required: true, hint: "EMITIDA o PREVISTA", validation: list(["EMITIDA", "PREVISTA"], "Elige EMITIDA o PREVISTA.") },
    { header: "fecha_emision", key: "emision", width: 14, hint: "Obligatoria si es EMITIDA. AAAA-MM-DD.", format: FMT_DATE, validation: date },
    { header: "fecha_vencimiento", key: "vence", width: 16, hint: "Opcional. AAAA-MM-DD.", format: FMT_DATE, validation: date },
    { header: "valor_sin_iva*", key: "valor", width: 18, required: true, hint: "Antes de IVA, en la moneda del proyecto.", format: FMT_MONEY, validation: positive },
    { header: "base_neta_explicita", key: "base", width: 18, hint: "Opcional. Solo si la base comisionable de esta factura difiere del prorrateo (no puede superar su valor).", format: FMT_MONEY, validation: money },
    { header: "observaciones", key: "obs", width: 30 },
  ],
  { proyecto: "EJEMPLO-001", numero: "FE-1001", estado: "EMITIDA", emision: new Date(Date.UTC(2024, 9, 20)), vence: new Date(Date.UTC(2024, 10, 19)), valor: 90000000, base: null, obs: "" },
  ["Una fila por factura (emitida o prevista)."],
);

// ───────── Recaudos ─────────
dataSheet(
  "Recaudos",
  [
    { header: "codigo_proyecto*", key: "proyecto", width: 18, required: true },
    { header: "numero_factura*", key: "numero", width: 16, required: true, hint: "Número de una factura EMITIDA del mismo proyecto." },
    { header: "fecha_recaudo*", key: "fecha", width: 15, required: true, hint: "AAAA-MM-DD. No anterior a la emisión ni futura.", format: FMT_DATE, validation: date },
    { header: "valor_recibido*", key: "valor", width: 18, required: true, hint: "Antes de IVA, en la moneda de la factura.", format: FMT_MONEY, validation: positive },
    { header: "trm_recaudo", key: "trm", width: 13, hint: "Obligatoria si la moneda no es COP: pesos por unidad el día del recaudo.", format: "#,##0.00####", validation: positive },
    { header: "es_excedente", key: "exc", width: 13, hint: "SI solo si el recaudo supera lo facturado (excedente real). Exige justificación.", validation: list(["SI", "NO"], "Elige SI o NO.") },
    { header: "justificacion", key: "just", width: 34, hint: "Obligatoria (10+ caracteres) si es_excedente = SI." },
    { header: "observaciones", key: "obs", width: 30 },
  ],
  { proyecto: "EJEMPLO-001", numero: "FE-1001", fecha: new Date(Date.UTC(2024, 10, 18)), valor: 90000000, trm: null, exc: "NO", just: "", obs: "" },
  ["Una fila por pago recibido (totales o parciales)."],
);

// ───────── Ajustes ─────────
dataSheet(
  "Ajustes",
  [
    { header: "codigo_proyecto*", key: "proyecto", width: 18, required: true },
    { header: "numero_factura", key: "numero", width: 16, hint: "Opcional: factura a la que se refiere el ajuste." },
    { header: "fecha*", key: "fecha", width: 14, required: true, hint: "AAAA-MM-DD.", format: FMT_DATE, validation: date },
    { header: "tipo*", key: "tipo", width: 20, required: true, hint: "NOTA_CREDITO, DESCUENTO, REDUCCION_CONTRATO o COSTO_PROVEEDOR", validation: list(["NOTA_CREDITO", "DESCUENTO", "REDUCCION_CONTRATO", "COSTO_PROVEEDOR"], "Elige un tipo de la lista.") },
    { header: "motivo*", key: "motivo", width: 44, required: true, hint: "Mínimo 10 caracteres." },
    { header: "valor*", key: "valor", width: 16, required: true, hint: "Antes de IVA, en la moneda del proyecto. Positivo: es lo que reduce la base.", format: FMT_MONEY, validation: positive },
  ],
  { proyecto: "EJEMPLO-001", numero: "FE-1001", fecha: new Date(Date.UTC(2024, 11, 10)), tipo: "NOTA_CREDITO", motivo: "Nota crédito por descuento acordado con el cliente", valor: 5000000 },
  ["NOTA_CREDITO, DESCUENTO y REDUCCION_CONTRATO reducen el valor y la base; COSTO_PROVEEDOR reduce solo la base."],
);

// ───────── Pagos_realizados ─────────
dataSheet(
  "Pagos_realizados",
  [
    { header: "liquidacion*", key: "liq", width: 14, required: true, hint: "Código del período: LIQ-AAAA-04 (abril) o LIQ-AAAA-10 (octubre). Ej. LIQ-2025-04 cubre recaudos de oct-2024 a mar-2025.", validation: { type: "textLength", operator: "equal", formulae: [11], error: "Formato LIQ-AAAA-04 o LIQ-AAAA-10." } },
    { header: "correo_colaborador*", key: "correo", width: 34, required: true },
    { header: "comision_neta_pagada*", key: "valor", width: 22, required: true, hint: "Lo que realmente se pagó en ese período, en COP.", format: FMT_MONEY, validation: money },
    { header: "fecha_pago", key: "fecha", width: 14, hint: "AAAA-MM-DD.", format: FMT_DATE, validation: date },
    { header: "referencia", key: "ref", width: 22, hint: "Número de transferencia o comprobante." },
  ],
  { liq: "LIQ-2025-04", correo: "colaborador@haptica.co", valor: 1800000, fecha: new Date(Date.UTC(2025, 3, 15)), ref: "TRX-0001" },
  ["Opcional. Se usa para comparar con el cálculo de la aplicación antes de aprobar cada liquidación histórica."],
);

await wb.xlsx.writeFile(out);
console.log(`Plantilla creada: ${out}`);
