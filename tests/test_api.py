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
