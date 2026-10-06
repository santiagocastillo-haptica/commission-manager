import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { todayBogota, yearOf } from "@/domain/dates";
import { suggestProjectCode } from "@/domain/project";
import { requireSession } from "@/server/auth";
import { existingProjectCodes, projectFormContext } from "@/server/queries/projects";
import { ProjectForm } from "../project-form";

export const metadata: Metadata = { title: "Nuevo proyecto" };

export default async function NewProjectPage() {
  await requireSession();
  const today = todayBogota();
  const year = yearOf(today);
  const [ctx, codes] = await Promise.all([projectFormContext(), existingProjectCodes(year)]);

  return (
    <>
      <PageHeader eyebrow="Proyectos" title="Registrar proyecto vendido" description="Registra la venta, los costos de proveedores y los colaboradores con su porcentaje. La base comisionable se calcula automáticamente." />
      <ProjectForm
        collaborators={ctx.collaborators}
        months={ctx.months}
        defaultGoalCOP={ctx.defaultGoalCOP}
        initial={{
          code: suggestProjectCode(year, codes),
          name: "",
          client: "",
          country: "CO",
          saleDate: today,
          currency: "COP",
          saleAmount: "",
          providerCosts: "0",
          saleReferenceRate: "",
          expectedInvoices: "1",
          notes: "",
          assignments: [],
        }}
      />
    </>
  );
}
