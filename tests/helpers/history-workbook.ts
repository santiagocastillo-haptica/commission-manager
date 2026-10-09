import ExcelJS from "exceljs";

type Cells = (string | number | null)[];

/** Arma en memoria una plantilla de historia (con la fila de ejemplo, que el lector debe ignorar). */
export function historyWorkbook(
  sheets: { Proyectos?: Cells[]; Asignaciones?: Cells[]; Facturas?: Cells[]; Recaudos?: Cells[]; Ajustes?: Cells[]; Pagos_realizados?: Cells[] },
  opts: { synthesized?: boolean } = {},
) {
  const wb = new ExcelJS.Workbook();
  const heads: Record<string, string[]> = {
    Proyectos: ["codigo*", "cliente*", "pais*", "fecha_venta*", "moneda*", "valor_venta_sin_iva*", "costos_proveedores_sin_iva*", "trm_venta", "facturas_previstas*", "observaciones"],
    Asignaciones: ["codigo_proyecto*", "correo_colaborador*", "porcentaje*"],
    Facturas: ["codigo_proyecto*", "numero_factura", "estado*", "fecha_emision", opts.synthesized === false ? "fecha_vencimiento" : "fecha_recaudo", "valor_sin_iva*", "base_neta_explicita", "observaciones"],
    Recaudos: ["codigo_proyecto*", "numero_factura*", "fecha_recaudo*", "valor_recibido*", "trm_recaudo", "es_excedente", "justificacion", "observaciones"],
    Ajustes: ["codigo_proyecto*", "numero_factura", "fecha*", "tipo*", "motivo*", "valor*"],
    Pagos_realizados: ["liquidacion*", "correo_colaborador*", "comision_neta_pagada*", "fecha_pago", "referencia"],
  };
  const examples: Record<string, Cells> = {
    Proyectos: ["EJEMPLO-001", "Banco Ejemplo", "CO", "2024-10-08", "COP", 180000000, 20000000, null, 2, ""],
    Asignaciones: ["EJEMPLO-001", "colaborador@haptica.co", 1],
    Facturas: ["EJEMPLO-001", "FE-1001", "EMITIDA", "2024-10-20", "2024-11-19", 90000000, null, ""],
  };
  for (const [name, head] of Object.entries(heads)) {
    const rows = (sheets as Record<string, Cells[] | undefined>)[name];
    if (!rows && name !== "Proyectos" && name !== "Asignaciones" && name !== "Facturas") continue;
    const ws = wb.addWorksheet(name);
    ws.addRow(head);
    if (examples[name]) ws.addRow(examples[name]);
    for (const r of rows ?? []) ws.addRow(r);
  }
  return wb;
}
