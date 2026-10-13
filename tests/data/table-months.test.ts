import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { saveProjectAction } from "@/server/actions/projects";
import { setProjectReviewAction } from "@/server/actions/settlements";
import { revalidateMonthAction } from "@/server/actions/settings";
import { getSettlementView, projectTable, salesSweep } from "@/server/queries/settlements";
import { validateMonth } from "@/server/services/months";
import { bootstrapBase } from "@/store/bootstrap";
import { C, ref, runTx, type ProjectDoc } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const id = (r: { ok: boolean; data?: { id: string } }) => {
  if (!r.ok || !r.data) throw new Error(JSON.stringify(r));
  return r.data.id;
};

suite("tabla de proyectos del período: todos los meses, cumplan o no la meta, validados o no", () => {
  beforeEach(async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
    await ref(C.users, "u1").set({ id: "u1", email: "t@t.co", name: "Tester", role: "ADMIN", passwordHash: "x", createdAt: "x", updatedAt: "x" });
  });

  it("incluye los proyectos de abril a septiembre sin importar el resultado de la meta", async () => {
    const ana = id(await saveCollaboratorAction(null, { fullName: "Ana", email: "a@t.co", position: "Analista", status: "ACTIVE", policyId: "GENERAL", joinDate: "", notes: "" }));
    const sale = (code: string, date: string, amount: string) => saveProjectAction(null, { code, client: "Cliente SA", country: "CO", saleDate: date, currency: "COP", saleAmount: amount, providerCosts: "0", expectedInvoices: "1", notes: "", assignments: [{ collaboratorId: ana, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]);
    id(await sale("P-ABR", "2026-04-15", "500000000")); // abril cumple
    id(await sale("P-JUL", "2026-07-10", "100000000")); // julio no cumple
    id(await sale("P-AGO", "2026-08-20", "100000000")); // agosto sin validar
    id(await sale("P-SEP", "2026-09-30", "100000000"));
    id(await sale("P-MAR", "2026-03-31", "100000000")); // fuera del período
    id(await sale("P-OCT", "2026-10-01", "100000000")); // fuera del período
    await runTx((tx) => validateMonth(tx, "2026-04", "u1", "2026-10-13"));
    await runTx((tx) => validateMonth(tx, "2026-07", "u1", "2026-10-13"));

    const view = await getSettlementView(2026, "OCTOBER");
    const table = await projectTable(view);
    expect(table.map((r) => [r.projectCode, r.monthOutcome])).toEqual([["P-ABR", "ELIGIBLE"], ["P-JUL", "NOT_ELIGIBLE"], ["P-AGO", "PENDING"], ["P-SEP", "PENDING"]]);
    expect((await salesSweep(view))[0].rows.map((r) => r.projectCode)).toEqual(["P-ABR", "P-JUL", "P-AGO", "P-SEP"]);
  });
});

suite("revisión por proyecto: también los proyectos del período sin comisión", () => {
  it("lista un proyecto de un mes que no cumplió la meta, con su semáforo, y permite aceptarlo", async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
    await ref(C.users, "u1").set({ id: "u1", email: "t@t.co", name: "Tester", role: "ADMIN", passwordHash: "x", createdAt: "x", updatedAt: "x" });
    const ana = id(await saveCollaboratorAction(null, { fullName: "Ana", email: "a@t.co", position: "Analista", status: "ACTIVE", policyId: "GENERAL", joinDate: "", notes: "" }));
    id(await saveProjectAction(null, { code: "AVAL-01", client: "Cliente SA", country: "CO", saleDate: "2026-07-22", currency: "COP", saleAmount: "100000000", providerCosts: "0", expectedInvoices: "1", notes: "", assignments: [{ collaboratorId: ana, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]));
    await runTx((tx) => validateMonth(tx, "2026-07", "u1", "2026-10-13"));
    const view = await getSettlementView(2026, "OCTOBER");
    expect(view.projects.map((p) => [p.projectCode, p.monthOutcome, p.lines.length, p.people])).toEqual([["AVAL-01", "NOT_ELIGIBLE", 0, ["Ana"]]]);
    expect((await setProjectReviewAction({ code: "LIQ-2026-10", projectCode: "AVAL-01", accepted: true })).ok).toBe(true);
    expect((await getSettlementView(2026, "OCTOBER")).projects[0].review).toBe("ACCEPTED");
  });
});

suite("revalidar un mes con la regla del 98 %", () => {
  it("corrige un mes validado antes de la regla, conserva las excepciones y respeta los meses con comisiones liquidadas", async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
    await ref(C.users, "u1").set({ id: "u1", email: "t@t.co", name: "Tester", role: "ADMIN", passwordHash: "x", createdAt: "x", updatedAt: "x" });
    const person = async (n: string, e: string, policyId: string) => id(await saveCollaboratorAction(null, { fullName: n, email: e, position: "Analista", status: "ACTIVE", policyId, joinDate: "", notes: "" }));
    const nic = await person("Nicholle", "n@t.co", "GAMIFICATION");
    const ana = await person("Ana", "a@t.co", "GENERAL");
    id(await saveProjectAction(null, { code: "JUL-01", client: "Cliente SA", country: "CO", saleDate: "2026-07-22", currency: "COP", saleAmount: "385000000", providerCosts: "0", expectedInvoices: "1", notes: "", assignments: [{ collaboratorId: nic, ratePercent: "1" }, { collaboratorId: ana, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]));
    await runTx((tx) => validateMonth(tx, "2026-07", "u1", "2026-10-13"));
    const get = async () => (await ref(C.projects, "JUL-01").get()).data() as ProjectDoc;
    // 385M es el 98,7 % de la meta: ya sale elegible con la regla; se simula el estado de antes de la regla
    const p = await get();
    await ref(C.projects, "JUL-01").set({
      ...p,
      assignments: p.assignments.map((a) => (a.collaboratorId === nic ? { ...a, effectiveRate: "0.005" } : { ...a, effectiveRate: "0.02", exception: { kind: "BONUS", reason: "Gran trabajo comercial", at: "x", byId: "u1", previousRate: "0", previousRule: null } })),
    });
    await ref(C.monthlySales, "2026-07").update({ outcome: "NOT_ELIGIBLE" });

    expect((await revalidateMonthAction({ yearMonth: "2026-07" })).ok).toBe(true);
    const after = await get();
    expect(after.assignments.find((a) => a.collaboratorId === nic)?.effectiveRate).toBe("0.01"); // gamificación: 98 % cuenta como 100 %
    expect(after.assignments.find((a) => a.collaboratorId === ana)).toMatchObject({ effectiveRate: "0.02", exception: { kind: "BONUS" } }); // la bonificación se conserva
    expect(((await ref(C.monthlySales, "2026-07").get()).data() as { outcome: string }).outcome).toBe("ELIGIBLE");
    expect((await revalidateMonthAction({ yearMonth: "2026-06" })).ok).toBe(false); // mes sin validar
  });
});
