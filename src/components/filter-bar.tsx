"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface FilterSelect {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  /** Texto de la opción "todos". */
  allLabel?: string;
}

/**
 * Filtros sincronizados con la URL (la página es un Server Component que lee `searchParams`).
 * La búsqueda de texto espera 300 ms; los selectores aplican de inmediato.
 */
export function FilterBar({
  searchName = "q",
  searchPlaceholder = "Buscar…",
  selects = [],
  className,
}: {
  searchName?: string | null;
  searchPlaceholder?: string;
  selects?: FilterSelect[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(searchName ? (params.get(searchName) ?? "") : "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function push(next: URLSearchParams) {
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("page");
    push(next);
  }

  const active = Array.from(params.keys()).length > 0;

  return (
    <div className={cn("mb-5 flex flex-wrap items-end gap-3", pending && "opacity-70", className)}>
      {searchName && (
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Buscar"
            placeholder={searchPlaceholder}
            value={text}
            className="pl-9"
            onChange={(e) => {
              setText(e.target.value);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => setParam(searchName, e.target.value.trim()), 300);
            }}
          />
        </div>
      )}
      {selects.map((s) => (
        <label key={s.name} className="flex flex-col gap-1">
          <span className="eyebrow !text-[10px]">{s.label}</span>
          <select
            value={params.get(s.name) ?? ""}
            onChange={(e) => setParam(s.name, e.target.value)}
            className="h-9 min-w-[150px] rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">{s.allLabel ?? "Todos"}</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setText("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
        >
          <X data-icon="inline-start" /> Limpiar
        </Button>
      )}
    </div>
  );
}
