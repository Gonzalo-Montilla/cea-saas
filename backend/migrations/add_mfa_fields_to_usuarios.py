from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text(
            """
            ALTER TABLE usuarios
            ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
            """
        ))
        conn.execute(text(
            """
            ALTER TABLE usuarios
            ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(255);
            """
        ))
        conn.commit()
    print("OK: campos MFA agregados en usuarios.")


if __name__ == "__main__":
    run_migration()
