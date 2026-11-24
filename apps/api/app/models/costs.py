import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, Numeric, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TenantOwnedMixin, TimestampMixin, UUIDPrimaryKeyMixin


class WorkshopExpense(Base, UUIDPrimaryKeyMixin, TenantOwnedMixin, TimestampMixin):
    """A cost of the workshop itself (rent, utilities, tools…), for one department or for all."""

    __tablename__ = "workshop_expenses"

    expense_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False, default="ALTRO")
    # MECHANICAL | BODY | GENERAL (the whole workshop)
    area: Mapped[str] = mapped_column(String(12), nullable=False, default="GENERAL")
    supplier: Mapped[str | None] = mapped_column(String(160))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
