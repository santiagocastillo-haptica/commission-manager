import { type App, getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

/**
 * Conexión a Firestore con el SDK Admin (solo servidor; las reglas de seguridad niegan todo acceso de clientes).
 *
 * - En desarrollo y pruebas se conecta al emulador si existe FIRESTORE_EMULATOR_HOST.
 * - En producción (Firebase App Hosting / Cloud Run) usa las credenciales de la cuenta de servicio del entorno.
 */
const DEFAULT_PROJECT = "haptica-commission-manager";

const globalForFs = globalThis as unknown as { __hcmFirestore?: Firestore };

/** App de Firebase Admin (compartida por Firestore y Authentication). */
export function adminApp(): App {
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID ?? DEFAULT_PROJECT;
  return getApps()[0] ?? initializeApp({ projectId });
}

export function db(): Firestore {
  if (globalForFs.__hcmFirestore) return globalForFs.__hcmFirestore;
  const firestore = getFirestore(adminApp());
  // Los campos `undefined` se omiten en lugar de fallar.
  firestore.settings({ ignoreUndefinedProperties: true });
  globalForFs.__hcmFirestore = firestore;
  return firestore;
}

export const usingEmulator = () => Boolean(process.env.FIRESTORE_EMULATOR_HOST);
