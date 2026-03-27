from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text

from app.core.database import SessionLocal


def main() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    script_path = backend_dir / "scripts" / "run_saas_automation.sh"
    lock_path = backend_dir / "scripts" / ".run_saas_automation.lock"
    log_path = Path("/var/log/siaec_saas_automation.log")

    errors: list[str] = []
    warnings: list[str] = []

    if not script_path.exists():
        errors.append(f"No existe script: {script_path}")
    elif not os.access(script_path, os.X_OK):
        warnings.append(f"Script no ejecutable: {script_path}")

    if not log_path.parent.exists():
        errors.append(f"No existe directorio de logs: {log_path.parent}")
    elif not os.access(log_path.parent, os.W_OK):
        warnings.append(f"Sin permisos de escritura en: {log_path.parent}")

    if lock_path.exists():
        try:
            age_seconds = (datetime.now(timezone.utc) - datetime.fromtimestamp(lock_path.stat().st_mtime, timezone.utc)).total_seconds()
            if age_seconds > 6 * 3600:
                warnings.append(f"Lock file con más de 6h: {lock_path}")
        except Exception:
            warnings.append(f"No se pudo evaluar antigüedad del lock: {lock_path}")

    db = SessionLocal()
    try:
        db.execute(text("select 1"))
    except Exception as exc:
        errors.append(f"Conexión DB falló: {exc}")
    finally:
        db.close()

    for item in warnings:
        print(f"WARN: {item}")
    for item in errors:
        print(f"ERROR: {item}")

    if errors:
        print("PRECHECK FAILED")
        raise SystemExit(1)
    if warnings:
        print("PRECHECK OK WITH WARNINGS")
    else:
        print("PRECHECK OK")


if __name__ == "__main__":
    main()
