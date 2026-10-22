import { Document, Image, Page, renderToBuffer, Text, View } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { LOGO_PNG } from "../logo";
import { formatDate } from "@/domain/dates";
import { D, formatMoney } from "@/domain/money";
import type { ReportData } from "@/server/queries/settlements";
import { renderAdministrativePdf } from "./administrative";
import { bonusLines, renderBonusLetterPdf } from "./bonus-letter";
import { hasNaturalReport, renderIndividualPdf } from "./individual";
import { C, styles as s } from "./theme";

/** Una entrada del contenido: el PDF que la compone y la página donde empieza en el documento completo. */
interface Part {
  section: "ADMIN" | "INDIVIDUAL" | "BONUS";
  title: string;
  detail?: string;
  pdf: Buffer;
  pages: number;
  start: number;
}

const SECTIONS = {
  ADMIN: "Reporte administrativo",
  INDIVIDUAL: "Reportes de comisiones por colaborador",
  BONUS: "Cartas de bonificación",
} as const;

const generatedAt = () => new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "long", timeStyle: "short" });

function Cover({ data, parts }: { data: ReportData; parts: Part[] }) {
  const { settlement } = data;
  const bySection = (k: Part["section"]) => parts.filter((p) => p.section === k);
  const people = data.collaborators.length;
  return (
    <Document title={`Reportes de comisiones ${settlement.code}`} author="Háptica" subject={`Liquidación ${settlement.label}`} creator="Háptica Commission Manager">
      <Page size="A4" orientation="landscape" style={{ fontFamily: "Helvetica", color: C.texto }}>
        {/* Franja lateral */}
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 26, backgroundColor: C.profundo }} />
        <View style={{ position: "absolute", top: 0, left: 26, width: 6, height: 150, backgroundColor: C.naranja }} />

        <View style={{ paddingTop: 44, paddingLeft: 78, paddingRight: 52 }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- el Image de react-pdf no admite alt */}
          <Image src={LOGO_PNG} style={{ width: 190 }} />
          <Text style={[s.wordmarkSub, { marginTop: 6 }]}>COMMISSION MANAGER</Text>

          <View style={{ flexDirection: "row", marginTop: 46 }}>
            <View style={{ flexGrow: 1, paddingRight: 36 }}>
              <Text style={s.eyebrow}>Liquidación de comisiones</Text>
              <Text style={{ fontSize: 34, fontFamily: "Helvetica-Bold", color: C.profundo, marginTop: 8, lineHeight: 1.1 }}>Reportes de Comisiones</Text>
              <View style={{ width: 70, height: 4, backgroundColor: C.naranja, marginTop: 14, marginBottom: 14 }} />
              <Text style={{ fontSize: 20, color: C.petroleo, fontFamily: "Helvetica-Bold" }}>{settlement.label}</Text>
              <Text style={{ fontSize: 9.5, color: C.gris600, marginTop: 4 }}>
                {settlement.code} · Recaudos del {formatDate(settlement.period.periodStart)} al {formatDate(settlement.period.periodEnd)}
              </Text>

              <View style={{ marginTop: 30, gap: 11 }}>
                <Meta label="Fecha de pago prevista" value={formatDate(settlement.period.paymentDate)} />
                <Meta label="Aprobación" value={`${formatDate(settlement.approvedAt.toISOString().slice(0, 10))}${settlement.approver ? ` · ${settlement.approver}` : ""}`} />
                <Meta label="Colaboradores" value={String(people)} />
                <Meta label="Total neto a pagar" value={formatMoney(D(settlement.totalNet), "COP", 2)} strong />
              </View>
            </View>

            {/* Contenido */}
            <View style={{ width: 330, borderLeftWidth: 0.75, borderLeftColor: C.gris200, paddingLeft: 22 }}>
              <Text style={s.eyebrow}>Contenido</Text>
              {(["ADMIN", "INDIVIDUAL", "BONUS"] as const).map((k) => {
                const items = bySection(k);
                if (items.length === 0) return null;
                return (
                  <View key={k} style={{ marginTop: 12 }}>
                    <Text style={{ fontSize: 9.5, fontFamily: "Helvetica-Bold", color: C.profundo }}>{SECTIONS[k]}</Text>
                    {items.map((p, i) => (
                      <View key={`${k}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 3.5, paddingBottom: 2.5, borderBottomWidth: 0.5, borderBottomColor: C.gris200 }}>
                        <Text style={{ fontSize: 8.5, width: 250 }}>
                          {k === "ADMIN" ? "Resumen general de la liquidación" : p.title}
                          {p.detail ? <Text style={{ color: C.gris600 }}> · {p.detail}</Text> : null}
                        </Text>
                        <Text style={{ fontSize: 8.5, color: C.gris600 }}>pág. {p.start}</Text>
                      </View>
                    ))}
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        <View style={{ position: "absolute", bottom: 0, left: 32, right: 0, height: 34, backgroundColor: C.menta100, paddingLeft: 46, paddingRight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 8, color: C.profundo, fontFamily: "Helvetica-Bold" }}>Historias con tacto</Text>
          <Text style={{ fontSize: 7.5, color: C.gris600 }}>Documento generado el {generatedAt()} (hora de Colombia) · Reúne todos los reportes de la liquidación</Text>
        </View>
      </Page>
    </Document>
  );
}

function Meta({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View>
      <Text style={s.eyebrow}>{label}</Text>
      <Text style={{ fontSize: strong ? 15 : 11, fontFamily: "Helvetica-Bold", marginTop: 2, color: strong ? C.petroleo : C.texto }}>{value}</Text>
    </View>
  );
}

const pageCount = async (pdf: Buffer) => (await PDFDocument.load(pdf)).getPageCount();

/**
 * Todos los reportes de la liquidación en un solo PDF: portada con contenido, reporte administrativo, el reporte de
 * comisiones de cada colaborador y las cartas de bonificación. Cada parte conserva su diseño y su numeración.
 */
export async function renderCompletePdf(data: ReportData): Promise<Buffer> {
  const parts: Omit<Part, "start">[] = [];
  const admin = await renderAdministrativePdf(data);
  parts.push({ section: "ADMIN", title: SECTIONS.ADMIN, pdf: admin, pages: await pageCount(admin) });
  for (const c of data.collaborators) {
    if (!hasNaturalReport(c)) continue;
    const pdf = await renderIndividualPdf(data, c);
    parts.push({ section: "INDIVIDUAL", title: c.snapshot.fullName, detail: c.snapshot.position, pdf, pages: await pageCount(pdf) });
  }
  for (const c of data.collaborators) {
    if (bonusLines(c).length === 0) continue;
    const pdf = await renderBonusLetterPdf(data, c);
    parts.push({ section: "BONUS", title: c.snapshot.fullName, detail: c.snapshot.position, pdf, pages: await pageCount(pdf) });
  }

  // La portada ocupa la página 1, así que las demás partes empiezan en la 2.
  let next = 2;
  const placed: Part[] = parts.map((p) => {
    const start = next;
    next += p.pages;
    return { ...p, start };
  });

  const out = await PDFDocument.create();
  const cover = await PDFDocument.load(await renderToBuffer(<Cover data={data} parts={placed} />));
  for (const page of await out.copyPages(cover, cover.getPageIndices())) out.addPage(page);
  for (const p of placed) {
    const doc = await PDFDocument.load(p.pdf);
    for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page);
  }
  out.setTitle(`Reportes de comisiones ${data.settlement.code}`);
  out.setAuthor("Háptica");
  out.setSubject(`Liquidación ${data.settlement.label}`);
  out.setCreator("Háptica Commission Manager");
  return Buffer.from(await out.save());
}
