from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text(
            """
            ALTER TABLE tenants
            ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(30) NOT NULL DEFAULT 'TRIAL';
            """
        ))
        conn.execute(text(
            """
            ALTER TABLE tenants
            ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) NOT NULL DEFAULT 'MONTHLY';
            """
        ))
        conn.execute(text(
            """
            ALTER TABLE tenants
            ADD COLUMN IF NOT EXISTS monthly_fee NUMERIC(12,2) NOT NULL DEFAULT 0;
            """
        ))
        conn.execute(text(
            """
            ALTER TABLE tenants
            ADD COLUMN IF NOT EXISTS next_billing_at TIMESTAMP WITHOUT TIME ZONE;
            """
        ))
        conn.execute(text(
            """
            ALTER TABLE tenants
            ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMP WITHOUT TIME ZONE;
            """
        ))
        conn.commit()
    print("OK: campos de facturacion agregados en tenants.")


if __name__ == "__main__":
    run_migration()
