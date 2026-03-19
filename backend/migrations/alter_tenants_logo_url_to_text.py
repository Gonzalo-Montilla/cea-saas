from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(
            text(
                """
                ALTER TABLE tenants
                ALTER COLUMN logo_url TYPE TEXT;
                """
            )
        )
        conn.commit()
    print("OK: tenants.logo_url actualizado a TEXT.")


if __name__ == "__main__":
    run_migration()

