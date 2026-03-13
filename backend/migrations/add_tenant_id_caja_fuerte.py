from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine


def _ensure_default_tenant(conn) -> int:
    tenant_slug = (settings.DEFAULT_TENANT_SLUG or "legacy-default").strip().lower()
    existing = conn.execute(
        text("SELECT id FROM tenants WHERE slug = :slug LIMIT 1"),
        {"slug": tenant_slug},
    ).fetchone()
    if existing:
        return int(existing[0])

    tenant_name = "SIAEC Demo"
    inserted = conn.execute(
        text(
            """
            INSERT INTO tenants (slug, nombre, display_name, plan, is_active, created_at)
            VALUES (:slug, :nombre, :display_name, 'FREE', TRUE, NOW())
            RETURNING id
            """
        ),
        {"slug": tenant_slug, "nombre": tenant_name, "display_name": tenant_name},
    ).fetchone()
    return int(inserted[0])


def run_migration():
    with engine.connect() as conn:
        default_tenant_id = _ensure_default_tenant(conn)
        conn.execute(text("ALTER TABLE caja_fuerte ADD COLUMN IF NOT EXISTS tenant_id INTEGER;"))
        conn.execute(
            text("UPDATE caja_fuerte SET tenant_id = :tenant_id WHERE tenant_id IS NULL"),
            {"tenant_id": default_tenant_id},
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_caja_fuerte_tenant_id ON caja_fuerte (tenant_id);")
        )
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_caja_fuerte_tenant
                ON caja_fuerte (tenant_id)
                WHERE tenant_id IS NOT NULL;
                """
            )
        )
        conn.commit()


if __name__ == "__main__":
    run_migration()
    print("Migration add_tenant_id_caja_fuerte completed.")
