"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { setProjectClosedAction } from "@/server/actions/projects";

/** Da por cerrado un proyecto (deja de aparecer en las listas de las liquidaciones) o lo reabre. */
export function CloseProjectButton({ id, code, closed }: { id: string; code: string; closed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {closed ? <ArchiveRestore data-icon="inline-start" /> : <Archive data-icon="inline-start" />} {closed ? "Reabrir proyecto" : "Cerrar proyecto"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={closed ? `Reabrir ${code}` : `Cerrar ${code}`}
        confirmLabel={closed ? "Reabrir" : "Cerrar proyecto"}
        description={
          closed
            ? "El proyecto volverá a aparecer en las listas de las liquidaciones."
            : "Deja de aparecer en la revisión por proyecto, la tabla y el barrido de ventas de las liquidaciones. No cambia ninguna comisión: lo que tenga por liquidar se sigue pagando (si aún tiene líneas en una liquidación, se muestra con la etiqueta «Cerrado»). Puedes reabrirlo cuando quieras."
        }
        onConfirm={async () => {
          const res = await setProjectClosedAction({ id, closed: !closed, note });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success(res.message);
          setOpen(false);
          setNote("");
          router.refresh();
        }}
      >
        {!closed && <Textarea aria-label="Nota (opcional)" placeholder="Nota (opcional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
      </ConfirmDialog>
    </>
  );
}
