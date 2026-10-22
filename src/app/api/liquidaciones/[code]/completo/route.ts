import { renderCompletePdf } from "@/reports/pdf/complete";
import { authorizedReport, fileResponse, recordReport } from "@/server/report-http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Todos los reportes de la liquidación (administrativo, por colaborador y cartas de bonificación) en un solo PDF con portada. */
export async function GET(req: Request, ctx: RouteContext<"/api/liquidaciones/[code]/completo">) {
  const { code } = await ctx.params;
  const auth = await authorizedReport(code);
  if ("error" in auth) return auth.error;
  const pdf = await renderCompletePdf(auth.data);
  await recordReport(auth.data.settlement.id, "FULL_PDF", pdf);
  return fileResponse(pdf, `Reportes-Completos-${code}.pdf`, "application/pdf", req);
}
