"""Configuration management for Travel Engine.

Loads settings from environment variables. In production (Cloud Run),
these are injected via Secret Manager. Never hardcode API keys.
"""

import os
from dataclasses import dataclass, field


@dataclass
class Settings:
    """Application settings loaded from environment variables."""

    anthropic_auth_token: str = field(default_factory=lambda: os.getenv("ANTHROPIC_AUTH_TOKEN", ""))
    anthropic_base_url: str = field(
        default_factory=lambda: os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
    )
    anthropic_model: str = field(default_factory=lambda: os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"))
    # Groq disabled — Anthropic is the primary provider
    # groq_api_key: str = field(default_factory=lambda: os.getenv("GROQ_API_KEY", ""))
    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
    google_maps_api_key: str = field(default_factory=lambda: os.getenv("GOOGLE_MAPS_API_KEY", ""))
    environment: str = field(default_factory=lambda: os.getenv("ENVIRONMENT", "production"))

    @property
    def llm_provider(self) -> str:
        """Determine which LLM provider to use based on available keys."""
        if self.anthropic_auth_token:
            return "anthropic"
        if self.gemini_api_key:
            return "gemini"
        # if self.groq_api_key:
        #     return "groq"
        return "none"

    def validate(self) -> None:
        """Validate that required settings are present."""
        if self.llm_provider == "none":
            raise ValueError(
                "At least one LLM API key must be set: "
                "ANTHROPIC_AUTH_TOKEN or GEMINI_API_KEY"
            )


# Singleton settings instance
settings = Settings()
