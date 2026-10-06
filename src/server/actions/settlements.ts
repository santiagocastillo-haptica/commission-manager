"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { todayBogota } from "@/domain/dates";
import { settlementPeriod } from "@/domain/periods";
import { dateString, positiveMoney } from "@/lib/schemas";
import { ok, toFailure, type ActionResult } from "@/server/action-result";
import { assertNotClosing, runTx } from "@/store";
import { requireSession } from "../auth";
import { approveSettlement, calculateDraft, discardDraft, finishClosing, registerPayment } from "../services/settlements";

const periodSchema = z.object({ year: z.number().int().min(2020).max(2100), half: z.enum(["APRIL", "OCTOBER"]) });

function revalidateSettlements(code?: string) {
  revalidatePath("/liquidaciones");
  if (code) revalidatePath(`/liquidaciones/${code}`);
  revalidatePath("/");
  revalidatePath("/colaboradores");
  revalidatePath("/proyectos");
}

const codeOf = (year: number, half: "APRIL" | "OCTOBER") => `LIQ-${year}-${half === "APRIL" ? "04" : "10"}`;

export async function calculateSettlementAction(input: z.input<typeof periodSchema>): Promise<ActionResult<{ lines: number }>> {
  const session = await requireSession();
  try {
    const { year, half } = periodSchema.parse(input);
    if (settlementPeriod(year, half).periodStart > todayBogota()) {
      return { ok: false, error: "Ese período aún no ha comenzado: no tiene recaudos para liquidar." };
    }
    const res = await runTx(async (tx) => {
      await assertNotClosing(tx);
      return calculateDraft(tx, year, half, session.userId);
    });
    revalidateSettlements(codeOf(year, half));
    return ok({ lines: res.result.lines.length }, `Liquidación calculada: ${res.result.lines.length} líneas.`);
  } catch (e) {
    return toFailure(e);
  }
}

export async function approveSettlementAction(input: { settlementId: string; acknowledged: string[]; code: string; expectedGross: string; expectedNet: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const data = z.object({ settlementId: z.string().min(1), acknowledged: z.array(z.string()), code: z.string(), expectedGross: z.string(), expectedNet: z.string() }).parse(input);
    await approveSettlement(data.settlementId, session.userId, data.acknowledged, { gross: data.expectedGross, net: data.expectedNet });
    revalidateSettlements(data.code);
    return ok(undefined, "Liquidación aprobada y cerrada. Ya puedes descargar los reportes y registrar los pagos.");
  } catch (e) {
    return toFailure(e);
  }
}

/** Reanuda un cierre por lotes interrumpido (no duplica ni pierde nada). */
export async function resumeClosingAction(input: { code: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    await finishClosing(z.string().min(1).parse(input.code), session.userId);
    revalidateSettlements(input.code);
    return ok(undefined, "Cierre completado.");
  } catch (e) {
    return toFailure(e);
  }
}

export async function discardDraftAction(input: { settlementId: string; code: string }): Promise<ActionResult> {
  const session = await requireSession();
  try {
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      await discardDraft(tx, input.settlementId, session.userId);
    });
    revalidateSettlements(input.code);
    return ok(undefined, "Borrador reiniciado.");
  } catch (e) {
    return toFailure(e);
  }
}

const paymentSchema = z.object({
  collaboratorSettlementId: z.string().min(1),
  code: z.string(),
  paidAt: dateString,
  amount: positiveMoney,
  reference: z.string({ error: "La referencia es obligatoria." }).trim().min(3, "Indica la referencia de pago (mínimo 3 caracteres).").max(120),
  notes: z.string().trim().max(1000).optional(),
});

export async function registerPaymentAction(input: z.input<typeof paymentSchema>): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const data = paymentSchema.parse(input);
    if (data.paidAt > todayBogota()) return { ok: false, error: "La fecha de pago no puede ser futura.", fieldErrors: { paidAt: "La fecha de pago no puede ser futura." } };
    await runTx(async (tx) => {
      await assertNotClosing(tx);
      await registerPayment(tx, data.collaboratorSettlementId, { paidAt: data.paidAt, amount: data.amount, reference: data.reference, notes: data.notes }, session.userId);
    });
    revalidateSettlements(data.code);
    return ok(undefined, "Pago registrado.");
  } catch (e) {
    return toFailure(e);
  }
}

