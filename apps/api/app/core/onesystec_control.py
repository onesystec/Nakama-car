"""Interruptor de ONESYSTEC GENERALE para apps FastAPI / Starlette.

Uso (en main.py, ANTES de añadir CORSMiddleware, para que el 503 lleve CORS):
    from app.core.onesystec_control import OnesystecControl
    app.add_middleware(OnesystecControl)

Variables de entorno: GENERALE_URL y GENERALE_KEY (clave generada en el portal).
Sin esas variables no hace nada. Si GENERALE no responde, la app sigue con el último estado conocido.
"""
import json
import os
import threading
import urllib.request

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

EVERY_SECONDS = 30


class _Estado:
    def __init__(self, base: str, key: str):
        self.base, self.key = base.rstrip("/"), key
        self.activa, self.mensaje, self.motivo = True, "", ""
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        stop = threading.Event()
        while True:
            self.refresh()
            stop.wait(EVERY_SECONDS)

    def refresh(self):
        try:
            req = urllib.request.Request(self.base + "/api/estado", headers={"Authorization": "Bearer " + self.key})
            with urllib.request.urlopen(req, timeout=5) as res:
                data = json.load(res)
            self.activa = data.get("activa") is not False
            self.mensaje = str(data.get("mensaje") or "")
            self.motivo = str(data.get("motivo") or "")  # "mantenimiento", "apagada", "pago" o "acceso"
        except Exception:
            pass  # sin conexión o clave incorrecta: se mantiene el último estado conocido


class OnesystecControl(BaseHTTPMiddleware):
    def __init__(self, app, exempt=("/health", "/api/v1/health", "/docs", "/redoc", "/openapi.json")):
        super().__init__(app)
        base, key = os.getenv("GENERALE_URL", ""), os.getenv("GENERALE_KEY", "")
        self.estado = _Estado(base, key) if base and key else None
        self.exempt = tuple(exempt)

    async def dispatch(self, request, call_next):
        e = self.estado
        if e is None or e.activa or request.method == "OPTIONS" or request.url.path.startswith(self.exempt):
            return await call_next(request)
        return JSONResponse({"code": "APP_SUSPENDIDA", "detail": e.mensaje, "mensaje": e.mensaje, "motivo": e.motivo},
                            status_code=503, headers={"Retry-After": "60"})
