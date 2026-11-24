"""Scheda tecnica: maintenance data of a vehicle's model and engine, reached by plate.

The sheet belongs to make + model + engine, not to one plate: the next vehicle of the same
model already shows what the workshop wrote. Unknown values stay empty (the app shows
"non disponibile"); the API never fills a value it was not given.
"""
import base64
import binascii
import re
import unicodedata
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.v1.staff import find_vehicle
from app.db.deps import get_db
from app.models.garage import Vehicle
from app.api.v1.vehicles import month_start
from app.core.config import get_settings
from app.models.identity import AuditLog, User
from app.models.technical import TechnicalSheet
from app.security.context import AuthContext, require_any_permission
from app.services import libretto
from app.services.audit import record_audit

router = APIRouter(prefix="/technical-sheets", tags=["technical-sheets"])

# Fields of the sheet, in the order the app shows them. Free text: the workshop writes the
# value as it reads it in the manual or on the parts invoice (e.g. "5W-30 ACEA C3", "4,5 L").
FIELDS = (
    "oil_spec", "oil_capacity",
    "oil_filter", "air_filter", "fuel_filter", "cabin_filter",
    "service_interval", "timing_belt",
    "coolant", "brake_fluid", "gearbox_oil",
    "tyre_size", "tyre_pressure_front", "tyre_pressure_rear",
    "brake_pads_front", "brake_pads_rear",
    "notes",
)


class SheetData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    oil_spec: str | None = Field(default=None, max_length=120)
    oil_capacity: str | None = Field(default=None, max_length=60)
    oil_filter: str | None = Field(default=None, max_length=120)
    air_filter: str | None = Field(default=None, max_length=120)
    fuel_filter: str | None = Field(default=None, max_length=120)
    cabin_filter: str | None = Field(default=None, max_length=120)
    service_interval: str | None = Field(default=None, max_length=120)
    timing_belt: str | None = Field(default=None, max_length=120)
    coolant: str | None = Field(default=None, max_length=120)
    brake_fluid: str | None = Field(default=None, max_length=120)
    gearbox_oil: str | None = Field(default=None, max_length=120)
    tyre_size: str | None = Field(default=None, max_length=60)
    tyre_pressure_front: str | None = Field(default=None, max_length=60)
    tyre_pressure_rear: str | None = Field(default=None, max_length=60)
    brake_pads_front: str | None = Field(default=None, max_length=120)
    brake_pads_rear: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=1000)


class SheetUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vin: str | None = Field(default=None, max_length=32)
    engine_code: str | None = Field(default=None, max_length=40)
    # From a libretto the workshop confirmed: only fill what the vehicle does not have yet.
    make: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    fuel_type: str | None = Field(default=None, max_length=40)
    engine_size: str | None = Field(default=None, max_length=20)
    power_kw: int | None = Field(default=None, ge=1, le=2000)
    data: SheetData = Field(default_factory=SheetData)


class LibrettoPhoto(BaseModel):
    model_config = ConfigDict(extra="forbid")
    image: str = Field(min_length=100, max_length=14_000_000)  # base64, with or without data: prefix


def _norm(text: str | None) -> str:
    plain = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9.]+", " ", plain.lower()).strip()


def model_key(vehicle: Vehicle) -> str | None:
    """make|model|engine. The engine is size + fuel + power (what the plate lookup fills for
    every vehicle), or the engine code when those are unknown. Adding the engine code later must
    not move the vehicle to another sheet. Without make and model there is nothing to share."""
    make, model = _norm(vehicle.make), _norm(vehicle.model)
    if not make or not model:
        return None
    return f"{make}|{model}|{_engine(vehicle, normalized=True)}"[:255]


def _engine(vehicle: Vehicle, *, normalized: bool) -> str:
    clean = _norm if normalized else (lambda value: (value or "").strip())
    power = (f"{vehicle.power_kw}kw" if normalized else f"{vehicle.power_kw} kW") if vehicle.power_kw else ""
    described = " ".join(filter(None, [clean(vehicle.engine_size), clean(vehicle.fuel_type), power]))
    return described or clean(vehicle.engine_code)


def model_label(vehicle: Vehicle) -> str:
    engine = _engine(vehicle, normalized=False)
    return " ".join(filter(None, [vehicle.make, vehicle.model, f"· {engine}" if engine else None]))[:255]


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def sheet_payload(db: Session, vehicle: Vehicle, sheet: TechnicalSheet | None) -> dict:
    updated_by = db.get(User, sheet.updated_by) if sheet and sheet.updated_by else None
    updated_at = None
    if sheet and sheet.updated_at:
        stamp = sheet.updated_at if sheet.updated_at.tzinfo else sheet.updated_at.replace(tzinfo=timezone.utc)
        updated_at = stamp.isoformat()
    return {
        "vehicle": {
            "id": str(vehicle.id), "license_plate": vehicle.license_plate, "make": vehicle.make, "model": vehicle.model,
            "version": vehicle.version, "vin": vehicle.vin, "engine_code": vehicle.engine_code,
            "fuel_type": vehicle.fuel_type, "engine_size": vehicle.engine_size, "power_kw": vehicle.power_kw,
        },
        "model_known": model_key(vehicle) is not None,
        "model_label": model_label(vehicle),
        "fields": list(FIELDS),
        "data": {field: (sheet.data or {}).get(field) if sheet else None for field in FIELDS},
        "source": sheet.source if sheet else None,
        "updated_at": updated_at,
        "updated_by": (f"{updated_by.first_name} {updated_by.last_name}".strip() or updated_by.email) if updated_by else None,
    }


def _vehicle(db: Session, auth: AuthContext, plate: str) -> Vehicle:
    vehicle = find_vehicle(db, auth.tenant_id, plate)
    if vehicle is None:
        raise HTTPException(status_code=404, detail="Veicolo non registrato: registra prima la targa.")
    return vehicle


def _sheet(db: Session, tenant_id, key: str | None) -> TechnicalSheet | None:
    if key is None:
        return None
    return db.scalar(select(TechnicalSheet).where(TechnicalSheet.tenant_id == tenant_id, TechnicalSheet.model_key == key))


@router.get("/vehicle/{license_plate}")
def get_technical_sheet(
    license_plate: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_any_permission("vehicle.read", "work_order.read")),
):
    vehicle = _vehicle(db, auth, license_plate)
    return sheet_payload(db, vehicle, _sheet(db, auth.tenant_id, model_key(vehicle)))


@router.put("/vehicle/{license_plate}")
def save_technical_sheet(
    license_plate: str,
    payload: SheetUpdate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_any_permission("vehicle.write", "work_order.update_status")),
):
    """Telaio and engine code go on the vehicle; the rest on the sheet of its model + engine."""
    vehicle = _vehicle(db, auth, license_plate)
    changes = {}
    for field in ("vin", "engine_code"):
        value = _clean(getattr(payload, field))
        if field == "vin" and value:
            value = value.upper().replace(" ", "")
        if value != getattr(vehicle, field):
            changes[field] = {"old": getattr(vehicle, field), "new": value}
            setattr(vehicle, field, value)
    for field in ("make", "model", "fuel_type", "engine_size", "power_kw"):
        value = getattr(payload, field)
        value = _clean(value) if isinstance(value, str) else value
        if value is not None and getattr(vehicle, field) in (None, ""):
            changes[field] = {"old": getattr(vehicle, field), "new": value}
            setattr(vehicle, field, value)
    if changes:
        record_audit(db, tenant_id=auth.tenant_id, user_id=auth.user_id, entity_type="vehicle", entity_id=vehicle.id,
                     action="technical_data_updated", old_value={k: v["old"] for k, v in changes.items()},
                     new_value={k: v["new"] for k, v in changes.items()})

    key = model_key(vehicle)
    data = {field: _clean(getattr(payload.data, field)) for field in FIELDS}
    sheet = _sheet(db, auth.tenant_id, key)
    if key is None:
        if any(data.values()):
            raise HTTPException(status_code=422, detail="Indica marca e modello del veicolo prima di compilare la scheda tecnica.")
    elif sheet is None:
        if any(data.values()):
            sheet = TechnicalSheet(tenant_id=auth.tenant_id, model_key=key, label=model_label(vehicle),
                                   data=data, source="officina", updated_by=auth.user_id)
            db.add(sheet)
            db.flush()
            record_audit(db, tenant_id=auth.tenant_id, user_id=auth.user_id, entity_type="technical_sheet",
                         entity_id=sheet.id, action="created", new_value=data)
    elif data != {field: (sheet.data or {}).get(field) for field in FIELDS}:
        record_audit(db, tenant_id=auth.tenant_id, user_id=auth.user_id, entity_type="technical_sheet",
                     entity_id=sheet.id, action="updated", old_value=sheet.data, new_value=data)
        sheet.data = data
        sheet.label = model_label(vehicle)
        sheet.source = "officina"
        sheet.updated_by = auth.user_id
    db.commit()
    if sheet is not None:
        db.refresh(sheet)
    return sheet_payload(db, vehicle, sheet)


def libretto_reads_this_month(db: Session, tenant_id) -> int:
    return db.scalar(select(func.count(AuditLog.id)).where(
        AuditLog.tenant_id == tenant_id, AuditLog.action == "libretto_read", AuditLog.created_at >= month_start(),
    )) or 0


@router.get("/libretto/status")
def libretto_status(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_any_permission("vehicle.read", "work_order.read")),
):
    return {"configured": libretto.is_configured(), "used_this_month": libretto_reads_this_month(db, auth.tenant_id),
            "monthly_limit": get_settings().libretto_monthly_limit}


@router.post("/libretto")
def read_libretto_photo(
    payload: LibrettoPhoto,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_any_permission("vehicle.write", "work_order.update_status")),
):
    """Reads the photo of the libretto and returns the values for the workshop to check.
    Nothing is saved here (the photo is not stored either)."""
    if not libretto.is_configured():
        raise HTTPException(status_code=503, detail="Lettura libretto non configurata: manca la chiave API.")
    if libretto_reads_this_month(db, auth.tenant_id) >= get_settings().libretto_monthly_limit:
        raise HTTPException(status_code=429, detail="Limite mensile di letture del libretto raggiunto.")
    data = payload.image.split(",", 1)[1] if payload.image.startswith("data:") else payload.image
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail="Il file non è una foto leggibile: usa JPG o PNG.")
    try:
        jpeg = libretto.prepare_image(raw)
    except libretto.LibrettoError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.user_message)
    try:
        values = libretto.read_libretto(jpeg)
    except libretto.LibrettoError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.user_message)
    finally:
        # Every call to the paid service counts, also the ones that read nothing.
        record_audit(db, tenant_id=auth.tenant_id, user_id=auth.user_id, entity_type="vehicle", entity_id=None,
                     action="libretto_read")
        db.commit()
    return {"values": values}
