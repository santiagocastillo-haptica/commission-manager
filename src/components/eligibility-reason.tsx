"use client";

import { EligibilityBadge } from "@/components/status-badges";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { EligibilityStatus } from "@/domain/eligibility";

/** Estado de elegibilidad con el motivo consultable (click). */
export function EligibilityReason({ status, reason }: { status: EligibilityStatus; reason: string }) {
  return (
    <Popover>
      <PopoverTrigger
        className="cursor-pointer text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="Ver el motivo del estado de elegibilidad"
      >
        <EligibilityBadge status={status} />
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm">
        <PopoverTitle className="eyebrow !text-[11px]">Motivo del estado</PopoverTitle>
        <PopoverDescription className="mt-1.5 leading-relaxed text-foreground/80">{reason}</PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}
