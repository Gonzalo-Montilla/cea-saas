from app.models.usuario import Usuario, RolUsuario
from app.models.estudiante import Estudiante, CategoriaLicencia, EstadoEstudiante, OrigenCliente, TipoServicio
from app.models.pago import Pago, MetodoPago, EstadoPago
from app.models.compromiso_pago import CompromisoPago, CuotaPago, FrecuenciaPago, EstadoCuota
from app.models.clase import (
    Clase,
    Instructor,
    Vehiculo,
    Evaluacion,
    MantenimientoVehiculo,
    RepuestoMantenimiento,
    CombustibleVehiculo,
    AdjuntoMantenimientoVehiculo,
    AdjuntoCombustibleVehiculo,
    VehiculoConsumoUmbral
)
from app.models.tarifa import Tarifa
from app.models.caja import Caja, MovimientoCaja, EstadoCaja, TipoMovimiento, ConceptoMovimientoCaja
from app.models.tenant import Tenant, TenantUser, PlanTenant
from app.models.tenant_service_rule import TenantServiceRule

__all__ = [
    "Usuario", "RolUsuario",
    "Estudiante", "CategoriaLicencia", "EstadoEstudiante", "OrigenCliente", "TipoServicio",
    "Pago", "MetodoPago", "EstadoPago",
    "CompromisoPago", "CuotaPago", "FrecuenciaPago", "EstadoCuota",
    "Clase", "Instructor", "Vehiculo", "Evaluacion", "MantenimientoVehiculo", "RepuestoMantenimiento", "CombustibleVehiculo",
    "AdjuntoMantenimientoVehiculo", "AdjuntoCombustibleVehiculo", "VehiculoConsumoUmbral",
    "Tarifa",
    "TenantServiceRule",
    "Caja", "MovimientoCaja", "EstadoCaja", "TipoMovimiento", "ConceptoMovimientoCaja",
    "Tenant", "TenantUser", "PlanTenant",
]
