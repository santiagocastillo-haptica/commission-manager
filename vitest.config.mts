import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 20000, // el emulador de Firestore puede tardar en transacciones con contención
    fileParallelism: false, // las pruebas de integración comparten la base de datos de pruebas
  },
});
