from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine


def _ensure_default_tenant(conn) -> int:
    tenant_slug = (settings.DEFAULT_TENANT_SLUG or "legacy-default").strip().lower()
    tenant_name = settings.DEFAULT_TENANT_NAME if hasattr(settings, "DEFAULT_TENANT_NAME") else "Tenant Legacy"
    tenant_name = tenant_name or "Tenant Legacy"

    existing = conn.execute(
        text("SELECT id FROM tenants WHERE slug = :slug LIMIT 1"),
        {"slug": tenant_slug},
    ).fetchone()
    if existing:
        return int(existing[0])

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
        # Ensure tenant foundation exists
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS tenants (
                    id SERIAL PRIMARY KEY,
                    slug VARCHAR(100) NOT NULL UNIQUE,
                    nombre VARCHAR(255) NOT NULL,
                    plan VARCHAR(30) NOT NULL DEFAULT 'FREE',
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    display_name VARCHAR(255),
                    logo_url VARCHAR(500),
                    contacto_email VARCHAR(255),
                    contacto_telefono VARCHAR(50),
                    nit VARCHAR(50),
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP
                );
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tenants_slug ON tenants (slug);"))

        default_tenant_id = _ensure_default_tenant(conn)

        # Add tenant_id columns
        conn.execute(text("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tenant_id INTEGER;"))
        conn.execute(text("ALTER TABLE estudiantes ADD COLUMN IF NOT EXISTS tenant_id INTEGER;"))
        conn.execute(text("ALTER TABLE cajas ADD COLUMN IF NOT EXISTS tenant_id INTEGER;"))
        conn.execute(text("ALTER TABLE pagos ADD COLUMN IF NOT EXISTS tenant_id INTEGER;"))
        conn.execute(text("ALTER TABLE tarifas ADD COLUMN IF NOT EXISTS tenant_id INTEGER;"))

        # Backfill with best effort
        conn.execute(
            text("UPDATE usuarios SET tenant_id = :tenant_id WHERE tenant_id IS NULL"),
            {"tenant_id": default_tenant_id},
        )

        conn.execute(
            text(
                """
                UPDATE estudiantes e
                SET tenant_id = u.tenant_id
                FROM usuarios u
                WHERE e.usuario_id = u.id
                  AND e.tenant_id IS NULL
                """
            )
        )
        conn.execute(
            text("UPDATE estudiantes SET tenant_id = :tenant_id WHERE tenant_id IS NULL"),
            {"tenant_id": default_tenant_id},
        )

        conn.execute(
            text(
                """
                UPDATE pagos p
                SET tenant_id = e.tenant_id
                FROM estudiantes e
                WHERE p.estudiante_id = e.id
                  AND p.tenant_id IS NULL
                """
            )
        )
        conn.execute(
            text(
                """
                UPDATE pagos p
                SET tenant_id = c.tenant_id
                FROM cajas c
                WHERE p.caja_id = c.id
                  AND p.tenant_id IS NULL
                """
            )
        )
        conn.execute(
            text("UPDATE pagos SET tenant_id = :tenant_id WHERE tenant_id IS NULL"),
            {"tenant_id": default_tenant_id},
        )

        conn.execute(
            text("UPDATE cajas SET tenant_id = :tenant_id WHERE tenant_id IS NULL"),
            {"tenant_id": default_tenant_id},
        )
        conn.execute(
            text("UPDATE tarifas SET tenant_id = :tenant_id WHERE tenant_id IS NULL"),
            {"tenant_id": default_tenant_id},
        )

        # Indexes for tenant filters
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_usuarios_tenant_id ON usuarios (tenant_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_estudiantes_tenant_id ON estudiantes (tenant_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cajas_tenant_id ON cajas (tenant_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pagos_tenant_id ON pagos (tenant_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tarifas_tenant_id ON tarifas (tenant_id);"))

        conn.commit()


if __name__ == "__main__":
    run_migration()
    print("Migration add_tenant_id_mvp_tables completed.")
