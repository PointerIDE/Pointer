"""
Utility functions for Pointer CLI.
"""

import difflib
import json
import logging
import os
import sys
import toml
import yaml
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

def get_config_path() -> Path:
    """Get the configuration directory path."""
    return Path.home() / ".pointer-cli"

def ensure_config_dir() -> None:
    """Ensure the configuration directory exists."""
    config_dir = get_config_path()
    config_dir.mkdir(parents=True, exist_ok=True)

def get_project_root() -> Optional[Path]:
    """Get the project root directory (where .git is located).
    
    Returns:
        Path to the project root or None if not in a git repository.
    """
    current = Path.cwd()
    max_iterations = 20  # Prevent infinite loops on misconfigured systems
    iterations = 0
    
    while current != current.parent and iterations < max_iterations:
        if (current / ".git").exists():
            logger.debug(f"Found project root: {current}")
            return current
        current = current.parent
        iterations += 1
    
    logger.debug("No git repository found in parent directories")
    return None

def is_git_repo() -> bool:
    """Check if current directory is a git repository."""
    return get_project_root() is not None

def get_file_extension(file_path: Path) -> str:
    """Get file extension from path."""
    return file_path.suffix.lower()

def is_text_file(file_path: Path) -> bool:
    """Check if file is likely a text file based on extension and content.
    
    Args:
        file_path: Path to the file to check
    
    Returns:
        True if the file appears to be a text file, False otherwise.
    """
    text_extensions = {
        '.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.scss', '.sass',
        '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.txt',
        '.md', '.rst', '.xml', '.sql', '.sh', '.bash', '.zsh', '.fish',
        '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp', '.cs', '.php',
        '.rb', '.swift', '.kt', '.scala', '.clj', '.hs', '.ml', '.fs',
        '.vim', '.vimrc', '.gitignore', '.dockerignore', '.env', '.env.example',
        '.gradle', '.maven', '.dockerfile', '.makefile', '.cmake'
    }
    
    ext = file_path.suffix.lower()
    if ext in text_extensions:
        return True
    
    # Check for files without extension that might be text
    if not ext:
        try:
            with open(file_path, 'rb') as f:
                chunk = f.read(512)  # Check first 512 bytes
                # Text files typically don't have null bytes
                return b'\0' not in chunk
        except Exception as e:
            logger.debug(f"Could not check if {file_path} is text: {e}")
            return False
    
    return False

def format_file_size(size_bytes: int) -> str:
    """Format file size in human readable format."""
    if size_bytes == 0:
        return "0B"
    
    size_names = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    while size_bytes >= 1024 and i < len(size_names) - 1:
        size_bytes /= 1024.0
        i += 1
    
    return f"{size_bytes:.1f}{size_names[i]}"

def get_file_info(file_path: Path) -> Dict[str, Any]:
    """Get comprehensive file information."""
    try:
        stat = file_path.stat()
        return {
            "path": str(file_path),
            "name": file_path.name,
            "size": stat.st_size,
            "size_formatted": format_file_size(stat.st_size),
            "modified": stat.st_mtime,
            "is_file": file_path.is_file(),
            "is_dir": file_path.is_dir(),
            "is_text": is_text_file(file_path) if file_path.is_file() else False,
            "extension": get_file_extension(file_path),
        }
    except FileNotFoundError:
        logger.warning(f"File not found: {file_path}")
        return {
            "path": str(file_path),
            "name": file_path.name,
            "error": "File not found",
        }
    except Exception as e:
        logger.error(f"Error getting file info for {file_path}: {e}")
        return {
            "path": str(file_path),
            "name": file_path.name,
            "error": f"{type(e).__name__}: {e}",
        }

def safe_read_file(file_path: Path, max_size: int = 10 * 1024 * 1024) -> Optional[str]:
    """Safely read a text file with size limit."""
    try:
        if not file_path.exists():
            logger.warning(f"File does not exist: {file_path}")
            return None
        
        if not file_path.is_file():
            logger.warning(f"Path is not a file: {file_path}")
            return None
        
        file_size = file_path.stat().st_size
        if file_size > max_size:
            max_formatted = format_file_size(max_size)
            size_formatted = format_file_size(file_size)
            logger.warning(f"File too large ({size_formatted} > {max_formatted}): {file_path}")
            return f"[File too large: {size_formatted}]"
        
        if not is_text_file(file_path):
            logger.debug(f"Skipping binary file: {file_path}")
            return "[Binary file]"
        
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            return f.read()
    
    except Exception as e:
        logger.error(f"Error reading file {file_path}: {e}")
        return f"[Error reading file: {type(e).__name__}: {e}]"

def safe_write_file(file_path: Path, content: str) -> bool:
    """Safely write content to a file."""
    try:
        # Ensure parent directory exists
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write to temporary file first, then rename (atomic operation)
        temp_path = file_path.with_suffix(file_path.suffix + '.tmp')
        with open(temp_path, 'w', encoding='utf-8', errors='replace') as f:
            f.write(content)
        
        # Rename temp file to target (atomic operation on most filesystems)
        temp_path.replace(file_path)
        logger.info(f"Successfully wrote to file: {file_path}")
        return True
    
    except PermissionError as e:
        logger.error(f"Permission denied writing to {file_path}: {e}")
        return False
    except Exception as e:
        logger.error(f"Error writing file {file_path}: {type(e).__name__}: {e}")
        return False

def parse_file_content(file_path: Path, content: str) -> Dict[str, Any]:
    """Parse file content based on file type."""
    extension = get_file_extension(file_path)
    
    try:
        if extension == '.json':
            try:
                return {"type": "json", "data": json.loads(content)}
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON in {file_path}: {e}")
                return {"type": "json", "data": None, "parse_error": str(e)}
        
        elif extension in ['.yaml', '.yml']:
            try:
                return {"type": "yaml", "data": yaml.safe_load(content)}
            except yaml.YAMLError as e:
                logger.error(f"Invalid YAML in {file_path}: {e}")
                return {"type": "yaml", "data": None, "parse_error": str(e)}
        
        elif extension == '.toml':
            try:
                return {"type": "toml", "data": toml.loads(content)}
            except toml.TomlDecodeError as e:
                logger.error(f"Invalid TOML in {file_path}: {e}")
                return {"type": "toml", "data": None, "parse_error": str(e)}
        
        else:
            return {"type": "text", "data": content}
    
    except Exception as e:
        logger.error(f"Unexpected error parsing {file_path}: {e}")
        return {"type": "text", "data": content, "parse_error": f"Unexpected error: {e}"}

def create_diff(old_content: str, new_content: str) -> str:
    """Create a simple diff between old and new content."""
    old_lines = old_content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)
    
    diff = difflib.unified_diff(
        old_lines,
        new_lines,
        fromfile="original",
        tofile="modified",
        lineterm=""
    )
    
    return ''.join(diff)

def truncate_output(text: str, max_lines: int = 100) -> str:
    """Truncate text output to maximum number of lines."""
    lines = text.split('\n')
    if len(lines) <= max_lines:
        return text
    
    truncated = lines[:max_lines]
    truncated.append(f"... ({len(lines) - max_lines} more lines)")
    return '\n'.join(truncated)

def get_relative_path(file_path: Path, base_path: Optional[Path] = None) -> str:
    """Get relative path from base path."""
    if base_path is None:
        base_path = Path.cwd()
    
    try:
        return str(file_path.relative_to(base_path))
    except ValueError:
        return str(file_path)

def find_files(
    pattern: str,
    directory: Path = None,
    recursive: bool = True,
    include_hidden: bool = False
) -> List[Path]:
    """Find files matching pattern(s).
    
    Args:
        pattern: Glob pattern or pattern with OR (e.g., '*.py|*.ts')
        directory: Base directory to search
        recursive: Whether to search recursively
        include_hidden: Whether to include hidden files
    
    Returns:
        List of matching file paths
    """
    if directory is None:
        directory = Path.cwd()
    
    if not directory.exists():
        logger.warning(f"Search directory does not exist: {directory}")
        return []
    
    try:
        # Handle OR patterns like "pattern1|pattern2|pattern3"
        if '|' in pattern:
            patterns = [p.strip() for p in pattern.split('|')]
            all_files = []
            
            for single_pattern in patterns:
                try:
                    if not recursive:
                        files = list(directory.glob(single_pattern))
                    else:
                        files = list(directory.rglob(single_pattern))
                    
                    # Filter hidden files
                    if not include_hidden:
                        files = [f for f in files if not f.name.startswith('.')]
                    
                    all_files.extend(files)
                except Exception as e:
                    logger.warning(f"Error searching for pattern '{single_pattern}': {e}")
            
            # Remove duplicates while preserving order
            seen = set()
            unique_files = []
            for file_path in all_files:
                if file_path not in seen:
                    seen.add(file_path)
                    unique_files.append(file_path)
            
            logger.debug(f"Found {len(unique_files)} files matching pattern(s): {pattern}")
            return unique_files
        
        # Single pattern (original behavior)
        if not recursive:
            files = list(directory.glob(pattern))
        else:
            files = list(directory.rglob(pattern))
        
        # Filter hidden files
        if not include_hidden:
            files = [f for f in files if not f.name.startswith('.')]
        
        logger.debug(f"Found {len(files)} files matching pattern: {pattern}")
        return files
    
    except Exception as e:
        logger.error(f"Error finding files with pattern '{pattern}': {e}")
        return []
