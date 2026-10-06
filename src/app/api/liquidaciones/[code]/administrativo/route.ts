import { renderAdministrativePdf } from "@/reports/pdf/administrative";
import { renderAdministrativeXlsx } from "@/reports/excel";
import { authorizedReport, fileResponse, recordReport } from "@/server/report-http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Reporte administrativo consolidado: ?formato=pdf (por defecto) o ?formato=xlsx. */
export async function GET(req: Request, ctx: RouteContext<"/api/liquidaciones/[code]/administrativo">) {
  const { code } = await ctx.params;
  const auth = await authorizedReport(code);
  if ("error" in auth) return auth.error;
  const xlsx = new URL(req.url).searchParams.get("formato") === "xlsx";
  if (xlsx) {
    const file = await renderAdministrativeXlsx(auth.data);
    await recordReport(auth.data.settlement.id, "ADMIN_XLSX", file);
    return fileResponse(file, `Reporte-Administrativo-${code}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", req);
  }
  const pdf = await renderAdministrativePdf(auth.data);
  await recordReport(auth.data.settlement.id, "ADMIN_PDF", pdf);
  return fileResponse(pdf, `Reporte-Administrativo-${code}.pdf`, "application/pdf", req);
}
