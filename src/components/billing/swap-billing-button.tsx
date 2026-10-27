"use client";

import { ArrowLeftRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { swapProjectBillingAction } from "@/server/actions/billing";

/** Corrige datos cargados en el proyecto equivocado: intercambia con otro proyecto todas sus facturas, recaudos y ajustes. */
export function SwapBillingButton({ code, options }: { code: string; options: { code: string; client: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState("");
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"ALL" | "BILLING">("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setError(undefined);
    if (!other) return setError("Elige el otro proyecto.");
    setBusy(true);
    const res = await swapProjectBillingAction({ projectA: code, projectB: other, reason: reason.trim(), scope });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(res.message);
    setOpen(false);
    setOther("");
    setReason("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <ArrowLeftRight data-icon="inline-start" /> Intercambiar con otro proyecto
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Intercambiar {code} con otro proyecto</DialogTitle>
          <DialogDescription>Para corregir cuando dos proyectos quedaron con los datos cruzados. No es posible si alguno ya tiene comisiones liquidadas.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="swap-other">Intercambiar con</Label>
            <select id="swap-other" className="h-9 w-full border bg-background px-2 text-sm" value={other} onChange={(e) => setOther(e.target.value)}>
              <option value="">Elige…</option>
              {options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.code} · {o.client}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Qué se intercambia</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="swap-scope" checked={scope === "ALL"} onChange={() => setScope("ALL")} className="mt-1" />
              <span>
                <strong>Todo el proyecto</strong> (recomendado): venta, fecha, cliente, personas, facturas, recaudos y ajustes. Equivale a intercambiar los códigos.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="swap-scope" checked={scope === "BILLING"} onChange={() => setScope("BILLING")} className="mt-1" />
              <span>
                <strong>Solo facturas, recaudos y ajustes.</strong> La venta, la fecha y las personas se quedan donde están; las facturas deben caber en la venta del otro proyecto.
              </span>
            </label>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="swap-reason">Motivo (mínimo 10 caracteres)</Label>
            <Textarea id="swap-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="border-l-2 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={busy} onClick={save}>
            {busy ? "Intercambiando…" : "Intercambiar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
