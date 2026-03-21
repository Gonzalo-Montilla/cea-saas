from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text(
            """
            ALTER TABLE saas_leads
            ADD COLUMN IF NOT EXISTS converted_tenant_id INTEGER;
            """
        ))
        conn.execute(text(
            """
            ALTER TABLE saas_leads
            ADD COLUMN IF NOT EXISTS converted_admin_user_id INTEGER;
            """
        ))
        conn.execute(text(
            """
            ALTER TABLE saas_leads
            ADD COLUMN IF NOT EXISTS converted_at TIMESTAMP WITHOUT TIME ZONE;
            """
        ))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_leads_converted_tenant_id ON saas_leads(converted_tenant_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_leads_converted_at ON saas_leads(converted_at DESC);"))
        conn.commit()
    print("OK: campos de conversion agregados en saas_leads.")


if __name__ == "__main__":
    run_migration()
