import { settlementPeriod } from "@/domain/periods";
import type { ReportData } from "@/server/queries/settlements";

/** Datos SINTÉTICOS para probar la generación de reportes (pruebas y diagnóstico en producción). No son datos reales. */
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

export function sampleReportData(lineCount: number): ReportData {
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
