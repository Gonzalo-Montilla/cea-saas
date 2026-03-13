from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
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

        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS tenant_users (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    user_id INTEGER NOT NULL REFERENCES usuarios(id),
                    rol VARCHAR(30) NOT NULL,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    CONSTRAINT uq_tenant_user UNIQUE (tenant_id, user_id)
                );
                """
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_tenant_users_tenant_id ON tenant_users (tenant_id);"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_tenant_users_user_id ON tenant_users (user_id);"
            )
        )
        conn.commit()


if __name__ == "__main__":
    run_migration()
    print("Migration create_tenant_foundation completed.")
