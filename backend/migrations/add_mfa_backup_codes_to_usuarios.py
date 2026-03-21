from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text(
            """
            ALTER TABLE usuarios
            ADD COLUMN IF NOT EXISTS mfa_backup_codes_hashes JSONB NOT NULL DEFAULT '[]'::jsonb;
            """
        ))
        conn.commit()
    print("OK: campo mfa_backup_codes_hashes agregado en usuarios.")


if __name__ == "__main__":
    run_migration()
