"""ONESYSTEC GENERALE switch: when the app is off in the portal the API answers 503 APP_SUSPENDIDA."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import onesystec_control
from app.main import app

WEB_ORIGIN = "https://nakama-car-web-production.up.railway.app"
ENV = {"GENERALE_URL": "https://generale.example.test", "GENERALE_KEY": "osg_x"}


class FixedState:
    """Replaces the GENERALE poll (no network, no thread) with a fixed 'off' state."""

    def __init__(self, base, key):
        self.activa, self.mensaje, self.motivo = False, "Manutenzione programmata", "mantenimiento"


def mini_app():
    mini = FastAPI()
    mini.add_middleware(onesystec_control.OnesystecControl)
    mini.get("/cases")(lambda: {"ok": True})
    mini.get("/api/v1/health")(lambda: {"status": "ok"})
    return mini


def test_without_variables_nothing_changes(monkeypatch):
    monkeypatch.delenv("GENERALE_URL", raising=False)
    monkeypatch.delenv("GENERALE_KEY", raising=False)
    assert TestClient(mini_app()).get("/cases").status_code == 200


def test_switched_off_answers_503_except_health(monkeypatch):
    for k, v in ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(onesystec_control, "_Estado", FixedState)
    client = TestClient(mini_app())
    response = client.get("/cases")
    assert response.status_code == 503
    assert response.json() == {"code": "APP_SUSPENDIDA", "detail": "Manutenzione programmata", "mensaje": "Manutenzione programmata", "motivo": "mantenimiento"}
    assert client.get("/api/v1/health").status_code == 200


def test_real_app_503_carries_cors(monkeypatch):
    for k, v in ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(onesystec_control, "_Estado", FixedState)
    app.middleware_stack = None  # rebuilt with the variables
    try:
        response = TestClient(app).get("/api/v1/cases", headers={"Origin": WEB_ORIGIN})
    finally:
        app.middleware_stack = None
    assert response.status_code == 503
    assert response.json()["code"] == "APP_SUSPENDIDA"
    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN
