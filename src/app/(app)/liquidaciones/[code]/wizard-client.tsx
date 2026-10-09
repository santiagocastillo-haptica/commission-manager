"use client";

import { Calculator, CheckCheck, RotateCcw, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field } from "@/components/form/field";
import { MoneyInput } from "@/components/form/money-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { todayBogota } from "@/domain/dates";
import { D, formatMoney } from "@/domain/money";
import { approveSettlementAction, calculateSettlementAction, discardDraftAction, registerPaymentAction } from "@/server/actions/settlements";
import type { AlertView } from "@/server/queries/settlements";

export function CalculateButton({ year, half, recalculate }: { year: number; half: "APRIL" | "OCTOBER"; recalculate?: boolean }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <Button
      disabled={busy}
      variant={recalculate ? "outline" : "default"}
      size={recalculate ? "default" : "lg"}
      onClick={async () => {
        setBusy(true);
        const res = await calculateSettlementAction({ year, half });
        setBusy(false);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(res.message);
        router.push(`?paso=3`);
        router.refresh();
      }}
    >
      <Calculator data-icon="inline-start" /> {busy ? "Calculando…" : recalculate ? "Recalcular" : "Calcular liquidación"}
    </Button>
  );
}

export function DiscardButton({ settlementId, code }: { settlementId: string; code: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <RotateCcw data-icon="inline-start" /> Reiniciar borrador
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reiniciar el borrador"
        description="Se descartan las líneas calculadas. No afecta los recaudos ni los proyectos: podrás volver a calcular cuando quieras."
        confirmLabel="Reiniciar"
        onConfirm={async () => {
          const res = await discardDraftAction({ settlementId, code });
          if (!res.ok) {
          toast.error(res.error);
          return;
        }
          toast.success(res.message);
          setOpen(false);
          router.push("?paso=2");
          router.refresh();
        }}
      />
    </>
  );
}

export function ApprovePanel({
  settlementId,
  code,
  label,
  alerts,
  totals,
  lineCount,
  collaboratorCount,
  hasLines,
  reviewed,
  reviewTotal,
}: {
  settlementId: string;
  code: string;
  label: string;
  alerts: AlertView[];
  totals: { gross: string; adjustments: string; netPayable: string };
  lineCount: number;
  collaboratorCount: number;
  hasLines: boolean;
  /** Proyectos aceptados en la revisión y total de proyectos de la liquidación. */
  reviewed: number;
  reviewTotal: number;
}) {
  const [acked, setAcked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const blocking = alerts.filter((a) => a.severity === "BLOCKING");
  const warnings = alerts.filter((a) => a.severity === "WARNING");
  const info = alerts.filter((a) => a.severity === "INFO");
  const pending = warnings.filter((w) => !acked.includes(w.key));
  const canApprove = blocking.length === 0 && pending.length === 0 && hasLines;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Summary label="Comisión bruta" value={formatMoney(totals.gross, "COP", 2)} />
        <Summary label="Ajustes" value={formatMoney(totals.adjustments, "COP", 2)} />
        <Summary label="Total neto a pagar" value={formatMoney(totals.netPayable, "COP", 2)} strong />
      </div>
      <p className="text-sm text-muted-foreground">
        {lineCount} línea(s) de comisión de {collaboratorCount} colaborador(es). Al aprobar, la liquidación queda <strong>cerrada e inmutable</strong>: las correcciones posteriores se registran como ajustes trazables.
      </p>

      {blocking.length > 0 && (
        <section aria-label="Alertas bloqueantes" className="space-y-2 border-l-2 border-danger bg-danger-soft p-4">
          <p className="text-sm font-bold text-danger">No se puede aprobar: hay {blocking.length} alerta(s) bloqueante(s) por corregir en los datos de origen.</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {blocking.map((a) => (
              <li key={a.key}>{a.message}</li>
            ))}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section aria-label="Advertencias" className="space-y-3 border-l-2 border-brand-amber bg-warning-soft p-4">
          <p className="text-sm font-bold text-warning">Reconoce cada advertencia para poder aprobar ({warnings.length - pending.length} de {warnings.length}).</p>
          {warnings.map((a) => (
            <div key={a.key} className="flex items-start gap-2.5">
              <Checkbox id={`ack-${a.key}`} checked={acked.includes(a.key)} onCheckedChange={(v) => setAcked((cur) => (v ? [...cur, a.key] : cur.filter((k) => k !== a.key)))} className="mt-0.5" />
              <Label htmlFor={`ack-${a.key}`} className="text-sm font-normal leading-snug">
                {a.message}
              </Label>
            </div>
          ))}
        </section>
      )}

      {info.length > 0 && (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {info.map((a) => (
            <li key={a.key}>
              <Badge variant="info">Informativa</Badge> <span className="ml-1">{a.message}</span>
            </li>
          ))}
        </ul>
      )}

      {hasLines && reviewed < reviewTotal && (
        <p className="border-l-2 border-brand-amber bg-warning-soft px-4 py-3 text-sm text-warning">
          Has aceptado {reviewed} de {reviewTotal} proyectos en la revisión. Puedes aprobar igual, pero quedarán {reviewTotal - reviewed} sin marcar como revisados.{" "}
          <Link href="?paso=3" className="font-semibold underline underline-offset-4">
            Volver a la revisión
          </Link>
        </p>
      )}
      {!hasLines && <p className="text-sm text-danger">No hay comisiones por liquidar en este período.</p>}

      <Button size="lg" disabled={!canApprove} onClick={() => setOpen(true)}>
        <CheckCheck data-icon="inline-start" /> Aprobar y cerrar liquidación
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Aprobar ${label}`}
        confirmLabel="Aprobar y cerrar"
        description={
          <>
            Vas a cerrar <strong>{code}</strong> con un total neto a pagar de <strong>{formatMoney(totals.netPayable, "COP", 2)}</strong> ({formatMoney(totals.gross, "COP", 2)} de comisiones, {formatMoney(totals.adjustments, "COP", 2)} de
            ajustes). Reconociste {warnings.length} advertencia(s) y revisaste {reviewed} de {reviewTotal} proyecto(s). Esta acción <strong>no se puede deshacer</strong>.
          </>
        }
        onConfirm={async () => {
          const res = await approveSettlementAction({ settlementId, code, acknowledged: acked, expectedGross: totals.gross, expectedNet: totals.netPayable });
          if (!res.ok) {
          toast.error(res.error);
          return;
        }
          toast.success(res.message);
          setOpen(false);
          router.push("?paso=5");
          router.refresh();
        }}
      />
    </div>
  );
}

function Summary({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${strong ? "border-transparent bg-brand-deep text-white" : ""}`}>
      <p className={`eyebrow ${strong ? "!text-white/70" : ""}`}>{label}</p>
      <p className="num mt-2 text-xl font-bold">{value}</p>
    </div>
  );
}

export function PaymentDialog({
  collaboratorSettlementId,
  code,
  collaboratorName,
  remaining,
}: {
  collaboratorSettlementId: string;
  code: string;
  collaboratorName: string;
  remaining: string;
}) {
  const full = D(remaining).toDecimalPlaces(2).toFixed();
  const [open, setOpen] = useState(false);
  const [paidAt, setPaidAt] = useState(todayBogota());
  const [amount, setAmount] = useState(full);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit() {
    setBusy(true);
    const res = await registerPaymentAction({ collaboratorSettlementId, code, paidAt, amount, reference, notes });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setOpen(false);
    setErrors({});
    setReference("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm"><Wallet data-icon="inline-start" /> Registrar pago</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pago · {collaboratorName}</DialogTitle>
          <DialogDescription>
            Saldo pendiente: <span className="num font-semibold">{formatMoney(remaining, "COP", 2)}</span>. El pago es independiente de la aprobación y no puede superar el saldo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha efectiva de pago" htmlFor="pay-date" error={errors.paidAt} required>
              <Input id="pay-date" type="date" max={todayBogota()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
            <Field label="Valor pagado (COP)" htmlFor="pay-amount" error={errors.amount} required>
              <MoneyInput id="pay-amount" value={amount} onChange={setAmount} prefix="$" invalid={!!errors.amount} />
            </Field>
          </div>
          <Button type="button" variant="ghost" size="xs" onClick={() => setAmount(full)}>
            Pagar saldo completo
          </Button>
          <Field label="Referencia de pago" htmlFor="pay-ref" error={errors.reference} required hint="Número de transferencia, comprobante o cheque. No se puede repetir.">
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} aria-invalid={!!errors.reference} />
          </Field>
          <Field label="Observaciones" htmlFor="pay-notes">
            <Textarea id="pay-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Registrando…" : "Registrar pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

