import { CheckCircle2, CircleDashed, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BILLING_LABEL, COLLECTION_LABEL, type BillingStatus, type CollectionStatus } from "@/domain/project-status";
import type { EligibilityStatus } from "@/domain/eligibility";

export function EligibilityBadge({ status }: { status: EligibilityStatus }) {
  if (status === "ELIGIBLE")
    return (
      <Badge variant="success">
        <CheckCircle2 aria-hidden /> Elegible
      </Badge>
    );
  if (status === "NOT_ELIGIBLE")
    return (
      <Badge variant="danger">
        <XCircle aria-hidden /> No elegible
      </Badge>
    );
  return (
    <Badge variant="warning">
      <Clock aria-hidden /> Pendiente de validación
    </Badge>
  );
}

export function BillingBadge({ status }: { status: BillingStatus }) {
  const variant = status === "INVOICED" ? "success" : status === "PARTIAL" ? "warning" : "neutral";
  return <Badge variant={variant}>{BILLING_LABEL[status]}</Badge>;
}

export function CollectionBadge({ status }: { status: CollectionStatus }) {
  const variant = status === "COLLECTED" ? "success" : status === "PARTIAL" ? "warning" : "neutral";
  return <Badge variant={variant}>{COLLECTION_LABEL[status]}</Badge>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? <Badge variant="success">Activo</Badge> : <Badge variant="neutral">Inactivo</Badge>;
}

export function VoidedBadge() {
  return (
    <Badge variant="danger">
      <CircleDashed aria-hidden /> Anulado
    </Badge>
  );
}
