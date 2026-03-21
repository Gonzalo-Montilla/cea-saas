from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text(
            """
            ALTER TABLE usuarios
            ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
            """
        ))
        conn.execute(text(
            """
            UPDATE usuarios
            SET session_version = 1
            WHERE session_version IS NULL OR session_version < 1;
            """
        ))
        conn.commit()
    print("OK: campo session_version agregado en usuarios.")


if __name__ == "__main__":
    run_migration()
