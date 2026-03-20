from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text(
            """
            ALTER TABLE usuarios
            ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
            """
        ))
        conn.execute(text(
            """
            ALTER TABLE usuarios
            ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITHOUT TIME ZONE;
            """
        ))
        conn.execute(text(
            """
            UPDATE usuarios
            SET must_change_password = TRUE
            WHERE tenant_id IS NULL;
            """
        ))
        conn.commit()
    print("OK: campos de rotación de contraseña agregados en usuarios.")


if __name__ == "__main__":
    run_migration()
