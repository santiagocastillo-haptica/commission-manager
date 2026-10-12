"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMonthShort } from "@/domain/dates";
import { D, formatMoney, formatPercent } from "@/domain/money";
import { setRateExceptionAction } from "@/server/actions/settlements";
import type { SalesSweepPerson, SalesSweepRow } from "@/server/queries/settlements";

const OUTCOME = {
  ELIGIBLE: { label: "Cumplió la meta", variant: "success" },
  NOT_ELIGIBLE: { label: "No cumplió la meta", variant: "warning" },
  PENDING: { label: "Mes sin validar", variant: "neutral" },
} as const;

function BonusDialog({ projectCode, r, person }: { projectCode: string; r: SalesSweepRow; person: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState(r.bonusReason && r.effectiveRate ? D(r.effectiveRate).mul(100).toFixed() : "0.5");
  const [reason, setReason] = useState(r.bonusReason ?? "Bonificación por buen trabajo comercial");
  const [error, setError] = useState<string>();

  async function save(remove: boolean) {
    setError(undefined);
    setBusy(true);
    const res = await setRateExceptionAction({ projectCode, assignmentId: r.assignmentId, ratePercent: remove ? null : rate.trim(), reason: reason.trim(), kind: "BONUS" });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(res.message);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="outline">{r.bonusReason ? "Cambiar bonificación" : "Dar bonificación"}</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Bonificación de {person} · {projectCode}
          </DialogTitle>
          <DialogDescription>
            El mes de venta no cumplió la meta, así que este proyecto no comisiona. Con una bonificación comisiona el porcentaje que indiques sobre lo recaudado de este proyecto que aún no esté liquidado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`bn-rate-${r.assignmentId}`}>Porcentaje de la bonificación (%)</Label>
            <Input id={`bn-rate-${r.assignmentId}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="num" />
            <p className="text-xs text-muted-foreground">En puntos porcentuales: 0.5 = 0,5 %. Sin tope.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`bn-reason-${r.assignmentId}`}>Motivo (mínimo 10 caracteres)</Label>
            <Textarea id={`bn-reason-${r.assignmentId}`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="border-l-2 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          {r.bonusReason && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => save(true)}>
              Quitar bonificación
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={busy} onClick={() => save(false)}>
            {busy ? "Guardando…" : "Guardar bonificación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Para repasar con cada colaborador lo que se vendió en el período y si entra en sus comisiones. */
export function SalesSweep({ people, readOnly }: { people: SalesSweepPerson[]; readOnly: boolean }) {
  const [only, setOnly] = useState<string>("all");
  const shown = only === "all" ? people : people.filter((p) => p.collaboratorId === only);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold">Ventas del período por colaborador</h3>
        {people.length > 1 && (
          <select aria-label="Colaborador" className="h-8 border bg-background px-2 text-sm" value={only} onChange={(e) => setOnly(e.target.value)}>
            <option value="all">Todos ({people.length})</option>
            {people.map((p) => (
              <option key={p.collaboratorId} value={p.collaboratorId}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Proyectos con fecha de venta dentro del período. Entran en comisión los que cumplieron la meta de su mes de venta; si no la cumplieron puedes dar una bonificación. La última columna es la comisión de esta liquidación, no el total del proyecto.
      </p>
      {people.length === 0 && <p className="text-sm text-muted-foreground">No hay proyectos vendidos en las fechas de este período.</p>}
      {shown.map((p) => {
        const entering = p.rows.filter((r) => r.monthOutcome === "ELIGIBLE" || r.bonusReason || r.manualException).length;
        return (
          <details key={p.collaboratorId} className="rounded-lg border" open={shown.length === 1}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 marker:content-none">
              <span className="min-w-[200px] flex-1 font-semibold text-brand-deep">{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {p.rows.length} proyecto(s) vendidos · {entering} entran en comisión
              </span>
            </summary>
            <div className="overflow-x-auto border-t">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Proyecto</th>
                    <th className="px-2 py-2 font-medium">Venta</th>
                    <th className="px-2 py-2 text-right font-medium">Valor</th>
                    <th className="px-2 py-2 font-medium">Meta del mes</th>
                    <th className="px-2 py-2 text-right font-medium">%</th>
                    <th className="px-2 py-2 text-right font-medium">Recaudado</th>
                    <th className="px-2 py-2 text-right font-medium">Comisión aquí</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => {
                    const o = OUTCOME[r.monthOutcome];
                    const notMet = r.monthOutcome === "NOT_ELIGIBLE";
                    return (
                      <tr key={r.assignmentId} className="border-t align-top">
                        <td className="px-4 py-2">
                          <span className="num font-semibold">{r.projectCode}</span>
                          <span className="block text-xs text-muted-foreground">{r.client}</span>
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {formatDate(r.saleDate)}
                          <span className="block text-muted-foreground">{formatMonthShort(r.saleMonth)}</span>
                        </td>
                        <td className="num px-2 py-2 text-right">{formatMoney(r.saleAmountCOP, "COP", 0)}</td>
                        <td className="px-2 py-2">
                          <Badge variant={o.variant}>{o.label}</Badge>
                          {r.monthSalesCOP && r.goalCOP && (
                            <span className="num mt-1 block text-xs text-muted-foreground">
                              {formatMoney(r.monthSalesCOP, "COP", 0)} de {formatMoney(r.goalCOP, "COP", 0)}
                            </span>
                          )}
                        </td>
                        <td className="num px-2 py-2 text-right">
                          {r.effectiveRate === null ? "—" : formatPercent(r.effectiveRate, 2)}
                          {r.bonusReason && <span className="block text-xs text-brand-deep">Bonificación</span>}
                          {r.manualException && <span className="block text-xs text-muted-foreground">Excepción</span>}
                        </td>
                        <td className="num px-2 py-2 text-right">{formatMoney(r.collectedCOP, "COP", 0)}</td>
                        <td className="num px-2 py-2 text-right font-semibold">{formatMoney(r.commissionHereCOP, "COP", 2)}</td>
                        <td className="px-2 py-2 text-right">{!readOnly && (notMet || r.bonusReason) && <BonusDialog projectCode={r.projectCode} r={r} person={p.name} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </div>
  );
}
