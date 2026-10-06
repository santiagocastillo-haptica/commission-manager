import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EligibilityReason } from "@/components/eligibility-reason";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { BillingBadge, CollectionBadge, VoidedBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMonth } from "@/domain/dates";
import { D, formatCOP0, formatMoney, formatPercent, sum, type CurrencyCode } from "@/domain/money";
import { requireSession } from "@/server/auth";
import { listCollaborators } from "@/server/queries/collaborators";
import { listProjects, projectYears } from "@/server/queries/projects";

export const metadata: Metadata = { title: "Proyectos" };

const COUNTRY: Record<string, string> = { CO: "Colombia", CL: "Chile", MX: "México" };

export default async function ProjectsPage({ searchParams }: PageProps<"/proyectos">) {
  await requireSession();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const [projects, years, collaborators] = await Promise.all([
    listProjects({
      q: one("q"),
      year: one("year"),
      country: one("country"),
      collaboratorId: one("collaborator"),
      eligibility: one("eligibility"),
      billing: one("billing"),
      showVoided: one("voided") === "1",
    }),
    projectYears(),
    listCollaborators(),
  ]);

  const live = projects.filter((p) => !p.voided);
  const totalSales = sum(live.map((p) => p.saleAmountCOP));
  const pendingInvoice = live.filter((p) => p.fin.billingStatus !== "INVOICED").length;
  const pendingCollect = live.filter((p) => p.fin.billingStatus !== "NOT_INVOICED" && p.fin.collectionStatus !== "COLLECTED").length;

  return (
    <>
      <PageHeader
        eyebrow="Ventas"
        title="Proyectos"
        description="Punto de entrada de los proyectos vendidos: valores, costos, colaboradores con comisión y estado de facturación y recaudo."
        actions={
          <Button render={<Link href="/proyectos/nuevo" />}>
            <Plus data-icon="inline-start" /> Nuevo proyecto
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Proyectos" value={live.length} sub="Según los filtros aplicados" tone="brand" />
        <StatCard label="Ventas (COP)" value={formatCOP0(totalSales)} sub="Antes de IVA, a la TRM de referencia de cada venta" />
        <StatCard label="Por facturar / por recaudar" value={`${pendingInvoice} / ${pendingCollect}`} sub="Proyectos con facturación o recaudo pendiente" tone="warning" />
      </div>

      <FilterBar
        searchPlaceholder="Buscar por código, nombre o cliente…"
        selects={[
          { name: "year", label: "Año de venta", options: years.map((y) => ({ value: y, label: y })), allLabel: "Todos" },
          { name: "country", label: "País", options: [{ value: "CO", label: "Colombia" }, { value: "CL", label: "Chile" }, { value: "MX", label: "México" }] },
          { name: "collaborator", label: "Colaborador", options: collaborators.map((c) => ({ value: c.id, label: c.fullName })) },
          { name: "eligibility", label: "Elegibilidad", options: [{ value: "PENDING_VALIDATION", label: "Pendiente de validación" }, { value: "ELIGIBLE", label: "Elegible" }, { value: "NOT_ELIGIBLE", label: "No elegible" }] },
          { name: "billing", label: "Facturación / recaudo", options: [{ value: "pending-invoice", label: "Pendiente de facturar" }, { value: "pending-collection", label: "Pendiente de recaudo" }, { value: "done", label: "Recaudado completo" }] },
          { name: "voided", label: "Anulados", options: [{ value: "1", label: "Incluir anulados" }], allLabel: "Ocultar" },
        ]}
      />

      {projects.length === 0 ? (
        <EmptyState title="No hay proyectos con estos filtros" description="Cambia los filtros o registra un nuevo proyecto vendido." action={<Button render={<Link href="/proyectos/nuevo" />}>Nuevo proyecto</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Proyecto</TableHead>
                <TableHead>Venta</TableHead>
                <TableHead className="text-right">Valor / base neta</TableHead>
                <TableHead>Colaboradores</TableHead>
                <TableHead>Elegibilidad</TableHead>
                <TableHead>Facturación</TableHead>
                <TableHead>Recaudo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => {
                const cur = p.currency as CurrencyCode;
                const collectedPct = D(p.saleAmount).isZero() ? D(0) : D(p.fin.collected).div(p.saleAmount);
                return (
                  <TableRow key={p.id} className={p.voided ? "opacity-55" : "hover:bg-accent/40"}>
                    <TableCell className="max-w-[300px]">
                      <Link href={`/proyectos/${p.id}`} className="num font-semibold text-brand-deep underline-offset-4 hover:underline">{p.code}</Link>
                      {p.voided && <span className="ml-2"><VoidedBadge /></span>}
                      <div className="truncate text-sm" title={p.name}>{p.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{p.client}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="capitalize">{formatMonth(p.saleMonth)}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(p.saleDate)} · {COUNTRY[p.country]}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <div className="num font-medium">{formatMoney(p.saleAmount, cur, 0)}</div>
                      <div className="num text-xs text-muted-foreground">base {formatMoney(p.netBase, cur, 0)}</div>
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      {p.assignments.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Sin comisión</span>
                      ) : (
                        <ul className="space-y-0.5 text-xs">
                          {p.assignments.map((a) => (
                            <li key={a.id} className="flex justify-between gap-3">
                              <span className="truncate">{a.collaboratorName.replace(" (demo)", "")}</span>
                              <span className="num font-semibold">{formatPercent(a.baseRate)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell>
                      <EligibilityReason status={p.eligibility.status} reason={p.eligibility.reason} />
                    </TableCell>
                    <TableCell>
                      <BillingBadge status={p.fin.billingStatus} />
                      <div className="num mt-1 text-xs text-muted-foreground">{p.fin.issuedInvoices} de {p.expectedInvoices} facturas</div>
                    </TableCell>
                    <TableCell>
                      <CollectionBadge status={p.fin.collectionStatus} />
                      <div className="mt-1.5 h-1 w-24 bg-muted" role="img" aria-label={`Recaudado ${formatPercent(collectedPct, 0)}`}>
                        <div className="h-full bg-brand-mint" style={{ width: `${Math.min(100, collectedPct.mul(100).toNumber())}%` }} />
                      </div>
                      <div className="num mt-1 text-xs text-muted-foreground">{formatPercent(collectedPct, 0)} del valor</div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
