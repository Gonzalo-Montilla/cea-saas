"""
Script para crear usuario administrador inicial
"""
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.usuario import Usuario, RolUsuario

def create_admin():
    """Crear usuario administrador"""
    db = SessionLocal()
    
    try:
        # Verificar si ya existe
        existing_admin = db.query(Usuario).filter(Usuario.email == "admin@siaec.com").first()
        
        if existing_admin:
            print("⚠️  Usuario admin ya existe")
            print(f"   Email: {existing_admin.email}")
            return
        
        # Crear admin
        admin = Usuario(
            email="admin@siaec.com",
            password_hash=get_password_hash("admin123"),
            nombre_completo="Administrador SIAEC",
            cedula="1000000000",
            telefono="3000000000",
            rol=RolUsuario.ADMIN,
            is_active=True,
            is_verified=True
        )
        
        db.add(admin)
        db.commit()
        db.refresh(admin)
        
        print("\n✅ Usuario administrador creado exitosamente!")
        print(f"\n   Email: {admin.email}")
        print(f"   Password: admin123")
        print(f"   Rol: {admin.rol}")
        print("\n⚠️  IMPORTANTE: Cambia esta contraseña en producción!\n")
        
    except Exception as e:
        print(f"\n❌ Error al crear admin: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    create_admin()
