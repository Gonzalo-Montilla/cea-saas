import smtplib
import ipaddress
from datetime import datetime
from email.message import EmailMessage
from html import escape
from typing import Optional
from urllib.parse import urlparse

from app.core.config import settings


def _is_safe_logo_src(value: Optional[str]) -> bool:
    raw = (value or "").strip()
    if not raw:
        return False
    if raw.startswith("data:image/"):
        return True
    if raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        host = (parsed.hostname or "").strip().lower()
        if host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
            return False
        try:
            ip = ipaddress.ip_address(host)
            if ip.is_private or ip.is_loopback or ip.is_link_local:
                return False
        except ValueError:
            # Non-IP hostname; allow it.
            pass
        return True
    return False


def _brand_initials(brand_name: str) -> str:
    parts = [chunk for chunk in (brand_name or "").strip().split() if chunk]
    if not parts:
        return "S"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[1][0]).upper()


def _text_to_html_block(text: str) -> str:
    safe = escape(text or "")
    safe = safe.replace("\r\n", "\n").replace("\r", "\n")
    # Keep original line breaks and simple text bullets readable.
    return safe.replace("\n", "<br>")


def _build_email_html(
    *,
    subject: str,
    body: str,
    brand_name: str,
    logo_url: Optional[str] = None,
    preview_text: Optional[str] = None,
    accent_color: Optional[str] = None,
    html_body: Optional[str] = None,
) -> str:
    theme = (accent_color or "#1d4ed8").strip() or "#1d4ed8"
    safe_brand = escape(brand_name or settings.BRAND_SHORT_NAME or settings.SMTP_FROM_NAME or "SIAEC")
    safe_subject = escape(subject or "")
    safe_preview = escape((preview_text or "").strip()) or f"Notificacion de {safe_brand}"
    logo_src = (logo_url or "").strip()
    initials = escape(_brand_initials(brand_name))
    fallback_logo_html = (
        '<div aria-hidden="true" style="width:56px;height:56px;border-radius:999px;'
        'display:flex;align-items:center;justify-content:center;margin:0 auto 10px auto;'
        'font-size:20px;font-weight:800;color:#ffffff;'
        'background:linear-gradient(135deg,rgba(255,255,255,0.34),rgba(255,255,255,0.18));'
        'border:1px solid rgba(255,255,255,0.45);">'
        f"{initials}</div>"
    )
    logo_html = fallback_logo_html
    if _is_safe_logo_src(logo_src):
        logo_html = (
            '<img src="{src}" alt="{alt}" width="120" '
            'style="display:block;max-width:120px;max-height:56px;height:auto;margin:0 auto 10px auto;">'
        ).format(src=escape(logo_src), alt=safe_brand)
    content_html = (html_body or "").strip() or _text_to_html_block(body)
    year = datetime.utcnow().year
    return f"""\
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="x-apple-disable-message-reformatting">
    <title>{safe_subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef2ff;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{safe_preview}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef2ff;padding:26px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#ffffff;border:1px solid #dbeafe;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.12);">
            <tr>
              <td align="center" style="padding:22px 24px;background:linear-gradient(120deg,{theme} 0%,#0f172a 100%);color:#ffffff;">
                {logo_html}
                <div style="font-size:13px;opacity:0.95;letter-spacing:0.02em;">{safe_brand}</div>
                <div style="font-size:22px;font-weight:700;line-height:1.35;margin-top:7px;">{safe_subject}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 24px 16px 24px;">
                <div style="font-size:15px;line-height:1.7;color:#111827;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:18px 16px;">
                  {content_html}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 22px 24px;">
                <div style="font-size:12px;line-height:1.6;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px;text-align:center;">
                  Este es un correo automatico de {safe_brand}.<br>
                  (c) {year} {safe_brand}. Todos los derechos reservados.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def send_email(
    to_email: str,
    subject: str,
    body: str,
    attachment: Optional[tuple[str, bytes, str]] = None,
    *,
    brand_name: Optional[str] = None,
    logo_url: Optional[str] = None,
    preview_text: Optional[str] = None,
    accent_color: Optional[str] = None,
    html_body: Optional[str] = None,
) -> bool:
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_USER}>"
    msg["To"] = to_email
    msg.set_content(body)
    email_brand = (brand_name or settings.SMTP_FROM_NAME or settings.BRAND_SHORT_NAME or "SIAEC").strip()
    msg.add_alternative(
        _build_email_html(
            subject=subject,
            body=body,
            brand_name=email_brand,
            logo_url=logo_url,
            preview_text=preview_text,
            accent_color=accent_color,
            html_body=html_body,
        ),
        subtype="html",
    )

    if attachment:
        filename, content, mime_type = attachment
        maintype, subtype = mime_type.split("/", 1)
        msg.add_attachment(content, maintype=maintype, subtype=subtype, filename=filename)

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as smtp:
            smtp.ehlo()
            if settings.SMTP_USE_TLS:
                smtp.starttls()
                smtp.ehlo()
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except Exception:
        return False
