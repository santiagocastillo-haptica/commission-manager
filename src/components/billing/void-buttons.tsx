"use client";

import { Ban } from "lucide-react";
import { VoidDialog } from "@/components/billing/dialogs";
import { Button } from "@/components/ui/button";
import { voidAdjustmentAction } from "@/server/actions/billing";
import { voidProjectAction } from "@/server/actions/projects";

export function VoidProjectButton({ id, code }: { id: string; code: string }) {
  return (
    <VoidDialog
      title={`Anular proyecto ${code}`}
      description="El proyecto no se elimina: queda anulado y fuera de las ventas del mes. Solo es posible si no tiene facturas emitidas ni recaudos."
      action={(reason) => voidProjectAction({ id, reason })}
      trigger={
        <Button variant="destructive">
          <Ban data-icon="inline-start" /> Anular
        </Button>
      }
    />
  );
}

export function VoidAdjustmentButton({ id }: { id: string }) {
  return (
    <VoidDialog
      title="Anular ajuste"
      description="El ajuste dejará de considerarse en la próxima liquidación. Queda registrado en el historial."
      action={(reason) => voidAdjustmentAction({ id, reason })}
      trigger={
        <Button size="icon-xs" variant="ghost" aria-label="Anular ajuste">
          <Ban />
        </Button>
      }
    />
  );
}
