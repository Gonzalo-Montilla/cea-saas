# SIAEC SaaS - Smoke Tests de Produccion

Usar esta lista despues de deploy y antes de anunciar "produccion estable".

## 1) Acceso y autenticacion

- [ ] Login SaaS global (`/login-saas`) con owner operativo
- [ ] MFA del owner (codigo TOTP) funciona correctamente
- [ ] Login escuela por enlace blanco (`/login?tenant=<slug>`) funciona
- [ ] Cambio de password invalida sesiones activas previas

## 2) Tenancy y permisos

- [ ] Usuario de Escuela A no ve datos de Escuela B
- [ ] Usuario interno sin scope de modulo recibe bloqueo correcto (403/UI)
- [ ] Auditoria registra acciones sensibles (usuarios, facturacion, soporte, MFA)

## 3) Flujo comercial y tenant

- [ ] Crear lead en pipeline
- [ ] Convertir lead a tenant demo (con credenciales)
- [ ] Enviar/Reenviar enlace de acceso por correo desde backoffice

## 4) Facturacion SaaS

- [ ] Registrar pago manual de tenant
- [ ] `last_payment_at` se actualiza automatico
- [ ] `is_demo` y `subscription_status` permanecen consistentes
- [ ] Correr `run_saas_automation.bat` y validar salida `OK: saas_automation`

## 5) Soporte

- [ ] Escuela crea ticket en portal (`Soporte`)
- [ ] Ticket aparece en backoffice `Soporte`
- [ ] Cambio a `IN_PROGRESS` envia correo al solicitante
- [ ] Cambio a `RESOLVED/CLOSED` envia correo al solicitante
- [ ] Correr `run_saas_automation.bat` y validar alertas SLA (si hay tickets por vencer)

## 6) Correos y enlaces

- [ ] Dominio en correos no usa placeholders (`tu-dominio-frontend.com`)
- [ ] Remitente y branding SMTP correctos
- [ ] Enlace de escuela apunta al dominio final de `PORTAL_URL`

## 7) Criterio de salida

- [ ] 100% checks en verde
- [ ] Sin errores 500/401/403 inesperados en flujos principales
- [ ] Mensaje interno de "produccion estable" emitido
