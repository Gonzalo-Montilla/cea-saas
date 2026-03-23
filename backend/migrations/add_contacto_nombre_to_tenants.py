from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text("""
            ALTER TABLE tenants
            ADD COLUMN IF NOT EXISTS contacto_nombre VARCHAR(255);
        """))
        conn.commit()


if __name__ == "__main__":
    run_migration()
    print("Migration add_contacto_nombre_to_tenants completed.")
