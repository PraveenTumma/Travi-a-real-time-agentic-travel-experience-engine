"""LLM service supporting Anthropic and Gemini for itinerary generation (Groq disabled)."""

import json
import logging
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert travel planner. Generate a detailed day-by-day travel itinerary as JSON.

RULES:
1. Each day should have 3-5 activities and 3 meals
2. Consider weather - suggest indoor activities on rainy days (precipitation > 50%)
3. Respect budget level and constraints
4. Include local food recommendations
5. Consider walking distances between activities
6. Include estimated costs in USD
7. ALWAYS include real street addresses and approximate lat/lng coordinates for every activity and meal location

OUTPUT FORMAT (strict JSON, no markdown):
{
  "destination": "City, Country",
  "summary": "2-sentence trip summary",
  "itinerary": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "theme": "Day theme",
      "weather_note": "Brief weather context",
      "activities": [
        {
          "time": "09:00",
          "name": "Place name",
          "location": "Full street address of the place",
          "latitude": 35.7148,
          "longitude": 139.7967,
          "description": "1-2 sentences",
          "category": "temple|museum|food|nature|shopping|entertainment|landmark",
          "estimated_cost_usd": 0,
          "duration_hours": 1.5,
          "indoor": false
        }
      ],
      "meals": [
        {"meal_type": "breakfast", "suggestion": "Food/Restaurant", "location": "Full street address", "latitude": 35.6654, "longitude": 139.7707, "cuisine": "local", "estimated_cost_usd": 10}
      ],
      "daily_budget_estimate_usd": 80
    }
  ],
  "total_estimated_cost_usd": 300,
  "packing_tips": ["tip1", "tip2"],
  "local_tips": ["tip1", "tip2"],
  "weather_overview": "Overall weather summary"
}

Return ONLY valid JSON. No markdown code fences. No extra text."""


async def generate_itinerary(
    destination: str,
    start_date: str,
    end_date: str,
    budget_level: str,
    preferences: list[str],
    traveler_type: str,
    constraints: dict[str, Any],
    weather_data: list[dict[str, Any]],
) -> dict[str, Any]:
    """Generate a trip itinerary using the configured LLM provider.

    Args:
        destination: Travel destination.
        start_date: Trip start date.
        end_date: Trip end date.
        budget_level: Budget level (budget/moderate/luxury).
        preferences: User interests.
        traveler_type: Type of traveler.
        constraints: Trip constraints dict.
        weather_data: Real-time weather forecast data.

    Returns:
        Parsed itinerary dictionary.
    """
    weather_context = ""
    if weather_data:
        weather_lines = []
        for day in weather_data:
            weather_lines.append(
                f"  {day['date']}: {day['description']}, "
                f"{day.get('temp_min_c', '?')}–{day.get('temp_max_c', '?')}°C, "
                f"Rain probability: {day.get('precipitation_probability', 0)}%"
            )
        weather_context = "REAL-TIME WEATHER FORECAST:\n" + "\n".join(weather_lines)

    user_prompt = f"""Plan a trip with these details:
- Destination: {destination}
- Dates: {start_date} to {end_date}
- Budget Level: {budget_level}
- Interests: {', '.join(preferences) if preferences else 'general sightseeing'}
- Traveler Type: {traveler_type}
- Max Daily Walking: {constraints.get('max_daily_walking_km', 10)} km
- Accessibility Needs: {constraints.get('accessibility_needs', False)}
- Dietary Restrictions: {constraints.get('dietary_restrictions', 'none')}

{weather_context}

Generate a complete day-by-day itinerary as JSON."""

    provider = settings.llm_provider
    if provider == "anthropic":
        return await _call_anthropic(user_prompt)
    elif provider == "gemini":
        return await _call_gemini(user_prompt)
    # elif provider == "groq":
    #     return await _call_groq(user_prompt)
    else:
        raise ValueError("No LLM API key configured")


async def generate_replan(
    original_context: str,
    disruption: str,
    preferences: list[str],
) -> dict[str, Any]:
    """Re-plan an itinerary based on a disruption event."""
    user_prompt = f"""A traveler's trip needs to be re-planned due to a disruption.

ORIGINAL TRIP CONTEXT:
{original_context}

DISRUPTION EVENT: {disruption}

TRAVELER PREFERENCES: {', '.join(preferences) if preferences else 'general'}

Re-generate the itinerary adapting to this disruption. Keep the same JSON format.
Adjust affected days, swap outdoor activities for indoor ones if weather is the issue,
suggest alternative venues if a place is closed. Explain changes in weather_note fields."""

    provider = settings.llm_provider
    if provider == "anthropic":
        return await _call_anthropic(user_prompt)
    elif provider == "gemini":
        return await _call_gemini(user_prompt)
    # elif provider == "groq":
    #     return await _call_groq(user_prompt)
    else:
        raise ValueError("No LLM API key configured")


async def call_anthropic_text(
    system: str, messages: list[dict[str, str]], max_tokens: int, timeout: float = 120.0
) -> str:
    """Call the Anthropic Messages API (or a compatible proxy) and return the reply text."""
    url = f"{settings.anthropic_base_url}/v1/messages"
    headers = {
        "Authorization": f"Bearer {settings.anthropic_auth_token}",
        "x-api-key": settings.anthropic_auth_token,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.anthropic_model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")


async def _call_anthropic(user_prompt: str) -> dict[str, Any]:
    """Generate an itinerary via Anthropic and parse the JSON reply."""
    content = await call_anthropic_text(
        SYSTEM_PROMPT, [{"role": "user", "content": user_prompt}], max_tokens=8192
    )
    logger.info("Anthropic response received (%d chars)", len(content))
    # Tolerate stray markdown fences or prose around the JSON object
    start, end = content.find("{"), content.rfind("}")
    return json.loads(content[start:end + 1] if start != -1 and end > start else content)


# Groq disabled — Anthropic is the primary provider
# async def _call_groq(user_prompt: str) -> dict[str, Any]:
#     """Call the Groq API (OpenAI-compatible endpoint)."""
#     url = "https://api.groq.com/openai/v1/chat/completions"
#     headers = {
#         "Authorization": f"Bearer {settings.groq_api_key}",
#         "Content-Type": "application/json",
#     }
#     payload = {
#         "model": "llama-3.1-8b-instant",
#         "messages": [
#             {"role": "system", "content": SYSTEM_PROMPT},
#             {"role": "user", "content": user_prompt},
#         ],
#         "temperature": 0.7,
#         "max_tokens": 4096,
#         "response_format": {"type": "json_object"},
#     }
#
#     async with httpx.AsyncClient(timeout=60.0) as client:
#         response = await client.post(url, json=payload, headers=headers)
#         response.raise_for_status()
#         data = response.json()
#         content = data["choices"][0]["message"]["content"]
#         logger.info("Groq response received (%d chars)", len(content))
#         return json.loads(content)


async def _call_gemini(user_prompt: str) -> dict[str, Any]:
    """Call the Google Gemini API."""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={settings.gemini_api_key}"
    )
    payload = {
        "contents": [{"parts": [{"text": SYSTEM_PROMPT + "\n\n" + user_prompt}]}],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 4096,
            "responseMimeType": "application/json",
        },
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
        content = data["candidates"][0]["content"]["parts"][0]["text"]
        logger.info("Gemini response received (%d chars)", len(content))
        return json.loads(content)
