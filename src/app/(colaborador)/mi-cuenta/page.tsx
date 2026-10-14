import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EligibilityBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMonth } from "@/domain/dates";
import { D, formatMoney, formatPercent } from "@/domain/money";
import { requireUser } from "@/server/auth";
import { getCollaborator } from "@/server/queries/collaborators";
import { commissionTotals, loadCommissionProjects, summarizeAssignments } from "@/server/queries/commissions";
import { listProjects } from "@/server/queries/projects";
import { listCollaboratorSettlements } from "@/server/queries/settlements";

export const metadata: Metadata = { title: "Mis comisiones" };

/**
 * Página del colaborador. Todo se consulta con el identificador que viene de su sesión (nunca de la URL), y solo se
 * muestran sus propias asignaciones: no aparecen otras personas ni sus porcentajes.
 */
export default async function MyAccountPage() {
  const session = await requireUser();
  const id = session.collaboratorId;
  if (session.role !== "COLLABORATOR" || !id) {
    return (
      <>
        <PageHeader title="Mis comisiones" />
        <p className="text-sm text-muted-foreground">
          Esta página es para colaboradores. Eres administrador: usa el <Link href="/" className="font-semibold text-brand-deep underline-offset-4 hover:underline">panel principal</Link>.
        </p>
      </>
    );
  }

  const [collab, projects, totals, loaded, settlements] = await Promise.all([
    getCollaborator(id),
    listProjects({ collaboratorId: id }),
    commissionTotals({ collaboratorId: id }),
    loadCommissionProjects({ collaboratorId: id }),
    listCollaboratorSettlements(id),
  ]);
  if (!collab) return <p className="text-sm text-muted-foreground">No encontramos tu registro de colaborador. Escribe al administrador.</p>;
  const commission = summarizeAssignments(loaded);
  const rows = projects.map((p) => ({ project: p, assignment: p.assignments.find((a) => a.collaboratorId === id) })).filter((r) => r.assignment);

  return (
    <>
      <PageHeader eyebrow={collab.position} title={collab.fullName} description="Aquí ves tus proyectos, tus comisiones y tus liquidaciones. Es una vista de solo lectura." />

      <div className="mb-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Generada" value={formatMoney(totals.generatedAllTime, "COP", 0)} sub="Sobre lo recaudado" tone="brand" />
        <StatCard label="Liquidada" value={formatMoney(totals.liquidated, "COP", 0)} sub="En liquidaciones cerradas" tone="success" />
        <StatCard label="Pagada" value={formatMoney(totals.paid, "COP", 0)} sub="Pagos registrados" tone="success" />
        <StatCard label="Pendiente de pago" value={formatMoney(totals.pendingPayment, "COP", 0)} sub="Generada − pagada" tone="warning" />
      </div>
      <p className="mb-6 text-xs text-muted-foreground">Son subconjuntos, no se suman: generada ⊇ liquidada ⊇ pagada.</p>

      <h2 className="mt-8 mb-3 text-lg font-bold">Mis proyectos</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no tienes proyectos asignados.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Proyecto</TableHead>
                <TableHead>Venta</TableHead>
                <TableHead className="text-right">Valor de la venta</TableHead>
                <TableHead className="text-right">% efectivo</TableHead>
                <TableHead className="text-right">Comisión generada</TableHead>
                <TableHead>Meta del mes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ project: p, assignment: a }) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <span className="font-semibold text-brand-deep">{p.code}</span>
                    <div className="text-xs text-muted-foreground">{p.client}</div>
                  </TableCell>
                  <TableCell className="capitalize">
                    {formatDate(p.saleDate)}
                    <div className="text-xs text-muted-foreground">{formatMonth(p.saleMonth)}</div>
                  </TableCell>
                  <TableCell className="num text-right">{formatMoney(p.saleAmount, p.currency, 0)}</TableCell>
                  <TableCell className="num text-right">{a!.effectiveRate ? formatPercent(D(a!.effectiveRate)) : "—"}</TableCell>
                  <TableCell className="num text-right font-semibold">{commission.get(a!.id) ? formatMoney(commission.get(a!.id)!.generatedCOP, "COP", 0) : "—"}</TableCell>
                  <TableCell>
                    <EligibilityBadge status={p.eligibility.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <h2 className="mt-8 mb-3 text-lg font-bold">Mis liquidaciones</h2>
      {settlements.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no hay liquidaciones cerradas con tus comisiones.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {settlements.map((cs) => (
            <li key={cs.code} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-[110px] font-semibold text-brand-deep">{cs.code}</span>
              <span className="num">{formatMoney(cs.netPayable, "COP", 2)}</span>
              <Badge variant={cs.paymentStatus === "PAID" ? "success" : "warning"}>{cs.paymentStatus === "PAID" ? "Pagada" : "Pendiente de pago"}</Badge>
              <span className="flex flex-wrap gap-2">
                {cs.hasCommissions && (
                  <Button size="xs" variant="outline" render={<a href={`/api/liquidaciones/${cs.code}/individual/${id}`} download />}>
                    <Download data-icon="inline-start" /> Reporte de comisiones
                  </Button>
                )}
                {cs.hasBonus && (
                  <Button size="xs" variant="outline" render={<a href={`/api/liquidaciones/${cs.code}/bonificacion/${id}`} download />}>
                    <Download data-icon="inline-start" /> Carta de bonificación
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
