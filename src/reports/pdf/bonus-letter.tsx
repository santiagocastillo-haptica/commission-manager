import { Document, Image, Page, renderToBuffer, Text, View } from "@react-pdf/renderer";
import { LOGO_PNG } from "../logo";
import { D, formatMoney, ZERO } from "@/domain/money";
import { copInWords } from "@/lib/number-words";
import type { ReportData } from "@/server/queries/settlements";
import { C } from "./theme";

type Collab = ReportData["collaborators"][number];

/** Quien firma la carta en nombre de la compañía. */
const SIGNER = { name: "SANTIAGO CASTILLO", role: "Gerente Ejecutivo", company: "HÁPTICA S.A.S." };

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} de ${MONTHS[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;

/** Líneas de bonificación del colaborador (las comisiones «naturales» van en el otro PDF). */
export const bonusLines = (collab: Collab) => collab.lines.filter((l) => l.snapshot.bonus);
export const bonusTotal = (collab: Collab) => bonusLines(collab).reduce((acc, l) => acc.plus(l.commissionCOP), ZERO);

const body = { fontSize: 10.5, lineHeight: 1.45, textAlign: "justify" as const };

function LetterDoc({ data, collab }: { data: ReportData; collab: Collab }) {
  const { settlement } = data;
  const name = collab.snapshot.fullName.toUpperCase();
  const amount = Math.round(bonusTotal(collab).toNumber());
  return (
    <Document title={`Carta de bonificación ${settlement.code} — ${collab.snapshot.fullName}`} author="Háptica" subject={`Bonificación ${settlement.label}`} creator="Háptica Commission Manager">
      <Page size="A4" style={{ paddingTop: 36, paddingBottom: 48, paddingHorizontal: 64, fontFamily: "Helvetica", color: C.texto }}>
        <View style={{ alignItems: "flex-end" }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- el Image de react-pdf no admite alt */}
          <Image src={LOGO_PNG} style={{ width: 150 }} />
        </View>

        <Text style={[body, { marginTop: 28 }]}>Bogotá, {longDate(settlement.approvedAt.toISOString().slice(0, 10))}</Text>

        <Text style={[body, { marginTop: 26 }]}>Señor</Text>
        <Text style={[body, { fontFamily: "Helvetica-Bold" }]}>{name}</Text>
        <Text style={body}>La Ciudad</Text>

        <Text style={[body, { marginTop: 18 }]}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Referencia:</Text> Reconocimiento bonificación (prima extralegal) no salarial por mera liberalidad.
        </Text>

        <Text style={[body, { marginTop: 26 }]}>
          Por medio de la presente <Text style={{ fontFamily: "Helvetica-Bold" }}>HÁPTICA S.A.S.</Text> tiene el agrado de informarle que el día {longDate(settlement.period.paymentDate)}, usted recibirá una prima extralegal de mera liberalidad no
          salarial correspondiente a la suma de{" "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>
            {copInWords(amount)} ({formatMoney(amount, "COP", 0)})
          </Text>
          .
        </Text>

        <Text style={[body, { marginTop: 14 }]}>
          El anterior beneficio se otorga por mera liberalidad de la compañía y dejando expresa constancia de que se trata de un pago no constitutivo de salario para ningún efecto, de conformidad con lo establecido en el artículo 128 del Código
          Sustantivo del Trabajo. En tal sentido, se aclara que este pago no compensa de manera alguna los servicios prestados y por lo tanto no hay expectativa ni compromiso de pagos periódicos o futuros.
        </Text>

        <Text style={[body, { marginTop: 18 }]}>Cordialmente,</Text>

        <View style={{ marginTop: 56, width: 190, borderTopWidth: 0.75, borderTopColor: C.texto, paddingTop: 4 }}>
          <Text style={[body, { fontFamily: "Helvetica-Bold" }]}>{SIGNER.name}</Text>
          <Text style={[body, { fontFamily: "Helvetica-Bold" }]}>{SIGNER.role}</Text>
          <Text style={[body, { fontFamily: "Helvetica-Bold" }]}>{SIGNER.company}</Text>
        </View>

        <Text style={[body, { marginTop: 34 }]}>
          En señal de recibo y de acuerdo con la condición no salarial de la presente bonificación, suscribe <Text style={{ fontFamily: "Helvetica-Bold" }}>EL TRABAJADOR:</Text>
        </Text>

        <View style={{ marginTop: 40 }} wrap={false}>
          <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
            <Text style={[body, { width: 70, fontFamily: "Helvetica-Bold" }]}>FIRMA:</Text>
            <View style={{ width: 230, borderBottomWidth: 0.75, borderBottomColor: C.texto, height: 14 }} />
          </View>
          <View style={{ flexDirection: "row", marginTop: 6 }}>
            <Text style={[body, { width: 70, fontFamily: "Helvetica-Bold" }]}>NOMBRE:</Text>
            <Text style={[body, { fontFamily: "Helvetica-Bold" }]}>{name}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 6 }}>
            <Text style={[body, { width: 70, fontFamily: "Helvetica-Bold" }]}>CÉDULA:</Text>
            <View style={{ width: 160, borderBottomWidth: 0.75, borderBottomColor: C.texto, height: 14 }} />
          </View>
        </View>

        <Text style={{ position: "absolute", bottom: 20, left: 64, right: 64, fontSize: 6.8, color: C.gris600 }} fixed>
          Liquidación {settlement.code} · Bonificación de {collab.snapshot.fullName}. Valor aprobado: {formatMoney(D(bonusTotal(collab)), "COP", 2)}.
        </Text>
      </Page>
    </Document>
  );
}

export function renderBonusLetterPdf(data: ReportData, collab: Collab): Promise<Buffer> {
  return renderToBuffer(<LetterDoc data={data} collab={collab} />);
}
