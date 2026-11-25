"""Magazzino: the stock of the workshop, split by Meccanica and Carrozzeria."""
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TenantOwnedMixin, TimestampMixin, UUIDPrimaryKeyMixin


class InventoryItem(Base, UUIDPrimaryKeyMixin, TenantOwnedMixin, TimestampMixin):
    """One article on the shelf: a part, a material, a paint, a consumable or a tool."""

    __tablename__ = "inventory_items"

    # MECHANICAL (meccanica) | BODY (carrozzeria)
    area: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    # RICAMBIO | MATERIALE | VERNICE | CONSUMABILE | LUBRIFICANTE | ATTREZZO | ALTRO
    category: Mapped[str] = mapped_column(String(20), nullable=False, default="RICAMBIO")
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str | None] = mapped_column(String(80))
    brand: Mapped[str | None] = mapped_column(String(80))
    unit: Mapped[str] = mapped_column(String(8), nullable=False, default="PZ")
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    min_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    location: Mapped[str | None] = mapped_column(String(80))
    supplier: Mapped[str | None] = mapped_column(String(160))
    notes: Mapped[str | None] = mapped_column(Text)


class InventoryMovement(Base, UUIDPrimaryKeyMixin, TenantOwnedMixin, TimestampMixin):
    """Stock in (carico), out (scarico, often for a pratica) or a count correction (rettifica)."""

    __tablename__ = "inventory_movements"

    item_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False, index=True)
    # IN | OUT | ADJUST
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    # Signed change of the stock: + for a carico, - for a scarico.
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    movement_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    repair_case_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("repair_cases.id", ondelete="SET NULL"), index=True)
    # Kept as text so the history still reads well if the pratica is deleted.
    case_number: Mapped[str | None] = mapped_column(String(40))
    plate: Mapped[str | None] = mapped_column(String(20))
    supplier: Mapped[str | None] = mapped_column(String(160))
    note: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
