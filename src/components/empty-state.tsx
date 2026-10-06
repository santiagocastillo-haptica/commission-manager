import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-14 text-center", className)}>
      <p className="text-sm font-semibold text-brand-deep">{title}</p>
      {description && <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Aviso de módulo no implementado: nunca se simula funcionalidad. */
export function PendingModule({ phase, children }: { phase: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-brand-amber/40 bg-warning-soft px-5 py-4 text-sm text-warning">
      <p className="font-bold uppercase tracking-[0.1em] text-[11px]">Pendiente · {phase}</p>
      <p className="mt-1.5 text-foreground/80">{children}</p>
    </div>
  );
}
