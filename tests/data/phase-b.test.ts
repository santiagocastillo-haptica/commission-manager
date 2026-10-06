import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { saveProjectAction, voidProjectAction } from "@/server/actions/projects";
import { saveExchangeRateAction, saveGoalAction, saveMonthAdjustmentAction } from "@/server/actions/settings";
import { getProject, listProjects } from "@/server/queries/projects";
import { listCollaborators } from "@/server/queries/collaborators";
import { listMonths } from "@/server/queries/settings";
import { bootstrapBase } from "@/store/bootstrap";
import { C, col, emptyMonth, ref, type AuditDoc, type CommitmentDoc, type MonthlySalesDoc, type ProjectDoc } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;

const collab = (over: Partial<Parameters<typeof saveCollaboratorAction>[1]> = {}) => ({
  fullName: "Ana Pérez", email: "ana@haptica.co", position: "Consultora", status: "ACTIVE" as const, policyId: "GENERAL", joinDate: "", notes: "", ...over,
});
const project = (assignments: { collaboratorId: string; ratePercent: string }[], over: Record<string, unknown> = {}) => ({
  code: "HAP-2026-001", name: "Proyecto Uno", client: "Cliente SA", country: "CO", saleDate: "2026-05-10", currency: "COP",
  saleAmount: "100000000", providerCosts: "10000000", expectedInvoices: "2", notes: "", assignments, ...over,
}) as Parameters<typeof saveProjectAction>[1];

async function mkCollab(over = {}) {
  const r = await saveCollaboratorAction(null, collab(over));
  if (!r.ok) throw new Error(r.error);
  return r.data!.id;
}
const auditActions = async () => (await col(C.auditLog).get()).docs.map((d) => (d.data() as AuditDoc).entity + ":" + (d.data() as AuditDoc).action);

suite("Fase B: colaboradores, proyectos y configuración en Firestore", () => {
  beforeEach(async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
  });

  describe("colaboradores", () => {
    it("crea, lista y audita; el correo es único (sin distinguir mayúsculas)", async () => {
      const id = await mkCollab();
      const dup = await saveCollaboratorAction(null, collab({ email: "ANA@haptica.co" }));
      expect(dup.ok).toBe(false);
      const rows = await listCollaborators();
      expect(rows.map((r) => r.id)).toEqual([id]);
      expect(rows[0]).toMatchObject({ policyId: "GENERAL", projectCount: 0 });
      expect(await auditActions()).toContain("Collaborator:CREATE");
    });

    it("cambiar el correo libera el anterior", async () => {
      const id = await mkCollab();
      expect((await saveCollaboratorAction(id, collab({ email: "nuevo@haptica.co" }))).ok).toBe(true);
      expect((await saveCollaboratorAction(null, collab({ fullName: "Otra", email: "ana@haptica.co" }))).ok).toBe(true);
    });

    it("bloquea el cambio de política si ya tuvo proyectos asignados", async () => {
      const id = await mkCollab();
      expect((await saveProjectAction(null, project([{ collaboratorId: id, ratePercent: "1" }]))).ok).toBe(true);
      const r = await saveCollaboratorAction(id, collab({ policyId: "GAMIFICATION" }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fieldErrors?.policyId).toBeDefined();
      expect((await saveCollaboratorAction(id, collab({ fullName: "Ana P." }))).ok).toBe(true);
    });
  });

  describe("proyectos", () => {
    it("crea con asignaciones, versión inicial y campos derivados", async () => {
      const a = await mkCollab();
      const r = await saveProjectAction(null, project([{ collaboratorId: a, ratePercent: "0.5" }]));
      expect(r).toMatchObject({ ok: true });
      const doc = (await ref(C.projects, "HAP-2026-001").get()).data() as ProjectDoc;
      expect(doc).toMatchObject({ saleMonth: "2026-05", netBase: "90000000", saleAmountCOP: "100000000", collaboratorIds: [a], everAssignedIds: [a] });
      expect(doc.assignments[0]).toMatchObject({ baseRate: "0.005" });
      expect(doc.assignments[0].versions[0].reason).toBe("Asignación inicial en la venta");
      expect((await listProjects({})).length).toBe(1);
      expect((await getProject("HAP-2026-001"))?.code).toBe("HAP-2026-001");
    });

    it("rechaza código duplicado", async () => {
      await saveProjectAction(null, project([]));
      const r = await saveProjectAction(null, project([]));
      expect(r.ok).toBe(false);
    });

    it("gamificación exige 1 % base", async () => {
      const g = await mkCollab({ email: "g@haptica.co", policyId: "GAMIFICATION" });
      expect((await saveProjectAction(null, project([{ collaboratorId: g, ratePercent: "0.5" }]))).ok).toBe(false);
      expect((await saveProjectAction(null, project([{ collaboratorId: g, ratePercent: "1" }]))).ok).toBe(true);
    });

    it("cambio o retiro de porcentaje exige motivo y deja historial", async () => {
      const a = await mkCollab();
      const b = await mkCollab({ email: "b@haptica.co", fullName: "Beto" });
      await saveProjectAction(null, project([{ collaboratorId: a, ratePercent: "0.5" }, { collaboratorId: b, ratePercent: "0.5" }]));

      const sin = await saveProjectAction("HAP-2026-001", project([{ collaboratorId: a, ratePercent: "0.8" }, { collaboratorId: b, ratePercent: "0.5" }]));
      expect(sin.ok).toBe(false);

      const con = await saveProjectAction("HAP-2026-001", project([{ collaboratorId: a, ratePercent: "0.8" }]), "Acuerdo con el cliente");
      expect(con.ok).toBe(true);
      const doc = (await ref(C.projects, "HAP-2026-001").get()).data() as ProjectDoc;
      const aa = doc.assignments.find((x) => x.collaboratorId === a)!;
      const bb = doc.assignments.find((x) => x.collaboratorId === b)!;
      expect(aa.baseRate).toBe("0.008");
      expect(aa.versions.map((v) => v.reason)).toEqual(["Asignación inicial en la venta", "Cambio de porcentaje: Acuerdo con el cliente"]);
      expect(bb.removedAt).not.toBeNull();
      expect(doc.collaboratorIds).toEqual([a]);
      expect(doc.everAssignedIds.sort()).toEqual([a, b].sort());

      // reasignar a b
      await saveProjectAction("HAP-2026-001", project([{ collaboratorId: a, ratePercent: "0.8" }, { collaboratorId: b, ratePercent: "0.2" }]), "Vuelve al proyecto");
      const again = (await ref(C.projects, "HAP-2026-001").get()).data() as ProjectDoc;
      expect(again.assignments.filter((x) => x.collaboratorId === b)).toHaveLength(1);
      expect(again.assignments.find((x) => x.collaboratorId === b)!.removedAt).toBeNull();
    });

    it("no permite retirar a quien ya tiene comisión liquidada", async () => {
      const a = await mkCollab();
      await saveProjectAction(null, project([{ collaboratorId: a, ratePercent: "1" }]));
      const doc = (await ref(C.projects, "HAP-2026-001").get()).data() as ProjectDoc;
      const c: Partial<CommitmentDoc> = { id: "rec1__x", assignmentId: doc.assignments[0].id, projectId: "HAP-2026-001" };
      await col(C.commitments).doc("rec1__x").set(c);
      const r = await saveProjectAction("HAP-2026-001", project([]), "Retiro de prueba largo");
      expect(r.ok).toBe(false);
    });

    it("no cambia el código ni edita proyectos anulados; anular lo deja inmodificable", async () => {
      await saveProjectAction(null, project([]));
      expect((await saveProjectAction("HAP-2026-001", project([], { code: "HAP-2026-999" }))).ok).toBe(false);
      expect((await voidProjectAction({ id: "HAP-2026-001", reason: "Duplicado por error de captura" })).ok).toBe(true);
      expect((await saveProjectAction("HAP-2026-001", project([], { name: "Otro nombre" }))).ok).toBe(false);
      expect((await voidProjectAction({ id: "HAP-2026-001", reason: "Duplicado por error de captura" })).ok).toBe(false);
    });

    it("no anula con facturas emitidas ni con recaudos", async () => {
      await saveProjectAction(null, project([]));
      await col(C.invoices).doc("i1").set({ id: "i1", projectId: "HAP-2026-001", status: "ISSUED", amountPreTax: "1", voidedAt: null, collections: [] });
      expect((await voidProjectAction({ id: "HAP-2026-001", reason: "Intento con factura emitida" })).ok).toBe(false);
    });

    it("el valor de venta no puede quedar por debajo de lo facturado", async () => {
      await saveProjectAction(null, project([]));
      await col(C.invoices).doc("i1").set({ id: "i1", projectId: "HAP-2026-001", status: "PLANNED", amountPreTax: "60000000", voidedAt: null, collections: [] });
      const r = await saveProjectAction("HAP-2026-001", project([], { saleAmount: "50000000", providerCosts: "0" }));
      expect(r.ok).toBe(false);
    });

    it("mes validado bloquea crear, mover y cambiar economía, pero permite editar datos no económicos", async () => {
      await saveProjectAction(null, project([], { code: "HAP-2026-002" }));
      const locked: MonthlySalesDoc = { ...emptyMonth("2026-05"), status: "VALIDATED" };
      await ref(C.monthlySales, "2026-05").set(locked);
      expect((await saveProjectAction(null, project([]))).ok).toBe(false); // crear en mes bloqueado
      expect((await saveProjectAction("HAP-2026-002", project([], { code: "HAP-2026-002", saleAmount: "200000000" }))).ok).toBe(false);
      expect((await saveProjectAction("HAP-2026-002", project([], { code: "HAP-2026-002", name: "Nombre nuevo" }))).ok).toBe(true);
      expect((await voidProjectAction({ id: "HAP-2026-002", reason: "Mes bloqueado, no debe anular" })).ok).toBe(false);
    });

    it("moneda extranjera: guarda la TRM de referencia y el equivalente en COP", async () => {
      await saveProjectAction(null, project([], { currency: "USD", saleAmount: "1000", providerCosts: "0", saleReferenceRate: "4000" }));
      const doc = (await ref(C.projects, "HAP-2026-001").get()).data() as ProjectDoc;
      expect(doc).toMatchObject({ currency: "USD", saleReferenceRate: "4000", saleAmountCOP: "4000000" });
    });
  });

  describe("configuración", () => {
    it("metas: una por fecha de vigencia", async () => {
      expect((await saveGoalAction({ amountCOP: "500000000", effectiveFrom: "2026-07-01" })).ok).toBe(true);
      expect((await saveGoalAction({ amountCOP: "600000000", effectiveFrom: "2026-07-01" })).ok).toBe(false);
    });

    it("tasas: no se modifican una vez registradas", async () => {
      const r = { currency: "USD" as const, date: "2026-05-10", rate: "4000", source: "" };
      expect((await saveExchangeRateAction(r)).ok).toBe(true);
      expect((await saveExchangeRateAction({ ...r, rate: "4100" })).ok).toBe(false);
    });

    it("ajuste manual de mes: exige nota, se refleja en ventas y se bloquea al validar", async () => {
      expect((await saveMonthAdjustmentAction({ yearMonth: "2026-05", amountCOP: "5000000", note: "corta" })).ok).toBe(false);
      expect((await saveMonthAdjustmentAction({ yearMonth: "2026-05", amountCOP: "5000000", note: "Venta sin proyecto registrado" })).ok).toBe(true);
      const may = (await listMonths()).find((m) => m.yearMonth === "2026-05")!;
      expect(may.manualAdjustmentCOP).toBe("5000000");
      expect(may.salesCOP).toBe("5000000");
      await ref(C.monthlySales, "2026-05").set({ ...(await ref(C.monthlySales, "2026-05").get()).data(), status: "VALIDATED" });
      expect((await saveMonthAdjustmentAction({ yearMonth: "2026-05", amountCOP: "0", note: "" })).ok).toBe(false);
    });
  });
});
