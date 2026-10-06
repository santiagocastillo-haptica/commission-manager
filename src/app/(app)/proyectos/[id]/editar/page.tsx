import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { D } from "@/domain/money";
import { requireSession } from "@/server/auth";
import { getProject, projectFormContext } from "@/server/queries/projects";
import { ProjectForm } from "../../project-form";

export const metadata: Metadata = { title: "Editar proyecto" };

export default async function EditProjectPage({ params }: PageProps<"/proyectos/[id]/editar">) {
  await requireSession();
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  if (project.voided) redirect(`/proyectos/${id}`);

  const ctx = await projectFormContext({ saleMonth: project.saleMonth, saleAmountCOP: project.saleAmountCOP });
  const locked = ctx.months[project.saleMonth]?.status === "VALIDATED" ? project.saleMonth : undefined;

  return (
    <>
      <PageHeader eyebrow={project.code} title="Editar proyecto" />
      <ProjectForm
        projectId={project.id}
        lockedMonth={locked}
        collaborators={ctx.collaborators}
        months={ctx.months}
        defaultGoalCOP={ctx.defaultGoalCOP}
        initial={{
          code: project.code,
          name: project.name,
          client: project.client,
          country: project.country,
          saleDate: project.saleDate,
          currency: project.currency,
          saleAmount: project.saleAmount,
          providerCosts: project.providerCosts,
          saleReferenceRate: project.currency === "COP" ? "" : project.saleReferenceRate,
          expectedInvoices: String(project.expectedInvoices),
          notes: project.notes ?? "",
          assignments: project.assignments.map((a) => ({ collaboratorId: a.collaboratorId, ratePercent: D(a.baseRate).mul(100).toFixed() })),
        }}
      />
    </>
  );
}
