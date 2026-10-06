import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import {
  lookupRateAction, saveAdjustmentAction, saveCollectionAction, saveInvoiceAction,
  voidAdjustmentAction, voidCollectionAction, voidInvoiceAction,
} from "@/server/actions/billing";
import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { saveProjectAction } from "@/server/actions/projects";
import { listAdjustments, listInvoices, projectHistory } from "@/server/queries/billing";
import { bootstrapBase } from "@/store/bootstrap";
import { C, col, ref, type AdjustmentDoc, type InvoiceDoc } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const CODE = "HAP-2026-001";
const idOf = (r: { ok: boolean; data?: { id: string } }) => { if (!r.ok || !r.data) throw new Error("acción falló"); return r.data.id; };

async function setup(currency: "COP" | "USD" = "COP") {
  const c = await saveCollaboratorAction(null, { fullName: "Ana", email: "ana@haptica.co", position: "Consultora", status: "ACTIVE", policyId: "GENERAL", joinDate: "", notes: "" });
  if (!c.ok) throw new Error(c.error);
  const usd = currency === "USD";
  const p = await saveProjectAction(null, {
    code: CODE, name: "Proyecto", client: "Cliente", country: "CO", saleDate: "2026-05-10", currency,
    saleAmount: usd ? "1000" : "100000000", providerCosts: usd ? "0" : "10000000", saleReferenceRate: usd ? "4000" : undefined,
    expectedInvoices: "2", notes: "", assignments: [{ collaboratorId: c.data!.id, ratePercent: "1" }],
  } as Parameters<typeof saveProjectAction>[1]);
  if (!p.ok) throw new Error(p.error);
}
const invoice = (over: Record<string, unknown> = {}) =>
  ({ projectId: CODE, number: "FE-1", status: "ISSUED", issueDate: "2026-05-20", dueDate: "2026-06-20", amountPreTax: "60000000", netBaseExplicit: "", notes: "", ...over }) as Parameters<typeof saveInvoiceAction>[1];
const collection = (invoiceId: string, over: Record<string, unknown> = {}) =>
  ({ invoiceId, date: "2026-06-01", amountReceived: "20000000", isOverpaymentAdjustment: false, notes: "", ...over }) as Parameters<typeof saveCollectionAction>[1];
async function mkInvoice(over = {}) {
  const r = await saveInvoiceAction(null, invoice(over));
  if (!r.ok) throw new Error(r.error);
  return idOf(r);
}
const lock = (inv: string, collectionId: string | null, adjustmentId: string | null = null) =>
  col(C.commitments).doc(`k${Math.random()}`).set({ id: "k", type: "COLLECTION", collectionId, adjustmentId, assignmentId: "a", invoiceId: inv, projectId: CODE, collaboratorId: "c", settlementCode: "S", lineId: "l", commissionCOP: "1", committedAt: "x" });

suite("Fase C: facturas, recaudos y ajustes en Firestore", () => {
  beforeEach(async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
  });

  describe("facturas", () => {
    it("registra, exige número único por proyecto y no supera la venta", async () => {
      await setup();
      await mkInvoice();
      expect((await saveInvoiceAction(null, invoice({ amountPreTax: "10000000" }))).ok).toBe(false); // mismo número
      expect((await saveInvoiceAction(null, invoice({ number: "FE-2", amountPreTax: "50000000" }))).ok).toBe(false); // 60+50 > 100
      expect((await saveInvoiceAction(null, invoice({ number: "FE-2", amountPreTax: "40000000" }))).ok).toBe(true);
      expect((await listInvoices({ projectId: CODE })).length).toBe(2);
    });

    it("las facturas previstas no necesitan número ni fecha", async () => {
      await setup();
      expect((await saveInvoiceAction(null, invoice({ number: "", status: "PLANNED", issueDate: "", dueDate: "" }))).ok).toBe(true);
      expect((await saveInvoiceAction(null, invoice({ number: "", status: "PLANNED", issueDate: "", dueDate: "", amountPreTax: "1000" }))).ok).toBe(true);
    });

    it("editar libera el número anterior; anular conserva el número tomado", async () => {
      await setup();
      const id = await mkInvoice();
      expect((await saveInvoiceAction(id, invoice({ number: "FE-9" }))).ok).toBe(true);
      expect((await saveInvoiceAction(null, invoice({ number: "FE-1", amountPreTax: "1000" }))).ok).toBe(true);
      expect((await voidInvoiceAction({ id, reason: "Factura emitida por error" })).ok).toBe(true);
      expect((await saveInvoiceAction(null, invoice({ number: "FE-9", amountPreTax: "1000" }))).ok).toBe(false);
    });

    it("con recaudos: valor no menor al recaudado, no vuelve a prevista y no se anula", async () => {
      await setup();
      const id = await mkInvoice();
      await saveCollectionAction(null, collection(id));
      expect((await saveInvoiceAction(id, invoice({ amountPreTax: "10000000" }))).ok).toBe(false);
      expect((await saveInvoiceAction(id, invoice({ status: "PLANNED" }))).ok).toBe(false);
      expect((await voidInvoiceAction({ id, reason: "Intento con recaudos vivos" })).ok).toBe(false);
    });

    it("liquidada: bloquea valor, estado y fecha de emisión, pero permite notas", async () => {
      await setup();
      const id = await mkInvoice();
      await lock(id, null);
      expect((await saveInvoiceAction(id, invoice({ amountPreTax: "61000000" }))).ok).toBe(false);
      expect((await saveInvoiceAction(id, invoice({ issueDate: "2026-05-21" }))).ok).toBe(false);
      expect((await saveInvoiceAction(id, invoice({ notes: "Nota nueva" }))).ok).toBe(true);
      expect((await listInvoices({ projectId: CODE }))[0].locked).toBe(true);
    });
  });

  describe("recaudos", () => {
    it("registra, calcula saldo y anula con recaudo reflejado en la consulta", async () => {
      await setup();
      const id = await mkInvoice();
      const r = await saveCollectionAction(null, collection(id));
      expect(r.ok).toBe(true);
      let row = (await listInvoices({ projectId: CODE }))[0];
      expect(row).toMatchObject({ collected: "20000000", balance: "40000000" });
      expect((await voidCollectionAction({ id: idOf(r), reason: "Recaudo mal digitado" })).ok).toBe(true);
      row = (await listInvoices({ projectId: CODE }))[0];
      expect(row).toMatchObject({ collected: "0", balance: "60000000" });
      expect(row.collections[0].voided).toBe(true);
    });

    it("valida: no futura, no antes de la emisión, no sobre factura prevista, no exceder sin ajuste", async () => {
      await setup();
      const id = await mkInvoice();
      expect((await saveCollectionAction(null, collection(id, { date: "2999-01-01" }))).ok).toBe(false);
      expect((await saveCollectionAction(null, collection(id, { date: "2026-05-01" }))).ok).toBe(false);
      expect((await saveCollectionAction(null, collection(id, { amountReceived: "70000000" }))).ok).toBe(false);
      const over = await saveCollectionAction(null, collection(id, { amountReceived: "70000000", isOverpaymentAdjustment: true, justification: "Excedente pagado por el cliente" }));
      expect(over.ok).toBe(true);
      const planned = await mkInvoice({ number: "", status: "PLANNED", issueDate: "", dueDate: "", amountPreTax: "1000" });
      expect((await saveCollectionAction(null, collection(planned))).ok).toBe(false);
    });

    it("editar excluye el propio recaudo del total; liquidado es inmutable", async () => {
      await setup();
      const id = await mkInvoice();
      const r = await saveCollectionAction(null, collection(id, { amountReceived: "60000000" }));
      expect((await saveCollectionAction(idOf(r), collection(id, { amountReceived: "55000000" }))).ok).toBe(true);
      await lock(id, idOf(r));
      expect((await saveCollectionAction(idOf(r), collection(id, { amountReceived: "50000000" }))).ok).toBe(false);
      expect((await voidCollectionAction({ id: idOf(r), reason: "Intento sobre liquidado" })).ok).toBe(false);
      expect((await listInvoices({ projectId: CODE }))[0].collections[0].locked).toBe(true);
    });

    it("moneda extranjera: exige TRM, convierte a COP y guarda la tasa en el catálogo", async () => {
      await setup("USD");
      const id = await mkInvoice({ amountPreTax: "600" });
      expect((await saveCollectionAction(null, collection(id, { amountReceived: "100" }))).ok).toBe(false);
      expect((await saveCollectionAction(null, collection(id, { amountReceived: "100", fxRate: "1" }))).ok).toBe(false);
      expect((await saveCollectionAction(null, collection(id, { amountReceived: "100", fxRate: "4100.5" }))).ok).toBe(true);
      expect((await listInvoices({ projectId: CODE }))[0].collections[0]).toMatchObject({ amountCOP: "410050", fxRate: "4100.5" });
      expect(await lookupRateAction("USD", "2026-06-01")).toBe("4100.5");
      // una segunda tasa el mismo día no pisa la registrada
      expect((await saveCollectionAction(null, collection(id, { amountReceived: "50", fxRate: "4200" }))).ok).toBe(true);
      expect(await lookupRateAction("USD", "2026-06-01")).toBe("4100.5");
      expect(await lookupRateAction("COP", "2026-06-01")).toBeNull();
    });
  });

  describe("ajustes", () => {
    const adj = (over = {}) => ({ projectId: CODE, date: "2026-06-05", kind: "CREDIT_NOTE", reason: "Nota crédito por devolución", amount: "5000000", ...over }) as Parameters<typeof saveAdjustmentAction>[0];

    it("registra pendiente, limita el acumulado a la base neta y se anula si no está aplicado", async () => {
      await setup();
      const r = await saveAdjustmentAction(adj());
      expect(r.ok).toBe(true);
      expect((await saveAdjustmentAction(adj({ amount: "90000000" }))).ok).toBe(false); // 5M + 90M > 90M base
      expect((await listAdjustments(CODE))[0]).toMatchObject({ status: "PENDING", amount: "5000000", voided: false });
      expect((await voidAdjustmentAction({ id: idOf(r), reason: "Registrado por equivocación" })).ok).toBe(true);
      expect((await saveAdjustmentAction(adj({ amount: "90000000" }))).ok).toBe(true); // el anulado ya no cuenta
    });

    it("exige que la factura sea del proyecto y bloquea anular uno aplicado", async () => {
      await setup();
      expect((await saveAdjustmentAction(adj({ invoiceId: "no-existe" }))).ok).toBe(false);
      const r = await saveAdjustmentAction(adj());
      await ref(C.adjustments, idOf(r)).update({ status: "APPLIED" });
      expect((await voidAdjustmentAction({ id: idOf(r), reason: "Intento sobre aplicado" })).ok).toBe(false);
    });

    it("anular una factura exige anular antes sus ajustes", async () => {
      await setup();
      const inv = await mkInvoice();
      const r = await saveAdjustmentAction(adj({ invoiceId: inv }));
      expect((await voidInvoiceAction({ id: inv, reason: "Factura con ajuste vivo" })).ok).toBe(false);
      await voidAdjustmentAction({ id: idOf(r), reason: "Se anula primero el ajuste" });
      expect((await voidInvoiceAction({ id: inv, reason: "Ahora sí se anula" })).ok).toBe(true);
    });
  });

  it("historial del proyecto reúne proyecto, facturas, recaudos y ajustes con su autor", async () => {
    await setup();
    const inv = await mkInvoice();
    await saveCollectionAction(null, collection(inv));
    await saveAdjustmentAction({ projectId: CODE, date: "2026-06-05", kind: "DISCOUNT", reason: "Descuento comercial pactado", amount: "1000000" });
    const h = await projectHistory(CODE);
    expect(new Set(h.map((r) => r.entity))).toEqual(new Set(["Project", "Invoice", "Collection", "Adjustment"]));
    const docs = (await col(C.invoices).get()).docs.map((d) => d.data() as InvoiceDoc);
    expect(docs[0].collectionIds).toHaveLength(1);
    expect(((await col(C.adjustments).get()).docs[0].data() as AdjustmentDoc).status).toBe("PENDING");
  });
});
