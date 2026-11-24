"""Reading the photo of an Italian carta di circolazione (libretto) with Claude.

Only what is printed on the document is returned: a box that is missing or not legible comes
back empty, never guessed. Nothing is saved here: the workshop checks the values first.
"""
import base64
import io
import json
import logging

from app.core.config import get_settings

logger = logging.getLogger("nakama.libretto")

MAX_SIDE = 1600

# Field -> what to read on the libretto (the box codes of the EU registration certificate).
FIELDS = {
    "license_plate": "riquadro A, la targa",
    "registration_date": "riquadro B, data di prima immatricolazione, formato GG/MM/AAAA",
    "make": "riquadro D.1, marca",
    "type_code": "riquadro D.2, tipo / variante / versione (codice di omologazione)",
    "model": "riquadro D.3, denominazione commerciale",
    "vin": "riquadro E, numero di telaio (VIN), di solito 17 caratteri",
    "engine_size": "riquadro P.1, cilindrata in cm3, solo il numero",
    "power_kw": "riquadro P.2, potenza netta massima in kW, solo il numero",
    "fuel_type": "riquadro P.3, alimentazione (es. benzina, gasolio, GPL, metano, elettrica)",
    "engine_code": "riquadro P.5, codice di identificazione del tipo di motore",
}

SCHEMA = {
    "type": "object",
    "properties": {
        "is_libretto": {"type": "boolean"},
        **{field: {"type": ["string", "null"]} for field in FIELDS},
    },
    "required": ["is_libretto", *FIELDS],
    "additionalProperties": False,
}

PROMPT = (
    "Questa foto dovrebbe mostrare una carta di circolazione italiana (libretto). "
    "Leggi solo i valori stampati nei riquadri indicati:\n"
    + "\n".join(f"- {field}: {where}" for field, where in FIELDS.items())
    + "\n\nRegole: copia i caratteri esattamente come sono stampati. Se un riquadro manca, è coperto "
    "o non è leggibile con certezza, metti null: non dedurre e non completare mai un valore. "
    "Se la foto non è una carta di circolazione, metti is_libretto false e tutti gli altri campi null."
)


class LibrettoError(Exception):
    """status_code 422: the photo is the problem (retake it); 502/503: the service is."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.user_message = message
        self.status_code = status_code


def is_configured() -> bool:
    return bool(get_settings().anthropic_api_key)


def prepare_image(raw: bytes) -> bytes:
    """Any photo the phone sends -> a JPEG of at most MAX_SIDE px, upright."""
    from PIL import Image, ImageOps

    try:
        image = Image.open(io.BytesIO(raw))
        image = ImageOps.exif_transpose(image).convert("RGB")
    except Exception as exc:  # noqa: BLE001 - any unreadable file is the same answer
        raise LibrettoError("Il file non è una foto leggibile: usa JPG o PNG.", 422) from exc
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=88)
    return out.getvalue()


def _clean(field: str, value) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    if not text:
        return None
    if field in ("vin", "license_plate", "engine_code", "type_code"):
        text = text.upper()
    if field in ("vin", "license_plate"):
        text = text.replace(" ", "")
    return text[:60]


def read_libretto(jpeg: bytes) -> dict:
    """Returns {field: value or None}. Raises LibrettoError with an Italian message."""
    import anthropic

    settings = get_settings()
    if not settings.anthropic_api_key:
        raise LibrettoError("Lettura libretto non configurata: manca la chiave API.", 503)
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=90, max_retries=2)
    try:
        response = client.messages.create(
            model=settings.libretto_model,
            max_tokens=4000,
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                             "data": base64.standard_b64encode(jpeg).decode()}},
                {"type": "text", "text": PROMPT},
            ]}],
        )
    except anthropic.AuthenticationError as exc:
        logger.warning("Libretto: API key refused: %s", exc)
        raise LibrettoError("La chiave API per la lettura del libretto non è valida.") from exc
    except anthropic.RateLimitError as exc:
        logger.warning("Libretto: rate limited: %s", exc)
        raise LibrettoError("Troppe letture in poco tempo: riprova tra un minuto.") from exc
    except anthropic.APIStatusError as exc:
        logger.warning("Libretto: API error %s: %s", exc.status_code, exc)
        if "credit" in str(exc).lower() or "billing" in str(exc).lower():
            raise LibrettoError("Credito API esaurito per la lettura del libretto.") from exc
        raise LibrettoError("Servizio di lettura non disponibile: riprova più tardi.") from exc
    except anthropic.APIConnectionError as exc:
        logger.warning("Libretto: connection error: %s", exc)
        raise LibrettoError("Servizio di lettura non raggiungibile: riprova più tardi.") from exc

    if response.stop_reason == "refusal":
        raise LibrettoError("La foto non può essere letta: riprova con un'altra foto.", 422)
    if response.stop_reason == "max_tokens":
        raise LibrettoError("Lettura incompleta: riprova con una foto più nitida.", 422)
    text = next((block.text for block in response.content if block.type == "text"), "")
    try:
        result = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LibrettoError("Lettura non riuscita: riprova con una foto più nitida.", 422) from exc
    if not result.get("is_libretto"):
        raise LibrettoError("La foto non sembra una carta di circolazione: inquadra il libretto aperto.", 422)
    values = {field: _clean(field, result.get(field)) for field in FIELDS}
    if not any(values.values()):
        raise LibrettoError("Nessun dato leggibile: riprova con più luce e il libretto ben a fuoco.", 422)
    return values
