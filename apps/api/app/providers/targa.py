"""targa.co.it (RegCheck) plate lookup for Italian vehicles.

The service is an ASP.NET ASMX web service; the HTTP GET binding of the
``CheckItaly`` operation returns an XML document whose ``vehicleJson`` element
holds the vehicle data as JSON. One credit is charged per successful lookup.
"""
import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from xml.etree import ElementTree as ET

from app.providers.contracts import ProviderVehicle, VehicleDataProvider

PROVIDER_NAME = "targa.co.it"

logger = logging.getLogger(__name__)

# Messages shown to the workshop (Italian, like the rest of the app).
REASON_MESSAGES = {
    "no_credit": "Crediti esauriti sul servizio targhe (targa.co.it): ricarica il conto per riattivare la ricerca.",
    "account": "Account del servizio targhe non valido: controlla il nome utente configurato (TARGA_API_USERNAME).",
    "unreachable": "Il servizio targhe non risponde: riprova tra qualche minuto.",
    "error": "Il servizio targhe ha restituito un errore: riprova più tardi.",
}


class PlateLookupError(RuntimeError):
    """The provider could not answer (credentials, credit, network)."""

    def __init__(self, message: str, reason: str = "error"):
        super().__init__(message)
        self.reason = reason

    @property
    def user_message(self) -> str:
        return REASON_MESSAGES.get(self.reason, REASON_MESSAGES["error"])


def classify_error(detail: str) -> str | None:
    """Reason code for an ASMX error body, None when the plate simply was not found."""
    text = detail.lower()
    if "no vehicle" in text or "not found" in text or "invalid registration" in text:
        return None
    if "credit" in text or "balance" in text:
        return "no_credit"
    if "username" in text or "authori" in text or "blocked" in text:
        return "account"
    return "error"


def _text(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, dict):
        value = value.get("CurrentTextValue") or value.get("CurrentValue") or value.get("Value")
    text = str(value).strip() if value is not None else ""
    return text or None


def _int(value) -> int | None:
    match = re.search(r"\d+", _text(value) or "")
    return int(match.group()) if match else None


FUEL_KEYWORDS = [
    ("plug-in", "Ibrida plug-in"), ("phev", "Ibrida plug-in"),
    ("hybrid", "Ibrida"), ("ibrid", "Ibrida"), ("mhev", "Ibrida"),
    ("elettric", "Elettrica"), ("electric", "Elettrica"), (" ev ", "Elettrica"),
    ("gpl", "GPL"), ("lpg", "GPL"), ("metano", "Metano"), ("cng", "Metano"),
    ("diesel", "Diesel"), ("gasolio", "Diesel"), ("multijet", "Diesel"), ("mjt", "Diesel"),
    ("jtd", "Diesel"), ("tdi", "Diesel"), ("crdi", "Diesel"), ("dci", "Diesel"), ("hdi", "Diesel"),
    ("bluehdi", "Diesel"), ("d-4d", "Diesel"),
    ("benzina", "Benzina"), ("tsi", "Benzina"), ("tfsi", "Benzina"), ("firefly", "Benzina"),
]


def infer_from_description(text: str | None) -> dict:
    """Fuel, engine size and power written inside the Italian version text,
    e.g. "Panda 1.0 firefly hybrid s&s 70cv 5p" -> Ibrida, 1.0 L, 51 kW."""
    result: dict = {}
    if not text:
        return result
    lower = f" {text.lower()} "
    for keyword, fuel in FUEL_KEYWORDS:
        if keyword in lower:
            result["fuel_type"] = fuel
            break
    liters = re.search(r"(?<![\d.])(\d\.\d)(?![\d.])", lower)
    if liters and 0.5 <= float(liters.group(1)) <= 8.0:
        result["engine_size"] = f"{liters.group(1)} L"
    kw = re.search(r"(\d{2,3})\s*kw\b", lower)
    cv = re.search(r"(\d{2,3})\s*(?:cv|hp)\b", lower)
    if kw:
        result["power_kw"] = int(kw.group(1))
    elif cv:
        result["power_kw"] = round(int(cv.group(1)) * 0.7355)
    return result


def enrich(values: dict) -> dict:
    """Fill fuel/engine/power from the version text when the provider left them empty."""
    enriched = dict(values)
    if not enriched.get("power_kw"):
        enriched["power_kw"] = None
    inferred = infer_from_description(" ".join(filter(None, [values.get("version"), values.get("description")])))
    for key, value in inferred.items():
        if not enriched.get(key):
            enriched[key] = value
    return enriched


def parse_vehicle(plate: str, data: dict) -> ProviderVehicle:
    make = _text(data.get("CarMake")) or _text(data.get("MakeDescription"))
    model = _text(data.get("CarModel")) or _text(data.get("ModelDescription"))
    year = _int(data.get("RegistrationYear"))
    power = _int(data.get("PowerKW")) or None
    if power is None and _int(data.get("PowerCV")):
        power = round(_int(data.get("PowerCV")) * 0.7355)
    extra = enrich({
        "version": _text(data.get("Version")),
        "description": _text(data.get("Description")),
        "fuel_type": _text(data.get("FuelType")),
        "engine_size": _text(data.get("EngineSize")),
        "power_kw": power,
    })
    return ProviderVehicle(
        external_id=_text(data.get("KType")),
        make=make.title() if make and make.isupper() else make,
        model=model,
        version=_text(data.get("Version")) or _text(data.get("Description")),
        year=year if year and 1886 <= year <= 2100 else None,
        vin=_text(data.get("VechileIdentificationNumber")) or _text(data.get("Vin")),
        license_plate=plate,
        raw=data,
        fuel_type=extra.get("fuel_type"),
        engine_size=extra.get("engine_size"),
        power_kw=extra.get("power_kw"),
        doors=_int(data.get("NumberOfDoors")),
        image_url=_text(data.get("ImageUrl")),
    )


def parse_response(plate: str, body: bytes) -> ProviderVehicle | None:
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        raise PlateLookupError("Invalid response from plate lookup service") from exc
    for element in root.iter():
        if element.tag.split("}")[-1] == "vehicleJson" and element.text and element.text.strip():
            try:
                return parse_vehicle(plate, json.loads(element.text))
            except json.JSONDecodeError as exc:
                raise PlateLookupError("Invalid vehicle data from plate lookup service") from exc
    return None


class TargaVehicleDataProvider(VehicleDataProvider):
    name = PROVIDER_NAME

    def __init__(self, username: str, url: str, timeout: float = 15):
        self.username = username
        self.url = url
        self.timeout = timeout

    def find_by_vin(self, vin: str) -> ProviderVehicle | None:
        return None

    def find_by_plate(self, license_plate: str, country: str = "IT") -> ProviderVehicle | None:
        query = urllib.parse.urlencode({"RegistrationNumber": license_plate, "username": self.username})
        request = urllib.request.Request(f"{self.url}?{query}", headers={"Accept": "text/xml"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:500]
            # ASMX returns 500 with the exception text: "No vehicle found" for unknown plates.
            reason = classify_error(detail)
            if reason is None:
                return None
            # Keep the provider's own words in the logs: the UI only gets a short reason.
            logger.warning("targa.co.it lookup failed (HTTP %s, %s): %s", exc.code, reason, " ".join(detail.split())[:300])
            raise PlateLookupError(f"Plate lookup service error ({exc.code})", reason) from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            logger.warning("targa.co.it not reachable: %s", exc)
            raise PlateLookupError("Plate lookup service not reachable", "unreachable") from exc
        return parse_response(license_plate, body)


def get_vehicle_data_provider():
    """The configured plate provider, or None when no account is set."""
    from app.core.config import get_settings

    settings = get_settings()
    if not settings.targa_api_username:
        return None
    return TargaVehicleDataProvider(
        username=settings.targa_api_username,
        url=settings.targa_api_url,
        timeout=settings.targa_api_timeout_seconds,
    )
