from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS estudiante_otp_sessions (
                id SERIAL PRIMARY KEY,
                tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                created_by_user_id INTEGER NOT NULL REFERENCES usuarios(id),
                session_token VARCHAR(128) NOT NULL UNIQUE,
                estudiante_email VARCHAR(255) NOT NULL,
                otp_hash VARCHAR(255) NOT NULL,
                payload JSON NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 5,
                resend_count INTEGER NOT NULL DEFAULT 0,
                last_sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMP NOT NULL,
                verified_at TIMESTAMP,
                consumed_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_estudiante_otp_sessions_tenant_id
            ON estudiante_otp_sessions (tenant_id);
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_estudiante_otp_sessions_expires_at
            ON estudiante_otp_sessions (expires_at);
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_estudiante_otp_sessions_estudiante_email
            ON estudiante_otp_sessions (estudiante_email);
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_estudiante_otp_sessions_created_at
            ON estudiante_otp_sessions (created_at);
        """))
        conn.commit()


if __name__ == "__main__":
    run_migration()
    print("Migration create_estudiante_otp_sessions completed.")
