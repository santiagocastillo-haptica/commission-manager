import ExcelJS from "exceljs";
import { formatDate } from "@/domain/dates";
import type { ReportData } from "@/server/queries/settlements";
import { approvalLabel, indicators, paymentLabel } from "./pdf/administrative";

const GREEN = "FF003237";
const COP = '"$" #,##0.00;[Red]-"$" #,##0.00';
const PCT = "0.00%";

const n = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

function header(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 30;
}

/** Reporte administrativo consolidado en Excel: resumen, detalle por recaudo, indicadores y alertas. */
export async function renderAdministrativeXlsx(data: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Háptica Commission Manager";
  wb.created = new Date();
  const { settlement, admin } = data;

  // ── Resumen ──
  const ws = wb.addWorksheet("Resumen", { views: [{ state: "frozen", ySplit: 5 }] });
  ws.addRow([`Reporte administrativo de comisiones — ${settlement.label} (${settlement.code})`]).font = { bold: true, size: 14, color: { argb: GREEN } };
  ws.addRow([`Recaudos del ${formatDate(settlement.period.periodStart)} al ${formatDate(settlement.period.periodEnd)} · pago previsto ${formatDate(settlement.period.paymentDate)} · ${approvalLabel(data)}`]);
  ws.addRow(["Valores en COP, antes de IVA. Las cifras monetarias conservan hasta 6 decimales; el formato muestra 2."]).font = { italic: true, color: { argb: "FF6E7677" } };
  ws.addRow([]);
  header(ws.addRow(["Período", "Colaborador", "Cargo", "Proyectos asociados", "Comisión bruta", "Ajustes", "Saldo anterior", "Comisión neta", "Saldo que pasa a la siguiente liquidación", "Estado de aprobación", "Estado de pago", "Valor pagado"]));
  for (const a of admin.collaborators) {
    const c = data.collaborators.find((x) => x.collaboratorId === a.collaboratorId)!;
    ws.addRow([
      settlement.label, a.fullName, a.position, a.projectCodes.join(", "), n(a.gross), n(a.adjustments), n(a.carryoverIn), n(a.netPayable), n(a.carryoverOut),
      "Aprobada", paymentLabel(c.paymentStatus, c.netPayable), n(c.paid),
    ]);
  }
  const totalRow = ws.addRow(["", "Total", "", "", n(settlement.totalGross), n(settlement.totalAdjustments), null, n(settlement.totalNet), null, "", "", null]);
  totalRow.font = { bold: true };
  const first = 6;
  const last = 5 + admin.collaborators.length;
  if (admin.collaborators.length > 0) {
    totalRow.getCell(7).value = { formula: `SUM(G${first}:G${last})` };
    totalRow.getCell(9).value = { formula: `SUM(I${first}:I${last})` };
    totalRow.getCell(12).value = { formula: `SUM(L${first}:L${last})` };
  }
  [5, 6, 7, 8, 9, 12].forEach((col) => {
    ws.getColumn(col).numFmt = COP;
    ws.getColumn(col).width = 18;
  });
  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 28;
  ws.getColumn(3).width = 26;
  ws.getColumn(4).width = 34;
  ws.getColumn(9).width = 22;
  ws.getColumn(10).width = 16;
  ws.getColumn(11).width = 20;

  // ── Detalle ──
  const wd = wb.addWorksheet("Detalle", { views: [{ state: "frozen", ySplit: 1 }] });
  header(wd.addRow(["Colaborador", "Tipo", "Mes de venta", "Código", "Cliente", "Base neta del proyecto", "Factura", "Fecha factura", "Fecha recaudo", "Moneda", "Valor recaudado", "TRM", "Base neta del recaudo (COP)", "% base", "% efectivo", "Comisión (COP)", "Extemporáneo"]));
  for (const c of data.collaborators) {
    for (const l of c.lines) {
      const sn = l.snapshot;
      wd.addRow([
        sn.collaboratorName, l.type === "ADJUSTMENT" ? "Ajuste" : "Recaudo", sn.saleMonth, sn.projectCode, sn.client, n(sn.projectNetBase), sn.invoiceNumber ?? "",
        sn.invoiceDate ?? "", sn.collectionDate ?? "", sn.currency, n(sn.amountReceived), sn.currency === "COP" ? null : n(sn.fxRate), n(l.netBaseCOP), n(l.baseRate), n(l.effectiveRate), n(l.commissionCOP), sn.isLate ? "Sí" : "",
      ]);
    }
  }
  [7, 12, 13, 14, 17].forEach((col) => (wd.getColumn(col).numFmt = COP));
  [15, 16].forEach((col) => (wd.getColumn(col).numFmt = "0.00%"));
  wd.columns.forEach((col, i) => (col.width = [26, 10, 12, 16, 34, 26, 20, 12, 13, 13, 9, 18, 12, 20, 9, 10, 20, 13][i] ?? 14));
  wd.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 18 } };

  // ── Indicadores ──
  const wi = wb.addWorksheet("Indicadores");
  const ind = indicators(data);
  header(wi.addRow(["Indicador", "Valor", "Nota"]));
  wi.addRow(["Ventas del período (COP)", n(ind.sales.toFixed()), `Meses de venta ${admin.monthsCovered.join(", ")} (validados)`]).getCell(2).numFmt = COP;
  wi.addRow(["Ingresos recaudados que generaron comisión (COP)", n(ind.collected.toFixed()), "Antes de IVA, recaudos del período"]).getCell(2).numFmt = COP;
  wi.addRow(["Comisión bruta (COP)", n(ind.gross.toFixed()), ""]).getCell(2).numFmt = COP;
  wi.addRow(["Comisión neta (COP)", n(ind.net.toFixed()), "Bruta + ajustes + saldos arrastrados"]).getCell(2).numFmt = COP;
  const r1 = wi.addRow(["Comisión neta / ventas", ind.netOverSales ? Number(ind.netOverSales.toFixed(8)) : null, "Orientativo: los recaudos pueden corresponder a ventas de períodos anteriores"]);
  r1.getCell(2).numFmt = PCT;
  const r2 = wi.addRow(["Comisión bruta / recaudado", ind.grossOverCollected ? Number(ind.grossOverCollected.toFixed(8)) : null, ""]);
  r2.getCell(2).numFmt = PCT;
  const r3 = wi.addRow(["Recaudado / ventas", ind.collectedOverSales ? Number(ind.collectedOverSales.toFixed(8)) : null, ""]);
  r3.getCell(2).numFmt = PCT;
  wi.getColumn(1).width = 50;
  wi.getColumn(2).width = 22;
  wi.getColumn(3).width = 70;

  // ── Alertas ──
  const wa = wb.addWorksheet("Alertas reconocidas");
  header(wa.addRow(["Severidad", "Mensaje"]));
  for (const a of data.alerts) wa.addRow([a.severity === "WARNING" ? "Advertencia" : a.severity === "INFO" ? "Informativa" : a.severity, a.message]);
  wa.getColumn(1).width = 16;
  wa.getColumn(2).width = 120;

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
