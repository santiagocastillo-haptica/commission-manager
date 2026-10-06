import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductName } from "@/components/brand";
import { isSetupOpen } from "./actions";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Configuración inicial", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  // Sin token configurado o con un usuario ya creado, la página no existe.
  if (!(await isSetupOpen())) notFound();
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <ProductName />
        </div>
        <p className="eyebrow">Primer uso</p>
        <h1 className="mt-2 mb-2 text-2xl font-bold">Crear el administrador</h1>
        <p className="mb-8 text-sm text-muted-foreground">Solo funciona una vez: cuando exista un usuario, esta página se cierra.</p>
        <SetupForm />
      </div>
    </main>
  );
}
