import ExcelJS from "exceljs";
import type { Arqueo } from "./history-load";

/** Excel del arqueo trimestral (una hoja por trimestre, una por colaborador y las notas). */
export async function arqueoWorkbook(a: Arqueo): Promise<Buffer> {
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
  return Buffer.from(await wb.xlsx.writeBuffer());
}
