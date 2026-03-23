#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/siaec/SAAS-CEA/backend"
VENV_BIN="${APP_DIR}/.venv/bin"

cd "${APP_DIR}"

echo "== [1/4] Run custom migrations caja_fuerte =="
"${VENV_BIN}/python" migrations/create_caja_fuerte.py
"${VENV_BIN}/python" migrations/add_tenant_id_caja_fuerte.py
"${VENV_BIN}/python" migrations/add_inventario_detalle_movimientos_caja_fuerte.py
echo "OK custom migrations"

echo "== [2/4] Verify schema caja_fuerte =="
"${VENV_BIN}/python" - <<'PY'
from sqlalchemy import text
from app.core.database import engine

required_tables = {"caja_fuerte", "movimientos_caja_fuerte", "inventario_efectivo"}
with engine.connect() as conn:
    rows = conn.execute(
        text(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema='public'
              AND table_name IN ('caja_fuerte', 'movimientos_caja_fuerte', 'inventario_efectivo')
            """
        )
    ).fetchall()
    found_tables = {r[0] for r in rows}
    missing_tables = sorted(required_tables - found_tables)
    if missing_tables:
        raise SystemExit(f"ERROR missing tables: {missing_tables}")

    tenant_col = conn.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema='public'
              AND table_name='caja_fuerte'
              AND column_name='tenant_id'
            LIMIT 1
            """
        )
    ).fetchone()
    if not tenant_col:
        raise SystemExit("ERROR missing column caja_fuerte.tenant_id")

    uq = conn.execute(
        text(
            """
            SELECT 1
            FROM pg_indexes
            WHERE schemaname='public'
              AND tablename='caja_fuerte'
              AND indexname='uq_caja_fuerte_tenant'
            LIMIT 1
            """
        )
    ).fetchone()
    if not uq:
        raise SystemExit("ERROR missing unique index uq_caja_fuerte_tenant")

print("OK schema verification")
PY

echo "== [3/4] Restart backend =="
systemctl restart siaec-backend

echo "== [4/4] Health + logs check =="
curl -fsS --retry 30 --retry-delay 1 --retry-connrefused http://127.0.0.1:8012/health >/dev/null
curl -fsS --retry 30 --retry-delay 1 --retry-connrefused http://127.0.0.1:8012/health/ready >/dev/null
sudo journalctl -u siaec-backend -n 120 --no-pager | grep -Ei "caja_fuerte|UndefinedTable|Traceback|ERROR" || true
echo "OK fix_caja_fuerte_prod"
