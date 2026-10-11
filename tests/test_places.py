"""Tests for the Origin field backend: place suggestions, free-form places in booking,
and the origin flowing through plan / re-plan.

The geocoder is always replaced with canned data so these tests never touch the network.
"""

import os
import sys
from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("GROQ_API_KEY", "test-key")

import httpx
import pytest
from fastapi.testclient import TestClient

import booking_api
import places_api
from booking_models import BookingCreate, PaymentIn
from config import settings
from services import booking_catalog as cat
from services import llm_service, places_service
from services.booking_service import BookingError, BookingService
from services.booking_store import BookingStore

NOW = datetime(2026, 10, 11, 8, 0, 0)
TRAVEL = date(2026, 11, 15)
EMAIL = "traveller@example.com"

GEO = {
    "ranchi": [
        {"name": "Ranchi", "latitude": 23.3441, "longitude": 85.3096, "country": "India", "country_code": "IN",
         "admin1": "Jharkhand", "feature_code": "PPLA"},
        {"name": "Ranchi", "latitude": 23.3441, "longitude": 85.3096, "country": "India", "country_code": "IN",
         "admin1": "Jharkhand", "feature_code": "PPLA"},  # duplicate listing
    ],
    "san": [
        {"name": "San Francisco", "latitude": 37.7749, "longitude": -122.4194, "country": "United States",
         "country_code": "US", "admin1": "California", "feature_code": "PPLA2"},
        {"name": "San José", "latitude": 9.9281, "longitude": -84.0907, "country": "Costa Rica",
         "country_code": "CR", "admin1": "San José", "feature_code": "PPLC"},
        {"name": "San Marino", "latitude": 43.9424, "longitude": 12.4578, "country": "San Marino",
         "country_code": "SM", "admin1": "", "feature_code": "PCLI"},  # a country: excluded
    ],
    "springfield": [
        {"name": "Springfield", "latitude": 39.8, "longitude": -89.65, "country": "United States",
         "country_code": "US", "admin1": "Illinois", "feature_code": "PPLA2"},
        {"name": "Springfield", "latitude": 42.1, "longitude": -72.59, "country": "United States",
         "country_code": "US", "admin1": "Massachusetts", "feature_code": "PPLA2"},
        {"name": "Springfield", "latitude": 51.7, "longitude": 0.48, "country": "United Kingdom",
         "country_code": "GB", "admin1": "England", "feature_code": "PPL"},
    ],
    "new delhi": [
        {"name": "New Delhi", "latitude": 28.6358, "longitude": 77.2245, "country": "India", "country_code": "IN",
         "admin1": "Delhi", "feature_code": "PPLC"},
    ],
    "ranch": [],
}


@pytest.fixture(autouse=True)
def fake_geocoder(monkeypatch):
    calls = []

    def fetch(name, count):
        calls.append(name)
        return GEO.get(name.lower(), [])

    monkeypatch.setattr(places_service, "_fetch", fetch)
    places_service.clear_cache()
    yield calls
    places_service.clear_cache()


# --------------------------------------------------------------------------------------
# Place tokens and free-form locations
# --------------------------------------------------------------------------------------

class TestPlaceTokens:
    def test_place_location_basics(self):
        loc = cat.place_location("Ranchi", "India", "in", 23.3441, 85.3096)
        assert loc.kind == "place" and loc.country_code == "IN" and loc.code.startswith("G") and len(loc.code) == 9

    def test_place_code_is_stable_and_distinct(self):
        a = cat.place_location("Ranchi", "India", "IN", 23.3441, 85.3096)
        b = cat.place_location("Ranchi", "India", "IN", 23.3441, 85.3096)
        c = cat.place_location("Jamshedpur", "India", "IN", 22.8046, 86.2029)
        assert a.code == b.code != c.code

    @pytest.mark.parametrize("args", [
        ("", "India", "IN", 1, 1), ("X", "India", "IND", 1, 1), ("X", "India", "1N", 1, 1),
        ("X", "India", "IN", 91, 1), ("X", "India", "IN", 1, 181), ("X", "India", "IN", "abc", 1),
        ("X", "India", "IN", float("nan"), 1), ("X", "India", "IN", None, 1),
    ])
    def test_place_location_rejects_bad_input(self, args):
        assert cat.place_location(*args) is None

    def test_markup_and_control_chars_are_stripped_from_names(self):
        loc = cat.place_location("<b>Ranchi</b>\x00\n", "India", "IN", 23.34, 85.31)
        assert "<" not in loc.name and ">" not in loc.name and "\x00" not in loc.name
        assert loc.name == "Ranchi"

    def test_name_length_capped(self):
        assert len(cat.place_location("A" * 500, "India", "IN", 1, 1).name) == 80

    def test_encode_decode_roundtrip(self):
        loc = cat.place_location("São Paulo", "Brazil", "BR", -23.5505, -46.6333)
        token = cat.encode_place(loc)
        assert token.startswith("geo:")
        back = cat.decode_place(token)
        assert (back.name, back.country, back.country_code, back.lat, back.lng) == \
            ("São Paulo", "Brazil", "BR", -23.5505, -46.6333)

    def test_catalog_city_encodes_as_its_code(self):
        d = cat.resolve_location("Delhi")
        assert cat.encode_place(d) == "DEL" and cat.decode_place("del") == d

    @pytest.mark.parametrize("bad", ["", "geo:", "geo:!!!", "geo:eyJ9", "ZZZ", "Delhi", "geo:" + "A" * 50])
    def test_decode_rejects_garbage(self, bad):
        assert cat.decode_place(bad) is None

    def test_decode_rejects_out_of_range_payload(self):
        import base64, json
        payload = json.dumps({"n": "X", "c": "Y", "k": "IN", "a": 500, "o": 0}).encode()
        assert cat.decode_place("geo:" + base64.urlsafe_b64encode(payload).decode()) is None

    def test_loc_dict_hides_code_for_places(self):
        loc = cat.place_location("Ranchi", "India", "IN", 23.3441, 85.3096)
        assert cat._loc_dict(loc)["code"] == ""
        assert cat._loc_dict(cat.resolve_location("Delhi"))["code"] == "DEL"

    def test_too_close_has_no_modes(self):
        a = cat.place_location("A", "India", "IN", 17.385, 78.4867)
        b = cat.place_location("B", "India", "IN", 17.40, 78.50)
        assert cat.available_modes(a, b) == []


class TestPlaceOptions:
    ranchi = cat.place_location("Ranchi", "India", "IN", 23.3441, 85.3096)
    delhi = cat.resolve_location("Delhi")

    def test_mixed_catalog_and_place_search(self):
        opts = cat.search_options(self.ranchi, self.delhi, TRAVEL, today=NOW.date())
        assert {o.mode for o in opts} == {"air", "train", "bus"}  # ~1,000 km, all in India
        assert all(o.currency == "INR" and not o.is_international for o in opts)
        assert all(o.option_id.startswith("x~") for o in opts)

    def test_option_id_roundtrip_for_places(self):
        opt = cat.search_options(self.ranchi, self.delhi, TRAVEL, "train", today=NOW.date())[0]
        assert cat.get_option(opt.option_id, today=NOW.date()).to_dict() == opt.to_dict()

    def test_option_ids_for_catalog_pairs_are_unchanged(self):
        opt = cat.search_options(self.delhi, cat.resolve_location("Mumbai"), TRAVEL, "air", today=NOW.date())[0]
        assert opt.option_id.startswith("air-DEL-BOM-2026-11-15-")

    def test_deterministic(self):
        a = [o.to_dict() for o in cat.search_options(self.ranchi, self.delhi, TRAVEL, today=NOW.date())]
        b = [o.to_dict() for o in cat.search_options(self.ranchi, self.delhi, TRAVEL, today=NOW.date())]
        assert a == b

    def test_international_place_is_air_only_in_usd(self):
        sf = cat.place_location("San Francisco", "United States", "US", 37.7749, -122.4194)
        opts = cat.search_options(self.ranchi, sf, TRAVEL, today=NOW.date())
        assert {o.mode for o in opts} == {"air"} and all(o.currency == "USD" and o.is_international for o in opts)

    @pytest.mark.parametrize("bad", [
        "x~air~DEL~geo~2026-11-15~0", "x~air~DEL~DEL~2026-11-15~0", "x~air~!!~DEL~2026-11-15~0",
        "x~air~DEL~BOM~2026-11-15", "x~air~DEL~BOM~2026-13-45~0", "x~boat~DEL~BOM~2026-11-15~0",
        "x~air~DEL~BOM~2026-11-15~x", "x~train~DEL~DXB~2026-11-15~0",
    ])
    def test_malformed_place_ids_rejected(self, bad):
        assert cat.get_option(bad, today=NOW.date()) is None

    def test_tampered_index_rejected(self):
        opt = cat.search_options(self.ranchi, self.delhi, TRAVEL, "air", today=NOW.date())[0]
        assert cat.get_option(opt.option_id[:-1] + "9", today=NOW.date()) is None


# --------------------------------------------------------------------------------------
# Suggestions
# --------------------------------------------------------------------------------------

class TestSuggest:
    @pytest.mark.parametrize("q", ["", " ", "a", " x ", None])
    def test_short_queries_return_nothing(self, q, fake_geocoder):
        assert places_service.suggest(q) == []
        assert fake_geocoder == []  # no wasted geocoder calls

    def test_catalog_first_with_codes(self):
        out = places_service.suggest("del")
        assert out[0]["label"] == "Delhi, India" and out[0]["value"] == "DEL" and out[0]["kind"] == "city"

    def test_world_place_from_geocoder(self):
        out = places_service.suggest("ranchi")
        assert len(out) == 1  # duplicate listing collapsed
        item = out[0]
        assert item["label"] == "Ranchi, Jharkhand, India" and item["kind"] == "place"
        assert item["value"].startswith("geo:") and item["country_code"] == "IN"
        loc = cat.decode_place(item["value"])
        assert (loc.name, loc.country_code) == ("Ranchi", "IN")

    def test_countries_are_excluded(self):
        labels = [i["label"] for i in places_service.suggest("san")]
        assert "San Francisco, California, United States" in labels
        assert not any(label.startswith("San Marino") for label in labels)

    def test_same_city_as_catalog_not_listed_twice(self):
        out = places_service.suggest("new delhi")
        assert [i["value"] for i in out] == ["DEL"]

    def test_country_hint_filters_ambiguous_names(self):
        labels = [i["label"] for i in places_service.suggest("Springfield, United Kingdom")]
        assert labels == ["Springfield, England, United Kingdom"]
        labels = [i["label"] for i in places_service.suggest("Springfield, Illinois")]
        assert labels == ["Springfield, Illinois, United States"]

    def test_region_hint(self):
        labels = [i["label"] for i in places_service.suggest("Springfield, Massachusetts, US")]
        assert labels == ["Springfield, Massachusetts, United States"]

    def test_ambiguous_without_hint_lists_all(self):
        assert len(places_service.suggest("springfield")) == 3

    def test_bigger_places_rank_first(self, monkeypatch):
        monkeypatch.setattr(places_service, "_fetch", lambda n, c: [
            {"name": "Tinyville", "latitude": 1, "longitude": 1, "country": "India", "country_code": "IN",
             "admin1": "A", "population": 120, "feature_code": "PPL"},
            {"name": "Townsburg", "latitude": 2, "longitude": 2, "country": "India", "country_code": "IN",
             "admin1": "B", "population": 900000, "feature_code": "PPLA"},
            {"name": "Noinfo", "latitude": 3, "longitude": 3, "country": "India", "country_code": "IN",
             "admin1": "C", "feature_code": "PPL"},
        ])
        places_service.clear_cache()
        assert [i["name"] for i in places_service.suggest("t town")] == ["Townsburg", "Tinyville", "Noinfo"]

    def test_limit_respected(self):
        assert len(places_service.suggest("springfield", limit=2)) == 2

    def test_geocoder_failure_degrades_to_catalog(self, monkeypatch):
        def boom(name, count):
            raise httpx.ConnectError("down")
        monkeypatch.setattr(places_service, "_fetch", boom)
        places_service.clear_cache()
        assert [i["value"] for i in places_service.suggest("del")] == ["DEL"]
        assert places_service.suggest("ranchi") == []

    def test_bad_geocoder_payload_is_tolerated(self, monkeypatch):
        monkeypatch.setattr(places_service, "_fetch", lambda n, c: [{"name": "", "latitude": "x"}, {"foo": 1}])
        places_service.clear_cache()
        assert places_service.suggest("zzz town") == []

    def test_results_are_cached(self, fake_geocoder):
        places_service.suggest("ranchi")
        places_service.suggest("RANCHI")
        assert fake_geocoder.count("ranchi") == 1

    def test_cache_is_bounded(self, monkeypatch):
        monkeypatch.setattr(places_service, "CACHE_MAX_ENTRIES", 3)
        for i in range(10):
            places_service.suggest(f"town{i}")
        assert len(places_service._cache) <= 3

    def test_geocode_first(self):
        loc = places_service.geocode_first("Ranchi, Jharkhand, India")
        assert loc.name == "Ranchi" and loc.kind == "place"
        assert places_service.geocode_first("Delhi").code == "DEL"
        assert places_service.geocode_first("qqqqq") is None


# --------------------------------------------------------------------------------------
# Booking with free-form places
# --------------------------------------------------------------------------------------

class Clock:
    def __call__(self):
        return NOW


@pytest.fixture
def service():
    return BookingService(BookingStore(":memory:"), clock=Clock(), geocoder=places_service.geocode_first)


def ranchi_token():
    return places_service.suggest("ranchi")[0]["value"]


def adult(**kw):
    base = {"name": "Asha Rao", "age": 30, "gender": "F", "id_type": "aadhaar", "id_number": "123412341234"}
    base.update(kw)
    return base


class TestBookingWithPlaces:
    def test_search_with_picked_place(self, service):
        res = service.search(ranchi_token(), "Delhi", TRAVEL, None, 2)
        assert res["origin"]["name"] == "Ranchi" and res["origin"]["code"] == ""
        assert res["destination"]["code"] == "DEL"
        assert res["results"] and all(r["option_id"].startswith("x~") for r in res["results"])

    def test_search_with_typed_text_uses_geocoder_fallback(self, service):
        res = service.search("Ranchi, Jharkhand, India", "Delhi", TRAVEL, "air", 1)
        assert res["origin"]["name"] == "Ranchi"

    def test_catalog_text_never_needs_the_geocoder(self, fake_geocoder):
        svc = BookingService(BookingStore(":memory:"), clock=Clock(), geocoder=places_service.geocode_first)
        svc.search("Delhi", "Mumbai", TRAVEL, None, 1)
        assert fake_geocoder == []

    def test_unknown_place_is_404(self, service):
        with pytest.raises(BookingError) as err:
            service.search("qqqqq", "Delhi", TRAVEL, None, 1)
        assert err.value.status_code == 404 and "find origin" in err.value.message

    def test_without_geocoder_unknown_text_is_404(self):
        svc = BookingService(BookingStore(":memory:"), clock=Clock())
        with pytest.raises(BookingError) as err:
            svc.search("Ranchi", "Delhi", TRAVEL, None, 1)
        assert err.value.status_code == 404

    def test_invalid_token_is_400(self, service):
        with pytest.raises(BookingError) as err:
            service.search("geo:not-a-token", "Delhi", TRAVEL, None, 1)
        assert err.value.status_code == 400

    def test_same_place_is_400(self, service):
        with pytest.raises(BookingError) as err:
            service.search(ranchi_token(), ranchi_token(), TRAVEL, None, 1)
        assert err.value.status_code == 400

    def test_nearby_places_rejected(self, service):
        near = cat.encode_place(cat.place_location("Kanke", "India", "IN", 23.4, 85.3))
        with pytest.raises(BookingError) as err:
            service.search(ranchi_token(), near, TRAVEL, None, 1)
        assert err.value.status_code == 400 and "too close" in err.value.message

    def test_full_booking_journey_from_a_free_form_origin(self, service):
        res = service.search(ranchi_token(), "Delhi", TRAVEL, "train", 2)
        opt = res["results"][0]
        cls = next(iter(opt["classes"]))
        booking = service.create(BookingCreate(
            option_id=opt["option_id"], travel_class=cls, contact_email=EMAIL,
            passengers=[adult(), adult(name="Ravi Rao", age=34)],
        ))
        assert booking["service"]["origin"]["name"] == "Ranchi" and booking["pricing"]["currency"] == "INR"
        paid = service.pay(booking["pnr"], EMAIL, PaymentIn(method="upi"))
        assert paid["status"] == "CONFIRMED" and len(paid["seats"]) == 2
        out = service.cancel(booking["pnr"], EMAIL)
        assert out["status"] == "CANCELLED" and Decimal(out["refund_amount"]) > 0

    def test_availability_is_tracked_per_place_option(self, service):
        res = service.search(ranchi_token(), "Delhi", TRAVEL, "bus", 1)
        opt = res["results"][0]
        cls = next(iter(opt["classes"]))
        before = opt["classes"][cls]["seats_available"]
        service.create(BookingCreate(option_id=opt["option_id"], travel_class=cls, contact_email=EMAIL,
                                     passengers=[adult(), adult(name="Ravi Rao")]))
        after = service.search(ranchi_token(), "Delhi", TRAVEL, "bus", 1)["results"][0]["classes"][cls]["seats_available"]
        assert after == before - 2

    def test_international_flight_from_a_free_form_origin_needs_passports(self, service):
        sf = places_service.suggest("san")[0]["value"]
        opt = service.search(ranchi_token(), sf, TRAVEL, "air", 1)["results"][0]
        with pytest.raises(BookingError) as err:
            service.create(BookingCreate(option_id=opt["option_id"], travel_class="Economy",
                                         contact_email=EMAIL, passengers=[adult()]))
        assert err.value.status_code == 422 and "Passport" in err.value.message

    def test_forged_option_id_is_rejected(self, service):
        with pytest.raises(BookingError) as err:
            service.create(BookingCreate(option_id="x~air~geo~DEL~2026-11-15~0" + "0" * 3, travel_class="Economy",
                                         contact_email=EMAIL, passengers=[adult()]))
        assert err.value.status_code == 404


# --------------------------------------------------------------------------------------
# HTTP API
# --------------------------------------------------------------------------------------

@pytest.fixture
def api():
    from main import app
    booking_api.set_service(BookingService(BookingStore(":memory:"), clock=Clock(),
                                           geocoder=places_service.geocode_first))
    booking_api.booking_limiter._requests.clear()
    places_api.places_limiter._requests.clear()
    yield TestClient(app, raise_server_exceptions=False)
    booking_api.set_service(None)


class TestPlacesApi:
    def test_suggest(self, api):
        r = api.get("/api/places/suggest", params={"q": "ranchi"})
        assert r.status_code == 200
        assert r.json()["places"][0]["label"] == "Ranchi, Jharkhand, India"

    def test_short_query_is_empty_not_an_error(self, api):
        assert api.get("/api/places/suggest", params={"q": "r"}).json() == {"places": []}
        assert api.get("/api/places/suggest").json() == {"places": []}

    @pytest.mark.parametrize("params", [{"q": "x" * 81}, {"q": "del", "limit": 0}, {"q": "del", "limit": 11}])
    def test_validation(self, api, params):
        assert api.get("/api/places/suggest", params=params).status_code == 422

    def test_rate_limited(self, api):
        places_api.places_limiter.max_requests = 2
        try:
            codes = [api.get("/api/places/suggest", params={"q": "del"}).status_code for _ in range(4)]
        finally:
            places_api.places_limiter.max_requests = 90
        assert codes == [200, 200, 429, 429]

    def test_booking_search_accepts_a_picked_place(self, api):
        token = api.get("/api/places/suggest", params={"q": "ranchi"}).json()["places"][0]["value"]
        r = api.get("/api/booking/search", params={"origin": token, "destination": "Delhi", "date": TRAVEL.isoformat()})
        assert r.status_code == 200 and r.json()["origin"]["name"] == "Ranchi"

    def test_search_with_invalid_token_returns_400(self, api):
        r = api.get("/api/booking/search", params={"origin": "geo:zzz", "destination": "Delhi", "date": TRAVEL.isoformat()})
        assert r.status_code == 400


# --------------------------------------------------------------------------------------
# Origin flows through plan / re-plan
# --------------------------------------------------------------------------------------

def plan_payload(**kw):
    base = {"destination": "Tokyo, Japan", "start_date": str(date.today() + timedelta(days=7)),
            "end_date": str(date.today() + timedelta(days=10))}
    base.update(kw)
    return base


class TestOriginInPlanning:
    @patch("services.orchestrator.TripOrchestrator.plan_trip", new_callable=AsyncMock)
    def test_plan_passes_origin(self, mock_plan, api):
        mock_plan.return_value = {"destination": "Tokyo, Japan", "itinerary": []}
        r = api.post("/api/plan", json=plan_payload(origin="Ranchi, Jharkhand, India"))
        assert r.status_code == 200
        assert mock_plan.call_args.kwargs["origin"] == "Ranchi, Jharkhand, India"

    @patch("services.orchestrator.TripOrchestrator.plan_trip", new_callable=AsyncMock)
    def test_origin_is_optional_and_blank_means_none(self, mock_plan, api):
        mock_plan.return_value = {"itinerary": []}
        assert api.post("/api/plan", json=plan_payload()).status_code == 200
        assert mock_plan.call_args.kwargs["origin"] is None
        assert api.post("/api/plan", json=plan_payload(origin="   ")).status_code == 200
        assert mock_plan.call_args.kwargs["origin"] is None

    @patch("services.orchestrator.TripOrchestrator.plan_trip", new_callable=AsyncMock)
    def test_origin_markup_is_stripped_but_apostrophes_survive(self, mock_plan, api):
        mock_plan.return_value = {"itinerary": []}
        api.post("/api/plan", json=plan_payload(origin="<script>x</script><b>St. John's</b>"))
        assert mock_plan.call_args.kwargs["origin"] == "St. John's"

    def test_origin_too_long_is_422(self, api):
        assert api.post("/api/plan", json=plan_payload(origin="x" * 201)).status_code == 422

    @patch("services.orchestrator.TripOrchestrator.replan_trip", new_callable=AsyncMock)
    def test_replan_passes_origin(self, mock_replan, api):
        mock_replan.return_value = {"itinerary": []}
        body = {"original_destination": "Tokyo, Japan", "start_date": str(date.today() + timedelta(days=7)),
                "end_date": str(date.today() + timedelta(days=10)), "disruption": "Heavy rain on day 2",
                "origin": "Ranchi, India"}
        assert api.post("/api/replan", json=body).status_code == 200
        assert mock_replan.call_args.kwargs["origin"] == "Ranchi, India"

    async def test_orchestrator_echoes_origin_into_the_itinerary(self):
        from services.orchestrator import TripOrchestrator
        with patch("services.orchestrator.get_weather_forecast", new=AsyncMock(return_value=[])), \
             patch("services.orchestrator.generate_itinerary", new=AsyncMock(return_value={"destination": "Tokyo"})) as gen:
            out = await TripOrchestrator().plan_trip("Tokyo", "2026-11-01", "2026-11-03", origin="Ranchi, India")
        assert out["origin"] == "Ranchi, India" and gen.call_args.kwargs["origin"] == "Ranchi, India"

    async def test_orchestrator_omits_origin_when_absent(self):
        from services.orchestrator import TripOrchestrator
        with patch("services.orchestrator.get_weather_forecast", new=AsyncMock(return_value=[])), \
             patch("services.orchestrator.generate_itinerary", new=AsyncMock(return_value={"destination": "Tokyo"})):
            out = await TripOrchestrator().plan_trip("Tokyo", "2026-11-01", "2026-11-03")
        assert "origin" not in out

    async def test_prompt_mentions_origin_only_when_given(self, monkeypatch):
        monkeypatch.setattr(settings, "anthropic_auth_token", "token")
        with patch.object(llm_service, "_call_anthropic", new=AsyncMock(return_value={})) as call:
            await llm_service.generate_itinerary("Tokyo", "2026-11-01", "2026-11-03", "moderate", [], "solo", {}, [],
                                                 origin="Ranchi, India")
            with_origin = call.call_args.args[0]
            await llm_service.generate_itinerary("Tokyo", "2026-11-01", "2026-11-03", "moderate", [], "solo", {}, [])
            without = call.call_args.args[0]
        assert "Traveling from: Ranchi, India" in with_origin and "journey from the origin" in with_origin
        assert "Traveling from" not in without
