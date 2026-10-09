"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatMonthShort } from "@/domain/dates";
import { formatMoney, formatPercent, type CurrencyCode } from "@/domain/money";
import { setProjectReviewAction } from "@/server/actions/settlements";
import type { ProjectReviewView } from "@/server/queries/settlements";

const REVIEW_BADGE = {
  ACCEPTED: { label: "Aceptado", variant: "success" },
  STALE: { label: "Cambió: revísalo de nuevo", variant: "warning" },
  PENDING: { label: "Pendiente", variant: "neutral" },
} as const;

/** Lista de proyectos de la liquidación: cada uno se puede abrir, revisar y marcar como «está bien». */
export function ProjectReviewPanel({ code, projects, readOnly }: { code: string; projects: ProjectReviewView[]; readOnly: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "pending" | "accepted">("all");
  const [state, setState] = useState<Record<string, ProjectReviewView["review"]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const current = (p: ProjectReviewView) => state[p.projectCode] ?? p.review;
  const accepted = projects.filter((p) => current(p) === "ACCEPTED").length;
  const shown = projects.filter((p) => (filter === "pending" ? current(p) !== "ACCEPTED" : filter === "accepted" ? current(p) === "ACCEPTED" : true));

  async function toggle(p: ProjectReviewView, accept: boolean) {
    setBusy(p.projectCode);
    const res = await setProjectReviewAction({ code, projectCode: p.projectCode, accepted: accept });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    setState((s) => ({ ...s, [p.projectCode]: accept ? "ACCEPTED" : "PENDING" }));
    router.refresh();
  }

  if (projects.length === 0) return null;
  const filters = [
    ["all", `Todos (${projects.length})`],
    ["pending", `Pendientes (${projects.length - accepted})`],
    ["accepted", `Aceptados (${accepted})`],
  ] as const;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold">Revisión por proyecto</h3>
        <div className="flex gap-1.5" role="group" aria-label="Filtrar proyectos">
          {filters.map(([k, label]) => (
            <Button key={k} size="xs" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div aria-live="polite">
        <div className="h-2 overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${(accepted / projects.length) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {accepted} de {projects.length} proyectos revisados. Abre cada uno, verifica sus líneas y acéptalo si está bien; si los datos cambian después, la aceptación se anula sola.
        </p>
      </div>
      <ul className="space-y-2">
        {shown.length === 0 && <li className="text-sm text-muted-foreground">No hay proyectos en este filtro.</li>}
        {shown.map((p) => {
          const st = current(p);
          const badge = REVIEW_BADGE[st];
          return (
            <li key={p.projectId} className={`rounded-lg border ${st === "ACCEPTED" ? "border-brand-mint bg-success-soft/40" : ""}`}>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
                <span className="min-w-[180px] flex-1">
                  <Link href={`/proyectos/${p.projectId}`} className="num font-semibold text-brand-deep underline-offset-4 hover:underline">
                    {p.projectCode}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    Venta {formatMonthShort(p.saleMonth)} · {p.people.join(", ")} · {p.lines.length} línea(s)
                  </span>
                </span>
                <span className="num text-right text-sm font-semibold">{formatMoney(p.total, "COP", 2)}</span>
                <Badge variant={badge.variant}>{badge.label}</Badge>
                {!readOnly &&
                  (st === "ACCEPTED" ? (
                    <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => toggle(p, false)}>
                      Quitar aceptación
                    </Button>
                  ) : (
                    <Button size="xs" disabled={busy !== null} onClick={() => toggle(p, true)}>
                      <Check data-icon="inline-start" /> {busy === p.projectCode ? "Guardando…" : "Está bien"}
                    </Button>
                  ))}
              </div>
              {st === "ACCEPTED" && p.acceptedAt && (
                <p className="px-4 pb-2 text-xs text-muted-foreground">
                  Aceptado{p.acceptedBy ? ` por ${p.acceptedBy}` : ""} el {new Date(p.acceptedAt).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" })}.
                </p>
              )}
              <details className="border-t">
                <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-primary">Ver las líneas del proyecto</summary>
                <div className="overflow-x-auto px-2 pb-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="px-2 py-1">Colaborador</th>
                        <th className="px-2 py-1">Factura</th>
                        <th className="px-2 py-1">Recaudo</th>
                        <th className="px-2 py-1 text-right">Valor recaudado</th>
                        <th className="px-2 py-1 text-right">Base neta (COP)</th>
                        <th className="px-2 py-1 text-right">%</th>
                        <th className="px-2 py-1 text-right">Comisión</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.lines.map((l, i) => (
                        <tr key={i} className={l.type === "ADJUSTMENT" ? "bg-warning-soft/60" : undefined}>
                          <td className="px-2 py-1">{l.collaborator}</td>
                          <td className="num px-2 py-1">{l.type === "ADJUSTMENT" ? "Ajuste" : (l.invoiceNumber ?? "—")}</td>
                          <td className="num whitespace-nowrap px-2 py-1">{l.type === "ADJUSTMENT" ? "—" : formatDate(l.collectionDate)}</td>
                          <td className="num px-2 py-1 text-right">{l.type === "ADJUSTMENT" ? "—" : formatMoney(l.amountReceived, l.currency as CurrencyCode, 2)}</td>
                          <td className="num px-2 py-1 text-right">{formatMoney(l.netBaseCOP, "COP", 2)}</td>
                          <td className="num px-2 py-1 text-right">{formatPercent(l.effectiveRate, 2)}</td>
                          <td className="num px-2 py-1 text-right font-semibold">{formatMoney(l.commissionCOP, "COP", 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
