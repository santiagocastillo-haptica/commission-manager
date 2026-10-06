/**
 * Fechas de negocio.
 *
 * Todas las fechas administrativas (venta, emisión, recaudo, cortes) son fechas civiles de Colombia
 * (America/Bogota, UTC-5 sin horario de verano). Se manejan como texto "YYYY-MM-DD" en la aplicación
 * y como columnas DATE en PostgreSQL, de modo que nunca se desplazan por zona horaria.
 */

export const TIMEZONE = "America/Bogota";

export type DateOnly = string; // "YYYY-MM-DD"

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value: string): value is DateOnly {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Convierte "YYYY-MM-DD" a Date a medianoche UTC (así lo guarda/lee Prisma para columnas DATE). */
export function toDbDate(value: DateOnly): Date {
  if (!isDateOnly(value)) throw new Error(`Fecha inválida: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

/** Convierte un Date de columna DATE a "YYYY-MM-DD". */
export function fromDbDate(value: Date): DateOnly {
  return value.toISOString().slice(0, 10);
}

/** Fecha de hoy en Colombia, sin importar la zona horaria del servidor. */
export function todayBogota(now: Date = new Date()): DateOnly {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA entrega YYYY-MM-DD
}

/** "2026-03-15" → "2026-03". */
export function monthKey(value: DateOnly): string {
  return value.slice(0, 7);
}

export function yearOf(value: DateOnly): number {
  return Number(value.slice(0, 4));
}

/** Último día del mes "YYYY-MM". */
export function endOfMonth(yearMonth: string): DateOnly {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${yearMonth}-${String(last).padStart(2, "0")}`;
}

export function startOfMonth(yearMonth: string): DateOnly {
  return `${yearMonth}-01`;
}

export function addMonths(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_SHORT_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-10-15" → "15 oct 2026". */
export function formatDate(value: DateOnly | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  return `${d} ${MONTHS_SHORT_ES[m - 1]} ${y}`;
}

/** "2026-01" → "enero 2026". */
export function formatMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${MONTHS_ES[m - 1]} ${y}`;
}

/** "2026-01" → "ene 26". */
export function formatMonthShort(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${MONTHS_SHORT_ES[m - 1]} ${String(y).slice(2)}`;
}

export function monthName(m: number): string {
  return MONTHS_ES[m - 1];
}
