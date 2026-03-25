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
    existing_cols = {
        row[0]
        for row in conn.execute(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'tenants'
                """
            )
        ).fetchall()
    }

    cols = ["slug", "nombre", "display_name", "plan", "is_active", "created_at"]
    values_sql = [":slug", ":nombre", ":display_name", "'FREE'", "TRUE", "NOW()"]
    params = {"slug": tenant_slug, "nombre": tenant_name, "display_name": tenant_name}

    # Compatibilidad con esquemas nuevos que marcaron columnas NOT NULL.
    if "is_demo" in existing_cols:
        cols.append("is_demo")
        values_sql.append("FALSE")
    if "subscription_status" in existing_cols:
        cols.append("subscription_status")
        values_sql.append("'TRIAL'")
    if "billing_cycle" in existing_cols:
        cols.append("billing_cycle")
        values_sql.append("'QUARTERLY'")
    if "monthly_fee" in existing_cols:
        cols.append("monthly_fee")
        values_sql.append("0")

    insert_sql = f"""
        INSERT INTO tenants ({", ".join(cols)})
        VALUES ({", ".join(values_sql)})
        RETURNING id
    """
    inserted = conn.execute(text(insert_sql), params).fetchone()
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
