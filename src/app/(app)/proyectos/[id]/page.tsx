import { ArrowLeft, Pencil, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdjustmentFormDialog, InvoiceFormDialog, type InvoiceProjectRef } from "@/components/billing/dialogs";
import { VoidAdjustmentButton, VoidProjectButton } from "@/components/billing/void-buttons";
import { InvoiceTable } from "@/components/billing/invoice-table";
import { EligibilityReason } from "@/components/eligibility-reason";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { BillingBadge, CollectionBadge, VoidedBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COUNTRY_LABEL } from "@/domain/countries";
import { formatDate } from "@/domain/dates";
import { D, formatMoney, formatPercent, type CurrencyCode } from "@/domain/money";
import { requireSession } from "@/server/auth";
import { listAdjustments, listInvoices, projectHistory } from "@/server/queries/billing";
import { loadCommissionProjects, summarizeAssignments } from "@/server/queries/commissions";
import { getProject, projectRateHistory } from "@/server/queries/projects";

export const metadata: Metadata = { title: "Proyecto" };

const KIND: Record<string, string> = {
  CREDIT_NOTE: "Nota crédito",
  DISCOUNT: "Descuento posterior",
  CONTRACT_REDUCTION: "Reducción contractual",
  PROVIDER_COST: "Costos de proveedores",
};
const ACTION: Record<string, string> = { CREATE: "Creación", UPDATE: "Cambio", VOID: "Anulación", VALIDATE: "Validación", REOPEN: "Reapertura", APPROVE: "Aprobación", PAY: "Pago" };

export default async function ProjectDetailPage({ params }: PageProps<"/proyectos/[id]">) {
  await requireSession();
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const [invoices, adjustments, history, rateHistory, loaded] = await Promise.all([
    listInvoices({ projectId: id }),
    listAdjustments(id),
    projectHistory(id),
    projectRateHistory(id),
    loadCommissionProjects({ projectId: id }),
  ]);
  const commission = summarizeAssignments(loaded);

  const cur = project.currency as CurrencyCode;
  const remaining = D(project.saleAmount).minus(project.fin.scheduled);
  const projectRef: InvoiceProjectRef = {
    id: project.id,
    code: project.code,
    currency: cur,
    remainingToInvoice: remaining.isNegative() ? "0" : remaining.toFixed(),
    pendingInvoices: Math.max(1, project.expectedInvoices - project.fin.invoiceCount),
  };
  const issued = invoices.filter((i) => i.status === "ISSUED" && !i.voided);

  return (
    <>
      <Link href="/proyectos" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-brand-deep">
        <ArrowLeft className="size-3.5" /> Proyectos
      </Link>
      <PageHeader
        eyebrow={project.code}
        title={project.client}
        actions={
          project.voided ? (
            <VoidedBadge />
          ) : (
            <>
              <Button render={<Link href={`/proyectos/${project.id}/editar`} />} variant="outline">
                <Pencil data-icon="inline-start" /> Editar
              </Button>
              <VoidProjectButton id={project.id} code={project.code} />
            </>
          )
        }
      />

      {project.voided && (
        <p className="mb-5 border-l-2 border-danger bg-danger-soft px-4 py-3 text-sm text-danger">Proyecto anulado. Motivo: {project.voidReason}</p>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <EligibilityReason status={project.eligibility.status} reason={project.eligibility.reason} />
        <BillingBadge status={project.fin.billingStatus} />
        <CollectionBadge status={project.fin.collectionStatus} />
        <span className="text-sm text-muted-foreground">
          {COUNTRY_LABEL[project.country]} · vendido el {formatDate(project.saleDate)} · {project.fin.issuedInvoices} de {project.expectedInvoices} facturas emitidas
        </span>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Venta antes de IVA" value={formatMoney(project.saleAmount, cur, 0)} sub={cur !== "COP" ? `≈ ${formatMoney(project.saleAmountCOP, "COP", 0)} a TRM ${formatMoney(project.saleReferenceRate, "COP", 2)}` : `Costos de proveedores: ${formatMoney(project.providerCosts, cur, 0)}`} />
        <StatCard label="Base neta comisionable" value={formatMoney(project.netBase, cur, 0)} sub={cur !== "COP" ? `Costos de proveedores: ${formatMoney(project.providerCosts, cur, 0)}` : "Venta − costos de proveedores"} tone="brand" />
        <StatCard label="Facturado" value={formatMoney(project.fin.invoiced, cur, 0)} sub={`Por facturar: ${formatMoney(project.fin.pendingToInvoice, cur, 0)}`} tone="warning" />
        <StatCard label="Recaudado" value={formatMoney(project.fin.collected, cur, 0)} sub={`Saldo por recaudar: ${formatMoney(project.fin.pendingCollection, cur, 0)}`} tone="success" />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Elegibilidad</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed text-foreground/80">
          {project.eligibility.reason}
          <p className="mt-2 text-xs text-muted-foreground">
            Aun siendo elegible, la comisión solo se paga sobre lo efectivamente facturado y recaudado.
          </p>
        </CardContent>
      </Card>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">Colaboradores y porcentajes</h2>
        {project.assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin colaboradores con comisión. El proyecto cuenta para la meta organizacional del mes.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Política</TableHead>
                  <TableHead className="text-right">% base asignado</TableHead>
                  <TableHead className="text-right">% efectivo</TableHead>
                  <TableHead className="text-right">Potencial</TableHead>
                  <TableHead className="text-right">Generada (recaudada)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {project.assignments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/colaboradores/${a.collaboratorId}`} className="font-medium underline-offset-4 hover:underline">{a.collaboratorName}</Link>
                    </TableCell>
                    <TableCell>{a.policyCode === "GAMIFICATION" ? <Badge variant="info">Gamificación</Badge> : <Badge variant="neutral">General</Badge>}</TableCell>
                    <TableCell className="num text-right font-semibold">{formatPercent(a.baseRate)}</TableCell>
                    <TableCell className="num text-right text-muted-foreground" title={a.effectiveRateRule ?? "Se define al validar el mes de venta"}>
                      {a.effectiveRate ? formatPercent(a.effectiveRate) : "—"}
                    </TableCell>
                    <TableCell className="num text-right">
                      {commission.get(a.id)?.potentialCOP != null ? formatMoney(commission.get(a.id)!.potentialCOP, "COP", 0) : <span className="text-xs text-muted-foreground">Al validar el mes</span>}
                    </TableCell>
                    <TableCell className="num text-right font-semibold">{commission.get(a.id) ? formatMoney(commission.get(a.id)!.generatedCOP, "COP", 0) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {rateHistory.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Historial de porcentajes ({rateHistory.length})</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {rateHistory.map((r) => (
                <li key={r.id}>
                  <span className="num">{formatDate(r.at.slice(0, 10))}</span> · {r.collaboratorName}: <span className="num font-semibold text-foreground">{formatPercent(r.baseRate)}</span>
                  {r.reason ? ` — ${r.reason}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Facturas y recaudos</h2>
          {!project.voided && (
            <InvoiceFormDialog project={projectRef} trigger={<Button size="sm"><Plus data-icon="inline-start" /> Registrar factura</Button>} />
          )}
        </div>
        {invoices.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay facturas registradas ni previstas.</p> : <InvoiceTable invoices={invoices} projects={{ [project.id]: projectRef }} />}
      </section>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Ajustes financieros</h2>
          {!project.voided && (
            <AdjustmentFormDialog
              project={{ id: project.id, code: project.code, currency: cur }}
              invoices={issued.map((i) => ({ id: i.id, number: i.number! }))}
              trigger={<Button size="sm" variant="outline"><Plus data-icon="inline-start" /> Registrar ajuste</Button>}
            />
          )}
        </div>
        {adjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ajustes. Registra aquí notas crédito, descuentos posteriores o ajustes de costos que reduzcan la base comisionable.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="text-right">Reduce la base</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustments.map((a) => (
                  <TableRow key={a.id} className={a.voided ? "opacity-55" : ""}>
                    <TableCell className="num whitespace-nowrap">{formatDate(a.date)}</TableCell>
                    <TableCell>{KIND[a.kind]}{a.invoiceNumber && <div className="num text-xs text-muted-foreground">Factura {a.invoiceNumber}</div>}</TableCell>
                    <TableCell className="max-w-sm text-sm">{a.reason}</TableCell>
                    <TableCell className="num text-right font-semibold">−{formatMoney(a.amount, a.currency as CurrencyCode, 0)}</TableCell>
                    <TableCell>
                      {a.voided ? <Badge variant="danger">Anulado</Badge> : a.status === "APPLIED" ? <Badge variant="success">Aplicado</Badge> : <Badge variant="warning">Pendiente de liquidar</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      {!a.voided && a.status === "PENDING" && (
                        <VoidAdjustmentButton id={a.id} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Historial de cambios</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin movimientos registrados.</p>
        ) : (
          <ol className="divide-y rounded-lg border text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="num w-36 shrink-0 text-xs text-muted-foreground">{new Date(h.at).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" })}</span>
                <Badge variant="neutral">{ACTION[h.action] ?? h.action}</Badge>
                <span className="min-w-0 flex-1">{h.summary}</span>
                <span className="text-xs text-muted-foreground">{h.user ?? "Sistema"}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
