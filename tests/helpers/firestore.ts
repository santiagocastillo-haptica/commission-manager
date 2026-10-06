/** Ayudantes para las pruebas contra el emulador de Firestore (requiere FIRESTORE_EMULATOR_HOST). */
export const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
export const hasEmulator = Boolean(emulatorHost);
export const projectId = process.env.GCLOUD_PROJECT ?? "haptica-commission-manager";

/** Borra TODOS los documentos del emulador (nunca de la base real: solo existe en el emulador). */
export async function clearFirestore(): Promise<void> {
  if (!emulatorHost) throw new Error("clearFirestore solo puede usarse con el emulador (FIRESTORE_EMULATOR_HOST).");
  const res = await fetch(`http://${emulatorHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error(`No se pudo limpiar el emulador: ${res.status}`);
}
