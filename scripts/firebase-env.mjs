/**
 * Ejecuta un comando de Firebase (emulador de Firestore, etc.) con el Java correcto.
 *
 *   node scripts/firebase-env.mjs emulators:exec --only firestore "npm test"
 *
 * - Busca Java en HAPTICA_JAVA_HOME, JAVA_HOME o en ~/tools/jdk21 (JDK portátil instalado sin permisos de administrador).
 * - Fija un directorio temporal propio para Java: en Windows la ruta temporal por defecto (con nombres cortos 8.3)
 *   hace fallar al emulador con «Unable to establish loopback connection».
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function findJavaHome() {
  for (const candidate of [process.env.HAPTICA_JAVA_HOME, process.env.JAVA_HOME]) {
    if (candidate && existsSync(path.join(candidate, "bin", process.platform === "win32" ? "java.exe" : "java"))) return candidate;
  }
  const portable = path.join(homedir(), "tools", "jdk21");
  if (existsSync(portable)) {
    const sub = readdirSync(portable).find((d) => d.startsWith("jdk-"));
    if (sub) return path.join(portable, sub);
  }
  return undefined;
}

const javaHome = findJavaHome();
const tmp = path.resolve(".firebase-tmp");
mkdirSync(tmp, { recursive: true });
const tmpForJava = tmp.replace(/\\/g, "/");

const env = { ...process.env };
if (javaHome) {
  env.JAVA_HOME = javaHome;
  env.PATH = `${path.join(javaHome, "bin")}${path.delimiter}${env.PATH ?? ""}`;
}
env.JAVA_TOOL_OPTIONS = `-Djdk.net.unixdomain.tmpdir=${tmpForJava} -Djava.io.tmpdir=${tmpForJava}`;

// Con shell:true hay que entrecomillar los argumentos con espacios (p. ej. el comando que ejecuta el emulador).
const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
// «--import=<dir>» solo si ya existe una exportación (la primera vez no hay nada que importar).
const rawArgs = process.argv.slice(2).filter((a) => {
  const m = /^--import=(.+)$/.exec(a);
  return !m || existsSync(path.join(path.resolve(m[1]), "firebase-export-metadata.json"));
});
const args = rawArgs.map(quote);
const r = spawnSync("npx", ["--yes", "firebase-tools", ...args], { stdio: "inherit", shell: true, env });
process.exit(r.status ?? 1);
