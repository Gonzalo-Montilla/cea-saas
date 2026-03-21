from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text(
            """
            CREATE TABLE IF NOT EXISTS saas_leads (
                id SERIAL PRIMARY KEY,
                escuela_nombre VARCHAR(255) NOT NULL,
                contacto_nombre VARCHAR(255) NOT NULL,
                contacto_email VARCHAR(255),
                contacto_telefono VARCHAR(50),
                ciudad VARCHAR(120),
                source VARCHAR(80) NOT NULL DEFAULT 'manual',
                plan_interes VARCHAR(30),
                estado VARCHAR(40) NOT NULL DEFAULT 'NUEVO',
                valor_estimado_mrr NUMERIC(12, 2),
                owner_email VARCHAR(255) NOT NULL,
                proxima_accion_at TIMESTAMP WITHOUT TIME ZONE,
                notas TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP WITHOUT TIME ZONE
            );
            """
        ))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_leads_estado ON saas_leads(estado);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_leads_created_at ON saas_leads(created_at DESC);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_leads_owner_email ON saas_leads(owner_email);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_saas_leads_contacto_email ON saas_leads(contacto_email);"))
        conn.commit()
    print("OK: tabla saas_leads creada/validada.")


if __name__ == "__main__":
    run_migration()
