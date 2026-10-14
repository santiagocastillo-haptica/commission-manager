import { bonusLines, renderBonusLetterPdf } from "@/reports/pdf/bonus-letter";
import { authorizedReport, fileResponse, recordReport, slug } from "@/server/report-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request, ctx: RouteContext<"/api/liquidaciones/[code]/bonificacion/[collaboratorId]">) {
  const { code, collaboratorId } = await ctx.params;
  const auth = await authorizedReport(code, { collaboratorId });
  if ("error" in auth) return auth.error;
  const collab = auth.data.collaborators.find((c) => c.collaboratorId === collaboratorId);
  if (!collab || bonusLines(collab).length === 0) return new Response("El colaborador no tiene bonificaciones en esta liquidación.", { status: 404 });
  const pdf = await renderBonusLetterPdf(auth.data, collab);
  await recordReport(auth.data.settlement.id, "BONUS_PDF", pdf, collaboratorId);
  return fileResponse(pdf, `Carta-Bonificacion-${code}-${slug(collab.snapshot.fullName)}.pdf`, "application/pdf", req);
}
