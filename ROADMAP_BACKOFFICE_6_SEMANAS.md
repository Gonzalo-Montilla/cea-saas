# Roadmap Backoffice SaaS (6 Semanas, enfoque 70/30)

## Objetivo

Consolidar el backoffice para operacion estable y crecimiento comercial:

- 70% fortalecimiento (calidad de datos, automatizacion, confiabilidad).
- 30% nuevas funcionalidades de alto impacto de negocio.

## Alcance

Este roadmap cubre solo backoffice SaaS (no school mode operativo diario), sin tocar facturacion electronica en esta fase.

## KPIs de exito (globales)

- Confiabilidad deploy/operacion: incidentes criticos por release <= 1.
- Exactitud financiera: discrepancias entre eventos y resumen <= 0.5%.
- Cobranza: +15% recuperacion de cartera vencida en 60 dias.
- Visibilidad ejecutiva: 100% de KPI clave disponibles en Resumen.
- Tiempo de reaccion: alertas criticas revisadas < 24h.

## Semana 1 - Baseline y gobierno de datos (70/30)

### Fortalecimiento (70%)
- Definir diccionario oficial de metricas SaaS:
  - MRR proyectado, ingresos cobrados, cartera vencida, ARPU, churn, NRR.
- Congelar reglas de calculo en backend con tests de regresion.
- Crear "sanity checks" diarios para detectar:
  - tenants sin estado coherente,
  - pagos sin referencia minima,
  - fechas invalidas de ciclo.

### Nuevas funcionalidades (30%)
- Agregar tarjeta de "Calidad de datos" en Resumen:
  - errores detectados hoy,
  - porcentaje de registros validos.

### Criterios de aceptacion
- Documento de metricas aprobado.
- 1 endpoint de validacion de consistencia disponible.
- Resumen muestra estado de calidad de datos.

---

## Semana 2 - Revenue analytics completo (70/30)

### Fortalecimiento (70%)
- Reforzar calculos de ingresos por periodo:
  - rango personalizado,
  - total, promedio, numero de pagos,
  - desglose por escuela.
- Validar timezone y cierres de rango (inicio/fin de dia).

### Nuevas funcionalidades (30%)
- Incorporar en Resumen:
  - MRR Movement (new, expansion, contraction, churn),
  - Logo churn mensual,
  - NRR mensual.

### Criterios de aceptacion
- KPI nuevos visibles y exportables.
- Datos consistentes contra eventos de cobro.

---

## Semana 3 - Cobranza inteligente (dunning) (70/30)

### Fortalecimiento (70%)
- Motor de secuencias para cobranza:
  - pre-vencimiento,
  - dia de vencimiento,
  - post-vencimiento (dias 3/7/14).
- Trazabilidad de cada intento (correo/estado/respuesta).

### Nuevas funcionalidades (30%)
- Panel en Resumen:
  - cartera en riesgo,
  - cobranzas enviadas,
  - recuperado por campana.

### Criterios de aceptacion
- Secuencia automatica funcionando en entorno controlado.
- Eventos auditables por tenant.

---

## Semana 4 - Health score por tenant (70/30)

### Fortalecimiento (70%)
- Modelo de score (0-100) con 4 ejes:
  - pagos,
  - uso del sistema,
  - soporte (tickets),
  - antiguedad/activacion.
- Normalizar pesos y umbrales (verde/amarillo/rojo).

### Nuevas funcionalidades (30%)
- Vista en Resumen:
  - top tenants en riesgo,
  - motivo principal del riesgo,
  - recomendacion accionable.

### Criterios de aceptacion
- Score calculado para 100% de tenants activos.
- Lista de riesgo priorizada para gestion comercial.

---

## Semana 5 - Operacion y alertas (70/30)

### Fortalecimiento (70%)
- Centro de alertas internas:
  - pagos atipicos,
  - crecimiento abrupto de tickets,
  - vencimientos criticos.
- Configuracion minima de umbrales por rol (owner/finanzas/soporte).

### Nuevas funcionalidades (30%)
- Notificaciones de resumen diario por correo:
  - ingresos del dia,
  - cartera,
  - tenants en riesgo.

### Criterios de aceptacion
- Alertas criticas visibles en menos de 5 min.
- Resumen diario generado automaticamente.

---

## Semana 6 - Cierre, endurecimiento y release operativo (70/30)

### Fortalecimiento (70%)
- Pruebas E2E del backoffice (flujos criticos):
  - cambio de estado suscripcion,
  - registro de pago,
  - reflejo en resumen,
  - exportaciones.
- Runbook de incidentes de metricas/cobranza.
- Checklist de release productivo.

### Nuevas funcionalidades (30%)
- Exportes ejecutivos listos:
  - CSV detalle pagos,
  - CSV resumen por escuela,
  - snapshot mensual de KPIs.

### Criterios de aceptacion
- Release estable con monitoreo activo.
- Cero bloqueantes abiertos para flujo comercial-financiero.

---

## Backlog priorizado (si queda capacidad)

1. Automatizaciones por reglas ("si pasa X, ejecutar Y").
2. Comparativo mes vs mes y trimestre vs trimestre.
3. Forecast simple de caja a 30/60/90 dias.
4. API/webhooks para integraciones externas.

## Riesgos y mitigacion

- Riesgo: cambios de logica rompen metricas historicas.
  - Mitigacion: versionar calculos y mantener pruebas de regresion.
- Riesgo: sobrecarga de nuevos modulos simultaneos.
  - Mitigacion: limite de WIP por semana, foco en flujo financiero.
- Riesgo: mala adopcion interna.
  - Mitigacion: entrenamiento corto + tableros simples + alertas utiles.

## Regla de ejecucion semanal

- Cada semana solo entra trabajo si cumple al menos uno:
  - reduce riesgo operativo,
  - mejora ingresos/cobranza,
  - mejora visibilidad ejecutiva para decision.

