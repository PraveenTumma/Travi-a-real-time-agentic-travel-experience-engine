"""Travel Planning & Experience Engine — FastAPI Application.

AI-powered dynamic trip planning with preferences, constraints,
and real-time weather updates. Built for Google PromptWars hackathon.
"""

import json
import logging
import os
from pathlib import Path
from contextlib import asynccontextmanager

from dotenv import load_dotenv

# Load .env before importing config
load_dotenv()

from fastapi import FastAPI, Request, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from models import TripRequest, ReplanRequest, HealthResponse
from services.orchestrator import TripOrchestrator
from security import RateLimiter, sanitize_input, SecurityHeadersMiddleware
from booking_api import router as booking_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Initialize services
orchestrator = TripOrchestrator()
rate_limiter = RateLimiter(max_requests=15, window_seconds=60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown handler."""
    logger.info("Travel Engine starting — LLM provider: %s", settings.llm_provider)
    settings.validate()
    yield
    logger.info("Travel Engine shutting down")


app = FastAPI(
    title="Travel Planning & Experience Engine",
    description="AI-powered trip planning with real-time weather data",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — restrict to known origins in production
ALLOWED_ORIGINS = [
    "http://localhost:5173",          # Vite dev server
    "http://localhost:8080",          # Local production preview
    "https://travi-cd6fa.web.app",    # Firebase Hosting
    "https://travi-cd6fa.firebaseapp.com",
]

# Allow adding origins dynamically via environment variable
extra_origins = os.getenv("ALLOWED_ORIGINS", "")
if extra_origins:
    ALLOWED_ORIGINS.extend([origin.strip() for origin in extra_origins.split(",") if origin.strip()])


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Contact-Email"],
)

# Security headers
app.add_middleware(SecurityHeadersMiddleware)

@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    """Return 422 details without echoing submitted values (IDs, card numbers)."""
    errors = [{k: v for k, v in err.items() if k not in ("input", "ctx", "url")} for err in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


# Ticket booking (prototype)
app.include_router(booking_router)


# --- API Routes ---

@app.get("/api/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """Health check endpoint for Cloud Run and monitoring."""
    return HealthResponse(llm_provider=settings.llm_provider)


@app.get("/api/maps-key", tags=["Config"])
async def get_maps_key():
    """Return Google Maps API key for frontend map rendering."""
    return {"key": settings.google_maps_api_key}


@app.post("/api/plan", tags=["Planning"])
async def plan_trip(request: Request, trip: TripRequest):
    """Generate a dynamic trip itinerary.

    Accepts destination, dates, preferences, and constraints.
    Returns a weather-aware, day-by-day itinerary powered by AI.
    """
    # Rate limiting
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Please wait before trying again.",
        )

    # Sanitize inputs
    destination = sanitize_input(trip.destination)

    try:
        result = await orchestrator.plan_trip(
            destination=destination,
            start_date=trip.start_date.isoformat(),
            end_date=trip.end_date.isoformat(),
            budget_level=trip.budget_level,
            preferences=[sanitize_input(p) for p in trip.preferences],
            traveler_type=trip.traveler_type,
            constraints=trip.constraints.model_dump(),
        )
        return JSONResponse(content=result)

    except ValueError as exc:
        logger.error("Validation error: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("Planning failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate itinerary. Please try again.")


@app.post("/api/replan", tags=["Planning"])
async def replan_trip(request: Request, replan: ReplanRequest):
    """Dynamically re-plan a trip based on a disruption event.

    Accepts the original trip context and a disruption description,
    then generates an adapted itinerary.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded.")

    try:
        result = await orchestrator.replan_trip(
            original_destination=sanitize_input(replan.original_destination),
            start_date=replan.start_date.isoformat(),
            end_date=replan.end_date.isoformat(),
            budget_level=replan.budget_level,
            preferences=[sanitize_input(p) for p in replan.preferences],
            traveler_type=replan.traveler_type,
            constraints=replan.constraints.model_dump(),
            disruption=sanitize_input(replan.disruption),
            original_summary=sanitize_input(replan.original_itinerary_summary),
        )
        return JSONResponse(content=result)

    except Exception as exc:
        logger.error("Re-planning failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to re-plan. Please try again.")


@app.post("/api/chat", tags=["Chat"])
async def chat_with_trip(request: Request, body: dict):
    """Chat with the AI travel agent about the current itinerary.

    Accepts the full itinerary context and a user message.
    Returns a conversational response grounded in the trip data.
    """
    import httpx as _httpx

    user_message = sanitize_input(body.get("message", ""))
    itinerary_json = body.get("itinerary", {})
    destination = sanitize_input(body.get("destination", ""))
    conversation_history = body.get("history", [])

    if not user_message:
        raise HTTPException(status_code=400, detail="Message is required.")

    # Build context from itinerary
    context = f"DESTINATION: {destination}\n"
    context += f"ITINERARY DATA:\n{json.dumps(itinerary_json, indent=2, default=str)[:6000]}\n"

    system_prompt = f"""You are Travi, a friendly and knowledgeable AI travel assistant.
You have access to the traveler's COMPLETE itinerary data below. Use it to answer questions.

{context}

RULES:
1. Answer ONLY based on the itinerary data provided above. Don't make up information.
2. Be conversational, warm, and helpful — like a travel buddy.
3. Keep answers concise (2-4 sentences) unless the user asks for detail.
4. Use emojis sparingly to keep the comic/fun theme.
5. If asked about something not in the itinerary, say so honestly and suggest what IS available.
6. You can help with: budget breakdowns, day summaries, activity details, meal suggestions, packing tips, local tips, and comparisons between days.
"""

    messages = [{"role": "system", "content": system_prompt}]

    # Add conversation history (last 10 messages to stay within context)
    for msg in conversation_history[-10:]:
        messages.append({
            "role": msg.get("role", "user"),
            "content": sanitize_input(msg.get("content", "")),
        })

    messages.append({"role": "user", "content": user_message})

    # Call Groq
    provider = settings.llm_provider
    if provider == "groq":
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.groq_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": "llama-3.3-70b-versatile",
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 500,
        }
    elif provider == "gemini":
        url = f"https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.gemini_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": "gemini-2.0-flash",
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 500,
        }
    else:
        raise HTTPException(status_code=500, detail="No LLM provider configured.")

    try:
        async with _httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            reply = data["choices"][0]["message"]["content"]
            return {"reply": reply}
    except Exception as exc:
        logger.error("Chat failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Chat failed. Please try again.")

# --- Static file serving (React build) ---

STATIC_DIR = Path(__file__).parent / "static"

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve React SPA — all non-API routes return index.html."""
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")
else:
    @app.get("/")
    async def root():
        """Fallback when no static build is present."""
        return {"message": "Travel Engine API is running. Build frontend with npm run build."}
