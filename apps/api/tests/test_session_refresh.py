"""A session in use is renewed (POST /auth/refresh); an expired or revoked one is not."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1.auth import settings
from app.db.base import Base
from app.db.deps import get_db
from app.main import app
from app.security.tokens import decode_token, encode_token


@pytest.fixture
def client(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)

    def database():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(settings, "bootstrap_token", "test-bootstrap-only")
    c = TestClient(app)
    boot = c.post("/api/v1/setup/bootstrap", headers={"X-Bootstrap-Token": "test-bootstrap-only"}, json={
        "admin_email": "admin@example.com", "admin_password": "TestPassword2026!", "first_name": "Test", "last_name": "Admin", "company_name": "Test Garage",
    })
    assert boot.status_code == 200
    yield c, boot.json()["access_token"]
    app.dependency_overrides.clear()


def test_refresh_gives_a_later_token(client):
    c, token = client
    old = decode_token(token)
    # A token issued a while ago: the new one must last longer.
    aged = encode_token({**old, "iat": old["iat"] - 600, "exp": old["exp"] - 600})
    response = c.post("/api/v1/auth/refresh", headers={"Authorization": f"Bearer {aged}"})
    assert response.status_code == 200
    fresh = response.json()["access_token"]
    assert decode_token(fresh)["exp"] > old["exp"] - 600
    assert c.get("/api/v1/me", headers={"Authorization": f"Bearer {fresh}"}).status_code == 200


def test_expired_token_is_not_refreshed(client):
    c, token = client
    payload = decode_token(token)
    past = int((datetime.now(timezone.utc) - timedelta(minutes=1)).timestamp())
    expired = encode_token({**payload, "exp": past})
    assert c.post("/api/v1/auth/refresh", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    assert c.post("/api/v1/auth/refresh").status_code == 401
