import { Document, Image, Page, renderToBuffer, Text, View } from "@react-pdf/renderer";
import { LOGO_PNG } from "../logo";
import { formatDate } from "@/domain/dates";
import { D, formatMoney, formatPercent, ZERO } from "@/domain/money";
import type { ReportData } from "@/server/queries/settlements";
import { C, styles as s } from "./theme";

export const approvalLabel = (d: ReportData) => `Aprobada el ${formatDate(d.settlement.approvedAt.toISOString().slice(0, 10))}`;
export const paymentLabel = (st: "PENDING" | "PARTIAL" | "PAID", net: string) => (D(net).isZero() ? "Sin valor a pagar" : st === "PAID" ? "Pagada" : st === "PARTIAL" ? "Pago parcial" : "Pendiente de pago");

/** Indicadores para comparar el costo de las comisiones con las ventas y los ingresos recaudados. */
export function indicators(data: ReportData) {
  const net = D(data.settlement.totalNet);
  const gross = D(data.settlement.totalGross);
  const sales = D(data.admin.salesInPeriodCOP);
  const collected = D(data.admin.collectedCOP);
  const ratio = (num: ReturnType<typeof D>, den: ReturnType<typeof D>) => (den.isZero() ? null : num.div(den));
  return {
    sales,
    collected,
    gross,
    net,
    grossOverCollected: ratio(gross, collected),
    netOverSales: ratio(net, sales),
    collectedOverSales: ratio(collected, sales),
  };
}

const W = [150, 150, 78, 72, 72, 78, 82, 84] as const;
const cellStyle = (i: number, right = false) => ({ width: W[i], paddingRight: 4, textAlign: right ? ("right" as const) : ("left" as const) });

function AdminDoc({ data }: { data: ReportData }) {
  const { settlement, admin } = data;
  const generated = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
  const ind = indicators(data);
  const carry = data.collaborators.reduce((a, c) => a.plus(c.carryoverIn), ZERO);

  return (
    <Document title={`Reporte administrativo ${settlement.code}`} author="Háptica" creator="Háptica Commission Manager">
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.footer} fixed>
          <Text>Reporte administrativo · {settlement.code}</Text>
          <Text>Generado el {generated} (hora de Colombia)</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- el Image de react-pdf no admite alt */}
            <Image src={LOGO_PNG} style={{ width: 150 }} />
            <Text style={s.wordmarkSub}>COMMISSION MANAGER</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.eyebrow}>Liquidación</Text>
            <Text style={[s.bold, { fontSize: 10, marginTop: 2 }]}>{settlement.code}</Text>
          </View>
        </View>
        <View style={s.rail} />
        <Text style={s.title}>Reporte administrativo de comisiones</Text>
        <Text style={[s.muted, { marginTop: 3 }]}>
          {settlement.label} · recaudos del {formatDate(settlement.period.periodStart)} al {formatDate(settlement.period.periodEnd)} · pago previsto el {formatDate(settlement.period.paymentDate)} · {approvalLabel(data)}
          {settlement.approver ? ` por ${settlement.approver}` : ""}
        </Text>

        <Text style={s.h2}>Costo de las comisiones por colaborador</Text>
        <View style={s.table}>
          <View style={s.th} fixed>
            <Text style={cellStyle(0)}>Colaborador</Text>
            <Text style={cellStyle(1)}>Proyectos asociados</Text>
            <Text style={cellStyle(2, true)}>Comisión bruta</Text>
            <Text style={cellStyle(3, true)}>Ajustes</Text>
            <Text style={cellStyle(4, true)}>Saldo anterior</Text>
            <Text style={cellStyle(5, true)}>Comisión neta</Text>
            <Text style={cellStyle(6)}>Aprobación</Text>
            <Text style={cellStyle(7)}>Pago</Text>
          </View>
          {admin.collaborators.map((a) => {
            const c = data.collaborators.find((x) => x.collaboratorId === a.collaboratorId)!;
            return (
              <View key={a.collaboratorId} style={s.tr} wrap={false}>
                <Text style={[cellStyle(0), s.bold]}>
                  {a.fullName}
                  {"\n"}
                  <Text style={[s.muted, { fontFamily: "Helvetica" }]}>{a.position}</Text>
                </Text>
                <Text style={cellStyle(1)}>{a.projectCodes.join(", ") || "—"}</Text>
                <Text style={cellStyle(2, true)}>{formatMoney(a.gross, "COP", 2)}</Text>
                <Text style={cellStyle(3, true)}>{formatMoney(a.adjustments, "COP", 2)}</Text>
                <Text style={cellStyle(4, true)}>{formatMoney(a.carryoverIn, "COP", 2)}</Text>
                <Text style={[cellStyle(5, true), s.bold]}>{formatMoney(a.netPayable, "COP", 2)}</Text>
                <Text style={cellStyle(6)}>Aprobada</Text>
                <Text style={cellStyle(7)}>
                  {paymentLabel(c.paymentStatus, c.netPayable)}
                  {c.paymentStatus !== "PENDING" && !D(c.netPayable).isZero() ? `\n${formatMoney(c.paid, "COP", 2)} pagados` : ""}
                </Text>
              </View>
            );
          })}
          <View style={s.total} wrap={false}>
            <Text style={{ width: W[0] + W[1], paddingRight: 4 }}>Total</Text>
            <Text style={cellStyle(2, true)}>{formatMoney(settlement.totalGross, "COP", 2)}</Text>
            <Text style={cellStyle(3, true)}>{formatMoney(settlement.totalAdjustments, "COP", 2)}</Text>
            <Text style={cellStyle(4, true)}>{formatMoney(carry, "COP", 2)}</Text>
            <Text style={cellStyle(5, true)}>{formatMoney(settlement.totalNet, "COP", 2)}</Text>
            <Text style={cellStyle(6)} />
            <Text style={cellStyle(7)} />
          </View>
        </View>

        <View wrap={false}>
          <Text style={s.h2}>Indicadores</Text>
          <View style={s.summaryRow}>
            <Box label="Ventas del período" value={formatMoney(ind.sales, "COP", 0)} note={`Meses de venta ${admin.monthsCovered.length ? `${admin.monthsCovered[0]} a ${admin.monthsCovered.at(-1)}` : ""} (validados)`} />
            <Box label="Ingresos recaudados que generaron comisión" value={formatMoney(ind.collected, "COP", 0)} note="Antes de IVA, en el período" />
            <Box label="Comisión neta / ventas" value={ind.netOverSales ? formatPercent(ind.netOverSales, 2) : "—"} />
            <Box label="Comisión bruta / recaudado" value={ind.grossOverCollected ? formatPercent(ind.grossOverCollected, 2) : "—"} />
          </View>
          <Text style={s.note}>
            Las ventas son las ventas organizacionales de los meses validados que cubre el período; los recaudos pueden corresponder a ventas de períodos anteriores, por lo que las razones son orientativas del costo total de las comisiones.
          </Text>
        </View>

        {data.alerts.length > 0 && (
          <View wrap={false}>
            <Text style={s.h2}>Alertas reconocidas al aprobar</Text>
            {data.alerts.map((a) => (
              <Text key={a.key} style={{ marginBottom: 2 }}>
                • [{a.severity === "WARNING" ? "Advertencia" : "Informativa"}] {a.message}
              </Text>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}

function Box({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={s.summaryBox}>
      <Text style={s.summaryLabel}>{label}</Text>
      <Text style={[s.summaryValue, { fontSize: 12 }]}>{value}</Text>
      {note && <Text style={[s.muted, { fontSize: 6.5, marginTop: 2, color: C.gris600 }]}>{note}</Text>}
    </View>
  );
}

export function renderAdministrativePdf(data: ReportData): Promise<Buffer> {
  return renderToBuffer(<AdminDoc data={data} />);
}
