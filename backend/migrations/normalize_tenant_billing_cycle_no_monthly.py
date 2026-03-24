from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text("""
            UPDATE tenants
            SET billing_cycle = 'QUARTERLY'
            WHERE UPPER(COALESCE(billing_cycle, '')) = 'MONTHLY';
        """))
        conn.commit()


if __name__ == "__main__":
    run_migration()
    print("Migration normalize_tenant_billing_cycle_no_monthly completed.")
