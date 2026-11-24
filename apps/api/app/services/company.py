"""The workshop's own details printed on estimates and invoices.

Fields left empty in Configurazione > Dati azienda fall back to Nakama Car's
billing details, so the documents never go out without the workshop's data.
"""
from pathlib import Path

LOGO_PATH = Path(__file__).resolve().parent.parent / "assets" / "nakama-logo.png"

DEFAULT_COMPANY = {
    "company_name": "NAKAMA CAR SRLS",
    "address": "Via A. Manzoni 58",
    "postal_code": "20900",
    "city": "Monza",
    "province": "MB",
    "vat_number": "14361530968",
    "tax_code": None,
    "sdi": "T9K4ZHO",
    "pec": None,
    "phone": None,
    "email": None,
}


def company_profile(settings) -> dict:
    """Name, address, tax and contact details, from the settings or the defaults."""
    profile = {}
    for field, default in DEFAULT_COMPANY.items():
        value = getattr(settings, field, None) if settings is not None else None
        profile[field] = (value.strip() if isinstance(value, str) else value) or default
    return profile


def company_lines(profile: dict) -> list[str]:
    """The details under the company name, one line each."""
    lines = []
    if profile.get("address"):
        lines.append(profile["address"])
    place = " ".join(filter(None, [
        profile.get("postal_code"),
        profile.get("city"),
        f"({profile['province']})" if profile.get("province") else None,
    ]))
    if place:
        lines.append(place)
    fiscal = " · ".join(filter(None, [
        f"P.IVA {profile['vat_number']}" if profile.get("vat_number") else None,
        f"C.F. {profile['tax_code']}" if profile.get("tax_code") else None,
        f"Codice SDI {profile['sdi']}" if profile.get("sdi") else None,
    ]))
    if fiscal:
        lines.append(fiscal)
    contacts = " · ".join(filter(None, [profile.get("phone"), profile.get("email"), profile.get("pec")]))
    if contacts:
        lines.append(contacts)
    return lines
