"""HTTP routes for the prototype ticket-booking feature."""

import logging
import os
from datetime import date

from fastapi import APIRouter, Header, HTTPException, Query, Request

from booking_models import BookingCreate, PaymentIn
from security import RateLimiter
from services import booking_catalog as catalog
from services.booking_service import BookingError, BookingService
from services.booking_store import BookingStore

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Booking (prototype)"])
booking_limiter = RateLimiter(max_requests=40, window_seconds=60)

_service: BookingService | None = None


def default_db_path() -> str:
    """Where bookings live. Vercel's filesystem is read-only except /tmp (and per-instance)."""
    if os.getenv("BOOKING_DB_PATH"):
        return os.environ["BOOKING_DB_PATH"]
    return "/tmp/travi_bookings.db" if os.getenv("VERCEL") else "data/bookings.db"


def get_service() -> BookingService:
    """Lazily build the service so the DB path can be set by environment or tests."""
    global _service
    if _service is None:
        _service = BookingService(BookingStore(default_db_path()))
    return _service


def set_service(service: BookingService | None) -> None:
    """Swap the service (used by tests)."""
    global _service
    _service = service


def _guard(request: Request) -> BookingService:
    client = request.client.host if request.client else "unknown"
    if not booking_limiter.is_allowed(client):
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")
    return get_service()


def _run(fn, *args):
    try:
        return fn(*args)
    except BookingError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("/api/booking/locations")
async def locations(q: str = Query("", max_length=60)):
    """Autocomplete for cities supported by the prototype catalog."""
    return {"locations": catalog.search_locations(q)}


@router.get("/api/booking/search")
def search(
    request: Request,
    origin: str = Query(..., min_length=2, max_length=80),
    destination: str = Query(..., min_length=2, max_length=80),
    date: date = Query(...),
    passengers: int = Query(1, ge=1, le=9),
    mode: str | None = Query(None, max_length=10),
):
    """Search sample bus, train and air options for a route and date."""
    service = _guard(request)
    return _run(service.search, origin, destination, date, mode, passengers)


@router.post("/api/bookings", status_code=201)
def create_booking(request: Request, payload: BookingCreate):
    """Create a booking and hold the seats for 10 minutes pending payment."""
    return _run(_guard(request).create, payload)


@router.get("/api/bookings")
def list_bookings(request: Request, x_contact_email: str | None = Header(None)):
    """List bookings made with the contact email in the X-Contact-Email header."""
    return {"bookings": _run(_guard(request).list_for_email, x_contact_email)}


@router.get("/api/bookings/{pnr}")
def get_booking(request: Request, pnr: str, x_contact_email: str | None = Header(None)):
    return _run(_guard(request).get, pnr, x_contact_email)


@router.post("/api/bookings/{pnr}/pay")
def pay_booking(request: Request, pnr: str, payment: PaymentIn, x_contact_email: str | None = Header(None)):
    """Simulated payment. Confirms the booking and assigns seats on success."""
    return _run(_guard(request).pay, pnr, x_contact_email, payment)


@router.post("/api/bookings/{pnr}/cancel")
def cancel_booking(request: Request, pnr: str, x_contact_email: str | None = Header(None)):
    """Cancel a booking and compute the refund per the cancellation policy."""
    return _run(_guard(request).cancel, pnr, x_contact_email)
