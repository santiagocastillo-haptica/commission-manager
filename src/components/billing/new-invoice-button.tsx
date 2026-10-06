"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { InvoiceFormDialog, type InvoiceProjectRef } from "@/components/billing/dialogs";
import { Field } from "@/components/form/field";
import { SimpleSelect } from "@/components/form/simple-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Paso 1: elegir el proyecto. Paso 2: el formulario de factura (en la moneda de ese proyecto). */
export function NewInvoiceButton({ projects }: { projects: (InvoiceProjectRef & { client: string })[] }) {
  const [pickOpen, setPickOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const project = projects.find((p) => p.id === projectId);

  return (
    <>
      <Button onClick={() => setPickOpen(true)}>
        <Plus data-icon="inline-start" /> Registrar factura
      </Button>
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿A qué proyecto pertenece la factura?</DialogTitle>
            <DialogDescription>Solo se listan proyectos con valor pendiente de facturar.</DialogDescription>
          </DialogHeader>
          <Field label="Proyecto" htmlFor="pick-project">
            <SimpleSelect id="pick-project" value={projectId} onChange={setProjectId} placeholder="Selecciona un proyecto" options={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.client}` }))} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickOpen(false)}>Cancelar</Button>
            <Button
              disabled={!project}
              onClick={() => {
                setPickOpen(false);
                setFormOpen(true);
              }}
            >
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {project && <InvoiceFormDialog key={project.id} project={project} open={formOpen} onOpenChange={setFormOpen} />}
    </>
  );
}
