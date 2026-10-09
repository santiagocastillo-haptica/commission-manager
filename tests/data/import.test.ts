import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { parseHistoryWorkbook, type HistoryProject } from "@/server/import/history";
import { collaboratorsByEmail, comparePayments, importProject, validateClosedMonths } from "@/server/import/history-load";
import { bootstrapBase } from "@/store/bootstrap";
import { C, col, ref, type AuditDoc, type InvoiceDoc, type MonthlySalesDoc, type ProjectDoc } from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";
import { historyWorkbook } from "../helpers/history-workbook";

const suite = hasEmulator ? describe : describe.skip;
const TODAY = "2026-10-09";
const U = "u1";

async function person(fullName: string, email: string, policyId: string) {
  const r = await saveCollaboratorAction(null, { fullName, email, position: "Analista", status: "ACTIVE", policyId, joinDate: "", notes: "" });
  if (!r.ok) throw new Error(r.error);
}
const proj = (code: string, date: string, sale = 468000000): (string | number | null)[] => [code, "Cliente SA", "CO", date, "COP", sale, 0, null, 2, ""];

/** Plantilla pequeña con dos proyectos (enero de 2026 y octubre de 2025) y un recaudo en cada uno. */
function sample() {
  const { plan, issues } = parseHistoryWorkbook(
    historyWorkbook({
      Proyectos: [proj("H-001", "2026-01-10"), proj("H-002", "2025-10-10")],
      Asignaciones: [["H-001", "ana@haptica.co", 1], ["H-001", "nic@haptica.co", 1], ["H-002", "nic@haptica.co", 1]],
      Facturas: [
        ["H-001", "FV1", "RECAUDADA", "2026-02-01", "2026-05-10", 100000000, null, ""],
        ["H-001", "FV2", "EMITIDA", "2026-09-17", "2026-11-04", 50000000, null, ""],
        ["H-001", null, "PREVISTA", null, null, 10000000, null, ""],
        ["H-002", "FV9", "RECAUDADA", "2025-11-01", "2025-12-15", 100000000, null, ""],
      ],
      Ajustes: [["H-001", "FV1", "2026-06-01", "NOTA_CREDITO", "Nota crédito por descuento", 1000000]],
      Pagos_realizados: [["LIQ-2026-Q1", "ana@haptica.co", 100000, null, null], ["LIQ-2025-Q4", "nic@haptica.co", 1000, null, null]],
    }),
    TODAY,
  );
  expect(issues.filter((i) => i.severity === "Bloqueante")).toEqual([]);
  return plan;
}

suite("importación de la historia en Firestore", () => {
  beforeEach(async () => {
    await clearFirestore();
    await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
    await person("Ana", "ana@haptica.co", "GENERAL");
    await person("Nicholle", "nic@haptica.co", "GAMIFICATION");
  });

  it("carga proyecto, asignaciones, facturas, recaudos y ajustes en una transacción y es idempotente", async () => {
    const plan = sample();
    const byEmail = await collaboratorsByEmail();
    const r = await importProject(U, plan.projects[0], byEmail);
    expect(r).toMatchObject({ status: "imported", invoices: 3, collections: 1 });

    const p = (await ref(C.projects, "H-001").get()).data() as ProjectDoc;
    expect(p).toMatchObject({ saleMonth: "2026-01", netBase: "468000000", saleAmountCOP: "468000000", expectedInvoices: 3 });
    expect(p.assignments).toHaveLength(2);
    expect(p.assignments[0].versions[0].reason).toMatch(/importación de historia/);
    expect(p.collaboratorIds).toHaveLength(2);

    const invoices = (await col(C.invoices).get()).docs.map((d) => d.data() as InvoiceDoc);
    expect(invoices).toHaveLength(3);
    const paid = invoices.find((i) => i.number === "FV1")!;
    expect(paid.collections).toHaveLength(1);
    expect(paid.collectionIds).toEqual([paid.collections[0].id]);
    expect(paid.collections[0]).toMatchObject({ date: "2026-05-10", amountReceived: "100000000", fxRate: "1", amountCOP: "100000000" });
    expect(invoices.find((i) => i.number === "FV2")).toMatchObject({ status: "ISSUED", dueDate: "2026-11-04" });
    expect(invoices.find((i) => i.number === null)).toMatchObject({ status: "PLANNED" });
    expect((await col(C.adjustments).get()).docs[0].data()).toMatchObject({ projectId: "H-001", invoiceId: paid.id, status: "PENDING", amount: "1000000" });
    expect(((await col(C.auditLog).get()).docs.map((d) => d.data() as AuditDoc)).some((a) => /importado desde la plantilla/.test(a.summary ?? ""))).toBe(true);

    // repetir no duplica
    expect(await importProject(U, plan.projects[0], byEmail)).toMatchObject({ status: "skipped" });
    expect((await col(C.invoices).get()).size).toBe(3);
  });

  it("rechaza un proyecto con un colaborador inexistente, gamificación distinta de 1 % o facturado mayor que la venta, sin dejar nada a medias", async () => {
    const byEmail = await collaboratorsByEmail();
    const base = sample().projects[0];
    const missing: HistoryProject = { ...base, assignments: [{ email: "fantasma@haptica.co", pct: "1", row: 2 }] };
    await expect(importProject(U, missing, byEmail)).rejects.toThrow(/no existe en la aplicación/);
    const gamif: HistoryProject = { ...base, assignments: [{ email: "nic@haptica.co", pct: "0.5", row: 2 }] };
    await expect(importProject(U, gamif, byEmail)).rejects.toThrow(/gamificación/);
    const over: HistoryProject = { ...base, sale: "1000" };
    await expect(importProject(U, over, byEmail)).rejects.toThrow(/supera el valor de la venta/);
    expect((await col(C.projects).get()).size).toBe(0);
    expect((await col(C.invoices).get()).size).toBe(0);
  });

  it("no importa en un mes ya validado", async () => {
    const byEmail = await collaboratorsByEmail();
    const p = sample().projects[0];
    await ref(C.monthlySales, "2026-01").set({ id: "2026-01", yearMonth: "2026-01", status: "VALIDATED", manualAdjustmentCOP: "0" } as unknown as MonthlySalesDoc);
    await expect(importProject(U, p, byEmail)).rejects.toThrow(/ya está validado/);
    expect((await col(C.projects).get()).size).toBe(0);
  });

  it("valida en orden los meses cerrados (la gamificación aplica desde octubre de 2025) y omite el mes en curso", async () => {
    const plan = sample();
    const byEmail = await collaboratorsByEmail();
    for (const p of plan.projects) await importProject(U, p, byEmail);
    await importProject(
      U,
      { ...plan.projects[0], code: "H-OCT26", saleDate: "2026-10-02", invoices: [], adjustments: [], assignments: [{ email: "ana@haptica.co", pct: "1", row: 2 }] },
      byEmail,
    );
    const r = await validateClosedMonths(U, TODAY);
    expect(r.errors).toEqual([]);
    expect(r.validated).toEqual(["2025-10", "2026-01"]); // 2026-10 es el mes en curso
    const nic = (await ref(C.projects, "H-001").get()).data() as ProjectDoc;
    expect(nic.assignments.map((a) => a.effectiveRate).sort()).toEqual(["0.01", "0.015"]); // Ana 1 %; Nicholle 120 % → 1,5 %
    // repetir no vuelve a validar
    expect(await validateClosedMonths(U, TODAY)).toMatchObject({ validated: [], alreadyValidated: ["2025-10", "2026-01"] });
  });

  it("compara con lo pagado: calcula por semestre y agrupa los códigos trimestrales", async () => {
    const plan = sample();
    const byEmail = await collaboratorsByEmail();
    for (const p of plan.projects) await importProject(U, p, byEmail);
    await validateClosedMonths(U, TODAY);
    const cmp = await comparePayments(plan.payments, TODAY);
    expect(cmp.mapping).toEqual({ "LIQ-2026-Q1": "LIQ-2026-04", "LIQ-2025-Q4": "LIQ-2026-04" });
    // Recaudos: H-002 (dic-2025, mes de venta oct-2025 con 468M = 120 %) entra en LIQ-2026-04; H-001 (may-2026) en LIQ-2026-10.
    const row = (liq: string, email: string) => cmp.rows.find((r) => r.liquidation === liq && r.email === email);
    expect(row("LIQ-2026-04", "nic@haptica.co")).toMatchObject({ calculated: "1500000", paid: "1000" }); // H-002: 100M × 1 % × 1,5 (gamificación)
    expect(Number(row("LIQ-2026-10", "ana@haptica.co")?.calculated)).toBeGreaterThan(0);
    expect(cmp.totals.length).toBeGreaterThan(0);
    expect(cmp.unmapped).toEqual([]);
  });
});
