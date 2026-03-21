from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text(
            """
            CREATE TABLE IF NOT EXISTS saas_billing_events (
                id SERIAL PRIMARY KEY,
                tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                event_type VARCHAR(40) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'PAID',
                amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                currency VARCHAR(10) NOT NULL DEFAULT 'COP',
                paid_at TIMESTAMP WITHOUT TIME ZONE,
                due_at TIMESTAMP WITHOUT TIME ZONE,
                reference VARCHAR(120),
                notes TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            );
            """
        ))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_billing_events_tenant_id ON saas_billing_events(tenant_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_billing_events_created_at ON saas_billing_events(created_at DESC);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_billing_events_type_status ON saas_billing_events(event_type, status);"))
        conn.commit()
    print("OK: tabla saas_billing_events creada/validada.")


if __name__ == "__main__":
    run_migration()
