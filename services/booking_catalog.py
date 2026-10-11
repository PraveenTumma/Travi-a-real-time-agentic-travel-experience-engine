"""Prototype transport catalog for the ticket-booking feature.

There are no real provider integrations yet. Search results are generated
deterministically from (mode, origin, destination, date) so the same search always
returns the same options, which keeps bookings reproducible and tests stable.

To plug in a real provider later, replace ``search_options`` / ``get_option`` with
calls to that provider; the rest of the booking flow only depends on the
``TransportOption`` shape defined here.
"""

from __future__ import annotations

import hashlib
import math
import random
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

MODES = ("air", "train", "bus")


@dataclass(frozen=True)
class Location:
    code: str
    name: str
    country: str
    country_code: str
    lat: float
    lng: float


LOCATIONS: tuple[Location, ...] = (
    # India
    Location("DEL", "Delhi", "India", "IN", 28.6139, 77.2090),
    Location("BOM", "Mumbai", "India", "IN", 19.0760, 72.8777),
    Location("BLR", "Bengaluru", "India", "IN", 12.9716, 77.5946),
    Location("MAA", "Chennai", "India", "IN", 13.0827, 80.2707),
    Location("CCU", "Kolkata", "India", "IN", 22.5726, 88.3639),
    Location("HYD", "Hyderabad", "India", "IN", 17.3850, 78.4867),
    Location("PNQ", "Pune", "India", "IN", 18.5204, 73.8567),
    Location("JAI", "Jaipur", "India", "IN", 26.9124, 75.7873),
    Location("GOI", "Goa", "India", "IN", 15.4909, 73.8278),
    Location("AMD", "Ahmedabad", "India", "IN", 23.0225, 72.5714),
    Location("COK", "Kochi", "India", "IN", 9.9312, 76.2673),
    Location("VNS", "Varanasi", "India", "IN", 25.3176, 82.9739),
    Location("LKO", "Lucknow", "India", "IN", 26.8467, 80.9462),
    Location("ATQ", "Amritsar", "India", "IN", 31.6340, 74.8723),
    # Abroad
    Location("DXB", "Dubai", "United Arab Emirates", "AE", 25.2048, 55.2708),
    Location("SIN", "Singapore", "Singapore", "SG", 1.3521, 103.8198),
    Location("BKK", "Bangkok", "Thailand", "TH", 13.7563, 100.5018),
    Location("KUL", "Kuala Lumpur", "Malaysia", "MY", 3.1390, 101.6869),
    Location("LHR", "London", "United Kingdom", "GB", 51.5074, -0.1278),
    Location("MAN", "Manchester", "United Kingdom", "GB", 53.4808, -2.2426),
    Location("CDG", "Paris", "France", "FR", 48.8566, 2.3522),
    Location("NCE", "Nice", "France", "FR", 43.7102, 7.2620),
    Location("FCO", "Rome", "Italy", "IT", 41.9028, 12.4964),
    Location("MXP", "Milan", "Italy", "IT", 45.4642, 9.1900),
    Location("NRT", "Tokyo", "Japan", "JP", 35.6762, 139.6503),
    Location("KIX", "Osaka", "Japan", "JP", 34.6937, 135.5023),
    Location("JFK", "New York", "United States", "US", 40.7128, -74.0060),
    Location("SYD", "Sydney", "Australia", "AU", -33.8688, 151.2093),
    Location("CMB", "Colombo", "Sri Lanka", "LK", 6.9271, 79.8612),
    Location("KTM", "Kathmandu", "Nepal", "NP", 27.7172, 85.3240),
    Location("DPS", "Bali", "Indonesia", "ID", -8.4095, 115.1889),
    Location("HKG", "Hong Kong", "Hong Kong", "HK", 22.3193, 114.1694),
)

_BY_CODE = {loc.code: loc for loc in LOCATIONS}
_ALIASES = {
    "bangalore": "BLR", "bombay": "BOM", "madras": "MAA", "calcutta": "CCU",
    "benares": "VNS", "banaras": "VNS", "new delhi": "DEL", "tokyo": "NRT",
    "kuala lumpur": "KUL", "ny": "JFK", "nyc": "JFK", "bali": "DPS",
}

# Countries with an intercity rail network we simulate.
RAIL_COUNTRIES = {"IN", "GB", "FR", "JP", "IT"}
# Cross-border pairs that have a train/bus link in the prototype.
CROSS_BORDER_TRAIN = {frozenset({"LHR", "CDG"})}
CROSS_BORDER_BUS = {frozenset({"LHR", "CDG"})}

MAX_TRAIN_KM = 2600
MAX_BUS_KM = 1300
MAX_ADVANCE_DAYS = 365

# --- class / operator tables -------------------------------------------------

AIR_CLASSES = {
    "Economy": 1.0, "Premium Economy": 1.6, "Business": 3.2,
}
TRAIN_CLASSES_IN = {"Sleeper (SL)": 1.0, "AC 3-Tier (3A)": 2.4, "AC 2-Tier (2A)": 3.4, "AC First (1A)": 5.6}
TRAIN_CLASSES_INTL = {"Standard": 1.0, "First": 1.8}
BUS_CLASSES_IN = {"Seater": 1.0, "Sleeper": 1.3, "AC Sleeper": 1.7}
BUS_CLASSES_INTL = {"Standard": 1.0, "Premium": 1.5}

# Fictional operators — this is sample data, not real carriers.
OPERATORS = {
    ("air", "domestic"): ["Indus Air", "Deccan Wings", "Saffron Airways", "Ganga Express"],
    ("air", "international"): ["Meridian Airlines", "Horizon Global", "Aurora Air", "Pacific Crest Air", "Silk Route Airways"],
    ("train", "domestic"): ["Capital Superfast", "Coastal Express", "Heritage Mail", "Peninsula Link"],
    ("train", "international"): ["Continental Rail", "Channel Link", "Metro Express", "Bullet Line"],
    ("bus", "domestic"): ["RoadRunner Travels", "Highway Star", "Orange Coach Lines", "Bharat Yatra"],
    ("bus", "international"): ["EuroCoach", "CityLink Coaches", "Intercity Direct", "GreenWay Bus"],
}

_TWOPLACES = Decimal("0.01")


@dataclass(frozen=True)
class TransportOption:
    option_id: str
    mode: str
    operator: str
    service_number: str
    origin: Location
    destination: Location
    departure: datetime
    arrival: datetime
    duration_minutes: int
    distance_km: int
    currency: str
    is_international: bool
    classes: dict[str, dict] = field(default_factory=dict)  # name -> {fare, seats_total}
    amenities: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {
            "option_id": self.option_id,
            "mode": self.mode,
            "operator": self.operator,
            "service_number": self.service_number,
            "origin": _loc_dict(self.origin),
            "destination": _loc_dict(self.destination),
            "departure": self.departure.isoformat(timespec="minutes"),
            "arrival": self.arrival.isoformat(timespec="minutes"),
            "duration_minutes": self.duration_minutes,
            "distance_km": self.distance_km,
            "currency": self.currency,
            "is_international": self.is_international,
            "classes": {k: dict(v) for k, v in self.classes.items()},
            "amenities": list(self.amenities),
        }


def _loc_dict(loc: Location) -> dict:
    return {"code": loc.code, "name": loc.name, "country": loc.country, "country_code": loc.country_code}


# --- lookup ------------------------------------------------------------------

def resolve_location(text: str) -> Location | None:
    """Resolve free text ("Delhi", "BOM", "Tokyo, Japan") to a known location."""
    if not text:
        return None
    cleaned = text.strip().lower()
    candidates = [cleaned, cleaned.split(",")[0].strip()]
    for cand in candidates:
        if not cand:
            continue
        if cand.upper() in _BY_CODE:
            return _BY_CODE[cand.upper()]
        if cand in _ALIASES:
            return _BY_CODE[_ALIASES[cand]]
        for loc in LOCATIONS:
            if loc.name.lower() == cand:
                return loc
    return None


def search_locations(query: str, limit: int = 8) -> list[dict]:
    """Autocomplete: match by name/code/country prefix or substring."""
    q = (query or "").strip().lower()
    if not q:
        return [_loc_dict(loc) for loc in LOCATIONS[:limit]]
    scored = []
    for loc in LOCATIONS:
        name, code, country = loc.name.lower(), loc.code.lower(), loc.country.lower()
        if name.startswith(q) or code == q:
            scored.append((0, loc))
        elif q in name or country.startswith(q):
            scored.append((1, loc))
    scored.sort(key=lambda s: (s[0], s[1].name))
    return [_loc_dict(loc) for _, loc in scored[:limit]]


def distance_km(a: Location, b: Location) -> int:
    """Great-circle distance in km (haversine)."""
    r = 6371.0
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp, dl = p2 - p1, math.radians(b.lng - a.lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * r * math.asin(math.sqrt(h)))


def available_modes(origin: Location, dest: Location) -> list[str]:
    """Which transport modes connect two locations."""
    if origin.code == dest.code:
        return []
    km = distance_km(origin, dest)
    pair = frozenset({origin.code, dest.code})
    same_country = origin.country_code == dest.country_code
    modes = ["air"]
    if (same_country and origin.country_code in RAIL_COUNTRIES and km <= MAX_TRAIN_KM) or pair in CROSS_BORDER_TRAIN:
        modes.append("train")
    if (same_country and km <= MAX_BUS_KM) or pair in CROSS_BORDER_BUS:
        modes.append("bus")
    return modes


# --- generation --------------------------------------------------------------

def _money(value: float, currency: str) -> Decimal:
    q = Decimal(str(value))
    return q.quantize(Decimal("1") if currency == "INR" else _TWOPLACES, rounding=ROUND_HALF_UP)


def _rng(*parts: str) -> random.Random:
    digest = hashlib.sha256("|".join(parts).encode()).hexdigest()
    return random.Random(int(digest[:16], 16))


def _demand_multiplier(travel_date: date, today: date) -> float:
    days_out = (travel_date - today).days
    if days_out < 3:
        return 1.35
    if days_out < 7:
        return 1.15
    if days_out > 60:
        return 0.9
    return 1.0


def _base_fare(mode: str, km: int, domestic_india: bool) -> float:
    if domestic_india:
        return {"air": 1800 + 4.2 * km, "train": 120 + 1.1 * km, "bus": 150 + 1.7 * km}[mode]
    return {"air": 45 + 0.09 * km, "train": 6 + 0.12 * km, "bus": 4 + 0.07 * km}[mode]


def _class_table(mode: str, domestic_india: bool) -> dict[str, float]:
    if mode == "air":
        return AIR_CLASSES
    if mode == "train":
        return TRAIN_CLASSES_IN if domestic_india else TRAIN_CLASSES_INTL
    return BUS_CLASSES_IN if domestic_india else BUS_CLASSES_INTL


def _capacity(mode: str, cls_index: int, n_classes: int, rng: random.Random) -> int:
    top = cls_index == n_classes - 1 and n_classes > 1
    if mode == "air":
        return rng.randint(8, 16) if top else rng.randint(80, 150)
    if mode == "train":
        return rng.randint(24, 48) if top else rng.randint(72, 180)
    return rng.randint(12, 20) if top else rng.randint(24, 40)


def _speed(mode: str, domestic_india: bool, rng: random.Random) -> tuple[float, int]:
    """Return (km/h, fixed overhead minutes)."""
    if mode == "air":
        return rng.uniform(720, 840), 55
    if mode == "train":
        return (rng.uniform(55, 90) if domestic_india else rng.uniform(110, 230)), 20
    return rng.uniform(42, 58), 15


def _amenities(mode: str, rng: random.Random) -> tuple[str, ...]:
    pool = {
        "air": ["Meal", "Wi-Fi", "Checked baggage 15kg", "In-flight entertainment", "Power outlet"],
        "train": ["Bedding", "Pantry car", "Charging point", "Reserved seating", "Wi-Fi"],
        "bus": ["Water bottle", "Charging point", "Blanket", "Live tracking", "Reclining seats"],
    }[mode]
    return tuple(sorted(rng.sample(pool, k=3)))


def _service_number(mode: str, rng: random.Random, operator: str) -> str:
    if mode == "air":
        return f"{''.join(w[0] for w in operator.split()[:2]).upper()}{rng.randint(100, 989)}"
    if mode == "train":
        return f"{rng.randint(10000, 22999)}"
    return f"BUS-{rng.randint(1000, 9999)}"


def search_options(
    origin: Location,
    dest: Location,
    travel_date: date,
    mode: str | None = None,
    today: date | None = None,
) -> list[TransportOption]:
    """Generate sample options for a route and date, sorted by departure time."""
    today = today or date.today()
    modes = available_modes(origin, dest)
    if mode:
        modes = [m for m in modes if m == mode]
    options: list[TransportOption] = []
    for m in modes:
        options.extend(_generate(m, origin, dest, travel_date, today))
    return sorted(options, key=lambda o: (o.departure, o.option_id))


def _generate(mode: str, origin: Location, dest: Location, travel_date: date, today: date) -> list[TransportOption]:
    km = distance_km(origin, dest)
    domestic = origin.country_code == dest.country_code
    domestic_india = domestic and origin.country_code == "IN"
    currency = "INR" if domestic_india else "USD"
    scope = "domestic" if domestic else "international"
    # Fares are priced on the cheapest class; stable across runs for the same route.
    class_table = _class_table(mode, domestic_india)
    count = {"air": 5, "train": 4, "bus": 5}[mode]
    operators = OPERATORS[(mode, scope)]
    demand = _demand_multiplier(travel_date, today)

    results = []
    for idx in range(count):
        rng = _rng(mode, origin.code, dest.code, travel_date.isoformat(), str(idx))
        operator = rng.choice(operators)
        speed, overhead = _speed(mode, domestic_india, rng)
        minutes = int(km / speed * 60) + overhead
        depart = datetime.combine(travel_date, datetime.min.time()) + timedelta(
            hours=rng.randint(5, 22), minutes=rng.choice([0, 10, 15, 25, 30, 40, 45, 55])
        )
        arrive = depart + timedelta(minutes=minutes)
        jitter = rng.uniform(0.88, 1.18)
        base = _base_fare(mode, km, domestic_india) * jitter * demand
        classes = {}
        names = list(class_table)
        for ci, (cname, mult) in enumerate(class_table.items()):
            classes[cname] = {
                "fare": str(_money(base * mult, currency)),
                "seats_total": _capacity(mode, ci, len(names), rng),
            }
        results.append(TransportOption(
            option_id=f"{mode}-{origin.code}-{dest.code}-{travel_date.isoformat()}-{idx}",
            mode=mode,
            operator=operator,
            service_number=_service_number(mode, rng, operator),
            origin=origin,
            destination=dest,
            departure=depart,
            arrival=arrive,
            duration_minutes=minutes,
            distance_km=km,
            currency=currency,
            is_international=not domestic,
            classes=classes,
            amenities=_amenities(mode, rng),
        ))
    return results


def get_option(option_id: str, today: date | None = None) -> TransportOption | None:
    """Re-derive an option from its ID. Returns None if the ID is invalid."""
    parts = option_id.split("-")
    # mode-ORG-DST-YYYY-MM-DD-idx
    if len(parts) != 7:
        return None
    mode, org, dst = parts[0], parts[1], parts[2]
    try:
        travel_date = date(int(parts[3]), int(parts[4]), int(parts[5]))
        idx = int(parts[6])
    except ValueError:
        return None
    origin, dest = _BY_CODE.get(org), _BY_CODE.get(dst)
    if mode not in MODES or not origin or not dest or mode not in available_modes(origin, dest):
        return None
    for opt in _generate(mode, origin, dest, travel_date, today or date.today()):
        if opt.option_id == option_id:
            return opt
    return None
