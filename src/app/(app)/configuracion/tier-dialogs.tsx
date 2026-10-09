"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { D } from "@/domain/money";
import { deleteTierSetAction, saveTierSetAction } from "@/server/actions/settings";

interface Row {
  /** Cumplimiento mínimo en % (ej. «70»). */
  min: string;
  /** Factor sobre el % base (ej. «0.5»). */
  factor: string;
}

const DEFAULT_ROWS: Row[] = [
  { min: "0", factor: "0" },
  { min: "70", factor: "0.5" },
  { min: "100", factor: "1" },
  { min: "120", factor: "1.5" },
];

/** Crea o edita el conjunto de tramos de gamificación que rige desde un mes. `initial` viene con cumplimiento como fracción («0.7»). */
export function TierSetDialog({
  trigger,
  initial,
}: {
  trigger: React.ReactElement;
  initial?: { effectiveFrom: string; tiers: { min: string; factor: string }[] };
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const startRows = initial ? initial.tiers.map((t) => ({ min: D(t.min).mul(100).toFixed(), factor: D(t.factor).toFixed() })) : DEFAULT_ROWS;
  const [month, setMonth] = useState(initial ? initial.effectiveFrom.slice(0, 7) : "");
  const [rows, setRows] = useState<Row[]>(startRows);
  const [error, setError] = useState<string>();

  function update(i: number, patch: Partial<Row>) {
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!/^\d{4}-\d{2}$/.test(month)) return setError("Elige el mes desde el cual rige la escala.");
    if (rows.some((r) => !/^\d+(\.\d+)?$/.test(r.min) || !/^\d+(\.\d+)?$/.test(r.factor))) return setError("Completa todos los tramos con números válidos.");
    setBusy(true);
    const res = await saveTierSetAction({
      policyCode: "GAMIFICATION",
      effectiveFrom: `${month}-01`,
      ...(initial && initial.effectiveFrom !== `${month}-01` ? { movesFrom: initial.effectiveFrom } : {}),
      tiers: rows.map((r) => ({ min: D(r.min).div(100).toFixed(), factor: D(r.factor).toFixed() })),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(res.message);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar escala de gamificación" : "Nueva escala de gamificación"}</DialogTitle>
          <DialogDescription>
            Rige desde el mes que elijas, según el mes de venta del proyecto (al editar puedes cambiar ese mes). Antes de la primera escala, la persona se rige por la política general. No se puede cambiar una
            escala si ya validaste un mes con ella.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="tier-month">Rige desde (mes)</Label>
            <Input id="tier-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Tramos</Label>
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Desde</span>
                <Input aria-label={`Cumplimiento mínimo del tramo ${i + 1}`} inputMode="decimal" className="w-24" value={r.min} onChange={(e) => update(i, { min: e.target.value })} disabled={i === 0} />
                <span className="text-xs text-muted-foreground">% de la meta → factor</span>
                <Input aria-label={`Factor del tramo ${i + 1}`} inputMode="decimal" className="w-24" value={r.factor} onChange={(e) => update(i, { factor: e.target.value })} />
                <span className="text-xs text-muted-foreground">×</span>
                {i > 0 && rows.length > 2 && (
                  <Button type="button" variant="ghost" size="icon-xs" aria-label="Quitar tramo" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                )}
              </div>
            ))}
            <Button type="button" variant="outline" size="xs" onClick={() => setRows((x) => [...x, { min: "", factor: "" }])}>
              <Plus data-icon="inline-start" /> Agregar tramo
            </Button>
            <p className="text-xs text-muted-foreground">El límite inferior es inclusivo. El primer tramo comienza en 0 %. El factor multiplica el % base del colaborador (p. ej. 1,5× sobre 1 % = 1,5 %).</p>
          </div>
          {error && (
            <p role="alert" className="border-l-2 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Guardando…" : "Guardar escala"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteTierSetButton({ effectiveFrom, label }: { effectiveFrom: string; label: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        Eliminar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Eliminar la escala vigente desde ${label}`}
        destructive
        confirmLabel="Eliminar escala"
        description="Los meses que regía pasarán a la escala anterior o, si no hay, a la política general. No es posible si ya validaste un mes con ella."
        onConfirm={async () => {
          const res = await deleteTierSetAction({ policyCode: "GAMIFICATION", effectiveFrom });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success(res.message);
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
