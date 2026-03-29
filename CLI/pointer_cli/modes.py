"""
Mode management for Pointer CLI.
"""

import logging
from typing import Any, Dict, Optional

from rich.console import Console
from rich.panel import Panel
from rich.text import Text

from .config import Config

logger = logging.getLogger(__name__)


class ModeManager:
    """Manages different modes for Pointer CLI (auto-run and manual)."""
    
    VALID_MODES = ("auto_run", "manual")
    
    def __init__(self, config: Config, console: Console):
        self.config = config
        self.console = console
        self.current_mode = "auto_run" if config.mode.auto_run_mode else "manual"
        logger.debug(f"ModeManager initialized with mode: {self.current_mode}")
    
    def get_current_mode(self) -> str:
        """Get the current mode.
        
        Returns:
            Current mode ("auto_run" or "manual")
        """
        return self.current_mode
    
    def is_auto_run_mode(self) -> bool:
        """Check if in auto-run mode where tools execute without confirmation.
        
        Returns:
            True if in auto-run mode, False if in manual mode
        """
        return self.current_mode == "auto_run"
    
    def toggle_mode(self) -> str:
        """Toggle between auto-run and manual modes.
        
        Returns:
            New current mode after toggle
        """
        old_mode = self.current_mode
        
        if self.current_mode == "auto_run":
            self.current_mode = "manual"
            self.config.mode.auto_run_mode = False
        else:
            self.current_mode = "auto_run"
            self.config.mode.auto_run_mode = True
        
        self.config.save()
        logger.info(f"Mode toggled from {old_mode} to {self.current_mode}")
        return self.current_mode
    
    def set_mode(self, mode: str) -> bool:
        """Set a specific mode.
        
        Args:
            mode: Mode to set ("auto_run" or "manual")
        
        Returns:
            True if mode was set successfully, False if invalid mode
        """
        if mode not in self.VALID_MODES:
            logger.warning(f"Invalid mode requested: {mode} (valid: {self.VALID_MODES})")
            return False
        
        old_mode = self.current_mode
        self.current_mode = mode
        
        if mode == "auto_run":
            self.config.mode.auto_run_mode = True
        else:
            self.config.mode.auto_run_mode = False
        
        self.config.save()
        logger.info(f"Mode set from {old_mode} to {mode}")
        return True
    
    def get_mode_description(self) -> str:
        """Get a description of the current mode.
        
        Returns:
            Description of the current mode
        """
        if self.current_mode == "auto_run":
            return "Tools will execute immediately without user confirmation"
        else:
            return "Tools will require user confirmation before execution"
        
        self.config.save()
        return True
    
    def should_execute_tool(self, tool_name: str, tool_args: Dict[str, Any]) -> bool:
        """Determine if a tool should be executed based on current mode."""
        if self.is_auto_run_mode():
            return True
        
        # In manual mode, tools require user confirmation
        return False
    
    def get_mode_description(self) -> str:
        """Get description of current mode."""
        if self.is_auto_run_mode():
            return "Auto-Run Mode: Tools are executed immediately"
        else:
            return "Manual Mode: Tools require user confirmation before execution"
    
    def show_mode_status(self) -> None:
        """Show current mode status."""
        mode_text = Text()
        mode_text.append("Current Mode: ", style="bold")
        
        if self.is_auto_run_mode():
            mode_text.append("Auto-Run", style="bold green")
            mode_text.append("\n\nTools will be executed immediately when requested.")
        else:
            mode_text.append("Manual", style="bold yellow")
            mode_text.append("\n\nTools require user confirmation before execution.")
        
        mode_text.append(f"\n\nMode Settings:")
        mode_text.append(f"\n  Auto-Run: {self.config.mode.auto_run_mode}")
        
        self.console.print(Panel(mode_text, title="Mode Status", border_style="blue"))
    
    def get_tool_preview(self, tool_name: str, tool_args: Dict[str, Any]) -> str:
        """Get a preview of what a tool would do."""
        if self.is_auto_run_mode():
            return f"Would execute {tool_name} with args: {tool_args}"
        
        # In manual mode, show what would be executed
        return f"Would execute {tool_name} with args: {tool_args}"
    
    def confirm_destructive_action(self, action: str) -> bool:
        """Ask for confirmation for destructive actions."""
        # In manual mode, always ask for confirmation
        if not self.config.mode.auto_run_mode:
            response = input(f"⚠️  Action detected: {action}\nProceed? (y/N): ")
            return response.lower() in ['y', 'yes']
        
        return True
    
    def get_mode_help(self) -> str:
        """Get help text for modes."""
        help_text = Text()
        help_text.append("Pointer CLI Modes:\n\n", style="bold")
        
        help_text.append("Auto-Run Mode (Default):\n", style="bold green")
        help_text.append("  - Tools are executed immediately\n")
        help_text.append("  - Changes are applied directly\n")
        help_text.append("  - Best for experienced users\n\n")
        
        help_text.append("Manual Mode:\n", style="bold yellow")
        help_text.append("  - Tools require user confirmation before execution\n")
        help_text.append("  - Safe for experimentation\n")
        help_text.append("  - Good for learning and testing\n\n")
        
        help_text.append("Commands:\n", style="bold")
        help_text.append("  /mode - Toggle between modes\n")
        help_text.append("  /status - Show current mode status\n")
        
        return str(help_text)
