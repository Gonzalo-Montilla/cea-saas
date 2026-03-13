from sqlalchemy import text

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            # Drop legacy unique constraint if present (common when created by SQLAlchemy unique=True).
            conn.execute(
                text(
                    """
                    ALTER TABLE tarifas
                    DROP CONSTRAINT IF EXISTS tarifas_tipo_servicio_key;
                    """
                )
            )

            # Also drop legacy unique indexes enforcing global uniqueness on tipo_servicio.
            legacy_unique_indexes = conn.execute(
                text(
                    """
                    SELECT i.relname AS index_name
                    FROM pg_class t
                    JOIN pg_index ix ON t.oid = ix.indrelid
                    JOIN pg_class i ON i.oid = ix.indexrelid
                    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
                    LEFT JOIN pg_constraint c ON c.conindid = i.oid
                    WHERE t.relname = 'tarifas'
                      AND ix.indisunique = true
                      AND c.oid IS NULL
                    GROUP BY i.relname, ix.indkey
                    HAVING COUNT(*) = 1 AND MAX(a.attname) = 'tipo_servicio';
                    """
                )
            ).fetchall()

            for row in legacy_unique_indexes:
                conn.execute(text(f'DROP INDEX IF EXISTS "{row.index_name}"'))

            # Ensure per-tenant uniqueness for service type.
            conn.execute(
                text(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_tarifas_tenant_tipo_servicio
                    ON tarifas (tenant_id, tipo_servicio);
                    """
                )
            )
            tx.commit()
            print("Migration update_tarifas_unique_per_tenant completed.")
        except Exception:
            tx.rollback()
            raise


if __name__ == "__main__":
    run_migration()

