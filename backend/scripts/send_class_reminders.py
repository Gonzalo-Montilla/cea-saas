from app.core.clase_notificaciones import procesar_recordatorios_clases
from app.core.database import SessionLocal


def main():
    db = SessionLocal()
    try:
        result = procesar_recordatorios_clases(db=db, window_minutes=10)
        print(
            "OK: recordatorios procesados | "
            f"24h evaluadas={result['evaluadas_24h']} enviadas={result['enviadas_24h']} | "
            f"2h evaluadas={result['evaluadas_2h']} enviadas={result['enviadas_2h']}"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
