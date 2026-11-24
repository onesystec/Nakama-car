import uuid

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TenantOwnedMixin, TimestampMixin, UUIDPrimaryKeyMixin


class TechnicalSheet(Base, UUIDPrimaryKeyMixin, TenantOwnedMixin, TimestampMixin):
    """Maintenance data of one model + engine (oil, filters, intervals, tyres...).

    Shared by every vehicle of the tenant with the same make, model and engine, so the
    workshop fills it once. Values come from the workshop (``source`` "officina") or, later,
    from a licensed data provider; nothing is ever guessed.
    """

    __tablename__ = "technical_sheets"
    __table_args__ = (UniqueConstraint("tenant_id", "model_key", name="uq_technical_sheets_tenant_key"),)

    model_key: Mapped[str] = mapped_column(String(255), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="officina")
    updated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
