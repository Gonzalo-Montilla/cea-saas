from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS tenant_service_rules (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                    tipo_servicio VARCHAR(64) NOT NULL,
                    horas_teoricas_requeridas INTEGER NOT NULL DEFAULT 0,
                    horas_practicas_requeridas INTEGER NOT NULL DEFAULT 0,
                    activo BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP WITHOUT TIME ZONE
                );
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_service_rules_tenant_tipo
                ON tenant_service_rules (tenant_id, tipo_servicio);
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_tenant_service_rules_tenant_id
                ON tenant_service_rules (tenant_id);
                """
            )
        )
        conn.commit()
    print("OK: tenant_service_rules creada con índices.")


if __name__ == "__main__":
    run_migration()

