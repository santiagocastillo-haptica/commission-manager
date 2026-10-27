import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import { saveCollectionAction, saveInvoiceAction, swapProjectBillingAction } from "@/server/actions/billing";
import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { saveProjectAction } from "@/server/actions/projects";
import { getSettlementView } from "@/server/queries/settlements";
import { validateMonth } from "@/server/services/months";
import { approveSettlement, calculateDraft, registerPayment, reopenSettlement } from "@/server/services/settlements";
import { bootstrapBase } from "@/store/bootstrap";
import { C, col, encodeKey, ref, runTx, type InvoiceDoc } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const id = (r: { ok: boolean; data?: { id: string } }) => {
  if (!r.ok || !r.data) throw new Error(JSON.stringify(r));
  return r.data.id;
};

suite("intercambiar las facturas de dos proyectos", () => {
  let ana = "";
  let luis = "";
  const project = (code: string, collaboratorId: string, sale = "468000000", currency = "COP", date = "2026-05-10") =>
    saveProjectAction(null, { code, client: `Cliente ${code}`, country: "CO", saleDate: date, currency, saleAmount: sale, providerCosts: "0", expectedInvoices: "1", notes: "", ...(currency === "COP" ? {} : { saleReferenceRate: "4000" }), assignments: [{ collaboratorId, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]);
  const invoice = async (projectId: string, number: string, amount: string, collected?: string) => {
    const inv = id(await saveInvoiceAction(null, { projectId, number, status: "ISSUED", issueDate: "2026-06-01", dueDate: "", amountPreTax: amount, netBaseExplicit: "", notes: "" } as Parameters<typeof saveInvoiceAction>[1]));
    if (collected) id(await saveCollectionAction(null, { invoiceId: inv, date: "2026-07-10", amountReceived: collected, isOverpaymentAdjustment: false, notes: "" } as Parameters<typeof saveCollectionAction>[1]));
    return inv;
  };
  const owner = async (p: string) => (await col(C.invoices).where("projectId", "==", p).get()).docs.map((d) => (d.data() as InvoiceDoc).number).sort();

  beforeEach(async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
    await ref(C.users, "u1").set({ id: "u1", email: "t@t.co", name: "Tester", role: "ADMIN", passwordHash: "x", createdAt: "x", updatedAt: "x" });
    const person = async (n: string, e: string) => id(await saveCollaboratorAction(null, { fullName: n, email: e, position: "Analista", status: "ACTIVE", policyId: "GENERAL", joinDate: "", notes: "" }));
    ana = await person("Ana", "a@t.co");
    luis = await person("Luis", "l@t.co");
    id(await project("SPRC-06", ana));
    id(await project("SPRC-07", luis));
    await invoice("SPRC-06", "FV1", "100000000", "100000000");
    await invoice("SPRC-06", "FV2", "50000000");
    await invoice("SPRC-07", "FV3", "80000000", "80000000");
    await runTx((tx) => validateMonth(tx, "2026-05", "u1", "2026-06-15"));
  });

  it("intercambia facturas, recaudos y números únicos; las comisiones pasan a las personas del otro proyecto", async () => {
    let view = await getSettlementView(2026, "OCTOBER");
    expect(view.collaborators.map((c) => [c.name, c.gross])).toEqual([["Ana", "1000000"], ["Luis", "800000"]]);

    const r = await swapProjectBillingAction({ projectA: "SPRC-06", projectB: "SPRC-07", reason: "Se cargaron en el proyecto equivocado" });
    expect(r.ok).toBe(true);
    expect(await owner("SPRC-06")).toEqual(["FV3"]);
    expect(await owner("SPRC-07")).toEqual(["FV1", "FV2"]);
    // la clave de unicidad se trasladó con la factura: ya no se puede repetir el número en el proyecto nuevo
    expect((await ref(C.uniques, encodeKey("invoice:SPRC-07:FV1")).get()).exists).toBe(true);
    expect((await ref(C.uniques, encodeKey("invoice:SPRC-06:FV1")).get()).exists).toBe(false);
    expect((await saveInvoiceAction(null, { projectId: "SPRC-07", number: "FV1", status: "ISSUED", issueDate: "2026-06-01", dueDate: "", amountPreTax: "1000", netBaseExplicit: "", notes: "" } as Parameters<typeof saveInvoiceAction>[1])).ok).toBe(false);

    view = await getSettlementView(2026, "OCTOBER");
    expect(view.collaborators.map((c) => [c.name, c.gross])).toEqual([["Ana", "800000"], ["Luis", "1000000"]]);
  });

  it("exige motivo, proyectos distintos y misma moneda, y no mueve nada si alguno ya tiene comisiones liquidadas", async () => {
    expect((await swapProjectBillingAction({ projectA: "SPRC-06", projectB: "SPRC-07", reason: "corto" })).ok).toBe(false);
    expect((await swapProjectBillingAction({ projectA: "SPRC-06", projectB: "SPRC-06", reason: "Motivo suficiente aquí" })).ok).toBe(false);
    id(await project("USD-01", ana, "100000", "USD", "2026-06-10"));
    expect((await swapProjectBillingAction({ projectA: "SPRC-06", projectB: "USD-01", reason: "Motivo suficiente aquí" })).ok).toBe(false);

    await runTx((tx) => calculateDraft(tx, 2026, "OCTOBER", "u1"));
    await approveSettlement("LIQ-2026-10", "u1", []);
    const r = await swapProjectBillingAction({ projectA: "SPRC-06", projectB: "SPRC-07", reason: "Motivo suficiente aquí" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/comisiones liquidadas/);
    expect(await owner("SPRC-06")).toEqual(["FV1", "FV2"]);
  });

  it("no cabe si las facturas superan la venta del otro proyecto", async () => {
    id(await project("CHICO-01", ana, "120000000", "COP", "2026-06-10"));
    const r = await swapProjectBillingAction({ projectA: "SPRC-06", projectB: "CHICO-01", reason: "Motivo suficiente aquí" });
    expect(r.ok).toBe(false); // las facturas de SPRC-06 suman 150M y CHICO-01 solo vende 120M
    if (!r.ok) expect(r.error).toMatch(/superan el valor de la venta/);
    expect(await owner("SPRC-06")).toEqual(["FV1", "FV2"]);
  });

  it("una liquidación aprobada se puede reabrir (sin pagos), corregir con el intercambio y aprobar de nuevo", async () => {
    await runTx((tx) => calculateDraft(tx, 2026, "OCTOBER", "u1"));
    await approveSettlement("LIQ-2026-10", "u1", []);
    expect((await swapProjectBillingAction({ projectA: "SPRC-06", projectB: "SPRC-07", reason: "Motivo suficiente aquí" })).ok).toBe(false);

    await expect(runTx((tx) => reopenSettlement(tx, "LIQ-2026-10", "corto", "u1"))).rejects.toThrow(/motivo/);
    await runTx((tx) => reopenSettlement(tx, "LIQ-2026-10", "Facturas cargadas en el proyecto equivocado", "u1"));
    expect((await ref(C.settlements, "LIQ-2026-10").get()).exists).toBe(false);
    expect((await col(C.commitments).get()).size).toBe(0);
    expect((await getSettlementView(2026, "OCTOBER")).status).toBe("NONE");

    expect((await swapProjectBillingAction({ projectA: "SPRC-06", projectB: "SPRC-07", reason: "Se cargaron en el proyecto equivocado" })).ok).toBe(true);
    await runTx((tx) => calculateDraft(tx, 2026, "OCTOBER", "u1"));
    await approveSettlement("LIQ-2026-10", "u1", []);
    const view = await getSettlementView(2026, "OCTOBER");
    expect(view.status).toBe("APPROVED");
    expect(view.collaborators.map((c) => [c.name, c.gross])).toEqual([["Ana", "800000"], ["Luis", "1000000"]]);
  });

  it("no se reabre si ya hay pagos registrados", async () => {
    await runTx((tx) => calculateDraft(tx, 2026, "OCTOBER", "u1"));
    await approveSettlement("LIQ-2026-10", "u1", []);
    const key = (await getSettlementView(2026, "OCTOBER")).collaborators[0].csId!;
    await runTx((tx) => registerPayment(tx, key, { paidAt: "2026-10-15", amount: "1000", reference: "REF-1" }, "u1"));
    await expect(runTx((tx) => reopenSettlement(tx, "LIQ-2026-10", "Motivo suficiente aquí", "u1"))).rejects.toThrow(/pagos registrados/);
    expect((await getSettlementView(2026, "OCTOBER")).status).toBe("APPROVED");
  });
});
