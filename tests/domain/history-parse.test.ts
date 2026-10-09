import { describe, expect, it } from "vitest";
import { liquidationForLabel } from "@/server/import/history-load";
import { normalizeCode, parseHistoryWorkbook } from "@/server/import/history";
import { historyWorkbook } from "../helpers/history-workbook";

const TODAY = "2026-10-09";
const p = (code: string, over: Record<number, string | number | null> = {}) => {
  const row: (string | number | null)[] = [code, "Cliente SA", "CO", "2025-01-10", "COP", 100000000, 0, null, 2, ""];
  for (const [i, v] of Object.entries(over)) row[Number(i)] = v;
  return row;
};
const kinds = (r: ReturnType<typeof parseHistoryWorkbook>) => r.issues.map((i) => `${i.severity}:${i.type}`);

describe("lector de la plantilla de historia", () => {
  it("interpreta una plantilla correcta e ignora la fila de ejemplo", () => {
    const { plan, issues } = parseHistoryWorkbook(
      historyWorkbook({
        Proyectos: [p("ISA-01")],
        Asignaciones: [["ISA-01", "Ana@Haptica.co", 1], ["ISA-01", "luis@haptica.co", 0.5]],
        Facturas: [
          ["ISA-01", "FV1", "RECAUDADA", "2025-02-01", "2025-03-10", 40000000, null, ""],
          ["ISA-01", "FV2", "EMITIDA", "2026-09-17", "2026-11-04", 30000000, null, ""],
          ["ISA-01", null, "PREVISTA", null, null, 30000000, null, ""],
        ],
      }),
      TODAY,
    );
    expect(issues.filter((i) => i.severity === "Bloqueante")).toEqual([]);
    expect(plan.projects).toHaveLength(1);
    const proj = plan.projects[0];
    expect(proj).toMatchObject({ code: "ISA-01", country: "CO", sale: "100000000", expectedInvoices: 3 }); // se sube a la cantidad de facturas
    expect(proj.assignments.map((a) => [a.email, a.pct])).toEqual([["ana@haptica.co", "1"], ["luis@haptica.co", "0.5"]]);
    expect(plan.emails).toEqual(["ana@haptica.co", "luis@haptica.co"]);
    const [paid, pending, planned] = proj.invoices;
    expect(paid).toMatchObject({ status: "ISSUED", number: "FV1", collections: [{ date: "2025-03-10", amount: "40000000" }] });
    expect(pending).toMatchObject({ status: "ISSUED", number: "FV2", dueDate: "2026-11-04", collections: [] }); // la fecha de una EMITIDA es el vencimiento
    expect(planned).toMatchObject({ status: "PLANNED", number: null, issueDate: null });
  });

  it("detecta códigos repetidos, referencias inexistentes y filas incompletas", () => {
    const r = parseHistoryWorkbook(
      historyWorkbook({
        Proyectos: [p("DUP-01"), p("DUP-01", { 3: "2025-02-02" }), p("OK-01")],
        Asignaciones: [["DUP-01", "a@h.co", 1], ["NOPE-01", "a@h.co", 1], ["OK-01", "malcorreo", 1], ["OK-01", "b@h.co", 2], ["OK-01", null, null]],
        Facturas: [[null, null, "PREVISTA", null, null, 10], ["NOPE-01", "F1", "EMITIDA", "2025-01-02", null, 10], ["OK-01", null, "EMITIDA", "2025-01-02", null, 10], ["OK-01", "F2", "EMITIDA", null, null, 10]],
      }),
      TODAY,
    );
    const k = kinds(r);
    expect(k.filter((x) => x === "Bloqueante:Código repetido")).toHaveLength(2);
    expect(k).toContain("Bloqueante:Asignación a proyecto inexistente");
    expect(k).toContain("Bloqueante:Correo inválido");
    expect(k).toContain("Bloqueante:Porcentaje fuera de rango");
    expect(k).toContain("Aceptado:Proyecto sin colaborador");
    expect(k).toContain("Bloqueante:Factura sin proyecto");
    expect(k).toContain("Bloqueante:Factura a proyecto inexistente");
    expect(k).toContain("Bloqueante:Factura emitida sin número");
    expect(k).toContain("Bloqueante:Factura emitida sin fecha de emisión");
  });

  it("valida fechas de recaudo, país, moneda, TRM y valores", () => {
    const r = parseHistoryWorkbook(
      historyWorkbook({
        Proyectos: [p("A-001", { 2: "BR" }), p("B-001", { 4: "EUR" }), p("C-001", { 4: "USD" }), p("D-001", { 3: "2024-01-01" }), p("E-001", { 5: 0 }), p("F-001", { 6: 200000000 })],
        Facturas: [
          ["A-001", "F1", "RECAUDADA", "2025-03-10", "2025-01-10", 10, null, ""],
          ["A-001", "F2", "RECAUDADA", "2025-01-10", "2027-01-01", 10, null, ""],
          ["A-001", "F3", "RECAUDADA", "2025-01-10", null, 10, null, ""],
          ["A-001", "F4", "COBRADA", "2025-01-10", null, 10, null, ""],
          ["A-001", "F5", "EMITIDA", "2025-01-10", null, 0, null, ""],
        ],
      }),
      TODAY,
    );
    const k = kinds(r);
    for (const t of ["País no válido", "Moneda no válida", "Falta TRM de venta", "Fecha de venta fuera de rango", "Valor de venta inválido", "Costos superan la venta", "Recaudo anterior a la emisión", "Recaudo en el futuro", "RECAUDADA sin fecha de recaudo", "Estado inválido", "Valor de factura inválido"]) {
      expect(k, t).toContain(`Bloqueante:${t}`);
    }
  });

  it("redondea a centavos, absorbe diferencias de redondeo de hasta un peso y avisa cuando lo facturado supera la venta", () => {
    const r = parseHistoryWorkbook(
      historyWorkbook({
        Proyectos: [p("R-001", { 5: 63193277 }), p("S-001", { 5: 1000 })],
        Facturas: [
          ["R-001", "F1", "EMITIDA", "2025-01-10", null, 21064425.666666668, null, ""],
          ["R-001", "F2", "EMITIDA", "2025-01-10", null, 21064425.666666668, null, ""],
          ["R-001", "F3", "EMITIDA", "2025-01-10", null, 21064425.666666668, null, ""],
          ["S-001", "G1", "EMITIDA", "2025-01-10", null, 1500, null, ""],
        ],
      }),
      TODAY,
    );
    const k = kinds(r);
    expect(k).toContain("Menor:Venta ajustada por redondeo");
    expect(r.plan.projects.find((x) => x.code === "R-001")!.sale).toBe("63193277.01");
    expect(k).toContain("Decisión:Facturado supera la venta");
    expect(r.issues.some((i) => i.severity === "Bloqueante")).toBe(false);
  });

  it("normaliza códigos y los avisa; admite &; usa las hojas Recaudos y Ajustes si existen", () => {
    expect(normalizeCode("SPIN-05 (vip+)")).toBe("SPIN-05-vip");
    expect(normalizeCode("J&J-06")).toBe("J&J-06");
    const r = parseHistoryWorkbook(
      historyWorkbook(
        {
          Proyectos: [p("J&J-06"), p("SPIN-05 (vip+)")],
          Facturas: [["J&J-06", "F1", "EMITIDA", "2025-01-10", "2025-02-09", 100, null, ""]],
          Recaudos: [["J&J-06", "F1", "2025-01-20", 60, null, "NO", "", ""], ["J&J-06", "F1", "2025-02-01", 40, null, "NO", "", ""], ["J&J-06", "NOEXISTE", "2025-02-01", 40, null, "NO", "", ""]],
          Ajustes: [["J&J-06", "F1", "2025-03-01", "NOTA_CREDITO", "Nota crédito por descuento", 10], ["J&J-06", null, "2025-03-01", "XX", "corto", 10]],
        },
        { synthesized: false },
      ),
      TODAY,
    );
    const k = kinds(r);
    expect(k).toContain("Menor:Código normalizado");
    expect(k).toContain("Bloqueante:Recaudo de una factura inexistente");
    expect(k).toContain("Bloqueante:Ajuste incompleto");
    const proj = r.plan.projects.find((x) => x.code === "J&J-06")!;
    expect(proj.invoices[0].collections.map((c) => c.amount)).toEqual(["60", "40"]);
    expect(proj.invoices[0].dueDate).toBe("2025-02-09"); // en la plantilla original esa columna es el vencimiento
    expect(proj.adjustments).toHaveLength(1);
  });

  it("moneda extranjera: exige la TRM del recaudo", () => {
    const r = parseHistoryWorkbook(historyWorkbook({ Proyectos: [p("U-001", { 4: "USD", 7: 4100 })], Facturas: [["U-001", "F1", "RECAUDADA", "2025-01-10", "2025-02-10", 100, null, ""]] }), TODAY);
    expect(kinds(r)).toContain("Bloqueante:Falta TRM del recaudo");
  });

  it("agrupa los pagos trimestrales por semestre de liquidación", () => {
    expect(["LIQ-2024-Q4", "LIQ-2025-Q1", "LIQ-2025-Q2", "LIQ-2025-Q3", "LIQ-2025-Q4", "LIQ-2025-04", "LIQ-2025-10", "x"].map(liquidationForLabel)).toEqual([
      "LIQ-2025-04", "LIQ-2025-04", "LIQ-2025-10", "LIQ-2025-10", "LIQ-2026-04", "LIQ-2025-04", "LIQ-2025-10", null,
    ]);
  });
});
