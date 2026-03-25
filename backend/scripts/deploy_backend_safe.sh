#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/siaec/SAAS-CEA/backend"
VENV_BIN="${APP_DIR}/.venv/bin"

if [[ ! -x "${VENV_BIN}/python" ]]; then
  echo "ERROR: no existe venv python en ${VENV_BIN}/python"
  exit 1
fi

cd "${APP_DIR}"

echo "== [1/5] Backend deps =="
"${VENV_BIN}/pip" install -r requirements.txt

echo "== [2/5] DB migrations alembic (si aplica) =="
if [[ -f "${APP_DIR}/alembic.ini" ]] && grep -q "script_location" "${APP_DIR}/alembic.ini"; then
  "${VENV_BIN}/python" -m alembic -c "${APP_DIR}/alembic.ini" upgrade head
  echo "OK alembic migrations"
else
  echo "SKIP alembic (alembic.ini no configurado)"
fi

echo "== [3/5] Custom migrations caja_fuerte + sucursales =="
"${VENV_BIN}/python" migrations/create_caja_fuerte.py
"${VENV_BIN}/python" migrations/add_tenant_id_caja_fuerte.py
"${VENV_BIN}/python" migrations/add_inventario_detalle_movimientos_caja_fuerte.py
"${VENV_BIN}/python" migrations/create_tenant_branches.py
"${VENV_BIN}/python" migrations/add_contacto_nombre_to_tenants.py
"${VENV_BIN}/python" migrations/normalize_tenant_billing_cycle_no_monthly.py
"${VENV_BIN}/python" migrations/create_saas_payment_receipts.py
"${VENV_BIN}/python" migrations/create_estudiante_otp_sessions.py
echo "OK custom migrations"

echo "== [4/5] Restart backend =="
systemctl restart siaec-backend

echo "== [5/5] Health checks =="
curl -fsS --retry 30 --retry-delay 1 --retry-connrefused http://127.0.0.1:8012/health >/dev/null
curl -fsS --retry 30 --retry-delay 1 --retry-connrefused http://127.0.0.1:8012/health/ready >/dev/null
echo "OK backend deploy"
