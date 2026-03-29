"""
Core Pointer CLI implementation.
"""

import asyncio
import logging
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt
from rich.text import Text

from .chat import ChatInterface
from .chat_manager import ChatManager
from .config import Config
from .modes import ModeManager
from .tools import ToolManager
from .utils import get_project_root, is_git_repo

logger = logging.getLogger(__name__)


class PointerCLI:
    """Main Pointer CLI class."""
    
    def __init__(self, config: Config):
        self.config = config
        # Detect color system based on OS
        color_system = "auto" if os.name != "nt" else "windows"
        self.console = Console(color_system=color_system, force_terminal=True)
        
        self.chat_interface = ChatInterface(config, self.console)
        self.tool_manager = ToolManager(config, self.console)
        self.mode_manager = ModeManager(config, self.console)
        self.chat_manager = ChatManager(config.get_default_config_path().parent)
        
        # State
        self.running = False
        self.current_context: Dict[str, Any] = {}
        self.first_message = True
        
        # Session tracking
        self.total_tokens = 0
        self.message_count = 0
        self.session_start_time = time.time()
    
    @staticmethod
    def _clear_screen() -> None:
        """Clear the terminal screen."""
        try:
            os.system('cls' if os.name == 'nt' else 'clear')
        except Exception as e:
            logger.warning(f"Failed to clear screen: {e}")
        
    def run(self) -> None:
        """Run the Pointer CLI."""
        self.running = True
        self.session_start_time = time.time()
        
        # Clear screen on startup
        self._clear_screen()
        
        # Show welcome message
        self._show_welcome()
        
        # Initialize context
        self._initialize_context()
        
        # Start chat interface
        try:
            asyncio.run(self._run_chat_loop())
        except KeyboardInterrupt:
            self._handle_exit()
        except Exception as e:
            logger.error(f"Unexpected error: {e}", exc_info=True)
            self.console.print(f"[red]Error: {e}[/red]")
            sys.exit(1)
    
    def _show_welcome(self) -> None:
        """Show welcome message and status."""
        welcome_text = Text()
        welcome_text.append("Pointer CLI", style="bold blue")
        welcome_text.append(" - AI-powered local codebase assistant\n\n")
        
        # Show current configuration
        welcome_text.append("Configuration:\n", style="bold")
        welcome_text.append(f"  API: {self.config.api.base_url}\n")
        welcome_text.append(f"  Model: {self.config.api.model_name}\n")
        welcome_text.append(f"  Mode: {'Auto-Run' if self.config.mode.auto_run_mode else 'Manual'}\n")
        welcome_text.append(f"  Show AI Responses: {'Yes' if self.config.ui.show_ai_responses else 'No'}\n")
        
        # Show project info
        project_root = get_project_root()
        if project_root:
            welcome_text.append(f"\nProject: {project_root.name}\n")
            welcome_text.append(f"  Root: {project_root}\n")
            welcome_text.append(f"  Git: {'Yes' if is_git_repo() else 'No'}\n")
        else:
            welcome_text.append("\nNo git repository detected\n")
        
        welcome_text.append("\nType your message or use commands:\n")
        welcome_text.append("  /help - Show help\n", style="dim")
        welcome_text.append("  /chats - Chat management\n", style="dim")
        welcome_text.append("  /config - Show configuration\n", style="dim")
        welcome_text.append("  /mode - Toggle auto-run mode\n", style="dim")
        welcome_text.append("  /exit - Exit Pointer CLI\n", style="dim")
        
        self.console.print(Panel(welcome_text, title="Welcome", border_style="blue"))
    
    def _initialize_context(self) -> None:
        """Initialize the current context."""
        self.current_context = {
            "project_root": get_project_root(),
            "current_directory": Path.cwd(),
            "is_git_repo": is_git_repo(),
            "config": self.config,
        }
    
    async def _run_chat_loop(self) -> None:
        """Run the main chat loop."""
        while self.running:
            try:
                # Get user input
                user_input = await self.chat_interface.get_user_input()
                
                if not user_input.strip():
                    continue
                
                # Handle commands
                if user_input.startswith('/'):
                    await self._handle_command(user_input)
                    continue
                
                # Process natural language input
                await self._process_user_message(user_input)
                
            except KeyboardInterrupt:
                break
            except Exception as e:
                self.console.print(f"[red]Error: {e}[/red]")
    
    async def _handle_command(self, command: str) -> None:
        """Handle CLI commands."""
        parts = command[1:].split()
        cmd = parts[0].lower() if parts else ""
        args = parts[1:] if len(parts) > 1 else []
        
        if cmd == "help":
            self._show_help()
        elif cmd == "config":
            self._show_config()
        elif cmd == "exit":
            self._handle_exit()
        elif cmd == "clear":
            import os
            os.system('cls' if os.name == 'nt' else 'clear')
        elif cmd == "status":
            self._show_status()
        elif cmd == "info":
            self._show_info()
        elif cmd == "chats" or cmd == "chat":
            self._handle_chat_command(args)
        elif cmd == "mode":
            new_mode = self.config.toggle_auto_run_mode()
            mode_text = "Auto-Run" if new_mode else "Manual"
            self.console.print(f"[green]Mode changed to: {mode_text}[/green]")
        elif cmd == "context":
            await self._handle_context_command(args)
        else:
            self.console.print(f"[yellow]Unknown command: {cmd}[/yellow]")
            self.console.print("Type /help for available commands.")
    
    async def _process_user_message(self, message: str) -> None:
        """Process natural language user message."""
        try:
            # Clear screen on first message (but keep user message visible)
            if self.first_message:
                # Clear the console completely
                import os
                os.system('cls' if os.name == 'nt' else 'clear')
                # Re-print the user's message so it stays visible
                self.console.print(f"[bold blue]You:[/bold blue] {message}")
                self.first_message = False
            
            # Increment message count
            self.message_count += 1
            
            # Create new chat if none exists
            if not self.chat_manager.current_chat:
                self.chat_manager.create_new_chat()
            
            # Add user message to chat
            self.chat_manager.add_message("user", message)
            
            # Get AI response (streaming is handled in chat_interface)
            ai_response, tokens_used = await self.chat_interface.get_ai_response_with_tokens(message, self.current_context)
            
            # Track tokens
            if tokens_used:
                self.total_tokens += tokens_used
            
            # Add AI response to chat
            self.chat_manager.add_message("assistant", ai_response, tokens_used)
            
            # Note: AI response is already displayed via streaming, no need to display again
            
            # Parse and execute tools
            tools_to_execute = self.chat_interface.parse_tools(ai_response)
            
            if tools_to_execute:
                # Show tools that will be executed
                self._show_tools_summary(tools_to_execute)
                
                # Check if user confirmation is needed
                if not self.config.mode.auto_run_mode:
                    if not await self._confirm_tool_execution(tools_to_execute):
                        self.console.print("[yellow]Tool execution cancelled by user.[/yellow]")
                        return
                
                # Execute tools and collect results
                executed_tools_with_results = await self._execute_tools_and_collect_results(tools_to_execute)
                
                # Get AI follow-up after tool execution (always enabled for tool execution flow)
                followup_response, followup_tokens = await self.chat_interface.get_ai_response_with_tokens(
                    self._create_followup_prompt(executed_tools_with_results), self.current_context
                )
                
                # Track follow-up tokens
                if followup_tokens:
                    self.total_tokens += followup_tokens
                
                # Parse and execute any follow-up tools
                followup_tools = self.chat_interface.parse_tools(followup_response)
                if followup_tools:
                    if not self.config.mode.auto_run_mode:
                        if not await self._confirm_tool_execution(followup_tools):
                            self.console.print("[yellow]Follow-up tool execution cancelled by user.[/yellow]")
                            return
                    await self._execute_tools(followup_tools)
            
        except Exception as e:
            # Don't show the error again if it was already displayed by chat_interface
            if "Error getting AI response:" not in str(e):
                self.console.print(f"[red]Error processing message: {e}[/red]")
    
    async def _execute_tools_and_collect_results(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Execute tools from AI response and return them with results."""
        executed_tools = []
        
        for tool in tools:
            try:

                
                # Execute the tool
                result = await self.tool_manager.execute_tool(tool)
                
                # Add to executed tools with result
                executed_tools.append({
                    **tool,
                    "result": result,
                    "status": "success"
                })
                
                if self.config.ui.show_tool_outputs:
                    # Show detailed output
                    self.console.print(Panel(
                        result,
                        title=f"Tool: {tool['name']}",
                        border_style="blue"
                    ))
                else:
                    # Show basic information only
                    self.console.print(f"[green]✓ {tool['name']} completed successfully[/green]")
                
            except Exception as e:
                error_msg = f"Error executing tool {tool.get('name', 'unknown')}: {e}"
                self.console.print(f"[red]{error_msg}[/red]")
                
                # Add to executed tools with error
                executed_tools.append({
                    **tool,
                    "result": error_msg,
                    "status": "error"
                })
        
        return executed_tools

    async def _execute_tools(self, tools: List[Dict[str, Any]]) -> None:
        """Execute tools from AI response."""
        for tool in tools:
            try:

                
                # Execute the tool
                result = await self.tool_manager.execute_tool(tool)
                
                if self.config.ui.show_tool_outputs:
                    # Show detailed output
                    self.console.print(Panel(
                        result,
                        title=f"Tool: {tool['name']}",
                        border_style="blue"
                    ))
                else:
                    # Show basic information only
                    self.console.print(f"[green]✓ {tool['name']} completed successfully[/green]")
                
            except Exception as e:
                self.console.print(f"[red]Error executing tool {tool['name']}: {e}[/red]")
    

    
    def _create_tool_summary(self, tools: List[Dict[str, Any]]) -> str:
        """Create a summary of executed tools for AI analysis."""
        summary_parts = []
        
        for i, tool in enumerate(tools, 1):
            tool_name = tool.get('name', 'unknown')
            tool_args = tool.get('args', {})
            tool_result = tool.get('result', 'No result')
            tool_status = tool.get('status', 'unknown')
            
            summary_parts.append(f"{i}. {tool_name}")
            if tool_args:
                # Format arguments nicely
                args_str = ", ".join([f"{k}={v}" for k, v in tool_args.items()])
                summary_parts.append(f"   Args: {args_str}")
            
            # Add result and status
            if tool_status == 'success':
                summary_parts.append(f"   Result: {tool_result}")
            elif tool_status == 'error':
                summary_parts.append(f"   Error: {tool_result}")

        
        return "\n".join(summary_parts)
    
    def _create_followup_prompt(self, executed_tools: List[Dict[str, Any]]) -> str:
        """Create follow-up prompt for AI analysis."""
        tool_summary = self._create_tool_summary(executed_tools)
        
        return f"""I just executed the following tools:

{tool_summary}

Please provide a brief analysis of the results and any follow-up suggestions or observations. Keep it concise and actionable."""
    
    def _show_tools_summary(self, tools: List[Dict[str, Any]]) -> None:
        """Show a summary of tools that will be executed."""
        if not tools:
            return
            
        # Create a formatted summary for the panel
        summary_text = ""
        for i, tool in enumerate(tools, 1):
            tool_name = tool.get('name', 'unknown')
            tool_args = tool.get('args', {})
            
            summary_text += f"{i}. {tool_name}\n"
            if tool_args:
                args_str = ", ".join([f"{k}={v}" for k, v in tool_args.items()])
                summary_text += f"   Args: {args_str}\n"
            summary_text += "\n"
        
        # Display in a nice panel
        self.console.print(Panel(
            summary_text.strip(),
            title="[bold blue]Tools to Execute[/bold blue]",
            border_style="blue"
        ))
    
    async def _confirm_tool_execution(self, tools: List[Dict[str, Any]]) -> bool:
        """Ask user for confirmation before executing tools."""
        if not tools:
            return True
            
        tool_names = [tool.get('name', 'unknown') for tool in tools]
        tools_str = ", ".join(tool_names)
        
        self.console.print(f"[yellow]Execute these tools?[/yellow] {tools_str}")
        
        while True:
            response = input("Proceed? (y/n): ").strip().lower()
            if response in ['y', 'yes']:
                return True
            elif response in ['n', 'no']:
                return False
            else:
                self.console.print("[yellow]Please enter 'y' or 'n'[/yellow]")
    
    def _display_ai_response(self, response: str, title: str, border_style: str) -> None:
        """Display AI response with thinking and main content in separate panels."""
        # Split response into thinking and main content
        thinking_content, main_content = self._split_ai_response(response)
        
        # Display thinking in separate gray panel if present
        if thinking_content:
            self.console.print(Panel(
                thinking_content, 
                title="Thinking", 
                border_style="bright_black"
            ))
        
        # Display main response
        if main_content.strip():
            self.console.print(Panel(main_content, title=title, border_style=border_style))
    
    def _split_ai_response(self, response: str) -> Tuple[str, str]:
        """Split AI response into thinking content and main content."""
        # Find thinking blocks
        think_match = re.search(r'<think>(.*?)</think>', response, flags=re.DOTALL)
        
        if think_match:
            # Extract thinking content
            thinking_content = think_match.group(1).strip()
            
            # Remove thinking blocks from main content
            main_content = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL).strip()
            
            return thinking_content, main_content
        else:
            # No thinking content found
            return "", response
    
    def _show_info(self) -> None:
        """Show session information including token usage."""
        if self.session_start_time is None:
            self.console.print("[yellow]Session information not available yet.[/yellow]")
            return
        
        # Calculate session duration
        current_time = time.time()
        session_duration = current_time - self.session_start_time
        
        # Format duration
        hours = int(session_duration // 3600)
        minutes = int((session_duration % 3600) // 60)
        seconds = int(session_duration % 60)
        
        if hours > 0:
            duration_str = f"{hours}h {minutes}m {seconds}s"
        elif minutes > 0:
            duration_str = f"{minutes}m {seconds}s"
        else:
            duration_str = f"{seconds}s"
        
        # Calculate average tokens per message
        avg_tokens = self.total_tokens / self.message_count if self.message_count > 0 else 0
        
        # Create info display
        info_text = Text()
        info_text.append("Session Information:\n\n", style="bold")
        
        info_text.append("Duration: ", style="bold")
        info_text.append(f"{duration_str}\n")
        
        info_text.append("Messages: ", style="bold")
        info_text.append(f"{self.message_count}\n")
        
        info_text.append("Total Tokens: ", style="bold")
        info_text.append(f"{self.total_tokens:,}\n")
        
        info_text.append("Avg Tokens/Message: ", style="bold")
        info_text.append(f"{avg_tokens:.1f}\n\n")
        
        info_text.append("Configuration:\n", style="bold")
        info_text.append("Model: ", style="bold")
        info_text.append(f"{self.config.api.model_name}\n")
        info_text.append("API Base URL: ", style="bold")
        info_text.append(f"{self.config.api.base_url}\n")
        
        self.console.print(Panel(info_text, title="Session Info", border_style="green"))
    
    def _handle_chat_command(self, args: List[str]) -> None:
        """Handle chat management commands."""
        if not args:
            self._show_chat_help()
            return
        
        subcommand = args[0].lower()
        sub_args = args[1:] if len(args) > 1 else []
        
        if subcommand == "new":
            self._create_new_chat(sub_args)
        elif subcommand == "load":
            self._load_chat(sub_args)
        elif subcommand == "save":
            self._save_chat()
        elif subcommand == "list":
            self._list_chats()
        elif subcommand == "delete":
            self._delete_chat(sub_args)
        elif subcommand == "current":
            self._show_current_chat()
        else:
            self.console.print(f"[red]Unknown chat command: {subcommand}[/red]")
            self._show_chat_help()
    
    def _show_chat_help(self) -> None:
        """Show chat command help."""
        help_text = Text()
        help_text.append("Chat Management Commands:\n\n", style="bold")
        
        help_text.append("/chats new [title]", style="bold blue")
        help_text.append(" - Create a new chat session\n")
        
        help_text.append("/chats load <chat_id>", style="bold blue")
        help_text.append(" - Load a saved chat session\n")
        
        help_text.append("/chats save", style="bold blue")
        help_text.append(" - Save the current chat session\n")
        
        help_text.append("/chats list", style="bold blue")
        help_text.append(" - List all saved chat sessions\n")
        
        help_text.append("/chats delete <chat_id>", style="bold blue")
        help_text.append(" - Delete a saved chat session\n")
        
        help_text.append("/chats current", style="bold blue")
        help_text.append(" - Show current chat information\n")
        
        self.console.print(Panel(help_text, title="Chat Commands", border_style="blue"))
    
    def _create_new_chat(self, args: List[str]) -> None:
        """Create a new chat session."""
        title = " ".join(args) if args else None
        if not title:
            title = Prompt.ask("Enter chat title (or press Enter for auto-generated)", default="")
        
        chat = self.chat_manager.create_new_chat(title if title else None)
        
        self.console.print(f"[green]Created new chat: {chat.title}[/green]")
        self.console.print(f"[dim]Chat ID: {chat.id}[/dim]")
    
    def _load_chat(self, args: List[str]) -> None:
        """Load a chat session."""
        if not args:
            self.console.print("[red]Please provide a chat ID. Use /chats list to see available chats.[/red]")
            return
        
        chat_id = args[0]
        chat = self.chat_manager.load_chat(chat_id)
        
        if chat:
            self.console.print(f"[green]Loaded chat: {chat.title}[/green]")
            self.console.print(f"[dim]Messages: {len(chat.messages)}, Tokens: {chat.total_tokens}[/dim]")
            
            # Restore conversation history in chat interface
            self.chat_interface.conversation_history = [
                {"role": msg.role, "content": msg.content}
                for msg in chat.messages
            ]
        else:
            self.console.print(f"[red]Chat not found: {chat_id}[/red]")
    
    def _save_chat(self) -> None:
        """Save the current chat session."""
        if not self.chat_manager.current_chat:
            self.console.print("[yellow]No active chat to save.[/yellow]")
            return
        
        self.chat_manager.save_chat()
        self.console.print(f"[green]Saved chat: {self.chat_manager.current_chat.title}[/green]")
    
    def _list_chats(self) -> None:
        """List all available chat sessions."""
        chats = self.chat_manager.list_chats()
        
        if not chats:
            self.console.print("[yellow]No saved chats found.[/yellow]")
            return
        
        chat_text = Text()
        chat_text.append("Available Chats:\n\n", style="bold")
        
        for i, chat in enumerate(chats, 1):
            # Format timestamp
            try:
                dt = datetime.fromisoformat(chat["last_modified"])
                time_str = dt.strftime("%Y-%m-%d %H:%M")
            except (ValueError, KeyError):
                time_str = chat.get("last_modified", "Unknown")
            
            chat_text.append(f"{i}. ", style="bold blue")
            chat_text.append(f"{chat['title']}\n")
            chat_text.append(f"   ID: {chat['id']}\n", style="dim")
            chat_text.append(f"   Messages: {chat['message_count']}, Tokens: {chat['total_tokens']}\n", style="dim")
            chat_text.append(f"   Last modified: {time_str}\n\n", style="dim")
        
        chat_text.append("Use /chats load <chat_id> to load a chat", style="italic")
        
        self.console.print(Panel(chat_text, title="Chat History", border_style="blue"))
    
    def _delete_chat(self, args: List[str]) -> None:
        """Delete a chat session."""
        if not args:
            self.console.print("[red]Please provide a chat ID. Use /chats list to see available chats.[/red]")
            return
        
        chat_id = args[0]
        
        # Confirm deletion
        confirm = Prompt.ask(f"Are you sure you want to delete chat '{chat_id}'?", choices=["y", "n"], default="n")
        
        if confirm.lower() == "y":
            if self.chat_manager.delete_chat(chat_id):
                self.console.print(f"[green]Deleted chat: {chat_id}[/green]")
            else:
                self.console.print(f"[red]Chat not found: {chat_id}[/red]")
        else:
            self.console.print("[yellow]Deletion cancelled.[/yellow]")
    
    def _show_current_chat(self) -> None:
        """Show current chat information."""
        if not self.chat_manager.current_chat:
            self.console.print("[yellow]No active chat session.[/yellow]")
            return
        
        chat = self.chat_manager.current_chat
        
        chat_text = Text()
        chat_text.append(f"Title: ", style="bold")
        chat_text.append(f"{chat.title}\n")
        chat_text.append(f"ID: ", style="bold")
        chat_text.append(f"{chat.id}\n")
        chat_text.append(f"Created: ", style="bold")
        chat_text.append(f"{chat.created_at}\n")
        chat_text.append(f"Last Modified: ", style="bold")
        chat_text.append(f"{chat.last_modified}\n")
        chat_text.append(f"Messages: ", style="bold")
        chat_text.append(f"{len(chat.messages)}\n")
        chat_text.append(f"Total Tokens: ", style="bold")
        chat_text.append(f"{chat.total_tokens}\n")
        
        self.console.print(Panel(chat_text, title="Current Chat", border_style="green"))
    
    def _show_help(self) -> None:
        """Show help information."""
        help_text = Text()
        help_text.append("Pointer CLI Commands:\n\n", style="bold")
        
        help_text.append("/help", style="bold blue")
        help_text.append(" - Show this help message\n")
        
        help_text.append("/config", style="bold blue")
        help_text.append(" - Show current configuration\n")
        
        help_text.append("/mode", style="bold blue")
        help_text.append(" - Toggle between auto-run and manual mode\n")
        
        help_text.append("/status", style="bold blue")
        help_text.append(" - Show current status and context\n")
        
        help_text.append("/info", style="bold blue")
        help_text.append(" - Show session information and token usage\n")
        
        help_text.append("/chats", style="bold blue")
        help_text.append(" - Chat management (new, load, save, list, delete, current)\n")
        
        help_text.append("/context", style="bold blue")
        help_text.append(" - Codebase context management (refresh, enable, disable, show, search, config)\n")
        
        help_text.append("/clear", style="bold blue")
        help_text.append(" - Clear the screen\n")
        
        help_text.append("/exit", style="bold blue")
        help_text.append(" - Exit Pointer CLI\n\n")
        
        help_text.append("Natural Language:\n", style="bold")
        help_text.append("You can interact with Pointer CLI using natural language.\n")
        help_text.append("Ask questions, request file operations, or describe what you want to do.\n\n")
        
        help_text.append("Configuration Notes:\n", style="bold")
        help_text.append("• /mode - Toggle between auto-run (immediate execution) and manual (confirmation required)\n")
        help_text.append("• Show AI Responses: false = shows response box but hides content\n")
        help_text.append("• AI follow-up after tool execution is always enabled\n")
        help_text.append("• Show Thinking: only relevant when AI responses are enabled\n")
        
        self.console.print(Panel(help_text, title="Help", border_style="green"))
    
    def _show_config(self) -> None:
        """Show current configuration."""
        config_text = Text()
        config_text.append("Current Configuration:\n\n", style="bold")
        
        # Show config file location
        from .config import Config
        config_path = Config.get_default_config_path()
        config_text.append("Configuration File:\n", style="bold blue")
        config_text.append(f"  Location: {config_path}\n")
        config_text.append(f"  Exists: {'Yes' if config_path.exists() else 'No'}\n\n")
        
        config_text.append("API Settings:\n", style="bold blue")
        config_text.append(f"  Base URL: {self.config.api.base_url}\n")
        config_text.append(f"  Model: {self.config.api.model_name}\n")
        config_text.append(f"  Timeout: {self.config.api.timeout}s\n")
        config_text.append(f"  Max Retries: {self.config.api.max_retries}\n\n")
        
        config_text.append("UI Settings:\n", style="bold blue")
        config_text.append(f"  Show AI Responses: {self.config.ui.show_ai_responses}\n")
        if self.config.ui.show_ai_responses:
            config_text.append(f"  Show Thinking: {self.config.ui.show_thinking}\n")
        config_text.append(f"  Show Tool Outputs: {self.config.ui.show_tool_outputs}\n")
        config_text.append(f"  Show Diffs: {self.config.ui.show_diffs}\n")
        config_text.append(f"  Theme: {self.config.ui.theme}\n")
        config_text.append(f"  AI Follow-up: Always enabled after tool execution\n\n")
        
        config_text.append("Mode Settings:\n", style="bold blue")
        config_text.append(f"  Auto-Run Mode: {self.config.mode.auto_run_mode}\n\n")
        
        config_text.append("Codebase Context:\n", style="bold blue")
        config_text.append(f"  Include Context: {self.config.codebase.include_context}\n")
        config_text.append(f"  Max Context Files: {self.config.codebase.max_context_files}\n")
        config_text.append(f"  Context Depth: {self.config.codebase.context_depth}\n")
        config_text.append(f"  Auto Refresh: {self.config.codebase.auto_refresh_context}\n")
        
        self.console.print(Panel(config_text, title="Configuration", border_style="yellow"))
    
    def _show_status(self) -> None:
        """Show current status."""
        status_text = Text()
        status_text.append("Current Status:\n\n", style="bold")
        
        status_text.append(f"Project Root: {self.current_context.get('project_root', 'None')}\n")
        status_text.append(f"Current Directory: {self.current_context.get('current_directory', 'None')}\n")
        status_text.append(f"Git Repository: {self.current_context.get('is_git_repo', False)}\n")
        status_text.append(f"Mode: {'Auto-Run' if self.config.mode.auto_run_mode else 'Manual'}\n")
        status_text.append(f"Running: {self.running}\n")
        
        self.console.print(Panel(status_text, title="Status", border_style="cyan"))
    
    async def _handle_context_command(self, args: List[str]) -> None:
        """Handle context management commands."""
        if not args:
            # Show context summary
            summary = self.chat_interface.codebase_context.get_context_summary()
            if summary:
                self.console.print(Panel.fit(
                    f"[bold]Codebase Context Summary[/bold]\n\n"
                    f"Project Root: {summary.get('project_root', 'None')}\n"
                    f"Total Files: {summary.get('total_files', 0)}\n"
                    f"File Types: {', '.join(f'{ext}({count})' for ext, count in summary.get('file_types', {}).items())}\n"
                    f"Last Updated: {summary.get('last_updated', 'Never')}\n"
                    f"Enabled: {self.config.codebase.include_context}",
                    title="Context Status"
                ))
            else:
                self.console.print("[yellow]No codebase context available.[/yellow]")
            return
        
        subcommand = args[0].lower()
        
        if subcommand == "refresh":
            self.console.print("[blue]Refreshing codebase context...[/blue]")
            self.chat_interface.codebase_context.force_refresh()
            summary = self.chat_interface.codebase_context.get_context_summary()
            self.console.print(f"[green]Context refreshed! Found {summary.get('total_files', 0)} files.[/green]")
        
        elif subcommand == "enable":
            self.config.codebase.include_context = True
            self.config.save()
            self.console.print("[green]Codebase context enabled.[/green]")
        
        elif subcommand == "disable":
            self.config.codebase.include_context = False
            self.config.save()
            self.console.print("[yellow]Codebase context disabled.[/yellow]")
        
        elif subcommand == "show":
            context_str = self.chat_interface.codebase_context.get_context_for_prompt()
            if context_str:
                self.console.print(Panel(context_str, title="Codebase Context", border_style="blue"))
            else:
                self.console.print("[yellow]No codebase context available.[/yellow]")
        
        elif subcommand == "search":
            if len(args) < 2:
                self.console.print("[red]Usage: /context search <query>[/red]")
                return
            
            query = " ".join(args[1:])
            results = self.chat_interface.codebase_context.search_context(query)
            
            if results:
                self.console.print(f"[green]Found {len(results)} files matching '{query}':[/green]")
                for file_info in results[:10]:  # Show top 10 results
                    self.console.print(f"  {file_info.relative_path}")
            else:
                self.console.print(f"[yellow]No files found matching '{query}'.[/yellow]")
        
        elif subcommand == "config":
            config_text = (
                f"[bold]Codebase Context Configuration[/bold]\n\n"
                f"Include Context: {self.config.codebase.include_context}\n"
                f"Max Context Files: {self.config.codebase.max_context_files}\n"
                f"Context Depth: {self.config.codebase.context_depth}\n"
                f"Auto Refresh: {self.config.codebase.auto_refresh_context}\n"
                f"Cache Duration: {self.config.codebase.context_cache_duration}s\n"
                f"File Types: {', '.join(self.config.codebase.context_file_types)}\n"
                f"Exclude Patterns: {', '.join(self.config.codebase.exclude_patterns)}"
            )
            self.console.print(Panel(config_text, title="Context Configuration"))
        
        else:
            self.console.print(f"[red]Unknown context subcommand: {subcommand}[/red]")
            self.console.print("Available subcommands: refresh, enable, disable, show, search, config")
    
    def _handle_exit(self) -> None:
        """Handle exit gracefully."""
        self.running = False
        self.console.print("\n[yellow]Goodbye![/yellow]")
        sys.exit(0)
