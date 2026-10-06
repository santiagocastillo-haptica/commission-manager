import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProductName } from "@/components/brand";
import { getSession } from "@/server/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");
  const { next } = await searchParams;

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between bg-brand-deep p-12 text-white lg:flex">
        <ProductName tone="light" />
        <div className="max-w-md">
          <div className="rail mb-6" />
          <h1 className="text-4xl font-light leading-tight !text-white">
            Comisiones claras, liquidaciones sin cálculos manuales.
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-white/70">
            Registra ventas, recaudos y ajustes. El sistema calcula, liquida y deja la trazabilidad completa.
          </p>
        </div>
        <p className="text-xs text-white/40">Uso interno · Háptica</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <ProductName />
          </div>
          <p className="eyebrow">Acceso</p>
          <h2 className="mt-2 mb-8 text-2xl font-bold">Ingresar a tu cuenta</h2>
          <LoginForm next={typeof next === "string" ? next : undefined} />
        </div>
      </section>
    </main>
  );
}
