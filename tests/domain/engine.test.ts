import { describe, expect, it } from "vitest";
import { assignmentSummary } from "@/domain/commission";
import { D } from "@/domain/money";
import { effectiveRate, evaluateMonth, type PolicyKind, type Tier } from "@/domain/policies";
import { projectFinancials } from "@/domain/project-status";
import { settlementForCollectionDate, settlementPeriod } from "@/domain/periods";
import {
  calculateSettlement,
  type PriorCommit,
  type SettlementCollection,
  type SettlementInput,
  type SettlementInvoice,
  type SettlementProject,
} from "@/domain/settlement";

// ───────────── Constructores de datos de prueba ─────────────

const GOAL = "390000000";
const TIERS: Tier[] = [
  { min: "0", factor: "0", effectiveFrom: "2025-01-01" },
  { min: "0.7", factor: "0.5", effectiveFrom: "2025-01-01" },
  { min: "1", factor: "1", effectiveFrom: "2025-01-01" },
  { min: "1.2", factor: "1.5", effectiveFrom: "2025-01-01" },
];

const rateFor = (kind: PolicyKind, sales: string, base = "0.01", ym = "2026-01") =>
  effectiveRate(kind, base, evaluateMonth(ym, sales, GOAL), TIERS).rate;
const general = (sales: string) => rateFor("GENERAL_THRESHOLD", sales);
const nicholle = (sales: string) => rateFor("GAMIFICATION_TIERS", sales);

let seq = 0;
const id = (p: string) => `${p}${++seq}`;

function collection(date: string, amount: string, fx = "1", currency = "COP"): SettlementCollection {
  return { id: id("col"), date, amountReceived: amount, currency, fxRate: fx, voided: false };
}
function invoice(amount: string, collections: SettlementCollection[] = [], number = id("FE-")): SettlementInvoice {
  return { id: id("inv"), number, status: "ISSUED", issueDate: "2026-01-20", amountPreTax: amount, voided: false, collections };
}
interface ProjectOpts {
  saleAmount: string;
  costs?: string;
  currency?: string;
  saleMonth?: string;
  assignments: { collaboratorId: string; base?: string; rate: string | null }[];
  invoices: SettlementInvoice[];
  adjustments?: SettlementProject["adjustments"];
}
function project(o: ProjectOpts): SettlementProject {
  return {
    id: id("prj"),
    code: "HAP-TEST",
    name: "Proyecto de prueba",
    currency: o.currency ?? "COP",
    saleAmount: o.saleAmount,
    netBase: D(o.saleAmount).minus(o.costs ?? 0).toFixed(),
    saleMonth: o.saleMonth ?? "2026-01",
    voided: false,
    assignments: o.assignments.map((a) => ({ id: id("asg"), collaboratorId: a.collaboratorId, baseRate: a.base ?? "0.01", effectiveRate: a.rate })),
    invoices: o.invoices,
    adjustments: o.adjustments ?? [],
  };
}
const OCT26 = settlementPeriod(2026, "OCTOBER");
const APR27 = settlementPeriod(2027, "APRIL");
const run = (projects: SettlementProject[], p = OCT26, prior: PriorCommit[] = [], extra: Partial<SettlementInput> = {}) =>
  calculateSettlement({ period: p, projects, priorCommits: prior, ...extra });
const commitsOf = (r: ReturnType<typeof run>): PriorCommit[] =>
  r.lines.filter((l) => l.type === "COLLECTION").map((l) => ({ collectionId: l.collectionId!, assignmentId: l.assignmentId }));
const total = (r: ReturnType<typeof run>, who: string) => r.totals.find((t) => t.collaboratorId === who)!;

// ───────────── Los 15 escenarios obligatorios ─────────────

describe("1. Proyecto vendido en un mes que NO supera la meta", () => {
  it("la política general da 0 % y no se genera comisión aunque haya recaudo", () => {
    const rate = general("389999999.99");
    expect(rate.isZero()).toBe(true);
    const prj = project({ saleAmount: "100000000", assignments: [{ collaboratorId: "ana", rate: rate.toFixed() }], invoices: [invoice("100000000", [collection("2026-05-10", "100000000")])] });
    const r = run([prj]);
    expect(r.lines).toHaveLength(0);
    expect(r.grand.netPayable.isZero()).toBe(true);
  });
});

describe("2. Proyecto vendido en un mes que SÍ supera la meta", () => {
  it("genera 1 % sobre lo recaudado", () => {
    const rate = general("400000000");
    expect(rate.toFixed()).toBe("0.01");
    const prj = project({ saleAmount: "100000000", assignments: [{ collaboratorId: "ana", rate: rate.toFixed() }], invoices: [invoice("100000000", [collection("2026-05-10", "100000000")])] });
    const r = run([prj]);
    expect(r.lines).toHaveLength(1);
    expect(total(r, "ana").gross.toFixed()).toBe("1000000");
  });
});

describe("3. Ventas exactamente de $390M (regla inclusiva confirmada)", () => {
  it("con $390.000.000 exactos la meta SE alcanza y todos cobran", () => {
    expect(general("390000000").toFixed()).toBe("0.01");
    expect(nicholle("390000000").toFixed()).toBe("0.01");
    expect(evaluateMonth("2026-01", "390000000", GOAL).reached).toBe(true);
  });
  it("un centavo por debajo ya no alcanza la meta general", () => {
    expect(general("389999999.99").isZero()).toBe(true);
    expect(evaluateMonth("2026-01", "389999999.99", GOAL).reached).toBe(false);
  });
});

describe("4. Proyecto con varios colaboradores", () => {
  it("cada uno cobra su propio porcentaje sobre la misma base", () => {
    const prj = project({
      saleAmount: "200000000",
      assignments: [{ collaboratorId: "ana", rate: "0.01" }, { collaboratorId: "beto", rate: "0.005" }, { collaboratorId: "carla", rate: "0.008" }],
      invoices: [invoice("200000000", [collection("2026-06-01", "200000000")])],
    });
    const r = run([prj]);
    expect(total(r, "ana").gross.toFixed()).toBe("2000000");
    expect(total(r, "beto").gross.toFixed()).toBe("1000000");
    expect(total(r, "carla").gross.toFixed()).toBe("1600000");
    expect(r.grand.gross.toFixed()).toBe("4600000");
  });
});

describe("5. Proyecto con tres facturas y recaudos parciales", () => {
  it("solo se comisiona lo recaudado y el saldo genera comisión en liquidaciones futuras", () => {
    const i1 = invoice("100000000", [collection("2026-05-01", "100000000")]);
    const i2 = invoice("100000000", [collection("2026-06-01", "40000000")]);
    const i3 = invoice("100000000");
    const prj = project({ saleAmount: "300000000", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [i1, i2, i3] });

    const s1 = run([prj]);
    expect(total(s1, "ana").gross.toFixed()).toBe("1400000"); // (100M + 40M) × 1 %
    expect(s1.lines).toHaveLength(2);

    // Después llega el resto de la factura 2 y el total de la 3.
    i2.collections.push(collection("2026-11-10", "60000000"));
    i3.collections.push(collection("2026-12-15", "100000000"));
    const s2 = run([prj], APR27, commitsOf(s1));
    expect(total(s2, "ana").gross.toFixed()).toBe("1600000"); // (60M + 100M) × 1 %
    expect(s2.lines.map((l) => l.invoiceId)).not.toContain(i1.id);
  });
});

describe("6. Recaudos de distintos períodos de liquidación", () => {
  it("agosto 2026 → octubre 2026; noviembre 2026 → abril 2027", () => {
    expect(settlementForCollectionDate("2026-08-20").code).toBe("LIQ-2026-10");
    expect(settlementForCollectionDate("2026-11-05").code).toBe("LIQ-2027-04");

    const aug = collection("2026-08-20", "50000000");
    const nov = collection("2026-11-05", "50000000");
    const prj = project({ saleAmount: "100000000", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("50000000", [aug]), invoice("50000000", [nov])] });

    const oct = run([prj], OCT26);
    expect(oct.lines.map((l) => l.collectionId)).toEqual([aug.id]);
    const apr = run([prj], APR27, commitsOf(oct));
    expect(apr.lines.map((l) => l.collectionId)).toEqual([nov.id]);
  });
});

describe("7. Venta en moneda extranjera con recaudos parciales a distintas TRM", () => {
  it("convierte cada recaudo con la TRM de su fecha; la venta cuenta para la meta con la TRM de referencia", () => {
    // La venta de USD 50.000 con TRM de referencia 4.000 aporta $200M a las ventas del mes.
    expect(D(50000).mul(4000).toFixed()).toBe("200000000");

    const prj = project({
      saleAmount: "50000",
      costs: "10000",
      currency: "USD",
      assignments: [{ collaboratorId: "ana", rate: "0.01" }],
      invoices: [invoice("50000", [collection("2026-05-10", "20000", "4100", "USD"), collection("2026-08-20", "30000", "3900", "USD")])],
    });
    const r = run([prj]);
    const [a, b] = r.lines;
    // 20.000 × 0,8 × 1 % × 4.100 = 656.000 · 30.000 × 0,8 × 1 % × 3.900 = 936.000
    expect(a.commissionCOP.toFixed()).toBe("656000");
    expect(b.commissionCOP.toFixed()).toBe("936000");
    expect(a.fxRate.toFixed()).toBe("4100");
    expect(b.fxRate.toFixed()).toBe("3900");
    expect(total(r, "ana").gross.toFixed()).toBe("1592000");
  });
});

describe("8. Proyecto con costos de proveedores", () => {
  it("la comisión se calcula sobre la base neta, no sobre la venta", () => {
    const prj = project({ saleAmount: "100000000", costs: "30000000", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("100000000", [collection("2026-05-10", "100000000")])] });
    const r = run([prj]);
    expect(r.lines[0].netBaseOriginal.toFixed()).toBe("70000000");
    expect(total(r, "ana").gross.toFixed()).toBe("700000");
  });
  it("los costos se distribuyen proporcionalmente entre las facturas", () => {
    const prj = project({ saleAmount: "100000000", costs: "40000000", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("25000000", [collection("2026-05-10", "25000000")])] });
    expect(run([prj]).lines[0].netBaseOriginal.toFixed()).toBe("15000000");
  });
});

describe("9. Nicholle con cumplimiento inferior al 70 %", () => {
  it("0 % y sin comisión", () => {
    expect(nicholle("272999999.99").isZero()).toBe(true);
    const prj = project({ saleAmount: "100000000", assignments: [{ collaboratorId: "nic", rate: nicholle("200000000").toFixed() }], invoices: [invoice("100000000", [collection("2026-05-10", "100000000")])] });
    expect(run([prj]).lines).toHaveLength(0);
  });
});

describe("10. Nicholle con cumplimiento del 70 %, 100 % y 120 %", () => {
  it("aplica los tramos con límite inferior inclusivo", () => {
    expect(nicholle("273000000").toFixed()).toBe("0.005"); // 70 %
    expect(nicholle("389999999.99").toFixed()).toBe("0.005"); // justo debajo de 100 %
    expect(nicholle("390000000").toFixed()).toBe("0.01"); // 100 %
    expect(nicholle("467999999.99").toFixed()).toBe("0.01"); // justo debajo de 120 %
    expect(nicholle("468000000").toFixed()).toBe("0.015"); // 120 %
    expect(nicholle("900000000").toFixed()).toBe("0.015");
  });
  it("conserva el porcentaje base y el efectivo por separado y paga sobre el efectivo", () => {
    const prj = project({ saleAmount: "100000000", assignments: [{ collaboratorId: "nic", base: "0.01", rate: nicholle("468000000").toFixed() }], invoices: [invoice("100000000", [collection("2026-05-10", "100000000")])] });
    const [line] = run([prj]).lines;
    expect(line.baseRate.toFixed()).toBe("0.01");
    expect(line.effectiveRate.toFixed()).toBe("0.015");
    expect(line.commissionCOP.toFixed()).toBe("1500000");
  });
  it("la escala reemplaza la meta: cobra con 70 % aunque la política general pague 0", () => {
    expect(general("300000000").isZero()).toBe(true);
    expect(nicholle("300000000").toFixed()).toBe("0.005");
  });
  it("explica la regla aplicada", () => {
    const e = effectiveRate("GAMIFICATION_TIERS", "0.01", evaluateMonth("2026-01", "468000000", GOAL), TIERS);
    expect(e.rule).toMatch(/120,00 %/);
    expect(e.rule).toMatch(/1,5/);
  });
});

describe("11. Nota crédito posterior a una liquidación", () => {
  const build = (withAdjustment: boolean) =>
    project({
      saleAmount: "100000000",
      assignments: [{ collaboratorId: "ana", rate: "0.01" }],
      invoices: [invoice("100000000", [collection("2026-05-10", "100000000")], "FE-NC")],
      adjustments: withAdjustment ? [{ id: "nc1", invoiceId: null, amount: "20000000", status: "PENDING", voided: false }] : [],
    });

  it("genera una línea compensatoria negativa en la liquidación posterior", () => {
    const original = build(false);
    const s1 = run([original]);
    expect(total(s1, "ana").gross.toFixed()).toBe("1000000");

    const withNC = build(true);
    withNC.invoices = original.invoices; // mismas facturas y recaudos
    withNC.assignments = original.assignments;
    const s2 = run([withNC], APR27, commitsOf(s1));
    expect(s2.lines.filter((l) => l.type === "COLLECTION")).toHaveLength(0);
    const adj = s2.lines.filter((l) => l.type === "ADJUSTMENT");
    expect(adj).toHaveLength(1);
    expect(adj[0].commissionCOP.toFixed()).toBe("-200000"); // 20M × 1 %
    expect(adj[0].adjustmentId).toBe("nc1");
  });

  it("un saldo negativo se arrastra a la siguiente liquidación y no se cobra al colaborador", () => {
    const original = build(false);
    const s1 = run([original]);
    const withNC = build(true);
    withNC.invoices = original.invoices;
    withNC.assignments = original.assignments;
    const s2 = run([withNC], APR27, commitsOf(s1));
    const t = total(s2, "ana");
    expect(t.netPayable.isZero()).toBe(true);
    expect(t.carryoverOut.toFixed()).toBe("-200000");

    // La siguiente liquidación descuenta el arrastre de nuevas comisiones.
    const later = project({ saleAmount: "100000000", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("100000000", [collection("2027-05-10", "100000000")])] });
    const s3 = run([later], settlementPeriod(2027, "OCTOBER"), [], { carryovers: { ana: t.carryoverOut } });
    expect(total(s3, "ana").netPayable.toFixed()).toBe("800000");
  });

  it("una nota crédito reduce el valor de la factura: lo que el cliente paga ya viene neto y no se descuenta dos veces", () => {
    const prj = project({
      saleAmount: "100000000",
      assignments: [{ collaboratorId: "ana", rate: "0.01" }],
      invoices: [{ ...invoice("100000000", [collection("2026-05-10", "80000000")], "FE-X"), id: "inv-x" }],
      adjustments: [{ id: "nc2", invoiceId: "inv-x", amount: "20000000", status: "PENDING", voided: false, kind: "CREDIT_NOTE" }],
    });
    const r = run([prj]);
    // Factura efectiva 80M con base 80M: el cliente paga 80M y se comisionan los 80M completos.
    expect(total(r, "ana").gross.toFixed()).toBe("800000");
    expect(r.lines.filter((l) => l.type === "ADJUSTMENT")).toHaveLength(0);
  });

  it("las liquidaciones históricas no cambian: recalcular la anterior con los mismos datos da el mismo resultado", () => {
    const original = build(false);
    const before = run([original]);
    const snapshot = JSON.stringify(before.lines.map((l) => [l.collectionId, l.commissionCOP.toFixed()]));
    // Ocurren operaciones posteriores (ajuste, nuevas liquidaciones)…
    const withNC = build(true);
    withNC.invoices = original.invoices;
    withNC.assignments = original.assignments;
    run([withNC], APR27, commitsOf(before));
    // …y la foto de la liquidación cerrada sigue siendo la misma.
    const after = run([original]);
    expect(JSON.stringify(after.lines.map((l) => [l.collectionId, l.commissionCOP.toFixed()]))).toBe(snapshot);
  });
});

describe("12. Intento de liquidar dos veces un mismo recaudo", () => {
  it("un recaudo ya comprometido no genera una segunda línea", () => {
    const prj = project({ saleAmount: "100000000", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("100000000", [collection("2026-05-10", "100000000")])] });
    const first = run([prj]);
    expect(first.lines).toHaveLength(1);
    const again = run([prj], OCT26, commitsOf(first));
    expect(again.lines).toHaveLength(0);
    const nextPeriod = run([prj], APR27, commitsOf(first));
    expect(nextPeriod.lines).toHaveLength(0);
    expect(nextPeriod.grand.netPayable.isZero()).toBe(true);
  });
});

describe("13. Proyecto vendido en un período anterior y recaudado en el actual", () => {
  it("entra en la liquidación del período del recaudo con el porcentaje fijado en la venta", () => {
    const prj = project({
      saleAmount: "100000000",
      saleMonth: "2025-11",
      assignments: [{ collaboratorId: "ana", rate: "0.01" }], // fijado al validar noviembre 2025
      invoices: [invoice("100000000", [collection("2026-05-04", "100000000")])],
    });
    const r = run([prj], OCT26);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].detail.saleMonth).toBe("2025-11");
    expect(total(r, "ana").gross.toFixed()).toBe("1000000");
    expect(r.lines[0].isLate).toBe(false);
  });
});

describe("14. Proyecto con facturación y recaudo completos", () => {
  it("la comisión total es exactamente porcentaje × base neta, y el estado es «recaudado»", () => {
    const invs = [
      invoice("100000000", [collection("2026-04-10", "100000000")]),
      invoice("100000000", [collection("2026-05-10", "100000000")]),
      invoice("100000000", [collection("2026-06-10", "100000000")]),
    ];
    const prj = project({ saleAmount: "300000000", costs: "60000000", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: invs });
    const r = run([prj]);
    expect(total(r, "ana").gross.toFixed()).toBe("2400000"); // 240M × 1 %
    const fin = projectFinancials("300000000", 3, invs.map((i) => ({ status: "ISSUED", amountPreTax: i.amountPreTax, voided: false, collected: "100000000" })));
    expect(fin.billingStatus).toBe("INVOICED");
    expect(fin.collectionStatus).toBe("COLLECTED");

    const sum = assignmentSummary({ saleAmount: "300000000", netBase: "240000000", currency: "COP", saleReferenceRate: "1", invoices: invs.map((i) => ({ ...i, status: "ISSUED" as const, collections: i.collections })), adjustments: [] }, "0.01", "0.01");
    expect(sum.generatedCOP.toFixed()).toBe("2400000");
    expect(sum.potentialCOP!.toFixed()).toBe("2400000");
  });
});

describe("15. Proyecto con facturación parcial y saldo pendiente", () => {
  it("la comisión generada es parcial y el saldo potencial queda pendiente", () => {
    const invs = [invoice("100000000", [collection("2026-05-10", "100000000")]), invoice("100000000")];
    const facts = { saleAmount: "300000000", netBase: "240000000", currency: "COP", saleReferenceRate: "1", invoices: invs.map((i) => ({ ...i, status: "ISSUED" as const, collections: i.collections })), adjustments: [] };
    const s = assignmentSummary(facts, "0.01", "0.01");
    expect(s.potentialCOP!.toFixed()).toBe("2400000");
    expect(s.generatedCOP.toFixed()).toBe("800000"); // 100M × 0,8 × 1 %
    expect(s.potentialCOP!.minus(s.generatedCOP).toFixed()).toBe("1600000"); // saldo potencial pendiente
    const fin = projectFinancials("300000000", 3, invs.map((i, n) => ({ status: "ISSUED", amountPreTax: i.amountPreTax, voided: false, collected: n === 0 ? "100000000" : "0" })));
    expect(fin.billingStatus).toBe("PARTIAL");
    expect(fin.collectionStatus).toBe("PARTIAL");
    expect(fin.pendingToInvoice.toFixed()).toBe("100000000");
  });
});

// ───────────── Casos adicionales de robustez ─────────────

describe("alertas y casos límite", () => {
  it("un mes sin validar no genera comisión y emite alerta", () => {
    const prj = project({ saleAmount: "100000000", assignments: [{ collaboratorId: "ana", rate: null }], invoices: [invoice("100000000", [collection("2026-05-10", "100000000")])] });
    const r = run([prj]);
    expect(r.lines).toHaveLength(0);
    expect(r.alerts.map((a) => a.code)).toContain("PENDING_VALIDATION");
  });

  it("un recaudo registrado tarde (fecha anterior al período) entra como extemporáneo", () => {
    const prj = project({ saleAmount: "100000000", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("100000000", [collection("2026-02-10", "100000000")])] });
    const r = run([prj], OCT26);
    expect(r.lines[0].isLate).toBe(true);
    expect(r.alerts.map((a) => a.code)).toContain("LATE_COLLECTIONS");
  });

  it("los recaudos posteriores al fin del período no entran", () => {
    const prj = project({ saleAmount: "100000000", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("100000000", [collection("2026-10-01", "100000000")])] });
    expect(run([prj], OCT26).lines).toHaveLength(0);
  });

  it("una venta en moneda extranjera con TRM 1 se marca como recaudo sin tasa (bloqueante)", () => {
    const prj = project({ saleAmount: "1000", currency: "USD", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("1000", [collection("2026-05-10", "1000", "1", "USD")])] });
    const alert = run([prj]).alerts.find((a) => a.code === "MISSING_FX");
    expect(alert?.severity).toBe("BLOCKING");
  });

  it("detecta recaudos duplicados (mismo valor y fecha) y números de factura repetidos entre proyectos", () => {
    const dup = project({ saleAmount: "100", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("200", [collection("2026-05-10", "100"), collection("2026-05-10", "100")], "FE-DUP")] });
    const other = project({ saleAmount: "100", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("100", [], "FE-DUP")] });
    const r = run([dup, other]);
    expect(r.alerts.filter((a) => a.code === "POSSIBLE_DUPLICATE").length).toBeGreaterThanOrEqual(2);
  });

  it("alerta cuando las bases asignadas a las facturas no cuadran con la base del proyecto", () => {
    const inv = { ...invoice("100000000", [], "FE-MM"), netBaseExplicit: "90000000" };
    const prj = project({ saleAmount: "100000000", costs: "30000000", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [inv] });
    expect(run([prj]).alerts.map((a) => a.code)).toContain("NET_BASE_MISMATCH");
  });

  it("no hay errores de punto flotante: 0,1 + 0,2 de comisión suman exactamente", () => {
    const prj = project({ saleAmount: "30", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("10", [collection("2026-05-10", "10")]), invoice("20", [collection("2026-05-11", "20")])] });
    expect(total(run([prj]), "ana").gross.toFixed()).toBe("0.3");
  });

  it("un proyecto anulado no genera comisión", () => {
    const prj = project({ saleAmount: "100", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("100", [collection("2026-05-10", "100")])] });
    prj.voided = true;
    expect(run([prj]).lines).toHaveLength(0);
  });
});


// ───────────── Hallazgos de la revisión independiente ─────────────

describe("topes, ajustes y compensaciones (revisión independiente)", () => {
  it("un recaudo con excedente no comisiona más allá de la base de la factura", () => {
    const prj = project({
      saleAmount: "100000000",
      assignments: [{ collaboratorId: "ana", rate: "0.01" }],
      invoices: [invoice("100000000", [collection("2026-05-10", "100000000"), collection("2026-06-10", "10000000")])],
    });
    expect(total(run([prj]), "ana").gross.toFixed()).toBe("1000000"); // no 1.100.000
  });

  it("un ajuste de costos de proveedores reduce solo la base, no el valor de la factura", () => {
    const prj = project({
      saleAmount: "100000000",
      assignments: [{ collaboratorId: "ana", rate: "0.01" }],
      invoices: [{ ...invoice("100000000", [collection("2026-05-10", "100000000")], "FE-C"), id: "inv-c" }],
      adjustments: [{ id: "pc1", invoiceId: "inv-c", amount: "20000000", status: "PENDING", voided: false, kind: "PROVIDER_COST" }],
    });
    expect(total(run([prj]), "ana").gross.toFixed()).toBe("800000");
  });

  it("un ajuste de proyecto se aplica completo aunque alguna factura tenga base explícita cero (el sobrante se redistribuye)", () => {
    const a = { ...invoice("100000000", [collection("2026-05-10", "100000000")], "FE-A"), id: "inv-a", netBaseExplicit: "100000000" };
    const b = { ...invoice("100000000", [], "FE-B"), id: "inv-b", netBaseExplicit: "0" };
    const prj = project({
      saleAmount: "200000000",
      costs: "100000000",
      assignments: [{ collaboratorId: "ana", rate: "0.01" }],
      invoices: [a, b],
      adjustments: [{ id: "pj1", invoiceId: null, amount: "50000000", status: "PENDING", voided: false, kind: "PROVIDER_COST" }],
    });
    // Los 50M caen enteros sobre la factura A (la única con base): 100M − 50M = 50M → 500.000.
    expect(total(run([prj]), "ana").gross.toFixed()).toBe("500000");
  });

  it("varios ajustes sobre varios recaudos ya liquidados: cada ajuste se compensa por separado y la suma cuadra", () => {
    const inv = { ...invoice("100000000", [collection("2026-05-10", "60000000"), collection("2026-06-10", "40000000")], "FE-M"), id: "inv-m" };
    const base = project({ saleAmount: "100000000", assignments: [{ collaboratorId: "ana", rate: "0.01" }, { collaboratorId: "beto", rate: "0.005" }], invoices: [inv] });
    const s1 = run([base]);
    expect(total(s1, "ana").gross.toFixed()).toBe("1000000");
    expect(total(s1, "beto").gross.toFixed()).toBe("500000");

    const withAdj = {
      ...base,
      adjustments: [
        { id: "nc-1", invoiceId: "inv-m", amount: "10000000", status: "PENDING" as const, voided: false, kind: "CREDIT_NOTE" as const },
        { id: "pc-1", invoiceId: "inv-m", amount: "10000000", status: "PENDING" as const, voided: false, kind: "PROVIDER_COST" as const },
      ],
    };
    const s2 = run([withAdj], APR27, commitsOf(s1));
    const adj = s2.lines.filter((l) => l.type === "ADJUSTMENT");
    expect(adj).toHaveLength(4); // 2 ajustes × 2 colaboradores
    // Base total liquidada 100M → 80M efectiva: reducción total 20M → Ana −200.000, Beto −100.000.
    expect(total(s2, "ana").adjustments.toFixed()).toBe("-200000");
    expect(total(s2, "beto").adjustments.toFixed()).toBe("-100000");
    // Cada ajuste aporta la mitad (10M de 20M).
    expect(adj.filter((l) => l.adjustmentId === "nc-1" && l.collaboratorId === "ana")[0].commissionCOP.toFixed()).toBe("-100000");
  });

  it("compensación en moneda extranjera: usa la TRM del recaudo al que se imputa la reducción", () => {
    const inv = { ...invoice("100", [collection("2026-05-10", "50", "4000", "USD"), collection("2026-06-10", "50", "4200", "USD")], "FE-U"), id: "inv-u" };
    const base = project({ saleAmount: "100", currency: "USD", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [inv] });
    const s1 = run([base]);
    expect(total(s1, "ana").gross.toFixed()).toBe("4100"); // 50×1%×4000 + 50×1%×4200
    const withNC = { ...base, adjustments: [{ id: "nc-u", invoiceId: "inv-u", amount: "20", status: "PENDING" as const, voided: false, kind: "CREDIT_NOTE" as const }] };
    const s2 = run([withNC], APR27, commitsOf(s1));
    // La reducción de 20 recae sobre el recaudo más reciente (TRM 4.200): −20 × 1 % × 4.200.
    expect(total(s2, "ana").adjustments.toFixed()).toBe("-840");
  });

  it("un ajuste mayor que la base disponible solo reduce hasta la base", () => {
    const inv = { ...invoice("100", [collection("2026-05-10", "100")], "FE-Z"), id: "inv-z" };
    const base = project({ saleAmount: "100", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [inv] });
    const s1 = run([base]);
    const big = { ...base, adjustments: [{ id: "big", invoiceId: "inv-z", amount: "500", status: "PENDING" as const, voided: false, kind: "CREDIT_NOTE" as const }] };
    const s2 = run([big], APR27, commitsOf(s1));
    expect(total(s2, "ana").adjustments.toFixed()).toBe("-1"); // como máximo lo ya comisionado
  });

  it("sin escala vigente la política de gamificación falla de forma explícita", () => {
    expect(() => effectiveRate("GAMIFICATION_TIERS", "0.01", evaluateMonth("2026-01", "468000000", GOAL), [])).toThrow(/escala/);
  });

  it("la TRM faltante solo bloquea si el recaudo es candidato de esta liquidación", () => {
    const prj = project({ saleAmount: "1000", currency: "USD", assignments: [{ collaboratorId: "ana", rate: "0.01" }], invoices: [invoice("1000", [collection("2027-01-10", "1000", "1", "USD")])] });
    expect(run([prj], OCT26).alerts.some((a) => a.code === "MISSING_FX")).toBe(false); // recaudo posterior al período
    expect(run([prj], APR27).alerts.some((a) => a.code === "MISSING_FX")).toBe(true);
  });
});
