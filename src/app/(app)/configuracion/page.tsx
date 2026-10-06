import { Plus, SquarePen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { endOfMonth, formatDate, formatMonth, todayBogota } from "@/domain/dates";
import { D, formatMoney, formatPercent, type CurrencyCode } from "@/domain/money";
import { cn } from "@/lib/utils";
import { requireSession } from "@/server/auth";
import { listAudit, listGoals, listMonths, listPolicyTiers, listRates } from "@/server/queries/settings";
import { GoalDialog, MonthActions, MonthAdjustmentDialog, RateDialog } from "./settings-dialogs";

export const metadata: Metadata = { title: "Configuración" };

const TABS = [
  { id: "ventas", label: "Meta y ventas mensuales" },
  { id: "tasas", label: "Tasas de cambio" },
  { id: "politicas", label: "Políticas de comisión" },
  { id: "auditoria", label: "Auditoría" },
] as const;

export default async function SettingsPage({ searchParams }: PageProps<"/configuracion">) {
  await requireSession();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? "ventas";

  return (
    <>
      <PageHeader eyebrow="Sistema" title="Configuración" description="Meta comercial, ventas organizacionales por mes, tasas de cambio, políticas de comisión y bitácora de auditoría." />

      <nav aria-label="Secciones" className="mb-6 flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/configuracion?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
              tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-brand-deep",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "ventas" && <SalesTab />}
      {tab === "tasas" && <RatesTab />}
      {tab === "politicas" && <PoliciesTab />}
      {tab === "auditoria" && <AuditTab />}
    </>
  );
}

async function SalesTab() {
  const [months, goals] = await Promise.all([listMonths(), listGoals()]);
  const current = goals[0];
  const today = todayBogota();

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Meta comercial mensual</h2>
            <p className="text-sm text-muted-foreground">
              Vigente: <span className="num font-semibold text-brand-deep">{current ? formatMoney(current.amount, "COP", 0) : "—"}</span> por mes calendario (hora de Colombia).
            </p>
          </div>
          <GoalDialog currentAmount={current?.amount ?? "390000000"} trigger={<Button size="sm" variant="outline"><Plus data-icon="inline-start" /> Nueva meta</Button>} />
        </div>
        <ul className="divide-y rounded-lg border text-sm">
          {goals.map((g, i) => (
            <li key={g.effectiveFrom} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
              <span>Desde {formatDate(g.effectiveFrom)}</span>
              <span className="num font-semibold">{formatMoney(g.amount, "COP", 0)}</span>
              {i === 0 && <Badge variant="success">Vigente</Badge>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-bold">Ventas organizacionales por mes</h2>
        <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
          El total del mes suma <strong>todos</strong> los proyectos vendidos (tengan o no colaboradores con comisión), antes de IVA, convertidos a COP con la TRM del día de la venta. La meta se cumple con ventas iguales o superiores a la meta.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Mes</TableHead>
                <TableHead className="text-right">Proyectos</TableHead>
                <TableHead className="text-right">Ventas (COP)</TableHead>
                <TableHead className="text-right">Meta</TableHead>
                <TableHead className="min-w-40">Cumplimiento</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Ajuste manual</TableHead>
                <TableHead className="text-right">Validación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map((m) => {
                const ratio = D(m.ratio);
                const reached = ratio.gte(1);
                return (
                  <TableRow key={m.yearMonth}>
                    <TableCell className="font-medium capitalize">{formatMonth(m.yearMonth)}</TableCell>
                    <TableCell className="num text-right">{m.projectCount}</TableCell>
                    <TableCell className="num text-right">{formatMoney(m.salesCOP, "COP", 0)}</TableCell>
                    <TableCell className="num text-right text-muted-foreground">{formatMoney(m.goalCOP, "COP", 0)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 bg-muted" role="img" aria-label={`Cumplimiento ${formatPercent(ratio, 1)}`}>
                          <div className={cn("h-full", reached ? "bg-brand-mint" : "bg-primary")} style={{ width: `${Math.min(100, ratio.mul(100).toNumber())}%` }} />
                        </div>
                        <span className={cn("num text-xs font-semibold", reached ? "text-success" : "text-foreground")}>{formatPercent(ratio, 1)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {m.status === "VALIDATED" ? (
                        <Badge variant={m.outcome === "ELIGIBLE" ? "success" : "danger"}>{m.outcome === "ELIGIBLE" ? "Validado · elegible" : "Validado · no elegible"}</Badge>
                      ) : (
                        <Badge variant="warning">Abierto · sin validar</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="num text-xs text-muted-foreground">{D(m.manualAdjustmentCOP).gt(0) ? `+${formatMoney(m.manualAdjustmentCOP, "COP", 0)}` : "—"}</span>
                        {m.status !== "VALIDATED" && (
                          <MonthAdjustmentDialog
                            yearMonth={m.yearMonth}
                            monthLabel={formatMonth(m.yearMonth)}
                            initialAmount={m.manualAdjustmentCOP}
                            initialNote={m.manualAdjustmentNote ?? ""}
                            trigger={<Button size="icon-xs" variant="ghost" aria-label={`Editar ajuste de ${formatMonth(m.yearMonth)}`}><SquarePen /></Button>}
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <MonthActions
                        yearMonth={m.yearMonth}
                        monthLabel={formatMonth(m.yearMonth)}
                        status={m.status}
                        ended={endOfMonth(m.yearMonth) < today}
                        salesCOP={m.salesCOP}
                        goalCOP={m.goalCOP}
                        projectCount={m.projectCount}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

async function RatesTab() {
  const rates = await listRates();
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Historial de tasas de cambio</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            TRM del día, ingresada manualmente (no hay integración con servicios externos en la V1). Cada recaudo y cada venta conservan además la tasa que usaron. Las tasas registradas no se modifican.
          </p>
        </div>
        <RateDialog trigger={<Button size="sm"><Plus data-icon="inline-start" /> Registrar tasa</Button>} />
      </div>
      {rates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no hay tasas registradas.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Fecha</TableHead>
                <TableHead>Moneda</TableHead>
                <TableHead className="text-right">COP por unidad</TableHead>
                <TableHead>Fuente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="num">{formatDate(r.date)}</TableCell>
                  <TableCell><Badge variant="outline">{r.currency}</Badge></TableCell>
                  <TableCell className="num text-right font-semibold">{formatMoney(r.rate, "COP" as CurrencyCode, 2)}</TableCell>
                  <TableCell className="text-muted-foreground">{r.source ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

async function PoliciesTab() {
  const policies = await listPolicyTiers();
  return (
    <div className="space-y-6">
      {policies.map((p) => (
        <section key={p.id} className="rounded-lg border p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold">{p.name}</h2>
            <Badge variant="neutral">{p.code}</Badge>
          </div>
          {p.kind === "GENERAL_THRESHOLD" ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground/80">
              <li>Genera derecho a comisión el proyecto vendido en un mes cuyas ventas organizacionales alcanzan o superan la meta.</li>
              <li>Máximo 1 % por persona y proyecto; el porcentaje se fija en la venta.</li>
              <li>La comisión se paga sobre lo facturado y recaudado, en la liquidación del período del recaudo.</li>
            </ul>
          ) : (
            <>
              <p className="mt-3 text-sm text-foreground/80">
                Reemplaza la regla de la meta: el porcentaje efectivo es el porcentaje base (1 %) multiplicado por el factor del tramo de cumplimiento del mes de venta. Los límites inferiores son inclusivos.
              </p>
              <div className="mt-3 max-w-xl overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Cumplimiento mensual</TableHead>
                      <TableHead className="text-right">Factor</TableHead>
                      <TableHead className="text-right">Comisión efectiva (base 1 %)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.tiers
                      .filter((t) => t.effectiveFrom === p.tiers[0]?.effectiveFrom)
                      .map((t, i, arr) => (
                        <TableRow key={t.id}>
                          <TableCell className="num">
                            {i === 0 && arr[1]
                              ? `Menor al ${formatPercent(arr[1].min, 0)}`
                              : arr[i + 1]
                                ? `Desde ${formatPercent(t.min, 0)} y menor al ${formatPercent(arr[i + 1].min, 0)}`
                                : `Igual o superior al ${formatPercent(t.min, 0)}`}
                          </TableCell>
                          <TableCell className="num text-right">{t.factor.replace(/\.?0+$/, "")}×</TableCell>
                          <TableCell className="num text-right font-semibold">{formatPercent(D(t.factor).div(100), 2)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                La política se asocia al registro de cada colaborador (no a su nombre), así que un cambio de datos personales no altera su cálculo. La edición de tramos no está disponible en la V1: cualquier cambio de escala se hace con una nueva versión desde el seed o la base de datos.
              </p>
            </>
          )}
        </section>
      ))}
    </div>
  );
}

async function AuditTab() {
  const rows = await listAudit();
  return (
    <section>
      <h2 className="mb-1 text-lg font-bold">Bitácora de auditoría</h2>
      <p className="mb-3 text-sm text-muted-foreground">Últimos {rows.length} cambios. La bitácora es de solo inserción: ningún registro se edita ni se elimina.</p>
      <ol className="divide-y rounded-lg border text-sm">
        {rows.map((h) => (
          <li key={h.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5">
            <span className="num w-36 shrink-0 text-xs text-muted-foreground">{new Date(h.at).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" })}</span>
            <Badge variant="neutral">{h.entity}</Badge>
            <span className="min-w-0 flex-1">{h.summary ?? h.action}</span>
            <span className="text-xs text-muted-foreground">{h.user ?? "Sistema"}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
