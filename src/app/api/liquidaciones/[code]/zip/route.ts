import JSZip from "jszip";
import { bonusLines, renderBonusLetterPdf } from "@/reports/pdf/bonus-letter";
import { hasNaturalReport, renderIndividualPdf } from "@/reports/pdf/individual";
import { authorizedReport, fileResponse, recordReport, slug } from "@/server/report-http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Un PDF de comisiones por colaborador y, si tiene bonificaciones, su carta de bonificación aparte, en un único ZIP. */
export async function GET(_req: Request, ctx: RouteContext<"/api/liquidaciones/[code]/zip">) {
  const { code } = await ctx.params;
  const auth = await authorizedReport(code);
  if ("error" in auth) return auth.error;
  const zip = new JSZip();
  for (const collab of auth.data.collaborators) {
    if (hasNaturalReport(collab)) {
      const pdf = await renderIndividualPdf(auth.data, collab);
      await recordReport(auth.data.settlement.id, "INDIVIDUAL_PDF", pdf, collab.collaboratorId);
      zip.file(`Reporte-Comisiones-${code}-${slug(collab.snapshot.fullName)}.pdf`, pdf);
    }
    if (bonusLines(collab).length > 0) {
      const letter = await renderBonusLetterPdf(auth.data, collab);
      await recordReport(auth.data.settlement.id, "BONUS_PDF", letter, collab.collaboratorId);
      zip.file(`Carta-Bonificacion-${code}-${slug(collab.snapshot.fullName)}.pdf`, letter);
    }
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return fileResponse(buffer, `Reportes-Comisiones-${code}.zip`, "application/zip");
}
