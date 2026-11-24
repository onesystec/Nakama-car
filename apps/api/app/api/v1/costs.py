"""Costi officina: what the workshop spends, split by Meccanica and Carrozzeria.

Parts, hours and other costs come from the lines of the APPROVED estimates (an approved
estimate is locked, so its last change is its approval date). Workshop expenses are
recorded here by the office.
"""
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.models.costs import WorkshopExpense
from app.models.estimating import Estimate, EstimateLine, EstimateLineCategory, EstimateStatus
from app.models.garage import RepairCase, Vehicle
from app.security.context import AuthContext, require_permission
from app.services.audit import record_audit
from app.services.pricing import money

router = APIRouter(tags=["costs"])

Area = Literal["MECHANICAL", "BODY"]
ExpenseArea = Literal["MECHANICAL", "BODY", "GENERAL"]
EXPENSE_CATEGORIES = ("AFFITTO", "UTENZE", "ATTREZZATURA", "PERSONALE", "ASSICURAZIONI", "CARBURANTE", "CONSUMABILI", "FORNITORI", "ALTRO")
ZERO = Decimal("0")

# Labor lines say themselves which department did the work; every other line follows the case.
CATEGORY_AREA = {
    EstimateLineCategory.BODY_LABOR: "BODY",
    EstimateLineCategory.PAINT: "BODY",
    EstimateLineCategory.MECHANICAL_LABOR: "MECHANICAL",
    EstimateLineCategory.ELECTRICAL: "MECHANICAL",
    EstimateLineCategory.DIAGNOSTIC: "MECHANICAL",
}
OTHER_CATEGORIES = {
    EstimateLineCategory.MATERIAL: "MATERIAL",
    EstimateLineCategory.EXTERNAL_SERVICE: "EXTERNAL_SERVICE",
    EstimateLineCategory.DISPOSAL: "DISPOSAL",
    EstimateLineCategory.OTHER: "OTHER",
}


class ExpenseIn(BaseModel):
    date: date
    description: str = Field(min_length=1, max_length=255)
    category: str = "ALTRO"
    area: ExpenseArea = "GENERAL"
    supplier: str | None = Field(default=None, max_length=160)
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    notes: str | None = None

    @field_validator("description")
    @classmethod
    def described(cls, value: str):
        if not value.strip():
            raise ValueError("Scrivi una descrizione")
        return value.strip()

    @field_validator("supplier", "notes")
    @classmethod
    def optional_text(cls, value: str | None):
        return (value or "").strip() or None

    @field_validator("category")
    @classmethod
    def known_category(cls, value: str):
        if value not in EXPENSE_CATEGORIES:
            raise ValueError("Categoria non valida")
        return value


def _expense_out(expense: WorkshopExpense) -> dict:
    return {
        "id": str(expense.id), "date": expense.expense_date.isoformat(), "description": expense.description,
        "category": expense.category, "area": expense.area, "supplier": expense.supplier,
        "amount": str(money(expense.amount)), "notes": expense.notes,
    }


def _case_area(case: RepairCase) -> str:
    return "MECHANICAL" if case.work_type == "MECHANICAL" else "BODY"


def _when(value: datetime) -> date:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).date()


@router.get("/costs")
def cost_report(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission("invoice.create")),
):
    if date_to < date_from:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "La data finale è prima di quella iniziale.")
    start = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=timezone.utc)

    rows = db.execute(
        select(EstimateLine, Estimate, RepairCase, Vehicle)
        .join(Estimate, Estimate.id == EstimateLine.estimate_id)
        .join(RepairCase, RepairCase.id == Estimate.repair_case_id)
        .join(Vehicle, Vehicle.id == RepairCase.vehicle_id)
        .where(
            EstimateLine.tenant_id == auth.tenant_id,
            Estimate.tenant_id == auth.tenant_id,
            RepairCase.tenant_id == auth.tenant_id,
            Estimate.status == EstimateStatus.APPROVED,
            Estimate.updated_at >= start,
            Estimate.updated_at < end,
        )
        .order_by(Estimate.updated_at, Estimate.id, EstimateLine.position, EstimateLine.created_at, EstimateLine.id)
    ).all()

    totals: dict[str, dict[str, Decimal]] = {
        area: defaultdict(lambda: ZERO) for area in ("MECHANICAL", "BODY")
    }
    parts: list[dict] = []
    other_costs: list[dict] = []
    hours: dict[tuple[UUID, str], dict] = {}

    for line, estimate, case, vehicle in rows:
        day = _when(estimate.updated_at).isoformat()
        area = CATEGORY_AREA.get(line.category, _case_area(case))
        reference = {"case_number": case.case_number, "plate": vehicle.license_plate, "area": area, "date": day}
        quantity = Decimal(line.quantity or 0)
        amount = money(quantity * Decimal(line.unit_price or 0))
        bucket = totals[area]

        labor_hours = Decimal(line.labor_hours or 0)
        paint_hours = Decimal(line.paint_hours or 0)
        if labor_hours or paint_hours:
            labor_value = money(labor_hours * Decimal(line.labor_rate or 0) + paint_hours * Decimal(line.paint_rate or 0))
            bucket["labor_hours"] += labor_hours
            bucket["paint_hours"] += paint_hours
            bucket["labor_value"] += labor_value
            row = hours.setdefault((case.id, area), {
                "case_id": f"{case.id}-{area}", **reference, "status": case.status.value,
                "labor_hours": ZERO, "paint_hours": ZERO, "labor_value": ZERO,
            })
            row["labor_hours"] += labor_hours
            row["paint_hours"] += paint_hours
            row["labor_value"] += labor_value

        if line.materials:
            materials = money(Decimal(line.materials))
            bucket["materials"] += materials
            other_costs.append({"id": f"{line.id}-m", **reference, "category": "MATERIAL", "description": line.description, "amount": materials})

        if not amount:
            continue
        if line.category in OTHER_CATEGORIES:
            kind = OTHER_CATEGORIES[line.category]
            bucket[{"MATERIAL": "materials", "EXTERNAL_SERVICE": "external"}.get(kind, "other")] += amount
            other_costs.append({"id": str(line.id), **reference, "category": kind, "description": line.description, "amount": amount})
        else:
            # A part (or a labor line that also carries a part): bought at unit_price, before the markup.
            bucket["parts"] += amount
            parts.append({
                "id": str(line.id), **reference, "description": line.part or line.description, "oem_code": line.oem_code,
                "quantity": str(quantity.normalize()), "unit_cost": str(money(Decimal(line.unit_price))), "total_cost": amount,
                "status": estimate.status.value,
            })

    expenses = db.scalars(
        select(WorkshopExpense)
        .where(WorkshopExpense.tenant_id == auth.tenant_id, WorkshopExpense.expense_date >= date_from, WorkshopExpense.expense_date <= date_to)
        .order_by(WorkshopExpense.expense_date, WorkshopExpense.created_at, WorkshopExpense.id)
    ).all()
    general = ZERO
    for expense in expenses:
        if expense.area in totals:
            totals[expense.area]["expenses"] += money(expense.amount)
        else:
            general += money(expense.amount)

    def area_out(bucket: dict[str, Decimal]) -> dict[str, str]:
        keys = ("parts", "labor_value", "materials", "external", "other", "expenses")
        out = {key: str(money(bucket[key])) for key in keys}
        out["labor_hours"] = str(bucket["labor_hours"].normalize() if bucket["labor_hours"] else ZERO)
        out["paint_hours"] = str(bucket["paint_hours"].normalize() if bucket["paint_hours"] else ZERO)
        out["total"] = str(money(sum((bucket[key] for key in keys), ZERO)))
        return out

    def text(row: dict) -> dict:
        return {key: (str(value) if isinstance(value, Decimal) else value) for key, value in row.items()}

    return {
        "from": date_from.isoformat(),
        "to": date_to.isoformat(),
        "areas": {area: area_out(bucket) for area, bucket in totals.items()},
        "general_expenses": str(money(general)),
        "parts": [text(row) for row in parts],
        "hours": [text(row) for row in hours.values()],
        "other_costs": [text(row) for row in other_costs],
        "expenses": [_expense_out(expense) for expense in expenses],
    }


@router.post("/expenses", status_code=status.HTTP_201_CREATED)
def create_expense(
    payload: ExpenseIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission("invoice.create")),
):
    expense = WorkshopExpense(
        tenant_id=auth.tenant_id, expense_date=payload.date, description=payload.description, category=payload.category,
        area=payload.area, supplier=payload.supplier, amount=payload.amount, notes=payload.notes, created_by=auth.user_id,
    )
    db.add(expense)
    db.flush()
    record_audit(db, tenant_id=auth.tenant_id, user_id=auth.user_id, entity_type="workshop_expense", entity_id=expense.id,
                 action="created", new_value=_expense_out(expense))
    db.commit()
    return _expense_out(expense)


def _own_expense(db: Session, auth: AuthContext, expense_id: UUID) -> WorkshopExpense:
    expense = db.get(WorkshopExpense, expense_id)
    if expense is None or expense.tenant_id != auth.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Spesa non trovata.")
    return expense


@router.put("/expenses/{expense_id}")
def update_expense(
    expense_id: UUID,
    payload: ExpenseIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission("invoice.create")),
):
    expense = _own_expense(db, auth, expense_id)
    old = _expense_out(expense)
    expense.expense_date, expense.description, expense.category = payload.date, payload.description, payload.category
    expense.area, expense.supplier, expense.amount, expense.notes = payload.area, payload.supplier, payload.amount, payload.notes
    record_audit(db, tenant_id=auth.tenant_id, user_id=auth.user_id, entity_type="workshop_expense", entity_id=expense.id,
                 action="updated", old_value=old, new_value=_expense_out(expense))
    db.commit()
    return _expense_out(expense)


@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    expense_id: UUID,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_permission("invoice.create")),
):
    expense = _own_expense(db, auth, expense_id)
    record_audit(db, tenant_id=auth.tenant_id, user_id=auth.user_id, entity_type="workshop_expense", entity_id=expense.id,
                 action="deleted", old_value=_expense_out(expense))
    db.delete(expense)
    db.commit()
