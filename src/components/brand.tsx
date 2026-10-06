import Image from "next/image";
import { cn } from "@/lib/utils";

/** Logotipo oficial de Háptica (SVG transparente, naranja de marca: se ve bien sobre fondo claro y oscuro). */
export function Logo({ className }: { className?: string }) {
  return <Image src="/brand/logo-haptica.svg" alt="Háptica" width={495} height={90} priority unoptimized className={cn("h-[28px] w-auto", className)} />;
}

export function ProductName({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <div className="leading-tight">
      <Logo />
      <div className={cn("mt-2 text-[10px] font-semibold uppercase tracking-[0.16em]", tone === "light" ? "text-white/60" : "text-muted-foreground")}>Commission Manager</div>
    </div>
  );
}
