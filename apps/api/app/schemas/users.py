from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator, ConfigDict

from app.models.identity import UserStatus


class UserCreate(BaseModel):
    email: EmailStr
    # Left out: the app makes a temporary password, shown once to share with the worker, who replaces it at the first login.
    password: str | None = Field(default=None, min_length=10)
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    role_code: str

    @field_validator("first_name", "last_name", "role_code", mode="before")
    @classmethod
    def trim_profile_fields(cls, value):
        return value.strip() if isinstance(value, str) else value


class UserRead(BaseModel):
    id: UUID
    email: EmailStr
    first_name: str
    last_name: str
    status: UserStatus
    role_codes: list[str]
    # BODY / MECHANICAL / None (both): what the worker sees in the workshop.
    work_area: str | None = None
    # Still on the temporary password: has not entered the app yet.
    must_change_password: bool = False
    # Only in the answer that creates it (account created or access shared again), never stored in clear.
    temporary_password: str | None = None


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    role_code: str = Field(min_length=1, max_length=64)
    password: str | None = Field(default=None, min_length=10)

    @field_validator("first_name", "last_name", "role_code", mode="before")
    @classmethod
    def trim_profile_fields(cls, value):
        return value.strip() if isinstance(value, str) else value
