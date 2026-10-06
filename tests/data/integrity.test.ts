import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import { saveCollectionAction, saveInvoiceAction } from "@/server/actions/billing";
import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { saveProjectAction } from "@/server/actions/projects";
import { verifyIntegrity } from "@/server/integrity";
import { validateMonth } from "@/server/services/months";
import { approveSettlement, calculateDraft, personKey, registerPayment } from "@/server/services/settlements";
import { bootstrapBase } from "@/store/bootstrap";
import { C, col, linesCol, peopleCol, ref, runTx, type CommitmentDoc, type InvoiceDoc, type PersonSettlementDoc, type SettlementLineDoc } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const U = "u1";
const OCT = "LIQ-2026-10";
const ok = (r: { ok: boolean; data?: { id: string } }) => { if (!r.ok || !r.data) throw new Error(JSON.stringify(r)); return r.data.id; };
const ids = {} as Record<string, string>;

/** Escenario liquidado y parcialmente pagado, para verificar que la revisión lo da por bueno y detecta alteraciones. */
async function liquidated() {
  await clearFirestore();
  await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
  const person = (fullName: string, email: string, policyId: string) => saveCollaboratorAction(null, { fullName, email, position: "Analista", status: "ACTIVE", policyId, joinDate: "", notes: "" });
  ids.ana = ok(await person("Ana", "a@t.co", "GENERAL"));
  ids.nic = ok(await person("Nicholle Torres", "n@t.co", "GAMIFICATION"));
  ok(await saveProjectAction(null, {
    code: "S-001", name: "Proyecto S", client: "Cliente S", country: "CO", saleDate: "2026-01-10", currency: "COP", saleAmount: "468000000", providerCosts: "0",
    expectedInvoices: "2", notes: "", assignments: [{ collaboratorId: ids.ana, ratePercent: "1" }, { collaboratorId: ids.nic, ratePercent: "1" }],
  } as Parameters<typeof saveProjectAction>[1]));
  ids.invoice = ok(await saveInvoiceAction(null, { projectId: "S-001", number: "FE-S1", status: "ISSUED", issueDate: "2026-02-01", dueDate: "", amountPreTax: "100000000", netBaseExplicit: "", notes: "" } as Parameters<typeof saveInvoiceAction>[1]));
  ids.collection = ok(await saveCollectionAction(null, { invoiceId: ids.invoice, date: "2026-05-10", amountReceived: "100000000", isOverpaymentAdjustment: false, notes: "" } as Parameters<typeof saveCollectionAction>[1]));
  await runTx((tx) => validateMonth(tx, "2026-01", U, "2026-03-01"));
  await runTx((tx) => calculateDraft(tx, 2026, "OCTOBER", U));
  await approveSettlement(OCT, U, []);
  await runTx((tx) => registerPayment(tx, personKey(OCT, ids.nic), { paidAt: "2026-10-05", amount: "500000", reference: "TRX-1" }, U));
}

const messages = async () => (await verifyIntegrity()).problems.map((p) => p.message);

suite("verificación de integridad", () => {
  beforeEach(liquidated);

  it("un escenario consistente no tiene problemas", async () => {
    const r = await verifyIntegrity();
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.checked).toMatchObject({ projects: 1, invoices: 1, settlements: 1, lines: 2, commitments: 2 });
  });

  it("detecta un recaudo liquidado que fue alterado por fuera de la aplicación", async () => {
    const inv = (await ref(C.invoices, ids.invoice).get()).data() as InvoiceDoc;
    await ref(C.invoices, ids.invoice).set({ ...inv, collections: inv.collections.map((c) => ({ ...c, amountReceived: "90000000" })) });
    expect((await messages()).join("\n")).toMatch(/cambió de valor/);
  });

  it("detecta un recaudo liquidado que fue anulado", async () => {
    const inv = (await ref(C.invoices, ids.invoice).get()).data() as InvoiceDoc;
    await ref(C.invoices, ids.invoice).set({ ...inv, collections: inv.collections.map((c) => ({ ...c, voidedAt: "2026-10-06T00:00:00Z" })) });
    expect((await messages()).join("\n")).toMatch(/fue anulado/);
  });

  it("detecta una línea sin su compromiso anti pago doble", async () => {
    const c = (await col(C.commitments).get()).docs[0];
    await c.ref.delete();
    expect((await messages()).join("\n")).toMatch(/no tiene su compromiso/);
  });

  it("detecta un compromiso huérfano", async () => {
    await ref(C.commitments, "x__y").set({ id: "x__y", type: "COLLECTION", collectionId: "x", adjustmentId: null, assignmentId: "y", invoiceId: null, projectId: "S-001", collaboratorId: ids.ana, settlementCode: OCT, lineId: "x__y", commissionCOP: "1", committedAt: "t" } satisfies CommitmentDoc);
    expect((await messages()).join("\n")).toMatch(/No tiene línea/);
  });

  it("detecta una línea cuya comisión fue modificada (totales y compromiso ya no cuadran)", async () => {
    const line = (await linesCol(OCT).get()).docs[0];
    await line.ref.update({ commissionCOP: "999" });
    const text = (await messages()).join("\n");
    expect(text).toMatch(/no coincide con la suma de sus líneas/);
    expect(text).toMatch(/distinta comisión/);
  });

  it("detecta pagos que superan el neto y estados de pago incorrectos", async () => {
    const p = (await peopleCol(OCT).doc(ids.nic).get()).data() as PersonSettlementDoc;
    await peopleCol(OCT).doc(ids.nic).set({ ...p, payments: [...p.payments, { ...p.payments[0], id: "extra", reference: "TRX-2", amount: "5000000" }] });
    const text = (await messages()).join("\n");
    expect(text).toMatch(/superan el neto a pagar/);
    expect(text).toMatch(/estado de pago/);
  });

  it("detecta una línea de borrador marcada como liquidada y un cierre sin completar", async () => {
    const line = (await linesCol(OCT).get()).docs[0].data() as SettlementLineDoc;
    await ref(C.settlements, OCT).update({ status: "DRAFT" });
    await ref(C.system, "state").set({ id: "state", closing: { settlementCode: OCT, closingId: "c", startedAt: "t" }, updatedAt: "t" });
    const text = (await messages()).join("\n");
    expect(text).toMatch(/borrador tiene líneas marcadas/);
    expect(text).toMatch(/cierre por lotes sin completar/);
    expect(line.committed).toBe(true);
  });

  it("detecta índices derivados desactualizados en proyectos y facturas", async () => {
    await ref(C.projects, "S-001").update({ collaboratorIds: [] });
    await ref(C.invoices, ids.invoice).update({ collectionIds: [] });
    const text = (await messages()).join("\n");
    expect(text).toMatch(/índice de colaboradores activos/);
    expect(text).toMatch(/índice de recaudos/);
  });
});
