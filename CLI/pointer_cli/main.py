#!/usr/bin/env python3
"""
Main entry point for Pointer CLI.
"""

import json
import logging
import sys
from pathlib import Path
from typing import Optional
from urllib import error, request

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .chat_manager import ChatManager
from .codebase_context import CodebaseContext
from .config import Config
from .core import PointerCLI
from .doctor import apply_safe_fixes, checks_to_dict, run_doctor, summarize_results
from .utils import ensure_config_dir, get_project_root, is_git_repo

logger = logging.getLogger(__name__)

app = typer.Typer(
    name="pointer",
    help="Pointer CLI - AI-powered local codebase assistant",
    no_args_is_help=False,
    invoke_without_command=True,
)
config_app = typer.Typer(help="Inspect and update Pointer CLI configuration.")
context_app = typer.Typer(help="Inspect and manage codebase context.")
chats_app = typer.Typer(help="Manage saved chat sessions.")
app.add_typer(config_app, name="config")
app.add_typer(context_app, name="context")
app.add_typer(chats_app, name="chats")

console = Console()

EXIT_OK = 0
EXIT_GENERAL_ERROR = 1
EXIT_CONFIG_ERROR = 2
EXIT_DEPENDENCY_ERROR = 3
EXIT_USER_CANCELLED = 4


def main() -> None:
    """Entry point for the pointer command."""
    app()


@app.callback(invoke_without_command=True)
def cli_main(
    ctx: typer.Context,
    version: bool = typer.Option(False, "--version", "-v", help="Show version information"),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
    init: bool = typer.Option(False, "--init", help="Initialize configuration"),
) -> None:
    """
    Pointer CLI - A professional command-line interface for AI-powered local codebase assistance.

    On first run, the CLI will prompt for initialization and configuration.
    """
    if ctx.invoked_subcommand is not None:
        return

    if version:
        try:
            from . import __version__
            console.print(f"Pointer CLI v{__version__}")
        except ImportError:
            console.print("Pointer CLI (version unknown)")
        return

    try:
        ensure_config_dir()
        config = Config.load(config_path)
        logger.debug(f"Config loaded from {config_path or 'default location'}")

        if init or not config.is_initialized():
            if not _initialize_config(config, config_path=config_path):
                console.print("[red]Initialization cancelled.[/red]")
                logger.info("User cancelled initialization")
                raise typer.Exit(code=EXIT_USER_CANCELLED)

        _raise_for_invalid_config(config)

        cli = PointerCLI(config)
        cli.run()

    except typer.Exit:
        raise
    except KeyboardInterrupt:
        console.print("\n[yellow]Goodbye![/yellow]")
        logger.info("User interrupted with keyboard")
        sys.exit(EXIT_OK)
    except Exception as exc:
        logger.error(f"Unexpected error: {type(exc).__name__}: {exc}", exc_info=True)
        console.print(f"[red]Error: {exc}[/red]")
        sys.exit(EXIT_GENERAL_ERROR)


def _initialize_config(config: Config, config_path: Optional[str] = None) -> bool:
    """Initialize the configuration interactively."""
    console.print(
        Panel.fit(
            "[bold blue]Welcome to Pointer CLI![/bold blue]\n\n"
            "This is your first time running Pointer CLI. Let's set up your configuration.",
            title="Initialization",
        )
    )

    response = typer.confirm("Initialize Pointer CLI?", default=True)
    if not response:
        return False

    console.print("\n[bold]API Configuration[/bold]")
    api_base_url = typer.prompt(
        "API Base URL",
        default="http://localhost:8000",
        help="Base URL for your local AI API",
    )

    model_name = typer.prompt(
        "Model Name",
        default="gpt-oss-20b",
        help="Model to use for AI interactions",
    )

    config.initialize(
        api_base_url=api_base_url,
        model_name=model_name,
        auto_run_mode=True,
        show_ai_responses=True,
        config_path=config_path,
    )

    console.print("[green]Configuration initialized successfully.[/green]")
    return True


def _raise_for_invalid_config(config: Config) -> None:
    """Raise a config-specific exit when validation fails."""
    issues = config.validate()
    if issues:
        for issue in issues:
            console.print(f"[red]{issue}[/red]")
        raise typer.Exit(code=EXIT_CONFIG_ERROR)


def _load_validated_config(config_path: Optional[str] = None) -> Config:
    """Load config and stop with a config exit code if invalid."""
    ensure_config_dir()
    config = Config.load(config_path)
    _raise_for_invalid_config(config)
    return config


def _get_codebase_context(config_path: Optional[str] = None) -> tuple[Config, CodebaseContext]:
    """Create a validated codebase context helper."""
    config = _load_validated_config(config_path)
    return config, CodebaseContext(config)


def _get_chat_manager(config_path: Optional[str] = None) -> ChatManager:
    """Create a chat manager rooted at the active config directory."""
    config_file = Path(config_path) if config_path else Config.get_default_config_path()
    config_dir = config_file.parent
    config_dir.mkdir(parents=True, exist_ok=True)
    return ChatManager(config_dir)


def _complete_chat_ids(ctx: typer.Context, incomplete: str) -> list[str]:
    """Autocomplete saved chat ids."""
    config_path = ctx.params.get("config_path")
    try:
        manager = _get_chat_manager(config_path)
        chat_ids = [chat["id"] for chat in manager.list_chats()]
    except Exception:
        return []

    return [chat_id for chat_id in chat_ids if chat_id.startswith(incomplete)]


def _complete_config_keys(ctx: typer.Context, incomplete: str) -> list[str]:
    """Autocomplete dotted configuration keys."""
    config_path = ctx.params.get("config_path")
    try:
        config = Config.load(config_path)
        candidates = config.list_key_paths()
    except Exception:
        candidates = Config().list_key_paths()

    return [candidate for candidate in candidates if candidate.startswith(incomplete)]


def _complete_config_values(ctx: typer.Context, incomplete: str) -> list[str]:
    """Autocomplete plausible values for a config key."""
    key_path = ctx.params.get("key_path")
    config_path = ctx.params.get("config_path")
    if not key_path:
        return []

    try:
        config = Config.load(config_path)
        candidates = config.suggest_values(key_path)
    except Exception:
        return []

    normalized = incomplete.lower()
    return [candidate for candidate in candidates if candidate.lower().startswith(normalized)]


def _complete_context_query(ctx: typer.Context, incomplete: str) -> list[str]:
    """Autocomplete context search queries from indexed filenames and paths."""
    config_path = ctx.params.get("config_path")

    try:
        config, codebase_context = _get_codebase_context(config_path)
    except typer.Exit:
        return []
    except Exception:
        return []

    if not config.codebase.include_context:
        return []

    codebase_context.force_refresh()
    suggestions = set()
    for file_info in codebase_context.context_cache.values():
        suggestions.add(file_info.name)
        suggestions.add(file_info.relative_path)

    normalized = incomplete.lower()
    return sorted(suggestion for suggestion in suggestions if suggestion.lower().startswith(normalized))[:25]


def _complete_context_files(ctx: typer.Context, incomplete: str) -> list[str]:
    """Autocomplete indexed relative file paths for context inspection."""
    config_path = ctx.params.get("config_path")

    try:
        config, codebase_context = _get_codebase_context(config_path)
    except typer.Exit:
        return []
    except Exception:
        return []

    if not config.codebase.include_context:
        return []

    codebase_context.force_refresh()
    normalized = incomplete.lower()
    return sorted(
        relative_path
        for relative_path in codebase_context.context_cache
        if relative_path.lower().startswith(normalized)
    )[:50]


@app.command("init")
def init_command(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
    api_base_url: str = typer.Option("http://localhost:8000", "--api-base-url", help="Base URL for your local AI API"),
    model_name: str = typer.Option("gpt-oss-20b", "--model", help="Model to use for AI interactions"),
    auto_run: bool = typer.Option(True, "--auto-run/--manual", help="Enable or disable automatic tool execution"),
    show_ai_responses: bool = typer.Option(
        True,
        "--show-ai-responses/--hide-ai-responses",
        help="Show or hide AI responses in the UI",
    ),
    non_interactive: bool = typer.Option(
        False,
        "--non-interactive",
        help="Initialize immediately without prompts using the provided option values.",
    ),
) -> None:
    """Initialize Pointer CLI configuration."""
    ensure_config_dir()
    config = Config.load(config_path)

    if non_interactive:
        config.initialize(
            api_base_url=api_base_url,
            model_name=model_name,
            auto_run_mode=auto_run,
            show_ai_responses=show_ai_responses,
            config_path=config_path,
        )
        _raise_for_invalid_config(config)
        target_path = config_path or str(Config.get_default_config_path())
        console.print(f"[green]Initialized configuration at {target_path}.[/green]")
        return

    if not _initialize_config(config, config_path=config_path):
        console.print("[red]Initialization cancelled.[/red]")
        raise typer.Exit(code=EXIT_USER_CANCELLED)

    _raise_for_invalid_config(config)


@config_app.command("show")
def config_show_command(
    key_path: Optional[str] = typer.Argument(
        None,
        help="Optional dotted config key like api.base_url",
        autocompletion=_complete_config_keys,
    ),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Show the current configuration or a single config value."""
    config = _load_validated_config(config_path)

    if key_path:
        try:
            value = config.get_value(key_path)
        except KeyError as exc:
            console.print(f"[red]{exc}[/red]")
            raise typer.Exit(code=EXIT_CONFIG_ERROR)

        if isinstance(value, (dict, list)):
            console.print(json.dumps(value, indent=2))
        else:
            console.print(value)
        return

    console.print(json.dumps(config.model_dump(), indent=2))


@config_app.command("set")
def config_set_command(
    key_path: str = typer.Argument(
        ...,
        help="Dotted config key like api.base_url or ui.show_diffs",
        autocompletion=_complete_config_keys,
    ),
    value: str = typer.Argument(..., help="New value to store", autocompletion=_complete_config_values),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Set a configuration value by dotted path."""
    ensure_config_dir()
    config = Config.load(config_path)

    try:
        new_value = config.set_value(key_path, value, config_path=config_path)
        _raise_for_invalid_config(config)
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(code=EXIT_CONFIG_ERROR)

    console.print(f"[green]Updated {key_path} to {new_value!r}.[/green]")


@config_app.command("unset")
def config_unset_command(
    key_path: str = typer.Argument(
        ...,
        help="Dotted config key to reset back to its default value",
        autocompletion=_complete_config_keys,
    ),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Reset a configuration value back to its default."""
    ensure_config_dir()
    config = Config.load(config_path)

    try:
        new_value = config.unset_value(key_path, config_path=config_path)
        _raise_for_invalid_config(config)
    except KeyError as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(code=EXIT_CONFIG_ERROR)

    console.print(f"[green]Reset {key_path} to {new_value!r}.[/green]")


@config_app.command("edit")
def config_edit_command(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Open the config file in the default editor, or print its path if opening fails."""
    ensure_config_dir()
    resolved_path = Path(config_path) if config_path else Config.get_default_config_path()
    config = Config.load(str(resolved_path))
    if not resolved_path.exists():
        config.save(str(resolved_path))

    try:
        os.startfile(str(resolved_path))  # type: ignore[attr-defined]
        console.print(f"[green]Opened config file: {resolved_path}[/green]")
    except Exception:
        console.print(f"Config file: {resolved_path}")


@app.command("status")
def status_command(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
    json_output: bool = typer.Option(False, "--json", help="Emit machine-readable JSON output"),
) -> None:
    """Show the current CLI environment and configuration status."""
    config = _load_validated_config(config_path)
    if json_output:
        console.print(json.dumps(_build_status_payload(config, config_path), indent=2))
        return
    table = _build_status_table(config, config_path)
    console.print(table)


def _build_status_table(config: Config, config_path: Optional[str] = None) -> Table:
    """Create a status table for the current environment."""
    config_file = config_path or str(Config.get_default_config_path())
    project_root = get_project_root()

    table = Table(title="Pointer CLI Status")
    table.add_column("Field", style="bold")
    table.add_column("Value", overflow="fold")

    table.add_row("Config file", config_file)
    table.add_row("Initialized", str(config.is_initialized()))
    table.add_row("Current directory", str(Path.cwd()))
    table.add_row("Project root", str(project_root) if project_root else "Not detected")
    table.add_row("Git repository", str(is_git_repo()))
    table.add_row("API base URL", config.api.base_url)
    table.add_row("Model", config.api.model_name)
    table.add_row("Mode", "Auto-Run" if config.mode.auto_run_mode else "Manual")
    table.add_row("Show AI responses", str(config.ui.show_ai_responses))
    table.add_row("Context enabled", str(config.codebase.include_context))

    return table


def _build_status_payload(config: Config, config_path: Optional[str] = None) -> dict:
    """Create machine-readable status output."""
    project_root = get_project_root()
    return {
        "config_file": config_path or str(Config.get_default_config_path()),
        "initialized": config.is_initialized(),
        "current_directory": str(Path.cwd()),
        "project_root": str(project_root) if project_root else None,
        "git_repository": is_git_repo(),
        "api_base_url": config.api.base_url,
        "model": config.api.model_name,
        "mode": "auto-run" if config.mode.auto_run_mode else "manual",
        "show_ai_responses": config.ui.show_ai_responses,
        "context_enabled": config.codebase.include_context,
    }


@context_app.command("show")
def context_show_command(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Show a summary of the current codebase context."""
    config, codebase_context = _get_codebase_context(config_path)
    if not config.codebase.include_context:
        console.print("[yellow]Codebase context is disabled.[/yellow]")
        return

    summary = codebase_context.get_context_summary()
    if not summary:
        console.print("[yellow]No codebase context available.[/yellow]")
        return

    table = Table(title="Pointer CLI Context")
    table.add_column("Field", style="bold")
    table.add_column("Value", overflow="fold")
    table.add_row("Project root", str(summary.get("project_root") or "Not detected"))
    table.add_row("Total files", str(summary.get("total_files", 0)))
    table.add_row(
        "File types",
        ", ".join(f"{ext}({count})" for ext, count in summary.get("file_types", {}).items()) or "None",
    )
    table.add_row("Last updated", str(summary.get("last_updated", "Never")))
    console.print(table)


@context_app.command("refresh")
def context_refresh_command(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Refresh cached codebase context."""
    config, codebase_context = _get_codebase_context(config_path)
    if not config.codebase.include_context:
        console.print("[yellow]Codebase context is disabled.[/yellow]")
        return

    codebase_context.force_refresh()
    summary = codebase_context.get_context_summary()
    console.print(f"[green]Context refreshed. Indexed {summary.get('total_files', 0)} files.[/green]")


@context_app.command("search")
def context_search_command(
    query: str = typer.Argument(
        ...,
        help="Text to search within the cached context",
        autocompletion=_complete_context_query,
    ),
    limit: int = typer.Option(10, "--limit", min=1, help="Maximum number of files to show"),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Search filenames, paths, and previews in the cached codebase context."""
    config, codebase_context = _get_codebase_context(config_path)
    if not config.codebase.include_context:
        console.print("[yellow]Codebase context is disabled.[/yellow]")
        return

    results = codebase_context.search_context(query)
    if not results:
        console.print(f"[yellow]No context files found for '{query}'.[/yellow]")
        return

    table = Table(title=f"Context Search: {query}")
    table.add_column("File", style="bold")
    table.add_column("Lines")
    table.add_column("Preview", overflow="fold")

    for file_info in results[:limit]:
        preview = file_info.content_preview.replace("\n", " ")[:120]
        table.add_row(file_info.relative_path, str(file_info.lines), preview)

    console.print(table)


@context_app.command("files")
def context_files_command(
    limit: int = typer.Option(25, "--limit", min=1, help="Maximum number of indexed files to show"),
    extension: Optional[str] = typer.Option(None, "--ext", help="Optional file extension filter such as .py"),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """List files currently indexed in codebase context."""
    config, codebase_context = _get_codebase_context(config_path)
    if not config.codebase.include_context:
        console.print("[yellow]Codebase context is disabled.[/yellow]")
        return

    codebase_context.force_refresh()
    files = list(codebase_context.context_cache.values())
    if extension:
        files = [file_info for file_info in files if file_info.extension == extension]

    if not files:
        message = f"No indexed files found for extension '{extension}'." if extension else "No indexed files found."
        console.print(f"[yellow]{message}[/yellow]")
        return

    files.sort(key=lambda file_info: file_info.relative_path)

    table = Table(title="Pointer CLI Context Files")
    table.add_column("File", style="bold")
    table.add_column("Type")
    table.add_column("Lines")
    table.add_column("Size")

    for file_info in files[:limit]:
        table.add_row(file_info.relative_path, file_info.extension, str(file_info.lines), file_info.size_formatted)

    console.print(table)


@context_app.command("inspect")
def context_inspect_command(
    file_path: str = typer.Argument(
        ...,
        help="Relative path of the indexed file to inspect",
        autocompletion=_complete_context_files,
    ),
    json_output: bool = typer.Option(False, "--json", help="Emit machine-readable JSON output"),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Inspect a single indexed file from codebase context."""
    config, codebase_context = _get_codebase_context(config_path)
    if not config.codebase.include_context:
        console.print("[yellow]Codebase context is disabled.[/yellow]")
        return

    codebase_context.force_refresh()
    file_info = codebase_context.get_file_context(file_path)
    if file_info is None:
        console.print(f"[yellow]No indexed file found for '{file_path}'.[/yellow]")
        return

    payload = {
        "path": file_info.relative_path,
        "extension": file_info.extension,
        "lines": file_info.lines,
        "size": file_info.size,
        "size_formatted": file_info.size_formatted,
        "modified": file_info.modified,
        "preview": file_info.content_preview,
    }

    if json_output:
        console.print(json.dumps(payload, indent=2))
        return

    panel_body = (
        f"Path: {file_info.relative_path}\n"
        f"Extension: {file_info.extension}\n"
        f"Lines: {file_info.lines}\n"
        f"Size: {file_info.size_formatted}\n\n"
        f"Preview:\n{file_info.content_preview or '[No preview available]'}"
    )
    console.print(Panel(panel_body, title="Context File", border_style="blue"))


@context_app.command("rebuild")
def context_rebuild_command(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Fully rebuild the cached codebase context."""
    config, codebase_context = _get_codebase_context(config_path)
    if not config.codebase.include_context:
        console.print("[yellow]Codebase context is disabled.[/yellow]")
        return

    codebase_context.context_cache.clear()
    codebase_context.last_refresh = 0
    codebase_context.force_refresh()
    summary = codebase_context.get_context_summary()
    console.print(f"[green]Context rebuilt. Indexed {summary.get('total_files', 0)} files.[/green]")


@context_app.command("stats")
def context_stats_command(
    json_output: bool = typer.Option(False, "--json", help="Emit machine-readable JSON output"),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Show detailed statistics about indexed codebase context."""
    config, codebase_context = _get_codebase_context(config_path)
    if not config.codebase.include_context:
        console.print("[yellow]Codebase context is disabled.[/yellow]")
        return

    codebase_context.force_refresh()
    files = list(codebase_context.context_cache.values())
    extension_counts = codebase_context._get_file_type_summary()
    total_size = sum(file_info.size for file_info in files)
    largest_files = sorted(files, key=lambda file_info: file_info.size, reverse=True)[:5]

    payload = {
        "total_files": len(files),
        "total_size_bytes": total_size,
        "extensions": extension_counts,
        "largest_files": [
            {
                "path": file_info.relative_path,
                "size": file_info.size,
                "size_formatted": file_info.size_formatted,
                "lines": file_info.lines,
            }
            for file_info in largest_files
        ],
        "exclude_patterns": config.codebase.exclude_patterns,
        "context_depth": config.codebase.context_depth,
    }

    if json_output:
        console.print(json.dumps(payload, indent=2))
        return

    table = Table(title="Pointer CLI Context Stats")
    table.add_column("Metric", style="bold")
    table.add_column("Value", overflow="fold")
    table.add_row("Total files", str(payload["total_files"]))
    table.add_row("Total size", f"{total_size} bytes")
    table.add_row(
        "Extensions",
        ", ".join(f"{ext}({count})" for ext, count in extension_counts.items()) or "None",
    )
    table.add_row(
        "Largest files",
        ", ".join(f"{item['path']} ({item['size_formatted']})" for item in payload["largest_files"]) or "None",
    )
    table.add_row("Exclude patterns", ", ".join(config.codebase.exclude_patterns))
    table.add_row("Context depth", str(config.codebase.context_depth))
    console.print(table)


@context_app.command("config")
def context_config_command(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Show codebase context-related configuration."""
    config = _load_validated_config(config_path)
    console.print(
        json.dumps(
            {
                "include_context": config.codebase.include_context,
                "max_context_files": config.codebase.max_context_files,
                "context_depth": config.codebase.context_depth,
                "auto_refresh_context": config.codebase.auto_refresh_context,
                "context_cache_duration": config.codebase.context_cache_duration,
                "context_file_types": config.codebase.context_file_types,
                "exclude_patterns": config.codebase.exclude_patterns,
            },
            indent=2,
        )
    )


@context_app.command("enable")
def context_enable_command(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Enable codebase context collection."""
    config = _load_validated_config(config_path)
    config.set_value("codebase.include_context", "true", config_path=config_path)
    console.print("[green]Codebase context enabled.[/green]")


@context_app.command("disable")
def context_disable_command(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Disable codebase context collection."""
    config = _load_validated_config(config_path)
    config.set_value("codebase.include_context", "false", config_path=config_path)
    console.print("[yellow]Codebase context disabled.[/yellow]")


@chats_app.command("export")
def chats_export_command(
    chat_id: str = typer.Argument(..., help="Chat ID to export", autocompletion=_complete_chat_ids),
    export_format: str = typer.Option("markdown", "--format", help="Export format: markdown or json"),
    output_path: Optional[str] = typer.Option(None, "--output", "-o", help="Optional file path to write the export to"),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Export a saved chat as markdown or JSON."""
    if export_format not in {"markdown", "json"}:
        console.print("[red]Export format must be 'markdown' or 'json'.[/red]")
        raise typer.Exit(code=EXIT_CONFIG_ERROR)

    manager = _get_chat_manager(config_path)
    exported = manager.export_chat(chat_id, export_format=export_format)
    if exported is None:
        console.print(f"[red]Chat not found: {chat_id}[/red]")
        raise typer.Exit(code=EXIT_CONFIG_ERROR)

    if output_path:
        destination = Path(output_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(exported, encoding="utf-8")
        console.print(f"[green]Exported chat to {destination}.[/green]")
        return

    console.print(exported)


@chats_app.command("rename")
def chats_rename_command(
    chat_id: str = typer.Argument(..., help="Chat ID to rename", autocompletion=_complete_chat_ids),
    title: str = typer.Argument(..., help="New title for the chat"),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Rename a saved chat session."""
    manager = _get_chat_manager(config_path)
    if not manager.rename_chat(chat_id, title):
        console.print(f"[red]Chat not found: {chat_id}[/red]")
        raise typer.Exit(code=EXIT_CONFIG_ERROR)

    console.print(f"[green]Renamed {chat_id} to {title!r}.[/green]")


@chats_app.command("list")
def chats_list_command(
    json_output: bool = typer.Option(False, "--json", help="Emit machine-readable JSON output"),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """List saved chat sessions."""
    manager = _get_chat_manager(config_path)
    chats = manager.list_chats()

    if json_output:
        console.print(json.dumps(chats, indent=2))
        return

    if not chats:
        console.print("[yellow]No saved chats found.[/yellow]")
        return

    table = Table(title="Pointer CLI Chats")
    table.add_column("Chat ID", style="bold")
    table.add_column("Title")
    table.add_column("Messages")
    table.add_column("Tokens")
    table.add_column("Last Modified")

    for chat in chats:
        table.add_row(
            chat["id"],
            chat["title"],
            str(chat["message_count"]),
            str(chat["total_tokens"]),
            chat["last_modified"],
        )

    console.print(table)


@chats_app.command("delete")
def chats_delete_command(
    chat_id: str = typer.Argument(..., help="Chat ID to delete", autocompletion=_complete_chat_ids),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Delete a saved chat session."""
    manager = _get_chat_manager(config_path)
    if not manager.delete_chat(chat_id):
        console.print(f"[red]Chat not found: {chat_id}[/red]")
        raise typer.Exit(code=EXIT_CONFIG_ERROR)

    console.print(f"[green]Deleted chat {chat_id}.[/green]")


@chats_app.command("current")
def chats_current_command(
    json_output: bool = typer.Option(False, "--json", help="Emit machine-readable JSON output"),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
) -> None:
    """Show the most recently modified saved chat."""
    manager = _get_chat_manager(config_path)
    chats = manager.list_chats()
    if not chats:
        console.print("[yellow]No saved chats found.[/yellow]")
        return

    current_chat = chats[0]
    if json_output:
        console.print(json.dumps(current_chat, indent=2))
        return

    table = Table(title="Pointer CLI Current Chat")
    table.add_column("Field", style="bold")
    table.add_column("Value", overflow="fold")
    for key in ["id", "title", "message_count", "total_tokens", "last_modified"]:
        table.add_row(key, str(current_chat[key]))
    console.print(table)


@app.command("models")
def models_command(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
    json_output: bool = typer.Option(False, "--json", help="Emit machine-readable JSON output"),
) -> None:
    """Show the configured model and try to discover remote models."""
    config = _load_validated_config(config_path)
    configured_model = config.api.model_name
    discovered_models = []

    try:
        with request.urlopen(f"{config.api.base_url.rstrip('/')}/v1/models", timeout=config.api.timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
            for item in payload.get("data", []):
                model_id = item.get("id")
                if model_id:
                    discovered_models.append(model_id)
    except Exception:
        discovered_models = []

    payload = {
        "configured_model": configured_model,
        "api_base_url": config.api.base_url,
        "discovered_models": discovered_models,
    }

    if json_output:
        console.print(json.dumps(payload, indent=2))
        return

    table = Table(title="Pointer CLI Models")
    table.add_column("Type", style="bold")
    table.add_column("Value", overflow="fold")
    table.add_row("Configured", configured_model)
    table.add_row("API Base URL", config.api.base_url)
    table.add_row("Discovered", ", ".join(discovered_models) if discovered_models else "No remote model list available")
    console.print(table)


@app.command("ping")
def ping_command(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
    json_output: bool = typer.Option(False, "--json", help="Emit machine-readable JSON output"),
) -> None:
    """Check API reachability and print simple latency information."""
    config = _load_validated_config(config_path)
    health_url = f"{config.api.base_url.rstrip('/')}/health"
    start = __import__("time").time()

    try:
        with request.urlopen(health_url, timeout=config.api.timeout) as response:
            latency_ms = int((__import__("time").time() - start) * 1000)
            status = getattr(response, "status", response.getcode())
            if json_output:
                console.print(json.dumps({"ok": True, "url": health_url, "status": status, "latency_ms": latency_ms}, indent=2))
                return
            console.print(f"[green]OK[/green] {health_url} responded with HTTP {status} in {latency_ms} ms.")
    except error.HTTPError as exc:
        latency_ms = int((__import__("time").time() - start) * 1000)
        if json_output:
            console.print(json.dumps({"ok": False, "url": health_url, "status": exc.code, "latency_ms": latency_ms}, indent=2))
            raise typer.Exit(code=EXIT_DEPENDENCY_ERROR)
        console.print(f"[yellow]WARN[/yellow] {health_url} responded with HTTP {exc.code} in {latency_ms} ms.")
    except Exception as exc:
        if json_output:
            console.print(json.dumps({"ok": False, "url": health_url, "error": str(exc)}, indent=2))
        console.print(f"[red]Ping failed:[/red] {exc}")
        raise typer.Exit(code=EXIT_DEPENDENCY_ERROR)


@app.command("doctor")
def doctor_command(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config file"),
    timeout: float = typer.Option(2.0, "--timeout", help="HTTP timeout in seconds for API connectivity checks"),
    json_output: bool = typer.Option(False, "--json", help="Emit machine-readable JSON output"),
    fix: bool = typer.Option(False, "--fix", help="Apply safe local fixes for common config issues before checking"),
) -> None:
    """Run basic health checks for the local Pointer CLI setup."""
    ensure_config_dir()
    config = Config.load(config_path)
    applied_fixes = []
    if fix:
        applied_fixes = apply_safe_fixes(config, config_path=config_path)
        config = Config.load(config_path)
    checks = run_doctor(config, config_path=config_path, timeout=timeout)
    passing, warnings, failing = summarize_results(checks)

    if json_output:
        console.print(
            json.dumps(
                {
                    "summary": {
                        "passing": passing,
                        "warnings": warnings,
                        "failures": failing,
                    },
                    "checks": checks_to_dict(checks),
                    "fixes": applied_fixes,
                },
                indent=2,
            )
        )
        if failing:
            raise typer.Exit(code=EXIT_DEPENDENCY_ERROR)
        return

    if applied_fixes:
        fix_table = Table(title="Applied Fixes")
        fix_table.add_column("Fix", overflow="fold")
        for item in applied_fixes:
            fix_table.add_row(item)
        console.print(fix_table)

    table = Table(title="Pointer CLI Doctor")
    table.add_column("Check", style="bold")
    table.add_column("Status")
    table.add_column("Details", overflow="fold")

    status_styles = {
        "pass": "[green]PASS[/green]",
        "warn": "[yellow]WARN[/yellow]",
        "fail": "[red]FAIL[/red]",
    }

    for check in checks:
        table.add_row(check.name, status_styles.get(check.status, check.status.upper()), check.details)

    console.print(table)
    console.print(
        Panel.fit(
            f"[green]Passing:[/green] {passing}    [yellow]Warnings:[/yellow] {warnings}    [red]Failures:[/red] {failing}",
            title="Summary",
        )
    )

    if failing:
        raise typer.Exit(code=EXIT_DEPENDENCY_ERROR)


if __name__ == "__main__":
    app()
