"""
Tests for Pointer CLI doctor checks.
"""

from pointer_cli.config import Config
from pointer_cli.doctor import DoctorCheck, apply_safe_fixes, run_doctor, summarize_results


class DummyResponse:
    """Minimal HTTP response stub for urlopen tests."""

    def __init__(self, status: int):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def getcode(self) -> int:
        return self.status


class TestDoctor:
    """Test doctor functionality."""

    def test_summarize_results(self):
        """The summary helper should count statuses correctly."""
        checks = [
            DoctorCheck("Python", "pass", "ok"),
            DoctorCheck("Workspace", "warn", "warn"),
            DoctorCheck("API", "fail", "fail"),
        ]

        assert summarize_results(checks) == (1, 1, 1)

    def test_run_doctor_with_initialized_config(self, monkeypatch, tmp_path):
        """Doctor should report an initialized config and healthy workspace."""
        config_path = tmp_path / "config.json"
        config = Config()
        config.api.base_url = "http://localhost:8000"
        config.api.model_name = "test-model"
        config.initialized = True
        config.save(str(config_path))

        monkeypatch.setattr("pointer_cli.doctor.get_config_path", lambda: tmp_path)
        monkeypatch.setattr("pointer_cli.doctor.ensure_config_dir", lambda: None)
        monkeypatch.setattr("pointer_cli.doctor.get_project_root", lambda: tmp_path)
        monkeypatch.setattr("pointer_cli.doctor.is_git_repo", lambda: True)
        monkeypatch.setattr(
            "pointer_cli.doctor.request.urlopen",
            lambda url, timeout=2.0: DummyResponse(200),
        )

        checks = run_doctor(config, config_path=str(config_path), cwd=tmp_path)
        check_map = {check.name: check for check in checks}

        assert check_map["Configuration"].status == "pass"
        assert check_map["Workspace"].status == "pass"
        assert check_map["API endpoint"].status == "pass"

    def test_run_doctor_warns_when_config_missing(self, monkeypatch, tmp_path):
        """Doctor should warn when no config file exists yet."""
        config = Config()

        monkeypatch.setattr("pointer_cli.doctor.get_config_path", lambda: tmp_path)
        monkeypatch.setattr("pointer_cli.doctor.ensure_config_dir", lambda: None)
        monkeypatch.setattr("pointer_cli.doctor.get_project_root", lambda: None)
        monkeypatch.setattr("pointer_cli.doctor.is_git_repo", lambda: False)
        monkeypatch.setattr(
            "pointer_cli.doctor.request.urlopen",
            lambda url, timeout=2.0: DummyResponse(200),
        )

        checks = run_doctor(config, config_path=str(tmp_path / "missing.json"), cwd=tmp_path)
        check_map = {check.name: check for check in checks}

        assert check_map["Configuration"].status == "warn"
        assert check_map["Workspace"].status == "warn"

    def test_run_doctor_warns_when_api_unreachable(self, monkeypatch, tmp_path):
        """Doctor should warn when the configured API cannot be reached."""
        config = Config()
        config.api.base_url = "http://localhost:9999"

        monkeypatch.setattr("pointer_cli.doctor.get_config_path", lambda: tmp_path)
        monkeypatch.setattr("pointer_cli.doctor.ensure_config_dir", lambda: None)
        monkeypatch.setattr("pointer_cli.doctor.get_project_root", lambda: tmp_path)
        monkeypatch.setattr("pointer_cli.doctor.is_git_repo", lambda: True)

        def raise_url_error(url, timeout=2.0):
            raise OSError("connection refused")

        monkeypatch.setattr("pointer_cli.doctor.request.urlopen", raise_url_error)

        checks = run_doctor(config, config_path=str(tmp_path / "config.json"), cwd=tmp_path)
        check_map = {check.name: check for check in checks}

        assert check_map["API endpoint"].status == "warn"
        assert "Could not reach" in check_map["API endpoint"].details

    def test_apply_safe_fixes_restores_invalid_defaults(self, tmp_path):
        """Safe fixes should restore obvious invalid config values."""
        config_path = tmp_path / "config.json"
        config = Config()
        config.api.base_url = "localhost:8000"
        config.api.model_name = ""
        config.api.timeout = 0
        config.initialized = False

        fixes = apply_safe_fixes(config, config_path=str(config_path))

        assert fixes
        assert config.api.base_url == "http://localhost:8000"
        assert config.api.model_name == "gpt-oss-20b"
        assert config.api.timeout == 30
        assert config.initialized is True
