"""Public estimate links (/public/estimate/<token>): they expire, and a new one replaces an expired one."""
import secrets
from datetime import datetime, timedelta, timezone

from app.models.approval import EstimateApproval

# A public estimate link works this long; sharing the estimate again gives a fresh link.
LINK_DAYS = 30


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def new_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=LINK_DAYS)


def link_expired(approval: EstimateApproval) -> bool:
    if approval.responded_at is not None:
        return False  # an answered link only shows the answer
    expires = approval.expires_at
    if expires is None and approval.created_at is not None:  # links made before expiry existed
        expires = _aware(approval.created_at) + timedelta(days=LINK_DAYS)
    return expires is not None and _aware(expires) <= datetime.now(timezone.utc)


def renew_if_expired(approval: EstimateApproval) -> bool:
    """Expired and never answered: same approval, new token (the old link stays dead). Caller commits."""
    if not link_expired(approval):
        return False
    approval.public_token = secrets.token_urlsafe(32)
    approval.expires_at = new_expiry()
    return True
