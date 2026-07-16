# Estandar UI/UX v1 (Tenant-Core)

Este documento define el estandar minimo obligatorio para cambios de interfaz, experiencia de usuario y comportamiento visual en el sistema.

Objetivo: mantener consistencia visual, reducir errores operativos y acelerar QA funcional.

## 1) Principios base

- Consistencia primero: un mismo patron para casos similares.
- Claridad operacional: menos pasos, menos ambiguedad, mas contexto.
- Seguridad de operacion: validar antes de guardar, confirmar acciones criticas.
- Accesibilidad pragmatica: teclado, foco visible y contraste legible.
- Escalabilidad: componentes reutilizables antes que estilos por modulo.

## 2) Componentes y patrones obligatorios

- Encabezados de pagina: usar `PageHeader`.
- Modales: usar `ModalBase`.
- Confirmaciones: usar `ConfirmDialog`.
- Feedback de accion: usar `ToastAlert` (exito, error, info).
- Botones: respetar clases globales (`btn-primary`, `btn-secondary`, `btn-danger`).
- Badges de estado: usar estilo de estado consistente (`activo`, `inactivo`, `vencido`, etc.).

## 3) Listados (tablas y tarjetas)

- Regla general:
  - Tabla para lectura comparativa de muchos registros.
  - Tarjeta colapsable para lectura detallada por registro.
- En desktop:
  - Tabla o tarjetas segun densidad de informacion del modulo.
- En movil:
  - Priorizar tarjetas o tabla con scroll horizontal controlado.
- Debe existir estado vacio claro:
  - "No se encontraron resultados" + sugerencia accionable.
- Acciones por fila/tarjeta:
  - Orden recomendado: Ver -> Editar -> Accion destructiva.

## 4) Formularios

- Etiquetas claras y cortas.
- Campos obligatorios marcados con `*`.
- Placeholder orientativo (no reemplaza label).
- Validacion en frontend antes de enviar.
- Error de backend mapeado a mensaje legible para usuario.
- Boton principal deshabilitado si faltan datos minimos.
- Doble envio protegido (`loading/disabled` mientras guarda).

## 5) Microcopy estandar (tono y estilo)

- Tono: directo, profesional, sin tecnicismos innecesarios.
- Formato:
  - Titulos en frase corta.
  - Botones con verbo de accion (`Guardar`, `Registrar`, `Anular`).
  - Errores con causa + accion sugerida.
- Confirmaciones:
  - Explicar impacto real ("esta accion no se puede deshacer").
- Consistencia:
  - Mismos terminos en todo el sistema (`sucursal`, `caja fuerte`, `anular`, etc.).

## 6) Formato de datos

Centralizar helpers para:

- Moneda COP
- Fecha/hora local (`es-CO`)
- Documento/telefono
- Porcentajes
- Estados estandarizados

No duplicar formateadores por modulo si ya existe util global.

## 7) Accesibilidad minima obligatoria

- Navegacion por teclado funcional en:
  - Busqueda/filtros
  - Tabla/tarjetas
  - Modales y confirmaciones
- Foco visible en botones, inputs y controles iconicos.
- Botones solo-icono con `aria-label`.
- Contraste suficiente en:
  - textos secundarios
  - badges de estado
  - alertas y errores

## 8) Reglas de negocio (UX + backend)

- Validaciones criticas siempre en frontend y backend.
- Frontend guia y previene.
- Backend valida y protege integridad.
- Para acciones sensibles:
  - anular/eliminar/cerrar -> siempre confirmacion previa.

## 9) Observabilidad funcional minima

Registrar eventos de negocio clave (auditoria):

- Crear/editar/anular movimientos
- Cierre de caja
- Cambios de usuario/rol/sucursal
- Cambios sensibles de configuracion

Siempre con contexto: tenant, sucursal, usuario, fecha.

## 10) Definition of Done UI/UX (checklist rapido)

Antes de cerrar cualquier ajuste:

- [ ] Usa componentes base del sistema.
- [ ] Respeta espaciado, tipografia y colores globales.
- [ ] Tiene estados `loading`, `empty`, `error`, `success`.
- [ ] Usa `ToastAlert` para feedback.
- [ ] Tiene validaciones de formulario claras.
- [ ] Tiene confirmacion para acciones criticas.
- [ ] Funciona con teclado y foco visible.
- [ ] Responsive valido en movil (sin quiebres).
- [ ] Sin regresion funcional del modulo.
- [ ] Microcopy consistente con el resto del sistema.

## 11) Prioridad sugerida de adopcion

1. Modulos operativos criticos: `Caja`, `Caja Fuerte`, `Usuarios`.
2. Modulos de alta consulta: `Reportes`, `Clases`, `Vehiculos`.
3. Resto de modulos tenant y backoffice.

---

Version: v1  
Alcance inicial: Tenant-Core + Backoffice operativo  
Proxima revision recomendada: cuando se complete una iteracion funcional mayor.
