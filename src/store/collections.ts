import type { CollectionReference, DocumentReference } from "firebase-admin/firestore";
import { db } from "./admin";

/** Nombres de las colecciones (ver docs/05-migracion-firestore.md, sección 2). */
export const C = {
  users: "users",
  policies: "policies",
  goals: "goals",
  exchangeRates: "exchangeRates",
  collaborators: "collaborators",
  uniques: "uniques",
  monthlySales: "monthlySales",
  projects: "projects",
  invoices: "invoices",
  adjustments: "adjustments",
  settlements: "settlements",
  settlementReviews: "settlementReviews",
  commitments: "commitments",
  generatedReports: "generatedReports",
  auditLog: "auditLog",
  loginThrottle: "loginThrottle",
  system: "system",
} as const;

export type CollectionName = (typeof C)[keyof typeof C];

export const col = (name: CollectionName): CollectionReference => db().collection(name);
export const ref = (name: CollectionName, id: string): DocumentReference => db().collection(name).doc(id);

/** ID nuevo (aleatorio de Firestore, 20 caracteres alfanuméricos). */
export const newId = (): string => db().collection("_ids").doc().id;

/** Subcolecciones de una liquidación. */
export const settlementRef = (code: string) => ref(C.settlements, code);
export const linesCol = (code: string) => settlementRef(code).collection("lines");
export const peopleCol = (code: string) => settlementRef(code).collection("people");

/** Documento único de estado global. */
export const systemStateRef = () => ref(C.system, "state");

/** Los IDs de documento no admiten «/»; las claves de unicidad se codifican. */
export const encodeKey = (key: string): string => encodeURIComponent(key);
