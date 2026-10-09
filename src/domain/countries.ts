/** Países donde Háptica vende. El país no determina la moneda: los proyectos se registran en COP, USD, CLP o MXN. */
export const COUNTRIES = [
  { code: "CO", label: "Colombia" },
  { code: "CL", label: "Chile" },
  { code: "MX", label: "México" },
  { code: "GT", label: "Guatemala" },
  { code: "US", label: "Estados Unidos" },
  { code: "EC", label: "Ecuador" },
  { code: "PE", label: "Perú" },
  { code: "AR", label: "Argentina" },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];
export const COUNTRY_CODES = COUNTRIES.map((c) => c.code) as [CountryCode, ...CountryCode[]];
export const COUNTRY_LABEL: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.label]));
export const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.label }));
