"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Field } from "@/components/form/field";
import { MoneyInput } from "@/components/form/money-input";
import { SimpleSelect } from "@/components/form/simple-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatMonth, monthKey } from "@/domain/dates";
import { D, formatMoney, formatPercent, type CurrencyCode } from "@/domain/money";
import { projectSchema, type ProjectFormValues, type ProjectInput } from "@/lib/schemas";
import { lookupRateAction } from "@/server/actions/billing";
import { saveProjectAction } from "@/server/actions/projects";

export interface CollaboratorOption {
  id: string;
  name: string;
  policyCode: string;
  active: boolean;
}

export interface MonthContext {
  /** Ventas del mes en COP SIN contar el proyecto que se está editando. */
  salesCOP: string;
  goalCOP: string;
  status: "OPEN" | "VALIDATED" | "REOPENED";
}

const COUNTRIES = [
  { value: "CO", label: "Colombia" },
  { value: "CL", label: "Chile" },
  { value: "MX", label: "México" },
];
const CURRENCY_OPTIONS = ["COP", "USD", "CLP", "MXN"].map((c) => ({ value: c, label: c }));

export function ProjectForm({
  projectId,
  initial,
  collaborators,
  months,
  defaultGoalCOP,
  lockedMonth,
}: {
  projectId?: string;
  initial: ProjectFormValues;
  collaborators: CollaboratorOption[];
  months: Record<string, MonthContext>;
  defaultGoalCOP: string;
  /** Mes validado: los campos económicos quedan bloqueados. */
  lockedMonth?: string;
}) {
  const router = useRouter();
  const form = useForm<ProjectFormValues, unknown, ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: initial,
  });
  const { register, control, handleSubmit, formState, setError, setValue, getValues } = form;
  const e = formState.errors;
  const { fields, append, remove } = useFieldArray({ control, name: "assignments" });

  const [saleAmount, providerCosts, currency, saleDate, rate, assignments] = useWatch({
    control,
    name: ["saleAmount", "providerCosts", "currency", "saleDate", "saleReferenceRate", "assignments"],
  });
  const cur = (currency || "COP") as CurrencyCode;
  const isForeign = cur !== "COP";
  const locked = Boolean(lockedMonth);

  const netBase = useMemo(() => {
    try {
      return D(saleAmount || 0).minus(providerCosts || 0);
    } catch {
      return D(0);
    }
  }, [saleAmount, providerCosts]);
  const negative = netBase.isNegative();

  // Contribución del proyecto a la meta organizacional del mes (en COP).
  const ym = saleDate && /^\d{4}-\d{2}-\d{2}$/.test(saleDate) ? monthKey(saleDate) : null;
  const monthCtx = ym ? months[ym] : undefined;
  const saleCOP = useMemo(() => {
    try {
      return isForeign ? D(saleAmount || 0).mul(rate || 0) : D(saleAmount || 0);
    } catch {
      return D(0);
    }
  }, [saleAmount, rate, isForeign]);
  const monthTotal = D(monthCtx?.salesCOP ?? 0).plus(saleCOP);
  const goal = D(monthCtx?.goalCOP ?? defaultGoalCOP);
  const ratio = goal.isZero() ? D(0) : monthTotal.div(goal);

  // Autocompleta la TRM del día de la venta si ya está en el catálogo.
  useEffect(() => {
    if (!isForeign || !saleDate || getValues("saleReferenceRate")) return;
    let cancelled = false;
    lookupRateAction(cur, saleDate).then((r) => {
      if (!cancelled && r) setValue("saleReferenceRate", r, { shouldDirty: true });
    });
    return () => {
      cancelled = true;
    };
  }, [cur, saleDate, isForeign, getValues, setValue]);

  const initialRates = useMemo(() => new Map(initial.assignments.map((a) => [a.collaboratorId, a.ratePercent])), [initial.assignments]);
  const ratesChanged =
    Boolean(projectId) &&
    (assignments.length !== initial.assignments.length ||
      assignments.some((a) => initialRates.get(a.collaboratorId) !== a.ratePercent));

  const totalPct = assignments.reduce((acc, a) => {
    try {
      return acc.plus(a.ratePercent || 0);
    } catch {
      return acc;
    }
  }, D(0));

  async function onSubmit(values: ProjectInput) {
    const reason = (document.getElementById("rateChangeReason") as HTMLTextAreaElement | null)?.value;
    const res = await saveProjectAction(projectId ?? null, values, reason);
    if (!res.ok) {
      Object.entries(res.fieldErrors ?? {}).forEach(([k, message]) => setError(k as never, { message }));
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    router.push(`/proyectos/${res.data!.id}`);
    router.refresh();
  }

  const collabOptions = (current?: string) =>
    collaborators
      .filter((c) => c.active || c.id === current)
      .map((c) => ({ value: c.id, label: c.name + (c.policyCode === "GAMIFICATION" ? " · gamificación" : "") + (c.active ? "" : " (inactivo)") }));

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        {locked && (
          <p className="border-l-2 border-brand-amber bg-warning-soft px-4 py-3 text-sm text-warning">
            El mes de venta ({formatMonth(lockedMonth!)}) está validado. Los valores económicos y los porcentajes están bloqueados; solo puedes editar datos descriptivos.
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Información general</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Código del proyecto" htmlFor="code" error={e.code?.message} required hint={projectId ? "El código no se puede cambiar." : "Debe ser único."}>
              <Input id="code" {...register("code")} readOnly={Boolean(projectId)} aria-invalid={!!e.code} className="num" />
            </Field>
            <Field label="Fecha de venta" htmlFor="saleDate" error={e.saleDate?.message} required>
              <Input id="saleDate" type="date" {...register("saleDate")} disabled={locked} aria-invalid={!!e.saleDate} />
            </Field>
            <Field label="Nombre del proyecto" htmlFor="name" error={e.name?.message} required className="sm:col-span-2">
              <Input id="name" {...register("name")} aria-invalid={!!e.name} />
            </Field>
            <Field label="Cliente" htmlFor="client" error={e.client?.message} required>
              <Input id="client" {...register("client")} aria-invalid={!!e.client} />
            </Field>
            <Field label="País" htmlFor="country" error={e.country?.message} required>
              <Controller control={control} name="country" render={({ field }) => <SimpleSelect id="country" value={field.value} onChange={field.onChange} options={COUNTRIES} />} />
            </Field>
            <Field label="Facturas previstas" htmlFor="expectedInvoices" error={e.expectedInvoices?.message} required hint="Cantidad de facturas que se emitirán en total.">
              <Input id="expectedInvoices" inputMode="numeric" {...register("expectedInvoices")} aria-invalid={!!e.expectedInvoices} className="num" />
            </Field>
            <Field label="Observaciones" htmlFor="notes" error={e.notes?.message} className="sm:col-span-2">
              <Textarea id="notes" rows={2} {...register("notes")} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Valores de la venta</CardTitle>
            <CardDescription>Todos los valores se registran antes de IVA.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Moneda original" htmlFor="currency" error={e.currency?.message} required>
              <Controller control={control} name="currency" render={({ field }) => <SimpleSelect id="currency" value={field.value} onChange={field.onChange} options={CURRENCY_OPTIONS} disabled={locked} />} />
            </Field>
            {isForeign ? (
              <Field label={`TRM del día de la venta (COP por ${cur})`} htmlFor="saleReferenceRate" error={e.saleReferenceRate?.message} required hint="Solo se usa para contabilizar la venta en COP frente a la meta mensual.">
                <Controller control={control} name="saleReferenceRate" render={({ field }) => <MoneyInput id="saleReferenceRate" decimals={6} value={field.value} onChange={field.onChange} prefix="$" disabled={locked} invalid={!!e.saleReferenceRate} />} />
              </Field>
            ) : (
              <div />
            )}
            <Field label="Valor de venta antes de IVA" htmlFor="saleAmount" error={e.saleAmount?.message} required>
              <Controller control={control} name="saleAmount" render={({ field }) => <MoneyInput id="saleAmount" value={field.value} onChange={field.onChange} prefix={cur === "COP" ? "$" : cur} disabled={locked} invalid={!!e.saleAmount} />} />
            </Field>
            <Field label="Costos de proveedores (sin IVA)" htmlFor="providerCosts" error={e.providerCosts?.message} required>
              <Controller control={control} name="providerCosts" render={({ field }) => <MoneyInput id="providerCosts" value={field.value} onChange={field.onChange} prefix={cur === "COP" ? "$" : cur} disabled={locked} invalid={!!e.providerCosts} />} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Colaboradores y porcentajes</CardTitle>
            <CardDescription>
              Máximo 1 % por persona y proyecto. Los porcentajes se fijan en la venta y se conservan durante todo el proyecto.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {fields.length === 0 && <p className="text-sm text-muted-foreground">Sin colaboradores comisionables. El proyecto igualmente cuenta para la meta organizacional del mes.</p>}
            {fields.map((f, i) => {
              const selected = assignments[i]?.collaboratorId;
              const collab = collaborators.find((c) => c.id === selected);
              const isGame = collab?.policyCode === "GAMIFICATION";
              return (
                <div key={f.id} className="grid grid-cols-[1fr_130px_auto] items-start gap-2">
                  <Field label={i === 0 ? "Colaborador" : "Colaborador"} htmlFor={`assignments.${i}.collaboratorId`} error={e.assignments?.[i]?.collaboratorId?.message} className="[&>label]:sr-only">
                    <Controller
                      control={control}
                      name={`assignments.${i}.collaboratorId`}
                      render={({ field }) => (
                        <SimpleSelect
                          id={`assignments.${i}.collaboratorId`}
                          value={field.value}
                          disabled={locked}
                          invalid={!!e.assignments?.[i]?.collaboratorId}
                          options={collabOptions(field.value)}
                          placeholder="Selecciona un colaborador"
                          onChange={(v) => {
                            field.onChange(v);
                            if (collaborators.find((c) => c.id === v)?.policyCode === "GAMIFICATION") setValue(`assignments.${i}.ratePercent`, "1");
                          }}
                        />
                      )}
                    />
                  </Field>
                  <Field label="Porcentaje" htmlFor={`assignments.${i}.ratePercent`} error={e.assignments?.[i]?.ratePercent?.message} className="[&>label]:sr-only">
                    <Controller
                      control={control}
                      name={`assignments.${i}.ratePercent`}
                      render={({ field }) => (
                        <MoneyInput id={`assignments.${i}.ratePercent`} decimals={4} suffix="%" value={field.value} onChange={field.onChange} disabled={locked || isGame} invalid={!!e.assignments?.[i]?.ratePercent} />
                      )}
                    />
                  </Field>
                  <Button type="button" variant="ghost" size="icon" aria-label="Quitar colaborador" disabled={locked} onClick={() => remove(i)}>
                    <Trash2 />
                  </Button>
                  {isGame && <p className="col-span-3 -mt-1 text-xs text-muted-foreground">Política de gamificación: 1 % base; el porcentaje efectivo depende del cumplimiento del mes de venta (0 %, 0,5 %, 1 % o 1,5 %).</p>}
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => append({ collaboratorId: "", ratePercent: "1" })}>
              <Plus data-icon="inline-start" /> Agregar colaborador
            </Button>
            {typeof e.assignments?.message === "string" && <p className="text-xs text-danger">{e.assignments.message}</p>}

            {ratesChanged && !locked && (
              <Field label="Motivo del cambio de porcentajes" htmlFor="rateChangeReason" required hint="Los porcentajes son fijos desde la venta; todo cambio queda en el historial con su motivo.">
                <Textarea id="rateChangeReason" rows={2} />
              </Field>
            )}
          </CardContent>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="eyebrow !text-[11px]">Base neta comisionable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className={`num text-3xl font-bold ${negative ? "text-danger" : "text-brand-deep"}`}>{formatMoney(netBase, cur)}</p>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Venta antes de IVA</dt><dd className="num">{formatMoney(saleAmount || 0, cur)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">− Costos de proveedores</dt><dd className="num">{formatMoney(providerCosts || 0, cur)}</dd></div>
            </dl>
            {negative && <p role="alert" className="text-xs font-medium text-danger">Los costos superan la venta: la base comisionable no puede ser negativa.</p>}
            {assignments.length > 0 && (
              <p className="border-t pt-3 text-xs text-muted-foreground">
                Suma de porcentajes asignados: <span className="num font-semibold text-foreground">{formatPercent(totalPct.div(100), 2)}</span>
              </p>
            )}
          </CardContent>
        </Card>

        {ym && (
          <Card className="mt-4" size="sm">
            <CardHeader>
              <CardTitle className="eyebrow !text-[11px]">Meta de {formatMonth(ym)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="h-2 w-full overflow-hidden bg-muted" role="img" aria-label={`Cumplimiento ${formatPercent(ratio, 0)}`}>
                <div className={`h-full ${ratio.gte(1) ? "bg-brand-mint" : "bg-primary"}`} style={{ width: `${Math.min(100, ratio.mul(100).toNumber())}%` }} />
              </div>
              <p className="num font-semibold">{formatPercent(ratio, 1)} de la meta</p>
              <p className="text-xs text-muted-foreground">
                Con este proyecto el mes suma {formatMoney(monthTotal, "COP", 0)} de {formatMoney(goal, "COP", 0)}.
                {monthCtx?.status === "VALIDATED" ? " El mes ya está validado." : " El mes aún no está validado: el cumplimiento puede cambiar."}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="mt-4 flex gap-2">
          <Button type="submit" className="flex-1" size="lg" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? "Guardando…" : projectId ? "Guardar cambios" : "Crear proyecto"}
          </Button>
          <Button render={<Link href={projectId ? `/proyectos/${projectId}` : "/proyectos"} />} variant="outline" size="lg">
            Cancelar
          </Button>
        </div>
      </aside>
    </form>
  );
}
