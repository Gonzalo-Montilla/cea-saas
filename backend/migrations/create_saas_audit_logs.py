from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text(
            """
            CREATE TABLE IF NOT EXISTS saas_audit_logs (
                id SERIAL PRIMARY KEY,
                actor_user_id INTEGER NOT NULL REFERENCES usuarios(id),
                actor_email VARCHAR(255) NOT NULL,
                action VARCHAR(80) NOT NULL,
                entity_type VARCHAR(40) NOT NULL,
                entity_id VARCHAR(80) NOT NULL,
                summary VARCHAR(255) NOT NULL,
                payload JSONB,
                ip_address VARCHAR(80),
                user_agent TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            );
            """
        ))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_audit_logs_created_at ON saas_audit_logs(created_at DESC);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_audit_logs_action ON saas_audit_logs(action);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_audit_logs_entity ON saas_audit_logs(entity_type, entity_id);"))
        conn.commit()
    print("OK: tabla saas_audit_logs creada/validada.")


if __name__ == "__main__":
    run_migration()
