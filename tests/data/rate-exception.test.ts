import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import { saveCollectionAction, saveInvoiceAction } from "@/server/actions/billing";
import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { saveProjectAction } from "@/server/actions/projects";
import { setRateExceptionAction } from "@/server/actions/settlements";
import { getSettlementView } from "@/server/queries/settlements";
import { reopenMonth, validateMonth } from "@/server/services/months";
import { approveSettlement, calculateDraft } from "@/server/services/settlements";
import { bootstrapBase } from "@/store/bootstrap";
import { C, col, ref, runTx, type AuditDoc, type ProjectDoc } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const U = "u1";
const OCT = "LIQ-2026-10";
const id = (r: { ok: boolean; data?: { id: string } }) => {
  if (!r.ok || !r.data) throw new Error(JSON.stringify(r));
  return r.data.id;
};
const asg = async () => ((await ref(C.projects, "P-001").get()).data() as ProjectDoc).assignments;
const exc = (assignmentId: string, ratePercent: string | null, reason = "Acuerdo comercial puntual con el cliente") => setRateExceptionAction({ projectCode: "P-001", assignmentId, ratePercent, reason });

suite("excepción manual del porcentaje de una persona en un proyecto", () => {
  let anaAsg = "";
  let luisAsg = "";
  beforeEach(async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
    await ref(C.users, U).set({ id: U, email: "t@t.co", name: "Tester", role: "ADMIN", passwordHash: "x", createdAt: "x", updatedAt: "x" });
    const person = async (n: string, e: string) => id(await saveCollaboratorAction(null, { fullName: n, email: e, position: "Analista", status: "ACTIVE", policyId: "GENERAL", joinDate: "", notes: "" }));
    const ana = await person("Ana", "a@t.co");
    const luis = await person("Luis", "l@t.co");
    id(await saveProjectAction(null, { code: "P-001", client: "Cliente SA", country: "CO", saleDate: "2026-01-10", currency: "COP", saleAmount: "468000000", providerCosts: "0", expectedInvoices: "2", notes: "", assignments: [{ collaboratorId: ana, ratePercent: "1" }, { collaboratorId: luis, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]));
    const inv = id(await saveInvoiceAction(null, { projectId: "P-001", number: "FV1", status: "ISSUED", issueDate: "2026-02-01", dueDate: "", amountPreTax: "100000000", netBaseExplicit: "", notes: "" } as Parameters<typeof saveInvoiceAction>[1]));
    id(await saveCollectionAction(null, { invoiceId: inv, date: "2026-05-10", amountReceived: "100000000", isOverpaymentAdjustment: false, notes: "" } as Parameters<typeof saveCollectionAction>[1]));
    await runTx((tx) => validateMonth(tx, "2026-01", U, "2026-03-01"));
    const a = await asg();
    anaAsg = a.find((x) => x.collaboratorId === ana)!.id;
    luisAsg = a.find((x) => x.collaboratorId === luis)!.id;
  });

  // Con 0 % no se genera línea: la persona no aparece en la liquidación.
  const commission = async (name: string) => (await getSettlementView(2026, "OCTOBER")).collaborators.find((c) => c.name === name)?.gross ?? "0";

  it("cambia el porcentaje (sin tope) y la comisión se recalcula solo para esa persona", async () => {
    expect(await commission("Ana")).toBe("1000000"); // 100M × 1 %
    expect((await exc(anaAsg, "0.5")).ok).toBe(true);
    expect(await commission("Ana")).toBe("500000");
    expect(await commission("Luis")).toBe("1000000"); // la otra persona no cambia
    expect((await exc(anaAsg, "2.5")).ok).toBe(true); // por encima del 1 % base: sin tope
    expect(await commission("Ana")).toBe("2500000");
    expect((await exc(anaAsg, "0")).ok).toBe(true);
    expect(await commission("Ana")).toBe("0");
    const a = (await asg()).find((x) => x.id === anaAsg)!;
    expect(a.baseRate).toBe("0.01"); // el % base no se toca
    expect(a.effectiveRateRule).toMatch(/Excepción manual/);
    expect(a.exception).toMatchObject({ reason: "Acuerdo comercial puntual con el cliente", previousRate: "0.01", byId: U });
  });

  it("quitar la excepción restaura lo calculado al validar el mes", async () => {
    await exc(anaAsg, "0.3");
    expect((await exc(anaAsg, null, "")).ok).toBe(true);
    const a = (await asg()).find((x) => x.id === anaAsg)!;
    expect(a).toMatchObject({ effectiveRate: "0.01", exception: null });
    expect(a.effectiveRateRule).toMatch(/Política general/);
    expect(await commission("Ana")).toBe("1000000");
    expect((await exc(anaAsg, null, "")).ok).toBe(false); // ya no hay excepción
  });

  it("exige motivo, un número válido, un mes validado y una asignación existente", async () => {
    expect((await exc(anaAsg, "0.5", "corto")).ok).toBe(false);
    expect((await exc(anaAsg, "abc")).ok).toBe(false);
    expect((await exc(anaAsg, "150")).ok).toBe(false);
    expect((await exc("no-existe", "0.5")).ok).toBe(false);
    expect((await setRateExceptionAction({ projectCode: "NOPE", assignmentId: anaAsg, ratePercent: "0.5", reason: "Motivo suficiente aquí" })).ok).toBe(false);
    // mes sin validar
    await runTx((tx) => reopenMonth(tx, "2026-01", "Reapertura de prueba para validar", U));
    const r = await exc(anaAsg, "0.5");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Valida primero el mes/);
  });

  it("reabrir el mes elimina las excepciones; cambiar el % base del proyecto también", async () => {
    await exc(anaAsg, "0.4");
    await runTx((tx) => reopenMonth(tx, "2026-01", "Reapertura de prueba para validar", U));
    expect((await asg()).every((x) => x.exception === null && x.effectiveRate === null)).toBe(true);
  });

  it("no se puede modificar una asignación con comisiones ya liquidadas", async () => {
    await runTx((tx) => calculateDraft(tx, 2026, "OCTOBER", U));
    await approveSettlement(OCT, U, []);
    const r = await exc(luisAsg, "0.2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ya tiene comisiones liquidadas/);
  });

  it("queda en la bitácora y la vista de la liquidación lo muestra con su motivo y autor", async () => {
    await exc(anaAsg, "0.5");
    const audits = (await col(C.auditLog).get()).docs.map((d) => d.data() as AuditDoc).filter((x) => x.action === "RATE_EXCEPTION");
    expect(audits).toHaveLength(1);
    expect(audits[0].summary).toMatch(/Excepción de porcentaje en P-001: 1,00 % → 0,50 %/);
    const project = (await getSettlementView(2026, "OCTOBER")).projects[0];
    const a = project.assignments.find((x) => x.assignmentId === anaAsg)!;
    expect(a).toMatchObject({ collaborator: "Ana", exceptionReason: "Acuerdo comercial puntual con el cliente", exceptionBy: "Tester" });
    expect(Number(a.effectiveRate)).toBeCloseTo(0.005, 6);
    expect(project.assignments.find((x) => x.assignmentId === luisAsg)!.exceptionReason).toBeNull();
  });
});
