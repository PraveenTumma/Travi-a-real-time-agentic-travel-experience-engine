"""Booking business logic: search, pricing, validation, payment and cancellation.

Prototype notes:
- Times are treated as one clock (naive UTC) for hold expiry and refund windows;
  departure times shown to users are the origin's local time and not converted.
- Payment is simulated. No card data is accepted or stored.
- Ownership is proven by the booking's contact email (``X-Contact-Email`` header).
  Real auth (Firebase ID tokens) is a planned follow-up.
"""

from __future__ import annotations

import secrets
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable

from booking_models import BookingCreate, PaymentIn, PaymentScenario
from services import booking_catalog as catalog
from services.booking_store import BookingStore

HOLD_MINUTES = 10
MAX_PAYMENT_ATTEMPTS = 3
MAX_PASSENGERS = 9

TAX_RATE = {"air": Decimal("0.12"), "train": Decimal("0.05"), "bus": Decimal("0.05")}
FEE_RATE = Decimal("0.015")
MIN_FEE = {"INR": Decimal("20"), "USD": Decimal("0.50")}
CHILD_FACTOR = Decimal("0.75")
INFANT_AIR_FACTOR = Decimal("0.10")

# (hours before departure, refundable share of fare+tax). Convenience fee is never refunded.
REFUND_TIERS = ((48, Decimal("0.90")), (24, Decimal("0.75")), (4, Decimal("0.50")))

_PNR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class BookingError(Exception):
    """Domain error carrying the HTTP status the API should return."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _round(value: Decimal, currency: str) -> Decimal:
    return value.quantize(Decimal("1") if currency == "INR" else Decimal("0.01"), rounding=ROUND_HALF_UP)


def passenger_category(age: int) -> str:
    return "infant" if age < 2 else "child" if age < 12 else "adult"


def seat_label(mode: str, travel_class: str, index: int) -> str:
    """Human-readable seat/berth label for the Nth seat in a class."""
    if mode == "air":
        premium = {"Business": 0, "Premium Economy": 8, "Economy": 14}.get(travel_class, 14)
        return f"{premium + index // 6 + 1}{'ABCDEF'[index % 6]}"
    if mode == "train":
        code = "".join(c for c in travel_class.split("(")[-1] if c.isalnum()) if "(" in travel_class else travel_class[:1].upper()
        n = index % 72 + 1
        berth = ("Lower", "Middle", "Upper", "Lower", "Middle", "Upper", "Side Lower", "Side Upper")[(n - 1) % 8]
        return f"{code}{index // 72 + 1}-{n} {berth}"
    prefix = {"Seater": "S", "Sleeper": "L", "AC Sleeper": "A"}.get(travel_class, "S")
    return f"{prefix}{index + 1}"


def quote(option: catalog.TransportOption, travel_class: str, ages: list[int]) -> dict:
    """Price a group. Infants sit on a lap (no seat); children pay 75%."""
    fare = Decimal(option.classes[travel_class]["fare"])
    currency = option.currency
    lines, subtotal = [], Decimal("0")
    for age in ages:
        cat = passenger_category(age)
        if cat == "adult":
            factor = Decimal("1")
        elif cat == "child":
            factor = CHILD_FACTOR
        else:
            factor = INFANT_AIR_FACTOR if option.mode == "air" else Decimal("0")
        price = _round(fare * factor, currency)
        lines.append({"category": cat, "fare": str(price)})
        subtotal += price
    taxes = _round(subtotal * TAX_RATE[option.mode], currency)
    fee = _round(max(subtotal * FEE_RATE, MIN_FEE[currency]), currency)
    return {
        "currency": currency,
        "lines": lines,
        "subtotal": str(subtotal),
        "taxes": str(taxes),
        "fee": str(fee),
        "total": str(subtotal + taxes + fee),
    }


def refund_for(booking: dict, now: datetime) -> Decimal:
    """Refund amount if this booking were cancelled now."""
    if booking["status"] != "CONFIRMED":
        return Decimal("0")
    departure = datetime.fromisoformat(booking["option"]["departure"])
    hours = (departure - now).total_seconds() / 3600
    share = next((s for limit, s in REFUND_TIERS if hours >= limit), Decimal("0"))
    refundable = Decimal(booking["subtotal"]) + Decimal(booking["taxes"])
    return _round(refundable * share, booking["currency"])


class BookingService:
    def __init__(self, store: BookingStore, clock: Callable[[], datetime] = _utcnow,
                 geocoder: Callable[[str], catalog.Location | None] | None = None):
        self.store = store
        self.clock = clock
        self.geocoder = geocoder  # optional fallback for places outside the curated catalog

    def _resolve(self, text: str, role: str) -> catalog.Location:
        """Resolve a picked suggestion (code or geo: token) or free text to a Location."""
        text = (text or "").strip()
        if text.startswith(catalog.PLACE_PREFIX):
            loc = catalog.decode_place(text)
            if loc is None:
                raise BookingError(400, f"Invalid {role} reference. Pick a place from the suggestions.")
            return loc
        loc = catalog.resolve_location(text)
        if loc is None and self.geocoder is not None:
            loc = self.geocoder(text)
        if loc is None:
            raise BookingError(404, f"Couldn't find {role} '{text}'. Pick a place from the suggestions.")
        return loc

    # ---- search ----

    def search(self, origin_text: str, dest_text: str, travel_date: date, mode: str | None,
               passengers: int) -> dict:
        now = self.clock()
        origin = self._resolve(origin_text, "origin")
        dest = self._resolve(dest_text, "destination")
        if origin.code == dest.code:
            raise BookingError(400, "Origin and destination must be different")
        if not catalog.available_modes(origin, dest):
            raise BookingError(400, f"{origin.name} and {dest.name} are too close for a booking. Try a farther destination.")
        if mode and mode not in catalog.MODES:
            raise BookingError(400, "mode must be one of air, train, bus")
        if travel_date < now.date():
            raise BookingError(400, "Travel date cannot be in the past")
        if travel_date > now.date() + timedelta(days=catalog.MAX_ADVANCE_DAYS):
            raise BookingError(400, f"Bookings open up to {catalog.MAX_ADVANCE_DAYS} days ahead")
        if not 1 <= passengers <= MAX_PASSENGERS:
            raise BookingError(400, f"passengers must be between 1 and {MAX_PASSENGERS}")

        options = catalog.search_options(origin, dest, travel_date, mode, today=now.date())
        results = []
        for opt in options:
            if opt.departure <= now:
                continue  # already departed today
            data = opt.to_dict()
            for name, info in data["classes"].items():
                taken = self.store.seats_taken(opt.option_id, name, now)
                info["seats_available"] = max(0, info["seats_total"] - taken)
                info["bookable"] = info["seats_available"] >= passengers
                del info["seats_total"]
            results.append(data)
        return {
            "origin": catalog._loc_dict(origin),
            "destination": catalog._loc_dict(dest),
            "date": travel_date.isoformat(),
            "available_modes": catalog.available_modes(origin, dest),
            "results": results,
            "prototype": True,
        }

    # ---- create ----

    def _validate_passengers(self, option: catalog.TransportOption, payload: BookingCreate) -> None:
        passengers = payload.passengers
        adults = sum(1 for p in passengers if p.age >= 12)
        infants = sum(1 for p in passengers if p.age < 2)
        if adults < 1:
            raise BookingError(422, "At least one traveller must be 12 or older")
        if infants > adults:
            raise BookingError(422, "Each infant needs an accompanying adult (max one infant per adult)")
        if option.mode == "bus":
            return
        international_air = option.mode == "air" and option.is_international
        for p in passengers:
            if p.age < 2:
                continue
            if international_air:
                if p.id_type is None or p.id_type.value != "passport" or not p.id_number:
                    raise BookingError(422, f"Passport details are required for {p.name} on international flights")
            elif p.age >= 18 and (p.id_type is None or not p.id_number):
                raise BookingError(422, f"ID details are required for {p.name} (age 18+)")

    def create(self, payload: BookingCreate) -> dict:
        now = self.clock()
        option = catalog.get_option(payload.option_id, today=now.date())
        if option is None:
            raise BookingError(404, "That option does not exist")
        if option.departure <= now:
            raise BookingError(409, "That service has already departed")
        if payload.travel_class not in option.classes:
            raise BookingError(422, f"Invalid class. Choose one of: {', '.join(option.classes)}")
        self._validate_passengers(option, payload)

        ages = [p.age for p in payload.passengers]
        priced = quote(option, payload.travel_class, ages)
        seat_count = sum(1 for a in ages if a >= 2)
        pnr = "TRV" + "".join(secrets.choice(_PNR_ALPHABET) for _ in range(7))
        record = {
            "pnr": pnr,
            "user_id": payload.user_id,
            "contact_email": payload.contact_email,
            "contact_phone": payload.contact_phone,
            "option_id": option.option_id,
            "mode": option.mode,
            "travel_class": payload.travel_class,
            "seat_count": seat_count,
            "passengers": [p.model_dump(mode="json") for p in payload.passengers],
            "option": option.to_dict(),
            "currency": priced["currency"],
            "subtotal": priced["subtotal"],
            "taxes": priced["taxes"],
            "fee": priced["fee"],
            "total": priced["total"],
            "created_at": now.isoformat(timespec="seconds"),
            "hold_expires_at": (now + timedelta(minutes=HOLD_MINUTES)).isoformat(timespec="seconds"),
        }
        capacity = option.classes[payload.travel_class]["seats_total"]
        if not self.store.create_pending(record, capacity, now):
            raise BookingError(409, "Not enough seats left in that class. Pick another class or service.")
        return self._view(self.store.get(pnr), priced)

    # ---- access ----

    def _owned(self, pnr: str, email: str | None) -> dict:
        booking = self.store.get(pnr.upper())
        if not booking or not email or booking["contact_email"] != email.strip().lower():
            raise BookingError(404, "Booking not found")
        return booking

    def _lapse_hold(self, booking: dict, now: datetime) -> dict:
        """Mark an unpaid booking expired once its seat hold runs out."""
        if booking["status"] == "PENDING_PAYMENT" and datetime.fromisoformat(booking["hold_expires_at"]) <= now:
            self.store.expire(booking["pnr"])
            return self.store.get(booking["pnr"])
        return booking

    def get(self, pnr: str, email: str | None) -> dict:
        booking = self._lapse_hold(self._owned(pnr, email), self.clock())
        return self._view(booking)

    def list_for_email(self, email: str | None) -> list[dict]:
        if not email:
            raise BookingError(400, "Contact email is required")
        now = self.clock()
        return [self._view(self._lapse_hold(b, now)) for b in self.store.list_by_email(email.strip().lower())]

    # ---- payment ----

    def pay(self, pnr: str, email: str | None, payment: PaymentIn) -> dict:
        now = self.clock()
        booking = self._lapse_hold(self._owned(pnr, email), now)
        if booking["status"] == "CONFIRMED":
            raise BookingError(409, "This booking is already paid and confirmed")
        if booking["status"] != "PENDING_PAYMENT":
            raise BookingError(409, f"Booking is {booking['status'].replace('_', ' ').lower()} and cannot be paid")

        method = payment.method.value
        if payment.test_scenario is PaymentScenario.timeout:
            return {**self._view(booking), "payment": {"outcome": "timeout",
                    "message": "Payment gateway timed out. You have not been charged. Please retry."}}
        if payment.test_scenario is PaymentScenario.decline:
            updated = self.store.record_failed_payment(pnr.upper(), method, MAX_PAYMENT_ATTEMPTS)
            left = MAX_PAYMENT_ATTEMPTS - updated["payment_attempts"]
            message = ("Payment declined. The booking was cancelled and your seats released."
                       if left <= 0 else f"Payment declined. {left} attempt(s) left.")
            return {**self._view(updated), "payment": {"outcome": "declined", "message": message}}

        option = catalog.get_option(booking["option_id"], today=now.date())
        capacity = option.classes[booking["travel_class"]]["seats_total"]
        ref = "PAY" + secrets.token_hex(5).upper()
        mode, cls = booking["mode"], booking["travel_class"]
        confirmed = self.store.confirm(pnr.upper(), capacity, now, ref, method, lambda i: seat_label(mode, cls, i))
        if confirmed is None:
            raise BookingError(409, "Seats are no longer available. You have not been charged.")
        return {**self._view(confirmed), "payment": {"outcome": "success", "reference": ref,
                "message": "Payment received. Your booking is confirmed."}}

    # ---- cancel ----

    def cancel(self, pnr: str, email: str | None) -> dict:
        now = self.clock()
        booking = self._lapse_hold(self._owned(pnr, email), now)
        if booking["status"] not in ("CONFIRMED", "PENDING_PAYMENT"):
            raise BookingError(409, f"Booking is already {booking['status'].replace('_', ' ').lower()}")
        if datetime.fromisoformat(booking["option"]["departure"]) <= now:
            raise BookingError(409, "This service has already departed and cannot be cancelled")
        refund = refund_for(booking, now)
        return self._view(self.store.cancel(pnr.upper(), str(refund), now))

    # ---- presentation ----

    def _view(self, booking: dict, priced: dict | None = None) -> dict:
        """Shape a stored booking for the API (never exposes payment internals)."""
        now = self.clock()
        view = {
            "pnr": booking["pnr"],
            "status": booking["status"],
            "mode": booking["mode"],
            "travel_class": booking["travel_class"],
            "contact_email": booking["contact_email"],
            "contact_phone": booking["contact_phone"],
            "service": booking["option"],
            "passengers": booking["passengers"],
            "seats": booking["seats"],
            "pricing": {
                "currency": booking["currency"],
                "subtotal": booking["subtotal"],
                "taxes": booking["taxes"],
                "fee": booking["fee"],
                "total": booking["total"],
                "lines": priced["lines"] if priced else None,
            },
            "payment_reference": booking["payment_ref"],
            "payment_method": booking["payment_method"],
            "payment_attempts": booking["payment_attempts"],
            "created_at": booking["created_at"],
            "hold_expires_at": booking["hold_expires_at"] if booking["status"] == "PENDING_PAYMENT" else None,
            "confirmed_at": booking["confirmed_at"],
            "cancelled_at": booking["cancelled_at"],
            "refund_amount": booking["refund_amount"],
            "prototype": True,
        }
        if booking["status"] == "CONFIRMED":
            departure = datetime.fromisoformat(booking["option"]["departure"])
            view["cancellable"] = departure > now
            view["refund_if_cancelled_now"] = str(refund_for(booking, now))
        else:
            view["cancellable"] = booking["status"] == "PENDING_PAYMENT"
        return view
