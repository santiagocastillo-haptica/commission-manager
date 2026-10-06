import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth", () => ({ requireSession: async () => ({ userId: "u1", email: "t", name: "t", role: "ADMIN" }) }));

import { saveAdjustmentAction, saveCollectionAction, saveInvoiceAction, voidCollectionAction } from "@/server/actions/billing";
import { saveCollaboratorAction } from "@/server/actions/collaborators";
import { saveProjectAction } from "@/server/actions/projects";
import { validateMonthAction } from "@/server/actions/settings";
import { commissionTotals } from "@/server/queries/commissions";
import { getReportData, getSettlementView, listSettlementStates } from "@/server/queries/settlements";
import { reopenMonth, validateMonth } from "@/server/services/months";
import { approveSettlement, calculateDraft, discardDraft, finishClosing, personKey, registerPayment } from "@/server/services/settlements";
import { settlementPeriod } from "@/domain/periods";
import { bootstrapBase } from "@/store/bootstrap";
import {
  C, col, linesCol, peopleCol, ref, runTx, systemStateRef,
  type AdjustmentDoc, type CommitmentDoc, type PersonSettlementDoc, type ProjectDoc, type SettlementDoc, type SettlementLineDoc, type SystemStateDoc,
} from "@/store";
import { clearFirestore, hasEmulator } from "../helpers/firestore";

const suite = hasEmulator ? describe : describe.skip;

const U = "u1";
const OCT = "LIQ-2026-10";
const APR = "LIQ-2027-04";
const idOf = (r: { ok: boolean; data?: { id: string } }) => { if (!r.ok || !r.data) throw new Error("acción falló: " + JSON.stringify(r)); return r.data.id; };
const validate = (ym: string, today: string) => runTx((tx) => validateMonth(tx, ym, U, today));
const draft = (p: { year: number; half: "APRIL" | "OCTOBER" }) => runTx((tx) => calculateDraft(tx, p.year, p.half, U));
const oct = { year: 2026, half: "OCTOBER" as const };
const apr = { year: 2027, half: "APRIL" as const };
const pay = (key: string, amount: string, reference: string) => runTx((tx) => registerPayment(tx, key, { paidAt: "2026-10-05", amount, reference }, U));

const ids = {} as Record<string, string>;

/** Ana (general) y Nicholle (gamificación) con un proyecto de $468M en enero de 2026 (120 % de la meta) y un recaudo de $100M. */
async function fresh() {
  await clearFirestore();
  await bootstrapBase({ email: "admin@haptica.co", name: "Admin", passwordHash: "x" });
  await ref(C.users, "u1").set({ id: "u1", email: "t@t.co", name: "Tester", role: "ADMIN", passwordHash: "x", createdAt: "x", updatedAt: "x" });
  const person = (fullName: string, email: string, policyId: string) => saveCollaboratorAction(null, { fullName, email, position: "Analista", status: "ACTIVE", policyId, joinDate: "", notes: "" });
  ids.ana = idOf(await person("Ana", "a@t.co", "GENERAL"));
  ids.nic = idOf(await person("Nicholle Torres", "n@t.co", "GAMIFICATION"));
  idOf(await saveProjectAction(null, {
    code: "S-001", client: "Cliente S", country: "CO", saleDate: "2026-01-10", currency: "COP", saleAmount: "468000000", providerCosts: "0",
    expectedInvoices: "2", notes: "", assignments: [{ collaboratorId: ids.ana, ratePercent: "1" }, { collaboratorId: ids.nic, ratePercent: "1" }],
  } as Parameters<typeof saveProjectAction>[1]));
  ids.invoice = idOf(await saveInvoiceAction(null, { projectId: "S-001", number: "FE-S1", status: "ISSUED", issueDate: "2026-02-01", dueDate: "", amountPreTax: "100000000", netBaseExplicit: "", notes: "" } as Parameters<typeof saveInvoiceAction>[1]));
  ids.collection = idOf(await saveCollectionAction(null, { invoiceId: ids.invoice, date: "2026-05-10", amountReceived: "100000000", isOverpaymentAdjustment: false, notes: "" } as Parameters<typeof saveCollectionAction>[1]));
  await validate("2026-01", "2026-03-01");
}

suite("Fase D: validación de meses, liquidaciones y pagos en Firestore", () => {
  describe("validación de meses", () => {
    beforeEach(fresh);

    it("fija elegibilidad y porcentajes efectivos (Nicholle 120 % → 1,5 %) y conserva el base", async () => {
      const p = (await ref(C.projects, "S-001").get()).data() as ProjectDoc;
      const ana = p.assignments.find((a) => a.collaboratorId === ids.ana)!;
      const nic = p.assignments.find((a) => a.collaboratorId === ids.nic)!;
      expect(ana.effectiveRate).toBe("0.01");
      expect(nic.effectiveRate).toBe("0.015");
      expect(nic.baseRate).toBe("0.01");
      const month = (await ref(C.monthlySales, "2026-01").get()).data();
      expect(month).toMatchObject({ status: "VALIDATED", outcome: "ELIGIBLE", validatedSalesCOP: "468000000", goalSnapshotCOP: "390000000" });
    });

    it("con exactamente $390M la meta se alcanza (inclusivo) y cuenta TODAS las ventas del mes", async () => {
      idOf(await saveProjectAction(null, { code: "T-2", client: "Cliente", country: "CO", saleDate: "2026-02-03", currency: "COP", saleAmount: "200000000", providerCosts: "0", expectedInvoices: "1", notes: "", assignments: [{ collaboratorId: ids.nic, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]));
      idOf(await saveProjectAction(null, { code: "T-3", client: "Cliente", country: "CO", saleDate: "2026-02-05", currency: "COP", saleAmount: "190000000", providerCosts: "0", expectedInvoices: "1", notes: "", assignments: [] } as Parameters<typeof saveProjectAction>[1]));
      const r = await validate("2026-02", "2026-04-01");
      expect(r, JSON.stringify(r)).toMatchObject({ sales: "390000000", reached: true });
      expect(r.assignments[0].effectiveRate).toBe("0.01");
    });

    it("no valida meses que no han terminado ni meses ya validados", async () => {
      await expect(validate("2026-05", "2026-05-31")).rejects.toThrow(/aún no termina/);
      await expect(validate("2026-01", "2026-06-01")).rejects.toThrow(/ya está validado/);
    });

    it("la acción rechaza meses en curso", async () => {
      const r = await validateMonthAction({ yearMonth: "2026-10" });
      expect(r.ok).toBe(false);
    });

    it("reabrir exige motivo, limpia porcentajes y deja el mes pendiente", async () => {
      await expect(runTx((tx) => reopenMonth(tx, "2026-01", "corto", U))).rejects.toThrow(/mínimo 10/);
      await runTx((tx) => reopenMonth(tx, "2026-01", "Corrección de datos de prueba", U));
      expect((await ref(C.monthlySales, "2026-01").get()).data()).toMatchObject({ status: "REOPENED", outcome: null, validatedSalesCOP: null });
      const p = (await ref(C.projects, "S-001").get()).data() as ProjectDoc;
      expect(p.assignments.every((a) => a.effectiveRate === null)).toBe(true);
    });

    it("no se puede reabrir un mes con comisiones liquidadas ni uno usado por una liquidación aprobada", async () => {
      await draft(oct);
      await approveSettlement(OCT, U, []);
      await expect(runTx((tx) => reopenMonth(tx, "2026-01", "Intento tras liquidar", U))).rejects.toThrow(/liquidadas/);
      // un mes sin comisiones propias, pero cubierto por el período de una liquidación aprobada
      idOf(await saveProjectAction(null, { code: "E-1", client: "Cliente", country: "CO", saleDate: "2026-03-03", currency: "COP", saleAmount: "1000000", providerCosts: "0", expectedInvoices: "1", notes: "", assignments: [{ collaboratorId: ids.ana, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1]));
      await validate("2026-03", "2026-10-06");
      await expect(runTx((tx) => reopenMonth(tx, "2026-03", "Intento con liquidación aprobada", U))).rejects.toThrow(/ya está aprobada/);
    });
  });

  describe("liquidación: cálculo, cierre y compromisos", () => {
    beforeAll(fresh);

    it("calcula el borrador con las comisiones esperadas y es repetible", async () => {
      const first = await draft(oct);
      expect(first.result.lines).toHaveLength(2);
      const again = await draft(oct);
      expect(again.settlementId).toBe(first.settlementId);
      const lines = (await linesCol(OCT).get()).docs.map((d) => d.data() as SettlementLineDoc);
      expect(lines).toHaveLength(2); // no se duplican al recalcular
      expect(lines.every((l) => !l.committed)).toBe(true);
      expect(((await ref(C.settlements, OCT).get()).data() as SettlementDoc).totalGross).toBe("2500000"); // Ana 1.000.000 + Nicholle 1.500.000
      expect((await col(C.commitments).get()).size).toBe(0); // el borrador no compromete nada
    });

    it("no permite aprobar una liquidación posterior antes que la anterior", async () => {
      await draft(apr);
      await expect(approveSettlement(APR, U, [])).rejects.toThrow(/cronológico/);
      await runTx((tx) => discardDraft(tx, APR, U));
    });

    it("aprueba en una transacción: líneas y compromisos, liquidaciones individuales y fotos", async () => {
      const r = await approveSettlement(OCT, U, [], { gross: "2500000", net: "2500000" });
      expect(r.mode).toBe("single");
      const s = (await ref(C.settlements, OCT).get()).data() as SettlementDoc;
      expect(s.status).toBe("APPROVED");
      expect(s.adminSnapshot).toBeTruthy();
      const lines = (await linesCol(OCT).get()).docs.map((d) => d.data() as SettlementLineDoc);
      expect(lines.every((l) => l.committed)).toBe(true);
      const commits = (await col(C.commitments).get()).docs.map((d) => d.data() as CommitmentDoc);
      expect(commits).toHaveLength(2);
      expect(commits.map((c) => c.id).sort()).toEqual(lines.map((l) => l.id).sort());
      const nic = (await peopleCol(OCT).doc(ids.nic).get()).data() as PersonSettlementDoc;
      expect(nic).toMatchObject({ netPayable: "1500000", paymentStatus: "PENDING" });
      expect(nic.snapshot).toBeTruthy();
      expect((await peopleCol(OCT).get()).size).toBe(2);
    });

    it("una liquidación aprobada no se recalcula, aprueba ni descarta de nuevo", async () => {
      await expect(draft(oct)).rejects.toThrow(/aprobada/);
      await expect(approveSettlement(OCT, U, [])).rejects.toThrow(/ya está aprobada/);
      await expect(runTx((tx) => discardDraft(tx, OCT, U))).rejects.toThrow(/aprobada/);
    });

    it("lo liquidado queda protegido: recaudo, factura y retiro de asignación", async () => {
      const col1 = { invoiceId: ids.invoice, date: "2026-05-10", amountReceived: "90000000", isOverpaymentAdjustment: false, notes: "" } as Parameters<typeof saveCollectionAction>[1];
      expect((await saveCollectionAction(ids.collection, col1)).ok).toBe(false);
      expect((await voidCollectionAction({ id: ids.collection, reason: "Intento sobre liquidado" })).ok).toBe(false);
      expect((await saveInvoiceAction(ids.invoice, { projectId: "S-001", number: "FE-S1", status: "ISSUED", issueDate: "2026-02-01", dueDate: "", amountPreTax: "110000000", netBaseExplicit: "", notes: "" } as Parameters<typeof saveInvoiceAction>[1])).ok).toBe(false);
      const r = await saveProjectAction("S-001", { code: "S-001", client: "Cliente S", country: "CO", saleDate: "2026-01-10", currency: "COP", saleAmount: "468000000", providerCosts: "0", expectedInvoices: "2", notes: "", assignments: [{ collaboratorId: ids.ana, ratePercent: "1" }] } as Parameters<typeof saveProjectAction>[1], "Retiro de Nicholle del proyecto");
      expect(r.ok).toBe(false);
    });

    it("los recaudos ya liquidados no vuelven a generar comisión en la siguiente liquidación", async () => {
      expect((await draft(apr)).result.lines).toHaveLength(0);
    });

    it("una nota crédito posterior compensa en la siguiente liquidación sin tocar la anterior", async () => {
      const before = (await linesCol(OCT).get()).docs.map((d) => d.data() as SettlementLineDoc).sort((a, b) => a.id.localeCompare(b.id));
      idOf(await saveAdjustmentAction({ projectId: "S-001", invoiceId: ids.invoice, date: "2026-11-10", kind: "CREDIT_NOTE", reason: "Nota crédito por descuento acordado", amount: "20000000" }));
      const d = await draft(apr);
      const adj = d.result.lines.filter((l) => l.type === "ADJUSTMENT");
      expect(adj.map((l) => l.commissionCOP.toFixed()).sort()).toEqual(["-200000", "-300000"]);
      expect(d.result.grand.netPayable.isZero()).toBe(true);

      // Las advertencias exigen reconocimiento explícito antes de cerrar.
      await expect(approveSettlement(APR, U, [])).rejects.toThrow(/sin reconocer/);
      const keys = d.result.alerts.filter((a) => a.severity === "WARNING").map((a) => a.key);
      await approveSettlement(APR, U, keys);
      const a = (await col(C.adjustments).get()).docs[0].data() as AdjustmentDoc;
      expect(a).toMatchObject({ status: "APPLIED", appliedInSettlementId: APR });

      const after = (await linesCol(OCT).get()).docs.map((x) => x.data() as SettlementLineDoc).sort((x, y) => x.id.localeCompare(y.id));
      expect(after.map((l) => l.commissionCOP)).toEqual(before.map((l) => l.commissionCOP));

      // Saldo negativo arrastrado: no hay nada que pagar y se descuenta después.
      const people = (await peopleCol(APR).get()).docs.map((x) => x.data() as PersonSettlementDoc);
      expect(people.every((p) => D0(p.netPayable) && p.paymentStatus === "PAID")).toBe(true);
      expect(people.find((p) => p.collaboratorId === ids.ana)!.carryoverOut).toBe("-200000");
      expect(people.find((p) => p.collaboratorId === ids.nic)!.carryoverOut).toBe("-300000");
      // El ajuste aplicado ya no se puede anular
      expect(((await col(C.commitments).get()).docs.map((x) => x.data() as CommitmentDoc)).filter((c) => c.type === "ADJUSTMENT")).toHaveLength(2);
    });

    describe("pagos", () => {
      const nic = personKey(OCT, "");
      let nicKey = "";
      let anaKey = "";
      beforeAll(() => {
        nicKey = personKey(OCT, ids.nic);
        anaKey = personKey(OCT, ids.ana);
        void nic;
      });

      it("un pago parcial deja la liquidación en «parcial» y el saldo pendiente", async () => {
        const r = await pay(nicKey, "500000", "TRX-1");
        expect(r.status).toBe("PARTIAL");
        expect(r.remaining.toFixed()).toBe("1000000");
      });
      it("rechaza referencias duplicadas y pagos que superan el saldo o son cero", async () => {
        await expect(pay(nicKey, "100", "trx-1")).rejects.toThrow(/duplicado/);
        await expect(pay(nicKey, "1000001", "TRX-2")).rejects.toThrow(/supera el saldo/);
        await expect(pay(nicKey, "0", "TRX-3")).rejects.toThrow(/mayor que cero/);
      });
      it("dos pagos simultáneos no pueden superar el neto a pagar", async () => {
        const res = await Promise.allSettled([pay(nicKey, "700000", "SIM-A"), pay(nicKey, "700000", "SIM-B")]);
        expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const person = (await peopleCol(OCT).doc(ids.nic).get()).data() as PersonSettlementDoc;
        expect(person.payments).toHaveLength(2); // TRX-1 + el ganador
      });
      it("el pago del saldo completo marca la liquidación como pagada y bloquea más pagos", async () => {
        const r = await pay(nicKey, "300000", "TRX-4");
        expect(r.status).toBe("PAID");
        await expect(pay(nicKey, "1", "TRX-5")).rejects.toThrow(/pagada en su totalidad/);
      });
      it("la aprobación y el pago son estados distintos", async () => {
        expect(((await ref(C.settlements, OCT).get()).data() as SettlementDoc).status).toBe("APPROVED");
        expect(((await peopleCol(OCT).doc(ids.ana).get()).data() as PersonSettlementDoc).paymentStatus).toBe("PENDING");
        await expect(pay(personKey(OCT, "inexistente"), "1", "X-1")).rejects.toThrow(/no existe/);
        await expect(pay(anaKey, "1", "AB")).resolves.toBeTruthy();
      });
    });

    describe("consultas y reportes", () => {
      it("la vista aprobada lee lo congelado, con pagos y csId", async () => {
        const v = await getSettlementView(2026, "OCTOBER");
        expect(v).toMatchObject({ status: "APPROVED", approver: "Tester", grand: { gross: "2500000", netPayable: "2500000" } });
        const nic = v.collaborators.find((c) => c.name === "Nicholle Torres")!;
        expect(nic).toMatchObject({ paymentStatus: "PAID", csId: personKey(OCT, ids.nic), netPayable: "1500000" });
        expect(nic.lines[0]).toMatchObject({ projectCode: "S-001", commissionCOP: "1500000" });
      });
      it("el listado resume pagado y pendiente por período", async () => {
        const [a, b] = await listSettlementStates([settlementPeriod(2026, "OCTOBER"), settlementPeriod(2027, "APRIL")]);
        expect(a).toMatchObject({ status: "APPROVED", totalNet: "2500000", paid: "1500001" });
        expect(b.status).toBe("APPROVED");
      });
      it("los datos de reporte solo existen para liquidaciones aprobadas", async () => {
        const data = await getReportData(OCT);
        expect(data?.collaborators.map((c) => c.snapshot.fullName)).toEqual(["Ana", "Nicholle Torres"]);
        expect(data?.collaborators[0].lines[0].snapshot.client).toBe("Cliente S");
        expect(await getReportData("LIQ-2030-04")).toBeNull();
        expect(await getReportData("nada")).toBeNull();
      });
      it("totales: lo liquidado y lo pagado salen de compromisos y pagos", async () => {
        const t = await commissionTotals();
        expect(t.liquidated).toBe("2000000"); // 2.5M − 0.5M de compensaciones
        expect(t.paid).toBe("1500001");
      });
    });
  });

  describe("borradores", () => {
    beforeEach(fresh);

    it("descartar un borrador elimina la liquidación y sus líneas", async () => {
      await draft(oct);
      await runTx((tx) => discardDraft(tx, OCT, U));
      expect((await ref(C.settlements, OCT).get()).exists).toBe(false);
      expect((await linesCol(OCT).get()).size).toBe(0);
      await draft(apr); // no queda un borrador que bloquee a las siguientes
    });

    it("no aprueba si el total cambió desde la revisión; sí si coincide", async () => {
      await draft(oct);
      await expect(approveSettlement(OCT, U, [], { gross: "1", net: "1" })).rejects.toThrow(/cambiaron/);
      expect((await approveSettlement(OCT, U, [], { gross: "2500000", net: "2500000" })).mode).toBe("single");
    });

    it("sin comisiones por liquidar no se aprueba", async () => {
      await draft(oct);
      await approveSettlement(OCT, U, []);
      await draft(apr); // el recaudo ya quedó liquidado en octubre
      await expect(approveSettlement(APR, U, [])).rejects.toThrow(/No hay comisiones/);
    });
  });

  describe("concurrencia", () => {
    beforeEach(fresh);

    it("dos aprobaciones simultáneas: solo una se aplica y nada se duplica", async () => {
      await draft(oct);
      const res = await Promise.allSettled([approveSettlement(OCT, U, []), approveSettlement(OCT, U, [])]);
      expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await col(C.commitments).get()).size).toBe(2);
      expect((await linesCol(OCT).get()).size).toBe(2);
    });
  });

  describe("cierre por lotes (respaldo para cierres enormes)", () => {
    beforeEach(fresh);

    it("produce el mismo resultado que la transacción única", async () => {
      await draft(oct);
      const r = await approveSettlement(OCT, U, [], undefined, { forceBatches: true });
      expect(r.mode).toBe("batched");
      expect(((await ref(C.settlements, OCT).get()).data() as SettlementDoc)).toMatchObject({ status: "APPROVED", totalGross: "2500000", closingId: null });
      expect((await col(C.commitments).get()).size).toBe(2);
      expect(((await systemStateRef().get()).data() as SystemStateDoc).closing).toBeNull();
      expect(((await peopleCol(OCT).doc(ids.nic).get()).data() as PersonSettlementDoc).netPayable).toBe("1500000");
    });

    it("si se interrumpe queda CLOSING, bloquea las escrituras de negocio y se reanuda sin duplicar", async () => {
      await draft(oct);
      await expect(approveSettlement(OCT, U, [], undefined, { forceBatches: true, interruptAfterStart: true })).rejects.toThrow(/interrupción/);
      expect(((await ref(C.settlements, OCT).get()).data() as SettlementDoc).status).toBe("CLOSING");

      // El resto de las escrituras de negocio se rechazan mientras dura el cierre.
      const blocked = await saveCollaboratorAction(null, { fullName: "Nuevo", email: "x@t.co", position: "Analista", status: "ACTIVE", policyId: "GENERAL", joinDate: "", notes: "" });
      expect(blocked.ok).toBe(false);
      await expect(approveSettlement(OCT, U, [])).rejects.toThrow(/proceso de cierre/);
      await expect(draft(oct)).rejects.toThrow();
      await expect(runTx((tx) => discardDraft(tx, OCT, U))).rejects.toThrow(/proceso de cierre/);

      // Se reanuda (dos veces para probar idempotencia: la segunda ya no tiene qué cerrar).
      await finishClosing(OCT, U);
      expect(((await ref(C.settlements, OCT).get()).data() as SettlementDoc).status).toBe("APPROVED");
      expect((await col(C.commitments).get()).size).toBe(2);
      expect((await linesCol(OCT).get()).size).toBe(2);
      await expect(finishClosing(OCT, U)).rejects.toThrow(/No hay un cierre en curso/);
      // y el sistema vuelve a aceptar escrituras
      expect((await saveCollaboratorAction(null, { fullName: "Nuevo", email: "x@t.co", position: "Analista", status: "ACTIVE", policyId: "GENERAL", joinDate: "", notes: "" })).ok).toBe(true);
    });
  });
});

/** ¿El texto decimal es cero? */
function D0(v: string) {
  return Number(v) === 0;
}
