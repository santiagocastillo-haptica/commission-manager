import { describe, expect, it } from "vitest";
import { copInWords, numberToWordsEs } from "@/lib/number-words";

describe("valor en letras", () => {
  it("escribe los casos de la carta de bonificación", () => {
    expect(copInWords(177250)).toBe("CIENTO SETENTA Y SIETE MIL DOSCIENTOS CINCUENTA PESOS COP");
    expect(numberToWordsEs(1000)).toBe("MIL");
    expect(numberToWordsEs(21000)).toBe("VEINTIÚN MIL");
    expect(numberToWordsEs(100)).toBe("CIEN");
    expect(numberToWordsEs(101)).toBe("CIENTO UN");
    expect(numberToWordsEs(1_000_000)).toBe("UN MILLÓN");
    expect(numberToWordsEs(2_500_000)).toBe("DOS MILLONES QUINIENTOS MIL");
    expect(numberToWordsEs(31)).toBe("TREINTA Y UN");
    expect(numberToWordsEs(1_234_567)).toBe("UN MILLÓN DOSCIENTOS TREINTA Y CUATRO MIL QUINIENTOS SESENTA Y SIETE");
    expect(copInWords(3_000_000)).toBe("TRES MILLONES DE PESOS COP");
    expect(copInWords(22)).toBe("VEINTIDÓS PESOS COP");
  });
});
