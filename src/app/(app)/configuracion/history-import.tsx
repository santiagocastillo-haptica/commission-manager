"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCOP0 } from "@/domain/money";
import {
  arqueoAction, arqueoExcelAction, comparePaymentsAction, finishHistoryImportAction, importHistoryProjectAction, previewHistoryAction, validateClosedMonthsAction,
  type HistoryPreview,
} from "@/server/actions/import";
import type { Arqueo, ImportProjectResult, PaymentComparison, ValidateMonthsResult } from "@/server/import/history-load";

const VARIANT = { Bloqueante: "danger", Decisión: "warning", Menor: "neutral", Info: "neutral", Aceptado: "success" } as const;

export function HistoryImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<{ ok: ImportProjectResult[]; failed: { code: string; error: string }[] } | null>(null);
  const [months, setMonths] = useState<ValidateMonthsResult | null>(null);
  const [comparison, setComparison] = useState<PaymentComparison | null>(null);
  const [arqueo, setArqueo] = useState<Arqueo | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function review() {
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error("Elige primero el archivo de la plantilla (.xlsx).");
    setBusy("review");
    setResults(null);
    setMonths(null);
    setComparison(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await previewHistoryAction(fd);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    setPreview(res.data!);
    toast.success(res.data!.blocking === 0 ? "Plantilla revisada: sin bloqueantes." : `Plantilla revisada: ${res.data!.blocking} bloqueante(s).`);
  }

  async function runImport() {
    if (!preview) return;
    setBusy("import");
    const total = preview.projects.length;
    const ok: ImportProjectResult[] = [];
    const failed: { code: string; error: string }[] = [];
    setProgress({ done: 0, total });
    for (const [i, p] of preview.projects.entries()) {
      const res = await importHistoryProjectAction(p);
      if (res.ok) ok.push(res.data!);
      else failed.push({ code: p.code, error: res.error });
      setProgress({ done: i + 1, total });
    }
    await finishHistoryImportAction();
    setResults({ ok, failed });
    setProgress(null);
    setBusy(null);
    toast[failed.length ? "error" : "success"](`Importados ${ok.filter((r) => r.status === "imported").length} de ${total} proyectos${failed.length ? `; ${failed.length} con error` : ""}.`);
  }

  async function validateMonths() {
    setBusy("months");
    const res = await validateClosedMonthsAction();
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    setMonths(res.data!);
    toast[res.data!.errors.length ? "error" : "success"](res.message ?? "Listo.");
  }

  async function runArqueo() {
    if (!preview) return;
    setBusy("arqueo");
    const res = await arqueoAction({ projects: preview.projects, payments: preview.payments });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    setArqueo(res.data!);
  }

  async function downloadArqueo() {
    if (!preview) return;
    setBusy("arqueo-xlsx");
    const res = await arqueoExcelAction({ projects: preview.projects, payments: preview.payments });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    const bytes = Uint8Array.from(atob(res.data!.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = res.data!.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function compare() {
    if (!preview) return;
    setBusy("compare");
    const res = await comparePaymentsAction(preview.payments);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    setComparison(res.data!);
  }

  const imported = results?.ok.filter((r) => r.status === "imported").length ?? 0;
  const all = preview?.issues ?? [];
  const accepted = all.filter((i) => i.severity === "Aceptado");
  const issues = all.filter((i) => i.severity !== "Aceptado");
  const shown = showAll ? issues : issues.filter((i) => i.severity === "Bloqueante" || i.severity === "Decisión").slice(0, 200);

  return (
    <div className="space-y-8">
      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-bold">1 · Revisar la plantilla</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sube la plantilla de historia de comisiones (.xlsx). Se revisa con las mismas reglas de la aplicación y <strong>no se guarda nada</strong> hasta el paso 2. Los colaboradores deben
          existir antes, con el mismo correo de la plantilla.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".xlsx" aria-label="Plantilla de historia" className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm" />
          <Button onClick={review} disabled={busy !== null}>
            {busy === "review" ? "Revisando…" : "Revisar plantilla"}
          </Button>
        </div>

        {preview && (
          <div className="mt-6 space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              {[
                ["Proyectos", preview.stats.projects],
                ["Asignaciones", preview.stats.assignments],
                ["Facturas emitidas", preview.stats.invoices],
                ["Recaudos", preview.stats.collections],
                ["Facturas previstas", preview.stats.planned],
                ["Ventas (COP)", formatCOP0(preview.stats.salesCOP)],
                ["Recaudado (COP)", formatCOP0(preview.stats.collectedCOP)],
                ["Colaboradores", preview.stats.emails],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg border p-3">
                  <dt className="eyebrow !text-[10px]">{k}</dt>
                  <dd className="num mt-1 text-lg font-bold">{v}</dd>
                </div>
              ))}
            </dl>

            {preview.blocking > 0 ? (
              <p role="alert" className="border-l-2 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
                Hay {preview.blocking} hallazgo(s) bloqueante(s). Corrígelos en la plantilla y vuelve a revisarla.
              </p>
            ) : (
              <p role="status" className="border-l-2 border-brand bg-muted px-3 py-2 text-sm">
                Sin bloqueantes: la plantilla se puede importar.
              </p>
            )}

            {issues.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Prioridad</TableHead>
                      <TableHead>Hallazgo</TableHead>
                      <TableHead>Hoja · fila</TableHead>
                      <TableHead>Proyecto</TableHead>
                      <TableHead>Detalle</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((i, n) => (
                      <TableRow key={n}>
                        <TableCell>
                          <Badge variant={VARIANT[i.severity]}>{i.severity}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{i.type}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {i.sheet} · {i.row}
                        </TableCell>
                        <TableCell className="num whitespace-nowrap">{i.code}</TableCell>
                        <TableCell className="max-w-[420px] text-xs">
                          {i.detail} <span className="text-muted-foreground">{i.action}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {accepted.length > 0 && (
              <details className="rounded-lg border p-3 text-sm">
                <summary className="cursor-pointer font-semibold">
                  Aceptados ({accepted.length}) <span className="font-normal text-muted-foreground">· casos ya decididos, no requieren acción</span>
                </summary>
                <ul className="mt-3 space-y-1 text-xs">
                  {Object.entries(
                    accepted.reduce<Record<string, string[]>>((acc, i) => {
                      (acc[`${i.type} — ${i.action}`] ??= []).push(i.code);
                      return acc;
                    }, {}),
                  ).map(([k, codes]) => (
                    <li key={k}>
                      <Badge variant="success">Aceptado</Badge> <strong>{k}</strong>: <span className="num">{codes.join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {issues.length > shown.length || showAll ? (
              <Button variant="outline" size="xs" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Mostrar solo bloqueantes y decisiones" : `Mostrar los ${issues.length} hallazgos`}
              </Button>
            ) : null}
          </div>
        )}
      </section>

      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-bold">2 · Importar proyectos, facturas y recaudos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Se carga proyecto por proyecto (cada uno todo o nada). Es seguro repetirlo: los proyectos que ya existen se omiten. Hazlo <strong>antes</strong> de validar los meses.
        </p>
        <div className="mt-4">
          <Button onClick={() => setConfirm(true)} disabled={!preview || preview.blocking > 0 || busy !== null}>
            {busy === "import" ? "Importando…" : `Importar ${preview?.projects.length ?? 0} proyectos`}
          </Button>
        </div>
        {progress && (
          <div className="mt-4" aria-live="polite">
            <div className="h-2 overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {progress.done} de {progress.total}
            </p>
          </div>
        )}
        {results && (
          <div className="mt-4 space-y-2 text-sm">
            <p>
              Importados: <strong>{imported}</strong> · Omitidos (ya existían): <strong>{results.ok.length - imported}</strong> · Con error: <strong>{results.failed.length}</strong>
            </p>
            {results.failed.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-danger">
                {results.failed.map((f) => (
                  <li key={f.code}>
                    <span className="num font-semibold">{f.code}</span>: {f.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-bold">3 · Validar los meses cerrados</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Valida en orden, desde el primer mes, todos los meses ya terminados: fija la elegibilidad y el porcentaje efectivo de cada asignación (la gamificación aplica desde su fecha de inicio).
        </p>
        <div className="mt-4">
          <Button onClick={validateMonths} disabled={busy !== null}>
            {busy === "months" ? "Validando…" : "Validar meses cerrados"}
          </Button>
        </div>
        {months && (
          <div className="mt-4 space-y-1 text-sm">
            <p>
              Validados ahora: <strong>{months.validated.length}</strong> · Ya estaban validados: <strong>{months.alreadyValidated.length}</strong> · Con error: <strong>{months.errors.length}</strong>
            </p>
            {months.errors.map((e) => (
              <p key={e.yearMonth} className="text-danger">
                {e.yearMonth}: {e.message}
              </p>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-bold">4 · Arqueo por trimestre</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cortes exactos por trimestre: ventas, facturado y recaudado de la <strong>plantilla frente a la aplicación</strong> (deben cuadrar al peso), y la comisión generada por los recaudos de cada
          trimestre frente a lo pagado (los códigos <em>LIQ-AAAA-Q#</em> se toman como el trimestre de los recaudos que se pagaron). Solo lectura.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={runArqueo} disabled={!preview || busy !== null}>
            {busy === "arqueo" ? "Calculando…" : "Calcular arqueo"}
          </Button>
          <Button variant="outline" onClick={downloadArqueo} disabled={!preview || busy !== null}>
            {busy === "arqueo-xlsx" ? "Generando…" : "Descargar Excel"}
          </Button>
        </div>
        {arqueo && (
          <div className="mt-4 space-y-3">
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Trimestre</TableHead>
                    <TableHead className="text-right">Ventas (app)</TableHead>
                    <TableHead className="text-right">Dif. vs plantilla</TableHead>
                    <TableHead className="text-right">Facturado (app)</TableHead>
                    <TableHead className="text-right">Dif.</TableHead>
                    <TableHead className="text-right">Recaudado (app)</TableHead>
                    <TableHead className="text-right">Dif.</TableHead>
                    <TableHead className="text-right">Comisión generada</TableHead>
                    <TableHead className="text-right">Pagada</TableHead>
                    <TableHead className="text-right">Generada − pagada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {arqueo.quarters.map((q) => {
                    const dv = Number(q.app.sales) - Number(q.plan.sales);
                    const di = Number(q.app.invoiced) - Number(q.plan.invoiced);
                    const dc = Number(q.app.collected) - Number(q.plan.collected);
                    const bad = (n: number) => (Math.abs(n) > 1 ? "text-danger font-semibold" : "text-muted-foreground");
                    return (
                      <TableRow key={q.quarter}>
                        <TableCell className="num font-semibold">{q.quarter}</TableCell>
                        <TableCell className="num text-right">{formatCOP0(q.app.sales)}</TableCell>
                        <TableCell className={`num text-right ${bad(dv)}`}>{formatCOP0(dv)}</TableCell>
                        <TableCell className="num text-right">{formatCOP0(q.app.invoiced)}</TableCell>
                        <TableCell className={`num text-right ${bad(di)}`}>{formatCOP0(di)}</TableCell>
                        <TableCell className="num text-right">{formatCOP0(q.app.collected)}</TableCell>
                        <TableCell className={`num text-right ${bad(dc)}`}>{formatCOP0(dc)}</TableCell>
                        <TableCell className="num text-right">{formatCOP0(q.commissionGenerated)}</TableCell>
                        <TableCell className="num text-right">{formatCOP0(q.commissionPaid)}</TableCell>
                        <TableCell className="num text-right font-semibold">{formatCOP0(Number(q.commissionGenerated) - Number(q.commissionPaid))}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {arqueo.notes.map((n) => (
              <p key={n} className="text-xs text-muted-foreground">
                {n}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">Las diferencias de ventas, facturado y recaudado deben ser 0: si no, falta algo por importar. El detalle por colaborador está en el Excel.</p>
          </div>
        )}
      </section>

      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-bold">5 · Comparar por semestre (para aprobar liquidaciones)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Calcula, semestre por semestre, lo que liquidaría la aplicación y lo compara con la hoja <em>Pagos_realizados</em> de la plantilla. Los códigos trimestrales se agrupan por semestre
          (Q4 y Q1 → abril; Q2 y Q3 → octubre). No guarda nada. Revisa las diferencias antes de aprobar cualquier liquidación histórica.
        </p>
        <div className="mt-4">
          <Button variant="outline" onClick={compare} disabled={!preview || busy !== null}>
            {busy === "compare" ? "Calculando…" : "Comparar con pagos"}
          </Button>
        </div>
        {comparison && (
          <div className="mt-4 space-y-4">
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Liquidación</TableHead>
                    <TableHead className="text-right">Calculado</TableHead>
                    <TableHead className="text-right">Pagado</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.totals.map((t) => (
                    <TableRow key={t.liquidation}>
                      <TableCell className="num font-semibold">{t.liquidation}</TableCell>
                      <TableCell className="num text-right">{formatCOP0(t.calculated)}</TableCell>
                      <TableCell className="num text-right">{formatCOP0(t.paid)}</TableCell>
                      <TableCell className="num text-right font-semibold">{formatCOP0(t.difference)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-semibold">Detalle por colaborador ({comparison.rows.length})</summary>
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Liquidación</TableHead>
                      <TableHead>Colaborador</TableHead>
                      <TableHead className="text-right">Calculado</TableHead>
                      <TableHead className="text-right">Pagado</TableHead>
                      <TableHead className="text-right">Diferencia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.rows.map((r, n) => (
                      <TableRow key={n}>
                        <TableCell className="num">{r.liquidation}</TableCell>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="num text-right">{formatCOP0(r.calculated)}</TableCell>
                        <TableCell className="num text-right">{formatCOP0(r.paid)}</TableCell>
                        <TableCell className="num text-right">{formatCOP0(r.difference)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Importar la historia"
        confirmLabel="Importar"
        description={`Se crearán ${preview?.projects.length ?? 0} proyectos con sus asignaciones, facturas y recaudos. Quedarán registrados en la auditoría. Los que ya existan se omiten.`}
        onConfirm={async () => {
          setConfirm(false);
          await runImport();
        }}
      />
    </div>
  );
}
