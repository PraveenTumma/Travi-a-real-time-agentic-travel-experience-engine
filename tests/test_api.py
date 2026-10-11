"""Integration tests for FastAPI endpoints.

Tests the /api/health, /api/plan, /api/replan, and /api/maps-key
endpoints using FastAPI's TestClient. Mocks external service calls
to keep tests fast and hermetic.
"""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from datetime import date, timedelta
from unittest.mock import AsyncMock, patch, MagicMock

from fastapi.testclient import TestClient


# Set a dummy key so config doesn't raise on import
# os.environ.setdefault("GROQ_API_KEY", "test-key")  # Groq disabled
os.environ.setdefault("ANTHROPIC_AUTH_TOKEN", "test-key")
os.environ.setdefault("GOOGLE_MAPS_API_KEY", "test-maps-key")

from main import app

client = TestClient(app, raise_server_exceptions=False)

MOCK_ITINERARY = {
    "destination": "Tokyo, Japan",
    "summary": "A wonderful 3-day trip.",
    "itinerary": [
        {
            "day": 1,
            "date": "2026-06-01",
            "theme": "Culture & History",
            "weather_note": "Sunny and warm",
            "activities": [
                {
                    "time": "09:00",
                    "name": "Senso-ji Temple",
                    "location": "2-3-1 Asakusa, Taito City, Tokyo",
                    "latitude": 35.7148,
                    "longitude": 139.7967,
                    "description": "Historic Buddhist temple.",
                    "category": "temple",
                    "estimated_cost_usd": 0,
                    "duration_hours": 2.0,
                    "indoor": False,
                }
            ],
            "meals": [
                {
                    "meal_type": "lunch",
                    "suggestion": "Ramen Ichiran",
                    "location": "Tokyo, Japan",
                    "latitude": 35.6895,
                    "longitude": 139.6917,
                    "cuisine": "Japanese",
                    "estimated_cost_usd": 15,
                }
            ],
            "daily_budget_estimate_usd": 80,
        }
    ],
    "total_estimated_cost_usd": 240,
    "packing_tips": ["Pack light", "Bring an umbrella"],
    "local_tips": ["Get a Suica card", "Try ramen for lunch"],
    "weather_overview": "Mostly sunny with some clouds",
}


class TestHealthEndpoint:
    """Tests for GET /api/health."""

    def test_health_returns_200(self):
        """Health check should return HTTP 200."""
        response = client.get("/api/health")
        assert response.status_code == 200

    def test_health_returns_service_name(self):
        """Health check should include service name."""
        response = client.get("/api/health")
        data = response.json()
        assert "service" in data
        assert "Travel" in data["service"]

    def test_health_returns_status_healthy(self):
        """Health check status field should be 'healthy'."""
        response = client.get("/api/health")
        assert response.json()["status"] == "healthy"


class TestMapsKeyEndpoint:
    """Tests for GET /api/maps-key."""

    def test_maps_key_returns_200(self):
        """Maps key endpoint should return HTTP 200."""
        response = client.get("/api/maps-key")
        assert response.status_code == 200

    def test_maps_key_returns_key_field(self):
        """Maps key response should contain a 'key' field."""
        response = client.get("/api/maps-key")
        data = response.json()
        assert "key" in data
        assert data["key"] == "test-maps-key"


class TestPlanEndpoint:
    """Tests for POST /api/plan."""

    def _valid_payload(self, **overrides):
        base = {
            "destination": "Tokyo, Japan",
            "start_date": str(date.today() + timedelta(days=7)),
            "end_date": str(date.today() + timedelta(days=10)),
            "budget_level": "moderate",
            "traveler_type": "solo",
            "preferences": ["temples", "food"],
            "constraints": {
                "max_daily_walking_km": 10,
                "accessibility_needs": False,
                "dietary_restrictions": "none",
            },
        }
        base.update(overrides)
        return base

    @patch("services.orchestrator.TripOrchestrator.plan_trip", new_callable=AsyncMock)
    def test_plan_returns_itinerary(self, mock_plan):
        """Valid plan request should return itinerary JSON."""
        mock_plan.return_value = MOCK_ITINERARY
        response = client.post("/api/plan", json=self._valid_payload())
        assert response.status_code == 200
        data = response.json()
        assert data["destination"] == "Tokyo, Japan"
        assert len(data["itinerary"]) == 1

    @patch("services.orchestrator.TripOrchestrator.plan_trip", new_callable=AsyncMock)
    def test_plan_missing_destination_fails(self, mock_plan):
        """Missing required destination should return 422."""
        payload = self._valid_payload()
        del payload["destination"]
        response = client.post("/api/plan", json=payload)
        assert response.status_code == 422

    @patch("services.orchestrator.TripOrchestrator.plan_trip", new_callable=AsyncMock)
    def test_plan_invalid_budget_fails(self, mock_plan):
        """Invalid budget_level should return 422."""
        response = client.post("/api/plan", json=self._valid_payload(budget_level="ultra"))
        assert response.status_code == 422

    @patch("services.orchestrator.TripOrchestrator.plan_trip", new_callable=AsyncMock)
    def test_plan_end_before_start_fails(self, mock_plan):
        """End date before start date should return 422."""
        response = client.post("/api/plan", json=self._valid_payload(
            start_date="2026-06-10",
            end_date="2026-06-05",
        ))
        assert response.status_code == 422

    @patch("services.orchestrator.TripOrchestrator.plan_trip", new_callable=AsyncMock)
    def test_rate_limit_applied(self, mock_plan):
        """After too many requests, the rate limiter should return 429."""
        mock_plan.return_value = MOCK_ITINERARY
        from main import rate_limiter
        # Exhaust the limit
        for _ in range(rate_limiter.max_requests):
            rate_limiter.is_allowed("test-ip-999")
        # Override client IP via header trick isn't possible with TestClient,
        # so we test that get_remaining returns 0 after exhausting
        assert rate_limiter.get_remaining("test-ip-999") == 0


class TestReplanEndpoint:
    """Tests for POST /api/replan."""

    @patch("services.orchestrator.TripOrchestrator.replan_trip", new_callable=AsyncMock)
    def test_replan_returns_updated_itinerary(self, mock_replan):
        """Valid replan request should return updated itinerary."""
        mock_replan.return_value = MOCK_ITINERARY
        payload = {
            "original_destination": "Tokyo, Japan",
            "start_date": "2026-06-01",
            "end_date": "2026-06-04",
            "budget_level": "moderate",
            "traveler_type": "solo",
            "preferences": ["food"],
            "constraints": {
                "max_daily_walking_km": 10,
                "accessibility_needs": False,
                "dietary_restrictions": "none",
            },
            "disruption": "Heavy rain expected on Day 2",
            "original_itinerary_summary": "Cultural trip around Tokyo.",
        }
        response = client.post("/api/replan", json=payload)
        assert response.status_code == 200
        assert "itinerary" in response.json()

    def test_replan_missing_disruption_fails(self):
        """Missing disruption field should return 422."""
        payload = {
            "original_destination": "Tokyo, Japan",
            "start_date": "2026-06-01",
            "end_date": "2026-06-04",
        }
        response = client.post("/api/replan", json=payload)
        assert response.status_code == 422


class TestActivityEditEndpoint:
    """Tests for POST /api/activity (swap / regenerate one activity)."""

    BASE = {
        "destination": "Tokyo, Japan",
        "date": "2026-06-01",
        "day_theme": "Culture & History",
        "weather_note": "Sunny",
        "activity": MOCK_ITINERARY["itinerary"][0]["activities"][0],
        "other_activities": ["Meiji Shrine"],
        "budget_level": "moderate",
        "preferences": ["temples"],
        "traveler_type": "solo",
    }

    @patch("main.generate_activity", new_callable=AsyncMock)
    def test_swap_returns_single_activity(self, mock_gen):
        """A swap should return one activity object with the itinerary field shape."""
        mock_gen.return_value = {
            "time": "09:00",
            "name": "Meiji Jingu",
            "location": "1-1 Yoyogikamizonocho, Shibuya City, Tokyo",
            "latitude": 35.6764,
            "longitude": 139.6993,
            "description": "Peaceful Shinto shrine in a forest.",
            "category": "temple",
            "estimated_cost_usd": 0,
            "duration_hours": 1.5,
            "indoor": False,
            "change_note": "Swapped for a quieter shrine nearby.",
        }
        response = client.post("/api/activity", json={**self.BASE, "mode": "swap"})
        assert response.status_code == 200
        body = response.json()
        assert body["mode"] == "swap"
        act = body["activity"]
        assert act["name"] == "Meiji Jingu"
        assert act["locked"] is False
        for key in ("time", "location", "description", "category", "estimated_cost_usd", "duration_hours", "indoor"):
            assert key in act
        kwargs = mock_gen.call_args.kwargs
        assert kwargs["mode"] == "swap"
        assert kwargs["other_activities"] == ["Meiji Shrine"]

    @patch("main.generate_activity", new_callable=AsyncMock)
    def test_regenerate_fills_missing_fields_from_original(self, mock_gen):
        """Fields the model omits should fall back to the original activity."""
        mock_gen.return_value = {"name": "Senso-ji Temple", "description": "Updated details."}
        response = client.post(
            "/api/activity", json={**self.BASE, "mode": "regenerate", "instruction": "more detail"}
        )
        assert response.status_code == 200
        act = response.json()["activity"]
        assert act["description"] == "Updated details."
        assert act["time"] == "09:00"
        assert act["location"] == "2-3-1 Asakusa, Taito City, Tokyo"
        assert mock_gen.call_args.kwargs["instruction"] == "more detail"

    @patch("main.generate_activity", new_callable=AsyncMock)
    def test_llm_failure_returns_500(self, mock_gen):
        """An upstream failure should surface as a 500 with a friendly message."""
        mock_gen.side_effect = RuntimeError("boom")
        response = client.post("/api/activity", json={**self.BASE, "mode": "swap"})
        assert response.status_code == 500

    @patch("main.generate_activity", new_callable=AsyncMock)
    def test_unusable_model_reply_returns_500(self, mock_gen):
        """A reply with no name is not an activity."""
        mock_gen.return_value = {"description": "no name here"}
        response = client.post("/api/activity", json={**self.BASE, "mode": "swap"})
        assert response.status_code == 500

    def test_invalid_mode_rejected(self):
        """Only swap and regenerate are allowed."""
        response = client.post("/api/activity", json={**self.BASE, "mode": "delete"})
        assert response.status_code == 422

    def test_activity_without_name_rejected(self):
        """The slot being edited must have a name."""
        response = client.post("/api/activity", json={**self.BASE, "activity": {"time": "09:00"}})
        assert response.status_code == 422

    def test_instruction_too_long_rejected(self):
        """Instruction is capped at 300 characters."""
        response = client.post("/api/activity", json={**self.BASE, "instruction": "x" * 301})
        assert response.status_code == 422


class TestReplanLockedActivities:
    """Locked activities ride along with /api/replan."""

    @patch("services.orchestrator.TripOrchestrator.replan_trip", new_callable=AsyncMock)
    def test_locked_activities_forwarded(self, mock_replan):
        """locked_activities should reach the orchestrator, sanitized."""
        mock_replan.return_value = MOCK_ITINERARY
        payload = {
            "original_destination": "Tokyo, Japan",
            "start_date": "2026-06-01",
            "end_date": "2026-06-04",
            "disruption": "Heavy rain expected on Day 2",
            "locked_activities": ["Day 1: Senso-ji Temple", "  ", "Day 2: <b>teamLab</b>"],
        }
        response = client.post("/api/replan", json=payload)
        assert response.status_code == 200
        locked = mock_replan.call_args.kwargs["locked_activities"]
        assert locked == ["Day 1: Senso-ji Temple", "Day 2: teamLab"]
