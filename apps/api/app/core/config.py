import logging
import os
from functools import lru_cache

from pydantic import BaseModel, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatevTenantConfig(BaseModel):
    # Indexed by the authenticated local tenant UUID; never a shared fallback key.
    base_url: str | None = None
    token_url: str = "https://login.datev.it/connect/token"
    client_id: str | None = None
    client_secret: SecretStr | None = None
    authorization_key: SecretStr | None = None
    scope: str | None = None
    client_credentials_confirmed: bool = False
    payment_method_id: str | None = None
    payment_type_id: str | None = None
    vat_codes: dict[str, str] = Field(default_factory=dict)


class Settings(BaseSettings):
    datev_tenants: dict[str, DatevTenantConfig] = Field(default_factory=dict)

    app_env: str = "local"
    database_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    bootstrap_token: str | None = None
    # Key for third-party secrets saved in Configurazione → Integrazioni. Empty = derived from jwt_secret
    # (the old behaviour); once set, secrets saved before are still read with the old key.
    integrations_key: str | None = None
    # Test copies (PR environments, local preview) run without paid/external services unless this is true.
    preview_external_services: bool = False

    s3_endpoint: str | None = None
    s3_region: str | None = None
    s3_bucket: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_signed_url_ttl_seconds: int = 900

    # Plate lookup (targa.co.it / RegCheck). Leave the username empty to disable it.
    targa_api_username: str | None = None
    targa_api_url: str = "https://www.regcheck.org.uk/api/reg.asmx/CheckItaly"
    targa_api_timeout_seconds: float = 15
    plate_lookup_monthly_limit: int = 300
    plate_lookup_cache_days: int = 365

    # Realistic vehicle renders (carimage.dev). Empty key = generic diagram only.
    car_image_api_key: str | None = None
    car_image_api_url: str = "https://carimage.dev/api/v1/images/car"
    car_image_timeout_seconds: float = 30
    car_image_monthly_limit: int = 500

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


WEAK_JWT_SECRETS = {"change-me", "x", "secret", "ci-only-secret-not-for-production", "solo-para-pruebas-en-local"}
logger = logging.getLogger("nakama.config")


def is_production(settings: "Settings") -> bool:
    return settings.app_env == "production" or os.environ.get("RAILWAY_ENVIRONMENT_NAME") == "production"


def is_test_copy(settings: "Settings") -> bool:
    """APP_ENV=preview, or any Railway environment other than production (PR environments)."""
    if settings.app_env == "preview":
        return True
    railway_environment = os.environ.get("RAILWAY_ENVIRONMENT_NAME")
    return bool(railway_environment) and railway_environment != "production"


def strip_external_services(settings: "Settings") -> None:
    """A test copy is public and has a published demo login: it must not spend the real keys."""
    settings.targa_api_username = None
    settings.car_image_api_key = None
    settings.s3_bucket = settings.s3_access_key_id = settings.s3_secret_access_key = None
    settings.datev_tenants = {}


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if is_test_copy(settings) and not settings.preview_external_services:
        strip_external_services(settings)
    if is_production(settings) and (len(settings.jwt_secret) < 32 or settings.jwt_secret in WEAK_JWT_SECRETS):
        logger.warning("JWT_SECRET is weak (under 32 characters or a sample value): set a long random value.")
    return settings
