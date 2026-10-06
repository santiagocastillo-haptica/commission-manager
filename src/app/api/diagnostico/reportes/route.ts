import { renderAdministrativeXlsx } from "@/reports/excel";
import { renderAdministrativePdf } from "@/reports/pdf/administrative";
import { renderIndividualPdf } from "@/reports/pdf/individual";
import { sampleReportData } from "@/reports/sample";
import { getSession } from "@/server/auth";
import { fileResponse } from "@/server/report-http";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Diagnóstico: genera un reporte con datos SINTÉTICOS para comprobar que PDF y Excel funcionan en este entorno
 * (empaquetado, fuentes, memoria). Requiere sesión; no lee ni escribe datos reales.
 * ?tipo=individual | administrativo-pdf | administrativo-xlsx
 */
export async function GET(req: Request) {
  if (!(await getSession())) return new Response("No autorizado", { status: 401 });
  const tipo = new URL(req.url).searchParams.get("tipo") ?? "individual";
  const data = sampleReportData(40);
  data.settlement = { ...data.settlement, label: "MUESTRA DE DIAGNÓSTICO", approver: "Datos sintéticos" };
  if (tipo === "individual") return fileResponse(await renderIndividualPdf(data, data.collaborators[0]), "Diagnostico-individual.pdf", "application/pdf", req);
  if (tipo === "administrativo-pdf") return fileResponse(await renderAdministrativePdf(data), "Diagnostico-administrativo.pdf", "application/pdf", req);
  if (tipo === "administrativo-xlsx") {
    return fileResponse(await renderAdministrativeXlsx(data), "Diagnostico-administrativo.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", req);
  }
  return new Response("Tipo no válido. Usa: individual, administrativo-pdf o administrativo-xlsx.", { status: 400 });
}
