from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS conceptos_ingreso_tenant (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    nombre VARCHAR(120) NOT NULL,
                    categoria VARCHAR(50) NOT NULL DEFAULT 'OTROS',
                    valor_default NUMERIC(10, 2) NOT NULL DEFAULT 0,
                    activo BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP
                );
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_conceptos_ingreso_tenant_nombre
                ON conceptos_ingreso_tenant (tenant_id, nombre);
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_conceptos_ingreso_tenant_tenant_id
                ON conceptos_ingreso_tenant (tenant_id);
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_conceptos_ingreso_tenant_activo
                ON conceptos_ingreso_tenant (activo);
                """
            )
        )
        conn.commit()


if __name__ == "__main__":
    run_migration()
    print("Migration create_conceptos_ingreso_tenant completed.")
