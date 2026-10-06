import { cn } from "@/lib/utils";

/** Indicador financiero: rótulo, valor grande y contexto. `pending` marca indicadores cuyo módulo aún no está implementado. */
export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  pending,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "brand" | "success" | "warning" | "danger";
  pending?: string;
  className?: string;
}) {
  const bar = {
    default: "bg-border",
    brand: "bg-primary",
    success: "bg-brand-mint",
    warning: "bg-brand-amber",
    danger: "bg-brand-orange",
  }[tone];
  return (
    <div className={cn("relative overflow-hidden rounded-lg border bg-card p-5", className)}>
      <span className={cn("absolute inset-y-0 left-0 w-1", bar)} aria-hidden />
      <p className="eyebrow">{label}</p>
      {pending ? (
        <>
          <p className="num mt-3 text-2xl font-bold text-muted-foreground/60">—</p>
          <p className="mt-1.5 text-xs text-muted-foreground">{pending}</p>
        </>
      ) : (
        <>
          <p className="num mt-3 text-2xl font-bold text-brand-deep">{value}</p>
          {sub && <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>}
        </>
      )}
    </div>
  );
}
