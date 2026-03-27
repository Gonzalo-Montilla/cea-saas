#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/siaec/SAAS-CEA/backend"
VENV_PY="${APP_DIR}/.venv/bin/python"

cd "${APP_DIR}"
export PYTHONPATH="${APP_DIR}:${PYTHONPATH:-}"

if [[ -f "${APP_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${APP_DIR}/.env"
  set +a
fi

"${VENV_PY}" -m scripts.run_saas_automation
