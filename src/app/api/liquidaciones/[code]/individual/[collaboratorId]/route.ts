import { renderIndividualPdf } from "@/reports/pdf/individual";
import { authorizedReport, fileResponse, recordReport, slug } from "@/server/report-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request, ctx: RouteContext<"/api/liquidaciones/[code]/individual/[collaboratorId]">) {
  const { code, collaboratorId } = await ctx.params;
  const auth = await authorizedReport(code);
  if ("error" in auth) return auth.error;
  const collab = auth.data.collaborators.find((c) => c.collaboratorId === collaboratorId);
  if (!collab) return new Response("El colaborador no tiene comisiones en esta liquidación.", { status: 404 });
  const pdf = await renderIndividualPdf(auth.data, collab);
  await recordReport(auth.data.settlement.id, "INDIVIDUAL_PDF", pdf, collaboratorId);
  return fileResponse(pdf, `Reporte-Comisiones-${code}-${slug(collab.snapshot.fullName)}.pdf`, "application/pdf", req);
}
