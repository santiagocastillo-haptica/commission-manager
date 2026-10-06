"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Field } from "@/components/form/field";
import { SimpleSelect } from "@/components/form/simple-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { collaboratorSchema, type CollaboratorInput } from "@/lib/schemas";
import { saveCollaboratorAction } from "@/server/actions/collaborators";

export interface PolicyOption {
  id: string;
  name: string;
}

export function CollaboratorFormDialog({
  trigger,
  policies,
  initial,
  collaboratorId,
}: {
  trigger: React.ReactElement;
  policies: PolicyOption[];
  initial?: Partial<CollaboratorInput>;
  collaboratorId?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<CollaboratorInput>({
    resolver: zodResolver(collaboratorSchema),
    defaultValues: {
      fullName: "",
      email: "",
      position: "",
      status: "ACTIVE",
      policyId: policies.find((p) => p.name.toLowerCase().includes("general"))?.id ?? policies[0]?.id ?? "",
      joinDate: "",
      notes: "",
      ...initial,
    },
  });
  const { register, control, handleSubmit, formState, setError, reset } = form;
  const e = formState.errors;

  async function onSubmit(values: CollaboratorInput) {
    const res = await saveCollaboratorAction(collaboratorId ?? null, values);
    if (!res.ok) {
      Object.entries(res.fieldErrors ?? {}).forEach(([k, message]) => setError(k as keyof CollaboratorInput, { message }));
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setOpen(false);
    if (!collaboratorId) reset();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{collaboratorId ? "Editar colaborador" : "Nuevo colaborador"}</DialogTitle>
          <DialogDescription>
            Inactivar a un colaborador no elimina su historial ni modifica sus derechos económicos.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Nombre completo" htmlFor="fullName" error={e.fullName?.message} required>
            <Input id="fullName" {...register("fullName")} aria-invalid={!!e.fullName} />
          </Field>
          <Field label="Correo electrónico" htmlFor="email" error={e.email?.message} required>
            <Input id="email" type="email" {...register("email")} aria-invalid={!!e.email} />
          </Field>
          <Field label="Cargo" htmlFor="position" error={e.position?.message} required>
            <Input id="position" {...register("position")} aria-invalid={!!e.position} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Política de comisiones" htmlFor="policyId" error={e.policyId?.message} required>
              <Controller
                control={control}
                name="policyId"
                render={({ field }) => (
                  <SimpleSelect id="policyId" value={field.value} onChange={field.onChange} options={policies.map((p) => ({ value: p.id, label: p.name }))} invalid={!!e.policyId} />
                )}
              />
            </Field>
            <Field label="Estado" htmlFor="status" error={e.status?.message} required>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <SimpleSelect
                    id="status"
                    value={field.value}
                    onChange={field.onChange}
                    options={[
                      { value: "ACTIVE", label: "Activo" },
                      { value: "INACTIVE", label: "Inactivo" },
                    ]}
                  />
                )}
              />
            </Field>
          </div>
          <Field label="Fecha de ingreso" htmlFor="joinDate" error={e.joinDate?.message} hint="Opcional">
            <Input id="joinDate" type="date" {...register("joinDate")} />
          </Field>
          <Field label="Observaciones" htmlFor="notes" error={e.notes?.message}>
            <Textarea id="notes" rows={3} {...register("notes")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
