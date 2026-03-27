"""
Configuration management for Pointer CLI.
"""

import json
from pathlib import Path
from typing import Any, List, Optional, get_args, get_origin

from pydantic import BaseModel, Field

class APIConfig(BaseModel):
    """API configuration settings."""
    base_url: str = Field(default="http://localhost:8000", description="Base URL for AI API")
    model_name: str = Field(default="gpt-oss-20b", description="Model name to use")
    api_key: Optional[str] = Field(default=None, description="API key if required")
    timeout: int = Field(default=30, description="Request timeout in seconds")
    max_retries: int = Field(default=3, description="Maximum retry attempts")

class UIConfig(BaseModel):
    """User interface configuration."""
    show_ai_responses: bool = Field(default=True, description="Show AI chat responses and followup")
    show_thinking: bool = Field(default=True, description="Show AI thinking dialogue (only relevant when show_ai_responses is true)")
    show_tool_outputs: bool = Field(default=True, description="Show tool execution outputs")
    show_diffs: bool = Field(default=True, description="Show diff previews")
    render_markdown: bool = Field(default=True, description="Render Markdown formatting in AI responses")
    theme: str = Field(default="default", description="UI theme")
    max_output_lines: int = Field(default=100, description="Maximum lines to show in output")

class CodebaseConfig(BaseModel):
    """Codebase context configuration."""
    include_context: bool = Field(default=True, description="Include codebase context in AI prompts")
    max_context_files: int = Field(default=20, description="Maximum number of files to include in context")
    context_file_types: List[str] = Field(default=[".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".md", ".txt", ".json", ".yaml", ".yml"], description="File types to include in context")
    exclude_patterns: List[str] = Field(default=["__pycache__", "node_modules", ".git", ".venv", "venv", "env", ".env", "*.pyc", "*.pyo"], description="Patterns to exclude from context")
    context_depth: int = Field(default=3, description="Maximum directory depth to scan for context")
    auto_refresh_context: bool = Field(default=False, description="Automatically refresh context on startup")
    context_cache_duration: int = Field(default=3600, description="Context cache duration in seconds")

class ModeConfig(BaseModel):
    """Mode configuration."""
    auto_run_mode: bool = Field(default=True, description="Execute tools immediately without confirmation")

class Config(BaseModel):
    """Main configuration class."""
    api: APIConfig = Field(default_factory=APIConfig)
    ui: UIConfig = Field(default_factory=UIConfig)
    mode: ModeConfig = Field(default_factory=ModeConfig)
    codebase: CodebaseConfig = Field(default_factory=CodebaseConfig)
    initialized: bool = Field(default=False, description="Whether config is initialized")
    
    model_config = {
        "json_encoders": {
            Path: str,
        }
    }

    @classmethod
    def load(cls, config_path: Optional[str] = None) -> "Config":
        """Load configuration from file or create default."""
        if config_path:
            config_file = Path(config_path)
        else:
            config_file = cls.get_default_config_path()
        
        if config_file.exists():
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                return cls(**data)
            except (json.JSONDecodeError, ValueError) as e:
                print(f"Warning: Invalid config file {config_file}: {e}")
                return cls()
        
        return cls()
    
    def save(self, config_path: Optional[str] = None) -> None:
        """Save configuration to file."""
        if config_path:
            config_file = Path(config_path)
        else:
            config_file = self.get_default_config_path()
        
        # Ensure directory exists
        config_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(self.model_dump(), f, indent=2, ensure_ascii=False)
    
    @classmethod
    def get_default_config_path(cls) -> Path:
        """Get the default configuration file path."""
        config_dir = Path.home() / ".pointer-cli"
        return config_dir / "config.json"
    
    def is_initialized(self) -> bool:
        """Check if configuration is initialized."""
        return self.initialized
    
    def initialize(
        self,
        api_base_url: str,
        model_name: str,
        auto_run_mode: bool = True,
        show_ai_responses: bool = True,
        config_path: Optional[str] = None,
        **kwargs
    ) -> None:
        """Initialize configuration with provided values."""
        self.api.base_url = api_base_url
        self.api.model_name = model_name
        self.mode.auto_run_mode = auto_run_mode
        self.ui.show_ai_responses = show_ai_responses
        self.initialized = True
        
        # Save the configuration
        self.save(config_path)
    
    def update_api_config(self, config_path: Optional[str] = None, **kwargs) -> None:
        """Update API configuration."""
        for key, value in kwargs.items():
            if hasattr(self.api, key):
                setattr(self.api, key, value)
        self.save(config_path)
    
    def update_ui_config(self, config_path: Optional[str] = None, **kwargs) -> None:
        """Update UI configuration."""
        for key, value in kwargs.items():
            if hasattr(self.ui, key):
                setattr(self.ui, key, value)
        self.save(config_path)
    
    def update_mode_config(self, config_path: Optional[str] = None, **kwargs) -> None:
        """Update mode configuration."""
        for key, value in kwargs.items():
            if hasattr(self.mode, key):
                setattr(self.mode, key, value)
        self.save(config_path)
    
    def toggle_auto_run_mode(self) -> bool:
        """Toggle auto-run mode."""
        self.mode.auto_run_mode = not self.mode.auto_run_mode
        self.save()
        return self.mode.auto_run_mode
    

    
    def toggle_ai_responses(self) -> bool:
        """Toggle AI response display."""
        self.ui.show_ai_responses = not self.ui.show_ai_responses
        self.save()
        return self.ui.show_ai_responses
    
    def toggle_thinking(self) -> bool:
        """Toggle AI thinking display."""
        self.ui.show_thinking = not self.ui.show_thinking
        self.save()
        return self.ui.show_thinking

    def validate(self) -> List[str]:
        """Validate configuration values for CLI usage."""
        issues: List[str] = []

        if not self.api.base_url or not self.api.base_url.startswith(("http://", "https://")):
            issues.append("api.base_url must start with http:// or https://")
        if not self.api.model_name.strip():
            issues.append("api.model_name cannot be empty")
        if self.api.timeout <= 0:
            issues.append("api.timeout must be greater than 0")
        if self.api.max_retries < 0:
            issues.append("api.max_retries cannot be negative")
        if self.ui.max_output_lines <= 0:
            issues.append("ui.max_output_lines must be greater than 0")
        if self.codebase.max_context_files <= 0:
            issues.append("codebase.max_context_files must be greater than 0")
        if self.codebase.context_depth < 0:
            issues.append("codebase.context_depth cannot be negative")
        if self.codebase.context_cache_duration < 0:
            issues.append("codebase.context_cache_duration cannot be negative")
        if not self.codebase.context_file_types:
            issues.append("codebase.context_file_types cannot be empty")

        return issues

    def get_value(self, key_path: str) -> Any:
        """Get a configuration value by dotted path."""
        target, field_name = self._resolve_key_path(key_path)
        return getattr(target, field_name)

    def list_key_paths(self) -> List[str]:
        """List all supported dotted configuration keys."""
        key_paths: List[str] = []

        for field_name, field_info in self.__class__.model_fields.items():
            value = getattr(self, field_name)
            if isinstance(value, BaseModel):
                for nested_name in value.__class__.model_fields:
                    key_paths.append(f"{field_name}.{nested_name}")
            else:
                key_paths.append(field_name)

        return sorted(key_paths)

    def suggest_values(self, key_path: str) -> List[str]:
        """Return suggested values for a given config key."""
        target, field_name = self._resolve_key_path(key_path)
        current_value = getattr(target, field_name)

        if isinstance(current_value, bool):
            return ["true", "false"]
        if isinstance(current_value, int) and not isinstance(current_value, bool):
            return [str(current_value)]
        if isinstance(current_value, list):
            return [json.dumps(current_value), ",".join(str(item) for item in current_value)]
        if current_value is None:
            return ["null"]

        return [str(current_value)]

    def set_value(self, key_path: str, raw_value: str, config_path: Optional[str] = None) -> Any:
        """Set a configuration value by dotted path."""
        target, field_name = self._resolve_key_path(key_path)
        field_info = target.__class__.model_fields[field_name]
        current_value = getattr(target, field_name)
        coerced_value = self._coerce_value(raw_value, field_info.annotation, current_value)
        setattr(target, field_name, coerced_value)
        self.save(config_path)
        return coerced_value

    def unset_value(self, key_path: str, config_path: Optional[str] = None) -> Any:
        """Reset a configuration value back to its default."""
        target, field_name = self._resolve_key_path(key_path)
        default_value = self._get_default_value(target, field_name)
        setattr(target, field_name, default_value)
        self.save(config_path)
        return default_value

    def _resolve_key_path(self, key_path: str) -> tuple[BaseModel, str]:
        """Resolve a dotted config key into a model instance and field name."""
        parts = key_path.split(".")
        if not parts:
            raise KeyError("Configuration key cannot be empty.")

        if len(parts) == 1:
            field_name = parts[0]
            if field_name not in self.__class__.model_fields:
                raise KeyError(f"Unknown configuration key: {key_path}")
            return self, field_name

        section_name = parts[0]
        field_name = ".".join(parts[1:])

        if section_name not in self.__class__.model_fields:
            raise KeyError(f"Unknown configuration section: {section_name}")

        target = getattr(self, section_name)
        if not isinstance(target, BaseModel):
            raise KeyError(f"Configuration key {key_path} does not point to a nested section.")

        if field_name not in target.__class__.model_fields:
            raise KeyError(f"Unknown configuration key: {key_path}")

        return target, field_name

    def _coerce_value(self, raw_value: str, annotation: Any, current_value: Any) -> Any:
        """Coerce a string input into the correct config value type."""
        origin = get_origin(annotation)
        args = [arg for arg in get_args(annotation) if arg is not type(None)]

        if origin in (list, List):
            return self._parse_list_value(raw_value)

        if origin is None and annotation is bool:
            return self._parse_bool_value(raw_value)

        if origin is None and annotation is int:
            return int(raw_value)

        if origin is None and annotation is float:
            return float(raw_value)

        if origin is None and annotation is str:
            return raw_value

        if args:
            non_none_type = args[0]
            if raw_value.lower() in {"none", "null"}:
                return None
            return self._coerce_value(raw_value, non_none_type, current_value)

        if isinstance(current_value, bool):
            return self._parse_bool_value(raw_value)
        if isinstance(current_value, int) and not isinstance(current_value, bool):
            return int(raw_value)
        if isinstance(current_value, float):
            return float(raw_value)
        if isinstance(current_value, list):
            return self._parse_list_value(raw_value)

        return raw_value

    def _parse_bool_value(self, raw_value: str) -> bool:
        """Parse common boolean string values."""
        normalized = raw_value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
        raise ValueError(f"Invalid boolean value: {raw_value}")

    def _parse_list_value(self, raw_value: str) -> List[str]:
        """Parse list values from JSON or comma-separated strings."""
        stripped = raw_value.strip()
        if stripped.startswith("["):
            parsed = json.loads(stripped)
            if not isinstance(parsed, list):
                raise ValueError("Expected a JSON array for list configuration.")
            return parsed

        return [item.strip() for item in stripped.split(",") if item.strip()]

    def _get_default_value(self, target: BaseModel, field_name: str) -> Any:
        """Read the default value for a field from its Pydantic model."""
        field_info = target.__class__.model_fields[field_name]
        if field_info.default_factory is not None:
            return field_info.default_factory()
        return field_info.default
