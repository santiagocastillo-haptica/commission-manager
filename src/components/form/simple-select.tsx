"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Selector con etiquetas legibles (envuelve el Select de Base UI). */
export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder = "Selecciona…",
  id,
  disabled,
  invalid,
  className,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value ?? null}
      onValueChange={(v) => onChange((v as string | null) ?? "")}
      items={options.map((o) => ({ value: o.value, label: o.label }))}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-invalid={invalid || undefined} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
