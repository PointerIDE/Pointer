"""
Tests for Pointer CLI command entry points.
"""

import json
from types import SimpleNamespace

from typer.testing import CliRunner

from pointer_cli.main import (
    app,
    EXIT_CONFIG_ERROR,
    EXIT_DEPENDENCY_ERROR,
    EXIT_USER_CANCELLED,
    _complete_config_keys,
    _complete_config_values,
    _complete_context_query,
)


runner = CliRunner()


class TestMainCommands:
    """Test top-level CLI commands."""

    def test_config_show_outputs_json(self, tmp_path):
        """`pointer config show` should print the config file contents."""
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "http://localhost:8000",
                        "model_name": "test-model",
                        "api_key": None,
                        "timeout": 30,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": True,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": True,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {
                        "auto_run_mode": True,
                    },
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py"],
                        "exclude_patterns": [".git"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 3600,
                    },
                    "initialized": True,
                }
            ),
            encoding="utf-8",
        )

        result = runner.invoke(app, ["config", "show", "--config", str(config_path)])

        assert result.exit_code == 0
        assert "test-model" in result.stdout
        assert '"initialized": true' in result.stdout.lower()

    def test_config_set_updates_nested_value(self, tmp_path):
        """`pointer config set` should persist nested config changes."""
        config_path = tmp_path / "config.json"

        result = runner.invoke(
            app,
            ["config", "set", "api.base_url", "http://localhost:9000", "--config", str(config_path)],
        )

        assert result.exit_code == 0
        saved = json.loads(config_path.read_text(encoding="utf-8"))
        assert saved["api"]["base_url"] == "http://localhost:9000"

    def test_config_unset_restores_default_value(self, tmp_path):
        """`pointer config unset` should reset fields to their defaults."""
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "http://localhost:8000",
                        "model_name": "test-model",
                        "api_key": None,
                        "timeout": 30,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": True,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": False,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {"auto_run_mode": True},
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py"],
                        "exclude_patterns": [".git"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 3600,
                    },
                    "initialized": True,
                }
            ),
            encoding="utf-8",
        )

        result = runner.invoke(app, ["config", "unset", "ui.show_diffs", "--config", str(config_path)])

        assert result.exit_code == 0
        saved = json.loads(config_path.read_text(encoding="utf-8"))
        assert saved["ui"]["show_diffs"] is True

    def test_config_edit_falls_back_to_printing_path(self, tmp_path, monkeypatch):
        """`pointer config edit` should print the config path if opening fails."""
        config_path = tmp_path / "config.json"
        monkeypatch.setattr("pointer_cli.main.os.startfile", lambda path: (_ for _ in ()).throw(OSError("nope")), raising=False)

        result = runner.invoke(app, ["config", "edit", "--config", str(config_path)])

        assert result.exit_code == 0
        assert str(config_path) in result.stdout

    def test_init_non_interactive_writes_config(self, tmp_path):
        """`pointer init --non-interactive` should create an initialized config."""
        config_path = tmp_path / "config.json"

        result = runner.invoke(
            app,
            [
                "init",
                "--non-interactive",
                "--config",
                str(config_path),
                "--api-base-url",
                "http://localhost:1234",
                "--model",
                "demo-model",
                "--manual",
                "--hide-ai-responses",
            ],
        )

        assert result.exit_code == 0
        saved = json.loads(config_path.read_text(encoding="utf-8"))
        assert saved["initialized"] is True
        assert saved["api"]["base_url"] == "http://localhost:1234"
        assert saved["api"]["model_name"] == "demo-model"
        assert saved["mode"]["auto_run_mode"] is False
        assert saved["ui"]["show_ai_responses"] is False

    def test_config_set_invalid_key_returns_config_exit_code(self, tmp_path):
        """Invalid config keys should return the config-specific exit code."""
        config_path = tmp_path / "config.json"

        result = runner.invoke(
            app,
            ["config", "set", "api.missing", "value", "--config", str(config_path)],
        )

        assert result.exit_code == EXIT_CONFIG_ERROR

    def test_init_cancel_returns_user_cancelled_exit_code(self, tmp_path):
        """Interactive init cancellation should use the user-cancelled exit code."""
        config_path = tmp_path / "config.json"

        result = runner.invoke(
            app,
            ["init", "--config", str(config_path)],
            input="n\n",
        )

        assert result.exit_code == EXIT_USER_CANCELLED

    def test_status_command_outputs_environment_summary(self, tmp_path):
        """`pointer status` should print a concise environment summary."""
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "http://localhost:7777",
                        "model_name": "status-model",
                        "api_key": None,
                        "timeout": 30,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": False,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": True,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {
                        "auto_run_mode": False,
                    },
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py"],
                        "exclude_patterns": [".git"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 3600,
                    },
                    "initialized": True,
                }
            ),
            encoding="utf-8",
        )

        result = runner.invoke(app, ["status", "--config", str(config_path)])

        assert result.exit_code == 0
        assert "Pointer CLI Status" in result.stdout
        assert "status-model" in result.stdout
        assert "http://localhost:7777" in result.stdout

    def test_status_json_outputs_machine_readable_status(self, tmp_path):
        """`pointer status --json` should emit structured JSON."""
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "http://localhost:7777",
                        "model_name": "status-model",
                        "api_key": None,
                        "timeout": 30,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": False,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": True,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {"auto_run_mode": False},
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py"],
                        "exclude_patterns": [".git"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 3600,
                    },
                    "initialized": True,
                }
            ),
            encoding="utf-8",
        )

        result = runner.invoke(app, ["status", "--json", "--config", str(config_path)])

        assert result.exit_code == 0
        payload = json.loads(result.stdout)
        assert payload["model"] == "status-model"
        assert payload["api_base_url"] == "http://localhost:7777"

    def test_doctor_json_outputs_machine_readable_result(self, tmp_path):
        """`pointer doctor --json` should emit structured JSON."""
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "http://localhost:8000",
                        "model_name": "json-model",
                        "api_key": None,
                        "timeout": 30,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": True,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": True,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {"auto_run_mode": True},
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py"],
                        "exclude_patterns": [".git"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 3600,
                    },
                    "initialized": True,
                }
            ),
            encoding="utf-8",
        )

        result = runner.invoke(app, ["doctor", "--json", "--config", str(config_path)])

        assert result.exit_code == 0
        payload = json.loads(result.stdout)
        assert payload["summary"]["passing"] >= 1
        assert any(check["name"] == "Config validity" for check in payload["checks"])

    def test_doctor_invalid_config_returns_dependency_exit_code(self, tmp_path):
        """Invalid config should surface as a doctor failure in JSON mode."""
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "localhost:8000",
                        "model_name": "",
                        "api_key": None,
                        "timeout": 0,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": True,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": True,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {"auto_run_mode": True},
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py"],
                        "exclude_patterns": [".git"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 3600,
                    },
                    "initialized": True,
                }
            ),
            encoding="utf-8",
        )

        result = runner.invoke(app, ["doctor", "--json", "--config", str(config_path)])

        assert result.exit_code == EXIT_DEPENDENCY_ERROR
        payload = json.loads(result.stdout)
        assert payload["summary"]["failures"] >= 1

    def test_doctor_fix_repairs_invalid_config(self, tmp_path):
        """`pointer doctor --fix --json` should repair safe config issues."""
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "localhost:8000",
                        "model_name": "",
                        "api_key": None,
                        "timeout": 0,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": True,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": True,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {"auto_run_mode": True},
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py"],
                        "exclude_patterns": [".git"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 3600,
                    },
                    "initialized": False,
                }
            ),
            encoding="utf-8",
        )

        result = runner.invoke(app, ["doctor", "--fix", "--json", "--config", str(config_path)])

        assert result.exit_code == 0
        payload = json.loads(result.stdout)
        assert payload["fixes"]
        saved = json.loads(config_path.read_text(encoding="utf-8"))
        assert saved["api"]["base_url"] == "http://localhost:8000"
        assert saved["api"]["model_name"] == "gpt-oss-20b"

    def test_context_show_outputs_summary(self, tmp_path, monkeypatch):
        """`pointer context show` should summarize indexed project files."""
        (tmp_path / ".git").mkdir()
        (tmp_path / "app.py").write_text("print('hello')\n", encoding="utf-8")
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "http://localhost:8000",
                        "model_name": "context-model",
                        "api_key": None,
                        "timeout": 30,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": True,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": True,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {"auto_run_mode": True},
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py"],
                        "exclude_patterns": ["node_modules"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 0,
                    },
                    "initialized": True,
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.chdir(tmp_path)

        result = runner.invoke(app, ["context", "show", "--config", str(config_path)])

        assert result.exit_code == 0
        assert "Pointer CLI Context" in result.stdout
        assert "Total files" in result.stdout

    def test_context_search_finds_file(self, tmp_path, monkeypatch):
        """`pointer context search` should find matches in file content previews."""
        (tmp_path / ".git").mkdir()
        (tmp_path / "module.py").write_text("special_keyword = True\n", encoding="utf-8")
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "http://localhost:8000",
                        "model_name": "context-model",
                        "api_key": None,
                        "timeout": 30,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": True,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": True,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {"auto_run_mode": True},
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py"],
                        "exclude_patterns": ["node_modules"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 0,
                    },
                    "initialized": True,
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.chdir(tmp_path)

        result = runner.invoke(app, ["context", "search", "special_keyword", "--config", str(config_path)])

        assert result.exit_code == 0
        assert "module.py" in result.stdout

    def test_context_files_lists_indexed_files(self, tmp_path, monkeypatch):
        """`pointer context files` should list indexed files and respect extension filters."""
        (tmp_path / ".git").mkdir()
        (tmp_path / "module.py").write_text("print('x')\n", encoding="utf-8")
        (tmp_path / "notes.md").write_text("# hi\n", encoding="utf-8")
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "http://localhost:8000",
                        "model_name": "context-model",
                        "api_key": None,
                        "timeout": 30,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": True,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": True,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {"auto_run_mode": True},
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py", ".md"],
                        "exclude_patterns": ["node_modules"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 0,
                    },
                    "initialized": True,
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.chdir(tmp_path)

        result = runner.invoke(app, ["context", "files", "--ext", ".py", "--config", str(config_path)])

        assert result.exit_code == 0
        assert "module.py" in result.stdout
        assert "notes.md" not in result.stdout

    def test_invalid_config_returns_config_exit_code_for_status(self, tmp_path):
        """Validated commands should stop with the config exit code."""
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "localhost:8000",
                        "model_name": "bad",
                        "api_key": None,
                        "timeout": 30,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": True,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": True,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {"auto_run_mode": True},
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py"],
                        "exclude_patterns": [".git"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 3600,
                    },
                    "initialized": True,
                }
            ),
            encoding="utf-8",
        )

        result = runner.invoke(app, ["status", "--config", str(config_path)])

        assert result.exit_code == EXIT_CONFIG_ERROR

    def test_complete_config_keys_suggests_matching_dotted_keys(self):
        """Config key completion should return matching dotted keys."""
        ctx = SimpleNamespace(params={"config_path": None})

        completions = _complete_config_keys(ctx, "api.")

        assert "api.base_url" in completions
        assert "api.model_name" in completions

    def test_complete_config_values_uses_current_field_type(self, tmp_path):
        """Value completion should offer boolean and current-value suggestions."""
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "http://localhost:8080",
                        "model_name": "demo-model",
                        "api_key": None,
                        "timeout": 15,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": True,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": True,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {"auto_run_mode": True},
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py"],
                        "exclude_patterns": [".git"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 3600,
                    },
                    "initialized": True,
                }
            ),
            encoding="utf-8",
        )

        bool_ctx = SimpleNamespace(params={"config_path": str(config_path), "key_path": "ui.show_diffs"})
        text_ctx = SimpleNamespace(params={"config_path": str(config_path), "key_path": "api.base_url"})

        assert _complete_config_values(bool_ctx, "t") == ["true"]
        assert _complete_config_values(text_ctx, "http://loc") == ["http://localhost:8080"]

    def test_complete_context_query_uses_indexed_files(self, tmp_path, monkeypatch):
        """Context query completion should suggest filenames and relative paths."""
        (tmp_path / ".git").mkdir()
        (tmp_path / "services").mkdir()
        (tmp_path / "services" / "api.py").write_text("print('api')\n", encoding="utf-8")
        config_path = tmp_path / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "api": {
                        "base_url": "http://localhost:8000",
                        "model_name": "demo-model",
                        "api_key": None,
                        "timeout": 30,
                        "max_retries": 3,
                    },
                    "ui": {
                        "show_ai_responses": True,
                        "show_thinking": True,
                        "show_tool_outputs": True,
                        "show_diffs": True,
                        "render_markdown": True,
                        "theme": "default",
                        "max_output_lines": 100,
                    },
                    "mode": {"auto_run_mode": True},
                    "codebase": {
                        "include_context": True,
                        "max_context_files": 20,
                        "context_file_types": [".py"],
                        "exclude_patterns": ["node_modules"],
                        "context_depth": 3,
                        "auto_refresh_context": False,
                        "context_cache_duration": 3600,
                    },
                    "initialized": True,
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.chdir(tmp_path)
        ctx = SimpleNamespace(params={"config_path": str(config_path)})

        completions = _complete_context_query(ctx, "ser")

        assert "services/api.py" in completions
