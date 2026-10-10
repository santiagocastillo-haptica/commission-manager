"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { InvoiceFormDialog, type InvoiceProjectRef } from "@/components/billing/dialogs";
import { NewInvoiceButton } from "@/components/billing/new-invoice-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatMonthShort } from "@/domain/dates";
import { formatMoney, formatPercent, type CurrencyCode } from "@/domain/money";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { D } from "@/domain/money";
import { setProjectReviewAction, setRateExceptionAction } from "@/server/actions/settlements";
import type { ProjectReviewAssignment, ProjectReviewView } from "@/server/queries/settlements";

const REVIEW_BADGE = {
  ACCEPTED: { label: "Aceptado", variant: "success" },
  STALE: { label: "Cambió: revísalo de nuevo", variant: "warning" },
  PENDING: { label: "Pendiente", variant: "neutral" },
} as const;

/** Excepción manual del porcentaje efectivo de una persona en un proyecto (sin tope, con motivo). */
function RateExceptionDialog({ projectCode, a }: { projectCode: string; a: ProjectReviewAssignment }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState(a.effectiveRate ? D(a.effectiveRate).mul(100).toFixed() : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  async function save(remove: boolean) {
    setError(undefined);
    setBusy(true);
    const res = await setRateExceptionAction({ projectCode, assignmentId: a.assignmentId, ratePercent: remove ? null : rate.trim(), reason: reason.trim() });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(res.message);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="outline">{a.exceptionReason ? "Cambiar excepción" : "Editar %"}</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Porcentaje de {a.collaborator} · {projectCode}
          </DialogTitle>
          <DialogDescription>
            Excepción manual del porcentaje efectivo (base {formatPercent(a.baseRate, 2)}). Aplica a todos sus recaudos de este proyecto que aún no estén liquidados. Queda registrada con tu nombre y el motivo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`ex-rate-${a.assignmentId}`}>Nuevo porcentaje efectivo (%)</Label>
            <Input id={`ex-rate-${a.assignmentId}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="num" />
            <p className="text-xs text-muted-foreground">En puntos porcentuales: 0.5 = 0,5 %; 1 = 1 %; 0 = sin comisión. Hoy: {a.effectiveRate ? formatPercent(a.effectiveRate, 2) : "—"}.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`ex-reason-${a.assignmentId}`}>Motivo (mínimo 10 caracteres)</Label>
            <Textarea id={`ex-reason-${a.assignmentId}`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="border-l-2 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          {a.exceptionReason && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => save(true)}>
              Quitar excepción
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={busy} onClick={() => save(false)}>
            {busy ? "Guardando…" : "Guardar excepción"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lista de proyectos de la liquidación: cada uno se puede abrir, revisar y marcar como «está bien». */
export function ProjectReviewPanel({ code, projects, readOnly, invoiceable }: { code: string; projects: ProjectReviewView[]; readOnly: boolean; invoiceable: (InvoiceProjectRef & { client: string })[] }) {
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

  if (projects.length === 0) {
    return readOnly ? null : (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold">Revisión por proyecto</h3>
        <NewInvoiceButton projects={invoiceable} />
      </div>
    );
  }
  const filters = [
    ["all", `Todos (${projects.length})`],
    ["pending", `Pendientes (${projects.length - accepted})`],
    ["accepted", `Aceptados (${accepted})`],
  ] as const;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold">Revisión por proyecto</h3>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar proyectos">
          {filters.map(([k, label]) => (
            <Button key={k} size="xs" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>
              {label}
            </Button>
          ))}
          {!readOnly && invoiceable.length > 0 && <NewInvoiceButton projects={invoiceable} />}
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
              <ul className="space-y-1 border-t px-4 py-2 text-xs">
                {p.assignments.map((a) => (
                  <li key={a.assignmentId} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="min-w-[160px] flex-1">
                      {a.collaborator}
                      <span className="text-muted-foreground">
                        {" "}
                        · base {formatPercent(a.baseRate, 2)} · efectivo <strong className="num text-foreground">{a.effectiveRate ? formatPercent(a.effectiveRate, 2) : "—"}</strong>
                      </span>
                    </span>
                    {a.exceptionReason && (
                      <Badge variant="warning" title={a.exceptionReason}>
                        Excepción{a.exceptionBy ? ` · ${a.exceptionBy}` : ""}
                      </Badge>
                    )}
                    {a.exceptionReason && <span className="max-w-[320px] truncate text-muted-foreground" title={a.exceptionReason}>{a.exceptionReason}</span>}
                    {!readOnly && <RateExceptionDialog key={`${a.effectiveRate}|${a.exceptionReason ?? ""}`} projectCode={p.projectCode} a={a} />}
                  </li>
                ))}
              </ul>
              {!readOnly && invoiceable.some((x) => x.id === p.projectId) && (
                <div className="border-t px-4 py-2">
                  <InvoiceFormDialog
                    key={p.projectId}
                    project={invoiceable.find((x) => x.id === p.projectId)!}
                    trigger={
                      <Button size="xs" variant="outline">
                        Agregar una factura faltante a este proyecto
                      </Button>
                    }
                  />
                </div>
              )}
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
