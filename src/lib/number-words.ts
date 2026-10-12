const UNITS = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
const TENS = ["", "", "VEINTI", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const HUNDREDS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function below1000(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (rest > 0) {
    if (rest < 20) parts.push(UNITS[rest]);
    else if (rest < 30) parts.push(rest === 20 ? "VEINTE" : rest === 21 ? "VEINTIÚN" : `VEINTI${UNITS[rest - 20]}`.replace("VEINTIDOS", "VEINTIDÓS").replace("VEINTITRES", "VEINTITRÉS").replace("VEINTISEIS", "VEINTISÉIS"));
    else parts.push(rest % 10 === 0 ? TENS[rest / 10] : `${TENS[Math.floor(rest / 10)]} Y ${UNITS[rest % 10]}`);
  }
  return parts.join(" ");
}

/** Número entero positivo en letras (mayúsculas, apocopado: «UN MILLÓN», «VEINTIÚN MIL»). Hasta billones. */
export function numberToWordsEs(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return "CERO";
  const groups = [
    { size: 1_000_000_000_000, one: "UN BILLÓN", many: "BILLONES" },
    { size: 1_000_000, one: "UN MILLÓN", many: "MILLONES" },
  ];
  let rest = n;
  const parts: string[] = [];
  for (const g of groups) {
    const q = Math.floor(rest / g.size);
    if (q > 0) parts.push(q === 1 ? g.one : `${numberToWordsEs(q)} ${g.many}`);
    rest %= g.size;
  }
  const thousands = Math.floor(rest / 1000);
  if (thousands > 0) parts.push(thousands === 1 ? "MIL" : `${below1000(thousands)} MIL`);
  const units = rest % 1000;
  if (units > 0) parts.push(below1000(units));
  return parts.join(" ");
}

/** «CIENTO SETENTA Y SIETE MIL DOSCIENTOS CINCUENTA PESOS COP». */
export function copInWords(value: number): string {
  const n = Math.round(value);
  const words = numberToWordsEs(n);
  return `${words} ${n === 1 ? "PESO" : n % 1_000_000 === 0 && n >= 1_000_000 ? "DE PESOS" : "PESOS"} COP`;
}
