"use client";

import { Unlock } from "lucide-react";
import { VoidDialog } from "@/components/billing/dialogs";
import { Button } from "@/components/ui/button";
import { reopenSettlementAction } from "@/server/actions/settlements";

/** Deshace el cierre de una liquidación aprobada (si aún no tiene pagos) para poder corregir sus datos de origen. */
export function ReopenSettlementButton({ code }: { code: string }) {
  return (
    <VoidDialog
      title={`Reabrir ${code}`}
      description={
        <>
          Deshace el cierre: se eliminan sus líneas, compromisos y liquidaciones individuales, y la liquidación queda sin calcular. Después corriges los datos (por ejemplo, mueves facturas entre proyectos), la calculas y la apruebas de nuevo.
          <br />
          <br />
          No es posible si ya hay pagos registrados ni si existe una liquidación posterior aprobada. Los reportes ya descargados quedan obsoletos.
        </>
      }
      confirmLabel="Reabrir liquidación"
      reasonLabel="Motivo de la reapertura"
      action={(reason) => reopenSettlementAction({ code, reason })}
      trigger={
        <Button variant="outline">
          <Unlock data-icon="inline-start" /> Reabrir liquidación
        </Button>
      }
    />
  );
}
