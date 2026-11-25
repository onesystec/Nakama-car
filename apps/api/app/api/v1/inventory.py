"""Magazzino: articles in stock for Meccanica and Carrozzeria, with every carico / scarico.

The quantity of an article only changes through movements, so the history always explains it.
Workshop staff see and move the stock of their own area; the office sees both and manages articles.
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.models.garage import RepairCase, RepairCaseStatus, Vehicle
from app.models.inventory import InventoryItem, InventoryMovement
from app.security.context import AuthContext, require_any_permission
from app.services import staff
from app.services.audit import record_audit
from app.services.pricing import money

router = APIRouter(tags=["inventory"])

Area = Literal["MECHANICAL", "BODY"]
CATEGORIES = ("RICAMBIO", "MATERIALE", "VERNICE", "CONSUMABILE", "LUBRIFICANTE", "ATTREZZO", "ALTRO")
UNITS = ("PZ", "L", "KG", "M", "CF", "KIT")
OFFICE = ("invoice.create", "estimate.create")
CAN_USE = require_any_permission("work_order.read", *OFFICE)
CLOSED = {RepairCaseStatus.DELIVERED, RepairCaseStatus.INVOICED}
ZERO = Decimal("0")
Day = date  # a field below is called "date"


def _office(auth: AuthContext) -> bool:
    return bool(auth.permissions.intersection(OFFICE))


def _scope(db: Session, auth: AuthContext) -> str | None:
    """The area a worker is limited to; None = both (office and admin)."""
    if _office(auth):
        return None
    return staff.user_area(db, auth.user_id, auth.tenant_id)


def _clean(value: str | None) -> str | None:
    return (value or "").strip() or None


def _num(value: Decimal | None) -> str:
    value = Decimal(value or 0)
    return format(value.normalize() if value % 1 else value.quantize(Decimal("1")), "f")


class ItemIn(BaseModel):
    area: Area
    category: str = "RICAMBIO"
    name: str = Field(min_length=1, max_length=200)
    code: str | None = Field(default=None, max_length=80)
    brand: str | None = Field(default=None, max_length=80)
    unit: str = "PZ"
    min_quantity: Decimal = Field(default=ZERO, ge=0, max_digits=12, decimal_places=2)
    unit_cost: Decimal = Field(default=ZERO, ge=0, max_digits=12, decimal_places=2)
    location: str | None = Field(default=None, max_length=80)
    supplier: str | None = Field(default=None, max_length=160)
    notes: str | None = None
    # Only when creating: what is already on the shelf.
    quantity: Decimal = Field(default=ZERO, ge=0, max_digits=12, decimal_places=2)

    @field_validator("name")
    @classmethod
    def named(cls, value: str):
        if not value.strip():
            raise ValueError("Scrivi il nome dell'articolo")
        return value.strip()

    @field_validator("code", "brand", "location", "supplier", "notes")
    @classmethod
    def optional_text(cls, value: str | None):
        return _clean(value)

    @field_validator("category")
    @classmethod
    def known_category(cls, value: str):
        if value not in CATEGORIES:
            raise ValueError("Categoria non valida")
        return value

    @field_validator("unit")
    @classmethod
    def known_unit(cls, value: str):
        if value not in UNITS:
            raise ValueError("Unità non valida")
        return value


class MovementIn(BaseModel):
    kind: Literal["IN", "OUT", "ADJUST"]
    # IN / OUT: how many; ADJUST: how many were counted on the shelf.
    quantity: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    unit_cost: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    date: Day | None = None
    repair_case_id: UUID | None = None
    supplier: str | None = Field(default=None, max_length=160)
    note: str | None = Field(default=None, max_length=255)

    @field_validator("supplier", "note")
    @classmethod
    def optional_text(cls, value: str | None):
        return _clean(value)


def _item_out(item: InventoryItem) -> dict:
    quantity = Decimal(item.quantity or 0)
    minimum = Decimal(item.min_quantity or 0)
    return {
        "id": str(item.id), "area": item.area, "category": item.category, "name": item.name, "code": item.code,
        "brand": item.brand, "unit": item.unit, "quantity": _num(quantity), "min_quantity": _num(minimum),
        "unit_cost": str(money(Decimal(item.unit_cost or 0))), "value": str(money(max(quantity, ZERO) * Decimal(item.unit_cost or 0))),
        "location": item.location, "supplier": item.supplier, "notes": item.notes,
        "low": quantity <= minimum and (minimum > 0 or quantity <= 0),
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def _movement_out(movement: InventoryMovement, item: InventoryItem) -> dict:
    cost = movement.unit_cost if movement.unit_cost is not None else item.unit_cost
    return {
        "id": str(movement.id), "item_id": str(item.id), "item_name": item.name, "item_code": item.code, "unit": item.unit,
        "area": item.area, "kind": movement.kind, "quantity": _num(movement.quantity),
        "unit_cost": str(money(Decimal(cost or 0))), "value": str(money(abs(Decimal(movement.quantity)) * Decimal(cost or 0))),
        "date": movement.movement_date.isoformat(), "repair_case_id": str(movement.repair_case_id) if movement.repair_case_id else None,
        "case_number": movement.case_number, "plate": movement.plate, "supplier": movement.supplier, "note": movement.note,
        "created_at": movement.created_at.isoformat() if movement.created_at else None,
    }


def _own_item(db: Session, auth: AuthContext, item_id: UUID) -> InventoryItem:
    item = db.get(InventoryItem, item_id)
    if item is None or item.tenant_id != auth.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Articolo non trovato.")
    area = _scope(db, auth)
    if area and item.area != area:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Questo articolo è dell'altro reparto.")
    return item


def _require_office(auth: AuthContext) -> None:
    if not _office(auth):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo l'ufficio può farlo.")


@router.get("/inventory")
def list_inventory(db: Session = Depends(get_db), auth: AuthContext = Depends(CAN_USE)):
    area = _scope(db, auth)
    query = select(InventoryItem).where(InventoryItem.tenant_id == auth.tenant_id)
    if area:
        query = query.where(InventoryItem.area == area)
    items = [_item_out(item) for item in db.scalars(query.order_by(InventoryItem.name, InventoryItem.id)).all()]
    totals = {}
    for code in ("MECHANICAL", "BODY"):
        rows = [row for row in items if row["area"] == code]
        totals[code] = {
            "items": len(rows), "low": sum(1 for row in rows if row["low"]),
            "value": str(money(sum((Decimal(row["value"]) for row in rows), ZERO))),
        }
    return {"area": area, "can_manage": _office(auth), "items": items, "totals": totals,
            "categories": list(CATEGORIES), "units": list(UNITS)}


@router.post("/inventory/items", status_code=status.HTTP_201_CREATED)
def create_item(payload: ItemIn, db: Session = Depends(get_db), auth: AuthContext = Depends(CAN_USE)):
    area = _scope(db, auth)
    if area and payload.area != area:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Puoi aggiungere solo articoli del tuo reparto.")
    data = payload.model_dump(exclude={"quantity"})
    item = InventoryItem(tenant_id=auth.tenant_id, quantity=ZERO, **data)
    db.add(item)
    db.flush()
    if payload.quantity > 0:
        item.quantity = payload.quantity
        db.add(InventoryMovement(
            tenant_id=auth.tenant_id, item_id=item.id, kind="IN", quantity=payload.quantity, unit_cost=payload.unit_cost,
            movement_date=date.today(), supplier=payload.supplier, note="Giacenza iniziale", created_by=auth.user_id,
        ))
    record_audit(db, tenant_id=auth.tenant_id, user_id=auth.user_id, entity_type="inventory_item", entity_id=item.id,
                 action="created", new_value=_item_out(item))
    db.commit()
    db.refresh(item)
    return _item_out(item)


@router.put("/inventory/items/{item_id}")
def update_item(item_id: UUID, payload: ItemIn, db: Session = Depends(get_db), auth: AuthContext = Depends(CAN_USE)):
    item = _own_item(db, auth, item_id)
    area = _scope(db, auth)
    if area and payload.area != area:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Puoi spostare l'articolo solo nel tuo reparto.")
    old = _item_out(item)
    # The quantity is changed only through movements (carico, scarico, rettifica).
    for key, value in payload.model_dump(exclude={"quantity"}).items():
        setattr(item, key, value)
    item.updated_at = datetime.now(timezone.utc)
    record_audit(db, tenant_id=auth.tenant_id, user_id=auth.user_id, entity_type="inventory_item", entity_id=item.id,
                 action="updated", old_value=old, new_value=_item_out(item))
    db.commit()
    db.refresh(item)
    return _item_out(item)


@router.delete("/inventory/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: UUID, db: Session = Depends(get_db), auth: AuthContext = Depends(CAN_USE)):
    _require_office(auth)
    item = _own_item(db, auth, item_id)
    record_audit(db, tenant_id=auth.tenant_id, user_id=auth.user_id, entity_type="inventory_item", entity_id=item.id,
                 action="deleted", old_value=_item_out(item))
    for movement in db.scalars(select(InventoryMovement).where(InventoryMovement.item_id == item.id)).all():
        db.delete(movement)
    db.delete(item)
    db.commit()


@router.get("/inventory/cases")
def open_cases(db: Session = Depends(get_db), auth: AuthContext = Depends(CAN_USE)):
    """Pratiche still in the workshop, to say which job a scarico went to."""
    area = _scope(db, auth)
    query = (
        select(RepairCase, Vehicle)
        .join(Vehicle, Vehicle.id == RepairCase.vehicle_id)
        .where(RepairCase.tenant_id == auth.tenant_id, RepairCase.status.not_in(CLOSED))
    )
    if area == "MECHANICAL":
        query = query.where(RepairCase.work_type == "MECHANICAL")
    elif area == "BODY":
        query = query.where(RepairCase.work_type != "MECHANICAL")
    rows = db.execute(query.order_by(RepairCase.created_at.desc()).limit(300)).all()
    return [{
        "id": str(case.id), "case_number": case.case_number, "plate": vehicle.license_plate,
        "vehicle": " ".join(part for part in (vehicle.make, vehicle.model) if part) or None,
        "area": "MECHANICAL" if case.work_type == "MECHANICAL" else "BODY",
    } for case, vehicle in rows]


@router.get("/inventory/movements")
def list_movements(
    item_id: UUID | None = None,
    repair_case_id: UUID | None = None,
    date_from: date | None = Query(default=None, alias="from"),
    date_to: date | None = Query(default=None, alias="to"),
    limit: int = Query(default=300, ge=1, le=2000),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(CAN_USE),
):
    area = _scope(db, auth)
    query = (
        select(InventoryMovement, InventoryItem)
        .join(InventoryItem, InventoryItem.id == InventoryMovement.item_id)
        .where(InventoryMovement.tenant_id == auth.tenant_id, InventoryItem.tenant_id == auth.tenant_id)
    )
    if area:
        query = query.where(InventoryItem.area == area)
    if item_id:
        query = query.where(InventoryMovement.item_id == item_id)
    if repair_case_id:
        query = query.where(InventoryMovement.repair_case_id == repair_case_id)
    if date_from:
        query = query.where(InventoryMovement.movement_date >= date_from)
    if date_to:
        query = query.where(InventoryMovement.movement_date <= date_to)
    rows = db.execute(query.order_by(
        InventoryMovement.movement_date.desc(), InventoryMovement.created_at.desc(), InventoryMovement.id.desc()
    ).limit(limit)).all()
    return [_movement_out(movement, item) for movement, item in rows]


@router.post("/inventory/items/{item_id}/movements", status_code=status.HTTP_201_CREATED)
def add_movement(item_id: UUID, payload: MovementIn, db: Session = Depends(get_db), auth: AuthContext = Depends(CAN_USE)):
    item = _own_item(db, auth, item_id)
    current = Decimal(item.quantity or 0)
    if payload.kind in ("IN", "OUT") and payload.quantity <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Indica una quantità maggiore di zero.")
    if payload.kind == "IN":
        delta = payload.quantity
        if payload.unit_cost is not None and payload.unit_cost > 0:
            # Average cost of what is on the shelf, so the value of the stock stays true.
            on_shelf = max(current, ZERO)
            total = on_shelf + delta
            item.unit_cost = money((on_shelf * Decimal(item.unit_cost or 0) + delta * payload.unit_cost) / total) if on_shelf > 0 else payload.unit_cost
        if payload.supplier and not item.supplier:
            item.supplier = payload.supplier
    elif payload.kind == "OUT":
        if payload.quantity > current:
            raise HTTPException(status.HTTP_409_CONFLICT, f"In magazzino ci sono solo {_num(current)} {item.unit.lower()}.")
        delta = -payload.quantity
    else:
        delta = payload.quantity - current
        if delta == 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "La quantità contata è uguale a quella in magazzino.")

    case_number = plate = None
    if payload.repair_case_id:
        found = db.execute(
            select(RepairCase, Vehicle).join(Vehicle, Vehicle.id == RepairCase.vehicle_id)
            .where(RepairCase.id == payload.repair_case_id, RepairCase.tenant_id == auth.tenant_id)
        ).first()
        if found is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Pratica non trovata.")
        case_number, plate = found[0].case_number, found[1].license_plate

    movement = InventoryMovement(
        tenant_id=auth.tenant_id, item_id=item.id, kind=payload.kind, quantity=delta,
        unit_cost=payload.unit_cost if payload.kind == "IN" and payload.unit_cost else item.unit_cost,
        movement_date=payload.date or date.today(), repair_case_id=payload.repair_case_id if case_number else None,
        case_number=case_number, plate=plate, supplier=payload.supplier if payload.kind == "IN" else None,
        note=payload.note, created_by=auth.user_id,
    )
    item.quantity = current + delta
    item.updated_at = datetime.now(timezone.utc)
    db.add(movement)
    db.flush()
    record_audit(db, tenant_id=auth.tenant_id, user_id=auth.user_id, entity_type="inventory_item", entity_id=item.id,
                 action=f"stock_{payload.kind.lower()}", new_value=_movement_out(movement, item))
    db.commit()
    db.refresh(item)
    return {"item": _item_out(item), "movement": _movement_out(movement, item)}


@router.delete("/inventory/movements/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
def undo_movement(movement_id: UUID, db: Session = Depends(get_db), auth: AuthContext = Depends(CAN_USE)):
    """Cancel a movement recorded by mistake: the stock goes back as it was."""
    _require_office(auth)
    movement = db.get(InventoryMovement, movement_id)
    if movement is None or movement.tenant_id != auth.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Movimento non trovato.")
    item = _own_item(db, auth, movement.item_id)
    record_audit(db, tenant_id=auth.tenant_id, user_id=auth.user_id, entity_type="inventory_item", entity_id=item.id,
                 action="stock_undo", old_value=_movement_out(movement, item))
    item.quantity = Decimal(item.quantity or 0) - Decimal(movement.quantity)
    item.updated_at = datetime.now(timezone.utc)
    db.delete(movement)
    db.commit()
