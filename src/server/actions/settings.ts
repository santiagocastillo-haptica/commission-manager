"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatMonth, todayBogota } from "@/domain/dates";
import { D, formatMoney } from "@/domain/money";
import { DomainError } from "@/domain/project";
import { exchangeRateSchema, goalSchema } from "@/lib/schemas";
import { ok, toFailure, type ActionResult } from "@/server/action-result";
import { C, assertNotClosing, audit, col, emptyMonth, now, ref, runTx, type ExchangeRateDoc, type GoalDoc, type MonthlySalesDoc, type PolicyDoc, type Tx } from "@/store";
import { requireSession } from "../auth";
import { reopenMonth, validateMonth, type MonthValidationResult } from "../services/months";

export async function saveGoalAction(input: z.input<typeof goalSchema>): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const data = goalSchema.parse(input);
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const r = ref(C.goals, data.effectiveFrom);
      if ((await tx.get(r)).exists) throw new DomainError("Ya existe una meta con esa fecha de vigencia.");
      const doc: GoalDoc = { id: data.effectiveFrom, amountCOP: D(data.amountCOP).toFixed(), effectiveFrom: data.effectiveFrom, createdAt: now(), createdById: session.userId };
      tx.create(r, doc);
      audit(tx, { entity: "MonthlyGoal", entityId: doc.id, action: "CREATE", summary: `Meta mensual de ${formatMoney(data.amountCOP, "COP", 0)} vigente desde ${data.effectiveFrom}`, after: doc, userId: session.userId });
    });
    revalidatePath("/configuracion");
    revalidatePath("/");
    revalidatePath("/proyectos");
    return ok(undefined, "Meta registrada. Los meses ya validados conservan la meta con la que se evaluaron.");
  } catch (e) {
    return toFailure(e);
  }
}

export async function saveExchangeRateAction(input: z.input<typeof exchangeRateSchema>): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const data = exchangeRateSchema.parse(input);
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const id = `${data.currency}_${data.date}`;
      const r = ref(C.exchangeRates, id);
      if ((await tx.get(r)).exists) {
        throw new DomainError(`Ya existe una tasa ${data.currency} para el ${data.date}. Las tasas registradas no se modifican; si hay un error, registra el motivo en una observación del recaudo o proyecto afectado.`);
      }
      const doc: ExchangeRateDoc = { id, currency: data.currency, date: data.date, rate: D(data.rate).toFixed(), source: data.source || null, notes: null, createdAt: now(), createdById: session.userId };
      tx.create(r, doc);
      audit(tx, { entity: "ExchangeRate", entityId: id, action: "CREATE", summary: `Tasa ${data.currency} del ${data.date}: ${data.rate}`, after: doc, userId: session.userId });
    });
    revalidatePath("/configuracion");
    return ok(undefined, "Tasa registrada.");
  } catch (e) {
    return toFailure(e);
  }
}

const monthAdjustmentSchema = z.object({
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  amountCOP: z.string().trim().regex(/^\d{1,16}(\.\d{1,2})?$/, "Ingresa un valor válido, con hasta 2 decimales."),
  note: z.string().trim().max(1000),
});

/** Ajuste manual (positivo) a las ventas organizacionales de un mes, para ventas que no están registradas como proyecto. */
export async function saveMonthAdjustmentAction(input: z.input<typeof monthAdjustmentSchema>): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const data = monthAdjustmentSchema.parse(input);
    if (D(data.amountCOP).gt(0) && data.note.length < 10) {
      return { ok: false, error: "Justifica el ajuste (mínimo 10 caracteres).", fieldErrors: { note: "Justifica el ajuste (mínimo 10 caracteres)." } };
    }
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const r = ref(C.monthlySales, data.yearMonth);
      const snap = await tx.get(r);
      const before = snap.exists ? (snap.data() as MonthlySalesDoc) : emptyMonth(data.yearMonth);
      if (before.status === "VALIDATED") throw new DomainError(`El mes ${formatMonth(data.yearMonth)} ya está validado y bloqueado. Reábrelo con un motivo para modificarlo.`);
      const after: MonthlySalesDoc = { ...before, manualAdjustmentCOP: D(data.amountCOP).toFixed(), manualAdjustmentNote: data.note || null, updatedAt: now() };
      tx.set(r, after);
      audit(tx, { entity: "MonthlySales", entityId: data.yearMonth, action: "UPDATE", summary: `Ajuste manual de ventas de ${formatMonth(data.yearMonth)}: ${formatMoney(data.amountCOP, "COP", 0)}. ${data.note}`, before, after, userId: session.userId });
    });
    revalidatePath("/configuracion");
    revalidatePath("/");
    revalidatePath("/proyectos");
    return ok(undefined, "Ajuste guardado.");
  } catch (e) {
    return toFailure(e);
  }
}

const monthSchema = z.object({ yearMonth: z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido.") });

function revalidateCommissionViews() {
  revalidatePath("/configuracion");
  revalidatePath("/");
  revalidatePath("/proyectos");
  revalidatePath("/colaboradores");
}

export async function validateMonthAction(input: { yearMonth: string }): Promise<ActionResult<MonthValidationResult>> {
  const session = await requireSession();
  try {
    const { yearMonth } = monthSchema.parse(input);
    const result = await runTx(async (tx) => {
      await assertNotClosing(tx);
      return validateMonth(tx, yearMonth, session.userId, todayBogota());
    });
    revalidateCommissionViews();
    return ok(result, `${formatMonth(yearMonth)} validado: ${result.reached ? "la meta se alcanzó" : "la meta no se alcanzó"}.`);
  } catch (e) {
    return toFailure(e);
  }
}

export async function reopenMonthAction(input: { yearMonth: string; reason: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const { yearMonth } = monthSchema.parse({ yearMonth: input.yearMonth });
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      await reopenMonth(tx, yearMonth, input.reason, session.userId);
    });
    revalidateCommissionViews();
    return ok(undefined, `${formatMonth(yearMonth)} reabierto.`);
  } catch (e) {
    return toFailure(e);
  }
}

// ───────────── Escala de gamificación ─────────────

const tierSetSchema = z.object({
  policyCode: z.literal("GAMIFICATION"),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-01$/, "La escala rige desde el primer día de un mes."),
  tiers: z
    .array(
      z.object({
        min: z.string().regex(/^\d+(\.\d+)?$/, "Cumplimiento inválido."),
        factor: z.string().regex(/^\d+(\.\d+)?$/, "Factor inválido."),
      }),
    )
    .min(2, "Define al menos dos tramos.")
    .max(12),
});

/** Meses (AAAA-MM) afectados por un conjunto de tramos que rige desde `from` hasta el siguiente conjunto. */
function affectedMonths(starts: string[], from: string): { first: string; before: string | null } {
  const next = starts.filter((s) => s > from).sort()[0] ?? null;
  return { first: from.slice(0, 7), before: next ? next.slice(0, 7) : null };
}

async function assertNoValidatedMonths(tx: Tx, first: string, before: string | null, what: string) {
  const months = (await tx.get(col(C.monthlySales).where("yearMonth", ">=", first))).docs.map((d) => d.data() as MonthlySalesDoc);
  const locked = months.find((m) => m.status === "VALIDATED" && (before === null || m.yearMonth < before));
  if (locked) {
    throw new DomainError(`No se puede ${what}: ${formatMonth(locked.yearMonth)} ya está validado con la escala actual. Reábrelo primero (si no tiene comisiones liquidadas).`);
  }
}

/** Crea o reemplaza el conjunto de tramos de gamificación que rige desde una fecha. */
export async function saveTierSetAction(input: z.input<typeof tierSetSchema>): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const data = tierSetSchema.parse(input);
    const mins = data.tiers.map((t) => D(t.min));
    if (!mins[0].isZero()) throw new DomainError("El primer tramo debe comenzar en 0 % de cumplimiento.");
    if (mins.some((m, i) => i > 0 && !m.gt(mins[i - 1]))) throw new DomainError("Los límites de cumplimiento deben ser crecientes.");

    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const snap = await tx.get(ref(C.policies, data.policyCode));
      if (!snap.exists) throw new DomainError("La política no existe.");
      const policy = snap.data() as PolicyDoc;
      const starts = [...new Set(policy.tiers.map((t) => t.effectiveFrom))];
      const w = affectedMonths(starts, data.effectiveFrom);
      await assertNoValidatedMonths(tx, w.first, w.before, "modificar esta escala");
      const tiers = [
        ...policy.tiers.filter((t) => t.effectiveFrom !== data.effectiveFrom),
        ...data.tiers.map((t) => ({ min: D(t.min).toFixed(), factor: D(t.factor).toFixed(), effectiveFrom: data.effectiveFrom as PolicyDoc["tiers"][number]["effectiveFrom"] })),
      ];
      tx.set(ref(C.policies, data.policyCode), { ...policy, tiers });
      audit(tx, {
        entity: "Policy", entityId: data.policyCode, action: starts.includes(data.effectiveFrom) ? "UPDATE" : "CREATE",
        summary: `Escala de gamificación vigente desde ${data.effectiveFrom}: ${data.tiers.map((t) => `${D(t.min).mul(100).toFixed()} % → ${t.factor}×`).join(", ")}`,
        before: policy.tiers, after: tiers, userId: session.userId,
      });
    });
    revalidatePath("/configuracion");
    return ok(undefined, "Escala guardada.");
  } catch (e) {
    return toFailure(e);
  }
}

/** Elimina un conjunto de tramos (los meses afectados pasan a regirse por el conjunto anterior, o por la política general si no hay). */
export async function deleteTierSetAction(input: { policyCode: "GAMIFICATION"; effectiveFrom: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const data = z.object({ policyCode: z.literal("GAMIFICATION"), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-01$/) }).parse(input);
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      const snap = await tx.get(ref(C.policies, data.policyCode));
      if (!snap.exists) throw new DomainError("La política no existe.");
      const policy = snap.data() as PolicyDoc;
      const starts = [...new Set(policy.tiers.map((t) => t.effectiveFrom))];
      if (!starts.includes(data.effectiveFrom as never)) throw new DomainError("Esa escala no existe.");
      if (starts.length === 1) throw new DomainError("Es la única escala: para cambiarla, crea una nueva con su fecha de inicio.");
      const w = affectedMonths(starts, data.effectiveFrom);
      await assertNoValidatedMonths(tx, w.first, w.before, "eliminar esta escala");
      const tiers = policy.tiers.filter((t) => t.effectiveFrom !== data.effectiveFrom);
      tx.set(ref(C.policies, data.policyCode), { ...policy, tiers });
      audit(tx, { entity: "Policy", entityId: data.policyCode, action: "DELETE_TIERS", summary: `Escala de gamificación vigente desde ${data.effectiveFrom} eliminada`, before: policy.tiers, after: tiers, userId: session.userId });
    });
    revalidatePath("/configuracion");
    return ok(undefined, "Escala eliminada.");
  } catch (e) {
    return toFailure(e);
  }
}
