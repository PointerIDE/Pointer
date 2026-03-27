"""
Health checks for Pointer CLI environments.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib import error, request

from .config import Config
from .utils import ensure_config_dir, get_config_path, get_project_root, is_git_repo


@dataclass
class DoctorCheck:
    """Represents a single doctor check result."""

    name: str
    status: str
    details: str


def run_doctor(
    config: Config,
    config_path: Optional[str] = None,
    cwd: Optional[Path] = None,
    timeout: float = 2.0,
) -> List[DoctorCheck]:
    """Run environment checks and return structured results."""
    working_directory = cwd or Path.cwd()
    resolved_config_path = Path(config_path) if config_path else Config.get_default_config_path()

    checks = [
        _check_python_version(),
        _check_config_directory(),
        _check_config_file(config, resolved_config_path),
        _check_config_validity(config),
        _check_workspace(working_directory),
        _check_api_endpoint(config.api.base_url, timeout=timeout),
    ]

    return checks


def checks_to_dict(checks: List[DoctorCheck]) -> List[Dict[str, Any]]:
    """Serialize doctor checks for machine-readable output."""
    return [
        {
            "name": check.name,
            "status": check.status,
            "details": check.details,
        }
        for check in checks
    ]


def apply_safe_fixes(config: Config, config_path: Optional[str] = None) -> List[str]:
    """Apply safe, local fixes for common doctor findings."""
    fixes: List[str] = []
    ensure_config_dir()

    resolved_config_path = Path(config_path) if config_path else Config.get_default_config_path()
    if not resolved_config_path.exists():
        config.save(str(resolved_config_path))
        fixes.append(f"Created config file at {resolved_config_path}.")

    if not config.is_initialized():
        config.initialized = True
        config.save(str(resolved_config_path))
        fixes.append("Marked configuration as initialized.")

    if not config.api.base_url.startswith(("http://", "https://")):
        config.api.base_url = "http://localhost:8000"
        fixes.append("Reset api.base_url to http://localhost:8000.")

    if not config.api.model_name.strip():
        config.api.model_name = "gpt-oss-20b"
        fixes.append("Reset api.model_name to gpt-oss-20b.")

    if config.api.timeout <= 0:
        config.api.timeout = 30
        fixes.append("Reset api.timeout to 30.")

    if config.api.max_retries < 0:
        config.api.max_retries = 3
        fixes.append("Reset api.max_retries to 3.")

    if config.ui.max_output_lines <= 0:
        config.ui.max_output_lines = 100
        fixes.append("Reset ui.max_output_lines to 100.")

    if config.codebase.max_context_files <= 0:
        config.codebase.max_context_files = 20
        fixes.append("Reset codebase.max_context_files to 20.")

    if config.codebase.context_depth < 0:
        config.codebase.context_depth = 3
        fixes.append("Reset codebase.context_depth to 3.")

    if config.codebase.context_cache_duration < 0:
        config.codebase.context_cache_duration = 3600
        fixes.append("Reset codebase.context_cache_duration to 3600.")

    if not config.codebase.context_file_types:
        config.codebase.context_file_types = [".py", ".js", ".ts", ".jsx", ".tsx", ".md", ".json"]
        fixes.append("Restored default codebase.context_file_types.")

    if fixes:
        config.save(str(resolved_config_path))

    return fixes


def summarize_results(checks: List[DoctorCheck]) -> tuple[int, int, int]:
    """Return counts for passing, warning, and failing checks."""
    passing = sum(1 for check in checks if check.status == "pass")
    warnings = sum(1 for check in checks if check.status == "warn")
    failing = sum(1 for check in checks if check.status == "fail")
    return passing, warnings, failing


def _check_python_version() -> DoctorCheck:
    """Ensure the current Python version is supported."""
    version = sys.version_info
    version_text = f"{version.major}.{version.minor}.{version.micro}"

    if version >= (3, 8):
        return DoctorCheck("Python", "pass", f"Using Python {version_text}.")

    return DoctorCheck("Python", "fail", f"Python {version_text} is too old; Pointer CLI requires 3.8+.")


def _check_config_directory() -> DoctorCheck:
    """Verify the config directory exists and is writable."""
    ensure_config_dir()
    config_dir = get_config_path()

    if not config_dir.exists():
        return DoctorCheck("Config directory", "fail", f"Directory {config_dir} could not be created.")

    if os.access(config_dir, os.W_OK):
        return DoctorCheck("Config directory", "pass", f"Directory {config_dir} is writable.")

    return DoctorCheck("Config directory", "fail", f"Directory {config_dir} is not writable.")


def _check_config_file(config: Config, config_path: Path) -> DoctorCheck:
    """Report config file and initialization status."""
    if not config_path.exists():
        return DoctorCheck(
            "Configuration",
            "warn",
            f"No config file found at {config_path}. Run `pointer --init` to create one.",
        )

    if not config.is_initialized():
        return DoctorCheck(
            "Configuration",
            "warn",
            f"Config file exists at {config_path}, but setup is incomplete. Run `pointer --init`.",
        )

    return DoctorCheck(
        "Configuration",
        "pass",
        f"Loaded initialized config from {config_path} using model `{config.api.model_name}`.",
    )


def _check_workspace(cwd: Path) -> DoctorCheck:
    """Detect whether the current working directory belongs to a git workspace."""
    project_root = get_project_root()
    if project_root and is_git_repo():
        return DoctorCheck("Workspace", "pass", f"Git repository detected at {project_root}.")

    return DoctorCheck(
        "Workspace",
        "warn",
        f"No git repository detected from {cwd}. Pointer works best inside a project checkout.",
    )


def _check_config_validity(config: Config) -> DoctorCheck:
    """Validate the loaded configuration values."""
    issues = config.validate()
    if not issues:
        return DoctorCheck("Config validity", "pass", "Configuration values are valid.")

    return DoctorCheck("Config validity", "fail", "; ".join(issues))


def _check_api_endpoint(base_url: str, timeout: float = 2.0) -> DoctorCheck:
    """Check whether the configured API base URL appears reachable."""
    normalized = base_url.rstrip("/")
    candidates = [f"{normalized}/health", normalized]

    last_error = None
    for url in candidates:
        try:
            with request.urlopen(url, timeout=timeout) as response:
                status_code = getattr(response, "status", response.getcode())
                if 200 <= status_code < 500:
                    return DoctorCheck("API endpoint", "pass", f"Connected to {url} (HTTP {status_code}).")
        except error.HTTPError as exc:
            if 200 <= exc.code < 500:
                return DoctorCheck("API endpoint", "pass", f"Connected to {url} (HTTP {exc.code}).")
            last_error = f"HTTP {exc.code}"
        except error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            last_error = str(reason)
        except Exception as exc:  # pragma: no cover - defensive fallback
            last_error = str(exc)

    return DoctorCheck(
        "API endpoint",
        "warn",
        f"Could not reach {base_url}. Start your local API or update the configured base URL. Last error: {last_error or 'unknown'}",
    )
