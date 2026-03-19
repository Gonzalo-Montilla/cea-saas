from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine


def _get_default_tenant_id(conn) -> int:
    tenant_slug = (settings.DEFAULT_TENANT_SLUG or "legacy-default").strip().lower()
    row = conn.execute(
        text("SELECT id FROM tenants WHERE slug = :slug LIMIT 1"),
        {"slug": tenant_slug},
    ).fetchone()
    if row:
        return int(row[0])
    fallback = conn.execute(text("SELECT id FROM tenants ORDER BY id ASC LIMIT 1")).fetchone()
    if not fallback:
        raise RuntimeError("No existe ningún tenant para backfill.")
    return int(fallback[0])


def run_migration():
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE instructores ADD COLUMN IF NOT EXISTS tenant_id INTEGER;"))
        conn.execute(text("ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS tenant_id INTEGER;"))

        conn.execute(
            text(
                """
                UPDATE instructores i
                SET tenant_id = u.tenant_id
                FROM usuarios u
                WHERE i.usuario_id = u.id
                  AND i.tenant_id IS NULL
                """
            )
        )

        conn.execute(
            text(
                """
                UPDATE vehiculos v
                SET tenant_id = i.tenant_id
                FROM instructores i
                WHERE v.responsable_instructor_id = i.id
                  AND v.tenant_id IS NULL
                """
            )
        )

        default_tenant_id = _get_default_tenant_id(conn)
        conn.execute(
            text("UPDATE instructores SET tenant_id = :tenant_id WHERE tenant_id IS NULL"),
            {"tenant_id": default_tenant_id},
        )
        conn.execute(
            text("UPDATE vehiculos SET tenant_id = :tenant_id WHERE tenant_id IS NULL"),
            {"tenant_id": default_tenant_id},
        )

        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_instructores_tenant_id ON instructores (tenant_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_vehiculos_tenant_id ON vehiculos (tenant_id);"))

        conn.commit()
    print("OK: tenant_id agregado y backfilled en instructores/vehiculos.")


if __name__ == "__main__":
    run_migration()

