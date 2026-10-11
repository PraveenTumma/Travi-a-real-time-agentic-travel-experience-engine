"""Pydantic models for request/response validation.

Strict typing ensures data integrity and provides automatic
API documentation via FastAPI's OpenAPI integration.
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class TripConstraints(BaseModel):
    """User-defined constraints for trip planning."""

    max_daily_walking_km: float = Field(
        default=10.0,
        ge=0.5,
        le=50.0,
        description="Maximum daily walking distance in kilometers",
    )
    accessibility_needs: bool = Field(
        default=False,
        description="Whether wheelchair/mobility accessibility is required",
    )
    dietary_restrictions: str = Field(
        default="none",
        max_length=200,
        description="Dietary restrictions (e.g., vegetarian, halal, gluten-free)",
    )


class TripRequest(BaseModel):
    """Request model for trip planning."""

    destination: str = Field(
        ...,
        min_length=2,
        max_length=200,
        description="Travel destination city and country",
        examples=["Tokyo, Japan"],
    )
    start_date: date = Field(
        ...,
        description="Trip start date in YYYY-MM-DD format",
    )
    end_date: date = Field(
        ...,
        description="Trip end date in YYYY-MM-DD format",
    )
    budget_level: str = Field(
        default="moderate",
        description="Budget level: budget, moderate, or luxury",
    )
    preferences: list[str] = Field(
        default_factory=list,
        max_length=10,
        description="Travel interests/preferences",
        examples=[["street food", "temples", "nature"]],
    )
    traveler_type: str = Field(
        default="solo",
        description="Type of traveler: solo, couple, family, group",
    )
    constraints: TripConstraints = Field(
        default_factory=TripConstraints,
        description="Trip constraints",
    )
    origin: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Where the traveler starts from (optional), e.g. 'Hyderabad, Telangana, India'",
    )

    @field_validator("origin")
    @classmethod
    def clean_origin(cls, v: Optional[str]) -> Optional[str]:
        """Blank origin means 'not provided'."""
        v = (v or "").strip()
        return v or None

    @field_validator("budget_level")
    @classmethod
    def validate_budget_level(cls, v: str) -> str:
        """Ensure budget level is one of the allowed values."""
        allowed = {"budget", "moderate", "luxury"}
        if v.lower() not in allowed:
            raise ValueError(f"budget_level must be one of: {allowed}")
        return v.lower()

    @field_validator("traveler_type")
    @classmethod
    def validate_traveler_type(cls, v: str) -> str:
        """Ensure traveler type is one of the allowed values."""
        allowed = {"solo", "couple", "family", "group"}
        if v.lower() not in allowed:
            raise ValueError(f"traveler_type must be one of: {allowed}")
        return v.lower()

    @field_validator("end_date")
    @classmethod
    def validate_dates(cls, v: date, info) -> date:
        """Ensure end date is after start date."""
        if "start_date" in info.data and v <= info.data["start_date"]:
            raise ValueError("end_date must be after start_date")
        return v

    @field_validator("preferences")
    @classmethod
    def validate_preferences(cls, v: list[str]) -> list[str]:
        """Sanitize and validate preferences."""
        return [p.strip().lower()[:50] for p in v if p.strip()]


class ReplanRequest(BaseModel):
    """Request model for dynamic re-planning."""

    original_destination: str = Field(
        ..., min_length=2, max_length=200,
        description="Original trip destination",
    )
    start_date: date = Field(..., description="Trip start date")
    end_date: date = Field(..., description="Trip end date")
    budget_level: str = Field(default="moderate")
    preferences: list[str] = Field(default_factory=list)
    traveler_type: str = Field(default="solo")
    constraints: TripConstraints = Field(default_factory=TripConstraints)
    disruption: str = Field(
        ...,
        min_length=5,
        max_length=500,
        description="Description of the disruption event",
        examples=["Heavy rain expected on Day 2", "Museum closed for renovation"],
    )
    original_itinerary_summary: str = Field(
        default="",
        max_length=5000,
        description="Summary of the original itinerary to adjust",
    )
    locked_activities: list[str] = Field(
        default_factory=list,
        max_length=60,
        description="Activities the traveler locked (\"Day 2: Senso-ji Temple\"); the re-plan must keep them",
    )

    @field_validator("locked_activities")
    @classmethod
    def validate_locked(cls, v: list[str]) -> list[str]:
        """Trim and cap each locked-activity label."""
        return [a.strip()[:150] for a in v if isinstance(a, str) and a.strip()]

    origin: Optional[str] = Field(default=None, max_length=200, description="Where the traveler starts from")

    @field_validator("origin")
    @classmethod
    def clean_origin(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip()
        return v or None


class ActivityEditRequest(BaseModel):
    """Request model for editing a single itinerary activity in place."""

    destination: str = Field(..., min_length=2, max_length=200)
    date: str = Field(default="", max_length=20, description="Date of the day being edited")
    day_theme: str = Field(default="", max_length=200)
    weather_note: str = Field(default="", max_length=500)
    mode: str = Field(
        default="swap",
        description="swap = a different activity for this slot; regenerate = same idea, fresh details",
    )
    instruction: str = Field(
        default="",
        max_length=300,
        description="Optional free-text request, e.g. 'cheaper', 'earlier', 'kid-friendly'",
    )
    activity: dict = Field(..., description="The activity object currently in the slot")
    other_activities: list[str] = Field(
        default_factory=list,
        max_length=20,
        description="Names of the other activities that day, so the model avoids duplicates",
    )
    budget_level: str = Field(default="moderate")
    preferences: list[str] = Field(default_factory=list, max_length=10)
    traveler_type: str = Field(default="solo")
    constraints: TripConstraints = Field(default_factory=TripConstraints)

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        """Only two edit modes exist."""
        allowed = {"swap", "regenerate"}
        if v.lower() not in allowed:
            raise ValueError(f"mode must be one of: {allowed}")
        return v.lower()

    @field_validator("activity")
    @classmethod
    def validate_activity(cls, v: dict) -> dict:
        """The slot must at least have a name; cap the payload size."""
        if not isinstance(v, dict) or not str(v.get("name", "")).strip():
            raise ValueError("activity.name is required")
        if len(str(v)) > 4000:
            raise ValueError("activity payload too large")
        return v

    @field_validator("other_activities")
    @classmethod
    def validate_other(cls, v: list[str]) -> list[str]:
        """Trim and cap sibling activity names."""
        return [a.strip()[:150] for a in v if isinstance(a, str) and a.strip()]


class Activity(BaseModel):
    """A single activity in the itinerary."""
    time: str
    name: str
    description: str
    category: str
    estimated_cost_usd: float = 0
    duration_hours: float = 1.0
    indoor: bool = False


class Meal(BaseModel):
    """A meal suggestion."""
    meal_type: str
    suggestion: str
    cuisine: str
    estimated_cost_usd: float = 10


class DayPlan(BaseModel):
    """Plan for a single day."""
    day: int
    date: str
    theme: str
    weather_note: str = ""
    activities: list[Activity] = Field(default_factory=list)
    meals: list[Meal] = Field(default_factory=list)
    daily_budget_estimate_usd: float = 0


class ItineraryResponse(BaseModel):
    """Response model for generated itinerary."""
    destination: str
    summary: str
    itinerary: list[DayPlan]
    total_estimated_cost_usd: float
    packing_tips: list[str] = Field(default_factory=list)
    local_tips: list[str] = Field(default_factory=list)
    weather_overview: str = ""


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = "healthy"
    service: str = "Travel Planning & Experience Engine"
    version: str = "1.0.0"
    llm_provider: str = ""
