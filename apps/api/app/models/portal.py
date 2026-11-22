import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TenantOwnedMixin, TimestampMixin, UUIDPrimaryKeyMixin


class PortalAccount(Base, UUIDPrimaryKeyMixin, TenantOwnedMixin, TimestampMixin):
    """Login of a business customer (fleet contract) to its own vehicles portal."""

    __tablename__ = "portal_accounts"

    customer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    auth_version: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Version of terms + privacy notice accepted (two separate boxes) and when; empty = must accept at next login.
    legal_version: Mapped[str | None] = mapped_column(String(20))
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    privacy_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))



class PortalServiceRequest(Base, UUIDPrimaryKeyMixin, TenantOwnedMixin, TimestampMixin):
    __tablename__ = "portal_service_requests"
    __table_args__ = (Index("ix_portal_service_requests_customer_scope", "tenant_id", "customer_id"),)

    customer_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("customers.id", ondelete="CASCADE"))
    vehicle_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("vehicles.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))
    note: Mapped[str] = mapped_column(String(1000))
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
