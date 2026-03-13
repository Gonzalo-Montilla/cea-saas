"""
Script para crear todas las tablas en la base de datos
"""
from app.core.database import engine, Base
from app.models import usuario, estudiante, pago, compromiso_pago, clase, tenant

def create_tables():
    """Crear todas las tablas en la base de datos"""
    print("Creando tablas en la base de datos...")
    
    try:
        # Importar todos los modelos para que SQLAlchemy los registre
        Base.metadata.create_all(bind=engine)
        
        print("\n✅ Tablas creadas exitosamente!")
        print("\nTablas disponibles:")
        for table in Base.metadata.sorted_tables:
            print(f"  - {table.name}")
            
    except Exception as e:
        print(f"\n❌ Error al crear tablas: {e}")
        raise

if __name__ == "__main__":
    create_tables()
