import "server-only";
import { createHash } from "node:crypto";
import { C, newId, now, ref, type GeneratedReportDoc } from "@/store";
import { getSession } from "./auth";
import { getReportData, type ReportData } from "./queries/settlements";

export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export async function authorizedReport(code: string): Promise<{ data: ReportData } | { error: Response }> {
  if (!(await getSession())) return { error: new Response("No autorizado", { status: 401 }) };
  const data = await getReportData(code);
  if (!data) return { error: new Response("La liquidación no existe o aún no está aprobada.", { status: 404 }) };
  return { data };
}

/** Deja constancia de cada reporte generado con la huella (SHA-256) de su contenido. */
export async function recordReport(settlementCode: string, kind: GeneratedReportDoc["kind"], buffer: Buffer, collaboratorId?: string) {
  const id = newId();
  const doc: GeneratedReportDoc = { id, settlementCode, collaboratorId: collaboratorId ?? null, kind, sha256: createHash("sha256").update(buffer).digest("hex"), generatedAt: now() };
  await ref(C.generatedReports, id).set(doc);
}

/** `?ver=1` muestra el archivo en el navegador en lugar de descargarlo. */
export function fileResponse(buffer: Buffer, filename: string, contentType: string, req?: Request) {
  const inline = req ? new URL(req.url).searchParams.get("ver") === "1" : false;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
