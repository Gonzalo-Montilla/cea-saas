from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS tenant_branches (
                id SERIAL PRIMARY KEY,
                tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                nombre VARCHAR(255) NOT NULL,
                codigo VARCHAR(50) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                is_primary BOOLEAN NOT NULL DEFAULT FALSE,
                direccion VARCHAR(255),
                ciudad VARCHAR(120),
                contacto_telefono VARCHAR(50),
                contacto_email VARCHAR(255),
                observaciones TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP
            );
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS tenant_user_branches (
                id SERIAL PRIMARY KEY,
                tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                user_id INTEGER NOT NULL REFERENCES usuarios(id),
                branch_id INTEGER NOT NULL REFERENCES tenant_branches(id),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
        """))

        conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_branch_codigo
            ON tenant_branches (tenant_id, codigo);
        """))
        conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_user_branch
            ON tenant_user_branches (tenant_id, user_id, branch_id);
        """))

        conn.execute(text("""
            INSERT INTO tenant_branches (tenant_id, nombre, codigo, is_active, is_primary, created_at)
            SELECT t.id,
                   COALESCE(NULLIF(TRIM(t.display_name), ''), NULLIF(TRIM(t.nombre), ''), 'Sede Principal') AS nombre,
                   'PRINCIPAL' AS codigo,
                   TRUE,
                   TRUE,
                   NOW()
            FROM tenants t
            WHERE NOT EXISTS (
                SELECT 1 FROM tenant_branches b WHERE b.tenant_id = t.id
            );
        """))

        conn.execute(text("""
            UPDATE tenant_branches b
            SET is_primary = TRUE
            WHERE b.id IN (
                SELECT MIN(b2.id)
                FROM tenant_branches b2
                GROUP BY b2.tenant_id
            )
            AND b.is_primary = FALSE;
        """))

        conn.execute(text("""
            INSERT INTO tenant_user_branches (tenant_id, user_id, branch_id, is_active, created_at)
            SELECT u.tenant_id, u.id, b.id, TRUE, NOW()
            FROM usuarios u
            JOIN tenant_branches b
              ON b.tenant_id = u.tenant_id
             AND b.is_primary = TRUE
            WHERE u.tenant_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM tenant_user_branches ub
                  WHERE ub.tenant_id = u.tenant_id
                    AND ub.user_id = u.id
                    AND ub.branch_id = b.id
              );
        """))
        conn.commit()


if __name__ == "__main__":
    run_migration()
    print("Migration create_tenant_branches completed.")
