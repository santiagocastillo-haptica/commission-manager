import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import { saveCollectionAction, saveInvoiceAction } from "@/server/actions/billing";
import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { saveProjectAction } from "@/server/actions/projects";
import { addProjectPersonAction, setRateExceptionAction } from "@/server/actions/settlements";
import { getSettlementView, projectTable, salesSweep, splitEarnings } from "@/server/queries/settlements";
import { PDFDocument } from "pdf-lib";
import { renderAdministrativePdf } from "@/reports/pdf/administrative";
import { bonusLines, bonusTotal, renderBonusLetterPdf } from "@/reports/pdf/bonus-letter";
import { renderCompletePdf } from "@/reports/pdf/complete";
import { hasNaturalReport, naturalCollab, renderIndividualPdf } from "@/reports/pdf/individual";
import { getReportData } from "@/server/queries/settlements";
import { validateMonth } from "@/server/services/months";
import { approveSettlement, calculateDraft } from "@/server/services/settlements";
import { bootstrapBase } from "@/store/bootstrap";
import { C, ref, runTx, type ProjectDoc } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const U = "u1";
const id = (r: { ok: boolean; data?: { id: string } }) => {
  if (!r.ok || !r.data) throw new Error(JSON.stringify(r));
  return r.data.id;
};

suite("barrido de ventas del período y bonificación", () => {
  let asgId = "";
  beforeEach(async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
    await ref(C.users, U).set({ id: U, email: "t@t.co", name: "Tester", role: "ADMIN", passwordHash: "x", createdAt: "x", updatedAt: "x" });
    const ana = id(await saveCollaboratorAction(null, { fullName: "Ana", email: "a@t.co", position: "Analista", status: "ACTIVE", policyId: "GENERAL", joinDate: "", notes: "" }));
    // venta de 100M: el mes no llega a la meta de 390M
    id(await saveProjectAction(null, { code: "P-001", client: "Cliente SA", country: "CO", saleDate: "2026-05-10", currency: "COP", saleAmount: "100000000", providerCosts: "0", expectedInvoices: "1", notes: "", assignments: [{ collaboratorId: ana, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]));
    const inv = id(await saveInvoiceAction(null, { projectId: "P-001", number: "FV1", status: "ISSUED", issueDate: "2026-06-01", dueDate: "", amountPreTax: "100000000", netBaseExplicit: "", notes: "" } as Parameters<typeof saveInvoiceAction>[1]));
    id(await saveCollectionAction(null, { invoiceId: inv, date: "2026-07-10", amountReceived: "100000000", isOverpaymentAdjustment: false, notes: "" } as Parameters<typeof saveCollectionAction>[1]));
    await runTx((tx) => validateMonth(tx, "2026-05", U, "2026-06-15"));
    asgId = ((await ref(C.projects, "P-001").get()).data() as ProjectDoc).assignments[0].id;
  });

  it("el barrido muestra el proyecto que no cumplió la meta sin comisión; con bonificación del 0,5 % comisiona sobre lo recaudado", async () => {
    // un proyecto de un período anterior con un recaudo en este: no aparece en la tabla del período
    const ana = ((await ref(C.projects, "P-001").get()).data() as ProjectDoc).assignments[0].collaboratorId;
    id(await saveProjectAction(null, { code: "P-OLD", client: "Cliente SA", country: "CO", saleDate: "2026-01-10", currency: "COP", saleAmount: "10000000", providerCosts: "0", expectedInvoices: "1", notes: "", assignments: [{ collaboratorId: ana, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]));
    const oldInv = id(await saveInvoiceAction(null, { projectId: "P-OLD", number: "FV0", status: "ISSUED", issueDate: "2026-02-01", dueDate: "", amountPreTax: "10000000", netBaseExplicit: "", notes: "" } as Parameters<typeof saveInvoiceAction>[1]));
    id(await saveCollectionAction(null, { invoiceId: oldInv, date: "2026-08-10", amountReceived: "10000000", isOverpaymentAdjustment: false, notes: "" } as Parameters<typeof saveCollectionAction>[1]));
    await runTx((tx) => validateMonth(tx, "2026-01", U, "2026-06-15"));
    let view = await getSettlementView(2026, "OCTOBER");
    const only = await projectTable(view);
    expect(only.map((r) => [r.projectCode, r.monthOutcome])).toEqual([["P-001", "NOT_ELIGIBLE"]]);
    let sweep = await salesSweep(view);
    expect(sweep).toHaveLength(1);
    expect(sweep[0].rows[0]).toMatchObject({ projectCode: "P-001", monthOutcome: "NOT_ELIGIBLE", effectiveRate: "0", collectedCOP: "100000000", commissionHereCOP: "0", bonusReason: null });

    const r = await setRateExceptionAction({ projectCode: "P-001", assignmentId: asgId, ratePercent: "0.5", reason: "Gran trabajo comercial", kind: "BONUS" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message).toMatch(/Bonificación guardada/);
    view = await getSettlementView(2026, "OCTOBER");
    sweep = await salesSweep(view);
    expect(sweep[0].rows[0]).toMatchObject({ effectiveRate: "0.005", bonusReason: "Gran trabajo comercial", commissionHereCOP: "500000", manualException: false }); // 100M × 0,5 %

    // el desglose de la revisión separa comisión y bonificación (también en el borrador)
    const split = splitEarnings(view.collaborators.flatMap((c) => c.lines));
    expect(split).toMatchObject({ commission: "0", bonus: "500000", adjustments: "0", hasBonus: true });

    // quitar la bonificación devuelve el proyecto a 0 %; se vuelve a dar para aprobarla
    expect((await setRateExceptionAction({ projectCode: "P-001", assignmentId: asgId, ratePercent: null, reason: "", kind: "BONUS" })).ok).toBe(true);
    sweep = await salesSweep(await getSettlementView(2026, "OCTOBER"));
    expect(sweep[0].rows[0]).toMatchObject({ effectiveRate: "0", bonusReason: null, commissionHereCOP: "0" });
    expect((await setRateExceptionAction({ projectCode: "P-001", assignmentId: asgId, ratePercent: "0.5", reason: "Gran trabajo comercial", kind: "BONUS" })).ok).toBe(true);

    // aprobada: la bonificación va en su carta y no en el reporte de comisiones
    await runTx((tx) => calculateDraft(tx, 2026, "OCTOBER", U));
    await approveSettlement("LIQ-2026-10", U, []);
    const data = (await getReportData("LIQ-2026-10"))!;
    const collab = data.collaborators[0];
    expect(bonusLines(collab)).toHaveLength(1);
    expect(bonusTotal(collab).toFixed()).toBe("500000");
    expect(hasNaturalReport(collab)).toBe(false);
    expect(naturalCollab(collab)).toMatchObject({ lines: [], gross: "0", netPayable: "0" });
    const letter = await renderBonusLetterPdf(data, collab);
    expect(letter.subarray(0, 4).toString()).toBe("%PDF");
    expect((await renderIndividualPdf(data, collab)).subarray(0, 4).toString()).toBe("%PDF");

    // un solo PDF con portada + administrativo + carta de bonificación
    const full = await renderCompletePdf(data);
    expect(full.subarray(0, 4).toString()).toBe("%PDF");
    const pages = async (b: Buffer) => (await PDFDocument.load(b)).getPageCount();
    expect(await pages(full)).toBe(1 + (await pages(await renderAdministrativePdf(data))) + (await pages(letter)));
  });
});

suite("agregar a otra persona desde la liquidación", () => {
  it("suma a alguien a un proyecto de un mes validado con su porcentaje efectivo y lo muestra en la tabla", async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
    await ref(C.users, U).set({ id: U, email: "t@t.co", name: "Tester", role: "ADMIN", passwordHash: "x", createdAt: "x", updatedAt: "x" });
    const person = async (n: string, e: string, policyId: string) => id(await saveCollaboratorAction(null, { fullName: n, email: e, position: "Analista", status: "ACTIVE", policyId, joinDate: "", notes: "" }));
    const ana = await person("Ana", "a@t.co", "GENERAL");
    const luis = await person("Luis", "l@t.co", "GENERAL");
    const nic = await person("Nicholle", "n@t.co", "GAMIFICATION");
    id(await saveProjectAction(null, { code: "P-001", client: "Cliente SA", country: "CO", saleDate: "2026-05-10", currency: "COP", saleAmount: "468000000", providerCosts: "0", expectedInvoices: "1", notes: "", assignments: [{ collaboratorId: ana, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]));
    const inv = id(await saveInvoiceAction(null, { projectId: "P-001", number: "FV1", status: "ISSUED", issueDate: "2026-06-01", dueDate: "", amountPreTax: "100000000", netBaseExplicit: "", notes: "" } as Parameters<typeof saveInvoiceAction>[1]));
    id(await saveCollectionAction(null, { invoiceId: inv, date: "2026-07-10", amountReceived: "100000000", isOverpaymentAdjustment: false, notes: "" } as Parameters<typeof saveCollectionAction>[1]));
    await runTx((tx) => validateMonth(tx, "2026-05", U, "2026-06-15")); // 468M ≥ 390M: elegible

    const add = (collaboratorId: string, ratePercent = "1", reason = "Participó en la venta con el cliente") => addProjectPersonAction({ projectCode: "P-001", collaboratorId, ratePercent, reason });
    expect((await add(luis, "1", "corto")).ok).toBe(false);
    expect((await add(ana)).ok).toBe(false); // ya comisiona
    expect((await add(nic, "0.5")).ok).toBe(false); // gamificación exige 1 %
    expect((await add(luis, "0.6")).ok).toBe(true);

    const p = (await ref(C.projects, "P-001").get()).data() as ProjectDoc;
    expect(p.collaboratorIds).toContain(luis);
    expect(p.assignments.find((a) => a.collaboratorId === luis)).toMatchObject({ baseRate: "0.006", effectiveRate: "0.006", removedAt: null });

    const view = await getSettlementView(2026, "OCTOBER");
    expect(view.collaborators.find((c) => c.name === "Luis")?.gross).toBe("600000"); // 100M × 0,6 %
    const table = await projectTable(view);
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({ projectCode: "P-001", monthOutcome: "ELIGIBLE", saleAmount: "468000000", invoiced: "100000000", collected: "100000000" });
    expect(table[0].reported.map((x) => x.name)).toEqual(["Ana"]); // solo la del reporte de venta
    expect(table[0].people.map((x) => x.name).sort()).toEqual(["Ana", "Luis"]);
    expect(table[0].people.find((x) => x.name === "Luis")?.addedLater).toBe(true);
    expect(table[0].candidates.map((c) => c.name)).toEqual(["Nicholle"]);
    expect(table[0].invoices[0]).toMatchObject({ number: "FV1", collected: "100000000" });
  });
});
