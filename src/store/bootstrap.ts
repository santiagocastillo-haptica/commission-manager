import { audit } from "./audit";
import { C, col, newId, ref } from "./collections";
import { now, runTx } from "./tx";
import { prepareUniques } from "./uniques";
import type { GoalDoc, PolicyDoc, UserDoc } from "./types";

/** Escala de gamificación inicial (decisión D4): 0 / 0,5 / 1 / 1,5 con límite inferior inclusivo. */
export const DEFAULT_TIERS = [
  { min: "0", factor: "0", effectiveFrom: "2025-10-01" },
  { min: "0.7", factor: "0.5", effectiveFrom: "2025-10-01" },
  { min: "1", factor: "1", effectiveFrom: "2025-10-01" },
  { min: "1.2", factor: "1.5", effectiveFrom: "2025-10-01" },
];

export const DEFAULT_GOAL = { amountCOP: "390000000", effectiveFrom: "2024-09-01" };

export interface BootstrapInput {
  email: string;
  name: string;
  /** Hash bcrypt de la contraseña (nunca la contraseña en claro). */
  passwordHash: string;
}

export interface BootstrapResult {
  adminCreated: boolean;
  policiesCreated: string[];
  goalCreated: boolean;
}

/**
 * Datos iniciales MÍNIMOS y seguros para un entorno nuevo. Idempotente: nunca borra ni sobrescribe nada.
 *  - usuario administrador (si no existe ese correo)
 *  - políticas GENERAL y GAMIFICATION (esta con su escala)
 *  - meta comercial mensual inicial (si no hay ninguna)
 */
export async function bootstrapBase(input: BootstrapInput): Promise<BootstrapResult> {
  const email = input.email.trim().toLowerCase();

  return runTx(async (tx) => {
    // ── lecturas ──
    const [generalSnap, gamificationSnap, goalsSnap] = await Promise.all([
      tx.get(ref(C.policies, "GENERAL")),
      tx.get(ref(C.policies, "GAMIFICATION")),
      tx.get(col(C.goals).limit(1)),
    ]);
    const userId = newId();
    const existingUser = await tx.get(col(C.users).where("email", "==", email).limit(1));
    const applyUnique = existingUser.empty
      ? await prepareUniques(tx, [{ key: `user:${email}`, owner: `${C.users}/${userId}`, message: "Ya existe un usuario con ese correo." }])
      : null;

    // ── escrituras ──
    const result: BootstrapResult = { adminCreated: false, policiesCreated: [], goalCreated: false };

    if (!generalSnap.exists) {
      const doc: PolicyDoc = { id: "GENERAL", code: "GENERAL", name: "Política general (meta organizacional)", kind: "GENERAL_THRESHOLD", tiers: [] };
      tx.create(ref(C.policies, "GENERAL"), doc);
      result.policiesCreated.push("GENERAL");
    }
    if (!gamificationSnap.exists) {
      const doc: PolicyDoc = { id: "GAMIFICATION", code: "GAMIFICATION", name: "Gamificación — analista comercial", kind: "GAMIFICATION_TIERS", tiers: DEFAULT_TIERS };
      tx.create(ref(C.policies, "GAMIFICATION"), doc);
      result.policiesCreated.push("GAMIFICATION");
    }
    if (goalsSnap.empty) {
      const doc: GoalDoc = { id: DEFAULT_GOAL.effectiveFrom, ...DEFAULT_GOAL, createdAt: now(), createdById: null };
      tx.create(ref(C.goals, doc.id), doc);
      result.goalCreated = true;
    }
    if (applyUnique) {
      applyUnique(tx);
      const user: UserDoc = { id: userId, email, name: input.name, passwordHash: input.passwordHash, role: "ADMIN", createdAt: now() };
      tx.create(ref(C.users, userId), user);
      audit(tx, { entity: "User", entityId: userId, action: "CREATE", summary: `Administrador ${email} creado (bootstrap)`, after: { id: userId, email, name: input.name, role: "ADMIN" }, userId: null });
      result.adminCreated = true;
    }
    return result;
  });
}

/** Restablece la contraseña de un usuario existente. */
export async function resetPassword(emailRaw: string, passwordHash: string): Promise<boolean> {
  const email = emailRaw.trim().toLowerCase();
  return runTx(async (tx) => {
    const snap = await tx.get(col(C.users).where("email", "==", email).limit(1));
    if (snap.empty) return false;
    const doc = snap.docs[0];
    tx.update(doc.ref, { passwordHash });
    audit(tx, { entity: "User", entityId: doc.id, action: "UPDATE", summary: `Contraseña restablecida para ${email}`, userId: null });
    return true;
  });
}
