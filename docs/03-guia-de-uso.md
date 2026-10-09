# Guía de uso — flujo habitual

Pensada para la persona de finanzas y administración. Cada tarea indica dónde se hace.

## 1. Registrar un proyecto vendido (Proyectos → Nuevo proyecto)
1. Código (se sugiere el siguiente), nombre, cliente, país y fecha de venta.
2. Moneda y valores **antes de IVA**: venta y costos de proveedores. La **base neta comisionable** se calcula sola y no puede ser negativa.
3. Si la venta es en USD, CLP o MXN, ingresa la **TRM del día de la venta** (solo sirve para contar la venta frente a la meta).
4. Agrega los colaboradores y su porcentaje (máximo 1 % por persona; Nicholle siempre 1 % base, la escala se aplica sola).
5. Indica cuántas facturas se emitirán. A la derecha ves cuánto aporta el proyecto a la meta del mes.

## 2. Facturas y recaudos (Facturas y recaudos, o dentro del proyecto)
- **Registrar factura:** número, fecha de emisión, valor antes de IVA. Puedes dejar facturas *previstas* sin número. Si la factura ya fue cobrada por completo, marca **«Ya está recaudada por completo»** e indica la fecha del recaudo (y la TRM si es moneda extranjera): se crea el recaudo junto con la factura, en una sola operación.
- **Recaudo:** botón «Recaudo» en la factura. Valor **sin IVA**, fecha efectiva y, si es moneda extranjera, la **TRM del día del recaudo** (se autocompleta si ya la registraste en Configuración). No se puede recaudar más de lo facturado salvo ajuste justificado.
- Los recaudos ya liquidados quedan bloqueados (candado). Para corregirlos se registra un **ajuste**.

## 3. Cada mes: validar las ventas (Configuración → Meta y ventas mensuales)
Cuando termina un mes, pulsa **Validar**. Se fijan la elegibilidad de sus proyectos y el porcentaje efectivo de cada colaborador (la meta se cumple con ventas ≥ $390M). Antes de validar puedes sumar un **ajuste manual** justificado si hubo ventas que no están como proyecto. Un mes validado se puede reabrir con motivo mientras no tenga comisiones liquidadas.

## 4. Liquidación semestral (Liquidaciones)
Abre el período (abril o octubre) y sigue los 6 pasos:

| Paso | Qué haces |
|---|---|
| 1 Período | Confirmas fechas del período y de pago. |
| 2 Calcular | Pulsas **Calcular liquidación**. Es repetible hasta aprobar. |
| 3 Revisar | Totales, **alertas** de los datos de origen (con enlace al proyecto) y detalle por colaborador → proyecto → factura → recaudo. Corrige y recalcula. |
|   | **Revisión por proyecto:** cada proyecto de la liquidación se puede abrir, ver sus líneas y marcar **«Está bien»**. Queda guardado quién y cuándo. Si los datos del proyecto cambian después (otro recaudo, un ajuste), la aceptación se anula sola («Cambió: revísalo de nuevo»). Al aprobar, la app avisa cuántos proyectos quedaron sin revisar (no bloquea). |
|   | **Excepción de porcentaje:** en cada proyecto de la revisión, junto a cada colaborador, **«Editar %»** cambia su porcentaje efectivo (sin tope, con motivo obligatorio) para los recaudos de ese proyecto aún no liquidados. Queda en la bitácora con tu nombre. Requiere el mes de venta validado y que esa asignación no tenga comisiones ya liquidadas (en ese caso se usa un ajuste). Reabrir el mes elimina sus excepciones. «Quitar excepción» restaura el porcentaje calculado. |
| 4 Aprobar | Reconoces las advertencias y confirmas. Las alertas **bloqueantes** impiden el cierre. Al aprobar la liquidación queda **inmutable**. |
| 5 Reportes | PDF individual de cada colaborador (o todos en un ZIP), reporte administrativo en PDF y en Excel. |
| 6 Pagos | Registras cada pago: fecha, valor y referencia. Aprobación y pago son estados distintos. |

Reglas útiles:
- Las liquidaciones se cierran **en orden cronológico**.
- Un recaudo registrado tarde con fecha de un período ya cerrado entra en la siguiente liquidación como *extemporáneo*.
- Una **nota crédito, descuento o reducción contractual** reduce el valor de la factura (y su base); si afecta recaudos ya liquidados genera una línea negativa en la siguiente liquidación, con las tasas originales. Un **ajuste de costos de proveedores** reduce solo la base. Si el neto de un colaborador queda negativo, el saldo se descuenta de la siguiente liquidación.
- Si los datos cambian mientras revisas (por ejemplo se registra un recaudo), el sistema **no aprueba** y te pide revisar de nuevo.
- Un borrador se puede descartar; una liquidación aprobada, nunca.
- Los PDF llevan identificador único, fecha de generación y espacios de firma para enviarlos a la firma electrónica.

## 5. Dónde ver la trazabilidad
- Detalle de cada proyecto → «Historial de cambios» y «Historial de porcentajes».
- Configuración → Auditoría: bitácora de solo inserción de todos los cambios relevantes.
- Cada reporte generado queda registrado con la huella (SHA-256) de su contenido.
