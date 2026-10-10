"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Field } from "@/components/form/field";
import { MoneyInput } from "@/components/form/money-input";
import { SimpleSelect } from "@/components/form/simple-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { todayBogota } from "@/domain/dates";
import { D, formatMoney, type CurrencyCode } from "@/domain/money";
import {
  adjustmentSchema,
  collectionSchema,
  invoiceSchema,
  type AdjustmentInput,
  type CollectionInput,
  type InvoiceInput,
} from "@/lib/schemas";
import type { ActionResult } from "@/server/action-result";
import { lookupRateAction, saveAdjustmentAction, saveCollectionAction, saveInvoiceAction } from "@/server/actions/billing";

const prefix = (c: CurrencyCode) => (c === "COP" ? "$" : c);

// ───────────── Factura ─────────────

export interface InvoiceProjectRef {
  id: string;
  code: string;
  currency: CurrencyCode;
  /** Valor de venta aún no cubierto por facturas (para sugerir el valor). */
  remainingToInvoice: string;
  /** Facturas que faltan por emitir según la cantidad prevista. */
  pendingInvoices: number;
}

export function InvoiceFormDialog({
  trigger,
  project,
  invoiceId,
  initial,
  collectionLocked,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: React.ReactElement;
  project: InvoiceProjectRef;
  invoiceId?: string;
  initial?: Partial<InvoiceInput>;
  /** Si la fecha de recaudo no se puede cambiar aquí (recaudos parciales o ya liquidado), el motivo. */
  collectionLocked?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = onOpenChange ?? setInnerOpen;
  const router = useRouter();
  const suggested = useMemo(() => {
    const rem = D(project.remainingToInvoice);
    if (rem.lte(0)) return "";
    return rem.div(Math.max(1, project.pendingInvoices)).toDecimalPlaces(2).toFixed();
  }, [project.remainingToInvoice, project.pendingInvoices]);

  const form = useForm<InvoiceInput>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      projectId: project.id,
      number: "",
      status: "ISSUED",
      issueDate: todayBogota(),
      dueDate: "",
      collectedOn: "",
      amountPreTax: suggested,
      netBaseExplicit: "",
      notes: "",
      ...initial,
    },
  });
  const { register, control, handleSubmit, formState, setError, reset } = form;
  const e = formState.errors;
  const status = useWatch({ control, name: "status" });
  const issueDate = useWatch({ control, name: "issueDate" });
  const collectedOn = useWatch({ control, name: "collectedOn" });
  const foreign = project.currency !== "COP";

  // Con moneda extranjera se sugiere la TRM guardada para la fecha del recaudo (si existe).
  useEffect(() => {
    if (!foreign || collectionLocked || !collectedOn || !/^\d{4}-\d{2}-\d{2}$/.test(collectedOn)) return;
    if (form.getValues("collectedFxRate")) return;
    lookupRateAction(project.currency, collectedOn).then((r) => {
      if (r && !form.getValues("collectedFxRate")) form.setValue("collectedFxRate", r);
    });
  }, [foreign, collectionLocked, collectedOn, project.currency, form]);

  async function onSubmit(values: InvoiceInput) {
    const res = await saveInvoiceAction(invoiceId ?? null, values);
    if (!res.ok) {
      Object.entries(res.fieldErrors ?? {}).forEach(([k, message]) => setError(k as keyof InvoiceInput, { message }));
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setOpen(false);
    if (!invoiceId) reset();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{invoiceId ? "Editar factura" : "Registrar factura"} · {project.code}</DialogTitle>
          <DialogDescription>Valores antes de IVA, en {project.currency}. Una factura «prevista» aún no tiene número ni fecha de emisión.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Estado" htmlFor="inv-status" error={e.status?.message} required>
              <Controller control={control} name="status" render={({ field }) => (
                <SimpleSelect id="inv-status" value={field.value} onChange={(v) => { field.onChange(v); if (v !== "ISSUED") { form.setValue("collectedOn", ""); form.setValue("collectedFxRate", ""); } }} options={[{ value: "ISSUED", label: "Emitida" }, { value: "PLANNED", label: "Prevista" }]} />
              )} />
            </Field>
            <Field label="Número de factura" htmlFor="inv-number" error={e.number?.message} required={status === "ISSUED"}>
              <Input id="inv-number" {...register("number")} aria-invalid={!!e.number} className="num" />
            </Field>
            <Field label="Fecha de emisión" htmlFor="inv-issue" error={e.issueDate?.message} required={status === "ISSUED"}>
              <Input id="inv-issue" type="date" {...register("issueDate")} aria-invalid={!!e.issueDate} />
            </Field>
            <Field
              label="Fecha de recaudo"
              htmlFor="inv-collected-on"
              error={e.collectedOn?.message}
              hint={collectionLocked ?? (invoiceId ? "Cámbiala si el recaudo total ocurrió otro día." : "Opcional. Si la factura ya fue cobrada por completo, indica el día: se registra el recaudo por el valor total.")}
            >
              <Input id="inv-collected-on" type="date" min={issueDate || undefined} max={todayBogota()} disabled={status !== "ISSUED" || Boolean(collectionLocked)} {...register("collectedOn")} aria-invalid={!!e.collectedOn} />
            </Field>
          </div>
          <Field label="Valor facturado antes de impuestos" htmlFor="inv-amount" error={e.amountPreTax?.message} required hint={suggested ? "Sugerido: saldo por facturar dividido entre las facturas pendientes." : undefined}>
            <Controller control={control} name="amountPreTax" render={({ field }) => <MoneyInput id="inv-amount" value={field.value} onChange={field.onChange} prefix={prefix(project.currency)} invalid={!!e.amountPreTax} />} />
          </Field>
          <Field label="Base neta comisionable de esta factura" htmlFor="inv-netbase" error={e.netBaseExplicit?.message} hint="Opcional. Si la dejas vacía, los costos de proveedores se distribuyen proporcionalmente.">
            <Controller control={control} name="netBaseExplicit" render={({ field }) => <MoneyInput id="inv-netbase" value={field.value} onChange={field.onChange} prefix={prefix(project.currency)} invalid={!!e.netBaseExplicit} />} />
          </Field>
          <Field label="Observaciones" htmlFor="inv-notes" error={e.notes?.message}>
            <Textarea id="inv-notes" rows={2} {...register("notes")} />
          </Field>
          {foreign && status === "ISSUED" && collectedOn && !collectionLocked && (
            <Field label="TRM del día del recaudo" htmlFor="inv-collected-fx" error={e.collectedFxRate?.message} required={!invoiceId} hint="Pesos por unidad de la moneda.">
              <Controller control={control} name="collectedFxRate" render={({ field }) => <MoneyInput id="inv-collected-fx" decimals={6} value={field.value ?? ""} onChange={field.onChange} prefix="$" invalid={!!e.collectedFxRate} />} />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={formState.isSubmitting}>{formState.isSubmitting ? "Guardando…" : "Guardar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Recaudo ─────────────

export interface CollectionInvoiceRef {
  id: string;
  number: string | null;
  projectCode: string;
  currency: CurrencyCode;
  /** Saldo pendiente de recaudo (sin contar el recaudo que se edita). */
  balance: string;
  issueDate: string | null;
}

export function CollectionFormDialog({
  trigger,
  invoice,
  collectionId,
  initial,
}: {
  trigger: React.ReactElement;
  invoice: CollectionInvoiceRef;
  collectionId?: string;
  initial?: Partial<CollectionInput>;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const foreign = invoice.currency !== "COP";
  const form = useForm<CollectionInput>({
    resolver: zodResolver(collectionSchema),
    defaultValues: {
      invoiceId: invoice.id,
      date: todayBogota(),
      amountReceived: D(invoice.balance).gt(0) ? invoice.balance : "",
      fxRate: "",
      isOverpaymentAdjustment: false,
      justification: "",
      notes: "",
      ...initial,
    },
  });
  const { register, control, handleSubmit, formState, setError, setValue, getValues, reset } = form;
  const e = formState.errors;
  const [date, amount, fx, overpay] = useWatch({ control, name: ["date", "amountReceived", "fxRate", "isOverpaymentAdjustment"] });

  const exceeds = useMemo(() => {
    try {
      return D(amount || 0).gt(invoice.balance);
    } catch {
      return false;
    }
  }, [amount, invoice.balance]);

  const copEquivalent = useMemo(() => {
    try {
      return foreign ? D(amount || 0).mul(fx || 0) : D(amount || 0);
    } catch {
      return D(0);
    }
  }, [amount, fx, foreign]);

  // TRM del día del recaudo: se autocompleta desde el catálogo cuando existe.
  useEffect(() => {
    if (!foreign || !open || !date || getValues("fxRate")) return;
    let cancelled = false;
    lookupRateAction(invoice.currency, date).then((r) => {
      if (!cancelled && r) setValue("fxRate", r, { shouldDirty: true });
    });
    return () => {
      cancelled = true;
    };
  }, [date, foreign, open, invoice.currency, getValues, setValue]);

  async function onSubmit(values: CollectionInput) {
    const res = await saveCollectionAction(collectionId ?? null, values);
    if (!res.ok) {
      Object.entries(res.fieldErrors ?? {}).forEach(([k, message]) => setError(k as keyof CollectionInput, { message }));
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setOpen(false);
    if (!collectionId) reset();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{collectionId ? "Editar recaudo" : "Registrar recaudo"} · factura {invoice.number}</DialogTitle>
          <DialogDescription>
            {invoice.projectCode} · Saldo pendiente: <span className="num font-semibold">{formatMoney(invoice.balance, invoice.currency)}</span>. El valor se registra sin IVA.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha efectiva del recaudo" htmlFor="col-date" error={e.date?.message} required>
              <Input id="col-date" type="date" min={invoice.issueDate ?? undefined} max={todayBogota()} {...register("date")} aria-invalid={!!e.date} />
            </Field>
            <Field label="Valor recibido (sin IVA)" htmlFor="col-amount" error={e.amountReceived?.message} required>
              <Controller control={control} name="amountReceived" render={({ field }) => <MoneyInput id="col-amount" value={field.value} onChange={field.onChange} prefix={prefix(invoice.currency)} invalid={!!e.amountReceived} />} />
            </Field>
          </div>
          {foreign && (
            <Field label={`TRM del día del recaudo (COP por ${invoice.currency})`} htmlFor="col-fx" error={e.fxRate?.message} required hint="Se conserva para auditoría y se usa para convertir la comisión a COP.">
              <Controller control={control} name="fxRate" render={({ field }) => <MoneyInput id="col-fx" decimals={6} value={field.value} onChange={field.onChange} prefix="$" invalid={!!e.fxRate} />} />
            </Field>
          )}
          <div className="flex items-center justify-between border bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Equivalente en COP</span>
            <span className="num font-bold text-brand-deep">{formatMoney(copEquivalent, "COP")}</span>
          </div>
          {exceeds && (
            <div className="space-y-3 border-l-2 border-brand-amber bg-warning-soft p-3">
              <p className="text-sm text-warning">El valor supera el saldo de la factura. Solo se acepta con un ajuste explícito y justificado; no genera comisión adicional.</p>
              <Controller control={control} name="isOverpaymentAdjustment" render={({ field }) => (
                <div className="flex items-center gap-2">
                  <Checkbox id="col-over" checked={field.value} onCheckedChange={(v) => field.onChange(Boolean(v))} />
                  <Label htmlFor="col-over" className="text-sm">Registrar como ajuste por excedente</Label>
                </div>
              )} />
              {overpay && (
                <Field label="Justificación" htmlFor="col-just" error={e.justification?.message} required>
                  <Textarea id="col-just" rows={2} {...register("justification")} />
                </Field>
              )}
            </div>
          )}
          <Field label="Observaciones" htmlFor="col-notes" error={e.notes?.message}>
            <Textarea id="col-notes" rows={2} {...register("notes")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={formState.isSubmitting}>{formState.isSubmitting ? "Guardando…" : "Guardar recaudo"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Ajuste ─────────────

export function AdjustmentFormDialog({
  trigger,
  project,
  invoices,
}: {
  trigger: React.ReactElement;
  project: { id: string; code: string; currency: CurrencyCode };
  invoices: { id: string; number: string }[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<AdjustmentInput>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: { projectId: project.id, invoiceId: "", date: todayBogota(), kind: "CREDIT_NOTE", reason: "", amount: "" },
  });
  const { register, control, handleSubmit, formState, setError, reset } = form;
  const e = formState.errors;

  async function onSubmit(values: AdjustmentInput) {
    const res = await saveAdjustmentAction({ ...values, invoiceId: values.invoiceId || undefined });
    if (!res.ok) {
      Object.entries(res.fieldErrors ?? {}).forEach(([k, message]) => setError(k as keyof AdjustmentInput, { message }));
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar ajuste · {project.code}</DialogTitle>
          <DialogDescription>
            Reduce la base comisionable. Si afecta comisiones ya liquidadas, se compensa en la siguiente liquidación; nunca se modifican liquidaciones cerradas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de ajuste" htmlFor="adj-kind" error={e.kind?.message} required>
              <Controller control={control} name="kind" render={({ field }) => (
                <SimpleSelect id="adj-kind" value={field.value} onChange={field.onChange} options={[
                  { value: "CREDIT_NOTE", label: "Nota crédito" },
                  { value: "DISCOUNT", label: "Descuento posterior" },
                  { value: "CONTRACT_REDUCTION", label: "Reducción contractual" },
                  { value: "PROVIDER_COST", label: "Ajuste de costos de proveedores" },
                ]} />
              )} />
            </Field>
            <Field label="Fecha" htmlFor="adj-date" error={e.date?.message} required>
              <Input id="adj-date" type="date" {...register("date")} aria-invalid={!!e.date} />
            </Field>
          </div>
          <Field label="Factura afectada" htmlFor="adj-inv" hint="Opcional. Sin factura, la reducción se reparte sobre todo el proyecto.">
            <Controller control={control} name="invoiceId" render={({ field }) => (
              <SimpleSelect id="adj-inv" value={field.value} onChange={field.onChange} placeholder="Ninguna (todo el proyecto)" options={[{ value: "", label: "Ninguna (todo el proyecto)" }, ...invoices.map((i) => ({ value: i.id, label: i.number }))]} />
            )} />
          </Field>
          <Field label="Valor que reduce la base (sin IVA)" htmlFor="adj-amount" error={e.amount?.message} required>
            <Controller control={control} name="amount" render={({ field }) => <MoneyInput id="adj-amount" value={field.value} onChange={field.onChange} prefix={prefix(project.currency)} invalid={!!e.amount} />} />
          </Field>
          <Field label="Motivo" htmlFor="adj-reason" error={e.reason?.message} required>
            <Textarea id="adj-reason" rows={3} {...register("reason")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={formState.isSubmitting}>{formState.isSubmitting ? "Guardando…" : "Registrar ajuste"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Anulación con motivo ─────────────

export function VoidDialog({
  trigger,
  title,
  description,
  confirmLabel = "Anular",
  reasonLabel = "Motivo de la anulación",
  action,
}: {
  trigger: React.ReactElement;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  reasonLabel?: string;
  action: (reason: string) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit() {
    if (reason.trim().length < 10) {
      setError("Explica el motivo (mínimo 10 caracteres).");
      return;
    }
    setBusy(true);
    const res = await action(reason.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.fieldErrors?.reason ?? res.error);
      return;
    }
    toast.success(res.message);
    setOpen(false);
    setReason("");
    setError(null);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Field label={reasonLabel} htmlFor="void-reason" error={error ?? undefined} required>
          <Textarea id="void-reason" rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} aria-invalid={!!error} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>{busy ? "Anulando…" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
