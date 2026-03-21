# Runbook - Task Scheduler (Windows)

Usar este runbook para dejar automatizaciones operativas en servidor Windows.

## 1) Verificar scripts disponibles

- `backend\scripts\run_class_reminders.bat`
- `backend\scripts\run_saas_automation.bat`
- `backend\scripts\run_preflight_production.bat`

## 2) Ejecutar preflight manual (una vez)

En PowerShell (desde raiz del proyecto):

```powershell
cd C:\Proyectos\SAAS-CEA\backend
python -m scripts.preflight_production
```

Esperado: `PRECHECK OK`.

## 3) Crear tareas programadas (schtasks)

Abrir PowerShell **como administrador** y ejecutar:

```powershell
schtasks /Create /TN "SIAEC_Class_Reminders_10m" /SC MINUTE /MO 10 /TR "C:\Proyectos\SAAS-CEA\backend\scripts\run_class_reminders.bat" /F
```

```powershell
schtasks /Create /TN "SIAEC_SaaS_Automation_Daily" /SC DAILY /ST 08:00 /TR "C:\Proyectos\SAAS-CEA\backend\scripts\run_saas_automation.bat" /F
```

## 4) Probar tareas de inmediato

```powershell
schtasks /Run /TN "SIAEC_Class_Reminders_10m"
schtasks /Run /TN "SIAEC_SaaS_Automation_Daily"
```

## 5) Verificacion posterior

```powershell
schtasks /Query /TN "SIAEC_Class_Reminders_10m" /V /FO LIST
schtasks /Query /TN "SIAEC_SaaS_Automation_Daily" /V /FO LIST
```

Confirmar:
- Last Run Time actualizado
- Last Result = `0x0`

## 6) Rollback rapido

```powershell
schtasks /Delete /TN "SIAEC_Class_Reminders_10m" /F
schtasks /Delete /TN "SIAEC_SaaS_Automation_Daily" /F
```
