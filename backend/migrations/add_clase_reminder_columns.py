from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(
            text(
                """
                ALTER TABLE clases
                ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMP WITHOUT TIME ZONE;
                """
            )
        )
        conn.execute(
            text(
                """
                ALTER TABLE clases
                ADD COLUMN IF NOT EXISTS reminder_2h_sent_at TIMESTAMP WITHOUT TIME ZONE;
                """
            )
        )
        conn.commit()
    print("OK: columnas de recordatorio agregadas en clases.")


if __name__ == "__main__":
    run_migration()
