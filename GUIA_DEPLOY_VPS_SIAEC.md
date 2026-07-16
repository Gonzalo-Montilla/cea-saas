# Guia Deploy VPS - SIAEC

Guia operativa para desplegar SIAEC en el VPS sin afectar otros proyectos.

## 1) Alcance y contexto actual

Esta guia aplica al entorno productivo actual:

- Repositorio: `https://github.com/Gonzalo-Montilla/cea-saas.git`
- Rama de despliegue: `develop`
- Ruta proyecto: `/opt/siaec/SAAS-CEA`
- Backend service: `siaec-backend.service`
- Backend bind: `127.0.0.1:8012`
- Frontend publico: `/var/www/siaec`
- Nginx site: `/etc/nginx/sites-available/siaec.com.co`
- Dominio: `https://siaec.com.co`

## 2) Regla de oro (no romper otros proyectos)

Solo tocar:

- `/opt/siaec/SAAS-CEA`
- `/var/www/siaec`
- `siaec-backend.service`
- sitio Nginx de `siaec.com.co` (si es necesario)

No modificar otros sites, servicios, puertos o carpetas de otros sistemas.

## 3) Pre-deploy rapido

```bash
cd /opt/siaec/SAAS-CEA
git branch --show-current
git status -sb
git log -1 --oneline
sudo systemctl status siaec-backend --no-pager
curl -fsS http://127.0.0.1:8012/health/ready
```

Esperado:

- Rama `develop`
- Servicio backend activo
- `health/ready` con `ready=true`

## 4) Backup y proteccion antes de desplegar

```bash
cd /opt/siaec/SAAS-CEA
STAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p /opt/siaec/backups
git rev-parse HEAD > /opt/siaec/backups/siaec_prev_sha_${STAMP}.txt
git status -sb > /opt/siaec/backups/siaec_status_${STAMP}.txt
git stash push -u -m "pre-deploy-${STAMP}"
```

## 5) Pull de codigo

```bash
cd /opt/siaec/SAAS-CEA
git fetch origin
git checkout develop
git pull --ff-only origin develop
git log -1 --oneline
```

## 6) Deploy completo (backend + frontend)

### 6.1 Backend

```bash
cd /opt/siaec/SAAS-CEA/backend
.venv/bin/pip install -r requirements.txt
PYTHONPATH=. .venv/bin/python migrations/create_conceptos_ingreso_tenant.py
.venv/bin/python -m scripts.preflight_production
sudo systemctl restart siaec-backend
sudo systemctl status siaec-backend --no-pager -l
curl -fsS http://127.0.0.1:8012/health/ready
```

Verificacion opcional de tabla:

```bash
sudo -u postgres psql -d siaec_prod -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='conceptos_ingreso_tenant';"
```

### 6.2 Frontend

```bash
cd /opt/siaec/SAAS-CEA/frontend
npm install
npm run build
```

Publicacion:

```bash
STAMP=$(date +%Y%m%d_%H%M%S)
sudo mkdir -p /var/www/backups
sudo tar -czf /var/www/backups/siaec_frontend_${STAMP}.tgz -C /var/www siaec
sudo rsync -av --delete dist/ /var/www/siaec/
sudo chown -R www-data:www-data /var/www/siaec
sudo nginx -t && sudo systemctl reload nginx
```

## 7) Deploy solo frontend (hotfix UI)

Usar cuando no hay cambios backend:

```bash
cd /opt/siaec/SAAS-CEA
git fetch origin
git checkout develop
git pull --ff-only origin develop

cd /opt/siaec/SAAS-CEA/frontend
npm install
npm run build

STAMP=$(date +%Y%m%d_%H%M%S)
sudo tar -czf /var/www/backups/siaec_frontend_${STAMP}.tgz -C /var/www siaec
sudo rsync -av --delete dist/ /var/www/siaec/
sudo chown -R www-data:www-data /var/www/siaec
sudo nginx -t && sudo systemctl reload nginx
```

## 8) Validacion post-deploy

```bash
curl -I https://siaec.com.co
curl -fsS https://siaec.com.co/health/ready
```

Validacion funcional minima en navegador (Ctrl+F5):

- `Caja` (pago simple y pago mixto)
- `Caja > Registrar Otro Concepto` (guardar + confirmacion visible)
- `Tarifas > Conceptos configurables`
- `Estudiantes` y `EstudianteDetalle`
- `SaasAdmin` (pantallas principales)

## 9) Rollback rapido

### 9.1 Frontend

```bash
sudo rm -rf /var/www/siaec/*
sudo tar -xzf /var/www/backups/siaec_frontend_<STAMP>.tgz -C /var/www
sudo chown -R www-data:www-data /var/www/siaec
sudo nginx -t && sudo systemctl reload nginx
```

### 9.2 Backend (volver a commit previo)

```bash
cd /opt/siaec/SAAS-CEA
PREV_SHA=$(cat /opt/siaec/backups/siaec_prev_sha_<STAMP>.txt)
git checkout develop
git reset --hard "$PREV_SHA"
sudo systemctl restart siaec-backend
curl -fsS http://127.0.0.1:8012/health/ready
```

## 10) Troubleshooting real (casos que ya pasaron)

### A) Migracion falla con `ModuleNotFoundError: No module named 'app'`

Solucion:

```bash
cd /opt/siaec/SAAS-CEA/backend
PYTHONPATH=. .venv/bin/python migrations/<archivo>.py
```

### B) `curl health` falla justo despues de `restart`

Puede ser arranque en curso. Verificar:

```bash
sudo systemctl status siaec-backend --no-pager -l
sudo journalctl -u siaec-backend -n 120 --no-pager
```

### C) `npm ci` falla por lock desincronizado

Usar:

```bash
npm install
npm run build
```

### D) ConfirmDialog queda detras del modal principal

Ya corregido en codigo (stacking con z-index configurable en `ModalBase` y `ConfirmDialog` mas alto).

### E) Comando `rg` no existe en VPS

Usar `grep` en servidor Linux:

```bash
sudo systemctl list-units --type=service --state=running | grep -Ei "nginx|gunicorn|uvicorn|python|siaec"
```

## 11) Seguridad y buenas practicas

- Nunca pegar credenciales en chats o tickets.
- Rotar credenciales si se exponen accidentalmente.
- No aplicar `git stash pop` del servidor sin revisar antes.
- Evitar deploy sin `npm run build` exitoso.
- Siempre validar `health/ready` y humo funcional antes de cerrar.

## 12) Registro de deploy (plantilla)

Copiar y diligenciar al final de cada despliegue:

```text
Fecha/hora:
Responsable:
Commit backend/frontend:
Se ejecuto preflight: SI/NO
Health ready: OK/FAIL
Smoke UI: OK/FAIL
Backup frontend: /var/www/backups/siaec_frontend_<STAMP>.tgz
Observaciones:
```

