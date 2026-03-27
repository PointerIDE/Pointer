# Pointer CLI

A professional production-level command-line interface for interacting with an AI-powered local codebase assistant.

## Features

- **Global Command Access**: Accessible via `pointer` command globally
- **Chat-Only Interface**: Natural language interaction through terminal chat
- **Tool Execution**: Support for file operations, search, shell commands, and more
- **Fine-Grained Code Editing**: Line-by-line editing with diff previews
- **Dual Modes**: Auto-Run and Dry-Run modes for safe experimentation
- **Output Control**: Configurable display of AI responses and tool outputs
- **Local-Only Setup**: Custom API base URL and model selection support

## Installation

```bash
pip install -e .
```

## Usage

```bash
pointer
```

On first run, the CLI will prompt for initialization and configuration.

Run a quick environment check with:

```bash
pointer doctor
pointer doctor --json
pointer doctor --fix
```

The doctor command verifies your Python runtime, config directory, config initialization status, workspace detection, and API reachability.

Inspect or update config values with:

```bash
pointer config show
pointer config show api.base_url
pointer config set api.base_url http://localhost:1234
pointer config unset ui.show_diffs
pointer config edit
```

Show the current environment with:

```bash
pointer status
pointer status --json
```

Manage codebase context from top-level commands:

```bash
pointer context show
pointer context refresh
pointer context search TODO
pointer context files --ext .py
pointer context config
```

Initialize without prompts with:

```bash
pointer init --non-interactive --api-base-url http://localhost:1234 --model gpt-oss-20b
```

Enable shell completion with Typer's built-in commands:

```bash
pointer --install-completion
pointer --show-completion
```

## Configuration

The CLI supports custom API base URLs and model selection for local AI services.

## Development

```bash
# Install development dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Format code
black pointer_cli/

# Lint code
flake8 pointer_cli/
```

## License

MIT License
