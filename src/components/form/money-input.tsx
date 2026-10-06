"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function group(int: string) {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Canónico ("1500000.5") → visible es-CO ("1.500.000,5"). Conserva una coma final mientras se escribe. */
function toDisplay(canonical: string): string {
  if (!canonical) return "";
  const [int, frac] = canonical.split(".");
  return frac === undefined ? group(int) : `${group(int)},${frac}`;
}

/**
 * Campo numérico en formato es-CO. El valor del formulario es SIEMPRE la cadena canónica con punto
 * decimal ("1500000.50"), nunca un `number`, para no perder precisión.
 */
export function MoneyInput({
  value,
  onChange,
  decimals = 2,
  prefix,
  suffix,
  invalid,
  className,
  ...rest
}: {
  value: string | undefined;
  onChange: (canonical: string) => void;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  invalid?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"input">, "value" | "onChange" | "prefix" | "type">) {
  function handle(raw: string) {
    const cleaned = raw.replace(/[^\d,]/g, "");
    const comma = cleaned.indexOf(",");
    let int = comma === -1 ? cleaned : cleaned.slice(0, comma);
    let frac = comma === -1 ? undefined : cleaned.slice(comma + 1).replace(/,/g, "").slice(0, decimals);
    int = int.replace(/^0+(?=\d)/, "");
    if (decimals === 0) frac = undefined;
    onChange(frac === undefined ? int : `${int || "0"}.${frac}`);
  }

  return (
    <div className={cn("relative", className)}>
      {prefix && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-semibold text-muted-foreground">{prefix}</span>}
      <Input
        {...rest}
        inputMode="decimal"
        autoComplete="off"
        value={toDisplay(value ?? "")}
        onChange={(e) => handle(e.target.value)}
        onFocus={(e) => {
          e.currentTarget.select();
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          if (value?.endsWith(".")) onChange(value.slice(0, -1));
          rest.onBlur?.(e);
        }}
        aria-invalid={invalid || undefined}
        className={cn("num text-right", prefix && "pl-12", suffix && "pr-9")}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted-foreground">{suffix}</span>}
    </div>
  );
}
