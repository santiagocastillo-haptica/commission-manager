# Motor de comisiones — reglas implementadas

> **Nota:** las pruebas de integración citadas aquí ahora corren contra el emulador de Firestore (`tests/data/`, `npm run test:store`); las reglas del motor no cambiaron.

Código: `src/domain` (puro, sin base de datos), `src/server/services/months.ts` (validación de meses) y `src/server/services/settlements.ts` (cálculo, cierre y pagos).
Pruebas: `tests/domain/engine.test.ts` (los 15 escenarios obligatorios + casos límite y de revisión), `tests/integration/*` (PostgreSQL) y `tests/reports/*`.

Reglas confirmadas el 2026-10-05 que difieren del brief original: meta **inclusiva** (≥), escala de Nicholle como **multiplicador** que reemplaza la compuerta, recaudos **sin IVA**, **sin redondeo**.

## 1. Validación de un mes (`validateMonth`)

Solo se puede validar un mes ya terminado (hora de Colombia). Al validar:

1. `ventas del mes` = Σ venta en COP (con la TRM del día de la venta) de **todos** los proyectos no anulados del mes, tengan o no colaboradores comisionables, + ajuste manual justificado.
2. `meta` = la vigente en el mes (los cambios de meta no alteran meses ya validados: se guarda una foto).
3. Resultado del mes: `ELIGIBLE` si `ventas ≥ meta`, si no `NOT_ELIGIBLE`, con el motivo en texto.
4. Para cada asignación activa se fija su **porcentaje efectivo** (el base se conserva):

| Política | % efectivo |
|---|---|
| General | % base si `ventas ≥ meta`; 0 en caso contrario |
| Gamificación (Nicholle) | % base × factor del tramo: `<70 %` → 0 · `70–<100 %` → 0,5 · `100–<120 %` → 1 · `≥120 %` → 1,5 (límite inferior inclusivo; comparación exacta `ventas ≥ mín × meta`). Sin escala vigente, la validación falla con un error explícito. |

5. Queda bloqueado: no se crean ni editan proyectos de ese mes sin reabrirlo. **Reabrir** exige motivo y es imposible si ya hay comisiones liquidadas de sus proyectos **o** si existe una liquidación aprobada cuyo período alcanza ese mes (pudo haber evaluado sus recaudos, incluso con 0 %). Ambas operaciones quedan en la bitácora.

La elegibilidad **no** se reevalúa cuando llega un recaudo ni con ventas de meses posteriores.

## 2. Comisión de un recaudo

```
estado de la factura (tras ajustes): valor efectivo V', base efectiva B'
proporción                         = B' / V'
base neta del recaudo              = valor recaudado (sin IVA) × proporción, acotada: Σ bases de la factura ≤ B'
comisión (moneda)                  = base neta del recaudo × % efectivo
comisión (COP)                     = comisión (moneda) × TRM del día del recaudo   (COP: 1)
```

- Base de la factura = la fijada explícitamente o, por defecto, `valor de la factura × base neta del proyecto / venta` (los costos de proveedores se distribuyen proporcionalmente).
- Un recaudo parcial genera solo la comisión proporcional; el resto se liquida cuando se recaude.
- **Tope:** los recaudos se acumulan en orden cronológico y nunca comisionan más allá de la base efectiva de la factura (un excedente justificado no genera comisión adicional).
- Decimales de 40 cifras; sin redondeo de negocio. Se persiste con 6 decimales y los totales guardados son la suma exacta de las líneas guardadas.

### Ajustes
| Tipo | Efecto sobre la factura |
|---|---|
| Nota crédito, descuento posterior, reducción contractual | Reduce el **valor** de la factura y su base en la misma cuantía (el cliente deja de deber ese valor, así que no se descuenta dos veces) |
| Costos de proveedores | Reduce **solo la base** |

Un ajuste sin factura se reparte entre las facturas del proyecto en proporción a su valor, respetando la base disponible de cada una (el sobrante se redistribuye). Ningún ajuste puede dejar una base negativa.

## 3. Cálculo de una liquidación (`calculateSettlement`)

Entran los recaudos de facturas emitidas, de proyectos no anulados, con fecha efectiva **≤ fin del período** y que no estén ya comprometidos para esa asignación.

- Períodos: abril (1-oct → 31-mar, pago 15-abr) y octubre (1-abr → 30-sep, pago 15-oct). El período lo define la fecha del recaudo.
- Recaudos con fecha anterior al período registrados tarde → entran como **extemporáneos**.
- **Anti pago doble:** un recaudo ya liquidado no genera otra línea (en el motor y, además, por índice único en la base de datos).
- **Compensación de ajustes pendientes:** para cada recaudo ya liquidado se compara la base con los ajustes ya aplicados y con todos; la diferencia genera una línea `ADJUSTMENT` negativa en la siguiente liquidación, con la TRM y el porcentaje de ese recaudo, atribuida a cada ajuste en proporción a su aporte. Como los recaudos se imputan en orden cronológico, la reducción recae primero sobre los más recientes. Las líneas cerradas nunca se tocan. Si el ajuste solo afecta saldo aún no recaudado, no hay compensación.
- **Saldo negativo** de un colaborador: se arrastra a la siguiente liquidación (no se cobra al colaborador).
- Meses sin validar: sus recaudos no generan comisión y se emite una alerta.

### Alertas

| Código | Severidad | Cuándo |
|---|---|---|
| `INCOMPLETE_INVOICE` | Bloqueante | Factura emitida sin número o sin fecha |
| `MISSING_FX` | Bloqueante | Recaudo candidato de esta liquidación, en moneda extranjera, con TRM faltante o igual a 1 |
| `PENDING_VALIDATION` | Advertencia | Recaudos del período en un proyecto cuyo mes no está validado |
| `PENDING_ADJUSTMENTS` | Advertencia | Ajustes pendientes que se aplicarán en esta liquidación |
| `POSSIBLE_DUPLICATE` | Advertencia | Recaudos con mismo valor y fecha en una factura; mismo número de factura en varios proyectos |
| `NET_BASE_MISMATCH` | Advertencia | Las bases asignadas a las facturas no cuadran con la base del proyecto |
| `LATE_COLLECTIONS` | Informativa | Recaudos extemporáneos incluidos |

Bloqueante = no se puede cerrar hasta corregir. Advertencia = hay que reconocerla en la pantalla de cierre.

## 4. Indicadores (subconjuntos anidados, no sumables)

`potencial ⊇ generada ⊇ liquidada ⊇ pagada`

- **Potencial:** % efectivo × base ajustada del proyecto (× TRM de referencia si es moneda extranjera), solo meses validados; los meses sin validar se informan aparte como cota superior (% base).
- **Generada:** comisión de los recaudos recibidos.
- **Liquidada:** líneas comprometidas en liquidaciones cerradas.
- **Pendiente de pago:** generada acumulada − pagos registrados.

## 5. Cierre de la liquidación

`approveSettlement` (una transacción serializable): verifica que los totales coincidan con los que el administrador revisó → recalcula con el estado actual → exige cero alertas bloqueantes y todas las advertencias reconocidas → borra el borrador y crea las líneas definitivas (`committed`, con foto en JSON) → crea una liquidación individual por colaborador (con foto del colaborador y del estado de sus proyectos) → marca los ajustes pendientes como aplicados → guarda indicadores administrativos → cambia el estado a APROBADA. Desde ese momento triggers de la base de datos impiden modificar la liquidación, sus líneas, los recaudos, facturas y asignaciones liquidados, los ajustes aplicados y los valores de la liquidación individual.

- Se cierran en orden cronológico (no se aprueba una si hay un borrador anterior ni si ya hay una posterior aprobada). Un borrador se puede descartar (se elimina); una liquidación aprobada, nunca.
- **Pagos:** por colaborador; referencia única, no pueden superar el saldo (con bloqueo de fila ante pagos simultáneos); estado PENDIENTE / PARCIAL / PAGADA. Una liquidación con neto $0 queda sin valor a pagar. Los pagos son de solo inserción.
- **Reportes:** se generan solo desde las fotos congeladas; cada generación queda en `GeneratedReport` con su SHA-256.

## 6. Limitaciones conocidas (V1)

- **Devolución de un recaudo ya liquidado:** no existe un movimiento de «reversión de recaudo». Una nota crédito o descuento cubre la reducción del valor de la factura; una devolución de dinero que deba recuperarse y volver a cobrarse requiere una futura función específica.
- **Escala de gamificación:** se puede consultar pero no editar desde la interfaz.
- **Sesión:** un solo administrador; la sesión (JWT de 8 h) no se puede revocar antes de vencer y el límite de intentos de ingreso es por proceso. Para varias instancias o más usuarios habría que moverlo a la base de datos.
- **Logotipo:** los PDF usan el nombre «HÁPTICA» como texto hasta contar con el archivo oficial.
