"""Security fixes of the 2026-11 review: login throttling, estimate sharing, link expiry, real IP, uploads."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.core import config
from app.models.approval import EstimateApproval
from app.services import access, uploads
from test_staff import worker
from test_users import client, payload  # noqa: F401  (pytest fixture)


def test_staff_login_waits_after_five_wrong_passwords(client):
    c, _, _ = client
    assert c.post("/api/v1/users", json=payload()).status_code == 201
    guesser = c.__class__(c.app)
    for _ in range(access.MAX_FAILED_LOGINS_PER_ACCOUNT):
        assert guesser.post("/api/v1/auth/login", json={"email": "worker@example.com", "password": "guess"}).status_code == 401
    # Even the right password waits now: guessing cannot go on.
    blocked = guesser.post("/api/v1/auth/login", json={"email": "Worker@example.com", "password": payload()["password"]})
    assert blocked.status_code == 429 and blocked.headers["retry-after"] == "900"
    # Other accounts are not affected.
    assert guesser.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "TestPassword2026!"}).status_code == 200


def test_portal_login_waits_after_five_wrong_passwords(client):
    c, _, _ = client
    customer = c.post("/api/v1/customers", json={"customer_type": "COMPANY", "company_name": "Flotta Srl"}).json()
    account = c.post(f"/api/v1/customers/{customer['id']}/portal-accounts", json={"email": "f@example.com", "full_name": "Ufficio"}).json()
    for _ in range(access.MAX_FAILED_LOGINS_PER_ACCOUNT):
        assert c.post("/api/v1/portal/auth/login", json={"email": "f@example.com", "password": "guess"}).status_code == 401
    assert c.post("/api/v1/portal/auth/login", json={"email": "f@example.com", "password": account["temporary_password"]}).status_code == 429


def test_only_the_office_sends_estimates_to_the_customer(client):
    c, _, _ = client
    customer = c.post("/api/v1/customers", json={"first_name": "Sara"}).json()
    vehicle = c.post("/api/v1/vehicles", json={"license_plate": "SH000AA", "customer_id": customer["id"]}).json()
    case = c.post("/api/v1/cases", json={"customer_id": customer["id"], "vehicle_id": vehicle["id"]}).json()
    estimate = c.post("/api/v1/estimates", json={"repair_case_id": case["id"]}).json()
    for role in ("MECHANIC", "BODYSHOP", "PAINTER"):
        staff, _, _ = worker(c, f"{role.lower()}@example.com", role)
        assert staff.post(f"/api/v1/estimates/{estimate['id']}/share").status_code == 403
    assert c.get(f"/api/v1/estimates/{estimate['id']}").json()["status"] == "DRAFT"
    reception, _, _ = worker(c, "reception@example.com", "RECEPTION")
    assert reception.post(f"/api/v1/estimates/{estimate['id']}/share").status_code == 200


def test_public_estimate_link_expires_and_sharing_again_gives_a_new_one(client):
    c, engine, _ = client
    customer = c.post("/api/v1/customers", json={"first_name": "Luca"}).json()
    vehicle = c.post("/api/v1/vehicles", json={"license_plate": "EX000AA", "customer_id": customer["id"]}).json()
    case = c.post("/api/v1/cases", json={"customer_id": customer["id"], "vehicle_id": vehicle["id"]}).json()
    estimate = c.post("/api/v1/estimates", json={"repair_case_id": case["id"]}).json()
    old = c.post(f"/api/v1/estimates/{estimate['id']}/share").json()["public_token"]
    assert c.get(f"/api/v1/public/estimate/{old}").status_code == 200
    with Session(engine) as db:
        db.execute(update(EstimateApproval).values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        db.commit()
    assert c.get(f"/api/v1/public/estimate/{old}").status_code == 410
    assert c.post(f"/api/v1/public/estimate/{old}/decision", json={"accepted": True, "signature_name": "Luca", "accept_terms": True, "accept_privacy": True}).status_code == 410
    new = c.post(f"/api/v1/estimates/{estimate['id']}/share").json()["public_token"]
    assert new != old
    assert c.get(f"/api/v1/public/estimate/{new}").status_code == 200
    assert c.get(f"/api/v1/public/estimate/{old}").status_code == 404


def request_with(headers: dict[str, str], body: bytes = b"") -> Request:
    chunks = [body[i:i + 1024] for i in range(0, len(body), 1024)] or [b""]

    async def receive():
        chunk = chunks.pop(0) if chunks else b""
        return {"type": "http.request", "body": chunk, "more_body": bool(chunks)}

    raw = [(key.lower().encode(), value.encode()) for key, value in headers.items()]
    return Request({"type": "http", "method": "POST", "headers": raw, "client": ("10.0.0.9", 1234)}, receive)


def test_client_ip_ignores_the_address_written_by_the_visitor():
    assert access.client_ip(request_with({"X-Forwarded-For": "6.6.6.6, 93.40.1.2"})) == "93.40.1.2"
    assert access.client_ip(request_with({"X-Real-IP": "6.6.6.6", "X-Forwarded-For": "93.40.1.3"})) == "93.40.1.3"
    assert access.client_ip(request_with({})) == "10.0.0.9"


def test_upload_without_content_length_is_cut_at_the_limit():
    with pytest.raises(HTTPException) as error:
        asyncio.run(uploads.read_body(request_with({}, b"x" * 5000), limit=4096))
    assert error.value.status_code == 413
    assert asyncio.run(uploads.read_body(request_with({}, b"x" * 3000), limit=4096)) == b"x" * 3000


def test_test_copies_do_not_get_the_paid_service_keys(monkeypatch):
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "pr-112")
    monkeypatch.setenv("TARGA_API_USERNAME", "real-user")
    monkeypatch.setenv("CAR_IMAGE_API_KEY", "real-key")
    config.get_settings.cache_clear()
    try:
        settings = config.get_settings()
        assert settings.targa_api_username is None and settings.car_image_api_key is None
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
        config.get_settings.cache_clear()
        assert config.get_settings().targa_api_username == "real-user"
    finally:
        config.get_settings.cache_clear()
