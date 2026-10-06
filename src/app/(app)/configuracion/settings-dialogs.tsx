"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Field } from "@/components/form/field";
import { MoneyInput } from "@/components/form/money-input";
import { SimpleSelect } from "@/components/form/simple-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { todayBogota } from "@/domain/dates";
import { exchangeRateSchema, goalSchema } from "@/lib/schemas";
import { VoidDialog } from "@/components/billing/dialogs";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { D, formatMoney, formatPercent } from "@/domain/money";
import { reopenMonthAction, saveExchangeRateAction, saveGoalAction, saveMonthAdjustmentAction, validateMonthAction } from "@/server/actions/settings";

type GoalInput = z.input<typeof goalSchema>;
type RateInput = z.input<typeof exchangeRateSchema>;

export function GoalDialog({ trigger, currentAmount }: { trigger: React.ReactElement; currentAmount: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<GoalInput>({ resolver: zodResolver(goalSchema), defaultValues: { amountCOP: currentAmount, effectiveFrom: todayBogota().slice(0, 8) + "01" } });
  const { control, register, handleSubmit, formState, setError } = form;
  const e = formState.errors;

  async function onSubmit(values: GoalInput) {
    const res = await saveGoalAction(values);
    if (!res.ok) {
      Object.entries(res.fieldErrors ?? {}).forEach(([k, message]) => setError(k as keyof GoalInput, { message }));
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva meta comercial mensual</DialogTitle>
          <DialogDescription>La meta rige desde la fecha indicada. Los meses ya validados conservan la meta con la que se evaluaron.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Meta mensual (COP)" htmlFor="goal-amount" error={e.amountCOP?.message} required>
            <Controller control={control} name="amountCOP" render={({ field }) => <MoneyInput id="goal-amount" value={field.value} onChange={field.onChange} prefix="$" invalid={!!e.amountCOP} />} />
          </Field>
          <Field label="Vigente desde" htmlFor="goal-from" error={e.effectiveFrom?.message} required hint="Normalmente el primer día de un mes.">
            <Input id="goal-from" type="date" {...register("effectiveFrom")} aria-invalid={!!e.effectiveFrom} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={formState.isSubmitting}>{formState.isSubmitting ? "Guardando…" : "Guardar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RateDialog({ trigger }: { trigger: React.ReactElement }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<RateInput>({ resolver: zodResolver(exchangeRateSchema), defaultValues: { currency: "USD", date: todayBogota(), rate: "", source: "TRM" } });
  const { control, register, handleSubmit, formState, setError, reset } = form;
  const e = formState.errors;

  async function onSubmit(values: RateInput) {
    const res = await saveExchangeRateAction(values);
    if (!res.ok) {
      Object.entries(res.fieldErrors ?? {}).forEach(([k, message]) => setError(k as keyof RateInput, { message }));
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar tasa de cambio</DialogTitle>
          <DialogDescription>Pesos colombianos por una unidad de la moneda. Las tasas registradas no se modifican; sirven para autocompletar recaudos y ventas.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Moneda" htmlFor="rate-cur" error={e.currency?.message} required>
              <Controller control={control} name="currency" render={({ field }) => <SimpleSelect id="rate-cur" value={field.value} onChange={field.onChange} options={[{ value: "USD", label: "USD" }, { value: "CLP", label: "CLP" }, { value: "MXN", label: "MXN" }]} />} />
            </Field>
            <Field label="Fecha" htmlFor="rate-date" error={e.date?.message} required>
              <Input id="rate-date" type="date" {...register("date")} aria-invalid={!!e.date} />
            </Field>
          </div>
          <Field label="Tasa (COP por unidad)" htmlFor="rate-value" error={e.rate?.message} required>
            <Controller control={control} name="rate" render={({ field }) => <MoneyInput id="rate-value" decimals={6} value={field.value} onChange={field.onChange} prefix="$" invalid={!!e.rate} />} />
          </Field>
          <Field label="Fuente" htmlFor="rate-source" error={e.source?.message} hint="Ej. TRM Superfinanciera">
            <Input id="rate-source" {...register("source")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={formState.isSubmitting}>{formState.isSubmitting ? "Guardando…" : "Guardar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MonthAdjustmentDialog({
  trigger,
  yearMonth,
  monthLabel,
  initialAmount,
  initialNote,
}: {
  trigger: React.ReactElement;
  yearMonth: string;
  monthLabel: string;
  initialAmount: string;
  initialNote: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(initialAmount === "0" ? "" : initialAmount);
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState<{ amount?: string; note?: string }>({});
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit() {
    setBusy(true);
    const res = await saveMonthAdjustmentAction({ yearMonth, amountCOP: amount || "0", note });
    setBusy(false);
    if (!res.ok) {
      setError({ amount: res.fieldErrors?.amountCOP, note: res.fieldErrors?.note ?? (res.fieldErrors ? undefined : res.error) });
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setOpen(false);
    setError({});
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajuste de ventas · {monthLabel}</DialogTitle>
          <DialogDescription>
            Suma al total del mes ventas organizacionales que no están registradas como proyecto. Se audita y exige justificación. Déjalo en 0 para quitarlo.
          </DialogDescription>
        </DialogHeader>
        <Field label="Ventas adicionales del mes (COP, sin IVA)" htmlFor="adj-month-amount" error={error.amount}>
          <MoneyInput id="adj-month-amount" value={amount} onChange={setAmount} prefix="$" invalid={!!error.amount} />
        </Field>
        <Field label="Justificación" htmlFor="adj-month-note" error={error.note}>
          <Textarea id="adj-month-note" rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MonthActions({
  yearMonth,
  monthLabel,
  status,
  ended,
  salesCOP,
  goalCOP,
  projectCount,
}: {
  yearMonth: string;
  monthLabel: string;
  status: "OPEN" | "VALIDATED" | "REOPENED";
  ended: boolean;
  salesCOP: string;
  goalCOP: string;
  projectCount: number;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  if (status === "VALIDATED") {
    return (
      <VoidDialog
        title={`Reabrir ${monthLabel}`}
        description="Se borran la elegibilidad y los porcentajes efectivos fijados, y el mes vuelve a quedar pendiente de validación. No es posible si ya hay comisiones liquidadas de sus proyectos."
        confirmLabel="Reabrir mes"
        reasonLabel="Motivo de la reapertura"
        action={(reason) => reopenMonthAction({ yearMonth, reason })}
        trigger={<Button size="xs" variant="outline">Reabrir</Button>}
      />
    );
  }

  const sales = D(salesCOP);
  const goal = D(goalCOP);
  const reached = sales.gte(goal);

  return (
    <>
      <Button size="xs" disabled={!ended} title={ended ? undefined : "El mes aún no termina"} onClick={() => setOpen(true)}>
        Validar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Validar ${monthLabel}`}
        confirmLabel="Validar mes"
        description={
          <>
            Ventas del mes <strong>{formatMoney(sales, "COP", 0)}</strong> frente a una meta de <strong>{formatMoney(goal, "COP", 0)}</strong> (
            {formatPercent(goal.isZero() ? 0 : sales.div(goal), 1)}). La meta <strong>{reached ? "se alcanzó" : "no se alcanzó"}</strong>.
            <br />
            <br />
            Se fijarán la elegibilidad de los {projectCount} proyecto(s) del mes y el porcentaje efectivo de cada colaborador. El resultado no depende de ventas
            posteriores y el mes quedará bloqueado (se puede reabrir con un motivo mientras no haya comisiones liquidadas).
          </>
        }
        onConfirm={async () => {
          const res = await validateMonthAction({ yearMonth });
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
