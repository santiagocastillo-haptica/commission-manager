"use client";

import { Ban, Coins, Lock, Pencil } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { AdjustmentFormDialog, CollectionFormDialog, InvoiceFormDialog, VoidDialog, type InvoiceProjectRef } from "@/components/billing/dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/domain/dates";
import { D, formatMoney, formatPercent, type CurrencyCode } from "@/domain/money";
import { voidCollectionAction, voidInvoiceAction } from "@/server/actions/billing";
import type { InvoiceRow } from "@/server/queries/billing";

function invoiceState(i: InvoiceRow) {
  if (i.voided) return <Badge variant="danger">Anulada</Badge>;
  if (i.status === "PLANNED") return <Badge variant="neutral">Prevista</Badge>;
  if (D(i.balance).lte(0)) return <Badge variant="success">Recaudada</Badge>;
  if (i.overdue) return <Badge variant="danger">Vencida</Badge>;
  if (D(i.collected).gt(0)) return <Badge variant="warning">Recaudo parcial</Badge>;
  return <Badge variant="info">Pendiente de recaudo</Badge>;
}

/** Recaudo único por el valor total de la factura (el que se puede cambiar desde el formulario de la factura). */
function singleFullCollection(i: InvoiceRow) {
  const live = i.collections.filter((c) => !c.voided);
  return live.length === 1 && D(live[0].amountReceived).equals(i.amountPreTax) ? live[0] : null;
}

/** Motivo por el que la fecha de recaudo no se edita desde el formulario de la factura (o undefined si sí se puede). */
function collectionLock(i: InvoiceRow): string | undefined {
  const live = i.collections.filter((c) => !c.voided);
  if (live.length === 0) return undefined;
  if (!singleFullCollection(i)) return "Tiene recaudos parciales: gestiónalos con el botón «Recaudo».";
  if (live[0].locked) return "El recaudo ya fue liquidado y no se puede modificar.";
  return undefined;
}

export function InvoiceTable({
  invoices,
  projects,
  showProject = false,
}: {
  invoices: InvoiceRow[];
  projects: Record<string, InvoiceProjectRef>;
  showProject?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>Factura</TableHead>
            {showProject && <TableHead>Proyecto</TableHead>}
            <TableHead>Emisión</TableHead>
            <TableHead className="text-right">Facturado</TableHead>
            <TableHead className="text-right">Recaudado</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((i) => {
            const cur = i.currency as CurrencyCode;
            const pct = D(i.amountPreTax).isZero() ? D(0) : D(i.collected).div(i.amountPreTax);
            const project = projects[i.projectId];
            const live = i.collections.filter((c) => !c.voided);
            return (
              <Fragment key={i.id}>
                <TableRow className={i.voided ? "opacity-55" : "hover:bg-accent/40"}>
                  <TableCell>
                    <span className="num font-semibold text-brand-deep">{i.number ?? "—"}</span>
                    {i.locked && <Lock className="ml-1.5 inline size-3 text-muted-foreground" aria-label="Con comisiones liquidadas" />}
                    {i.notes && <div className="max-w-[220px] truncate text-xs text-muted-foreground" title={i.notes}>{i.notes}</div>}
                  </TableCell>
                  {showProject && (
                    <TableCell>
                      <Link href={`/proyectos/${i.projectId}`} className="font-medium underline-offset-4 hover:underline">{i.projectCode}</Link>
                      <div className="max-w-[200px] truncate text-xs text-muted-foreground">{i.client}</div>
                    </TableCell>
                  )}
                  <TableCell className="num whitespace-nowrap">
                    {formatDate(i.issueDate)}
                    {i.dueDate && <div className="text-xs text-muted-foreground">Vence {formatDate(i.dueDate)}</div>}
                  </TableCell>
                  <TableCell className="num text-right">{formatMoney(i.amountPreTax, cur)}</TableCell>
                  <TableCell className="text-right">
                    <div className="num">{formatMoney(i.collected, cur)}</div>
                    {i.status === "ISSUED" && !i.voided && (
                      <div className="ml-auto mt-1 h-1 w-20 bg-muted" role="img" aria-label={`Recaudado ${formatPercent(pct, 0)}`}>
                        <div className="h-full bg-brand-mint" style={{ width: `${Math.min(100, pct.mul(100).toNumber())}%` }} />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="num text-right font-semibold">{i.status === "ISSUED" && !i.voided ? formatMoney(i.balance, cur) : "—"}</TableCell>
                  <TableCell>{invoiceState(i)}</TableCell>
                  <TableCell>
                    {!i.voided && project && (
                      <div className="flex justify-end gap-1.5">
                        {i.status === "ISSUED" && D(i.balance).gt(0) && (
                          <CollectionFormDialog
                            invoice={{ id: i.id, number: i.number, projectCode: i.projectCode, currency: cur, balance: i.balance, issueDate: i.issueDate }}
                            trigger={<Button size="xs"><Coins data-icon="inline-start" /> Recaudo</Button>}
                          />
                        )}
                        <InvoiceFormDialog
                          project={project}
                          invoiceId={i.id}
                          collectionLocked={collectionLock(i)}
                          initial={{
                            projectId: i.projectId, number: i.number ?? "", status: i.status, issueDate: i.issueDate ?? "", dueDate: i.dueDate ?? "", collectedOn: singleFullCollection(i)?.date ?? "",
                            amountPreTax: i.amountPreTax, netBaseExplicit: i.netBaseExplicit ?? "", notes: i.notes ?? "",
                          }}
                          trigger={<Button size="icon-xs" variant="outline" aria-label="Editar factura"><Pencil /></Button>}
                        />
                        {live.length === 0 && (
                          <VoidDialog
                            title={`Anular factura ${i.number ?? "prevista"}`}
                            description="La factura queda anulada y deja de contar para el proyecto. No se elimina: queda registrada en el historial."
                            action={(reason) => voidInvoiceAction({ id: i.id, reason })}
                            trigger={<Button size="icon-xs" variant="outline" aria-label="Anular factura"><Ban /></Button>}
                          />
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
                {i.collections.length > 0 && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={showProject ? 8 : 7} className="py-2 pl-8">
                      <ul className="space-y-1">
                        {i.collections.map((c) => (
                          <li key={c.id} className={`flex flex-wrap items-center gap-x-5 gap-y-1 text-xs ${c.voided ? "text-muted-foreground line-through" : ""}`}>
                            <span className="num w-24 font-medium">{formatDate(c.date)}</span>
                            <span className="num w-36 font-semibold">{formatMoney(c.amountReceived, cur)}</span>
                            {cur !== "COP" && <span className="num text-muted-foreground">TRM {formatMoney(c.fxRate, "COP", 2)} → {formatMoney(c.amountCOP, "COP", 0)}</span>}
                            {c.isOverpaymentAdjustment && <Badge variant="warning">Ajuste por excedente</Badge>}
                            {c.locked && <Badge variant="info"><Lock aria-hidden /> Liquidado</Badge>}
                            {c.notes && <span className="max-w-xs truncate text-muted-foreground" title={c.notes}>{c.notes}</span>}
                            {!c.voided && !c.locked && !i.voided && (
                              <span className="ml-auto flex gap-1">
                                <CollectionFormDialog
                                  collectionId={c.id}
                                  invoice={{ id: i.id, number: i.number, projectCode: i.projectCode, currency: cur, balance: D(i.balance).plus(c.amountReceived).toFixed(), issueDate: i.issueDate }}
                                  initial={{ invoiceId: i.id, date: c.date, amountReceived: c.amountReceived, fxRate: cur === "COP" ? "" : c.fxRate, isOverpaymentAdjustment: c.isOverpaymentAdjustment, justification: c.justification ?? "", notes: c.notes ?? "" }}
                                  trigger={<Button size="icon-xs" variant="ghost" aria-label="Editar recaudo"><Pencil /></Button>}
                                />
                                <VoidDialog
                                  title="Anular recaudo"
                                  description={`Se anulará el recaudo de ${formatMoney(c.amountReceived, cur)} del ${formatDate(c.date)}. Queda registrado en el historial.`}
                                  action={(reason) => voidCollectionAction({ id: c.id, reason })}
                                  trigger={<Button size="icon-xs" variant="ghost" aria-label="Anular recaudo"><Ban /></Button>}
                                />
                              </span>
                            )}
                            {c.voided && <span>Anulado: {c.voidReason}</span>}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export { AdjustmentFormDialog };
