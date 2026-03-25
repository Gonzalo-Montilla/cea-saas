from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS saas_payment_receipts (
                id SERIAL PRIMARY KEY,
                billing_event_id INTEGER NOT NULL UNIQUE REFERENCES saas_billing_events(id),
                tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                receipt_number VARCHAR(80) NOT NULL UNIQUE,
                subtotal_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                iva_rate NUMERIC(6,4) NOT NULL DEFAULT 0.19,
                iva_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                file_path VARCHAR(500) NOT NULL,
                sent_to_email VARCHAR(255),
                sent_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP
            );
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_saas_payment_receipts_tenant_id
            ON saas_payment_receipts (tenant_id);
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_saas_payment_receipts_created_at
            ON saas_payment_receipts (created_at);
        """))
        conn.commit()


if __name__ == "__main__":
    run_migration()
    print("Migration create_saas_payment_receipts completed.")
