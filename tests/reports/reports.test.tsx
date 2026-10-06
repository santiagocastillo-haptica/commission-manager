import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { renderAdministrativeXlsx } from "@/reports/excel";
import { renderAdministrativePdf } from "@/reports/pdf/administrative";
import { documentId, renderIndividualPdf } from "@/reports/pdf/individual";
import { settlementPeriod } from "@/domain/periods";
import type { ReportData } from "@/server/queries/settlements";

function line(i: number, project = "HAP-2026-001"): ReportData["collaborators"][number]["lines"][number] {
  return {
    id: `l${i}`,
    type: "COLLECTION",
    baseRate: "0.01",
    effectiveRate: "0.01",
    netBaseCOP: "80000000",
    commissionCOP: "800000",
    snapshot: {
      projectCode: project, projectName: "Proyecto de prueba con un nombre bastante largo para forzar el salto de línea", saleMonth: "2026-01", projectNetBase: "160000000",
      invoiceNumber: `FE-${i}`, invoiceDate: "2026-02-01", collectionDate: "2026-05-10", amountReceived: "90000000", collaboratorName: "Ana Prueba", collaboratorPosition: "Service Designer",
      client: "Cliente", currency: "COP", fxRate: "1", amountReceivedCOP: "90000000", saleAmountCOP: "180000000", saleDate: "2026-01-10", type: "COLLECTION", isLate: i % 7 === 0,
    },
  };
}

function data(lineCount: number): ReportData {
  const period = settlementPeriod(2026, "OCTOBER");
  const lines = Array.from({ length: lineCount }, (_, i) => line(i + 1, `HAP-2026-${String((i % 9) + 1).padStart(3, "0")}`));
  const gross = (lineCount * 800000).toString();
  return {
    settlement: { id: "s1", code: "LIQ-2026-10", label: "Octubre 2026", period, approvedAt: new Date("2026-10-05T15:00:00Z"), approver: "Administrador", totalGross: gross, totalAdjustments: "0", totalNet: gross },
    admin: {
      monthsCovered: ["2026-04", "2026-05"], salesInPeriodCOP: "750000000", collectedCOP: "400000000",
      collaborators: [{ collaboratorId: "c1", fullName: "Ana Prueba", position: "Service Designer", projectCodes: ["HAP-2026-001"], gross, adjustments: "0", carryoverIn: "0", netPayable: gross, carryoverOut: "0" }],
    },
    alerts: [{ key: "adj:p1", severity: "WARNING", message: "1 ajuste(s) pendiente(s) en HAP-2026-001: se aplicarán en esta liquidación." }],
    collaborators: [
      {
        csId: "cmabcdef123456", collaboratorId: "c1", gross, adjustments: "0", carryoverIn: "0", netPayable: gross, carryoverOut: "0", paymentStatus: "PENDING", paid: "0", lastPaymentDate: null,
        snapshot: {
          collaboratorId: "c1", fullName: "Ana Prueba", email: "ana@example.com", position: "Service Designer", policyCode: "GENERAL",
          projects: [
            { projectId: "p1", code: "HAP-2026-001", name: "Proyecto A", client: "Cliente", saleMonth: "2026-01", currency: "COP", netBase: "160000000", saleAmount: "180000000", invoiced: "180000000", collected: "180000000", pendingInvoice: false, pendingCollection: false, pendingPotentialCOP: "0", approvedInThisCOP: "1600000" },
            { projectId: "p2", code: "HAP-2026-002", name: "Proyecto B", client: "Cliente", saleMonth: "2026-02", currency: "USD", netBase: "40000", saleAmount: "50000", invoiced: "20000", collected: "10000", pendingInvoice: true, pendingCollection: true, pendingPotentialCOP: "1200000", approvedInThisCOP: "0" },
          ],
        },
        lines,
      },
    ],
  };
}

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
