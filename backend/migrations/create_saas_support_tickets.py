from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text(
            """
            CREATE TABLE IF NOT EXISTS saas_support_tickets (
                id SERIAL PRIMARY KEY,
                tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
                priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
                category VARCHAR(40) NOT NULL DEFAULT 'GENERAL',
                subject VARCHAR(255) NOT NULL,
                description TEXT,
                owner_email VARCHAR(255),
                requester_name VARCHAR(255),
                requester_email VARCHAR(255),
                requester_phone VARCHAR(50),
                resolution_notes TEXT,
                due_at TIMESTAMP WITHOUT TIME ZONE,
                resolved_at TIMESTAMP WITHOUT TIME ZONE,
                last_sla_alert_at TIMESTAMP WITHOUT TIME ZONE,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE
            );
            """
        ))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_support_tickets_tenant_id ON saas_support_tickets(tenant_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_support_tickets_status ON saas_support_tickets(status);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_support_tickets_priority ON saas_support_tickets(priority);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_support_tickets_owner_email ON saas_support_tickets(owner_email);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_support_tickets_created_at ON saas_support_tickets(created_at DESC);"))
        conn.commit()
    print("OK: tabla saas_support_tickets creada/validada.")


if __name__ == "__main__":
    run_migration()
