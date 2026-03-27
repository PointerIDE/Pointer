#!/usr/bin/env python3
"""
Main entry point for Pointer CLI.
"""

import json
import os
from pathlib import Path
import sys
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .codebase_context import CodebaseContext
from .config import Config
from .core import PointerCLI
from .doctor import apply_safe_fixes, checks_to_dict, run_doctor, summarize_results
from .utils import ensure_config_dir, get_project_root, is_git_repo

app = typer.Typer(
    name="pointer",
    help="Pointer CLI - AI-powered local codebase assistant",
    no_args_is_help=False,
    invoke_without_command=True,
)
config_app = typer.Typer(help="Inspect and update Pointer CLI configuration.")
context_app = typer.Typer(help="Inspect and manage codebase context.")
app.add_typer(config_app, name="config")
app.add_typer(context_app, name="context")

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
        from . import __version__

        console.print(f"Pointer CLI v{__version__}")
        return

    try:
        ensure_config_dir()
        config = Config.load(config_path)

        if init or not config.is_initialized():
            if not _initialize_config(config, config_path=config_path):
                console.print("[red]Initialization cancelled.[/red]")
                raise typer.Exit(code=EXIT_USER_CANCELLED)

        _raise_for_invalid_config(config)

        cli = PointerCLI(config)
        cli.run()

    except typer.Exit:
        raise
    except KeyboardInterrupt:
        console.print("\n[yellow]Goodbye![/yellow]")
        sys.exit(EXIT_OK)
    except Exception as exc:
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
