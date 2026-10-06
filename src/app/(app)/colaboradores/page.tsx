import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ActiveBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/domain/dates";
import { requireSession } from "@/server/auth";
import { listCollaborators, listPolicies } from "@/server/queries/collaborators";
import { CollaboratorFormDialog } from "./collaborator-form";

export const metadata: Metadata = { title: "Colaboradores" };

export default async function CollaboratorsPage() {
  await requireSession();
  const [rows, policies] = await Promise.all([listCollaborators(), listPolicies()]);
  const policyOptions = policies.map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <PageHeader
        eyebrow="Equipo"
        title="Colaboradores"
        description="Personas con derecho a comisión. Su historial y sus derechos económicos se conservan aunque dejen de estar activas."
        actions={
          <CollaboratorFormDialog
            policies={policyOptions}
            trigger={
              <Button>
                <Plus data-icon="inline-start" /> Nuevo colaborador
              </Button>
            }
          />
        }
      />

      {rows.length === 0 ? (
        <EmptyState title="Aún no hay colaboradores" description="Crea el primer colaborador para poder asignarle comisiones en los proyectos." />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Colaborador</TableHead>
                <TableHead className="hidden md:table-cell">Cargo</TableHead>
                <TableHead>Política</TableHead>
                <TableHead className="hidden lg:table-cell">Ingreso</TableHead>
                <TableHead className="text-right">Proyectos</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id} className="hover:bg-accent/40">
                  <TableCell>
                    <Link href={`/colaboradores/${c.id}`} className="font-semibold text-brand-deep underline-offset-4 hover:underline">
                      {c.fullName}
                    </Link>
                    <div className="text-xs text-muted-foreground">{c.email}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{c.position}</TableCell>
                  <TableCell>
                    {c.policyCode === "GAMIFICATION" ? <Badge variant="info">Gamificación</Badge> : <Badge variant="neutral">General</Badge>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell num">{formatDate(c.joinDate)}</TableCell>
                  <TableCell className="num text-right">{c.projectCount}</TableCell>
                  <TableCell>
                    <ActiveBadge active={c.status === "ACTIVE"} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
