from __future__ import annotations

import sys
from typing import List

from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal


def _check_required_env() -> List[str]:
    errors: List[str] = []
    if not (settings.APP_URL or "").strip():
        errors.append("APP_URL no configurado")
    if not (settings.PORTAL_URL or "").strip():
        errors.append("PORTAL_URL no configurado")
    if not (settings.DATABASE_URL or "").strip():
        errors.append("DATABASE_URL no configurado")
    if not (settings.SECRET_KEY or "").strip() or "change-in-production" in settings.SECRET_KEY.lower():
        errors.append("SECRET_KEY inseguro o sin cambiar")
    if not (settings.SMTP_USER or "").strip():
        errors.append("SMTP_USER no configurado")
    if not (settings.SMTP_PASSWORD or "").strip():
        errors.append("SMTP_PASSWORD no configurado")
    if not (settings.SAAS_ADMIN_EMAILS or "").strip():
        errors.append("SAAS_ADMIN_EMAILS no configurado")
    if not (settings.SAAS_SUPPORT_ALERT_EMAILS or "").strip():
        errors.append("SAAS_SUPPORT_ALERT_EMAILS no configurado")
    app_env = (settings.APP_ENV or "").strip().lower()
    if app_env == "production":
        app_url = (settings.APP_URL or "").strip().lower()
        portal_url = (settings.PORTAL_URL or "").strip().lower()
        if "localhost" in app_url or "127.0.0.1" in app_url:
            errors.append("APP_URL no debe apuntar a localhost en produccion")
        if "localhost" in portal_url or "127.0.0.1" in portal_url:
            errors.append("PORTAL_URL no debe apuntar a localhost en produccion")
    return errors


def _check_db_connection() -> List[str]:
    errors: List[str] = []
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        errors.append(f"No conecta a DB: {exc}")
    finally:
        db.close()
    return errors


def main() -> None:
    errors: List[str] = []
    errors.extend(_check_required_env())
    errors.extend(_check_db_connection())

    if errors:
        print("PRECHECK FAIL")
        for err in errors:
            print(f"- {err}")
        sys.exit(1)

    print("PRECHECK OK")
    print("- Variables críticas configuradas")
    print("- Conexión a base de datos verificada")


if __name__ == "__main__":
    main()
