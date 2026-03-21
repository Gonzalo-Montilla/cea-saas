from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text(
            """
            ALTER TABLE saas_support_tickets
            ADD COLUMN IF NOT EXISTS last_sla_alert_at TIMESTAMP WITHOUT TIME ZONE;
            """
        ))
        conn.commit()
    print("OK: campo last_sla_alert_at agregado en saas_support_tickets.")


if __name__ == "__main__":
    run_migration()
