import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import { saveCollectionAction, saveInvoiceAction } from "@/server/actions/billing";
import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { saveProjectAction } from "@/server/actions/projects";
import { setProjectReviewAction } from "@/server/actions/settlements";
import { getSettlementView } from "@/server/queries/settlements";
import { validateMonth } from "@/server/services/months";
import { approveSettlement, calculateDraft, discardDraft } from "@/server/services/settlements";
import { bootstrapBase } from "@/store/bootstrap";
import { C, ref, runTx, type AuditDoc } from "@/store";
import { col } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const U = "u1";
const OCT = "LIQ-2026-10";
const id = (r: { ok: boolean; data?: { id: string } }) => {
  if (!r.ok || !r.data) throw new Error(JSON.stringify(r));
  return r.data.id;
};
const view = () => getSettlementView(2026, "OCTOBER");
const state = async (code: string) => (await view()).projects.find((p) => p.projectCode === code)?.review;

async function project(code: string, date: string, invoiceNumber: string, collaboratorId: string) {
  id(await saveProjectAction(null, { code, client: "Cliente SA", country: "CO", saleDate: date, currency: "COP", saleAmount: "468000000", providerCosts: "0", expectedInvoices: "2", notes: "", assignments: [{ collaboratorId, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]));
  const inv = id(await saveInvoiceAction(null, { projectId: code, number: invoiceNumber, status: "ISSUED", issueDate: "2026-02-01", dueDate: "", amountPreTax: "100000000", netBaseExplicit: "", notes: "" } as Parameters<typeof saveInvoiceAction>[1]));
  id(await saveCollectionAction(null, { invoiceId: inv, date: "2026-05-10", amountReceived: "60000000", isOverpaymentAdjustment: false, notes: "" } as Parameters<typeof saveCollectionAction>[1]));
  return inv;
}

suite("revisión por proyecto de una liquidación", () => {
  let invoiceA = "";
  beforeEach(async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
    await ref(C.users, U).set({ id: U, email: "t@t.co", name: "Tester", role: "ADMIN", passwordHash: "x", createdAt: "x", updatedAt: "x" });
    const ana = id(await saveCollaboratorAction(null, { fullName: "Ana", email: "a@t.co", position: "Analista", status: "ACTIVE", policyId: "GENERAL", joinDate: "", notes: "" }));
    invoiceA = await project("P-001", "2026-01-10", "FV1", ana);
    await project("P-002", "2026-01-12", "FV2", ana);
    await runTx((tx) => validateMonth(tx, "2026-01", U, "2026-03-01"));
    await runTx((tx) => calculateDraft(tx, 2026, "OCTOBER", U));
  });

  it("la vista agrupa por proyecto y todos empiezan pendientes", async () => {
    const v = await view();
    expect(v.projects.map((p) => [p.projectCode, p.review, p.lines.length])).toEqual([["P-001", "PENDING", 1], ["P-002", "PENDING", 1]]);
    expect(v.projects[0]).toMatchObject({ total: "600000", people: ["Ana"] }); // 60M × 1 %
    expect(v.projects[0].fingerprint).toBe("1|60000000.00|600000.00");
  });

  it("acepta y desmarca un proyecto, y lo deja en la bitácora", async () => {
    expect((await setProjectReviewAction({ code: OCT, projectCode: "P-001", accepted: true })).ok).toBe(true);
    expect(await state("P-001")).toBe("ACCEPTED");
    expect(await state("P-002")).toBe("PENDING");
    const v = await view();
    expect(v.projects[0]).toMatchObject({ acceptedBy: "Tester" });
    expect((await setProjectReviewAction({ code: OCT, projectCode: "P-001", accepted: false })).ok).toBe(true);
    expect(await state("P-001")).toBe("PENDING");
    const audits = (await col(C.auditLog).get()).docs.map((d) => d.data() as AuditDoc).filter((a) => a.entity === "SettlementReview");
    expect(audits.map((a) => a.action).sort()).toEqual(["ACCEPT", "UNACCEPT"]);
  });

  it("si los datos del proyecto cambian, la aceptación deja de valer (queda «cambió»)", async () => {
    await setProjectReviewAction({ code: OCT, projectCode: "P-001", accepted: true });
    id(await saveCollectionAction(null, { invoiceId: invoiceA, date: "2026-06-01", amountReceived: "10000000", isOverpaymentAdjustment: false, notes: "" } as Parameters<typeof saveCollectionAction>[1]));
    expect(await state("P-001")).toBe("STALE");
    expect(await state("P-002")).toBe("PENDING");
    // volver a aceptarlo con los datos nuevos lo deja vigente
    await setProjectReviewAction({ code: OCT, projectCode: "P-001", accepted: true });
    expect(await state("P-001")).toBe("ACCEPTED");
  });

  it("rechaza proyectos sin líneas y liquidaciones inexistentes o con código inválido", async () => {
    expect((await setProjectReviewAction({ code: OCT, projectCode: "NO-EXISTE", accepted: true })).ok).toBe(false);
    expect((await setProjectReviewAction({ code: "LIQ-XXXX", projectCode: "P-001", accepted: true })).ok).toBe(false);
  });

  it("al aprobar, la revisión queda registrada y ya no se modifica; descartar un borrador la elimina", async () => {
    await setProjectReviewAction({ code: OCT, projectCode: "P-001", accepted: true });
    await setProjectReviewAction({ code: OCT, projectCode: "P-002", accepted: true });
    await approveSettlement(OCT, U, []);
    const v = await view();
    expect(v.status).toBe("APPROVED");
    expect(v.projects.map((p) => p.review)).toEqual(["ACCEPTED", "ACCEPTED"]);
    const blocked = await setProjectReviewAction({ code: OCT, projectCode: "P-001", accepted: false });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/ya está aprobada/);

    // borrador distinto: se descarta y la revisión desaparece
    await runTx((tx) => calculateDraft(tx, 2027, "APRIL", U));
    await runTx((tx) => discardDraft(tx, "LIQ-2027-04", U));
    expect((await ref(C.settlementReviews, "LIQ-2027-04").get()).exists).toBe(false);
  });
});
