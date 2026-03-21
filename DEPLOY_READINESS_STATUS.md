# Deploy Readiness Status

Estado actualizado con validaciones tecnicas ejecutadas en entorno actual.

## Validaciones tecnicas (OK)

- `python -m scripts.preflight_production` => `PRECHECK OK`
- `GET /health/ready` => `ready: true`
- Tareas Windows creadas y habilitadas:
  - `SIAEC_Class_Reminders_10m`
  - `SIAEC_SaaS_Automation_Daily`
- Ejecucion inmediata de tareas (`schtasks /Run`) => correcta
- `Last Result` de ambas tareas => `0`
- `python -m scripts.send_class_reminders` => `OK`
- `python -m scripts.run_saas_automation` => `OK`
- Owner SaaS `softwaresiaec@gmail.com` creado/validado con scope `saas_admin`
- Login global de owner validado (`/api/v1/auth/login-global` => 200)

## Hallazgos a cerrar antes de produccion final

- `PORTAL_URL` aun apunta a `http://localhost:5173` en este entorno.
  - En produccion debe ser dominio real HTTPS.
- Cuentas SaaS con scope `saas_admin`: 3
  - Cuentas owner con `mfa_enabled=true`: 0
  - Accion inmediata: activar MFA en `softwaresiaec@gmail.com` en primer ingreso.

## Pendientes funcionales (smoke manual UI)

- Login SaaS con MFA owner
- Login tenant por enlace blanco (`/login?tenant=<slug>`)
- Flujo lead -> tenant demo -> reenviar enlace
- Flujo soporte tenant -> backoffice -> cambio a `IN_PROGRESS` y `RESOLVED/CLOSED` con correo
- Registrar pago y validar `last_payment_at` + consistencia `is_demo/subscription_status`

## Criterio para declarar "listo para deploy"

- Cerrar los 2 hallazgos tecnicos
- Completar smoke manual UI sin errores inesperados
- Confirmar evidencia final (capturas o acta breve de pruebas)
