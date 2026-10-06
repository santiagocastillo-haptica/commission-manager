import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { renderAdministrativeXlsx } from "@/reports/excel";
import { renderAdministrativePdf } from "@/reports/pdf/administrative";
import { documentId, renderIndividualPdf } from "@/reports/pdf/individual";
import { sampleReportData as data } from "@/reports/sample";

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-";
const pageCount = (b: Buffer) => (b.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

describe("reportes", () => {
  it("genera el PDF individual con un identificador único trazable", async () => {
    const d = data(4);
    const pdf = await renderIndividualPdf(d, d.collaborators[0]);
    expect(isPdf(pdf)).toBe(true);
    expect(documentId("LIQ-2026-10", "cmabcdef123456")).toBe("LIQ-2026-10-123456");
    expect(pdf.length).toBeGreaterThan(3000);
  });

  it("pagina automáticamente cuando hay muchas filas (la tabla no se corta)", async () => {
    const few = data(4);
    const many = data(70);
    const a = await renderIndividualPdf(few, few.collaborators[0]);
    const b = await renderIndividualPdf(many, many.collaborators[0]);
    expect(pageCount(b)).toBeGreaterThan(pageCount(a));
    expect(pageCount(b)).toBeGreaterThanOrEqual(3);
  });

  it("genera el reporte administrativo en PDF", async () => {
    expect(isPdf(await renderAdministrativePdf(data(5)))).toBe(true);
  });

  it("genera el Excel administrativo con resumen, detalle, indicadores y alertas", async () => {
    const buf = await renderAdministrativeXlsx(data(5));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Resumen", "Detalle", "Indicadores", "Alertas reconocidas"]);
    const resumen = wb.getWorksheet("Resumen")!;
    expect(resumen.getRow(6).getCell(2).value).toBe("Ana Prueba");
    expect(resumen.getRow(6).getCell(8).value).toBe(4000000); // comisión neta
    expect(wb.getWorksheet("Detalle")!.rowCount).toBe(6); // encabezado + 5 líneas
  });
});
