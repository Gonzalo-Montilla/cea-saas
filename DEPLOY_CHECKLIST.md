# SIAEC SaaS - Deploy Checklist

Checklist rapido para pasar de local/staging a produccion sin romper acceso, correo o tenancy.

## 1) Variables de entorno criticas

### Backend (`backend/.env`)

- `APP_ENV=production`
- `APP_URL=https://api.tu-dominio.com`
- `PORTAL_URL=https://app.tu-dominio.com`  <-- clave para enlaces en correos
- `SECRET_KEY` fuerte y unica
- `DATABASE_URL` de produccion
- `BACKEND_CORS_ORIGINS` con dominios reales de frontend
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_USE_TLS`
- `SMTP_FROM_NAME` con marca oficial
- `SAAS_ADMIN_EMAILS` solo correos owner autorizados
- `SAAS_ADMIN_ALLOWED_ROLES` revisado (ej. `ADMIN,GERENTE`)

### Frontend (`frontend/.env`)

- URL base API apuntando a backend de produccion
- Variables de branding y entorno consistentes

## 2) Seguridad y acceso

- Confirmar usuario owner SaaS activo
- Confirmar `permisos_modulos` con `saas_admin`
- MFA habilitado para cuentas internas criticas (owner)
- Verificar expiracion/invalidez de sesion al cambiar password

## 3) Correo y enlaces marca blanca

- Probar envio SMTP real desde produccion
- Verificar asunto/remitente de correos SaaS
- Confirmar que el enlace de acceso llegue asi:
  - `https://app.tu-dominio.com/login?tenant=<slug>`
- Confirmar boton "Reenviar enlace" desde Backoffice

## 4) Base de datos y migraciones

- Backup antes de migrar
- Ejecutar todas las migraciones pendientes
- Validar tablas nuevas de backoffice (billing, support, leads, audit, mfa/session fields)

## 5) Pruebas smoke (obligatorias)

- Registro de escuela exitoso
- Correo de bienvenida con enlace correcto
- Login escuela con enlace (`tenant` precargado)
- Login SaaS global separado (`/login-saas`)
- Cambio de password obligatorio y redireccion limpio
- Acceso por modulos segun permisos internos
- Flujo basico de facturacion y soporte sin errores 500/401/403 inesperados
- Ejecutar `backend\scripts\run_preflight_production.bat` y confirmar `PRECHECK OK`
- Verificar `GET /health/ready` responde `ready=true`

## 6) Observabilidad minima

- Revisar logs backend al iniciar
- Revisar errores JS en consola frontend
- Configurar alertas basicas (caida API, error SMTP, error DB)

## 7) Automatizaciones programadas (obligatorio)

- Programar en servidor (Task Scheduler o cron) la ejecucion de:
  - `backend\scripts\run_class_reminders.bat` (cada 10 minutos)
  - `backend\scripts\run_saas_automation.bat` (1 vez por dia, recomendado 08:00)
- Verificar que ambos procesos escriban salida `OK:` en logs de ejecucion
- Si falla una tarea, validar acceso a DB, SMTP y variables de entorno

## 8) Go-live

- Ventana de despliegue definida
- Rollback plan definido
- Responsable tecnico y responsable de negocio asignados
- Mensaje interno de "produccion estable" despues de smoke tests

