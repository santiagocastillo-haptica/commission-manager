/**
 * Revisa la plantilla de historia de comisiones y genera un Excel con los hallazgos (solo lectura; no toca datos).
 *   npx tsx scripts/revisar-plantilla.ts <plantilla.xlsx> [salida.xlsx]
 * Usa exactamente el mismo lector y las mismas reglas que la pantalla «Configuración → Importar historia».
 */
import ExcelJS from "exceljs";
import path from "node:path";
import { parseHistoryWorkbook, sortIssues, type HistoryIssue } from "../src/server/import/history";

const input = process.argv[2];
if (!input) {
  console.error("Uso: npx tsx scripts/revisar-plantilla.ts <plantilla.xlsx> [salida.xlsx]");
  process.exit(1);
}
const output = path.resolve(process.argv[3] ?? "Revision-plantilla.xlsx");

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(input);
  const { plan, issues } = parseHistoryWorkbook(wb);
  const sorted = sortIssues(issues);

  const out = new ExcelJS.Workbook();
  const FILL: Record<HistoryIssue["severity"], string> = { Bloqueante: "FFF8D7DA", Decisión: "FFFFF3CD", Menor: "FFE2F0D9", Info: "FFDDEBF7" };
  const header = (ws: ExcelJS.Worksheet) =>
    ws.getRow(1).eachCell((c) => {
      c.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF006663" } };
    });

  const ws = out.addWorksheet("Revisión", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Prioridad", width: 13 }, { header: "Tipo", width: 36 }, { header: "Hoja", width: 17 }, { header: "Fila", width: 9 },
    { header: "Código proyecto", width: 24 }, { header: "Detalle", width: 85 }, { header: "Qué hacer", width: 75 }, { header: "Estado", width: 22 },
  ];
  for (const i of sorted) ws.addRow([i.severity, i.type, i.sheet, i.row, i.code, i.detail, i.action, ""]);
  header(ws);
  ws.eachRow((r, n) => {
    if (n === 1) return;
    r.eachCell((c) => { c.font = { name: "Arial", size: 10 }; c.alignment = { wrapText: true, vertical: "top" }; });
    r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[r.getCell(1).value as HistoryIssue["severity"]] } };
  });
  ws.autoFilter = { from: "A1", to: "H1" };

  const rs = out.addWorksheet("Resumen");
  rs.columns = [{ width: 52 }, { width: 14 }];
  const cnt = new Map<string, number>();
  for (const i of sorted) cnt.set(`${i.severity} · ${i.type}`, (cnt.get(`${i.severity} · ${i.type}`) ?? 0) + 1);
  rs.addRow(["Hallazgo", "Cantidad"]).font = { name: "Arial", bold: true };
  for (const [k, n] of [...cnt].sort()) rs.addRow([k, n]).font = { name: "Arial", size: 10 };
  rs.addRow([]);
  const invoices = plan.projects.flatMap((p) => p.invoices);
  for (const [k, n] of [
    ["Proyectos", plan.projects.length], ["Asignaciones", plan.projects.reduce((a, p) => a + p.assignments.length, 0)], ["Facturas emitidas", invoices.filter((i) => i.status === "ISSUED").length],
    ["Facturas previstas", invoices.filter((i) => i.status === "PLANNED").length], ["Recaudos", invoices.reduce((a, i) => a + i.collections.length, 0)], ["Pagos realizados (filas)", plan.payments.length],
  ] as const) rs.addRow([k, n]).font = { name: "Arial", size: 10 };

  const rc = out.addWorksheet("Correos");
  rc.columns = [{ header: "Correos que deben existir como colaboradores en la aplicación", width: 62 }, { header: "Asignaciones", width: 14 }];
  header(rc);
  for (const e of plan.emails) rc.addRow([e, plan.projects.reduce((a, p) => a + p.assignments.filter((x) => x.email === e).length, 0)]).font = { name: "Arial", size: 10 };

  await out.xlsx.writeFile(output);
  console.log(`Hallazgos: ${sorted.length} (bloqueantes ${sorted.filter((i) => i.severity === "Bloqueante").length}) → ${output}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
