import { ArrowLeft, Check, Download, FileSpreadsheet, FileText, FolderArchive, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMonthShort } from "@/domain/dates";
import { D, formatMoney, formatPercent, type CurrencyCode } from "@/domain/money";
import { cn } from "@/lib/utils";
import { requireSession } from "@/server/auth";
import { getSettlementView, parseSettlementCode, type AlertView, type CollaboratorView, type SettlementView } from "@/server/queries/settlements";
import { ApprovePanel, CalculateButton, DiscardButton, PaymentDialog } from "./wizard-client";

export const metadata: Metadata = { title: "Liquidación" };
/** El cálculo y el cierre de una liquidación pueden tardar más que el valor por defecto de la plataforma. */
export const maxDuration = 60;

const STEPS = [
  { n: 1, label: "Período" },
  { n: 2, label: "Calcular" },
  { n: 3, label: "Revisar" },
  { n: 4, label: "Aprobar" },
  { n: 5, label: "Reportes" },
  { n: 6, label: "Pagos" },
] as const;

const SEVERITY: Record<string, { label: string; variant: "danger" | "warning" | "info" }> = {
  BLOCKING: { label: "Bloqueante", variant: "danger" },
  WARNING: { label: "Advertencia", variant: "warning" },
  INFO: { label: "Informativa", variant: "info" },
};

export default async function SettlementWizardPage({ params, searchParams }: PageProps<"/liquidaciones/[code]">) {
  await requireSession();
  const { code } = await params;
  const parsed = parseSettlementCode(code);
  if (!parsed) notFound();
  const sp = await searchParams;

  const view = await getSettlementView(parsed.year, parsed.half);
  const approved = view.status === "APPROVED";
  const defaultStep = approved ? 5 : view.status === "DRAFT" ? 3 : 2;
  const requested = Number(typeof sp.paso === "string" ? sp.paso : "");
  const enabled = (n: number) => (n <= 2 ? true : n === 3 ? view.status !== "NONE" : n === 4 ? view.status !== "NONE" : approved);
  const step = requested >= 1 && requested <= 6 && enabled(requested) ? requested : defaultStep;

  return (
    <>
      <Link href="/liquidaciones" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-brand-deep">
        <ArrowLeft className="size-3.5" /> Liquidaciones
      </Link>
      <PageHeader
        eyebrow={view.period.code}
        title={`Liquidación ${view.period.label}`}
        description={`Recaudos del ${formatDate(view.period.periodStart)} al ${formatDate(view.period.periodEnd)} · pago previsto el ${formatDate(view.period.paymentDate)}`}
        actions={
          approved ? (
            <Badge variant="success">
              <Lock aria-hidden /> Aprobada y cerrada
            </Badge>
          ) : view.status === "DRAFT" ? (
            <Badge variant="warning">Borrador</Badge>
          ) : (
            <Badge variant="neutral">Sin calcular</Badge>
          )
        }
      />

      <nav aria-label="Pasos de la liquidación" className="mb-8">
        <ol className="grid grid-cols-3 gap-px border bg-border sm:grid-cols-6">
          {STEPS.map(({ n, label }) => {
            const isEnabled = enabled(n);
            const done = n < step && isEnabled;
            const active = n === step;
            const inner = (
              <span className={cn("flex items-center gap-2 px-3 py-2.5 text-xs font-bold uppercase tracking-[0.08em]", active ? "bg-primary text-white" : isEnabled ? "bg-background text-brand-deep hover:bg-accent" : "bg-muted/60 text-muted-foreground/60")}>
                <span className={cn("grid size-5 shrink-0 place-items-center rounded-full text-[10px]", active ? "bg-white/20" : done ? "bg-brand-mint text-brand-deep" : "bg-muted")}>{done ? <Check className="size-3" /> : n}</span>
                {label}
              </span>
            );
            return (
              <li key={n} aria-current={active ? "step" : undefined}>
                {isEnabled ? <Link href={`?paso=${n}`}>{inner}</Link> : inner}
              </li>
            );
          })}
        </ol>
      </nav>

      {step === 1 && <StepPeriod view={view} />}
      {step === 2 && <StepCalculate view={view} year={parsed.year} half={parsed.half} />}
      {step === 3 && <StepReview view={view} year={parsed.year} half={parsed.half} />}
      {step === 4 && <StepApprove view={view} />}
      {step === 5 && <StepReports view={view} />}
      {step === 6 && <StepPayments view={view} />}
    </>
  );
}

// ───────────── Paso 1 ─────────────
function StepPeriod({ view }: { view: SettlementView }) {
  const p = view.period;
  return (
    <section className="max-w-2xl space-y-4">
      <h2 className="text-lg font-bold">1 · Período</h2>
      <dl className="grid gap-4 rounded-lg border p-5 sm:grid-cols-3">
        <div><dt className="eyebrow">Liquidación</dt><dd className="mt-1 font-bold">{p.label}</dd></div>
        <div><dt className="eyebrow">Recaudos del período</dt><dd className="num mt-1 font-bold">{formatDate(p.periodStart)} – {formatDate(p.periodEnd)}</dd></div>
        <div><dt className="eyebrow">Fecha de pago</dt><dd className="num mt-1 font-bold">{formatDate(p.paymentDate)}</dd></div>
      </dl>
      <p className="text-sm text-muted-foreground">
        El período lo determina la <strong>fecha efectiva del recaudo</strong>. Entran los recaudos de proyectos vendidos en cualquier período anterior que aún no se hayan liquidado; el cumplimiento de la meta no se vuelve a evaluar.
      </p>
      <Button render={<Link href="?paso=2" />}>Continuar a calcular</Button>
    </section>
  );
}

// ───────────── Paso 2 ─────────────
function StepCalculate({ view, year, half }: { view: SettlementView; year: number; half: "APRIL" | "OCTOBER" }) {
  const approved = view.status === "APPROVED";
  const lines = view.collaborators.reduce((a, c) => a + c.lines.length, 0);
  return (
    <section className="max-w-2xl space-y-4">
      <h2 className="text-lg font-bold">2 · Calcular</h2>
      {approved ? (
        <p className="text-sm text-muted-foreground">Esta liquidación ya está aprobada y cerrada; no se puede recalcular.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            El sistema identifica los recaudos elegibles del período y calcula, para cada colaborador y proyecto: porcentaje aplicable, base neta del recaudo, moneda y TRM, comisión y ajustes. Calcular es repetible hasta aprobar.
          </p>
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            <p>
              Con los datos actuales: <strong className="num">{lines}</strong> línea(s) de {view.collaborators.length} colaborador(es), neto a pagar <strong className="num">{formatMoney(view.grand.netPayable, "COP", 2)}</strong>.
            </p>
            {view.calculatedAt && <p className="mt-1 text-xs text-muted-foreground">Último cálculo guardado: {new Date(view.calculatedAt).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" })}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <CalculateButton year={year} half={half} recalculate={view.status === "DRAFT"} />
            {view.status === "DRAFT" && <Button variant="ghost" render={<Link href="?paso=3" />}>Ir a revisar</Button>}
          </div>
        </>
      )}
    </section>
  );
}

// ───────────── Paso 3 ─────────────
function AlertList({ alerts }: { alerts: AlertView[] }) {
  if (alerts.length === 0) return <p className="text-sm text-success">Sin alertas: no se detectaron inconsistencias en los datos de origen.</p>;
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {alerts.map((a) => (
        <li key={a.key} className="flex flex-wrap items-start gap-3 px-4 py-2.5">
          <Badge variant={SEVERITY[a.severity]?.variant ?? "neutral"} className="mt-0.5 shrink-0">{SEVERITY[a.severity]?.label ?? a.severity}</Badge>
          <span className="min-w-0 flex-1">{a.message}</span>
          {a.projectId && (
            <Link href={`/proyectos/${a.projectId}`} className="shrink-0 text-xs font-semibold text-primary underline-offset-4 hover:underline">
              Ver proyecto
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

function LinesTable({ c }: { c: CollaboratorView }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>Proyecto</TableHead>
            <TableHead>Venta</TableHead>
            <TableHead>Factura</TableHead>
            <TableHead>Recaudo</TableHead>
            <TableHead className="text-right">Valor recaudado</TableHead>
            <TableHead className="text-right">Base neta (COP)</TableHead>
            <TableHead className="text-right">%</TableHead>
            <TableHead className="text-right">Comisión (COP)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {c.lines.map((l) => {
            const adj = l.type === "ADJUSTMENT";
            const cur = l.currency as CurrencyCode;
            return (
              <TableRow key={l.key} className={adj ? "bg-warning-soft/60" : undefined}>
                <TableCell>
                  <Link href={`/proyectos/${l.projectId}`} className="num font-semibold underline-offset-4 hover:underline">{l.projectCode}</Link>
                </TableCell>
                <TableCell className="capitalize">{formatMonthShort(l.saleMonth)}</TableCell>
                <TableCell className="num">{adj ? <Badge variant="warning">Ajuste</Badge> : (l.invoiceNumber ?? "—")}</TableCell>
                <TableCell className="num whitespace-nowrap">
                  {adj ? "—" : formatDate(l.collectionDate)}
                  {l.isLate && <Badge variant="info" className="ml-1.5">Extemporáneo</Badge>}
                </TableCell>
                <TableCell className="num whitespace-nowrap text-right">
                  {adj ? "—" : formatMoney(l.amountReceived, cur, 2)}
                  {!adj && cur !== "COP" && <div className="text-xs text-muted-foreground">TRM {formatMoney(l.fxRate, "COP", 2)}</div>}
                </TableCell>
                <TableCell className="num text-right">{formatMoney(l.netBaseCOP, "COP", 2)}</TableCell>
                <TableCell className="num text-right">{formatPercent(l.effectiveRate, 2)}</TableCell>
                <TableCell className="num text-right font-semibold">{formatMoney(l.commissionCOP, "COP", 2)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function StepReview({ view, year, half }: { view: SettlementView; year: number; half: "APRIL" | "OCTOBER" }) {
  const approved = view.status === "APPROVED";
  const lines = view.collaborators.reduce((a, c) => a + c.lines.length, 0);
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">3 · Revisar</h2>
        {!approved && <CalculateButton year={year} half={half} recalculate />}
      </div>

      {view.stale && !approved && (
        <p className="border-l-2 border-brand-amber bg-warning-soft px-4 py-3 text-sm text-warning">
          Los datos cambiaron desde el último cálculo guardado. Lo que ves abajo es el cálculo actual; recalcula para guardarlo.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPI label="Comisión bruta" value={formatMoney(view.grand.gross, "COP", 2)} />
        <KPI label="Ajustes" value={formatMoney(view.grand.adjustments, "COP", 2)} />
        <KPI label="Neto a pagar" value={formatMoney(view.grand.netPayable, "COP", 2)} strong />
        <KPI label="Líneas / colaboradores" value={`${lines} / ${view.collaborators.length}`} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold">Alertas de los datos de origen</h3>
        <AlertList alerts={view.alerts} />
        <p className="mt-2 text-xs text-muted-foreground">Corrige las inconsistencias en el proyecto, la factura o el recaudo y vuelve a calcular. Las advertencias se reconocen al aprobar; las bloqueantes impiden el cierre.</p>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold">Resultado por colaborador</h3>
        {view.collaborators.length === 0 && <p className="text-sm text-muted-foreground">No hay recaudos elegibles en este período.</p>}
        {view.collaborators.map((c) => (
          <details key={c.collaboratorId} className="group rounded-lg border" open={view.collaborators.length === 1}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 marker:content-none">
              <span className="min-w-[200px] flex-1">
                <span className="font-semibold text-brand-deep">{c.name}</span>
                <span className="block text-xs text-muted-foreground">{c.position} · {c.lines.length} línea(s)</span>
              </span>
              <Figure label="Bruta" value={c.gross} />
              <Figure label="Ajustes" value={c.adjustments} />
              {!D(c.carryoverIn).isZero() && <Figure label="Saldo anterior" value={c.carryoverIn} />}
              <Figure label="Neto a pagar" value={c.netPayable} strong />
              {D(c.carryoverOut).isNegative() && <Badge variant="warning">Pasa {formatMoney(c.carryoverOut, "COP", 2)} a la siguiente</Badge>}
            </summary>
            <div className="border-t">
              <LinesTable c={c} />
            </div>
          </details>
        ))}
      </div>

      {!approved && (
        <div className="flex flex-wrap items-center gap-3">
          <Button render={<Link href="?paso=4" />}>Continuar a aprobar</Button>
          {view.settlementId && <DiscardButton settlementId={view.settlementId} code={view.period.code} />}
        </div>
      )}
    </section>
  );
}

function KPI({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-4", strong && "border-transparent bg-brand-deep text-white")}>
      <p className={cn("eyebrow", strong && "!text-white/70")}>{label}</p>
      <p className="num mt-2 text-xl font-bold">{value}</p>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="text-right">
      <span className="eyebrow block !text-[9px]">{label}</span>
      <span className={cn("num text-sm", strong && "font-bold text-brand-deep")}>{formatMoney(value, "COP", 2)}</span>
    </span>
  );
}

// ───────────── Paso 4 ─────────────
function StepApprove({ view }: { view: SettlementView }) {
  if (view.status === "APPROVED") {
    return (
      <section className="max-w-2xl space-y-3">
        <h2 className="text-lg font-bold">4 · Aprobar</h2>
        <p className="border-l-2 border-brand-mint bg-success-soft px-4 py-3 text-sm text-success">
          Aprobada y cerrada el {new Date(view.approvedAt!).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "long", timeStyle: "short" })}
          {view.approver ? ` por ${view.approver}` : ""}. Es inmutable: las correcciones se registran como ajustes y se aplican en la siguiente liquidación.
        </p>
        {view.alerts.length > 0 && (
          <>
            <h3 className="text-sm font-bold">Alertas reconocidas al aprobar</h3>
            <AlertList alerts={view.alerts} />
          </>
        )}
      </section>
    );
  }
  return (
    <section className="max-w-3xl space-y-4">
      <h2 className="text-lg font-bold">4 · Aprobar</h2>
      {view.stale && <p className="border-l-2 border-brand-amber bg-warning-soft px-4 py-3 text-sm text-warning">Los datos cambiaron desde el último cálculo. Al aprobar se recalcula con los datos actuales.</p>}
      <ApprovePanel
        settlementId={view.settlementId ?? ""}
        code={view.period.code}
        label={view.period.label}
        alerts={view.alerts}
        totals={view.grand}
        lineCount={view.collaborators.reduce((a, c) => a + c.lines.length, 0)}
        collaboratorCount={view.collaborators.length}
        hasLines={view.collaborators.length > 0 && view.settlementId !== null}
      />
    </section>
  );
}

// ───────────── Paso 5 ─────────────
function StepReports({ view }: { view: SettlementView }) {
  const code = view.period.code;
  return (
    <section className="space-y-6">
      <h2 className="text-lg font-bold">5 · Reportes</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Los reportes se generan desde la foto congelada al aprobar, por lo que siempre salen igual. Cada PDF lleva el identificador de la liquidación, la fecha de generación y espacios de firma para enviarlo al sistema de firma electrónica de Háptica.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button render={<a href={`/api/liquidaciones/${code}/zip`} download />}>
          <FolderArchive data-icon="inline-start" /> Todos los PDF individuales (ZIP)
        </Button>
        <Button variant="outline" render={<a href={`/api/liquidaciones/${code}/administrativo`} download />}>
          <FileText data-icon="inline-start" /> Reporte administrativo (PDF)
        </Button>
        <Button variant="outline" render={<a href={`/api/liquidaciones/${code}/administrativo?formato=xlsx`} download />}>
          <FileSpreadsheet data-icon="inline-start" /> Reporte administrativo (Excel)
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Colaborador</TableHead>
              <TableHead className="text-right">Comisión neta</TableHead>
              <TableHead className="text-right">PDF individual</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.collaborators.map((c) => (
              <TableRow key={c.collaboratorId}>
                <TableCell>
                  <span className="font-semibold">{c.name}</span>
                  <div className="text-xs text-muted-foreground">{c.position}</div>
                </TableCell>
                <TableCell className="num text-right">{formatMoney(c.netPayable, "COP", 2)}</TableCell>
                <TableCell className="text-right">
                  <Button size="xs" variant="outline" render={<a href={`/api/liquidaciones/${code}/individual/${c.collaboratorId}`} download />}>
                    <Download data-icon="inline-start" /> Descargar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

// ───────────── Paso 6 ─────────────
function StepPayments({ view }: { view: SettlementView }) {
  const label = { PENDING: ["Pendiente de pago", "warning"], PARTIAL: ["Pago parcial", "info"], PAID: ["Pagada", "success"] } as const;
  const totalNet = D(view.grand.netPayable);
  const paid = D(view.paidTotal);
  return (
    <section className="space-y-6">
      <h2 className="text-lg font-bold">6 · Registrar pagos</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">La aprobación y el pago son estados distintos. Registra cada pago con su fecha efectiva, valor y referencia; el sistema impide pagos duplicados o superiores al saldo.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <KPI label="Total a pagar" value={formatMoney(totalNet, "COP", 2)} />
        <KPI label="Pagado" value={formatMoney(paid, "COP", 2)} />
        <KPI label="Pendiente" value={formatMoney(totalNet.minus(paid), "COP", 2)} strong />
      </div>
      <div className="space-y-3">
        {view.collaborators.map((c) => {
          const net = D(c.netPayable);
          const remaining = net.minus(c.paid);
          const st = c.paymentStatus ?? "PENDING";
          const noPay = net.isZero();
          return (
            <div key={c.collaboratorId} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="min-w-[200px] flex-1">
                  <p className="font-semibold text-brand-deep">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.position}</p>
                </div>
                <Figure label="Neto a pagar" value={c.netPayable} strong />
                <Figure label="Pagado" value={c.paid} />
                <Figure label="Pendiente" value={remaining.lt(0.005) ? "0" : remaining.toFixed()} />
                {noPay ? <Badge variant="neutral">Sin valor a pagar</Badge> : <Badge variant={label[st][1]}>{label[st][0]}</Badge>}
                {!noPay && st !== "PAID" && c.csId && <PaymentDialog collaboratorSettlementId={c.csId} code={view.period.code} collaboratorName={c.name} remaining={remaining.toFixed()} />}
              </div>
              {D(c.carryoverOut).isNegative() && <p className="mt-2 text-xs text-warning">Saldo negativo de {formatMoney(c.carryoverOut, "COP", 2)} que se descontará en la siguiente liquidación.</p>}
              {c.payments.length > 0 && (
                <ul className="mt-3 divide-y border-t text-sm">
                  {c.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 py-2">
                      <span className="num w-28">{formatDate(p.paidAt)}</span>
                      <span className="num w-40 font-semibold">{formatMoney(p.amount, "COP", 2)}</span>
                      <span className="num text-muted-foreground">Ref. {p.reference}</span>
                      {p.notes && <span className="text-xs text-muted-foreground">{p.notes}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
