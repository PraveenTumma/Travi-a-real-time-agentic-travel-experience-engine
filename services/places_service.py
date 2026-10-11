"""Place suggestions for the Origin field and the booking search.

Curated catalog cities come first (they map to airports / rail / bus hubs in the booking
prototype). Anywhere else in the world is covered by Open-Meteo's free geocoding API, the
same provider the weather service already uses, so no extra key or stored dataset is needed.
If the geocoder is down, suggestions degrade to the catalog instead of failing.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import OrderedDict
from typing import Any

import httpx

from services import booking_catalog as catalog

logger = logging.getLogger(__name__)

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
MIN_QUERY_LEN = 2
MAX_QUERY_LEN = 80
CACHE_TTL_SECONDS = 600
CACHE_MAX_ENTRIES = 500

_cache: OrderedDict[tuple[str, int], tuple[float, list[dict]]] = OrderedDict()
_cache_lock = threading.Lock()


def _fetch(name: str, count: int) -> list[dict]:
    """Query the geocoder. Kept separate so tests can replace it without network access."""
    with httpx.Client(timeout=6.0) as client:
        resp = client.get(GEOCODE_URL, params={"name": name, "count": count, "language": "en", "format": "json"})
        resp.raise_for_status()
        return resp.json().get("results") or []


def _cached_fetch(name: str, count: int) -> list[dict]:
    key = (name.lower(), count)
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_TTL_SECONDS:
            _cache.move_to_end(key)
            return hit[1]
    results = _fetch(name, count)
    with _cache_lock:
        _cache[key] = (now, results)
        _cache.move_to_end(key)
        while len(_cache) > CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)
    return results


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _normalise(query: str) -> str:
    return re.sub(r"\s+", " ", (query or "").replace("\x00", " ")).strip()[:MAX_QUERY_LEN]


def _split_query(query: str) -> tuple[str, list[str]]:
    """'Ranchi, Jharkhand, India' -> ('Ranchi', ['jharkhand', 'india'])."""
    head, *rest = [p.strip() for p in query.split(",")]
    return head, [p.lower() for p in rest if p]


def _item(loc: catalog.Location, region: str = "") -> dict[str, Any]:
    parts = [loc.name]
    if region and region.lower() != loc.name.lower():
        parts.append(region)
    parts.append(loc.country)
    return {
        "label": ", ".join(parts),
        "name": loc.name,
        "region": region,
        "country": loc.country,
        "country_code": loc.country_code,
        "lat": loc.lat,
        "lng": loc.lng,
        "value": catalog.encode_place(loc),
        "kind": loc.kind,
    }


def _catalog_matches(head: str, hints: list[str]) -> list[dict]:
    q = head.lower()
    scored = []
    for loc in catalog.LOCATIONS:
        name = loc.name.lower()
        if name.startswith(q) or loc.code.lower() == q or catalog._ALIASES.get(q) == loc.code:
            rank = 0
        elif q in name:
            rank = 1
        else:
            continue
        if hints and not _matches_hint(hints, loc.country, "", loc.country_code):
            continue
        scored.append((rank, loc.name, loc))
    scored.sort(key=lambda t: (t[0], t[1]))
    return [_item(loc) for _, _, loc in scored]


def _matches_hint(hints: list[str], country: str, region: str, cc: str) -> bool:
    fields = (country.lower(), region.lower(), cc.lower())
    return all(any(h == f or (len(h) > 2 and f.startswith(h)) for f in fields) for h in hints)


def suggest(query: str, limit: int = 8) -> list[dict]:
    """Ranked place suggestions for a partial query. Never raises on provider failure."""
    query = _normalise(query)
    if len(query) < MIN_QUERY_LEN:
        return []
    limit = max(1, min(limit, 10))
    head, hints = _split_query(query)
    if len(head) < MIN_QUERY_LEN:
        return []

    results = _catalog_matches(head, hints)
    catalog_locs = [catalog.decode_place(r["value"]) for r in results]

    try:
        raw = _cached_fetch(head, 12)
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Place geocoder unavailable (%s); serving catalog matches only", exc)
        raw = []

    matched, other = [], []
    for r in raw:
        if str(r.get("feature_code", "")).startswith("PCL"):  # countries: not a place you depart from
            continue
        loc = catalog.place_location(r.get("name", ""), r.get("country") or r.get("country_code", ""),
                                     r.get("country_code", ""), r.get("latitude"), r.get("longitude"))
        if loc is None or any(_near(loc, c) for c in catalog_locs):
            continue  # unusable, or the same city as a catalog match already listed
        region = (r.get("admin1") or "").strip()
        is_match = bool(hints) and _matches_hint(hints, loc.country, region, loc.country_code)
        population = r.get("population") if isinstance(r.get("population"), (int, float)) else 0
        (matched if is_match else other).append((population, _item(loc, region)))

    # The geocoder ranks by name similarity only; show bigger, better-known places first.
    matched = [item for _, item in sorted(matched, key=lambda t: -t[0])]
    other = [item for _, item in sorted(other, key=lambda t: -t[0])]

    # With a "City, Country" hint, show only hint matches when there are any.
    candidates = results + matched + ([] if matched else other)
    final, labels = [], set()
    for item in candidates:  # the geocoder lists some towns more than once
        if item["label"].lower() not in labels:
            labels.add(item["label"].lower())
            final.append(item)
    return final[:limit]


def _near(a: catalog.Location, b: catalog.Location, km: int = 25) -> bool:
    return catalog.distance_km(a, b) <= km


def geocode_first(text: str) -> catalog.Location | None:
    """Best single match for free text (used when the user didn't pick a suggestion)."""
    hits = suggest(text, limit=1)
    return catalog.decode_place(hits[0]["value"]) if hits else None
