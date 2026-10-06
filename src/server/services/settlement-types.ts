import type { DateOnly } from "@/domain/dates";
import type { LineDetail } from "@/domain/settlement";

/** Foto de cada línea de liquidación (se guarda en `lines/{id}.snapshot` y alimenta PDF y Excel). */
export interface LineSnapshot extends LineDetail {
  collaboratorName: string;
  collaboratorPosition: string;
  client: string;
  currency: string;
  fxRate: string;
  amountReceivedCOP: string | null;
  saleAmountCOP: string;
  saleDate: DateOnly;
  type: "COLLECTION" | "ADJUSTMENT";
  isLate: boolean;
}

export interface ProjectStatusEntry {
  projectId: string;
  code: string;
  client: string;
  saleMonth: string;
  currency: string;
  netBase: string;
  invoiced: string;
  collected: string;
  saleAmount: string;
  pendingInvoice: boolean;
  pendingCollection: boolean;
  /** Comisión potencial que aún no se ha generado (estimada; NO es una comisión aprobada). */
  pendingPotentialCOP: string;
  /** Comisión aprobada en esta liquidación para este proyecto. */
  approvedInThisCOP: string;
}

/** Foto del colaborador y del estado de sus proyectos al aprobar (`people/{id}.snapshot`). */
export interface CollaboratorSnapshot {
  collaboratorId: string;
  fullName: string;
  email: string;
  position: string;
  policyCode: string;
  projects: ProjectStatusEntry[];
}

/** Resumen administrativo congelado al aprobar (`settlements/{code}.adminSnapshot`). */
export interface AdminSnapshot {
  monthsCovered: string[];
  /** Ventas organizacionales de los meses de venta cubiertos por el período (fotos validadas). */
  salesInPeriodCOP: string;
  /** Recaudos del período que originaron comisión (COP, sin IVA). */
  collectedCOP: string;
  collaborators: {
    collaboratorId: string;
    fullName: string;
    position: string;
    projectCodes: string[];
    gross: string;
    adjustments: string;
    carryoverIn: string;
    netPayable: string;
    carryoverOut: string;
  }[];
}

export interface AckedAlert {
  key: string;
  severity: string;
  message: string;
}
