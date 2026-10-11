"""Pydantic request models for the ticket-booking API (prototype)."""

import re
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator

_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
_PHONE_RE = re.compile(r"^\+?[0-9 \-]{7,18}$")
_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z .'\-]{1,79}$")
_ID_RE = re.compile(r"^[A-Za-z0-9\-]{4,20}$")


class Gender(str, Enum):
    male = "M"
    female = "F"
    other = "O"


class IdType(str, Enum):
    passport = "passport"
    aadhaar = "aadhaar"
    pan = "pan"
    driving_license = "driving_license"
    voter_id = "voter_id"
    national_id = "national_id"


class PaymentMethod(str, Enum):
    upi = "upi"
    card = "card"
    netbanking = "netbanking"
    wallet = "wallet"


class PaymentScenario(str, Enum):
    """Prototype-only switch for exercising the payment outcomes."""

    success = "success"
    decline = "decline"
    timeout = "timeout"


class PassengerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    age: int = Field(ge=0, le=120)
    gender: Gender
    id_type: IdType | None = None
    id_number: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not _NAME_RE.match(v):
            raise ValueError("Name must be 2-80 letters (spaces, . ' - allowed)")
        return v

    @field_validator("id_number")
    @classmethod
    def _id_number(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        v = v.strip()
        if not _ID_RE.match(v):
            raise ValueError("ID number must be 4-20 letters, digits or dashes")
        return v.upper()


class BookingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    option_id: str = Field(min_length=10, max_length=80)
    travel_class: str = Field(min_length=2, max_length=40)
    passengers: list[PassengerIn] = Field(min_length=1, max_length=9)
    contact_email: str
    contact_phone: str | None = None
    user_id: str | None = Field(default=None, max_length=128)

    @field_validator("contact_email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("contact_phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        if v is None or v.strip() == "":
            return None
        v = v.strip()
        if not _PHONE_RE.match(v):
            raise ValueError("Enter a valid phone number")
        return v


class PaymentIn(BaseModel):
    """Simulated payment. ``extra=forbid`` so card numbers can never be submitted here."""

    model_config = ConfigDict(extra="forbid")

    method: PaymentMethod
    test_scenario: PaymentScenario = PaymentScenario.success
