import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { saveProjectAction } from "@/server/actions/projects";
import { getSettlementView, projectTable, salesSweep } from "@/server/queries/settlements";
import { validateMonth } from "@/server/services/months";
import { bootstrapBase } from "@/store/bootstrap";
import { C, ref, runTx } from "@/store";
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
