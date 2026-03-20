from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(
            text(
                """
                ALTER TABLE tenants
                ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
                """
            )
        )
        conn.execute(
            text(
                """
                ALTER TABLE tenants
                ADD COLUMN IF NOT EXISTS demo_ends_at TIMESTAMP WITHOUT TIME ZONE;
                """
            )
        )
        conn.commit()
    print("OK: campos demo agregados en tenants.")


if __name__ == "__main__":
    run_migration()
