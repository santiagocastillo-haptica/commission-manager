import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, todayBogota } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { nextSettlement, settlementOptions } from "@/domain/periods";
import { requireSession } from "@/server/auth";
import { listSettlementStates } from "@/server/queries/settlements";

export const metadata: Metadata = { title: "Liquidaciones" };

export default async function SettlementsPage() {
  await requireSession();
  const today = todayBogota();
  const next = nextSettlement(today);
  const items = await listSettlementStates(settlementOptions(today));

  return (
    <>
      <PageHeader
        eyebrow="Pagos"
        title="Liquidaciones"
        description="Liquidación semestral guiada: seleccionar el período, calcular, revisar, aprobar, generar reportes y registrar pagos. Las liquidaciones aprobadas son inmutables."
      />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Liquidación</TableHead>
              <TableHead>Recaudos del período</TableHead>
              <TableHead>Pago</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Neto a pagar</TableHead>
              <TableHead className="text-right">Pagado</TableHead>
              <TableHead>Pagos</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(({ period: p, status, totalNet, paid, paymentState }) => (
              <TableRow key={p.code} className={p.code === next.code ? "bg-accent/40" : undefined}>
                <TableCell>
                  <Link href={`/liquidaciones/${p.code}`} className="font-semibold text-brand-deep underline-offset-4 hover:underline">{p.label}</Link>
                  <div className="num text-xs text-muted-foreground">{p.code}</div>
                </TableCell>
                <TableCell className="num whitespace-nowrap">{formatDate(p.periodStart)} – {formatDate(p.periodEnd)}</TableCell>
                <TableCell className="num whitespace-nowrap">
                  {formatDate(p.paymentDate)}
                  {p.code === next.code && <Badge variant="info" className="ml-2">Próxima</Badge>}
                </TableCell>
                <TableCell>
                  {status === "APPROVED" ? <Badge variant="success">Aprobada</Badge> : status === "DRAFT" ? <Badge variant="warning">Borrador</Badge> : <Badge variant="neutral">Sin calcular</Badge>}
                </TableCell>
                <TableCell className="num text-right">{totalNet !== null && status === "APPROVED" ? formatMoney(totalNet, "COP", 2) : "—"}</TableCell>
                <TableCell className="num text-right">{status === "APPROVED" ? formatMoney(paid, "COP", 2) : "—"}</TableCell>
                <TableCell>
                  {paymentState === "NONE" ? "—" : paymentState === "PAID" ? <Badge variant="success">Pagada</Badge> : paymentState === "PARTIAL" ? <Badge variant="info">Parcial</Badge> : <Badge variant="warning">Pendiente</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="xs" variant={status === "APPROVED" ? "outline" : "default"} render={<Link href={`/liquidaciones/${p.code}`} />}>
                    {status === "APPROVED" ? "Abrir" : status === "DRAFT" ? "Continuar" : "Iniciar"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
