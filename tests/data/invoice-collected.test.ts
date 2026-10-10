import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import { lookupRateAction, saveInvoiceAction } from "@/server/actions/billing";
import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { saveProjectAction } from "@/server/actions/projects";
import { invoiceableProjects, listInvoices } from "@/server/queries/billing";
import { bootstrapBase } from "@/store/bootstrap";
import { C, col, type AuditDoc, type InvoiceDoc } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;

async function setup(currency: "COP" | "USD" = "COP") {
  const c = await saveCollaboratorAction(null, { fullName: "Ana", email: "ana@haptica.co", position: "Consultora", status: "ACTIVE", policyId: "GENERAL", joinDate: "", notes: "" });
  if (!c.ok) throw new Error(c.error);
  const usd = currency === "USD";
  const p = await saveProjectAction(null, {
    code: "HAP-2026-001", client: "Cliente", country: "CO", saleDate: "2026-05-10", currency, saleAmount: usd ? "1000" : "100000000", providerCosts: "0",
    saleReferenceRate: usd ? "4000" : undefined, expectedInvoices: "2", notes: "", assignments: [{ collaboratorId: c.data!.id, ratePercent: "1" }],
  } as Parameters<typeof saveProjectAction>[1]);
  if (!p.ok) throw new Error(p.error);
}
const invoice = (over: Record<string, unknown> = {}) =>
  ({ projectId: "HAP-2026-001", number: "FE-1", status: "ISSUED", issueDate: "2026-05-20", dueDate: "", amountPreTax: "60000000", netBaseExplicit: "", notes: "", ...over }) as Parameters<typeof saveInvoiceAction>[1];

suite("registrar una factura que ya está recaudada (un solo paso)", () => {
  beforeEach(async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
  });

  it("crea la factura y el recaudo por el valor total en una sola operación", async () => {
    await setup();
    const r = await saveInvoiceAction(null, invoice({ collectedOn: "2026-06-15" }));
    expect(r).toMatchObject({ ok: true, message: "Factura registrada y recaudada." });
    const [row] = await listInvoices({ projectId: "HAP-2026-001" });
    expect(row).toMatchObject({ number: "FE-1", collected: "60000000", balance: "0" });
    expect(row.collections).toHaveLength(1);
    expect(row.collections[0]).toMatchObject({ date: "2026-06-15", amountReceived: "60000000", fxRate: "1", amountCOP: "60000000", isOverpaymentAdjustment: false });
    const doc = (await col(C.invoices).get()).docs[0].data() as InvoiceDoc;
    expect(doc.collectionIds).toEqual([doc.collections[0].id]);
    const audits = (await col(C.auditLog).get()).docs.map((d) => d.data() as AuditDoc).filter((a) => a.entity === "Collection");
    expect(audits).toHaveLength(1);
  });

  it("sin la opción, la factura queda sin recaudos (como antes)", async () => {
    await setup();
    expect(await saveInvoiceAction(null, invoice())).toMatchObject({ ok: true, message: "Factura registrada." });
    expect((await listInvoices({ projectId: "HAP-2026-001" }))[0]).toMatchObject({ collected: "0", balance: "60000000" });
  });

  it("valida la fecha: no anterior a la emisión, no futura, solo para facturas emitidas", async () => {
    await setup();
    expect((await saveInvoiceAction(null, invoice({ collectedOn: "2026-05-01" }))).ok).toBe(false);
    expect((await saveInvoiceAction(null, invoice({ collectedOn: "2999-01-01" }))).ok).toBe(false);
    expect((await saveInvoiceAction(null, invoice({ status: "PLANNED", number: "", issueDate: "", collectedOn: "2026-06-15" }))).ok).toBe(false);
    expect((await col(C.invoices).get()).size).toBe(0); // no quedó nada a medias
  });

  it("no hay recaudo si la factura falla (número repetido): todo o nada", async () => {
    await setup();
    await saveInvoiceAction(null, invoice());
    const dup = await saveInvoiceAction(null, invoice({ amountPreTax: "10000000", collectedOn: "2026-06-15" }));
    expect(dup.ok).toBe(false);
    expect((await listInvoices({ projectId: "HAP-2026-001" }))).toHaveLength(1);
  });

  it("moneda extranjera: exige la TRM, la convierte a COP y la guarda en el catálogo sin pisar una existente", async () => {
    await setup("USD");
    expect((await saveInvoiceAction(null, invoice({ amountPreTax: "600", collectedOn: "2026-06-15" }))).ok).toBe(false); // sin TRM
    expect((await saveInvoiceAction(null, invoice({ amountPreTax: "600", collectedOn: "2026-06-15", collectedFxRate: "1" }))).ok).toBe(false); // TRM 1
    expect((await saveInvoiceAction(null, invoice({ amountPreTax: "600", collectedOn: "2026-06-15", collectedFxRate: "4100.5" }))).ok).toBe(true);
    const [row] = await listInvoices({ projectId: "HAP-2026-001" });
    expect(row.collections[0]).toMatchObject({ amountReceived: "600", fxRate: "4100.5", amountCOP: "2460300" });
    expect(await lookupRateAction("USD", "2026-06-15")).toBe("4100.5");
    // otra factura el mismo día con otra TRM: no pisa la registrada
    expect((await saveInvoiceAction(null, invoice({ number: "FE-2", amountPreTax: "300", collectedOn: "2026-06-15", collectedFxRate: "4200" }))).ok).toBe(true);
    expect(await lookupRateAction("USD", "2026-06-15")).toBe("4100.5");
  });

  it("al editar una factura existente no se crea ningún recaudo aunque se envíe la fecha", async () => {
    await setup();
    const r = await saveInvoiceAction(null, invoice());
    if (!r.ok || !r.data) throw new Error("no se creó la factura");
    await saveInvoiceAction(r.data.id, invoice({ collectedOn: "2026-06-15", notes: "editada" }));
    expect((await listInvoices({ projectId: "HAP-2026-001" }))[0]).toMatchObject({ collected: "0", notes: "editada" });
  });

  it("lista los proyectos que aún tienen valor por facturar (para registrar facturas faltantes desde la liquidación)", async () => {
    await setup();
    expect(await invoiceableProjects()).toEqual([
      { id: "HAP-2026-001", code: "HAP-2026-001", client: "Cliente", currency: "COP", remainingToInvoice: "100000000", pendingInvoices: 2 },
    ]);
    await saveInvoiceAction(null, invoice({ amountPreTax: "40000000" }));
    expect((await invoiceableProjects())[0]).toMatchObject({ remainingToInvoice: "60000000", pendingInvoices: 1 });
    await saveInvoiceAction(null, invoice({ number: "FE-2", amountPreTax: "60000000" }));
    expect(await invoiceableProjects()).toEqual([]); // ya facturado por completo
  });
});
