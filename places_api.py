"""HTTP route for place suggestions (Origin field typeahead and booking search)."""

from fastapi import APIRouter, HTTPException, Query, Request

from security import RateLimiter
from services import places_service

router = APIRouter(tags=["Places"])
# Typeahead is chatty (the client debounces, but each keystroke burst still counts).
places_limiter = RateLimiter(max_requests=90, window_seconds=60)


@router.get("/api/places/suggest")
def suggest_places(
    request: Request,
    q: str = Query("", max_length=80),
    limit: int = Query(8, ge=1, le=10),
):
    """Suggest places worldwide for a partial name. Returns [] for queries under 2 characters."""
    client = request.client.host if request.client else "unknown"
    if not places_limiter.is_allowed(client):
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")
    return {"places": places_service.suggest(q, limit)}
