"""Tests for the prototype ticket-booking feature.

Covers the catalog generator, pricing, booking rules (validation, holds, payment,
cancellation/refunds, seat assignment, overbooking), concurrency, and the HTTP API.
A controllable clock keeps every time-dependent rule deterministic.
"""

import os
import sys
import threading
from datetime import date, datetime, timedelta
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("GROQ_API_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

import booking_api
from booking_models import BookingCreate, PaymentIn
from services import booking_catalog as cat
from services.booking_service import (
    BookingError,
    BookingService,
    passenger_category,
    quote,
    refund_for,
    seat_label,
)
from services.booking_store import BookingStore

NOW = datetime(2026, 10, 11, 8, 0, 0)
TRAVEL = date(2026, 11, 15)
EMAIL = "traveller@example.com"


class Clock:
    def __init__(self, now=NOW):
        self.now = now

    def __call__(self):
        return self.now


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def service(clock):
    return BookingService(BookingStore(":memory:"), clock=clock)


def pax(name="Asha Rao", age=30, **kw):
    base = {"name": name, "age": age, "gender": "F", "id_type": "aadhaar", "id_number": "123412341234"}
    base.update(kw)
    return base


def passport(name="Asha Rao", age=30):
    return pax(name, age, id_type="passport", id_number="N1234567")


def payload(option_id, travel_class, passengers, email=EMAIL, **kw):
    return BookingCreate(option_id=option_id, travel_class=travel_class, passengers=passengers,
                         contact_email=email, **kw)


def first_option(origin, dest, mode, travel_date=TRAVEL):
    o, d = cat.resolve_location(origin), cat.resolve_location(dest)
    return cat.search_options(o, d, travel_date, mode, today=NOW.date())[0]


def book(service, option, cls=None, passengers=None, email=EMAIL):
    cls = cls or next(iter(option.classes))
    return service.create(payload(option.option_id, cls, passengers or [pax()], email=email))


def pay_ok(service, pnr, email=EMAIL):
    return service.pay(pnr, email, PaymentIn(method="upi"))


# --------------------------------------------------------------------------------------
# Catalog
# --------------------------------------------------------------------------------------

class TestCatalog:
    @pytest.mark.parametrize("text,code", [
        ("Delhi", "DEL"), ("delhi", "DEL"), ("BOM", "BOM"), ("bom", "BOM"),
        ("Tokyo, Japan", "NRT"), ("Bangalore", "BLR"), ("  Paris  ", "CDG"),
        ("New York, USA", "JFK"),
    ])
    def test_resolve_location(self, text, code):
        assert cat.resolve_location(text).code == code

    @pytest.mark.parametrize("text", ["", "Atlantis", "   ", "zz"])
    def test_resolve_unknown(self, text):
        assert cat.resolve_location(text) is None

    def test_search_locations_prefix_and_default(self):
        names = [r["name"] for r in cat.search_locations("del")]
        assert names[0] == "Delhi"
        assert len(cat.search_locations("")) == 8
        assert cat.search_locations("zzzz") == []

    @pytest.mark.parametrize("a,b,expected", [
        ("DEL", "BOM", {"air", "train", "bus"}),
        ("DEL", "BLR", {"air", "train"}),          # too far for bus
        ("DEL", "DXB", {"air"}),                   # international, no ground link
        ("JFK", "LHR", {"air"}),
        ("LHR", "CDG", {"air", "train", "bus"}),   # cross-border link
        ("NRT", "KIX", {"air", "train", "bus"}),   # Japan rail
        ("SIN", "BKK", {"air"}),
    ])
    def test_available_modes(self, a, b, expected):
        assert set(cat.available_modes(cat.resolve_location(a), cat.resolve_location(b))) == expected

    def test_same_location_has_no_modes(self):
        d = cat.resolve_location("DEL")
        assert cat.available_modes(d, d) == []

    def test_search_is_deterministic(self):
        o, d = cat.resolve_location("DEL"), cat.resolve_location("BOM")
        a = [x.to_dict() for x in cat.search_options(o, d, TRAVEL, today=NOW.date())]
        b = [x.to_dict() for x in cat.search_options(o, d, TRAVEL, today=NOW.date())]
        assert a == b and len(a) == 14  # 5 air + 4 train + 5 bus

    def test_different_dates_give_different_results(self):
        o, d = cat.resolve_location("DEL"), cat.resolve_location("BOM")
        a = [x.departure.time() for x in cat.search_options(o, d, TRAVEL, "air", today=NOW.date())]
        b = [x.departure.time() for x in cat.search_options(o, d, TRAVEL + timedelta(days=1), "air", today=NOW.date())]
        assert a != b

    def test_options_sorted_and_consistent(self):
        o, d = cat.resolve_location("DEL"), cat.resolve_location("BOM")
        opts = cat.search_options(o, d, TRAVEL, today=NOW.date())
        assert [x.departure for x in opts] == sorted(x.departure for x in opts)
        for opt in opts:
            assert opt.arrival > opt.departure
            assert (opt.arrival - opt.departure) == timedelta(minutes=opt.duration_minutes)
            assert opt.departure.date() == TRAVEL
            assert all(Decimal(c["fare"]) > 0 and c["seats_total"] > 0 for c in opt.classes.values())

    def test_air_faster_than_bus(self):
        o, d = cat.resolve_location("DEL"), cat.resolve_location("BOM")
        air = cat.search_options(o, d, TRAVEL, "air", today=NOW.date())[0]
        bus = cat.search_options(o, d, TRAVEL, "bus", today=NOW.date())[0]
        assert air.duration_minutes < bus.duration_minutes

    def test_currency_by_region(self):
        assert first_option("DEL", "BOM", "air").currency == "INR"
        assert first_option("DEL", "DXB", "air").currency == "USD"
        assert first_option("LHR", "CDG", "train").currency == "USD"

    def test_international_flag(self):
        assert first_option("DEL", "DXB", "air").is_international is True
        assert first_option("DEL", "BOM", "air").is_international is False

    def test_class_tiers_by_mode_and_region(self):
        assert set(first_option("DEL", "BOM", "train").classes) == set(cat.TRAIN_CLASSES_IN)
        assert set(first_option("LHR", "CDG", "train").classes) == set(cat.TRAIN_CLASSES_INTL)
        assert set(first_option("DEL", "BOM", "bus").classes) == set(cat.BUS_CLASSES_IN)
        assert set(first_option("DEL", "BOM", "air").classes) == set(cat.AIR_CLASSES)

    def test_higher_classes_cost_more(self):
        fares = [Decimal(c["fare"]) for c in first_option("DEL", "BOM", "train").classes.values()]
        assert fares == sorted(fares) and len(set(fares)) == len(fares)

    def test_last_minute_pricing_is_higher(self):
        today = NOW.date()
        assert cat._demand_multiplier(today + timedelta(days=1), today) > cat._demand_multiplier(today + timedelta(days=30), today)
        assert cat._demand_multiplier(today + timedelta(days=90), today) < 1

    def test_option_id_roundtrip(self):
        opt = first_option("DEL", "BOM", "bus")
        again = cat.get_option(opt.option_id, today=NOW.date())
        assert again.to_dict() == opt.to_dict()

    @pytest.mark.parametrize("bad", [
        "", "garbage", "air-DEL-BOM-2026-11-15", "air-DEL-BOM-2026-11-15-x",
        "air-XXX-BOM-2026-11-15-0", "boat-DEL-BOM-2026-11-15-0", "train-DEL-DXB-2026-11-15-0",
        "air-DEL-BOM-2026-13-45-0", "air-DEL-BOM-2026-11-15-99",
    ])
    def test_get_option_rejects_bad_ids(self, bad):
        assert cat.get_option(bad, today=NOW.date()) is None

    def test_distance_sane(self):
        assert 1100 < cat.distance_km(cat.resolve_location("DEL"), cat.resolve_location("BOM")) < 1250


# --------------------------------------------------------------------------------------
# Pricing, seat labels, refunds
# --------------------------------------------------------------------------------------

class TestPricing:
    def test_passenger_category(self):
        assert [passenger_category(a) for a in (0, 1, 2, 11, 12, 70)] == \
            ["infant", "infant", "child", "child", "adult", "adult"]

    def test_group_quote_air(self):
        opt = first_option("DEL", "BOM", "air")
        fare = Decimal(opt.classes["Economy"]["fare"])
        q = quote(opt, "Economy", [35, 33, 8, 1])
        lines = {l["category"]: Decimal(l["fare"]) for l in q["lines"]}
        assert lines["adult"] == fare
        assert lines["child"] == (fare * Decimal("0.75")).quantize(Decimal("1"), rounding="ROUND_HALF_UP")
        assert lines["infant"] == (fare * Decimal("0.10")).quantize(Decimal("1"), rounding="ROUND_HALF_UP")
        subtotal = Decimal(q["subtotal"])
        assert subtotal == sum(Decimal(l["fare"]) for l in q["lines"])
        assert Decimal(q["taxes"]) == (subtotal * Decimal("0.12")).quantize(Decimal("1"), rounding="ROUND_HALF_UP")
        assert Decimal(q["total"]) == subtotal + Decimal(q["taxes"]) + Decimal(q["fee"])
        assert q["currency"] == "INR"

    def test_infant_free_on_train_and_bus(self):
        for mode in ("train", "bus"):
            opt = first_option("DEL", "BOM", mode)
            q = quote(opt, next(iter(opt.classes)), [30, 1])
            assert q["lines"][1]["fare"] == "0"

    def test_minimum_convenience_fee(self):
        opt = first_option("LHR", "CDG", "bus")
        q = quote(opt, next(iter(opt.classes)), [1])  # infant only -> subtotal 0
        assert Decimal(q["fee"]) == Decimal("0.50")

    def test_usd_amounts_have_two_decimals(self):
        opt = first_option("DEL", "DXB", "air")
        q = quote(opt, "Economy", [30])
        assert len(q["total"].split(".")[1]) == 2

    def test_seat_labels(self):
        assert seat_label("air", "Economy", 0) == "15A"
        assert seat_label("air", "Economy", 6) == "16A"
        assert seat_label("air", "Business", 5) == "1F"
        assert seat_label("train", "AC 3-Tier (3A)", 0).startswith("3A1-1 Lower")
        assert seat_label("train", "Sleeper (SL)", 72).startswith("SL2-1")
        assert seat_label("bus", "Sleeper", 3) == "L4"
        labels = {seat_label("air", "Economy", i) for i in range(150)}
        assert len(labels) == 150

    @pytest.mark.parametrize("hours,share", [(72, "0.90"), (48, "0.90"), (30, "0.75"), (24, "0.75"),
                                             (10, "0.50"), (4, "0.50"), (3.9, "0"), (-1, "0")])
    def test_refund_tiers(self, hours, share):
        departure = NOW + timedelta(hours=hours)
        booking = {"status": "CONFIRMED", "currency": "INR", "subtotal": "1000", "taxes": "120",
                   "option": {"departure": departure.isoformat()}}
        assert refund_for(booking, NOW) == (Decimal("1120") * Decimal(share)).quantize(Decimal("1"), rounding="ROUND_HALF_UP")

    def test_refund_excludes_fee_and_unpaid(self):
        booking = {"status": "PENDING_PAYMENT", "currency": "INR", "subtotal": "1000", "taxes": "120",
                   "option": {"departure": (NOW + timedelta(days=9)).isoformat()}}
        assert refund_for(booking, NOW) == 0


# --------------------------------------------------------------------------------------
# Search rules
# --------------------------------------------------------------------------------------

class TestSearch:
    def test_search_returns_availability(self, service):
        res = service.search("Delhi", "Mumbai", TRAVEL, None, 2)
        assert res["prototype"] is True
        assert set(res["available_modes"]) == {"air", "train", "bus"}
        assert len(res["results"]) == 14
        info = res["results"][0]["classes"][next(iter(res["results"][0]["classes"]))]
        assert info["seats_available"] > 0 and info["bookable"] is True and "seats_total" not in info

    def test_mode_filter(self, service):
        res = service.search("Delhi", "Mumbai", TRAVEL, "train", 1)
        assert {r["mode"] for r in res["results"]} == {"train"}

    def test_international_search_is_air_only(self, service):
        res = service.search("Delhi", "Dubai", TRAVEL, None, 1)
        assert {r["mode"] for r in res["results"]} == {"air"}
        assert all(r["is_international"] and r["currency"] == "USD" for r in res["results"])

    @pytest.mark.parametrize("args,status", [
        (("Atlantis", "Mumbai", TRAVEL, None, 1), 404),
        (("Delhi", "Atlantis", TRAVEL, None, 1), 404),
        (("Delhi", "DEL", TRAVEL, None, 1), 400),
        (("Delhi", "Mumbai", NOW.date() - timedelta(days=1), None, 1), 400),
        (("Delhi", "Mumbai", NOW.date() + timedelta(days=400), None, 1), 400),
        (("Delhi", "Mumbai", TRAVEL, "boat", 1), 400),
        (("Delhi", "Mumbai", TRAVEL, None, 0), 400),
        (("Delhi", "Mumbai", TRAVEL, None, 10), 400),
    ])
    def test_invalid_searches(self, service, args, status):
        with pytest.raises(BookingError) as err:
            service.search(*args)
        assert err.value.status_code == status

    def test_departed_services_hidden_today(self, clock, service):
        clock.now = datetime(2026, 10, 11, 23, 30)
        assert service.search("Delhi", "Mumbai", NOW.date(), None, 1)["results"] == []

    def test_availability_drops_after_booking(self, service):
        opt = first_option("DEL", "BOM", "bus")
        cls = "Seater"
        book(service, opt, cls, [pax(), pax("Ravi Rao", 32)])
        res = service.search("Delhi", "Mumbai", TRAVEL, "bus", 1)
        row = next(r for r in res["results"] if r["option_id"] == opt.option_id)
        assert row["classes"][cls]["seats_available"] == opt.classes[cls]["seats_total"] - 2

    def test_bookable_flag_respects_group_size(self, service):
        opt = first_option("DEL", "BOM", "air")
        cls = list(opt.classes)[-1]  # business: small cabin
        cap = opt.classes[cls]["seats_total"]
        # fill all but 2 seats
        left = cap
        while left > 2:
            n = min(9, left - 2)
            book(service, opt, cls, [pax(f"Pax {chr(65 + i)}", 30) for i in range(n)])
            left -= n
        row = next(r for r in service.search("Delhi", "Mumbai", TRAVEL, "air", 3)["results"]
                   if r["option_id"] == opt.option_id)
        assert row["classes"][cls]["seats_available"] == 2
        assert row["classes"][cls]["bookable"] is False


# --------------------------------------------------------------------------------------
# Creating bookings and passenger rules
# --------------------------------------------------------------------------------------

class TestCreate:
    def test_create_group_booking(self, service):
        opt = first_option("DEL", "BOM", "train")
        cls = "AC 3-Tier (3A)"
        b = book(service, opt, cls, [pax(), pax("Ravi Rao", 34), pax("Mini Rao", 9, id_type=None, id_number=None)])
        assert b["status"] == "PENDING_PAYMENT"
        assert b["pnr"].startswith("TRV") and len(b["pnr"]) == 10
        assert len(b["passengers"]) == 3
        assert b["hold_expires_at"] == (NOW + timedelta(minutes=10)).isoformat(timespec="seconds")
        assert b["pricing"]["currency"] == "INR"
        assert Decimal(b["pricing"]["total"]) > 0
        assert b["seats"] == [] and b["cancellable"] is True

    def test_pnrs_are_unique(self, service):
        opt = first_option("DEL", "BOM", "bus")
        pnrs = {book(service, opt, "Seater")["pnr"] for _ in range(15)}
        assert len(pnrs) == 15

    def test_unknown_option(self, service):
        with pytest.raises(BookingError) as err:
            service.create(payload("air-DEL-BOM-2026-11-15-99", "Economy", [pax()]))
        assert err.value.status_code == 404

    def test_invalid_class(self, service):
        opt = first_option("DEL", "BOM", "air")
        with pytest.raises(BookingError) as err:
            book(service, opt, "Hovercraft")
        assert err.value.status_code == 422

    def test_departed_service_rejected(self, clock, service):
        opt = first_option("DEL", "BOM", "air")
        clock.now = opt.departure + timedelta(minutes=1)
        with pytest.raises(BookingError) as err:
            book(service, opt)
        assert err.value.status_code == 409

    def test_domestic_adult_needs_id(self, service):
        opt = first_option("DEL", "BOM", "air")
        with pytest.raises(BookingError) as err:
            book(service, opt, "Economy", [pax(id_type=None, id_number=None)])
        assert err.value.status_code == 422 and "ID" in err.value.message

    def test_children_domestic_need_no_id(self, service):
        opt = first_option("DEL", "BOM", "air")
        b = book(service, opt, "Economy", [pax(), pax("Kid Rao", 10, id_type=None, id_number=None)])
        assert b["status"] == "PENDING_PAYMENT"

    def test_international_air_requires_passport(self, service):
        opt = first_option("DEL", "DXB", "air")
        with pytest.raises(BookingError) as err:
            book(service, opt, "Economy", [pax()])  # aadhaar not accepted
        assert err.value.status_code == 422 and "Passport" in err.value.message
        assert book(service, opt, "Economy", [passport()])["status"] == "PENDING_PAYMENT"

    def test_international_child_needs_passport(self, service):
        opt = first_option("DEL", "DXB", "air")
        with pytest.raises(BookingError):
            book(service, opt, "Economy", [passport(), pax("Kid Rao", 9, id_type=None, id_number=None)])

    def test_bus_needs_no_id(self, service):
        opt = first_option("DEL", "BOM", "bus")
        assert book(service, opt, "Seater", [pax(id_type=None, id_number=None)])["status"] == "PENDING_PAYMENT"

    def test_international_train_needs_id_for_adults(self, service):
        opt = first_option("LHR", "CDG", "train")
        with pytest.raises(BookingError):
            book(service, opt, "Standard", [pax(id_type=None, id_number=None)])

    def test_needs_an_adult(self, service):
        opt = first_option("DEL", "BOM", "bus")
        with pytest.raises(BookingError) as err:
            book(service, opt, "Seater", [pax("Kid Rao", 9, id_type=None, id_number=None)])
        assert err.value.status_code == 422

    def test_one_infant_per_adult(self, service):
        opt = first_option("DEL", "BOM", "bus")
        babies = [pax(f"Baby {c}", 1, id_type=None, id_number=None) for c in "AB"]
        with pytest.raises(BookingError) as err:
            book(service, opt, "Seater", [pax()] + babies)
        assert "infant" in err.value.message.lower()

    def test_infant_takes_no_seat(self, service):
        opt = first_option("DEL", "BOM", "bus")
        book(service, opt, "Seater", [pax(), pax("Baby Rao", 1, id_type=None, id_number=None)])
        assert service.store.seats_taken(opt.option_id, "Seater", NOW) == 1

    def test_overbooking_prevented(self, service):
        opt = first_option("DEL", "BOM", "air")
        cls = list(opt.classes)[-1]
        cap = opt.classes[cls]["seats_total"]
        left = cap
        while left > 0:
            n = min(9, left)
            book(service, opt, cls, [pax(f"Pax {chr(65 + i)}", 30) for i in range(n)])
            left -= n
        with pytest.raises(BookingError) as err:
            book(service, opt, cls)
        assert err.value.status_code == 409
        assert service.store.seats_taken(opt.option_id, cls, NOW) == cap

    def test_hold_expiry_frees_seats(self, clock, service):
        opt = first_option("DEL", "BOM", "air")
        cls = list(opt.classes)[-1]
        cap = opt.classes[cls]["seats_total"]
        left = cap
        pnrs = []
        while left > 0:
            n = min(9, left)
            pnrs.append(book(service, opt, cls, [pax(f"Pax {chr(65 + i)}", 30) for i in range(n)])["pnr"])
            left -= n
        clock.now = NOW + timedelta(minutes=10, seconds=1)
        assert book(service, opt, cls)["status"] == "PENDING_PAYMENT"  # seats released
        assert service.get(pnrs[0], EMAIL)["status"] == "EXPIRED"

    def test_email_normalised(self, service):
        opt = first_option("DEL", "BOM", "bus")
        b = book(service, opt, "Seater", [pax()], email="  Traveller@Example.COM ")
        assert b["contact_email"] == EMAIL


class TestModelValidation:
    def base(self, **kw):
        data = {"option_id": "bus-DEL-BOM-2026-11-15-0", "travel_class": "Seater",
                "passengers": [pax()], "contact_email": EMAIL}
        data.update(kw)
        return data

    @pytest.mark.parametrize("override", [
        {"contact_email": "not-an-email"},
        {"contact_phone": "abc"},
        {"passengers": []},
        {"passengers": [pax() for _ in range(10)]},
        {"passengers": [pax(name="X")]},
        {"passengers": [pax(name="<script>")]},
        {"passengers": [pax(age=-1)]},
        {"passengers": [pax(age=121)]},
        {"passengers": [pax(gender="X")]},
        {"passengers": [pax(id_number="!!")]},
        {"passengers": [{**pax(), "extra": 1}]},
        {"unexpected": True},
    ])
    def test_rejects_invalid(self, override):
        with pytest.raises(Exception):
            BookingCreate(**self.base(**override))

    def test_accepts_valid_and_normalises(self):
        m = BookingCreate(**self.base(contact_phone="+91 98765-43210",
                                      passengers=[pax(name="  asha   rao ", id_number="ab-1234")]))
        assert m.passengers[0].name == "asha rao"
        assert m.passengers[0].id_number == "AB-1234"

    def test_payment_rejects_card_data(self):
        with pytest.raises(Exception):
            PaymentIn(method="card", card_number="4111111111111111")
        with pytest.raises(Exception):
            PaymentIn(method="cheque")


# --------------------------------------------------------------------------------------
# Payment
# --------------------------------------------------------------------------------------

class TestPayment:
    def test_success_confirms_and_assigns_seats(self, service):
        opt = first_option("DEL", "BOM", "air")
        b = book(service, opt, "Economy", [pax(), pax("Ravi Rao", 34), pax("Baby Rao", 1, id_type=None, id_number=None)])
        paid = pay_ok(service, b["pnr"])
        assert paid["status"] == "CONFIRMED"
        assert paid["payment"]["outcome"] == "success"
        assert paid["payment_reference"].startswith("PAY")
        assert paid["hold_expires_at"] is None
        seats = paid["seats"]
        assert [s["label"] is None for s in seats] == [False, False, True]
        assert len({s["label"] for s in seats if s["label"]}) == 2
        assert paid["cancellable"] is True and "refund_if_cancelled_now" in paid

    def test_group_seated_contiguously(self, service):
        opt = first_option("DEL", "BOM", "air")
        paid = pay_ok(service, book(service, opt, "Economy", [pax(f"Pax {c}", 30) for c in "ABCD"])["pnr"])
        assert [s["label"] for s in paid["seats"]] == ["15A", "15B", "15C", "15D"]

    def test_seats_unique_across_bookings(self, service):
        opt = first_option("DEL", "BOM", "train")
        cls = "Sleeper (SL)"
        labels = []
        for _ in range(4):
            paid = pay_ok(service, book(service, opt, cls, [pax(), pax("Ravi Rao", 30)])["pnr"])
            labels += [s["label"] for s in paid["seats"]]
        assert len(labels) == len(set(labels)) == 8

    def test_cannot_pay_twice(self, service):
        pnr = book(service, first_option("DEL", "BOM", "bus"), "Seater")["pnr"]
        pay_ok(service, pnr)
        with pytest.raises(BookingError) as err:
            pay_ok(service, pnr)
        assert err.value.status_code == 409

    def test_decline_keeps_hold_then_fails_after_three(self, service):
        opt = first_option("DEL", "BOM", "bus")
        pnr = book(service, opt, "Seater")["pnr"]
        decline = PaymentIn(method="card", test_scenario="decline")
        r1 = service.pay(pnr, EMAIL, decline)
        assert r1["status"] == "PENDING_PAYMENT" and r1["payment"]["outcome"] == "declined"
        assert "2 attempt" in r1["payment"]["message"]
        service.pay(pnr, EMAIL, decline)
        r3 = service.pay(pnr, EMAIL, decline)
        assert r3["status"] == "PAYMENT_FAILED" and r3["cancellable"] is False
        assert service.store.seats_taken(opt.option_id, "Seater", NOW) == 0
        with pytest.raises(BookingError) as err:
            pay_ok(service, pnr)
        assert err.value.status_code == 409

    def test_success_after_decline(self, service):
        pnr = book(service, first_option("DEL", "BOM", "bus"), "Seater")["pnr"]
        service.pay(pnr, EMAIL, PaymentIn(method="upi", test_scenario="decline"))
        assert pay_ok(service, pnr)["status"] == "CONFIRMED"

    def test_timeout_does_not_charge_or_count(self, service):
        pnr = book(service, first_option("DEL", "BOM", "bus"), "Seater")["pnr"]
        r = service.pay(pnr, EMAIL, PaymentIn(method="wallet", test_scenario="timeout"))
        assert r["status"] == "PENDING_PAYMENT" and r["payment"]["outcome"] == "timeout"
        assert r["payment_attempts"] == 0 and r["payment_reference"] is None

    def test_pay_after_hold_expired(self, clock, service):
        pnr = book(service, first_option("DEL", "BOM", "bus"), "Seater")["pnr"]
        clock.now = NOW + timedelta(minutes=11)
        with pytest.raises(BookingError) as err:
            pay_ok(service, pnr)
        assert err.value.status_code == 409 and "expired" in err.value.message

    def test_payment_requires_owner(self, service):
        pnr = book(service, first_option("DEL", "BOM", "bus"), "Seater")["pnr"]
        for email in (None, "", "other@example.com"):
            with pytest.raises(BookingError) as err:
                pay_ok(service, pnr, email)
            assert err.value.status_code == 404


# --------------------------------------------------------------------------------------
# Cancellation
# --------------------------------------------------------------------------------------

class TestCancel:
    def confirmed(self, service):
        opt = first_option("DEL", "BOM", "air")
        return opt, pay_ok(service, book(service, opt, "Economy", [pax(), pax("Ravi Rao", 34)])["pnr"])

    def test_refund_90_percent_when_far(self, service):
        opt, paid = self.confirmed(service)
        out = service.cancel(paid["pnr"], EMAIL)
        refundable = Decimal(paid["pricing"]["subtotal"]) + Decimal(paid["pricing"]["taxes"])
        assert out["status"] == "CANCELLED"
        assert Decimal(out["refund_amount"]) == (refundable * Decimal("0.9")).quantize(Decimal("1"), rounding="ROUND_HALF_UP")
        assert out["cancelled_at"] and out["cancellable"] is False

    @pytest.mark.parametrize("hours_before,share", [(30, "0.75"), (10, "0.50"), (2, "0")])
    def test_refund_tiers_via_service(self, clock, service, hours_before, share):
        opt, paid = self.confirmed(service)
        clock.now = opt.departure - timedelta(hours=hours_before)
        out = service.cancel(paid["pnr"], EMAIL)
        refundable = Decimal(paid["pricing"]["subtotal"]) + Decimal(paid["pricing"]["taxes"])
        assert Decimal(out["refund_amount"]) == (refundable * Decimal(share)).quantize(Decimal("1"), rounding="ROUND_HALF_UP")

    def test_cancel_frees_seats(self, service):
        opt, paid = self.confirmed(service)
        assert service.store.seats_taken(opt.option_id, "Economy", NOW) == 2
        service.cancel(paid["pnr"], EMAIL)
        assert service.store.seats_taken(opt.option_id, "Economy", NOW) == 0

    def test_cancelled_seat_labels_reusable(self, service):
        opt = first_option("DEL", "BOM", "air")
        a = pay_ok(service, book(service, opt, "Economy")["pnr"])
        service.cancel(a["pnr"], EMAIL)
        b = pay_ok(service, book(service, opt, "Economy")["pnr"])
        assert b["seats"][0]["label"] == a["seats"][0]["label"]

    def test_cancel_pending_gives_no_refund(self, service):
        opt = first_option("DEL", "BOM", "bus")
        b = book(service, opt, "Seater")
        out = service.cancel(b["pnr"], EMAIL)
        assert out["status"] == "CANCELLED" and Decimal(out["refund_amount"]) == 0
        assert service.store.seats_taken(opt.option_id, "Seater", NOW) == 0

    def test_cannot_cancel_twice(self, service):
        _, paid = self.confirmed(service)
        service.cancel(paid["pnr"], EMAIL)
        with pytest.raises(BookingError) as err:
            service.cancel(paid["pnr"], EMAIL)
        assert err.value.status_code == 409

    def test_cannot_cancel_after_departure(self, clock, service):
        opt, paid = self.confirmed(service)
        clock.now = opt.departure + timedelta(minutes=1)
        with pytest.raises(BookingError) as err:
            service.cancel(paid["pnr"], EMAIL)
        assert err.value.status_code == 409
        assert service.get(paid["pnr"], EMAIL)["cancellable"] is False

    def test_cannot_pay_cancelled(self, service):
        b = book(service, first_option("DEL", "BOM", "bus"), "Seater")
        service.cancel(b["pnr"], EMAIL)
        with pytest.raises(BookingError) as err:
            pay_ok(service, b["pnr"])
        assert err.value.status_code == 409

    def test_cancel_requires_owner(self, service):
        _, paid = self.confirmed(service)
        with pytest.raises(BookingError) as err:
            service.cancel(paid["pnr"], "intruder@example.com")
        assert err.value.status_code == 404


# --------------------------------------------------------------------------------------
# Lookup / ownership
# --------------------------------------------------------------------------------------

class TestLookup:
    def test_get_is_case_insensitive_on_pnr_and_email(self, service):
        pnr = book(service, first_option("DEL", "BOM", "bus"), "Seater")["pnr"]
        assert service.get(pnr.lower(), EMAIL.upper())["pnr"] == pnr

    def test_unknown_pnr(self, service):
        with pytest.raises(BookingError) as err:
            service.get("TRVNOPE123", EMAIL)
        assert err.value.status_code == 404

    def test_list_only_own_bookings_newest_first(self, clock, service):
        opt = first_option("DEL", "BOM", "bus")
        first = book(service, opt, "Seater")
        clock.now = NOW + timedelta(minutes=1)
        second = book(service, opt, "Seater")
        book(service, opt, "Seater", email="other@example.com")
        listed = service.list_for_email(EMAIL)
        assert [b["pnr"] for b in listed] == [second["pnr"], first["pnr"]]

    def test_list_requires_email(self, service):
        with pytest.raises(BookingError) as err:
            service.list_for_email(None)
        assert err.value.status_code == 400

    def test_list_marks_lapsed_holds(self, clock, service):
        b = book(service, first_option("DEL", "BOM", "bus"), "Seater")
        clock.now = NOW + timedelta(minutes=30)
        assert service.list_for_email(EMAIL)[0]["status"] == "EXPIRED"
        assert service.get(b["pnr"], EMAIL)["hold_expires_at"] is None


# --------------------------------------------------------------------------------------
# Concurrency (real SQLite file)
# --------------------------------------------------------------------------------------

def test_concurrent_group_bookings_never_oversell(tmp_path):
    clock = Clock()
    service = BookingService(BookingStore(str(tmp_path / "b.db")), clock=clock)
    opt = first_option("DEL", "BOM", "air")
    cls = list(opt.classes)[-1]
    cap = opt.classes[cls]["seats_total"]
    results, lock = [], threading.Lock()

    def attempt(i):
        try:
            b = service.create(payload(opt.option_id, cls, [pax(f"Pax {c}", 30) for c in "ABC"],
                                       email=f"user{i}@example.com"))
            outcome = ("ok", b["pnr"])
        except BookingError as exc:
            outcome = ("err", exc.status_code)
        with lock:
            results.append(outcome)

    threads = [threading.Thread(target=attempt, args=(i,)) for i in range(24)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    ok = [r for r in results if r[0] == "ok"]
    assert len(ok) == cap // 3
    assert all(r[1] == 409 for r in results if r[0] == "err")
    assert service.store.seats_taken(opt.option_id, cls, NOW) <= cap


def test_default_db_path_is_writable_location_on_vercel(monkeypatch):
    monkeypatch.delenv("BOOKING_DB_PATH", raising=False)
    monkeypatch.delenv("VERCEL", raising=False)
    assert booking_api.default_db_path() == "data/bookings.db"
    monkeypatch.setenv("VERCEL", "1")
    assert booking_api.default_db_path() == "/tmp/travi_bookings.db"
    monkeypatch.setenv("BOOKING_DB_PATH", "/custom/b.db")
    assert booking_api.default_db_path() == "/custom/b.db"


def test_bookings_persist_across_store_instances(tmp_path):
    path = str(tmp_path / "persist.db")
    clock = Clock()
    pnr = book(BookingService(BookingStore(path), clock=clock), first_option("DEL", "BOM", "bus"), "Seater")["pnr"]
    again = BookingService(BookingStore(path), clock=clock)
    assert again.get(pnr, EMAIL)["pnr"] == pnr


# --------------------------------------------------------------------------------------
# HTTP API
# --------------------------------------------------------------------------------------

@pytest.fixture
def api(clock):
    from main import app
    booking_api.set_service(BookingService(BookingStore(":memory:"), clock=clock))
    booking_api.booking_limiter._requests.clear()
    yield TestClient(app, raise_server_exceptions=False)
    booking_api.set_service(None)


H = {"X-Contact-Email": EMAIL}


def api_book(api, option_id, cls, passengers):
    return api.post("/api/bookings", json={"option_id": option_id, "travel_class": cls,
                                           "passengers": passengers, "contact_email": EMAIL})


class TestApi:
    def test_locations(self, api):
        r = api.get("/api/booking/locations", params={"q": "mum"})
        assert r.status_code == 200 and r.json()["locations"][0]["code"] == "BOM"

    def test_search_validation_errors(self, api):
        assert api.get("/api/booking/search", params={"origin": "Delhi"}).status_code == 422
        r = api.get("/api/booking/search", params={"origin": "Delhi", "destination": "Nowhere", "date": TRAVEL.isoformat()})
        assert r.status_code == 404 and "find destination" in r.json()["detail"]
        r = api.get("/api/booking/search", params={"origin": "Delhi", "destination": "Mumbai", "date": "2020-01-01"})
        assert r.status_code == 400

    def test_full_journey(self, api):
        search = api.get("/api/booking/search", params={
            "origin": "Delhi", "destination": "Mumbai", "date": TRAVEL.isoformat(), "passengers": 2, "mode": "train"})
        assert search.status_code == 200
        option = search.json()["results"][0]
        cls = next(iter(option["classes"]))

        created = api_book(api, option["option_id"], cls, [pax(), pax("Ravi Rao", 34)])
        assert created.status_code == 201
        pnr = created.json()["pnr"]

        assert api.post(f"/api/bookings/{pnr}/pay", headers=H, json={"method": "upi"}).json()["status"] == "CONFIRMED"
        got = api.get(f"/api/bookings/{pnr}", headers=H)
        assert got.status_code == 200 and len(got.json()["seats"]) == 2
        assert [b["pnr"] for b in api.get("/api/bookings", headers=H).json()["bookings"]] == [pnr]

        cancelled = api.post(f"/api/bookings/{pnr}/cancel", headers=H)
        assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"
        assert api.post(f"/api/bookings/{pnr}/cancel", headers=H).status_code == 409

    def test_booking_requires_email_header(self, api):
        opt = first_option("DEL", "BOM", "bus")
        pnr = api_book(api, opt.option_id, "Seater", [pax()]).json()["pnr"]
        assert api.get(f"/api/bookings/{pnr}").status_code == 404
        assert api.get(f"/api/bookings/{pnr}", headers={"X-Contact-Email": "x@y.com"}).status_code == 404
        assert api.get("/api/bookings").status_code == 400

    def test_create_validation_422(self, api):
        opt = first_option("DEL", "BOM", "bus")
        r = api.post("/api/bookings", json={"option_id": opt.option_id, "travel_class": "Seater",
                                            "passengers": [], "contact_email": EMAIL})
        assert r.status_code == 422
        r = api_book(api, opt.option_id, "Seater", [pax(name="1234")])
        assert r.status_code == 422

    def test_pay_rejects_card_numbers(self, api):
        opt = first_option("DEL", "BOM", "bus")
        pnr = api_book(api, opt.option_id, "Seater", [pax()]).json()["pnr"]
        r = api.post(f"/api/bookings/{pnr}/pay", headers=H, json={"method": "card", "card_number": "4111111111111111"})
        assert r.status_code == 422
        assert "4111" not in r.text

    def test_declined_payment_returns_200_with_outcome(self, api):
        opt = first_option("DEL", "BOM", "bus")
        pnr = api_book(api, opt.option_id, "Seater", [pax()]).json()["pnr"]
        r = api.post(f"/api/bookings/{pnr}/pay", headers=H, json={"method": "upi", "test_scenario": "decline"})
        assert r.status_code == 200 and r.json()["payment"]["outcome"] == "declined"

    def test_sold_out_returns_409(self, api):
        opt = first_option("DEL", "BOM", "air")
        cls = list(opt.classes)[-1]
        cap = opt.classes[cls]["seats_total"]
        left = cap
        while left > 0:
            n = min(9, left)
            assert api_book(api, opt.option_id, cls, [pax(f"Pax {chr(65 + i)}", 30) for i in range(n)]).status_code == 201
            left -= n
        assert api_book(api, opt.option_id, cls, [pax()]).status_code == 409

    def test_rate_limited(self, api):
        booking_api.booking_limiter.max_requests = 3
        try:
            codes = [api.get("/api/booking/search", params={
                "origin": "Delhi", "destination": "Mumbai", "date": TRAVEL.isoformat()}).status_code for _ in range(5)]
        finally:
            booking_api.booking_limiter.max_requests = 40
        assert codes[:3] == [200, 200, 200] and codes[3:] == [429, 429]

    def test_cors_preflight_allows_contact_email_header(self, api):
        r = api.options("/api/bookings", headers={
            "Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-contact-email"})
        assert r.status_code == 200
        assert "x-contact-email" in r.headers["access-control-allow-headers"].lower()

    def test_existing_endpoints_unaffected(self, api):
        assert api.get("/api/health").status_code == 200
