"""
Centralized configuration for the Pointer backend.
Loads from environment variables for flexibility across dev/prod.
"""

import os
from typing import List
from pathlib import Path

# API Configuration
API_HOST = os.environ.get("API_HOST", "127.0.0.1")
API_PORT = int(os.environ.get("API_PORT", 23816))

# CORS Configuration
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", 
    "http://localhost:3000"
).split(",")
# Strip whitespace from origins
ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS]

# Development/Production
IS_PRODUCTION = os.environ.get("ENVIRONMENT", "development") == "production"
IS_DEVELOPMENT = not IS_PRODUCTION

# Logging
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")

# Codebase Indexer
ENABLE_BACKGROUND_INDEXING = os.environ.get("ENABLE_BACKGROUND_INDEXING", "true").lower() == "true"

# GitHub OAuth (optional)
GITHUB_CLIENT_ID = os.environ.get("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.environ.get("GITHUB_CLIENT_SECRET")

# Print configuration on startup (in development)
if IS_DEVELOPMENT:
    print(f"API Configuration:")
    print(f"  Host: {API_HOST}")
    print(f"  Port: {API_PORT}")
    print(f"  Allowed Origins: {ALLOWED_ORIGINS}")
    print(f"  Background Indexing: {ENABLE_BACKGROUND_INDEXING}")
