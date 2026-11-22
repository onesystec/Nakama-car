from sqlalchemy import select, update
from sqlalchemy.orm import Session

import test_fleet_billing as fleet
from app.models.identity import AccessLog, User
from app.services.access import LEGAL_VERSION
from test_users import client, payload  # noqa: F401  (pytest fixture)


def test_staff_login_is_logged_and_legal_acceptance_is_stored(client):
    c, engine, _ = client
    assert c.post("/api/v1/users", json=payload()).status_code == 201
    worker = c.__class__(c.app)
    android = {"User-Agent": "Mozilla/5.0 (Linux; Android 14; wv) NakamaAndroid/1.1.1", "X-Forwarded-For": "6.6.6.6, 93.40.1.2"}

    assert worker.post("/api/v1/auth/login", json={"email": "worker@example.com", "password": "wrong"}, headers=android).status_code == 401
    assert worker.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "wrong"}).status_code == 401
    login = worker.post("/api/v1/auth/login", json={"email": "worker@example.com", "password": payload()["password"]}, headers=android)
    assert login.status_code == 200 and login.json()["legal_required"] is True
    worker.headers["Authorization"] = "Bearer " + login.json()["access_token"]

    # Both boxes are needed, separately.
    assert worker.post("/api/v1/auth/legal", json={"accept_terms": True, "accept_privacy": False}).status_code == 422
    assert worker.post("/api/v1/auth/legal", json={"accept_terms": True}).status_code == 422
    accepted = worker.post("/api/v1/auth/legal", json={"accept_terms": True, "accept_privacy": True})
    assert accepted.status_code == 200 and accepted.json()["legal_version"] == LEGAL_VERSION
    assert worker.post("/api/v1/auth/login", json={"email": "worker@example.com", "password": payload()["password"]}).json()["legal_required"] is False

    logs = c.get("/api/v1/audit/access", params={"email": "worker@"}).json()
    assert [row["event"] for row in logs] == ["LOGIN_OK", "LEGAL_ACCEPTED", "LOGIN_OK", "LOGIN_FAILED"]
    failed = logs[-1]
    assert failed["client"] == "ANDROID" and failed["ip_address"] == "93.40.1.2" and failed["account_type"] == "STAFF"
    assert logs[0]["client"] == "WEB"
    with Session(engine) as db:
        assert db.scalar(select(AccessLog).where(AccessLog.email == "nobody@example.com")) is None
        user = db.scalar(select(User).where(User.email == "worker@example.com"))
        assert user.terms_accepted_at is not None and user.privacy_accepted_at is not None
        # A new version of the texts asks everybody again.
        db.execute(update(User).values(legal_version="old"))
        db.commit()
    assert worker.post("/api/v1/auth/login", json={"email": "worker@example.com", "password": payload()["password"]}).json()["legal_required"] is True

    # Only who reads the audit sees the access log.
    assert worker.get("/api/v1/audit/access").status_code == 403


def test_portal_login_is_logged_and_needs_both_boxes(client):
    c, _, _ = client
    customer, _, _, _ = fleet.create_fleet_case(c)
    account = c.post(f"/api/v1/customers/{customer['id']}/portal-accounts", json={"email": "flotta@univex.example.com", "full_name": "Ufficio flotta"}).json()
    portal = c.__class__(c.app)
    assert portal.post("/api/v1/portal/auth/login", json={"email": account["email"], "password": "wrong"}).status_code == 401
    login = portal.post("/api/v1/portal/auth/login", json={"email": account["email"], "password": account["temporary_password"]}, headers={"User-Agent": "Mozilla/5.0 Electron/31"})
    assert login.json()["legal_required"] is True
    portal.headers["Authorization"] = "Bearer " + login.json()["access_token"]
    assert portal.post("/api/v1/portal/legal", json={"accept_terms": False, "accept_privacy": True}).status_code == 422
    assert portal.post("/api/v1/portal/legal", json={"accept_terms": True, "accept_privacy": True}).status_code == 200
    assert portal.post("/api/v1/portal/auth/login", json={"email": account["email"], "password": account["temporary_password"]}).json()["legal_required"] is False

    logs = c.get("/api/v1/audit/access").json()
    portal_rows = [row for row in logs if row["account_type"] == "PORTAL"]
    assert [row["event"] for row in portal_rows] == ["LOGIN_OK", "LEGAL_ACCEPTED", "LOGIN_OK", "LOGIN_FAILED"]
    assert portal_rows[2]["client"] == "MAC"



def test_recovery_is_generic_and_revokes_previous_session(client, monkeypatch):
    from app.api.v1 import password_recovery

    c, _, _ = client
    sent = []
    monkeypatch.setenv("NAKAMA_RECOVERY_RESEND_API_KEY", "mock-key")
    monkeypatch.setattr(password_recovery, "send_recovery_message", lambda *args: sent.append(args))
    assert c.post("/api/v1/users", json=payload()).status_code == 201
    worker = c.__class__(c.app)
    original = {"email": "worker@example.com", "password": payload()["password"]}
    login = worker.post("/api/v1/auth/login", json=original).json()
    worker.headers["Authorization"] = "Bearer " + login["access_token"]

    path = "/api/v1/auth/recovery"
    missing = worker.post(path + "/request", json={"email": "nobody@example.com", "account_type": "staff"})
    issued = worker.post(path + "/request", json={"email": original["email"], "account_type": "staff"})
    assert missing.status_code == issued.status_code == 202
    assert missing.json() == issued.json()
    assert len(sent) == 1 and sent[0][1] == original["email"]
    token = sent[0][2]
    reset = {"token": token, "password": "different-long-password"}
    assert worker.post(path + "/confirm", json=reset).status_code == 200
    assert worker.post(path + "/confirm", json=reset).status_code == 400
    assert worker.post("/api/v1/auth/legal", json={"accept_terms": True, "accept_privacy": True}).status_code == 401
    assert worker.post("/api/v1/auth/login", json=original).status_code == 401
    assert worker.post("/api/v1/auth/login", json={**original, "password": reset["password"]}).status_code == 200
