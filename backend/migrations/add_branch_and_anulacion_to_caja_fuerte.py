from pathlib import Path
import sys

from sqlalchemy import text

if __package__ in (None, ""):
    backend_root = Path(__file__).resolve().parent.parent
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))

from app.core.database import engine


def run_migration():
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE caja_fuerte ADD COLUMN IF NOT EXISTS branch_id INTEGER;"))
        conn.execute(text("ALTER TABLE caja_fuerte DROP CONSTRAINT IF EXISTS caja_fuerte_branch_id_fkey;"))
        conn.execute(
            text(
                """
                ALTER TABLE caja_fuerte
                ADD CONSTRAINT caja_fuerte_branch_id_fkey
                FOREIGN KEY (branch_id) REFERENCES tenant_branches(id);
                """
            )
        )
        conn.execute(text("DROP INDEX IF EXISTS uq_caja_fuerte_tenant;"))
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_caja_fuerte_tenant_branch
                ON caja_fuerte (tenant_id, COALESCE(branch_id, -1));
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_caja_fuerte_branch_id ON caja_fuerte (branch_id);"))

        conn.execute(text("ALTER TABLE movimientos_caja_fuerte ADD COLUMN IF NOT EXISTS branch_id INTEGER;"))
        conn.execute(text("ALTER TABLE movimientos_caja_fuerte DROP CONSTRAINT IF EXISTS movimientos_caja_fuerte_branch_id_fkey;"))
        conn.execute(
            text(
                """
                ALTER TABLE movimientos_caja_fuerte
                ADD CONSTRAINT movimientos_caja_fuerte_branch_id_fkey
                FOREIGN KEY (branch_id) REFERENCES tenant_branches(id);
                """
            )
        )
        conn.execute(
            text(
                """
                UPDATE movimientos_caja_fuerte m
                SET branch_id = cf.branch_id
                FROM caja_fuerte cf
                WHERE m.caja_fuerte_id = cf.id
                  AND m.branch_id IS NULL;
                """
            )
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_movimientos_caja_fuerte_branch_id ON movimientos_caja_fuerte (branch_id);")
        )

        conn.execute(text("ALTER TABLE movimientos_caja_fuerte ADD COLUMN IF NOT EXISTS estado VARCHAR(20);"))
        conn.execute(
            text("UPDATE movimientos_caja_fuerte SET estado = 'ACTIVO' WHERE estado IS NULL OR estado = '';")
        )
        conn.execute(
            text("ALTER TABLE movimientos_caja_fuerte ALTER COLUMN estado SET DEFAULT 'ACTIVO';")
        )
        conn.execute(
            text("ALTER TABLE movimientos_caja_fuerte ALTER COLUMN estado SET NOT NULL;")
        )
        conn.execute(text("ALTER TABLE movimientos_caja_fuerte ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;"))
        conn.execute(text("ALTER TABLE movimientos_caja_fuerte ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMP;"))
        conn.execute(text("ALTER TABLE movimientos_caja_fuerte ADD COLUMN IF NOT EXISTS anulado_por_id INTEGER;"))
        conn.execute(text("ALTER TABLE movimientos_caja_fuerte DROP CONSTRAINT IF EXISTS movimientos_caja_fuerte_anulado_por_id_fkey;"))
        conn.execute(
            text(
                """
                ALTER TABLE movimientos_caja_fuerte
                ADD CONSTRAINT movimientos_caja_fuerte_anulado_por_id_fkey
                FOREIGN KEY (anulado_por_id) REFERENCES usuarios(id);
                """
            )
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_movimientos_caja_fuerte_estado ON movimientos_caja_fuerte (estado);")
        )

        conn.commit()


if __name__ == "__main__":
    run_migration()
    print("Migration add_branch_and_anulacion_to_caja_fuerte completed.")
