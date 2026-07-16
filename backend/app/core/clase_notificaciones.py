from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.email import send_email
from app.models.clase import Clase, EstadoClase, TipoClase
from app.models.tenant import Tenant


def _fmt_fecha(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M")


def _tenant_name(tenant: Optional[Tenant]) -> str:
    if not tenant:
        return "tu escuela"
    return (tenant.display_name or tenant.nombre or "tu escuela").strip()


def _vehiculo_label(clase: Clase) -> str:
    if not clase.vehiculo:
        return "-"
    return f"{clase.vehiculo.placa} - {clase.vehiculo.marca or ''} {clase.vehiculo.modelo or ''}".strip()


def _student_email(clase: Clase) -> str:
    if not clase.estudiante or not clase.estudiante.usuario:
        return ""
    return (clase.estudiante.usuario.email or "").strip().lower()


def _student_name(clase: Clase) -> str:
    if not clase.estudiante or not clase.estudiante.usuario:
        return "Estudiante"
    return (clase.estudiante.usuario.nombre_completo or "Estudiante").strip()


def _instructor_name(clase: Clase) -> str:
    if not clase.instructor or not clase.instructor.usuario:
        return "Por definir"
    return clase.instructor.usuario.nombre_completo


def _tipo_texto(clase: Clase) -> str:
    return "Practica" if clase.tipo == TipoClase.PRACTICA else "Teorica"


def enviar_correo_clase_programada(clase: Clase, tenant: Optional[Tenant]) -> bool:
    to_email = _student_email(clase)
    if not to_email:
        return False
    tenant_name = _tenant_name(tenant)
    subject = f"{tenant_name} te agendo una clase"
    body = (
        f"Hola {_student_name(clase)},\n\n"
        f"{tenant_name} te agendo una clase.\n\n"
        f"- Fecha: {_fmt_fecha(clase.fecha_programada)}\n"
        f"- Tipo: {_tipo_texto(clase)}\n"
        f"- Instructor: {_instructor_name(clase)}\n"
        f"- Vehiculo: {_vehiculo_label(clase)}\n"
        f"- Duracion: {int(clase.duracion_horas or 1)} hora(s)\n\n"
        f"Te esperamos. Puedes ingresar aqui: {settings.APP_URL.rstrip('/')}/login\n\n"
        f"{settings.BRAND_SHORT_NAME}\n"
        f"{settings.BRAND_FULL_NAME}\n"
    )
    return send_email(
        to_email=to_email,
        subject=subject,
        body=body,
        brand_name=tenant_name,
        logo_url=(tenant.logo_url if tenant else None),
    )


def enviar_correo_clase_reprogramada(clase: Clase, tenant: Optional[Tenant], fecha_anterior: Optional[datetime]) -> bool:
    to_email = _student_email(clase)
    if not to_email:
        return False
    tenant_name = _tenant_name(tenant)
    subject = f"{tenant_name} reprogramo tu clase"
    body = (
        f"Hola {_student_name(clase)},\n\n"
        f"{tenant_name} reprogramo tu clase.\n\n"
        f"- Fecha anterior: {_fmt_fecha(fecha_anterior) if fecha_anterior else 'N/A'}\n"
        f"- Nueva fecha: {_fmt_fecha(clase.fecha_programada)}\n"
        f"- Tipo: {_tipo_texto(clase)}\n"
        f"- Instructor: {_instructor_name(clase)}\n"
        f"- Vehiculo: {_vehiculo_label(clase)}\n"
        f"- Duracion: {int(clase.duracion_horas or 1)} hora(s)\n\n"
        f"Te esperamos. Puedes ingresar aqui: {settings.APP_URL.rstrip('/')}/login\n\n"
        f"{settings.BRAND_SHORT_NAME}\n"
        f"{settings.BRAND_FULL_NAME}\n"
    )
    return send_email(
        to_email=to_email,
        subject=subject,
        body=body,
        brand_name=tenant_name,
        logo_url=(tenant.logo_url if tenant else None),
    )


def enviar_correo_recordatorio(clase: Clase, tenant: Optional[Tenant], horas_antes: int) -> bool:
    to_email = _student_email(clase)
    if not to_email:
        return False
    tenant_name = _tenant_name(tenant)
    subject = f"{tenant_name} te recuerda tu clase ({horas_antes}h antes)"
    body = (
        f"Hola {_student_name(clase)},\n\n"
        f"{tenant_name} te recuerda tu clase programada.\n\n"
        f"- Fecha: {_fmt_fecha(clase.fecha_programada)}\n"
        f"- Tipo: {_tipo_texto(clase)}\n"
        f"- Instructor: {_instructor_name(clase)}\n"
        f"- Vehiculo: {_vehiculo_label(clase)}\n"
        f"- Duracion: {int(clase.duracion_horas or 1)} hora(s)\n\n"
        "Por favor llega con anticipacion.\n\n"
        f"{settings.BRAND_SHORT_NAME}\n"
        f"{settings.BRAND_FULL_NAME}\n"
    )
    return send_email(
        to_email=to_email,
        subject=subject,
        body=body,
        brand_name=tenant_name,
        logo_url=(tenant.logo_url if tenant else None),
    )


def procesar_recordatorios_clases(db: Session, window_minutes: int = 10) -> dict:
    now = datetime.utcnow()
    delta = timedelta(minutes=max(1, window_minutes))

    tenants_by_id: dict[int, Tenant] = {}

    def tenant_for_clase(clase: Clase) -> Optional[Tenant]:
        tenant_id = clase.estudiante.tenant_id if clase.estudiante else None
        if not tenant_id:
            return None
        if tenant_id in tenants_by_id:
            return tenants_by_id[tenant_id]
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if tenant:
            tenants_by_id[tenant_id] = tenant
        return tenant

    due_24h_start = now + timedelta(hours=24) - delta
    due_24h_end = now + timedelta(hours=24) + delta
    due_2h_start = now + timedelta(hours=2) - delta
    due_2h_end = now + timedelta(hours=2) + delta

    clases_24h = (
        db.query(Clase)
        .filter(
            Clase.estado == EstadoClase.PROGRAMADA,
            Clase.reminder_24h_sent_at.is_(None),
            Clase.fecha_programada >= due_24h_start,
            Clase.fecha_programada <= due_24h_end,
        )
        .all()
    )
    clases_2h = (
        db.query(Clase)
        .filter(
            Clase.estado == EstadoClase.PROGRAMADA,
            Clase.reminder_2h_sent_at.is_(None),
            Clase.fecha_programada >= due_2h_start,
            Clase.fecha_programada <= due_2h_end,
        )
        .all()
    )

    sent_24h = 0
    sent_2h = 0
    for clase in clases_24h:
        if enviar_correo_recordatorio(clase, tenant_for_clase(clase), horas_antes=24):
            clase.reminder_24h_sent_at = now
            sent_24h += 1

    for clase in clases_2h:
        if enviar_correo_recordatorio(clase, tenant_for_clase(clase), horas_antes=2):
            clase.reminder_2h_sent_at = now
            sent_2h += 1

    db.commit()
    return {
        "evaluadas_24h": len(clases_24h),
        "evaluadas_2h": len(clases_2h),
        "enviadas_24h": sent_24h,
        "enviadas_2h": sent_2h,
    }
