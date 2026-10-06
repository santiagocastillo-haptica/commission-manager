import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { SalesChart, type SalesPoint } from "@/components/sales-chart";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { endOfMonth, formatDate, formatMonthShort, monthKey, todayBogota } from "@/domain/dates";
import { D, formatCOP0, formatMoney, formatPercent, sum, ZERO, type CurrencyCode } from "@/domain/money";
import { nextSettlement } from "@/domain/periods";
import { requireSession } from "@/server/auth";
import { listInvoices } from "@/server/queries/billing";
import { goalForMonth, loadGoals, loadManualAdjustments } from "@/server/queries/common";
import { listCollaborators } from "@/server/queries/collaborators";
import { commissionTotals } from "@/server/queries/commissions";
import { listProjects, projectYears } from "@/server/queries/projects";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  await requireSession();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const today = todayBogota();
  const currentMonth = monthKey(today);
  const years = await projectYears();
  const year = one("year") ?? (years.includes(today.slice(0, 4)) ? today.slice(0, 4) : (years[0] ?? today.slice(0, 4)));
  const semester = one("semester"); // "1" | "2" | undefined
  const collaboratorId = one("collaborator");

  const firstMonth = semester === "2" ? 7 : 1;
  const lastMonth = semester === "1" ? 6 : 12;
  const monthKeys = Array.from({ length: lastMonth - firstMonth + 1 }, (_, i) => `${year}-${String(firstMonth + i).padStart(2, "0")}`);

  const [projects, goals, collaborators, invoices, manual, commissions] = await Promise.all([
    listProjects({ collaboratorId }),
    loadGoals(),
    listCollaborators(),
    listInvoices(),
    loadManualAdjustments(monthKeys),
    commissionTotals({
      collaboratorId,
      fromMonth: monthKeys[0],
      toMonth: monthKeys[monthKeys.length - 1],
      from: `${monthKeys[0]}-01`,
      to: endOfMonth(monthKeys[monthKeys.length - 1]),
    }),
  ]);

  const manualBy = new Map([...manual].map(([ym, v]) => [ym, D(v)]));
  const salesBy = new Map<string, ReturnType<typeof D>>();
  for (const p of projects) salesBy.set(p.saleMonth, (salesBy.get(p.saleMonth) ?? ZERO).plus(p.saleAmountCOP));

  // Los ajustes manuales son ventas organizacionales: solo aplican sin filtro por colaborador.
  const monthSales = (ym: string) => (salesBy.get(ym) ?? ZERO).plus(collaboratorId ? ZERO : (manualBy.get(ym) ?? ZERO));
  const chartData: SalesPoint[] = monthKeys.map((ym) => {
    const sales = monthSales(ym);
    const goal = goalForMonth(goals, ym);
    return { label: formatMonthShort(ym), sales: sales.toNumber(), goal: goal.toNumber(), reached: sales.gte(goal) };
  });

  const elapsed = monthKeys.filter((ym) => ym <= currentMonth);
  const totalSales = sum(monthKeys.map(monthSales));
  const totalGoal = sum(elapsed.map((ym) => goalForMonth(goals, ym)));
  const reachedMonths = elapsed.filter((ym) => monthSales(ym).gte(goalForMonth(goals, ym))).length;
  const ratio = totalGoal.isZero() ? ZERO : sum(elapsed.map(monthSales)).div(totalGoal);

  const live = projects.filter((p) => !p.voided);
  const toInvoice = live.filter((p) => p.fin.billingStatus !== "INVOICED");
  const toInvoiceValue = sum(toInvoice.map((p) => D(p.fin.pendingToInvoice).mul(p.currency === "COP" ? 1 : p.saleReferenceRate)));
  const projectIds = new Set(live.map((p) => p.id));
  const pendingInvoices = invoices.filter((i) => i.status === "ISSUED" && D(i.balance).gt(0) && projectIds.has(i.projectId));
  const pendingBalanceCOP = sum(pendingInvoices.filter((i) => i.currency === "COP").map((i) => i.balance));
  const foreignPending = pendingInvoices.filter((i) => i.currency !== "COP");
  const next = nextSettlement(today);
  const daysLeft = Math.round((new Date(`${next.paymentDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);

  return (
    <>
      <PageHeader eyebrow="Resumen" title="Dashboard" description="Estado de las ventas, la meta comercial y la facturación y recaudo que alimentan las comisiones." />

      <FilterBar
        searchName={null}
        selects={[
          { name: "year", label: "Año", options: years.map((y) => ({ value: y, label: y })), allLabel: year },
          { name: "semester", label: "Semestre", options: [{ value: "1", label: "Ene – Jun" }, { value: "2", label: "Jul – Dic" }], allLabel: "Año completo" },
          { name: "collaborator", label: "Colaborador", options: collaborators.map((c) => ({ value: c.id, label: c.fullName })), allLabel: "Todos" },
        ]}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ventas acumuladas" value={formatCOP0(totalSales)} sub={collaboratorId ? "Proyectos del colaborador seleccionado" : `Antes de IVA · ${year}${semester ? ` · semestre ${semester}` : ""}`} tone="brand" />
        <StatCard label="Cumplimiento de la meta" value={formatPercent(ratio, 1)} sub={`${reachedMonths} de ${elapsed.length} meses transcurridos alcanzaron la meta`} tone={ratio.gte(1) ? "success" : "warning"} />
        <StatCard label="Proyectos por facturar" value={toInvoice.length} sub={`Valor pendiente de facturar ≈ ${formatCOP0(toInvoiceValue)}`} tone="warning" />
        <StatCard label="Facturas por recaudar" value={pendingInvoices.length} sub={`Saldo ${formatCOP0(pendingBalanceCOP)}${foreignPending.length ? ` + ${foreignPending.length} en otra moneda` : ""}`} tone="warning" />
      </div>

      <div className="mb-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Comisión potencial"
          value={formatMoney(commissions.potential, "COP", 0)}
          sub={`Proyectos vendidos en el período (meses validados)${D(commissions.potentialUnvalidated).gt(0) ? ` · hasta ${formatCOP0(commissions.potentialUnvalidated)} más por validar` : ""}`}
        />
        <StatCard label="Comisión generada" value={formatMoney(commissions.generated, "COP", 0)} sub="Sobre lo facturado y recaudado en el período" tone="brand" />
        <StatCard label="Pendiente de pago" value={formatMoney(commissions.pendingPayment, "COP", 0)} sub="Generada acumulada menos pagos registrados" tone="warning" />
        <StatCard label="Liquidada históricamente" value={formatMoney(commissions.liquidated, "COP", 0)} sub={`Pagada: ${formatMoney(commissions.paid, "COP", 0)}`} tone="success" />
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        Estas cifras son subconjuntos y no se suman: potencial ⊇ generada (lo recaudado) ⊇ liquidada (aprobada en una liquidación cerrada) ⊇ pagada.
      </p>
      <StatCard
        className="mb-6"
        label="Próxima liquidación"
        value={formatDate(next.paymentDate)}
        sub={`${next.label} · recaudos del ${formatDate(next.periodStart)} al ${formatDate(next.periodEnd)} · faltan ${daysLeft} días`}
        tone="brand"
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Ventas mensuales frente a la meta</CardTitle>
        </CardHeader>
        <CardContent>
          <SalesChart data={chartData} />
          <p className="mt-2 text-xs text-muted-foreground">Ventas en COP antes de IVA, convertidas a la TRM del día de la venta. Meses sin barra: sin ventas registradas.</p>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader><CardTitle>Proyectos pendientes de facturación</CardTitle></CardHeader>
          <CardContent>
            {toInvoice.length === 0 ? <p className="text-sm text-muted-foreground">Todo facturado.</p> : (
              <ul className="divide-y text-sm">
                {toInvoice.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/proyectos/${p.id}`} className="min-w-0 truncate underline-offset-4 hover:underline"><span className="num font-semibold">{p.code}</span> · {p.client}</Link>
                    <span className="num shrink-0 text-muted-foreground">{formatMoney(p.fin.pendingToInvoice, p.currency as CurrencyCode, 0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardTitle>Facturas pendientes de recaudo</CardTitle></CardHeader>
          <CardContent>
            {pendingInvoices.length === 0 ? <p className="text-sm text-muted-foreground">Sin saldos pendientes.</p> : (
              <ul className="divide-y text-sm">
                {pendingInvoices.slice(0, 6).map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/proyectos/${i.projectId}`} className="min-w-0 truncate underline-offset-4 hover:underline"><span className="num font-semibold">{i.number}</span> · {i.client}</Link>
                    <span className="num shrink-0 text-muted-foreground">{formatMoney(i.balance, i.currency as CurrencyCode, 0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

