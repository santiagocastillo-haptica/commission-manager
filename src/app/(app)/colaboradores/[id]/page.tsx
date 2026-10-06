import { ArrowLeft, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatCard } from "@/components/stat-card";
import { PageHeader } from "@/components/page-header";
import { ActiveBadge, EligibilityBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMonth } from "@/domain/dates";
import { D, formatMoney, formatPercent } from "@/domain/money";
import { requireSession } from "@/server/auth";
import { getCollaborator, listPolicies } from "@/server/queries/collaborators";
import { commissionTotals, loadCommissionProjects, summarizeAssignments } from "@/server/queries/commissions";
import { listProjects } from "@/server/queries/projects";
import { listCollaboratorSettlements } from "@/server/queries/settlements";
import { CollaboratorFormDialog } from "../collaborator-form";

export const metadata: Metadata = { title: "Colaborador" };

export default async function CollaboratorDetailPage({ params }: PageProps<"/colaboradores/[id]">) {
  await requireSession();
  const { id } = await params;
  const [collab, policies, projects, totals, loaded, settlements] = await Promise.all([
    getCollaborator(id),
    listPolicies(),
    listProjects({ collaboratorId: id, showVoided: true }),
    commissionTotals({ collaboratorId: id }),
    loadCommissionProjects({ collaboratorId: id }),
    listCollaboratorSettlements(id),
  ]);
  const commission = summarizeAssignments(loaded);
  if (!collab) notFound();

  const rows = projects.map((p) => ({ project: p, assignment: p.assignments.find((a) => a.collaboratorId === id)! }));

  return (
    <>
      <Link href="/colaboradores" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-brand-deep">
        <ArrowLeft className="size-3.5" /> Colaboradores
      </Link>
      <PageHeader
        eyebrow={collab.position}
        title={collab.fullName}
        actions={
          <CollaboratorFormDialog
            collaboratorId={collab.id}
            policies={policies.map((p) => ({ id: p.id, name: p.name }))}
            initial={{
              fullName: collab.fullName,
              email: collab.email,
              position: collab.position,
              status: collab.status,
              policyId: collab.policyId,
              joinDate: collab.joinDate ?? "",
              notes: collab.notes ?? "",
            }}
            trigger={
              <Button variant="outline">
                <Pencil data-icon="inline-start" /> Editar
              </Button>
            }
          />
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="eyebrow">Datos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p>{collab.email}</p>
            <p className="text-muted-foreground">Ingreso: {formatDate(collab.joinDate)}</p>
            <div className="flex items-center gap-2 pt-1">
              <ActiveBadge active={collab.status === "ACTIVE"} />
              {collab.policyCode === "GAMIFICATION" ? <Badge variant="info">Gamificación</Badge> : <Badge variant="neutral">Política general</Badge>}
            </div>
          </CardContent>
        </Card>
        <Card size="sm" className="md:col-span-2">
          <CardHeader>
            <CardTitle className="eyebrow">Observaciones</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{collab.notes || "Sin observaciones."}</CardContent>
        </Card>
      </div>

      <div className="mb-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Potencial" value={formatMoney(totals.potential, "COP", 0)} sub={D(totals.potentialUnvalidated).gt(0) ? `+ hasta ${formatMoney(totals.potentialUnvalidated, "COP", 0)} por validar` : "Meses validados"} />
        <StatCard label="Generada" value={formatMoney(totals.generatedAllTime, "COP", 0)} sub="Sobre lo recaudado" tone="brand" />
        <StatCard label="Liquidada" value={formatMoney(totals.liquidated, "COP", 0)} sub="En liquidaciones cerradas" tone="success" />
        <StatCard label="Pagada" value={formatMoney(totals.paid, "COP", 0)} sub="Pagos registrados" tone="success" />
        <StatCard label="Pendiente de pago" value={formatMoney(totals.pendingPayment, "COP", 0)} sub="Generada − pagada" tone="warning" />
      </div>
      <p className="mb-6 text-xs text-muted-foreground">Son subconjuntos, no se suman: potencial ⊇ generada ⊇ liquidada ⊇ pagada.</p>

      <h2 className="mt-8 mb-3 text-lg font-bold">Proyectos asociados</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este colaborador no tiene proyectos asignados.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Proyecto</TableHead>
                <TableHead>Mes de venta</TableHead>
                <TableHead className="text-right">Base neta</TableHead>
                <TableHead className="text-right">% base</TableHead>
                <TableHead className="text-right">% efectivo</TableHead>
                <TableHead className="text-right">Potencial</TableHead>
                <TableHead className="text-right">Generada</TableHead>
                <TableHead>Elegibilidad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ project: p, assignment: a }) => (
                <TableRow key={p.id} className="hover:bg-accent/40">
                  <TableCell>
                    <Link href={`/proyectos/${p.id}`} className="font-semibold text-brand-deep underline-offset-4 hover:underline">
                      {p.code}
                    </Link>
                    <div className="text-xs text-muted-foreground">{p.name}</div>
                  </TableCell>
                  <TableCell className="capitalize">{formatMonth(p.saleMonth)}</TableCell>
                  <TableCell className="num text-right">{formatMoney(p.netBase, p.currency, 0)}</TableCell>
                  <TableCell className="num text-right">{formatPercent(a.baseRate)}</TableCell>
                  <TableCell className="num text-right text-muted-foreground">{a.effectiveRate ? formatPercent(D(a.effectiveRate)) : "—"}</TableCell>
                  <TableCell className="num text-right">{commission.get(a.id)?.potentialCOP != null ? formatMoney(commission.get(a.id)!.potentialCOP, "COP", 0) : <span className="text-xs text-muted-foreground">Por validar</span>}</TableCell>
                  <TableCell className="num text-right font-semibold">{commission.get(a.id) ? formatMoney(commission.get(a.id)!.generatedCOP, "COP", 0) : "—"}</TableCell>
                  <TableCell>
                    <EligibilityBadge status={p.eligibility.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <h2 className="mt-8 mb-3 text-lg font-bold">Historial de liquidaciones</h2>
      {settlements.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no hay liquidaciones cerradas con comisiones de este colaborador.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {settlements.map((cs) => (
            <li key={cs.code} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="font-semibold text-brand-deep">{cs.code}</span>
              <span className="num">{formatMoney(cs.netPayable, "COP", 2)}</span>
              <Badge variant={cs.paymentStatus === "PAID" ? "success" : "warning"}>{cs.paymentStatus === "PAID" ? "Pagada" : "Pendiente de pago"}</Badge>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
