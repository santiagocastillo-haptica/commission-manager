"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatMonth, todayBogota } from "@/domain/dates";
import { D, formatMoney } from "@/domain/money";
import { DomainError } from "@/domain/project";
import { exchangeRateSchema, goalSchema } from "@/lib/schemas";
import { ok, toFailure, type ActionResult } from "@/server/action-result";
import { C, assertNotClosing, audit, emptyMonth, now, ref, runTx, type ExchangeRateDoc, type GoalDoc, type MonthlySalesDoc } from "@/store";
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
