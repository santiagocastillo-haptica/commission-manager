import { z } from "zod";
import { COUNTRY_CODES } from "@/domain/countries";
import { isDateOnly } from "@/domain/dates";
import { D } from "@/domain/money";

/**
 * Esquemas de validación compartidos por los formularios (cliente) y las Server Actions (servidor).
 * Los números llegan como texto en formato canónico ("1500000.50") para no pasar nunca por `number`.
 */

export const currencyEnum = z.enum(["COP", "USD", "CLP", "MXN"], { error: "Selecciona una moneda." });
export const countryEnum = z.enum(COUNTRY_CODES, { error: "Selecciona un país." });

/** Comparaciones tolerantes: si el texto no es un número, la regla de formato ya reporta el error y esta no debe lanzar. */
const safe = (v: string, test: (d: ReturnType<typeof D>) => boolean) => {
  try {
    return test(D(v));
  } catch {
    return true;
  }
};

const MSG_MONEY = "Ingresa un valor numérico válido, con hasta 2 decimales.";

const moneyAmount = z.string({ error: "Campo obligatorio." }).trim().regex(/^\d{1,16}(\.\d{1,2})?$/, MSG_MONEY);
export const positiveMoney = moneyAmount.refine((v) => safe(v, (d) => d.gt(0)), "El valor debe ser mayor que cero.");
export const nonNegativeMoney = moneyAmount;

export const fxRateString = z
  .string({ error: "Campo obligatorio." })
  .trim()
  .regex(/^\d{1,9}(\.\d{1,6})?$/, "Ingresa una tasa válida, con hasta 6 decimales.")
  .refine((v) => safe(v, (d) => d.gt(0)), "La tasa debe ser mayor que cero.");

export const dateString = z.string({ error: "Campo obligatorio." }).refine(isDateOnly, "Ingresa una fecha válida.");

const optionalText = z.string().trim().max(2000, "Máximo 2000 caracteres.").optional();
const requiredText = (label: string, min = 2, max = 160) =>
  z
    .string({ error: `${label} es obligatorio.` })
    .trim()
    .min(min, `${label} es obligatorio.`)
    .max(max, `${label} es demasiado largo.`);

// ───────── Colaboradores ─────────

export const collaboratorSchema = z.object({
  fullName: requiredText("El nombre", 3),
  email: z.string({ error: "El correo es obligatorio." }).trim().toLowerCase().email("Ingresa un correo válido."),
  position: requiredText("El cargo"),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  policyId: z.string().min(1, "Selecciona la política de comisiones."),
  joinDate: z.string().optional().refine((v) => !v || isDateOnly(v), "Ingresa una fecha válida."),
  notes: optionalText,
});
export type CollaboratorInput = z.infer<typeof collaboratorSchema>;

// ───────── Proyectos ─────────

export const MAX_RATE_PERCENT = 1;

export const assignmentSchema = z.object({
  collaboratorId: z.string().min(1, "Selecciona un colaborador."),
  ratePercent: z
    .string({ error: "Ingresa el porcentaje." })
    .trim()
    .regex(/^\d(\.\d{1,4})?$/, "Ingresa un porcentaje válido (ej. 1 o 0.5).")
    .refine((v) => safe(v, (d) => d.gt(0)), "El porcentaje debe ser mayor que cero.")
    .refine((v) => safe(v, (d) => d.lte(MAX_RATE_PERCENT)), "El máximo por persona y proyecto es 1 %."),
});

export const projectSchema = z
  .object({
    code: requiredText("El código", 3, 40).regex(/^[A-Za-z0-9._&-]+$/, "Usa solo letras, números, punto, guion, guion bajo o &."),
    client: requiredText("El cliente", 2, 200),
    country: countryEnum,
    saleDate: dateString,
    currency: currencyEnum,
    saleAmount: positiveMoney,
    providerCosts: nonNegativeMoney,
    saleReferenceRate: z.string().optional(),
    expectedInvoices: z
      .string({ error: "Ingresa un número." })
      .trim()
      .regex(/^\d{1,3}$/, "Ingresa un número entero.")
      .refine((v) => Number(v) >= 1 && Number(v) <= 120, "Debe estar entre 1 y 120."),
    notes: optionalText,
    assignments: z.array(assignmentSchema).max(20),
  })
  .superRefine((p, ctx) => {
    if (/^\d+(\.\d+)?$/.test(p.saleAmount) && /^\d+(\.\d+)?$/.test(p.providerCosts) && D(p.providerCosts).gt(p.saleAmount)) {
      ctx.addIssue({ code: "custom", path: ["providerCosts"], message: "Los costos de proveedores no pueden superar el valor de la venta (la base comisionable no puede ser negativa)." });
    }
    if (p.currency !== "COP") {
      const r = fxRateString.safeParse(p.saleReferenceRate ?? "");
      if (!r.success) {
        ctx.addIssue({ code: "custom", path: ["saleReferenceRate"], message: "Para ventas en moneda extranjera ingresa la TRM del día de la venta." });
      }
    }
    const seen = new Set<string>();
    p.assignments.forEach((a, i) => {
      if (seen.has(a.collaboratorId)) {
        ctx.addIssue({ code: "custom", path: ["assignments", i, "collaboratorId"], message: "Este colaborador ya está asignado al proyecto." });
      }
      seen.add(a.collaboratorId);
    });
  });
export type ProjectInput = z.infer<typeof projectSchema>;
export type ProjectFormValues = z.input<typeof projectSchema>;

// ───────── Facturas y recaudos ─────────

export const invoiceSchema = z
  .object({
    projectId: z.string().min(1),
    number: z.string().trim().max(60).optional(),
    status: z.enum(["PLANNED", "ISSUED"]),
    issueDate: z.string().optional().refine((v) => !v || isDateOnly(v), "Ingresa una fecha válida."),
    dueDate: z.string().optional().refine((v) => !v || isDateOnly(v), "Ingresa una fecha válida."),
    amountPreTax: positiveMoney,
    netBaseExplicit: z.string().optional(),
    notes: optionalText,
  })
  .superRefine((i, ctx) => {
    if (i.status === "ISSUED") {
      if (!i.number) ctx.addIssue({ code: "custom", path: ["number"], message: "El número de factura es obligatorio para una factura emitida." });
      if (!i.issueDate) ctx.addIssue({ code: "custom", path: ["issueDate"], message: "La fecha de emisión es obligatoria para una factura emitida." });
    }
    if (i.netBaseExplicit) {
      const r = nonNegativeMoney.safeParse(i.netBaseExplicit);
      if (!r.success) ctx.addIssue({ code: "custom", path: ["netBaseExplicit"], message: MSG_MONEY });
      else if (/^\d+(\.\d+)?$/.test(i.amountPreTax) && D(i.netBaseExplicit).gt(i.amountPreTax)) {
        ctx.addIssue({ code: "custom", path: ["netBaseExplicit"], message: "La base neta de la factura no puede superar su valor." });
      }
    }
    if (i.issueDate && i.dueDate && i.dueDate < i.issueDate) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "El vencimiento no puede ser anterior a la emisión." });
    }
  });
export type InvoiceInput = z.infer<typeof invoiceSchema>;

export const collectionSchema = z
  .object({
    invoiceId: z.string().min(1),
    date: dateString,
    amountReceived: positiveMoney,
    fxRate: z.string().optional(),
    isOverpaymentAdjustment: z.boolean(),
    justification: z.string().trim().max(1000).optional(),
    notes: optionalText,
  })
  .superRefine((c, ctx) => {
    if (c.isOverpaymentAdjustment && (!c.justification || c.justification.length < 10)) {
      ctx.addIssue({ code: "custom", path: ["justification"], message: "Explica el motivo del ajuste (mínimo 10 caracteres)." });
    }
  });
export type CollectionInput = z.infer<typeof collectionSchema>;

export const adjustmentSchema = z.object({
  projectId: z.string().min(1),
  invoiceId: z.string().optional(),
  date: dateString,
  kind: z.enum(["CREDIT_NOTE", "DISCOUNT", "CONTRACT_REDUCTION", "PROVIDER_COST"], { error: "Selecciona el tipo de ajuste." }),
  reason: z.string({ error: "El motivo es obligatorio." }).trim().min(10, "Explica el motivo (mínimo 10 caracteres).").max(1000),
  amount: positiveMoney,
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const voidSchema = z.object({
  id: z.string().min(1),
  reason: z.string({ error: "El motivo es obligatorio." }).trim().min(10, "Explica el motivo de la anulación (mínimo 10 caracteres).").max(1000),
});

// ───────── Configuración ─────────

export const exchangeRateSchema = z.object({
  currency: z.enum(["USD", "CLP", "MXN"], { error: "Selecciona una moneda." }),
  date: dateString,
  rate: fxRateString,
  source: z.string().trim().max(120).optional(),
});

export const goalSchema = z.object({
  amountCOP: positiveMoney,
  effectiveFrom: dateString,
});
