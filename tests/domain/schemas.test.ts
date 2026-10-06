import { describe, expect, it } from "vitest";
import { collectionSchema, invoiceSchema, projectSchema } from "@/lib/schemas";

const valid = {
  code: "HAP-2026-020",
  client: "Cliente Demo",
  country: "CO",
  saleDate: "2026-10-05",
  currency: "COP",
  saleAmount: "100000000",
  providerCosts: "20000000",
  saleReferenceRate: "",
  expectedInvoices: "2",
  notes: "",
  assignments: [{ collaboratorId: "c1", ratePercent: "1" }],
};

const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));

describe("validación de proyectos", () => {
  it("acepta un proyecto válido", () => {
    expect(projectSchema.safeParse(valid).success).toBe(true);
  });

  it("un formulario vacío reporta errores por campo y NUNCA lanza excepciones", () => {
    const empty = { ...valid, code: "", client: "", saleAmount: "", providerCosts: "", expectedInvoices: "" };
    const r = projectSchema.safeParse(empty);
    expect(r.success).toBe(false);
    const e = issues(r);
    expect(e.saleAmount).toBeTruthy();
    expect(e.providerCosts).toBeTruthy();
  });

  it("los costos de proveedores no pueden superar la venta (base no negativa)", () => {
    const r = projectSchema.safeParse({ ...valid, providerCosts: "100000001" });
    expect(issues(r).providerCosts).toMatch(/no pueden superar/);
  });

  it("acepta costos iguales a la venta (base cero)", () => {
    expect(projectSchema.safeParse({ ...valid, providerCosts: "100000000" }).success).toBe(true);
  });

  it("el porcentaje máximo por persona y proyecto es 1 %", () => {
    const r = projectSchema.safeParse({ ...valid, assignments: [{ collaboratorId: "c1", ratePercent: "1.0001" }] });
    expect(issues(r)["assignments.0.ratePercent"]).toMatch(/máximo/);
    expect(projectSchema.safeParse({ ...valid, assignments: [{ collaboratorId: "c1", ratePercent: "0.5" }] }).success).toBe(true);
  });

  it("no permite el mismo colaborador dos veces", () => {
    const r = projectSchema.safeParse({ ...valid, assignments: [{ collaboratorId: "c1", ratePercent: "1" }, { collaboratorId: "c1", ratePercent: "0.5" }] });
    expect(issues(r)["assignments.1.collaboratorId"]).toMatch(/ya está asignado/);
  });

  it("una venta en moneda extranjera exige la TRM del día de la venta", () => {
    expect(issues(projectSchema.safeParse({ ...valid, currency: "USD" })).saleReferenceRate).toBeTruthy();
    expect(projectSchema.safeParse({ ...valid, currency: "USD", saleReferenceRate: "4150.25" }).success).toBe(true);
  });
});

describe("validación de facturas y recaudos", () => {
  it("una factura emitida exige número y fecha de emisión", () => {
    const r = invoiceSchema.safeParse({ projectId: "p1", status: "ISSUED", amountPreTax: "100" });
    const e = issues(r);
    expect(e.number).toBeTruthy();
    expect(e.issueDate).toBeTruthy();
  });

  it("una factura prevista no exige número", () => {
    expect(invoiceSchema.safeParse({ projectId: "p1", status: "PLANNED", amountPreTax: "100" }).success).toBe(true);
  });

  it("el vencimiento no puede ser anterior a la emisión", () => {
    const r = invoiceSchema.safeParse({ projectId: "p1", status: "ISSUED", number: "F1", issueDate: "2026-05-10", dueDate: "2026-05-01", amountPreTax: "100" });
    expect(issues(r).dueDate).toBeTruthy();
  });

  it("el recaudo exige valor positivo y fecha válida", () => {
    expect(issues(collectionSchema.safeParse({ invoiceId: "i", date: "2026-13-40", amountReceived: "0", isOverpaymentAdjustment: false })).date).toBeTruthy();
    expect(issues(collectionSchema.safeParse({ invoiceId: "i", date: "2026-05-01", amountReceived: "", isOverpaymentAdjustment: false })).amountReceived).toBeTruthy();
  });

  it("un ajuste por excedente exige justificación", () => {
    const r = collectionSchema.safeParse({ invoiceId: "i", date: "2026-05-01", amountReceived: "10", isOverpaymentAdjustment: true, justification: "corto" });
    expect(issues(r).justification).toBeTruthy();
  });
});
