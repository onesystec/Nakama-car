from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt

from app.core.config import get_settings

settings = get_settings()

# Any invalid, expired or tampered token.
TokenError = jwt.PyJWTError


def encode_token(payload: dict) -> str:
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    """Signature and expiry checked; only the configured algorithm is accepted."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm], options={"require": ["exp", "sub"]})


def create_access_token(*, user_id: UUID, tenant_id: UUID, permissions: list[str], auth_version: int = 0) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "tenant_id": str(tenant_id),
        "permissions": permissions,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_expire_minutes)).timestamp()),
        "type": "access",
        "auth_version": auth_version,
    }
    return encode_token(payload)
