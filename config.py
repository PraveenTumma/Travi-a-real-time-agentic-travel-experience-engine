"""Configuration management for Travel Engine.

Loads settings from environment variables. In production (Cloud Run),
these are injected via Secret Manager. Never hardcode API keys.
"""

import os
from dataclasses import dataclass, field


@dataclass
class Settings:
    """Application settings loaded from environment variables."""

    anthropic_api_key: str = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", ""))
    groq_api_key: str = field(default_factory=lambda: os.getenv("GROQ_API_KEY", ""))
    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
    google_maps_api_key: str = field(default_factory=lambda: os.getenv("GOOGLE_MAPS_API_KEY", ""))
    environment: str = field(default_factory=lambda: os.getenv("ENVIRONMENT", "production"))

    @property
    def llm_provider(self) -> str:
        """Determine which LLM provider to use based on available keys."""
        if self.anthropic_api_key:
            return "anthropic"
        if self.gemini_api_key:
            return "gemini"
        if self.groq_api_key:
            return "groq"
        return "none"

    def validate(self) -> None:
        """Validate that required settings are present."""
        if not (self.anthropic_api_key or self.groq_api_key or self.gemini_api_key):
            raise ValueError(
                "At least one LLM API key must be set: "
                "ANTHROPIC_API_KEY, GROQ_API_KEY or GEMINI_API_KEY"
            )


# Singleton settings instance
settings = Settings()
