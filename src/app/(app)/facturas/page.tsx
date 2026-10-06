import type { Metadata } from "next";
import { InvoiceTable } from "@/components/billing/invoice-table";
import { NewInvoiceButton } from "@/components/billing/new-invoice-button";
import type { InvoiceProjectRef } from "@/components/billing/dialogs";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { CURRENCIES, D, formatMoney, ZERO, type CurrencyCode } from "@/domain/money";
import { requireSession } from "@/server/auth";
import { listInvoices } from "@/server/queries/billing";
import { listProjects } from "@/server/queries/projects";

export const metadata: Metadata = { title: "Facturas y recaudos" };

/** "COP $ 1.000 · USD 500,00": totales por moneda, sin mezclar monedas distintas. */
function byCurrency(values: { currency: string; amount: string }[]) {
  const totals = new Map<CurrencyCode, ReturnType<typeof D>>();
  for (const v of values) totals.set(v.currency as CurrencyCode, (totals.get(v.currency as CurrencyCode) ?? ZERO).plus(v.amount));
  const ordered = CURRENCIES.filter((c) => totals.has(c));
  const main = totals.get("COP") ?? ZERO;
  const others = ordered.filter((c) => c !== "COP").map((c) => formatMoney(totals.get(c), c, 0));
  return { main: formatMoney(main, "COP", 0), others };
}

export default async function InvoicesPage({ searchParams }: PageProps<"/facturas">) {
  await requireSession();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const [invoices, allInvoices, projects] = await Promise.all([
    listInvoices({ q: one("q"), state: one("state"), year: one("year") }),
    listInvoices(),
    listProjects(),
  ]);

  const refs: Record<string, InvoiceProjectRef> = {};
  for (const p of projects) {
    const remaining = D(p.saleAmount).minus(p.fin.scheduled);
    refs[p.id] = {
      id: p.id,
      code: p.code,
      currency: p.currency as CurrencyCode,
      remainingToInvoice: remaining.isNegative() ? "0" : remaining.toFixed(),
      pendingInvoices: Math.max(1, p.expectedInvoices - p.fin.invoiceCount),
    };
  }
  const invoiceable = projects.filter((p) => D(refs[p.id].remainingToInvoice).gt(0)).map((p) => ({ ...refs[p.id], name: p.name }));

  const issued = allInvoices.filter((i) => i.status === "ISSUED");
  const planned = allInvoices.filter((i) => i.status === "PLANNED");
  const pendingToIssue = projects.reduce((acc, p) => acc + p.fin.pendingInvoices, 0);
  const invoiced = byCurrency(issued.map((i) => ({ currency: i.currency, amount: i.amountPreTax })));
  const collected = byCurrency(issued.map((i) => ({ currency: i.currency, amount: i.collected })));
  const balance = byCurrency(issued.map((i) => ({ currency: i.currency, amount: i.balance })));
  const overdue = issued.filter((i) => i.overdue).length;
  const years = Array.from(new Set(allInvoices.map((i) => i.issueDate?.slice(0, 4)).filter(Boolean) as string[])).sort().reverse();

  return (
    <>
      <PageHeader
        eyebrow="Facturación"
        title="Facturas y recaudos"
        description="Registra las facturas de cada proyecto y sus recaudos (totales o parciales). La comisión se genera solo con lo efectivamente recaudado."
        actions={<NewInvoiceButton projects={invoiceable} />}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Facturas" value={`${issued.length} emitidas`} sub={`${planned.length} previstas registradas · ${pendingToIssue} por emitir según lo previsto`} tone="brand" />
        <StatCard label="Valor facturado" value={invoiced.main} sub={invoiced.others.length ? `+ ${invoiced.others.join(" · ")}` : "Antes de IVA"} />
        <StatCard label="Valor recaudado" value={collected.main} sub={collected.others.length ? `+ ${collected.others.join(" · ")}` : "Sin IVA"} tone="success" />
        <StatCard label="Saldo pendiente de recaudo" value={balance.main} sub={[balance.others.length ? `+ ${balance.others.join(" · ")}` : null, overdue ? `${overdue} vencidas` : null].filter(Boolean).join(" · ") || "Al día"} tone={overdue ? "danger" : "warning"} />
      </div>

      <FilterBar
        searchPlaceholder="Buscar por factura, proyecto o cliente…"
        selects={[
          { name: "state", label: "Estado", options: [{ value: "planned", label: "Previstas" }, { value: "issued", label: "Emitidas" }, { value: "pending", label: "Pendientes de recaudo" }, { value: "collected", label: "Recaudadas" }, { value: "overdue", label: "Vencidas" }] },
          { name: "year", label: "Año de emisión", options: years.map((y) => ({ value: y, label: y })) },
        ]}
      />

      {invoices.length === 0 ? (
        <EmptyState title="No hay facturas con estos filtros" description="Registra una factura desde aquí o desde el detalle de un proyecto." />
      ) : (
        <InvoiceTable invoices={invoices} projects={refs} showProject />
      )}
    </>
  );
}
