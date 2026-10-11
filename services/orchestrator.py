"""Trip orchestrator - coordinates weather + LLM services for itinerary generation."""

import asyncio
import logging
from typing import Any

from services.weather_service import get_weather_forecast
from services.llm_service import generate_itinerary, generate_replan

logger = logging.getLogger(__name__)


class TripOrchestrator:
    """Orchestrates trip planning by coordinating multiple services.

    Fetches real-time weather data and feeds it into the LLM
    for weather-aware itinerary generation.
    """

    async def plan_trip(
        self,
        destination: str,
        start_date: str,
        end_date: str,
        budget_level: str = "moderate",
        preferences: list[str] | None = None,
        traveler_type: str = "solo",
        constraints: dict[str, Any] | None = None,
        origin: str | None = None,
    ) -> dict[str, Any]:
        """Generate a complete trip itinerary with real-time data.

        Fetches weather forecast in parallel, then sends enriched
        context to the LLM for intelligent itinerary generation.

        Args:
            destination: Travel destination city.
            start_date: Trip start date (YYYY-MM-DD).
            end_date: Trip end date (YYYY-MM-DD).
            budget_level: Budget tier (budget/moderate/luxury).
            preferences: User interests list.
            traveler_type: solo/couple/family/group.
            constraints: Trip constraints dictionary.
            origin: Where the traveler starts from (optional).

        Returns:
            Complete itinerary dictionary with weather-aware plans.
        """
        preferences = preferences or []
        constraints = constraints or {}

        logger.info(
            "Planning trip to %s (%s to %s) for %s traveler",
            destination, start_date, end_date, traveler_type,
        )

        # Fetch weather data (runs concurrently if needed)
        weather_task = get_weather_forecast(destination, start_date, end_date)
        weather_data = await weather_task

        logger.info("Weather data: %d days fetched", len(weather_data))

        # Generate itinerary with LLM using weather context
        itinerary = await generate_itinerary(
            destination=destination,
            start_date=start_date,
            end_date=end_date,
            budget_level=budget_level,
            preferences=preferences,
            traveler_type=traveler_type,
            constraints=constraints,
            weather_data=weather_data,
            origin=origin,
        )
        if origin:
            itinerary["origin"] = origin  # lets saved/shared trips pre-fill Book Travel

        # Enrich with weather data if not already included
        if "weather_data" not in itinerary:
            itinerary["weather_data_raw"] = weather_data

        return itinerary

    async def replan_trip(
        self,
        original_destination: str,
        start_date: str,
        end_date: str,
        budget_level: str,
        preferences: list[str],
        traveler_type: str,
        constraints: dict[str, Any],
        disruption: str,
        original_summary: str = "",
        locked_activities: list[str] | None = None,
        origin: str | None = None,
    ) -> dict[str, Any]:
        """Re-plan a trip based on a disruption event.

        Args:
            original_destination: Original destination.
            start_date: Trip start date.
            end_date: Trip end date.
            budget_level: Budget tier.
            preferences: User interests.
            traveler_type: Traveler type.
            constraints: Trip constraints.
            disruption: Description of what changed.
            original_summary: Summary of original plan.

        Returns:
            Updated itinerary adapted to the disruption.
        """
        logger.info("Re-planning trip to %s due to: %s", original_destination, disruption)

        # Fetch fresh weather for re-planning
        weather_data = await get_weather_forecast(original_destination, start_date, end_date)

        weather_context = ""
        if weather_data:
            lines = [
                f"{d['date']}: {d['description']}, {d.get('temp_min_c','?')}-{d.get('temp_max_c','?')}°C"
                for d in weather_data
            ]
            weather_context = "Current weather: " + "; ".join(lines)

        context = (
            (f"Traveling from: {origin}. " if origin else "")
            + f"Destination: {original_destination}, "
            f"Dates: {start_date} to {end_date}, "
            f"Budget: {budget_level}, Traveler: {traveler_type}, "
            f"Constraints: {constraints}. "
            f"{weather_context}. "
            f"Original plan summary: {original_summary}"
        )

        result = await generate_replan(context, disruption, preferences, locked_activities or [])
        if origin:
            result["origin"] = origin
        return result
