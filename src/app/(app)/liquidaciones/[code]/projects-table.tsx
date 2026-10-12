"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/domain/dates";
import { formatMoney, formatPercent, type CurrencyCode } from "@/domain/money";
import { addProjectPersonAction } from "@/server/actions/settlements";
import type { ProjectTableRow } from "@/server/queries/settlements";

function AddPersonDialog({ row }: { row: ProjectTableRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState("");
  const [rate, setRate] = useState("1");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  async function save() {
    setError(undefined);
    if (!person) return setError("Elige a la persona que va a comisionar.");
    setBusy(true);
    const res = await addProjectPersonAction({ projectCode: row.projectCode, collaboratorId: person, ratePercent: rate.trim(), reason: reason.trim() });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(res.message);
    setOpen(false);
    setPerson("");
    setReason("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="outline" disabled={row.candidates.length === 0}>Agregar persona</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quién más comisiona en {row.projectCode}</DialogTitle>
          <DialogDescription>
            La persona comisiona sobre los recaudos de este proyecto que aún no estén liquidados, con el mismo cumplimiento de meta del mes de venta. Queda registrado con tu nombre y el motivo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`add-person-${row.projectId}`}>Persona</Label>
            <select id={`add-person-${row.projectId}`} className="h-9 w-full border bg-background px-2 text-sm" value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Elige…</option>
              {row.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`add-rate-${row.projectId}`}>Porcentaje base (%)</Label>
            <Input id={`add-rate-${row.projectId}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="num" />
            <p className="text-xs text-muted-foreground">En puntos porcentuales: 1 = 1 %. Para gamificación debe ser 1 %.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`add-reason-${row.projectId}`}>Motivo (mínimo 10 caracteres)</Label>
            <Textarea id={`add-reason-${row.projectId}`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="border-l-2 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={busy} onClick={save}>
            {busy ? "Guardando…" : "Agregar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Vista de tabla de los proyectos de la liquidación: venta, facturación, recaudo y quién comisiona. */
export function ProjectsTable({ rows, readOnly }: { rows: ProjectTableRow[]; readOnly: boolean }) {
  const [q, setQ] = useState("");
  const shown = rows.filter((r) => !q.trim() || `${r.projectCode} ${r.client}`.toLowerCase().includes(q.trim().toLowerCase()));
  const money = (v: string, cur: string) => formatMoney(v, cur as CurrencyCode, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold">Proyectos de la liquidación ({rows.length})</h3>
        <Input aria-label="Buscar proyecto" placeholder="Buscar por código o cliente" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-60" />
      </div>
      <p className="text-xs text-muted-foreground">Proyectos con recaudos en esta liquidación o vendidos en las fechas del período. Los valores están en la moneda de cada proyecto, sin IVA.</p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Proyecto</th>
              <th className="px-2 py-2 text-right font-medium">Venta</th>
              <th className="px-2 py-2 text-right font-medium">Facturado</th>
              <th className="px-2 py-2 text-right font-medium">Recaudado</th>
              <th className="px-2 py-2 font-medium">Detalle facturas</th>
              <th className="px-2 py-2 font-medium">Personas que comisionan</th>
              <th className="px-3 py-2 font-medium">Agregar</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-muted-foreground">
                  No hay proyectos que mostrar.
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.projectId} className="border-t align-top">
                <td className="px-3 py-2">
                  <Link href={`/proyectos/${r.projectId}`} className="num font-semibold text-brand-deep underline-offset-4 hover:underline">
                    {r.projectCode}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {r.client} · {formatDate(r.saleDate)}
                  </span>
                </td>
                <td className="num px-2 py-2 text-right">{money(r.saleAmount, r.currency)}</td>
                <td className="num px-2 py-2 text-right">{money(r.invoiced, r.currency)}</td>
                <td className="num px-2 py-2 text-right">{money(r.collected, r.currency)}</td>
                <td className="px-2 py-2 text-xs">
                  {r.invoices.length === 0 && <span className="text-muted-foreground">Sin facturas</span>}
                  <ul className="space-y-0.5">
                    {r.invoices.map((i, n) => (
                      <li key={`${i.number ?? "prevista"}-${n}`} className="whitespace-nowrap">
                        <span className="num font-semibold">{i.number ?? "Prevista"}</span>
                        {i.status === "PLANNED" && <span className="text-muted-foreground"> (sin emitir)</span>}
                        {i.issueDate && <span className="text-muted-foreground"> · {formatDate(i.issueDate)}</span>} · <span className="num">{money(i.amount, r.currency)}</span>
                        {i.status === "ISSUED" && (
                          <span className="text-muted-foreground">
                            {" "}
                            · recaudado <span className="num">{money(i.collected, r.currency)}</span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-2 py-2">
                  {r.people.length === 0 && <span className="text-xs text-muted-foreground">Nadie</span>}
                  <ul className="space-y-0.5 text-xs">
                    {r.people.map((p) => (
                      <li key={p.name} className="whitespace-nowrap">
                        <span className="font-medium">{p.name}</span> <span className="num text-muted-foreground">{p.effectiveRate === null ? "mes sin validar" : formatPercent(p.effectiveRate, 2)}</span>
                        {p.bonus && (
                          <>
                            {" "}
                            <Badge variant="neutral">Bonificación</Badge>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-3 py-2">{!readOnly && <AddPersonDialog row={r} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
