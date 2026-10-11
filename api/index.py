"""Vercel serverless entrypoint: serves the FastAPI backend under /api on the same domain as the frontend."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app  # noqa: E402,F401
