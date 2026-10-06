import { describe, expect, it } from "vitest";
import { endOfMonth, formatDate, todayBogota } from "@/domain/dates";
import { D, formatMoney, formatPercent, parseNumberInput } from "@/domain/money";
import { nextSettlement, settlementForCollectionDate, settlementPeriod } from "@/domain/periods";
import { computeNetBase, DomainError, saleAmountInCOP, suggestProjectCode } from "@/domain/project";

describe("períodos de liquidación (Regla 6)", () => {
  it("abril de Y cubre 1-oct-(Y-1) a 31-mar-Y y paga el 15 de abril", () => {
    const p = settlementPeriod(2027, "APRIL");
    expect(p).toMatchObject({ periodStart: "2026-10-01", periodEnd: "2027-03-31", paymentDate: "2027-04-15", code: "LIQ-2027-04" });
  });

  it("octubre de Y cubre 1-abr a 30-sep y paga el 15 de octubre", () => {
    const p = settlementPeriod(2026, "OCTOBER");
    expect(p).toMatchObject({ periodStart: "2026-04-01", periodEnd: "2026-09-30", paymentDate: "2026-10-15", code: "LIQ-2026-10" });
  });

  it("ejemplo del brief: recaudo de agosto 2026 → octubre 2026; noviembre 2026 → abril 2027", () => {
    expect(settlementForCollectionDate("2026-08-20").code).toBe("LIQ-2026-10");
    expect(settlementForCollectionDate("2026-11-05").code).toBe("LIQ-2027-04");
  });

  it("los límites son inclusivos", () => {
    expect(settlementForCollectionDate("2026-03-31").code).toBe("LIQ-2026-04");
    expect(settlementForCollectionDate("2026-04-01").code).toBe("LIQ-2026-10");
    expect(settlementForCollectionDate("2026-09-30").code).toBe("LIQ-2026-10");
    expect(settlementForCollectionDate("2026-10-01").code).toBe("LIQ-2027-04");
    expect(settlementForCollectionDate("2026-12-31").code).toBe("LIQ-2027-04");
    expect(settlementForCollectionDate("2027-01-01").code).toBe("LIQ-2027-04");
  });

  it("próxima liquidación según la fecha de pago", () => {
    expect(nextSettlement("2026-10-05").code).toBe("LIQ-2026-10");
    expect(nextSettlement("2026-10-15").code).toBe("LIQ-2026-10");
    expect(nextSettlement("2026-10-16").code).toBe("LIQ-2027-04");
    expect(nextSettlement("2027-01-10").code).toBe("LIQ-2027-04");
  });
});

describe("base neta comisionable", () => {
  it("venta − costos de proveedores", () => {
    expect(computeNetBase("100000000", "35000000.50").toString()).toBe("64999999.5");
  });
  it("no permite base negativa", () => {
    expect(() => computeNetBase("100", "100.01")).toThrow(DomainError);
  });
  it("permite base cero", () => {
    expect(computeNetBase("100", "100").isZero()).toBe(true);
  });
  it("convierte ventas en moneda extranjera a COP con la tasa de referencia", () => {
    expect(saleAmountInCOP("10000", "USD", "4150.25").toString()).toBe("41502500");
    expect(saleAmountInCOP("10000", "COP", "4150.25").toString()).toBe("10000");
  });
  it("sugiere el siguiente código", () => {
    expect(suggestProjectCode(2026, ["HAP-2026-001", "HAP-2026-007", "HAP-2025-099"])).toBe("HAP-2026-008");
    expect(suggestProjectCode(2026, [])).toBe("HAP-2026-001");
  });
});

describe("precisión decimal", () => {
  it("0,1 + 0,2 es exactamente 0,3", () => {
    expect(D("0.1").plus("0.2").equals("0.3")).toBe(true);
  });
  it("formato es-CO", () => {
    expect(formatMoney("390000000", "COP", 0)).toBe("$ 390.000.000");
    expect(formatMoney("1234.5", "COP")).toBe("$ 1.234,50");
    expect(formatMoney("-1500", "COP", 0)).toBe("-$ 1.500");
    expect(formatMoney("1234.5", "USD")).toBe("USD 1.234,50");
    expect(formatPercent("0.015")).toBe("1,50 %");
  });
  it("interpreta números escritos en es-CO", () => {
    expect(parseNumberInput("1.500.000,50")).toBe("1500000.50");
    expect(parseNumberInput("1.500.000")).toBe("1500000");
    expect(parseNumberInput("4150,25")).toBe("4150.25");
    expect(parseNumberInput("1500000.5")).toBe("1500000.5");
    expect(parseNumberInput("abc")).toBeNull();
  });
});

describe("fechas", () => {
  it("fin de mes", () => {
    expect(endOfMonth("2026-02")).toBe("2026-02-28");
    expect(endOfMonth("2028-02")).toBe("2028-02-29");
  });
  it("hoy en Colombia usa UTC-5 (a las 02:00 UTC aún es el día anterior)", () => {
    expect(todayBogota(new Date("2026-10-06T02:00:00Z"))).toBe("2026-10-05");
    expect(todayBogota(new Date("2026-10-06T05:00:00Z"))).toBe("2026-10-06");
  });
  it("formato legible", () => {
    expect(formatDate("2026-10-15")).toBe("15 oct 2026");
  });
});

import { projectFinancials } from "@/domain/project-status";

describe("estado de facturación y recaudo del proyecto", () => {
  const issued = (amount: string, collected: string, voided = false) => ({ status: "ISSUED" as const, amountPreTax: amount, collected, voided });

  it("sin facturas emitidas", () => {
    const f = projectFinancials("100", 3, [{ status: "PLANNED", amountPreTax: "100", collected: "0", voided: false }]);
    expect(f.billingStatus).toBe("NOT_INVOICED");
    expect(f.collectionStatus).toBe("NONE");
    expect(f.pendingInvoices).toBe(3);
    expect(f.plannedInvoices).toBe(1);
  });

  it("facturación parcial con saldo pendiente", () => {
    const f = projectFinancials("300", 3, [issued("100", "40"), issued("100", "0")]);
    expect(f.billingStatus).toBe("PARTIAL");
    expect(f.collectionStatus).toBe("PARTIAL");
    expect(f.invoiced.toString()).toBe("200");
    expect(f.collected.toString()).toBe("40");
    expect(f.pendingToInvoice.toString()).toBe("100");
    expect(f.pendingCollection.toString()).toBe("160");
    expect(f.pendingInvoices).toBe(1);
  });

  it("facturación y recaudo completos", () => {
    const f = projectFinancials("300", 3, [issued("100", "100"), issued("100", "100"), issued("100", "100")]);
    expect(f.billingStatus).toBe("INVOICED");
    expect(f.collectionStatus).toBe("COLLECTED");
    expect(f.pendingCollection.isZero()).toBe(true);
  });

  it("ignora facturas anuladas", () => {
    const f = projectFinancials("100", 1, [issued("100", "100", true)]);
    expect(f.billingStatus).toBe("NOT_INVOICED");
  });
});
