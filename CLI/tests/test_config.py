"""
Tests for configuration management.
"""

import json
import tempfile
from pathlib import Path
import pytest

from pointer_cli.config import Config, APIConfig, UIConfig, ModeConfig

class TestConfig:
    """Test configuration functionality."""
    
    def test_default_config(self):
        """Test default configuration creation."""
        config = Config()
        
        assert config.api.base_url == "http://localhost:8000"
        assert config.api.model_name == "gpt-oss-20b"
        assert config.ui.show_ai_responses is True
        assert config.mode.auto_run_mode is True
        assert config.initialized is False
    
    def test_config_initialization(self):
        """Test configuration initialization."""
        config = Config()
        
        config.initialize(
            api_base_url="http://localhost:1234",
            model_name="gpt-oss-20b",
            auto_run_mode=False,
            show_ai_responses=False
        )
        
        assert config.api.base_url == "http://localhost:1234"
        assert config.api.model_name == "gpt-oss-20b"
        assert config.mode.auto_run_mode is False
        assert config.ui.show_ai_responses is False
        assert config.initialized is True
    
    def test_config_save_load(self):
        """Test configuration save and load."""
        with tempfile.TemporaryDirectory() as temp_dir:
            config_file = Path(temp_dir) / "test_config.json"
            
            # Create and save config
            config = Config()
            config.initialize(
                api_base_url="http://test:8000",
                model_name="test-model"
            )
            config.save(str(config_file))
            
            # Load config
            loaded_config = Config.load(str(config_file))
            
            assert loaded_config.api.base_url == "http://test:8000"
            assert loaded_config.api.model_name == "test-model"
            assert loaded_config.initialized is True
    
    def test_config_toggle_methods(self):
        """Test configuration toggle methods."""
        config = Config()
        
        # Test auto-run toggle
        assert config.mode.auto_run_mode is True
        new_mode = config.toggle_auto_run_mode()
        assert new_mode is False
        assert config.mode.auto_run_mode is False
        

        
        # Test AI responses toggle
        assert config.ui.show_ai_responses is True
        new_setting = config.toggle_ai_responses()
        assert new_setting is False
        assert config.ui.show_ai_responses is False
    
    def test_config_update_methods(self):
        """Test configuration update methods."""
        config = Config()
        
        # Test API config update
        config.update_api_config(
            base_url="http://new-api:8000",
            model_name="new-model"
        )
        assert config.api.base_url == "http://new-api:8000"
        assert config.api.model_name == "new-model"
        
        # Test UI config update
        config.update_ui_config(
            show_ai_responses=False,
            theme="dark"
        )
        assert config.ui.show_ai_responses is False
        assert config.ui.theme == "dark"
        
        # Test mode config update
        config.update_mode_config(
            auto_run_mode=False
        )
        assert config.mode.auto_run_mode is False

    def test_get_value(self):
        """Test dotted configuration lookup."""
        config = Config()

        assert config.get_value("api.base_url") == "http://localhost:8000"
        assert config.get_value("initialized") is False

    def test_set_value(self):
        """Test dotted configuration updates with type coercion."""
        with tempfile.TemporaryDirectory() as temp_dir:
            config_file = Path(temp_dir) / "test_config.json"
            config = Config()

            config.set_value("api.timeout", "45", config_path=str(config_file))
            config.set_value("ui.show_diffs", "false", config_path=str(config_file))
            config.set_value("codebase.exclude_patterns", "node_modules,.git,dist", config_path=str(config_file))

            assert config.api.timeout == 45
            assert config.ui.show_diffs is False
            assert config.codebase.exclude_patterns == ["node_modules", ".git", "dist"]

    def test_set_value_invalid_key(self):
        """Unknown dotted keys should raise KeyError."""
        config = Config()

        with pytest.raises(KeyError):
            config.set_value("api.missing_key", "value")

    def test_validate_reports_invalid_values(self):
        """Validation should report user-fixable config issues."""
        config = Config()
        config.api.base_url = "localhost:8000"
        config.api.model_name = ""
        config.api.timeout = 0
        config.codebase.max_context_files = 0

        issues = config.validate()

        assert "api.base_url must start with http:// or https://" in issues
        assert "api.model_name cannot be empty" in issues
        assert "api.timeout must be greater than 0" in issues
        assert "codebase.max_context_files must be greater than 0" in issues

    def test_list_key_paths(self):
        """Config should expose dotted keys for shell completion."""
        config = Config()

        keys = config.list_key_paths()

        assert "api.base_url" in keys
        assert "ui.show_diffs" in keys
        assert "codebase.context_depth" in keys
        assert "initialized" in keys

    def test_suggest_values(self):
        """Config should suggest sensible completion candidates for values."""
        config = Config()

        assert config.suggest_values("ui.show_diffs") == ["true", "false"]
        assert config.suggest_values("api.timeout") == ["30"]
        assert config.suggest_values("api.base_url") == ["http://localhost:8000"]

    def test_unset_value_restores_default(self):
        """Unset should restore a field to its default value."""
        config = Config()
        config.ui.show_diffs = False

        restored = config.unset_value("ui.show_diffs")

        assert restored is True
        assert config.ui.show_diffs is True
