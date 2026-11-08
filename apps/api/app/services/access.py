"""Access log and legal acceptance: who entered the app, when and how, and which terms they accepted.

The log answers an inspection (Garante privacy, police, a customer's access request) and is kept
RETENTION_DAYS, then deleted automatically. It stores only what that needs: account, email, event,
client (web / Android / Mac), IP address and browser.
"""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.identity import AccessLog

# Bump when the terms, privacy or cookie texts change in a way users must accept again (lib/legal.ts too).
LEGAL_VERSION = "2026-10-23"
RETENTION_DAYS = 365

# Password guessing: after this many wrong passwords in the window, the account (or the address) waits.
MAX_FAILED_LOGINS_PER_ACCOUNT = 5
MAX_FAILED_LOGINS_PER_IP = 20
FAILED_LOGIN_WINDOW_MINUTES = 15


def client_ip(request: Request | None) -> str | None:
    """Real visitor address, as seen by the hosting proxy.

    Only the last X-Forwarded-For entry counts: the hosting proxy adds it. Anything before it (or an
    X-Real-IP header) may have been written by the visitor to fake another address.
    """
    if request is None:
        return None
    forwarded = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
    if forwarded:
        return forwarded[-1][:64]
    return request.client.host if request.client else None


def check_login_allowed(db: Session, request: Request | None, email: str) -> None:
    """Stop password guessing: too many recent wrong passwords for this email or from this address → 429."""
    since = datetime.now(timezone.utc) - timedelta(minutes=FAILED_LOGIN_WINDOW_MINUTES)
    recent = select(func.count(AccessLog.id)).where(AccessLog.event == "LOGIN_FAILED", AccessLog.created_at >= since)
    by_account = db.scalar(recent.where(func.lower(AccessLog.email) == email.lower())) or 0
    ip = client_ip(request)
    by_ip = (db.scalar(recent.where(AccessLog.ip_address == ip)) or 0) if ip else 0
    if by_account >= MAX_FAILED_LOGINS_PER_ACCOUNT or by_ip >= MAX_FAILED_LOGINS_PER_IP:
        raise HTTPException(
            status_code=429,
            detail=f"Troppi tentativi falliti: riprova tra {FAILED_LOGIN_WINDOW_MINUTES} minuti.",
            headers={"Retry-After": str(FAILED_LOGIN_WINDOW_MINUTES * 60)},
        )


def client_kind(user_agent: str | None) -> str:
    agent = user_agent or ""
    if "NakamaAndroid" in agent:
        return "ANDROID"
    if "Electron" in agent:
        return "MAC"
    return "WEB"


def record_access(
    db: Session,
    request: Request | None,
    *,
    tenant_id: UUID,
    email: str,
    event: str,
    user_id: UUID | None = None,
    portal_account_id: UUID | None = None,
) -> AccessLog:
    agent = request.headers.get("user-agent") if request is not None else None
    entry = AccessLog(
        tenant_id=tenant_id,
        account_type="PORTAL" if portal_account_id else "STAFF",
        user_id=user_id,
        portal_account_id=portal_account_id,
        email=email,
        event=event,
        method="password",
        client=client_kind(agent),
        ip_address=client_ip(request),
        user_agent=(agent or "")[:512] or None,
    )
    db.add(entry)
    purge_old(db)
    return entry


def purge_old(db: Session) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    db.execute(delete(AccessLog).where(AccessLog.created_at < cutoff).execution_options(synchronize_session=False))


def legal_required(account) -> bool:
    return account.legal_version != LEGAL_VERSION


def accept_legal(account) -> None:
    """Stores the two separate acceptances (terms, privacy notice) on a user, portal account or approval."""
    now = datetime.now(timezone.utc)
    account.legal_version = LEGAL_VERSION
    account.terms_accepted_at = now
    account.privacy_accepted_at = now
