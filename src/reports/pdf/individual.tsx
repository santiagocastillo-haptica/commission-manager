import { Document, Image, Page, renderToBuffer, Text, View } from "@react-pdf/renderer";
import { LOGO_PNG } from "../logo";
import { formatDate, formatMonthShort } from "@/domain/dates";
import { D, formatMoney, formatPercent, ZERO, type CurrencyCode } from "@/domain/money";
import type { ReportData } from "@/server/queries/settlements";
import { C, styles as s } from "./theme";

type Collab = ReportData["collaborators"][number];

const COLS: { key: string; label: string; w: number; right?: boolean }[] = [
  { key: "sale", label: "Mes de venta", w: 50 },
  { key: "code", label: "Código", w: 62 },
  { key: "project", label: "Cliente", w: 180 },
  { key: "net", label: "Base neta del proyecto", w: 74, right: true },
  { key: "inv", label: "Factura", w: 50 },
  { key: "invDate", label: "Fecha factura", w: 48 },
  { key: "colDate", label: "Fecha recaudo", w: 48 },
  { key: "amount", label: "Valor recaudado", w: 78, right: true },
  { key: "netCol", label: "Base neta del recaudo (COP)", w: 78, right: true },
  { key: "pct", label: "% comisión", w: 40, right: true },
  { key: "comm", label: "Comisión (COP)", w: 78, right: true },
];

const cell = (i: number) => ({ width: COLS[i].w, paddingRight: 4, textAlign: COLS[i].right ? ("right" as const) : ("left" as const) });

/** Identificador único de la liquidación individual (trazabilidad y firma electrónica). */
export const documentId = (code: string, csId: string) => `${code}-${csId.slice(-6).toUpperCase()}`;

const nowBogota = () => new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });

function Footer({ id, generated }: { id: string; generated: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>Reporte de comisiones · ID {id}</Text>
      <Text>Generado el {generated} (hora de Colombia)</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

function IndividualDoc({ data, collab }: { data: ReportData; collab: Collab }) {
  const { settlement } = data;
  const id = documentId(settlement.code, collab.csId);
  const generated = nowBogota();
  const snap = collab.snapshot;

  // Agrupar por proyecto, de la venta más antigua a la más reciente.
  const groups = new Map<string, Collab["lines"]>();
  for (const l of collab.lines) {
    const k = l.snapshot.projectCode;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const ordered = [...groups.entries()].sort(([, a], [, b]) => a[0].snapshot.saleMonth.localeCompare(b[0].snapshot.saleMonth) || a[0].snapshot.projectCode.localeCompare(b[0].snapshot.projectCode));

  const paid = snap.projects.filter((p) => !p.pendingInvoice && !p.pendingCollection);
  const pendingInvoice = snap.projects.filter((p) => p.pendingInvoice);
  const pendingCollection = snap.projects.filter((p) => p.pendingCollection);
  const netDue = D(collab.netPayable);
  const carryOut = D(collab.carryoverOut);

  return (
    <Document title={`Reporte de comisiones ${settlement.code} — ${snap.fullName}`} author="Háptica" subject={`Liquidación ${settlement.label}`} creator="Háptica Commission Manager">
      <Page size="A4" orientation="landscape" style={s.page}>
        <Footer id={id} generated={generated} />

        {/* Encabezado */}
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- el Image de react-pdf no admite alt */}
            <Image src={LOGO_PNG} style={{ width: 150 }} />
            <Text style={s.wordmarkSub}>COMMISSION MANAGER</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.eyebrow}>Identificador de liquidación</Text>
            <Text style={[s.bold, { fontSize: 10, marginTop: 2 }]}>{id}</Text>
          </View>
        </View>
        <View style={s.rail} />
        <Text style={s.title}>Reporte de Comisiones</Text>
        <View style={s.metaGrid}>
          <View style={s.metaCell}>
            <Text style={s.eyebrow}>Colaborador</Text>
            <Text style={s.metaValue}>{snap.fullName}</Text>
          </View>
          <View style={s.metaCell}>
            <Text style={s.eyebrow}>Cargo</Text>
            <Text style={s.metaValue}>{snap.position}</Text>
          </View>
          <View style={s.metaCell}>
            <Text style={s.eyebrow}>Período de liquidación</Text>
            <Text style={s.metaValue}>{settlement.label}</Text>
            <Text style={[s.muted, { marginTop: 1 }]}>Recaudos del {formatDate(settlement.period.periodStart)} al {formatDate(settlement.period.periodEnd)}</Text>
          </View>
          <View style={s.metaCell}>
            <Text style={s.eyebrow}>Fecha de emisión</Text>
            <Text style={s.metaValue}>{formatDate(settlement.approvedAt.toISOString().slice(0, 10))}</Text>
            <Text style={[s.muted, { marginTop: 1 }]}>Fecha de pago prevista: {formatDate(settlement.period.paymentDate)}</Text>
          </View>
        </View>

        {/* Resumen */}
        <Text style={s.h2}>Resumen</Text>
        <View style={s.summaryRow}>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Total de comisiones del período</Text>
            <Text style={s.summaryValue}>{formatMoney(collab.gross, "COP", 2)}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Ajustes aplicables</Text>
            <Text style={s.summaryValue}>{formatMoney(collab.adjustments, "COP", 2)}</Text>
          </View>
          {!D(collab.carryoverIn).isZero() && (
            <View style={s.summaryBox}>
              <Text style={s.summaryLabel}>Saldo arrastrado anterior</Text>
              <Text style={s.summaryValue}>{formatMoney(collab.carryoverIn, "COP", 2)}</Text>
            </View>
          )}
          <View style={s.summaryBoxStrong}>
            <Text style={[s.summaryLabel, { color: "#B7DDD9" }]}>Total neto a pagar</Text>
            <Text style={[s.summaryValue, { color: "#FFFFFF" }]}>{formatMoney(netDue, "COP", 2)}</Text>
          </View>
        </View>
        {carryOut.isNegative() && (
          <Text style={s.note}>
            El resultado neto de este período es negativo: no genera valor a pagar y el saldo de {formatMoney(carryOut, "COP", 2)} se descontará de la siguiente liquidación.
          </Text>
        )}

        {/* Detalle */}
        <Text style={s.h2}>Detalle de comisiones por recaudo</Text>
        <View style={s.table}>
          <View style={s.th} fixed>
            {COLS.map((c, i) => (
              <Text key={c.key} style={cell(i)}>
                {c.label}
              </Text>
            ))}
          </View>
          {ordered.map(([code, lines]) => {
            const subtotal = lines.reduce((acc, l) => acc.plus(l.commissionCOP), ZERO);
            return (
              <View key={code}>
                {lines.map((l) => {
                  const sn = l.snapshot;
                  const cur = sn.currency as CurrencyCode;
                  const isAdj = l.type === "ADJUSTMENT";
                  return (
                    <View key={l.id} style={[s.tr, isAdj ? s.trAdj : {}]} wrap={false}>
                      <Text style={cell(0)}>{formatMonthShort(sn.saleMonth)}</Text>
                      <Text style={[cell(1), s.bold]}>{sn.projectCode}</Text>
                      <Text style={cell(2)}>{sn.client}</Text>
                      <Text style={cell(3)}>{formatMoney(sn.projectNetBase, cur, 0)}</Text>
                      <Text style={cell(4)}>{isAdj ? "Ajuste" : (sn.invoiceNumber ?? "—")}</Text>
                      <Text style={cell(5)}>{isAdj ? "—" : formatDate(sn.invoiceDate)}</Text>
                      <Text style={cell(6)}>{isAdj ? "—" : `${formatDate(sn.collectionDate)}${sn.isLate ? " *" : ""}`}</Text>
                      <Text style={cell(7)}>
                        {isAdj ? "—" : formatMoney(sn.amountReceived, cur, 2)}
                        {!isAdj && cur !== "COP" ? `\nTRM ${formatMoney(sn.fxRate, "COP", 2)}` : ""}
                      </Text>
                      <Text style={cell(8)}>{formatMoney(l.netBaseCOP, "COP", 2)}</Text>
                      <Text style={cell(9)}>{formatPercent(l.effectiveRate, 2)}</Text>
                      <Text style={[cell(10), s.bold]}>{formatMoney(l.commissionCOP, "COP", 2)}</Text>
                    </View>
                  );
                })}
                <View style={s.subtotal} wrap={false}>
                  <Text style={{ width: COLS.slice(0, 10).reduce((a, c) => a + c.w, 0), textAlign: "right", paddingRight: 4 }}>Subtotal {code}</Text>
                  <Text style={cell(10)}>{formatMoney(subtotal, "COP", 2)}</Text>
                </View>
              </View>
            );
          })}
          {ordered.length === 0 && (
            <View style={s.tr}>
              <Text>Este período no tiene líneas de comisión para el colaborador (solo saldo arrastrado).</Text>
            </View>
          )}
          <View style={s.total} wrap={false}>
            <Text style={{ width: COLS.slice(0, 10).reduce((a, c) => a + c.w, 0), textAlign: "right", paddingRight: 4 }}>Total comisiones del período (bruto + ajustes)</Text>
            <Text style={cell(10)}>{formatMoney(D(collab.gross).plus(collab.adjustments), "COP", 2)}</Text>
          </View>
        </View>
        <Text style={s.note}>
          Los valores recaudados son antes de IVA. La comisión se calcula sobre la base neta (venta menos costos de proveedores) correspondiente a cada recaudo y, para ventas en moneda extranjera, se convierte
          a COP con la TRM del día del recaudo. * Recaudo registrado con posterioridad a su período, incluido como extemporáneo. Las filas sombreadas son ajustes por modificaciones posteriores de la base comisionable.
        </Text>

        {/* Estado de proyectos */}
        <View break={ordered.length > 8}>
          <Text style={s.h2}>Estado de proyectos</Text>
          <StatusTable title="Proyectos pagados en su totalidad" empty="Ninguno por ahora." rows={paid} showPending={false} />
          <StatusTable title="Proyectos con facturación pendiente" empty="Ninguno." rows={pendingInvoice} showPending />
          <StatusTable title="Proyectos con recaudos pendientes" empty="Ninguno." rows={pendingCollection} showPending />
          <Text style={s.note}>
            El «saldo de comisión potencial pendiente» es una estimación de la comisión que aún podría generarse cuando se facture y recaude el saldo del proyecto. NO constituye una comisión aprobada ni
            garantiza su pago: solo las comisiones del detalle anterior están aprobadas en esta liquidación.
          </Text>
        </View>

        {/* Constancia */}
        <View wrap={false}>
          <Text style={s.h2}>Constancia</Text>
          <Text style={{ fontSize: 8.5 }}>
            Se deja constancia de que las comisiones aquí detalladas corresponden a la liquidación {settlement.label} ({settlement.code}), aprobada el {formatDate(settlement.approvedAt.toISOString().slice(0, 10))}
            {settlement.approver ? ` por ${settlement.approver}` : ""}. Este documento puede descargarse para su firma mediante el sistema de firma electrónica de Háptica.
          </Text>
          <View style={s.sigRow}>
            <View style={s.sig}>
              <Text style={s.bold}>Responsable administrativo</Text>
              <Text style={s.muted}>Nombre, firma y fecha</Text>
            </View>
            <View style={s.sig}>
              <Text style={s.bold}>Gerente Ejecutivo</Text>
              <Text style={s.muted}>Nombre, firma y fecha</Text>
            </View>
            <View style={s.sig}>
              <Text style={s.bold}>Colaborador: {snap.fullName}</Text>
              <Text style={s.muted}>Firma y fecha</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

function StatusTable({ title, rows, empty, showPending }: { title: string; rows: Collab["snapshot"]["projects"]; empty: string; showPending: boolean }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={[s.bold, { marginBottom: 3 }]}>{title} ({rows.length})</Text>
      {rows.length === 0 ? (
        <Text style={s.muted}>{empty}</Text>
      ) : (
        <View>
          <View style={[s.th, { backgroundColor: C.petroleo }]}>
            <Text style={{ width: 70 }}>Código</Text>
            <Text style={{ width: 170 }}>Cliente</Text>
            <Text style={{ width: 180, textAlign: "right", paddingRight: 6 }}>Facturado / venta</Text>
            <Text style={{ width: 100, textAlign: "right", paddingRight: 6 }}>Recaudado</Text>
            <Text style={{ width: 120, textAlign: "right", paddingRight: 6 }}>Aprobada en esta liquidación</Text>
            {showPending && <Text style={{ width: 130, textAlign: "right" }}>Saldo de comisión potencial pendiente</Text>}
          </View>
          {rows.map((p) => {
            const cur = p.currency as CurrencyCode;
            return (
              <View key={p.projectId} style={s.tr} wrap={false}>
                <Text style={[{ width: 70 }, s.bold]}>{p.code}</Text>
                <Text style={{ width: 170 }}>{p.client}</Text>
                <Text style={{ width: 180, textAlign: "right", paddingRight: 6 }}>
                  {formatMoney(p.invoiced, cur, 0)} / {formatMoney(p.saleAmount, cur, 0)}
                </Text>
                <Text style={{ width: 100, textAlign: "right", paddingRight: 6 }}>{formatMoney(p.collected, cur, 0)}</Text>
                <Text style={{ width: 120, textAlign: "right", paddingRight: 6 }}>{formatMoney(p.approvedInThisCOP, "COP", 2)}</Text>
                {showPending && <Text style={{ width: 130, textAlign: "right" }}>{formatMoney(p.pendingPotentialCOP, "COP", 2)}</Text>}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

export function renderIndividualPdf(data: ReportData, collab: Collab): Promise<Buffer> {
  return renderToBuffer(<IndividualDoc data={data} collab={collab} />);
}
