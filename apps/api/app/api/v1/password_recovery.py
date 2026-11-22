"""Password recovery for active staff and customer portal accounts."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from typing import Literal
import logging
import os

from app.core.config import get_settings, is_test_copy
from app.db.deps import get_db
from app.models.identity import AccessLog, User, UserStatus, UserTenant
from app.models.portal import PortalAccount
from app.security.passwords import hash_password
from app.security.tokens import TokenError, decode_token, encode_token
from app.services import access

router = APIRouter(prefix="/auth/recovery", tags=["auth"])
logger = logging.getLogger(__name__)
PUBLIC_ORIGIN = "https://nakama-car-web-production.up.railway.app"
SENDER = "Nakama Car <info@nakamacar.com>"


class RecoveryRequest(BaseModel):
    email: EmailStr
    account_type: Literal["staff", "portal"]


class RecoveryConfirmation(BaseModel):
    token: str = Field(min_length=1, max_length=2048)
    password: str = Field(min_length=10, max_length=200)


def send_recovery_message(api_key: str, recipient: str, token: str, account_type: str) -> None:
    link = f"{PUBLIC_ORIGIN}/login/recover?area={account_type}#{token}"
    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"from": SENDER, "to": [recipient], "subject": "Reimposta la password di Nakama Car",
                  "text": f"Per scegliere una nuova password, apri questo link entro 20 minuti:\n{link}\n\n"
                          "Se non hai richiesto il cambio, ignora questo messaggio.",
                  "tags": [{"name": "purpose", "value": "password-recovery"}]},
            timeout=8,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        logger.warning("Password recovery email delivery failed")


def active_scope(db: Session, account: User | PortalAccount | None):
    if isinstance(account, PortalAccount):
        return account.tenant_id if account.active else None
    if isinstance(account, User) and account.status == UserStatus.ACTIVE:
        return db.scalar(select(UserTenant.tenant_id).where(UserTenant.user_id == account.id).order_by(
            UserTenant.is_default.desc(), UserTenant.created_at.asc(), UserTenant.tenant_id
        ).limit(1))
    return None


def record_recovery(db: Session, request: Request, account: User | PortalAccount, tenant_id: UUID, event: str):
    is_portal = isinstance(account, PortalAccount)
    access.record_access(
        db, request, tenant_id=tenant_id, email=account.email, event=event,
        portal_account_id=account.id if is_portal else None, user_id=None if is_portal else account.id,
    )


@router.post("/request", status_code=202)
def request_recovery(payload: RecoveryRequest, request: Request, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    key = os.environ.get("NAKAMA_RECOVERY_RESEND_API_KEY")
    if not key or is_test_copy(get_settings()):
        raise HTTPException(status_code=503, detail="RECOVERY_UNAVAILABLE")
    model = PortalAccount if payload.account_type == "portal" else User
    account = db.scalar(select(model).where(func.lower(model.email) == payload.email.lower()).with_for_update())
    tenant_id = active_scope(db, account)
    if tenant_id is None:
        return {"accepted": True}
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=20)
    recent = select(func.count(AccessLog.id)).where(
        AccessLog.event == "RECOVERY_REQUESTED", AccessLog.created_at >= cutoff
    )
    by_account = db.scalar(recent.where(func.lower(AccessLog.email) == account.email.lower()))
    ip = access.client_ip(request)
    by_ip = db.scalar(recent.where(AccessLog.ip_address == ip)) if ip else 0
    if by_account >= 2 or by_ip >= 10:
        return {"accepted": True}

    token = encode_token({
        "sub": str(account.id), "type": "password_recovery", "area": payload.account_type,
        "auth_version": account.auth_version, "exp": datetime.now(timezone.utc) + timedelta(minutes=20),
    })
    recipient = account.email
    record_recovery(db, request, account, tenant_id, "RECOVERY_REQUESTED")
    db.commit()
    tasks.add_task(send_recovery_message, key, recipient, token, payload.account_type)
    return {"accepted": True}


@router.post("/confirm")
def confirm_recovery(payload: RecoveryConfirmation, request: Request, db: Session = Depends(get_db)):
    invalid = HTTPException(status_code=400, detail="RECOVERY_LINK_INVALID")
    try:
        claims = decode_token(payload.token)
        account_id = UUID(claims["sub"])
    except (TokenError, ValueError, TypeError, KeyError):
        raise invalid from None
    if claims.get("type") != "password_recovery" or claims.get("area") not in ("portal", "staff"):
        raise invalid

    model = PortalAccount if claims["area"] == "portal" else User
    account = db.scalar(select(model).where(model.id == account_id).with_for_update())
    tenant_id = active_scope(db, account)
    if tenant_id is None or account.auth_version != claims.get("auth_version"):
        raise invalid
    account.password_hash = hash_password(payload.password)
    account.auth_version += 1
    account.must_change_password = False
    record_recovery(db, request, account, tenant_id, "PASSWORD_RECOVERED")
    db.commit()
    return {"updated": True}
