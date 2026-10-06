import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { saveProjectAction } from "@/server/actions/projects";
import { deleteTierSetAction, saveTierSetAction } from "@/server/actions/settings";
import { validateMonth } from "@/server/services/months";
import { bootstrapBase } from "@/store/bootstrap";
import { C, ref, runTx, type PolicyDoc, type ProjectDoc } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;
const scale = (...rows: [string, string][]) => rows.map(([min, factor]) => ({ min, factor }));
const SCALE = scale(["0", "0"], ["0.7", "0.5"], ["1", "1"], ["1.2", "1.5"]);
const tiers = async () => ((await ref(C.policies, "GAMIFICATION").get()).data() as PolicyDoc).tiers;
const starts = async () => [...new Set((await tiers()).map((t) => t.effectiveFrom))].sort();
const idOf = (r: { ok: boolean; data?: { id: string } }) => { if (!r.ok || !r.data) throw new Error(JSON.stringify(r)); return r.data.id; };

suite("escala de gamificación: historia y edición", () => {
  beforeEach(async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
  });

  it("por defecto la gamificación inicia en octubre de 2025 y la meta rige desde septiembre de 2024", async () => {
    expect(await starts()).toEqual(["2025-10-01"]);
    expect((await ref(C.goals, "2024-09-01").get()).exists).toBe(true);
  });

  it("crea, reemplaza y elimina conjuntos de tramos con sus validaciones", async () => {
    expect((await saveTierSetAction({ policyCode: "GAMIFICATION", effectiveFrom: "2026-07-01", tiers: scale(["0", "0"], ["1", "1"], ["1.5", "2"]) })).ok).toBe(true);
    expect(await starts()).toEqual(["2025-10-01", "2026-07-01"]);
    // reemplazar el mismo conjunto no lo duplica
    expect((await saveTierSetAction({ policyCode: "GAMIFICATION", effectiveFrom: "2026-07-01", tiers: scale(["0", "0"], ["1", "1"], ["1.3", "2"]) })).ok).toBe(true);
    expect((await tiers()).filter((t) => t.effectiveFrom === "2026-07-01")).toHaveLength(3);
    // validaciones
    expect((await saveTierSetAction({ policyCode: "GAMIFICATION", effectiveFrom: "2026-07-15", tiers: SCALE })).ok).toBe(false); // no es primer día
    expect((await saveTierSetAction({ policyCode: "GAMIFICATION", effectiveFrom: "2026-08-01", tiers: scale(["0.1", "0"], ["1", "1"]) })).ok).toBe(false); // no empieza en 0
    expect((await saveTierSetAction({ policyCode: "GAMIFICATION", effectiveFrom: "2026-08-01", tiers: scale(["0", "0"], ["1", "1"], ["1", "2"]) })).ok).toBe(false); // no crecientes
    // eliminar
    expect((await deleteTierSetAction({ policyCode: "GAMIFICATION", effectiveFrom: "2026-07-01" })).ok).toBe(true);
    expect(await starts()).toEqual(["2025-10-01"]);
    expect((await deleteTierSetAction({ policyCode: "GAMIFICATION", effectiveFrom: "2025-10-01" })).ok).toBe(false); // la única
    expect((await deleteTierSetAction({ policyCode: "GAMIFICATION", effectiveFrom: "2030-01-01" })).ok).toBe(false); // no existe
  });

  it("no permite cambiar una escala que ya se usó para validar un mes", async () => {
    const nic = idOf(await saveCollaboratorAction(null, { fullName: "Nicholle", email: "n@t.co", position: "Analista", status: "ACTIVE", policyId: "GAMIFICATION", joinDate: "", notes: "" }));
    idOf(await saveProjectAction(null, { code: "G-001", name: "Proyecto G", client: "Cliente", country: "CO", saleDate: "2025-11-10", currency: "COP", saleAmount: "468000000", providerCosts: "0", expectedInvoices: "1", notes: "", assignments: [{ collaboratorId: nic, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]));
    await runTx((tx) => validateMonth(tx, "2025-11", "u1", "2026-01-01"));
    const blocked = await saveTierSetAction({ policyCode: "GAMIFICATION", effectiveFrom: "2025-10-01", tiers: scale(["0", "0"], ["1", "1"]) });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/noviembre 2025 ya está validado/i);
    expect((await deleteTierSetAction({ policyCode: "GAMIFICATION", effectiveFrom: "2025-10-01" })).ok).toBe(false);
    // un conjunto que solo afecta a meses posteriores sí se puede crear
    expect((await saveTierSetAction({ policyCode: "GAMIFICATION", effectiveFrom: "2026-03-01", tiers: SCALE })).ok).toBe(true);
  });

  it("historia de la analista: política general antes de octubre de 2025 y escala desde entonces", async () => {
    const nic = idOf(await saveCollaboratorAction(null, { fullName: "Nicholle", email: "n@t.co", position: "Analista", status: "ACTIVE", policyId: "GAMIFICATION", joinDate: "", notes: "" }));
    const project = (code: string, date: string) =>
      saveProjectAction(null, { code, name: `Proyecto ${code}`, client: "Cliente", country: "CO", saleDate: date, currency: "COP", saleAmount: "468000000", providerCosts: "0", expectedInvoices: "1", notes: "", assignments: [{ collaboratorId: nic, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]);
    idOf(await project("H-SEP", "2024-09-10")); // primer mes de la política
    idOf(await project("H-AGO", "2025-08-10"));
    idOf(await project("H-OCT", "2025-10-10"));
    for (const [ym, today] of [["2024-09", "2024-11-01"], ["2025-08", "2025-10-01"], ["2025-10", "2026-01-01"]]) await runTx((tx) => validateMonth(tx, ym, "u1", today));
    const rate = async (code: string) => ((await ref(C.projects, code).get()).data() as ProjectDoc).assignments[0];
    expect((await rate("H-SEP")).effectiveRate).toBe("0.01"); // 120 % de la meta, pero antes de la gamificación: sin factor 1,5
    expect((await rate("H-SEP")).effectiveRateRule).toMatch(/Antes del inicio de la gamificación/);
    expect((await rate("H-AGO")).effectiveRate).toBe("0.01");
    expect((await rate("H-OCT")).effectiveRate).toBe("0.015"); // desde octubre rige la escala
  });
});
