from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text(
            """
            ALTER TABLE usuarios
            ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
            """
        ))
        conn.execute(text(
            """
            ALTER TABLE usuarios
            ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMP WITHOUT TIME ZONE;
            """
        ))
        conn.execute(text(
            """
            ALTER TABLE usuarios
            ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMP WITHOUT TIME ZONE;
            """
        ))
        conn.commit()
    print("OK: campos de proteccion de login SaaS agregados en usuarios.")


if __name__ == "__main__":
    run_migration()
