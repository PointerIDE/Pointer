from typing import Dict, Optional, Any
import weakref
from fastapi import FastAPI, HTTPException, WebSocket, Request, WebSocketDisconnect, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, HTMLResponse, FileResponse, PlainTextResponse, JSONResponse
from pydantic import BaseModel
from typing import List
import os
from pathlib import Path
from PyQt5.QtWidgets import QApplication, QFileDialog
import sys
from fastapi.responses import PlainTextResponse
from fastapi.responses import JSONResponse
import json
import asyncio
import subprocess
import signal
from keyword_extractor import extract_keywords
import math
import time
import psutil
import platform
import GPUtil
import requests
from dotenv import load_dotenv
# Import the git router and GitHub OAuth
from git_endpoints import router as git_router
from github_oauth import GitHubOAuth
import mimetypes
import sqlite3
import httpx
import aiofiles
import aiofiles.os
import tempfile
import shutil
import uuid

# Import tool handling functionality
from tools_handlers import handle_tool_call, TOOL_DEFINITIONS

# Import codebase indexer
from codebase_indexer import CodebaseIndexer

# Load environment variables with explicit UTF-8 encoding
try:
    load_dotenv(encoding='utf-8')
except UnicodeDecodeError:
    # Fallback: try to load without encoding specification
    load_dotenv()

app = FastAPI()

# Add CORS middleware to allow frontend communication
# (CORS is configured later in this file as well; avoid duplicate middleware registration.)

# Initialize Qt application with error handling
try:
    # Set Qt to use offscreen platform if no display is available
    if not os.environ.get('DISPLAY') and sys.platform.startswith('linux'):
        os.environ['QT_QPA_PLATFORM'] = 'offscreen'
    qt_app = QApplication(sys.argv)
except Exception as e:
    print(f"Warning: Could not initialize Qt application: {e}")
    print("File dialogs may not work properly.")
    qt_app = None

# Initialize GitHub OAuth
try:
    github_oauth = GitHubOAuth()
except ValueError as e:
    print(f"Warning: GitHub OAuth not configured: {str(e)}")
    github_oauth = None

# Global codebase indexer instance
codebase_indexer: Optional[CodebaseIndexer] = None

async def start_background_indexing(workspace_path: str):
    """Start background indexing of the codebase."""
    try:
        if codebase_indexer:
            # Run indexing in a separate thread to avoid blocking
            import threading
            def run_indexing():
                try:
                    print(f"Background indexing started for {workspace_path}")
                    codebase_indexer.index_workspace()
                    print(f"Background indexing completed for {workspace_path}")
                except Exception as e:
                    print(f"Background indexing failed for {workspace_path}: {e}")
            
            thread = threading.Thread(target=run_indexing, daemon=True)
            thread.start()
        else:
            print("Background indexing: No codebase indexer available")
    except Exception as e:
        print(f"Error during background indexing: {e}")
        # Don't let this error propagate

async def auto_reindex_codebase():
    """Automatically reindex the codebase if needed."""
    global codebase_indexer
    
    try:
        # Check if we have a valid workspace directory
        if not user_workspace_directory:
            print("Auto-reindex: No user workspace directory set, skipping reindex")
            return
        
        # Validate that the workspace directory exists and is accessible
        if not os.path.exists(user_workspace_directory) or not os.path.isdir(user_workspace_directory):
            print(f"Auto-reindex: Invalid workspace directory: {user_workspace_directory}, skipping reindex")
            return
        
        if codebase_indexer and user_workspace_directory:
            # Check if workspace has changed
            if str(codebase_indexer.workspace_path) != user_workspace_directory:
                print(f"Auto-reindex: Workspace changed, reinitializing with {user_workspace_directory}")
                try:
                    codebase_indexer = CodebaseIndexer(user_workspace_directory)
                except Exception as e:
                    print(f"Auto-reindex: Failed to initialize CodebaseIndexer: {e}")
                    return
            
            # Start background indexing
            print(f"Auto-reindex: Triggering background reindex for {codebase_indexer.workspace_path}")
            try:
                asyncio.create_task(start_background_indexing(str(codebase_indexer.workspace_path)))
            except Exception as e:
                print(f"Auto-reindex: Failed to start background indexing: {e}")
        elif user_workspace_directory and not codebase_indexer:
            # Initialize indexer if it doesn't exist
            print(f"Auto-reindex: Initializing indexer for workspace: {user_workspace_directory}")
            try:
                codebase_indexer = CodebaseIndexer(user_workspace_directory)
                asyncio.create_task(start_background_indexing(user_workspace_directory))
            except Exception as e:
                print(f"Auto-reindex: Failed to initialize CodebaseIndexer: {e}")
    except Exception as e:
        print(f"Auto-reindex error: {e}")
        # Don't let this error propagate and cause a 500 error

# Tool calling API endpoints
class ToolCallRequest(BaseModel):
    tool_name: str
    params: Dict[str, Any]

@app.post("/api/tools/call")
async def call_tool(request: ToolCallRequest):
    """
    Call a tool with specified parameters and return mock results.
    """
    # Auto-reindex codebase before tool execution
    await auto_reindex_codebase()
    
    print(f"Tool call request: {request.tool_name}, params: {request.params}")
    result = await handle_tool_call(request.tool_name, request.params)
    return result

@app.get("/api/tools/list")
async def list_tools():
    """
    Get a list of available tools.
    """
    return {"tools": TOOL_DEFINITIONS}

# Codebase indexing API endpoints
@app.get("/api/codebase/overview")
async def get_codebase_overview():
    """Get a comprehensive overview of the codebase."""
    global codebase_indexer
    
    if not codebase_indexer:
        return {"error": "No codebase indexed"}
    
    try:
        # Auto-reindex before generating overview
        await auto_reindex_codebase()
        
        # Add debugging information
        print(f"Codebase indexer workspace path: {codebase_indexer.workspace_path}")
        print(f"Current base_directory: {base_directory}")
        print(f"Current user_workspace_directory: {user_workspace_directory}")
        
        # Ensure we're using the correct workspace path
        if user_workspace_directory and str(codebase_indexer.workspace_path) != user_workspace_directory:
            print(f"Warning: Codebase indexer workspace ({codebase_indexer.workspace_path}) doesn't match user workspace ({user_workspace_directory})")
            # Reinitialize the codebase indexer with the correct workspace
            try:
                codebase_indexer = CodebaseIndexer(user_workspace_directory)
                print(f"Reinitialized codebase indexer with user workspace: {user_workspace_directory}")
            except Exception as e:
                print(f"Failed to reinitialize codebase indexer: {e}")
                return {"error": f"Workspace mismatch and failed to reinitialize: {str(e)}"}
        
        # Force a fresh index of the current workspace
        print(f"Force reindexing workspace: {codebase_indexer.workspace_path}")
        try:
            # Run indexing synchronously to ensure it completes before generating overview
            codebase_indexer.index_workspace(force_reindex=True)
            print(f"Successfully reindexed workspace with {codebase_indexer.get_indexing_info().get('total_indexed_files', 0)} files")
        except Exception as e:
            print(f"Error during reindexing: {e}")
            # Continue with existing data if reindexing fails
        
        overview = codebase_indexer.generate_project_overview()
        summary = codebase_indexer.get_project_summary()
        
        return {
            "overview": overview.__dict__,
            "summary": summary,
            "workspace_path": str(codebase_indexer.workspace_path),
            "user_workspace": user_workspace_directory,
            "base_directory": base_directory,
            "indexing_info": codebase_indexer.get_indexing_info()
        }
    except Exception as e:
        print(f"Error in get_codebase_overview: {str(e)}")
        return {"error": str(e)}

@app.get("/api/codebase/search")
async def search_codebase(query: str, element_types: str = None, limit: int = 50):
    """Search for code elements in the indexed codebase."""
    global codebase_indexer
    
    if not codebase_indexer:
        return {"error": "No codebase indexed"}
    
    try:
        # Check workspace mismatch and fix if needed
        if user_workspace_directory and str(codebase_indexer.workspace_path) != user_workspace_directory:
            print(f"Search: Workspace mismatch detected. Reinitializing with user workspace: {user_workspace_directory}")
            codebase_indexer = CodebaseIndexer(user_workspace_directory)
            # Force reindexing for fresh results
            codebase_indexer.index_workspace(force_reindex=True)
        
        element_types_list = element_types.split(',') if element_types else None
        results = codebase_indexer.search_code_elements(query, element_types_list, limit)
        
        return {
            "query": query,
            "results": results,
            "total": len(results),
            "workspace_path": str(codebase_indexer.workspace_path)
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/codebase/file-overview")
async def get_file_overview(file_path: str):
    """Get overview of a specific file including its code elements."""
    global codebase_indexer
    
    if not codebase_indexer:
        return {"error": "No codebase indexed"}
    
    try:
        # Check workspace mismatch and fix if needed
        if user_workspace_directory and str(codebase_indexer.workspace_path) != user_workspace_directory:
            print(f"File overview: Workspace mismatch detected. Reinitializing with user workspace: {user_workspace_directory}")
            codebase_indexer = CodebaseIndexer(user_workspace_directory)
            # Start indexing in background
            asyncio.create_task(start_background_indexing(user_workspace_directory))
        
        overview = codebase_indexer.get_file_overview(file_path)
        if overview:
            return overview
        else:
            return {"error": "File not found in index"}
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/codebase/reindex")
async def reindex_codebase(force: bool = False):
    """Trigger a reindex of the codebase."""
    global codebase_indexer
    
    if not codebase_indexer:
        return {"error": "No codebase indexer initialized"}
    
    try:
        # Check if we need to reinitialize with the correct workspace
        if user_workspace_directory and str(codebase_indexer.workspace_path) != user_workspace_directory:
            print(f"Reindexing: Workspace mismatch detected. Reinitializing with user workspace: {user_workspace_directory}")
            codebase_indexer = CodebaseIndexer(user_workspace_directory)
        
        # Start reindexing in background
        import threading
        def run_reindexing():
            codebase_indexer.index_workspace(force_reindex=force)
        
        thread = threading.Thread(target=run_reindexing, daemon=True)
        thread.start()
        
        return {
            "message": "Reindexing started in background", 
            "force": force,
            "workspace_path": str(codebase_indexer.workspace_path),
            "user_workspace": user_workspace_directory
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/codebase/info")
async def get_codebase_indexing_info():
    """Get information about the current codebase indexing setup."""
    if not codebase_indexer:
        return {"error": "No codebase indexer initialized"}
    
    try:
        info = codebase_indexer.get_indexing_info()
        
        # Add additional debugging information
        info.update({
            "codebase_indexer_workspace": str(codebase_indexer.workspace_path) if codebase_indexer else None,
            "user_workspace_directory": user_workspace_directory,
            "base_directory": base_directory,
            "workspace_mismatch": user_workspace_directory and codebase_indexer and str(codebase_indexer.workspace_path) != user_workspace_directory
        })
        
        return info
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/codebase/cleanup-old-cache")
async def cleanup_old_codebase_cache():
    """Clean up old .pointer_cache directory in the workspace."""
    if not codebase_indexer:
        return {"error": "No codebase indexer initialized"}
    
    try:
        result = codebase_indexer.cleanup_old_workspace_cache()
        return result
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/codebase/clear-cache")
async def clear_codebase_cache():
    """Clear the codebase cache and force a fresh index."""
    global codebase_indexer
    
    if not codebase_indexer:
        return {"error": "No codebase indexer initialized"}
    
    try:
        # Get the current workspace path
        workspace_path = str(codebase_indexer.workspace_path)
        
        # Clear the cache by reinitializing the indexer
        codebase_indexer = CodebaseIndexer(workspace_path)
        
        # Force a fresh index
        success = codebase_indexer.index_workspace(force_reindex=True)
        
        if success:
            indexing_info = codebase_indexer.get_indexing_info()
            return {
                "success": True,
                "message": f"Cache cleared and workspace reindexed. Found {indexing_info.get('total_indexed_files', 0)} files.",
                "workspace_path": workspace_path,
                "indexing_info": indexing_info
            }
        else:
            return {"error": "Failed to reindex workspace after clearing cache"}
    except Exception as e:
        print(f"Error clearing codebase cache: {str(e)}")
        return {"error": str(e)}

@app.post("/api/codebase/cleanup-database")
async def cleanup_codebase_database():
    """Clean up stale entries from the codebase database."""
    global codebase_indexer
    
    if not codebase_indexer:
        return {"error": "No codebase indexer initialized"}
    
    try:
        # Check workspace mismatch and fix if needed
        if user_workspace_directory and str(codebase_indexer.workspace_path) != user_workspace_directory:
            print(f"Database cleanup: Workspace mismatch detected. Reinitializing with user workspace: {user_workspace_directory}")
            codebase_indexer = CodebaseIndexer(user_workspace_directory)
        
        # Clean up stale database entries
        cleanup_result = codebase_indexer.cleanup_stale_database_entries()
        
        # Get updated indexing info
        indexing_info = codebase_indexer.get_indexing_info()
        
        return {
            "success": True,
            "message": f"Database cleanup completed. Removed {cleanup_result['removed_files']} stale files and {cleanup_result['removed_elements']} stale code elements.",
            "cleanup_result": cleanup_result,
            "indexing_info": indexing_info,
            "workspace_path": str(codebase_indexer.workspace_path)
        }
    except Exception as e:
        print(f"Error cleaning up codebase database: {str(e)}")
        return {"error": str(e)}

@app.get("/api/codebase/ai-context")
async def get_ai_context_summary():
    """Get a comprehensive AI-friendly summary of the codebase."""
    global codebase_indexer
    
    if not codebase_indexer:
        return {"error": "No codebase indexer initialized"}
    
    try:
        # Check workspace mismatch and fix if needed
        if user_workspace_directory and str(codebase_indexer.workspace_path) != user_workspace_directory:
            print(f"AI context: Workspace mismatch detected. Reinitializing with user workspace: {user_workspace_directory}")
            codebase_indexer = CodebaseIndexer(user_workspace_directory)
            # Start indexing in background
            asyncio.create_task(start_background_indexing(user_workspace_directory))
        
        context = codebase_indexer.get_ai_context_summary()
        context.update({
            "user_workspace": user_workspace_directory,
            "workspace_mismatch": user_workspace_directory and str(codebase_indexer.workspace_path) != user_workspace_directory
        })
        return context
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/codebase/workspace-status")
async def get_workspace_status():
    """Get the current workspace status and any mismatches."""
    return {
        "codebase_indexer_workspace": str(codebase_indexer.workspace_path) if codebase_indexer else None,
        "user_workspace_directory": user_workspace_directory,
        "base_directory": base_directory,
        "workspace_mismatch": user_workspace_directory and codebase_indexer and str(codebase_indexer.workspace_path) != user_workspace_directory,
        "has_codebase_indexer": codebase_indexer is not None
    }

@app.get("/api/codebase/overview-fresh")
async def get_codebase_overview_fresh():
    """Get a comprehensive overview of the codebase with forced fresh indexing."""
    global codebase_indexer
    
    if not codebase_indexer:
        return {"error": "No codebase indexer initialized"}
    
    try:
        # Add debugging information
        print(f"Fresh overview requested for workspace: {codebase_indexer.workspace_path}")
        
        # Ensure we're using the correct workspace path
        if user_workspace_directory and str(codebase_indexer.workspace_path) != user_workspace_directory:
            print(f"Workspace mismatch detected. Reinitializing with user workspace: {user_workspace_directory}")
            codebase_indexer = CodebaseIndexer(user_workspace_directory)
        
        # Force a complete fresh index
        print(f"Starting fresh indexing of workspace: {codebase_indexer.workspace_path}")
        success = codebase_indexer.index_workspace(force_reindex=True)
        
        if not success:
            return {"error": "Failed to reindex workspace"}
        
        indexing_info = codebase_indexer.get_indexing_info()
        overview = codebase_indexer.generate_project_overview()
        summary = codebase_indexer.get_project_summary()
        
        print(f"Fresh indexing completed. Found {indexing_info.get('total_indexed_files', 0)} files")
        
        return {
            "overview": overview.__dict__,
            "summary": summary,
            "workspace_path": str(codebase_indexer.workspace_path),
            "user_workspace": user_workspace_directory,
            "base_directory": base_directory,
            "indexing_info": indexing_info,
            "fresh_index": True
        }
    except Exception as e:
        print(f"Error in get_codebase_overview_fresh: {str(e)}")
        return {"error": str(e)}

@app.post("/api/codebase/query")
async def query_codebase_natural_language(request: dict):
    """Answer natural language questions about the codebase."""
    global codebase_indexer
    
    if not codebase_indexer:
        return {"error": "No codebase indexer initialized"}
    
    try:
        # Check workspace mismatch and fix if needed
        if user_workspace_directory and str(codebase_indexer.workspace_path) != user_workspace_directory:
            print(f"Query: Workspace mismatch detected. Reinitializing with user workspace: {user_workspace_directory}")
            codebase_indexer = CodebaseIndexer(user_workspace_directory)
            # Start indexing in background
            asyncio.create_task(start_background_indexing(user_workspace_directory))
        
        query = request.get("query", "")
        if not query:
            return {"error": "No query provided"}
        
        result = codebase_indexer.query_codebase_natural_language(query)
        return result
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/codebase/context")
async def get_relevant_context(request: dict):
    """Get relevant code context for a specific query or task."""
    global codebase_indexer
    
    if not codebase_indexer:
        return {"error": "No codebase indexer initialized"}
    
    try:
        # Check workspace mismatch and fix if needed
        if user_workspace_directory and str(codebase_indexer.workspace_path) != user_workspace_directory:
            print(f"Context: Workspace mismatch detected. Reinitializing with user workspace: {user_workspace_directory}")
            codebase_indexer = CodebaseIndexer(user_workspace_directory)
            # Start indexing in background
            asyncio.create_task(start_background_indexing(user_workspace_directory))
        
        query = request.get("query", "")
        max_files = request.get("max_files", 5)
        
        if not query:
            return {"error": "No query provided"}
        
        result = codebase_indexer.get_relevant_context_for_query(query, max_files)
        return result
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/codebase/chat-context")
async def get_codebase_chat_context():
    """Get a condensed codebase context suitable for chat system messages."""
    global codebase_indexer
    
    if not codebase_indexer:
        return {"error": "No codebase indexer initialized", "context": ""}
    
    try:
        # Check workspace mismatch and fix if needed
        if user_workspace_directory and str(codebase_indexer.workspace_path) != user_workspace_directory:
            print(f"Chat context: Workspace mismatch detected. Reinitializing with user workspace: {user_workspace_directory}")
            codebase_indexer = CodebaseIndexer(user_workspace_directory)
            # Start indexing in background
            asyncio.create_task(start_background_indexing(user_workspace_directory))
        
        # Get basic project info
        overview = codebase_indexer.generate_project_overview()
        summary = codebase_indexer.get_project_summary()
        
        # Create a condensed context for the AI
        context_lines = [
            "## Current Codebase Context",
            f"**Project**: {overview.total_files} files, {overview.total_lines:,} lines of code",
            ""
        ]
        
        # Add languages
        if overview.languages:
            lang_info = []
            for lang, count in sorted(overview.languages.items(), key=lambda x: x[1], reverse=True)[:5]:
                lang_info.append(f"{lang} ({count} files)")
            context_lines.extend([
                f"**Languages**: {', '.join(lang_info)}",
                ""
            ])
        
        # Add framework info
        if overview.framework_info:
            tech_stack = []
            for category, tech in overview.framework_info.items():
                tech_stack.append(f"{category.title()}: {tech}")
            context_lines.extend([
                f"**Tech Stack**: {', '.join(tech_stack)}",
                ""
            ])
        
        # Add directory structure
        if overview.main_directories:
            context_lines.extend([
                f"**Main Directories**: {', '.join(overview.main_directories[:5])}",
                ""
            ])
        
        # Add key files
        if overview.key_files:
            context_lines.extend([
                f"**Key Files**: {', '.join(overview.key_files[:5])}",
                ""
            ])
        
        # Add usage instructions
        context_lines.extend([
            "**Available Tools for Codebase Analysis**:",
            "- `get_ai_codebase_context()` - Get comprehensive codebase summary",
            "- `search_codebase(query)` - Search for functions, classes, components",
            "- `query_codebase_natural_language(query)` - Ask questions about the codebase",
            "- `get_relevant_codebase_context(query)` - Get context for specific tasks",
            "- `get_file_overview(file_path)` - Analyze specific files",
            ""
        ])
        
        context_text = "\n".join(context_lines)
        
        return {
            "context": context_text,
            "workspace_path": str(codebase_indexer.workspace_path),
            "user_workspace": user_workspace_directory,
            "summary": summary
        }
    except Exception as e:
        return {
            "error": str(e),
            "context": "Error loading codebase context. Use `get_codebase_overview()` to get project information."
        }

# GitHub API endpoints
@app.get("/github/user-repos")
async def get_user_repositories():
    """Get GitHub repositories for the authenticated user."""
    # Check if we have a GitHub token in settings
    settings_dir = get_app_data_path() / "settings"
    token_path = settings_dir / "github_token.json"
    
    if token_path.exists():
        try:
            with open(token_path, 'r') as file:
                token_data = json.load(file)
                token = token_data.get('token')
                
                if token:
                    headers = {
                        "Authorization": f"token {token}",
                        "Accept": "application/vnd.github.v3+json"
                    }
                    
                    response = requests.get(
                        "https://api.github.com/user/repos",
                        headers=headers,
                        params={"sort": "updated", "per_page": 25}
                    )
                    
                    if response.status_code == 200:
                        return {"repositories": response.json()}
        except Exception as e:
            print(f"Error fetching GitHub repositories: {str(e)}")
    
    # Return demo flag if not authenticated or error occurred
    return {"demo": True}

@app.get("/github/popular-repos")
async def get_popular_repositories():
    """Get popular GitHub repositories."""
    try:
        # Query GitHub API for popular repositories
        response = requests.get(
            "https://api.github.com/search/repositories",
            params={
                "q": "stars:>10000",
                "sort": "stars",
                "order": "desc",
                "per_page": 25
            },
            headers={"Accept": "application/vnd.github.v3+json"}
        )
        
        if response.status_code == 200:
            data = response.json()
            return {"repositories": data["items"]}
    except Exception as e:
        print(f"Error fetching popular repositories: {str(e)}")
    
    # Return demo flag if API error
    return {"demo": True}

# Include the git router
app.include_router(git_router)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # For a local desktop app there is usually no need for credentialed requests.
    # Disable cookies/credentials to reduce risk from unexpected cross-origin requests.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Filename", "X-Full-Path"],  # Explicitly expose our custom headers
)

# Global exception handler for HTTPException to ensure JSON responses
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Custom exception handler to return JSON for all HTTP errors."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={"Content-Type": "application/json"}
    )

class FileInfo(BaseModel):
    id: str
    name: str
    path: str
    type: str  # 'file' or 'directory'
    content: str | None = None
    parentId: str | None = None

class SaveFileRequest(BaseModel):
    path: str
    content: str

class CreateFileRequest(BaseModel):
    parentId: str
    name: str

class CreateDirectoryRequest(BaseModel):
    parentId: str
    name: str

class PathRequest(BaseModel):
    path: str

@app.post("/api/codebase/set-workspace")
async def set_codebase_workspace(request: PathRequest):
    """Set the workspace for codebase indexing and reinitialize the indexer."""
    global codebase_indexer
    
    try:
        if not request.path:
            return {"error": "No workspace path provided"}
            
        if not os.path.exists(request.path):
            return {"error": f"Workspace path does not exist: {request.path}"}
            
        if not os.path.isdir(request.path):
            return {"error": f"Workspace path is not a directory: {request.path}"}
        
        # Set the user workspace directory
        set_user_workspace_directory(request.path)
        
        # Reinitialize the codebase indexer with the new workspace
        codebase_indexer = CodebaseIndexer(request.path)
        
        # Start immediate indexing in background
        print(f"Auto-reindex: Starting immediate indexing for new codebase workspace: {request.path}")
        asyncio.create_task(start_background_indexing(request.path))
        
        print(f"Set codebase workspace to: {request.path}")
        
        return {
            "success": True,
            "workspace_path": request.path,
            "message": f"Codebase indexer reinitialized with workspace: {request.path}"
        }
    except Exception as e:
        print(f"Error setting codebase workspace: {str(e)}")
        return {"error": str(e)}

class RenameRequest(BaseModel):
    path: str
    new_name: str

class RelevantFilesRequest(BaseModel):
    query: str
    max_files: int = 10
    include_content: bool = True

# Add a new class for command execution
class CommandExecutionRequest(BaseModel):
    command: str
    timeout: int = 30  # Default timeout of 30 seconds
    executionId: str | None = None  # Optional ID for tracking executions

# Request model for reading settings files
class SettingsRequest(BaseModel):
    settingsDir: str = ""  # Directory containing settings files (optional, backend uses its own path)

# Request model for saving settings files
class SaveSettingsRequest(BaseModel):
    settingsDir: str  # Directory to save settings files
    settings: dict  # Settings data to save
    show_password: bool = False

class OpenAIAPIRequest(BaseModel):
    model: str
    messages: list
    temperature: float = 0.7
    max_tokens: int | None = None
    top_p: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    stream: bool = True
    api_key: str | None = None
    api_endpoint: str | None = None

class GitHubTokenRequest(BaseModel):
    token: str

# Add a user workspace directory variable
base_directory: str | None = None  # Initialize as None instead of os.getcwd()
user_workspace_directory: str | None = None  # User's actual workspace directory

# Add a file cache to track open files
file_cache: Dict[str, str] = {}

# Add function to set the user's workspace directory
def set_user_workspace_directory(path: str):
    """Set the user's current workspace directory and change cwd to it."""
    global user_workspace_directory
    if os.path.isdir(path):
        user_workspace_directory = os.path.abspath(path)
        # Change the current working directory to the user's workspace
        os.chdir(user_workspace_directory)
        print(f"Changed working directory to user workspace: {user_workspace_directory}")
        return True
    return False

# Add function to get the effective working directory
def get_working_directory():
    """Get the effective working directory for commands and operations.
    Prefers user_workspace_directory if set, falls back to base_directory."""
    if user_workspace_directory and os.path.isdir(user_workspace_directory):
        return user_workspace_directory
    return base_directory if base_directory else os.getcwd()

def is_text_file(filename: str) -> bool:
    """Check if a file is a text file based on its extension."""
    text_extensions = {
        'txt', 'js', 'jsx', 'ts', 'tsx', 'md', 'json', 'html', 'css', 'scss',
        'less', 'xml', 'svg', 'yaml', 'yml', 'ini', 'conf', 'sh', 'bash', 'py',
        'java', 'cpp', 'c', 'h', 'hpp', 'rs', 'go', 'rb', 'php', 'sql', 'vue',
        'gitignore', 'env', 'editorconfig', 'cs', 'ts', 'dart', 'swift', 'kt',
        'scala', 'lua', 'r', 'pl', 'pm', 'ex', 'exs', 'erl', 'hrl', 'clj', 'elm',
        'hs', 'lhs', 'fs', 'fsx', 'f', 'f90', 'cabal', 'cmake', 'mk', 'mak', 'css',
        'sass', 'less', 'styl', 'dockerfile', 'makefile', 'toml'
    }
    
    # Define binary file extensions
    binary_extensions = {
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', 'tar', 
        'gz', '7z', 'bin', 'exe', 'dll', 'so', 'dylib', 'o', 'obj', 'class', 'jar', 
        'war', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp', 'ico', 'mp3', 
        'mp4', 'avi', 'mov', 'webm', 'wav', 'ogg', 'ttf', 'otf', 'eot', 'woff', 
        'woff2', 'iso', 'db', 'sqlite'
    }
    
    ext = Path(filename).suffix.lstrip('.').lower()
    
    # If it's a known text extension, return True
    if ext in text_extensions:
        return True
    
    # If it's a known binary extension, return False
    if ext in binary_extensions:
        return False
    
    # For unknown extensions, try to detect by checking first few bytes
    try:
        file_path = os.path.join(base_directory, filename) if base_directory else filename
        if os.path.exists(file_path) and os.path.isfile(file_path):
            # Read first 1024 bytes to check for binary content
            with open(file_path, 'rb') as f:
                chunk = f.read(1024)
                # Check for null bytes which typically indicate binary files
                if b'\x00' in chunk:
                    return False
                
                # Try to decode as UTF-8 to confirm it's text
                try:
                    chunk.decode('utf-8')
                    return True
                except UnicodeDecodeError:
                    return False
    except Exception as e:
        print(f"Error checking if {filename} is text: {str(e)}")
    
    # Default to treating as text for unknown files
    return True

def generate_id(prefix: str, path: str) -> str:
    """Generate a unique ID for a file or directory."""
    # Normalize path to use forward slashes
    normalized_path = path.replace('\\', '/')
    # Remove any leading slashes
    normalized_path = normalized_path.lstrip('/')
    return f"{prefix}_{normalized_path}"

def scan_directory(path: str, parent_id: str | None = None) -> dict:
    """Scan a directory and return its contents."""
    items = {}
    
    try:
        # Create root item first
        root_path = Path(path)
        root_id = generate_id('root', str(root_path))
        
        try:
            relative_to_base = os.path.relpath(path, base_directory)
        except ValueError:
            relative_to_base = root_path.name

        # Use the actual folder name for the root
        folder_name = os.path.basename(path)
        if not folder_name:  # If path ends with a slash
            folder_name = os.path.basename(os.path.dirname(path))

        items[root_id] = FileInfo(
            id=root_id,
            name=folder_name,
            type='directory',
            path=relative_to_base,
            parentId=parent_id
        )

        entries = sorted(Path(path).iterdir())
        for entry in entries:
            # Skip hidden files
            if entry.name.startswith('.'):
                continue

            relative_path = os.path.relpath(str(entry), base_directory)
            entry_id = generate_id(
                'dir' if entry.is_dir() else 'file',
                relative_path
            )
            
            if entry.is_dir():
                items[entry_id] = FileInfo(
                    id=entry_id,
                    name=entry.name,
                    path=relative_path,
                    type='directory',
                    parentId=root_id
                )
            else:
                content = None
                if is_text_file(entry.name):
                    try:
                        if entry.stat().st_size <= 1024 * 1024:  # 1MB limit
                            try:
                                # Don't keep file handle open
                                with open(str(entry), 'r', encoding='utf-8', errors='replace') as f:
                                    content = f.read()
                                # Add to cache
                                file_cache[str(entry)] = content
                            except UnicodeDecodeError as ude:
                                content = '[Error: File encoding not supported]'
                            except PermissionError as pe:
                                content = '[Error: Permission denied]'
                            except OSError as oe:
                                content = f'[Error: OS Error - {str(oe)}]'
                            except Exception as e:
                                content = f'[Error reading file: {type(e).__name__} - {str(e)}]'
                        else:
                            content = '[File too large to display]'
                    except Exception as e:
                        content = f'[Error: {type(e).__name__} - {str(e)}]'
                else:
                    content = '[Binary file]'

                items[entry_id] = FileInfo(
                    id=entry_id,
                    name=entry.name,
                    path=relative_path,
                    type='file',
                    content=content,
                    parentId=root_id
                )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "items": items,
        "rootId": root_id,
        "path": path
    }


# --- Frontend compatibility endpoints ---
# The React frontend uses a couple of small REST helpers (not the tool API).
# Implement them here as thin wrappers around the existing workspace logic.

@app.get("/list-directory")
async def list_directory(path: str):
    """
    List the direct entries of a directory.

    Returns: { contents: string[] }
    """
    if not base_directory:
        raise HTTPException(status_code=400, detail="No directory opened")

    try:
        normalized_base = os.path.abspath(base_directory)

        # Empty path means "workspace root"
        if path is None or path.strip() == "":
            full_path = normalized_base
        else:
            # Resolve relative paths against the current workspace
            if os.path.isabs(path):
                full_path = os.path.abspath(path)
            else:
                full_path = os.path.abspath(os.path.join(base_directory, path))

            # Security: for both relative and absolute inputs, require "inside workspace"
            if os.path.commonpath([os.path.normcase(normalized_base), os.path.normcase(full_path)]) != os.path.normcase(normalized_base):
                raise HTTPException(status_code=403, detail="Access denied")

        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail="Directory not found")
        if not os.path.isdir(full_path):
            raise HTTPException(status_code=400, detail="Path is not a directory")

        contents = sorted(os.listdir(full_path))
        return {"contents": contents}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/file-exists")
async def file_exists(request: PathRequest):
    """
    Check whether a file exists within the current workspace.

    Returns: { exists: boolean }
    """
    if not base_directory:
        raise HTTPException(status_code=400, detail="No directory opened")

    try:
        if not request.path:
            return {"exists": False}

        normalized_base = os.path.abspath(base_directory)

        if os.path.isabs(request.path):
            full_path = os.path.abspath(request.path)
        else:
            full_path = os.path.abspath(os.path.join(base_directory, request.path))

        # Security: only allow paths inside the workspace
        if os.path.commonpath([os.path.normcase(normalized_base), os.path.normcase(full_path)]) != os.path.normcase(normalized_base):
            raise HTTPException(status_code=403, detail="Access denied")

        return {"exists": os.path.isfile(full_path)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/test-backend")
async def test_backend():
    """Test endpoint to verify the backend is running."""
    return {"status": "ok", "message": "Backend is running"}

@app.get("/health")
async def health_check():
    """Health check endpoint for backend status."""
    try:
        # Check basic functionality
        health_status = {
            "status": "healthy",
            "timestamp": time.time(),
            "workspace_directory": user_workspace_directory,
            "base_directory": base_directory,
            "codebase_indexer_initialized": codebase_indexer is not None
        }
        
        # Check if chat directory is accessible
        try:
            chats_dir = get_chats_directory()
            health_status["chat_directory_accessible"] = chats_dir.exists() or chats_dir.parent.exists()
        except Exception as e:
            health_status["chat_directory_accessible"] = False
            health_status["chat_directory_error"] = str(e)
        
        return health_status
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"status": "unhealthy", "error": str(e)}
        )


@app.post("/ide-state/update-cursor")
async def ide_state_update_cursor(payload: dict):
    """
    Frontend compatibility endpoint.

    Pointer's Discord Rich Presence is updated via Electron IPC, not this backend,
    but the UI does a POST to keep the editor state in sync.
    """
    # Payload shape: { file_path: string, line: number, column: number }
    return {"success": True}

@app.post("/fetch_webpage")
async def fetch_webpage_endpoint(request: dict):
    """Fetch webpage content and metadata."""
    try:
        from tools_handlers import fetch_webpage
        
        if not request.get("url"):
            raise HTTPException(status_code=400, detail="URL is required")
        
        url = request["url"]
        print(f"Fetching webpage: {url}")
        
        result = await fetch_webpage(url)
        print(f"Fetch result: success={result.get('success')}, content_length={len(result.get('content', '')) if result.get('content') else 0}")
        
        return result
    except Exception as e:
        print(f"Error in fetch_webpage endpoint: {e}")
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)}
        )

@app.post("/open-directory")
async def open_directory():
    """Open a directory using dialog and return its contents."""
    global base_directory, codebase_indexer
    
    if qt_app is None:
        raise HTTPException(status_code=500, detail="File dialog not available - Qt not initialized")
    
    dialog = QFileDialog()
    dialog.setFileMode(QFileDialog.Directory)
    dialog.setOption(QFileDialog.ShowDirsOnly, True)
    
    if dialog.exec_():
        folders = dialog.selectedFiles()
        if not folders:
            raise HTTPException(status_code=400, detail="No directory selected")
        
        path = folders[0]
        base_directory = path
        # Also set as user workspace directory
        set_user_workspace_directory(path)
        
        # Initialize codebase indexer and start immediate indexing
        try:
            codebase_indexer = CodebaseIndexer(path)
            # Start immediate indexing in background
            print(f"Auto-reindex: Starting immediate indexing for new workspace: {path}")
            asyncio.create_task(start_background_indexing(path))
            print(f"Started codebase indexing for: {path}")
        except Exception as e:
            print(f"Failed to initialize codebase indexer: {e}")
            codebase_indexer = None
        
        return scan_directory(path)
    
    raise HTTPException(status_code=400, detail="No directory selected")

@app.get("/read-directory")
async def read_directory(path: str):
    """Read contents of a specific directory."""
    if not base_directory:
        raise HTTPException(status_code=400, detail="No directory opened")

    full_path = os.path.join(base_directory, path)
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="Directory not found")
    if not os.path.isdir(full_path):
        raise HTTPException(status_code=400, detail="Path is not a directory")

    return scan_directory(full_path)

@app.post("/save-file")
async def save_file(request: Request):
    """
    Save content to a file.

    Compatibility:
    - JSON body: { "path": "...", "content": "..." }  (used by FileSystemService)
    - Raw body: <string>, with query param ?path=...   (used by FileChangeEventService)
    """
    if not base_directory:
        raise HTTPException(status_code=400, detail="No directory opened")

    try:
        query_path = request.query_params.get("path")
        content_type = (request.headers.get("content-type") or "").lower()
        body_bytes = await request.body()
        body_text = body_bytes.decode("utf-8", errors="replace") if body_bytes else ""

        path: str | None = None
        content: str | None = None

        # Prefer JSON when content-type says so
        if content_type.startswith("application/json"):
            payload = await request.json()
            if isinstance(payload, dict):
                path = payload.get("path") or query_path
                content = payload.get("content")

        # If not JSON, try to handle the raw-text variant
        if path is None and query_path:
            path = query_path
            content = body_text

        # As a fallback, attempt JSON parsing even if the content-type was not set
        if path is None and body_text:
            try:
                payload = json.loads(body_text)
                if isinstance(payload, dict):
                    path = payload.get("path") or query_path
                    content = payload.get("content")
            except Exception:
                pass

        if not path:
            raise HTTPException(status_code=400, detail="No file path provided")
        if content is None:
            content = ""

        # For paths starting with 'file_', treat it as file-id format
        if path.startswith("file_"):
            path = path[5:]

        normalized_base = os.path.abspath(base_directory)

        if os.path.isabs(path):
            full_path = os.path.abspath(path)
        else:
            full_path = os.path.abspath(os.path.join(base_directory, path))

        # Security: ensure the resolved path stays inside the workspace
        if os.path.commonpath([os.path.normcase(normalized_base), os.path.normcase(full_path)]) != os.path.normcase(normalized_base):
            raise HTTPException(status_code=403, detail="Access denied")

        # Create parent directories if they don't exist
        parent_dir = os.path.dirname(full_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)

        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)

        # Update the cache if the file is cached
        if full_path in file_cache:
            file_cache[full_path] = content

        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/create-dir")
async def create_dir(path: str):
    """
    Create directory recursively (frontend compatibility).

    Frontend usage: POST /create-dir?path=<dir>
    Returns: { success: true }
    """
    if not base_directory:
        raise HTTPException(status_code=400, detail="No directory opened")
    if path is None or path.strip() == "":
        raise HTTPException(status_code=400, detail="Path is required")

    try:
        normalized_base = os.path.abspath(base_directory)
        if os.path.isabs(path):
            full_path = os.path.abspath(path)
        else:
            full_path = os.path.abspath(os.path.join(base_directory, path))

        # Security: only allow inside the workspace
        if os.path.commonpath([os.path.normcase(normalized_base), os.path.normcase(full_path)]) != os.path.normcase(normalized_base):
            raise HTTPException(status_code=403, detail="Access denied")

        os.makedirs(full_path, exist_ok=True)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/create-file")
async def create_file(request: CreateFileRequest):
    """Create a new file."""
    if not base_directory:
        raise HTTPException(status_code=400, detail="No directory opened")

    try:
        # Get parent path from parentId
        parent_path = ""
        if not request.parentId.startswith('root_'):
            # Find the parent item to get its path
            for entry in Path(base_directory).rglob('*'):
                if entry.is_dir():
                    entry_id = generate_id('dir', os.path.relpath(str(entry), base_directory))
                    if entry_id == request.parentId:
                        parent_path = os.path.relpath(str(entry), base_directory)
                        break
        
        # Create the full path for the new file
        full_path = os.path.join(base_directory, parent_path, request.name)
        
        if os.path.exists(full_path):
            raise HTTPException(status_code=400, detail="File already exists")

        # Create parent directories if they don't exist
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        # Create empty file
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write('')

        # Generate response with file info
        relative_path = os.path.relpath(full_path, base_directory)
        file_id = generate_id('file', relative_path)
        
        file_info = FileInfo(
            id=file_id,
            name=request.name,
            path=relative_path,
            type='file',
            content='',
            parentId=request.parentId
        )

        return {
            "id": file_id,
            "file": file_info
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/create-directory")
async def create_directory(request: CreateDirectoryRequest):
    """Create a new directory."""
    if not base_directory:
        raise HTTPException(status_code=400, detail="No directory opened")

    try:
        # Get parent path from parentId
        parent_path = ""
        if not request.parentId.startswith('root_'):
            # Find the parent item to get its path
            for entry in Path(base_directory).rglob('*'):
                if entry.is_dir():
                    entry_id = generate_id('dir', os.path.relpath(str(entry), base_directory))
                    if entry_id == request.parentId:
                        parent_path = os.path.relpath(str(entry), base_directory)
                        break
        
        # Create the full path for the new directory
        full_path = os.path.join(base_directory, parent_path, request.name)
        
        if os.path.exists(full_path):
            raise HTTPException(status_code=400, detail="Directory already exists")

        # Create the directory
        os.makedirs(full_path)

        # Generate response with directory info
        relative_path = os.path.relpath(full_path, base_directory)
        dir_id = generate_id('dir', relative_path)
        
        dir_info = FileInfo(
            id=dir_id,
            name=request.name,
            path=relative_path,
            type='directory',
            parentId=request.parentId
        )

        return {
            "id": dir_id,
            "directory": dir_info
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/delete")
@app.post("/delete")
async def delete_item(request: PathRequest):
    """Delete a file or directory."""
    if not base_directory:
        raise HTTPException(status_code=400, detail="No directory opened")

    try:
        full_path = os.path.abspath(os.path.join(base_directory, request.path))
        
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail="Path not found")

        # Clear any cached references to files we're about to delete
        if os.path.isdir(full_path):
            # Clear cache for all files in directory
            for cached_path in list(file_cache.keys()):
                if cached_path.startswith(full_path):
                    del file_cache[cached_path]
        else:
            # Clear cache for single file
            if full_path in file_cache:
                del file_cache[full_path]

        # Force garbage collection
        import gc
        gc.collect()

        if os.path.isdir(full_path):
            import shutil
            shutil.rmtree(full_path, ignore_errors=True)
        else:
            os.remove(full_path)

        return {'success': True}
            
    except Exception as e:
        print(f"Error in delete_item: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/open-specific-directory")
async def open_specific_directory(request: PathRequest):
    """Open a specific directory path."""
    global base_directory, codebase_indexer
    
    if not request.path:
        raise HTTPException(status_code=400, detail="No directory path provided")
        
    if not os.path.exists(request.path):
        raise HTTPException(status_code=404, detail="Directory not found")
    if not os.path.isdir(request.path):
        raise HTTPException(status_code=400, detail="Path is not a directory")
    
    base_directory = os.path.abspath(request.path)
    
    # Also set this as the user workspace directory
    set_user_workspace_directory(request.path)
    
    # Initialize codebase indexer and start immediate indexing
    try:
        codebase_indexer = CodebaseIndexer(request.path)
        # Start immediate indexing in background
        print(f"Auto-reindex: Starting immediate indexing for new workspace: {request.path}")
        asyncio.create_task(start_background_indexing(request.path))
        print(f"Started codebase indexing for: {request.path}")
    except Exception as e:
        print(f"Failed to initialize codebase indexer: {e}")
        codebase_indexer = None
    
    return scan_directory(request.path)

@app.post("/fetch-folder-contents")
async def fetch_folder_contents(request: PathRequest):
    """Fetch contents of a specific folder."""
    global base_directory
    
    if not base_directory:
        raise HTTPException(status_code=400, detail="No directory opened. Please open a directory first.")

    # Handle empty path as root directory
    if not request.path:
        return scan_directory(base_directory)
        
    target_path = os.path.join(base_directory, request.path)
    
    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail="Directory not found")
    if not os.path.isdir(target_path):
        raise HTTPException(status_code=400, detail="Path is not a directory")

    return scan_directory(target_path)

@app.get("/read-file")
async def read_file(path: str, currentDir: str | None = None):
    """Read a file's contents."""
    if not base_directory:
        raise HTTPException(status_code=400, detail="No directory opened")

    try:
        # Normalize base directory path
        normalized_base = os.path.normpath(base_directory).replace('\\', '/')
        
        # Normalize current directory if provided
        normalized_current = os.path.normpath(currentDir).replace('\\', '/') if currentDir else None
        
        # Normalize requested path
        normalized_path = path.replace('\\', '/')

        # Try multiple path resolutions
        paths_to_try = [
            os.path.normpath(os.path.join(normalized_base, normalized_path)),
            os.path.normpath(os.path.join(normalized_current, normalized_path)) if normalized_current else None,
        ]
        paths_to_try = [p for p in paths_to_try if p is not None]


        # Try each path
        for try_path in paths_to_try:
            # Normalize the full path
            full_path = os.path.normpath(try_path).replace('\\', '/')
            
            # Security check - make sure the path is within base directory
            if not full_path.startswith(normalized_base):
                print(f"Security check failed for {full_path} (not within {normalized_base})")
                continue
                
            if os.path.exists(full_path) and os.path.isfile(full_path):
                # Read and return the file content with explicit newline handling
                with open(full_path, 'r', encoding='utf-8', newline=None) as f:
                    content = f.read()
                    # Ensure consistent line endings in the response
                    content = content.replace('\r\n', '\n').replace('\r', '\n')
                    
                    # Set response headers to indicate line ending format
                    response = PlainTextResponse(content)
                    response.headers["Content-Type"] = "text/plain; charset=utf-8"
                    response.headers["X-Line-Endings"] = "LF"
                    return response

        # If we get here, no valid path was found
        raise HTTPException(
            status_code=404, 
            detail=f"File not found: {normalized_path}\nTried paths: {paths_to_try}\nBase directory: {normalized_base}"
        )

    except Exception as e:
        print(f"Error reading file {path}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/open-file")
async def open_file():
    """Open a file using dialog and return its contents."""
    if qt_app is None:
        raise HTTPException(status_code=500, detail="File dialog not available - Qt not initialized")
    
    dialog = QFileDialog()
    dialog.setFileMode(QFileDialog.ExistingFile)
    
    if dialog.exec_():
        files = dialog.selectedFiles()
        if not files:
            raise HTTPException(status_code=400, detail="No file selected")
        
        file_path = files[0]
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")
        if not os.path.isfile(file_path):
            raise HTTPException(status_code=400, detail="Path is not a file")

        # Check file size
        if os.path.getsize(file_path) > 1024 * 1024:  # 1MB limit
            return PlainTextResponse("[File too large (>1MB)]")

        try:
            with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
                abs_path = os.path.abspath(file_path)
                
                response = PlainTextResponse(content)
                response.headers["Access-Control-Expose-Headers"] = "X-Filename, X-Full-Path"
                response.headers["X-Filename"] = os.path.basename(file_path)
                response.headers["X-Full-Path"] = abs_path
                
                return response
        except Exception as e:
            print(f"Error reading file: {str(e)}")
            return PlainTextResponse(f"[Error reading file: {str(e)}]")
    
    raise HTTPException(status_code=400, detail="No file selected")

@app.post("/read-text", response_class=PlainTextResponse)
async def read_text(request: PathRequest):
    """Read any text file from any path."""
    try:
        file_path = request.path
        
        if not os.path.exists(file_path):
            return f"[Error: File not found: {file_path}]"
        if not os.path.isfile(file_path):
            return f"[Error: Not a file: {file_path}]"

        # Simple size check
        size = os.path.getsize(file_path)
        if size > 1024 * 1024:  # 1MB limit
            return f"[Error: File too large: {size/1024/1024:.1f}MB]"
        if size == 0:
            return ""  # Empty file

        try:
            with open(file_path, 'rb') as f:  # Open in binary mode first
                raw = f.read()
                
                # Try UTF-8 first
                try:
                    return raw.decode('utf-8')
                except UnicodeDecodeError:
                    # If UTF-8 fails, try with errors='replace'
                    return raw.decode('utf-8', errors='replace')
                
        except Exception as e:
            print(f"Error reading file {file_path}: {str(e)}")
            return f"[Error reading file: {str(e)}]"

    except Exception as e:
        print(f"Error in read_text: {str(e)}")
        return f"[Error: {str(e)}]"

@app.post("/rename")
async def rename_item(request: RenameRequest):
    try:
        # Get the absolute path
        abs_path = os.path.join(base_directory, request.path)
        if not os.path.exists(abs_path):
            return JSONResponse(
                status_code=404,
                content={"success": False, "error": f"Path not found: {request.path}"}
            )

        # Get directory and new path
        dir_path = os.path.dirname(abs_path)
        new_abs_path = os.path.join(dir_path, request.new_name)
        
        # Check if target already exists
        if os.path.exists(new_abs_path):
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": f"A file or directory with name '{request.new_name}' already exists"}
            )

        # Perform rename
        os.rename(abs_path, new_abs_path)
        
        # Return new relative path
        new_rel_path = os.path.relpath(new_abs_path, base_directory)
        return {"success": True, "new_path": new_rel_path}

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)}
        )

@app.get("/chats")
async def list_chats():
    chats_dir = get_chats_directory()
    chats_dir.mkdir(parents=True, exist_ok=True)
    
    chats = []
    for file in chats_dir.glob('*.json'):
        try:
            with open(file, 'r', encoding='utf-8') as f:
                chat = json.load(f)
                # Only include chats that have actual messages (more than just system message)
                if chat.get('messages') and len(chat['messages']) > 1:
                    chats.append(chat)
        except Exception as e:
            print(f"Error reading chat file {file}: {e}")
    
    return sorted(chats, key=lambda x: x.get('createdAt', ''), reverse=True)

@app.get("/chats/{chat_id}")
async def get_chat(chat_id: str):
    """Get a specific chat by ID."""
    try:
        chats_dir = get_chats_directory()
        chats_dir.mkdir(parents=True, exist_ok=True)
        
        chat_file = chats_dir / f"{chat_id}.json"
        
        if not chat_file.exists():
            return JSONResponse(
                status_code=404,
                content={"detail": "Chat not found"}
            )
            
        with open(chat_file, 'r', encoding='utf-8') as f:
            chat = json.load(f)
            return chat
    except Exception as e:
        print(f"Error reading chat file {chat_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"detail": f"Error reading chat: {str(e)}"}
        )

@app.get("/chats/{chat_id}/latest")
async def get_latest_chat_messages(chat_id: str, after_index: int = 0):
    """Get only the latest messages from a chat after a specific index."""
    try:
        chats_dir = get_chats_directory()
        chats_dir.mkdir(parents=True, exist_ok=True)
        
        chat_file = chats_dir / f"{chat_id}.json"
        
        if not chat_file.exists():
            return JSONResponse(
                status_code=404,
                content={"detail": "Chat not found"}
            )
            
        with open(chat_file, 'r', encoding='utf-8') as f:
            chat = json.load(f)
            
            # Extract only the messages after the specified index
            if after_index >= 0 and after_index < len(chat.get('messages', [])):
                chat['messages'] = chat['messages'][after_index:]
                print(f"Returning {len(chat['messages'])} messages after index {after_index} for chat {chat_id}")
            else:
                print(f"Invalid after_index {after_index}, returning all {len(chat.get('messages', []))} messages for chat {chat_id}")
                
            return chat
    except Exception as e:
        print(f"Error reading chat file {chat_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"detail": f"Error reading chat: {str(e)}"}
        )

@app.get("/get-chat-file-path")
async def get_chat_file_path(chat_id: str):
    """Get the file path and content for a specific chat."""
    try:
        chats_dir = get_chats_directory()
        chats_dir.mkdir(parents=True, exist_ok=True)
        
        chat_file = chats_dir / f"{chat_id}.json"
        
        if not chat_file.exists():
            return JSONResponse(
                status_code=404,
                content={"detail": "Chat not found"}
            )
        
        # Read the file content directly
        with open(chat_file, 'r', encoding='utf-8') as f:
            content = f.read()
            
        return {
            "file_path": str(chat_file),
            "content": content,
            "filename": f"{chat_id}.json"
        }
    except Exception as e:
        print(f"Error getting chat file for {chat_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"detail": f"Error getting chat file: {str(e)}"}
        )

class ChatMessage(BaseModel):
    """Model for a chat message to be appended to a chat."""
    messages: List[dict]  # Messages to append
    is_edit: bool = False  # Flag to indicate if this is an edit
    edit_index: int = -1   # If is_edit is true, index of the message to replace
    overwrite: bool = False # If true, completely overwrite the chat (only for migrations or emergency fixes)

def is_partial_message(msg1, msg2):
    """Check if msg1 is a partial/incomplete version of msg2"""
    # DISABLED: This function was causing legitimate messages to be replaced
    # The aggressive partial message detection was incorrectly identifying 
    # complete messages as partial versions of other messages
    
    # Only allow very specific cases where we're absolutely certain
    # For now, disable all partial message detection to prevent message loss
    return False
    
    # TODO: If partial message detection is needed in the future,
    # implement a much more conservative approach that requires:
    # 1. Identical message IDs or timestamps within seconds
    # 2. Exact prefix matching with significant length differences
    # 3. User confirmation for any message replacement

@app.post("/chats/{chat_id}")
async def save_chat(chat_id: str, request: ChatMessage):
    """
    Save a chat with simple, reliable logic.
    Always overwrites the entire chat to ensure clean state.
    """
    try:
        chats_dir = get_chats_directory()
        chats_dir.mkdir(parents=True, exist_ok=True)
        
        chat_file = chats_dir / f"{chat_id}.json"
        
        print(f"=== SAVE CHAT REQUEST ===")
        print(f"Chat ID: {chat_id}")
        print(f"Request messages count: {len(request.messages)}")
        
        # Validate incoming messages structure
        if not isinstance(request.messages, list):
            raise ValueError("Request messages must be a list")
        
        # Validate each message and track tool call IDs to prevent duplicates
        valid_messages = []
        seen_tool_call_ids = set()
        for i, msg in enumerate(request.messages):
            if not isinstance(msg, dict):
                print(f"Skipping invalid message {i}: not a dictionary")
                continue
            if 'role' not in msg:
                print(f"Skipping invalid message {i}: missing role field")
                continue
            if msg['role'] not in ['system', 'user', 'assistant', 'tool']:
                print(f"Skipping invalid message {i}: invalid role '{msg['role']}'")
                continue
            
            # Check for duplicate tool messages
            if msg['role'] == 'tool' and 'tool_call_id' in msg:
                tool_call_id = msg['tool_call_id']
                if tool_call_id in seen_tool_call_ids:
                    print(f"Skipping duplicate tool message {i} with ID: {tool_call_id}")
                    continue
                seen_tool_call_ids.add(tool_call_id)
            
            # Clean the message content
            if 'content' in msg and msg['content'] is not None:
                content = str(msg['content'])
                
                # Only clear content for clearly malformed patterns, not legitimate tool results
                # Tool responses often contain "Success" and JSON objects, which are legitimate
                if (msg['role'] == 'tool' and 
                    ('function_call:' in content or 'tool_call:' in content or 'ERROR:' in content)):
                    # Only clear tool messages that contain malformed function call syntax
                    print(f"Cleaning malformed tool response from message {i}")
                    msg['content'] = ''
                elif (msg['role'] != 'tool' and 
                      any(bad_content in content for bad_content in [
                          'function_call:', 'tool_call:', 'ERROR:', 'DEBUG:'
                      ])):
                    # For non-tool messages, be more aggressive about cleaning
                    print(f"Cleaning malformed content from message {i}")
                    msg['content'] = ''
                else:
                    # Keep legitimate content, including tool results
                    msg['content'] = content
            else:
                msg['content'] = ''
            
            # Preserve tool_calls field for assistant messages
            if msg['role'] == 'assistant' and 'tool_calls' in msg and msg['tool_calls']:
                # Ensure tool_calls is properly formatted
                if isinstance(msg['tool_calls'], list):
                    # Validate and clean each tool call
                    cleaned_tool_calls = []
                    for tc in msg['tool_calls']:
                        if isinstance(tc, dict) and 'function' in tc:
                            cleaned_tc = {
                                'id': tc.get('id', f"tool_{int(time.time())}_{i}"),
                                'type': tc.get('type', 'function'),
                                'function': {
                                    'name': tc['function'].get('name', 'unknown'),
                                    'arguments': tc['function'].get('arguments', '{}')
                                }
                            }
                            cleaned_tool_calls.append(cleaned_tc)
                    msg['tool_calls'] = cleaned_tool_calls
                    print(f"Preserved {len(cleaned_tool_calls)} tool calls for assistant message {i}")
            
            valid_messages.append(msg)
        
        print(f"Validated {len(valid_messages)} messages out of {len(request.messages)}")
        
        # Debug: log tool message content and assistant tool_calls
        for i, msg in enumerate(valid_messages):
            if msg.get('role') == 'tool':
                print(f"Tool message {i}: content='{msg.get('content', '')}' (length: {len(msg.get('content', ''))})")
            elif msg.get('role') == 'assistant' and msg.get('tool_calls'):
                print(f"Assistant message {i}: has {len(msg['tool_calls'])} tool_calls")
                for j, tc in enumerate(msg['tool_calls']):
                    print(f"  Tool call {j}: name='{tc.get('function', {}).get('name', 'unknown')}', args='{tc.get('function', {}).get('arguments', '{}')}'")
        
        # Create clean chat data
        chat_data = {
            "id": chat_id,
            "name": "New Chat",
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "messages": valid_messages
        }
        
        # Extract chat name from first user message if available
        for msg in valid_messages:
            if msg.get('role') == 'user' and msg.get('content'):
                content = str(msg['content'])
                if len(content) > 0:
                    # Take first 50 characters for chat name
                    chat_data["name"] = content[:50].strip()
                    if len(chat_data["name"]) == 0:
                        chat_data["name"] = "New Chat"
                    break
        
        # Save the chat file
        try:
            with open(chat_file, 'w', encoding='utf-8') as f:
                json.dump(chat_data, f, indent=2)
        except Exception as e:
            raise ValueError(f"Failed to write chat file: {e}")
        
        print(f"Chat {chat_id} saved successfully: {len(valid_messages)} messages")
        print(f"=== END SAVE CHAT REQUEST ===")
        
        return {
            'success': True, 
            'operation': 'overwrite', 
            'message_count': len(valid_messages)
        }
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Error saving chat {chat_id}: {e}")
        print(f"Full traceback: {error_details}")
        return JSONResponse(
            status_code=500,
            content={"detail": f"Error saving chat: {str(e)}"}
        )

@app.get("/files")
async def list_files(currentDir: str | None = None):
    """List all files in the project."""
    try:
        # Use provided currentDir if available, otherwise use base_directory
        working_dir = currentDir if currentDir else base_directory
        
        if not working_dir:
            raise HTTPException(
                status_code=400, 
                detail="No directory opened. Please open a directory first using the file explorer."
            )

        files = []
        for root, _, filenames in os.walk(working_dir):
            for filename in filenames:
                full_path = os.path.join(root, filename)
                rel_path = os.path.relpath(full_path, working_dir)
                files.append({
                    "path": rel_path.replace("\\", "/"),
                    "type": "file"
                })
        
        if not files:
            return []  # Return empty list if directory is empty
            
        return sorted(files, key=lambda x: x["path"])
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error listing files: {str(e)}"
        )

@app.post("/get-relevant-files")
async def get_relevant_files(request: RelevantFilesRequest):
    """Get files relevant to a search query using keyword extraction."""
    if not base_directory:
        raise HTTPException(status_code=400, detail="No directory opened")

    try:
        # Extract keywords from the query
        keywords = extract_keywords(request.query)
        
        relevant_files = []
        
        # Walk through the directory
        for root, _, files in os.walk(base_directory):
            for file in files:
                if not is_text_file(file):
                    continue
                    
                file_path = os.path.join(root, file)
                relative_path = os.path.relpath(file_path, base_directory)
                
                try:
                    # Check if file is in cache
                    if file_path in file_cache:
                        content = file_cache[file_path]
                    else:
                        # Read file content if not too large
                        if os.path.getsize(file_path) <= 1024 * 1024:  # 1MB limit
                            with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                                content = f.read()
                            file_cache[file_path] = content
                        else:
                            continue
                    
                    # Calculate relevance score based on multiple factors
                    score = 0
                    content_lower = content.lower()
                    
                    # 1. Keyword frequency in content
                    for keyword in keywords:
                        keyword_lower = keyword.lower()
                        count = content_lower.count(keyword_lower)
                        if count > 0:
                            # Log scale for frequency to prevent large files from dominating
                            score += (1 + math.log(count)) * 2
                    
                    # 2. Keyword presence in file path (higher weight)
                    path_lower = relative_path.lower()
                    for keyword in keywords:
                        if keyword.lower() in path_lower:
                            score += 5
                    
                    # 3. Keyword proximity (keywords appearing close together)
                    words = content_lower.split()
                    for i in range(len(words)):
                        matches = 0
                        for j in range(5):  # Look at 5-word windows
                            if i + j < len(words) and any(k.lower() in words[i + j] for k in keywords):
                                matches += 1
                        score += matches * 0.5  # Bonus for keywords appearing close together
                    
                    if score > 0:
                        relevant_files.append({
                            'path': relative_path,
                            'score': round(score, 2)  # Round to 2 decimal places
                        })
                except Exception as e:
                    print(f"Error processing file {file_path}: {str(e)}")
                    continue
        
        # Sort by relevance score
        relevant_files.sort(key=lambda x: x['score'], reverse=True)
        
        # Limit the number of results
        relevant_files = relevant_files[:request.max_files]
        
        return {
            'files': relevant_files,
            'keywords': keywords
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/get-file-contents")
async def get_file_contents(files: List[str]):
    """Get the contents of specific files."""
    if not base_directory:
        raise HTTPException(status_code=400, detail="No directory opened")

    try:
        file_contents = {}
        for file_path in files:
            full_path = os.path.join(base_directory, file_path)
            
            try:
                if os.path.exists(full_path) and is_text_file(file_path):
                    if os.path.getsize(full_path) <= 1024 * 1024:  # 1MB limit
                        with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
                            content = f.read()
                        file_contents[file_path] = content
            except Exception as e:
                print(f"Error reading file {file_path}: {str(e)}")
                continue

        return file_contents
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Add new endpoint for command execution
@app.post("/execute-command")
async def execute_command(request: CommandExecutionRequest):
    """Execute a terminal command and return the output."""
    try:
        if not base_directory:
            raise HTTPException(status_code=400, detail="No directory opened")

        # Basic input hardening
        command = (request.command or "").strip()
        if not command:
            raise HTTPException(status_code=400, detail="Command is required")

        if len(command) > 5000:
            return {
                "executionId": request.executionId or f"auto_{int(time.time())}",
                "error": "Command too long",
                "command": request.command,
                "timestamp": int(time.time())
            }

        # Block command injection via control characters
        if any(ch in command for ch in ["\n", "\r", "\x00"]):
            return {
                "executionId": request.executionId or f"auto_{int(time.time())}",
                "error": "Invalid command characters",
                "command": request.command,
                "timestamp": int(time.time())
            }

        # Keep timeout within a reasonable range to reduce resource abuse
        timeout = request.timeout if request.timeout is not None else 30
        timeout = max(1, min(int(timeout), 120))

        # Security: prevent destructive/system-altering commands
        dangerous_commands = [
            "rm", "del", "format", "fdisk", "mkfs", "dd",
            "shutdown", "reboot", "halt",
            "kill -9", "killall", "kill ",
            "chmod 777", "chown", "passwd",
            "su ", "sudo su", "sudo -i", "sudo rm", "sudo ",
            "net user", "netsh ",
        ]
        command_lower = command.lower()
        for dangerous in dangerous_commands:
            if dangerous in command_lower:
                return {
                    "executionId": request.executionId or f"auto_{int(time.time())}",
                    "error": f"Command blocked for security reasons: '{dangerous}' not allowed",
                    "command": request.command,
                    "timestamp": int(time.time())
                }

        # Set up process with timeout
        process = None
        output = ""
        error = None
        execution_id = request.executionId or f"auto_{int(time.time())}"
        
        # Set working directory using the get_working_directory function
        cwd = get_working_directory()
        if cwd and base_directory:
            try:
                normalized_base = os.path.abspath(base_directory)
                normalized_cwd = os.path.abspath(cwd)
                if not normalized_cwd.startswith(normalized_base):
                    cwd = normalized_base
            except Exception:
                cwd = base_directory
        
        # Log execution info
        print(f"Executing command: {command} (ID: {execution_id}, timeout: {timeout}s, cwd: {cwd})")
        
        # Create a safe environment for running commands
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"  # Always set this environment variable
        
        try:
            # Execute the command
            if sys.platform == "win32":
                # Windows-specific command execution
                original_command = command
                
                # Enhanced Python detection with multiple variations
                python_command = False
                if any(cmd in command.lower() for cmd in ["python ", "python3 ", "py "]):
                    python_command = True
                    # Add -u flag if not present
                    if "python " in command:
                        command = command.replace("python ", "python -u ", 1)
                    elif "python3 " in command:
                        command = command.replace("python3 ", "python3 -u ", 1)
                    elif "py " in command:
                        command = command.replace("py ", "py -u ", 1)
                
                # For Python commands on Windows, use a special wrapper that ensures output is captured
                if python_command:
                    # This PowerShell approach forces output capture even when Python would normally buffer it
                    # Fix string escaping for PowerShell path
                    escaped_cwd = cwd.replace("'", "''")
                    wrapped_command = f"""
Set-Location -Path '{escaped_cwd}' 
$env:PYTHONUNBUFFERED=1
$output = & {command} 2>&1 | Out-String
[Console]::Out.Flush()
$output
"""
                    process = subprocess.run(
                        ["powershell.exe", "-NoProfile", "-Command", wrapped_command],
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                        cwd=cwd,
                        env=env,
                        shell=False
                    )
                else:
                    # For non-Python commands, run normally
                    # Include a command to set the working directory first
                    # Fix string escaping for PowerShell path
                    escaped_cwd = cwd.replace("'", "''")
                    full_command = f"Set-Location -Path '{escaped_cwd}'; {command}"
                    process = subprocess.run(
                        ["powershell.exe", "-NoProfile", "-Command", full_command],
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                        cwd=cwd,
                        env=env,
                        shell=False
                    )
            else:
                # Linux/Mac command execution
                command = command
                
                # Enhanced Python detection with multiple variations
                if any(cmd in command.lower() for cmd in ["python ", "python3 "]):
                    if "python " in command:
                        command = command.replace("python ", "python -u ", 1)
                    elif "python3 " in command:
                        command = command.replace("python3 ", "python3 -u ", 1)
                
                # Include a command to set the working directory first
                # Fix string escaping for bash path
                escaped_cwd = cwd.replace("'", "'\\''")
                full_command = f"cd '{escaped_cwd}' && {command}"
                
                process = subprocess.run(
                    ["bash", "-c", full_command],
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                    cwd=cwd,
                    env=env,
                    shell=False
                )
            
            # Get the output
            output = process.stdout
            if process.stderr:
                if process.returncode != 0:
                    error = process.stderr
                else:
                    # Some commands put important info in stderr even on success
                    output = output + "\n" + process.stderr if output else process.stderr
            
            # Special handling for Python with no output - this should NOT happen now with our changes
            if output == "" and process.returncode == 0 and any(cmd in request.command.lower() for cmd in ["python", "python3", "py"]):
                print(f"WARNING: Python command returned no output despite exit code 0: {request.command}")
                # Let's not claim success with no output for Python commands - if we should have output
                if sys.platform == "win32":
                    output = "Note: Python output may be missing due to buffering. Try adding 'flush=True' to print statements."
            
            # Log completion
            status = "error" if error else "success"
            print(f"Command execution completed (ID: {execution_id}, status: {status}, output length: {len(output)})")
                    
        except subprocess.TimeoutExpired:
            error = f"Command timed out after {timeout} seconds"
            print(f"Command execution timed out (ID: {execution_id})")
        except Exception as e:
            error = f"Error executing command: {str(e)}"
            print(f"Command execution failed (ID: {execution_id}): {str(e)}")
            
        # Return the result with execution ID
        if error:
            return {
                "executionId": execution_id,
                "error": error,
                "command": request.command,
                "timestamp": int(time.time())
            }
        else:
            return {
                "executionId": execution_id,
                "output": output,
                "command": request.command,
                "timestamp": int(time.time())
            }
            
    except Exception as e:
        print(f"Error in execute_command: {str(e)}")
        return {
            "executionId": request.executionId or f"error_{int(time.time())}",
            "error": f"Server error: {str(e)}",
            "command": request.command,
            "timestamp": int(time.time())
        }

@app.websocket("/ws/terminal")
async def terminal_websocket(websocket: WebSocket):
    await websocket.accept()
    
    # Start PowerShell process
    if sys.platform == "win32":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        
        # Set working directory using get_working_directory
        cwd = get_working_directory()
        print(f"Starting terminal with working directory: {cwd}")
        
        # Start PowerShell with the correct working directory
        process = subprocess.Popen(
            ["powershell.exe", "-NoLogo", "-NoExit", "-NoProfile"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=False,
            startupinfo=startupinfo,
            creationflags=subprocess.CREATE_NO_WINDOW,
            bufsize=0,
            universal_newlines=True,
            cwd=cwd  # Set the working directory
        )
        
        # Change to the workspace directory immediately if not already there
        workspace_dir = get_working_directory()
        if workspace_dir and cwd != workspace_dir:
            # Escape single quotes for PowerShell
            escaped_path = workspace_dir.replace("'", "''")
            process.stdin.write(f"cd '{escaped_path}'\n")
            process.stdin.flush()
    else:
        # Set working directory using get_working_directory
        cwd = get_working_directory()
        print(f"Starting terminal with working directory: {cwd}")
        
        process = subprocess.Popen(
            ["bash"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=False,
            bufsize=0,
            universal_newlines=True,
            cwd=cwd  # Set the working directory
        )
        
        # Change to the workspace directory immediately if not already there
        workspace_dir = get_working_directory()
        if workspace_dir and cwd != workspace_dir:
            # Escape single quotes for bash
            escaped_path = workspace_dir.replace("'", "'\\''")
            process.stdin.write(f"cd '{escaped_path}'\n")
            process.stdin.flush()
    
    try:
        async def read_stream(stream):
            while True:
                if stream:
                    try:
                        char = await asyncio.get_event_loop().run_in_executor(
                            None, stream.read, 1
                        )
                        if not char:
                            break
                        await websocket.send_text(char)
                    except Exception as e:
                        print(f"Error reading stream: {e}")
                        break

        # Start reading output and error streams
        output_task = asyncio.create_task(read_stream(process.stdout))
        error_task = asyncio.create_task(read_stream(process.stderr))
        
        while True:
            try:
                data = await websocket.receive_text()
                if process.poll() is not None:
                    break
                if process.stdin:
                    if data == '\x08':  # ASCII backspace character
                        # Send backspace sequence to PowerShell
                        process.stdin.write('\x08 \x08')  # backspace, space, backspace
                        process.stdin.flush()
                    else:
                        process.stdin.write(data)
                        process.stdin.flush()
            except Exception as e:
                print(f"Error in terminal loop: {str(e)}")
                break
                
    except Exception as e:
        print(f"Terminal error: {str(e)}")
    
    finally:
        # Clean up
        try:
            process.terminate()
            await asyncio.sleep(0.1)
            if process.poll() is None:
                process.kill()
        except Exception as e:
            print(f"Error cleaning up process: {e}")
        
        try:
            await websocket.close()
        except Exception as e:
            print(f"Error closing websocket: {e}")

@app.post("/set-workspace-directory")
async def set_workspace_directory(request: PathRequest):
    """Set the user's workspace directory."""
    try:
        if not request.path:
            raise HTTPException(status_code=400, detail="No directory path provided")
            
        if not os.path.exists(request.path):
            raise HTTPException(status_code=404, detail="Directory not found")
            
        if not os.path.isdir(request.path):
            raise HTTPException(status_code=400, detail="Path is not a directory")
        
        # Set the user workspace directory
        if set_user_workspace_directory(request.path):
            # Auto-reindex the new workspace
            await auto_reindex_codebase()
            
            return {
                "success": True, 
                "workspace": user_workspace_directory
            }
        else:
            raise HTTPException(status_code=400, detail="Failed to set workspace directory")
    except Exception as e:
        print(f"Error setting workspace directory: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get-workspace-directory")
async def get_workspace_directory():
    """Get the current user workspace directory."""
    effective_dir = get_working_directory()
    return {
        "workspace_directory": user_workspace_directory,
        "effective_directory": effective_dir,
        "base_directory": base_directory
    }

@app.get("/api/cwd")
async def get_current_working_directory():
    """Get the current working directory."""
    try:
        cwd = os.getcwd()
        return {"cwd": cwd}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting current working directory: {str(e)}")

@app.post("/read-settings-files")
async def read_settings_files(request: SettingsRequest):
    """Read all JSON settings files from the specified directory."""
    try:
        # Ignore the frontend path and use our own cross-platform path resolution
        settings_dir = get_app_data_path() / "settings"
        
        # Check if the directory exists
        if not settings_dir.exists():
            settings_dir.mkdir(parents=True, exist_ok=True)
            print(f"Created settings directory: {settings_dir}")
        
        # Read all JSON files in the directory
        settings = {}
        for filename in settings_dir.iterdir():
            if filename.suffix == '.json':
                try:
                    with open(filename, 'r', encoding='utf-8') as f:
                        # Use the filename without extension as the settings category
                        category = filename.stem
                        settings[category] = json.load(f)
                except Exception as e:
                    print(f"Error reading settings file {filename.name}: {str(e)}")
                    # Continue with other files even if one fails
        
        return {"settings": settings}
    except Exception as e:
        print(f"Error reading settings files: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/save-settings-files")
async def save_settings_files(request: SaveSettingsRequest):
    """Save settings files to the specified directory."""
    try:
        # Ignore the frontend path and use our own cross-platform path resolution
        settings_dir = get_app_data_path() / "settings"
        
        # Check if the directory exists
        if not settings_dir.exists():
            settings_dir.mkdir(parents=True, exist_ok=True)
            print(f"Created settings directory: {settings_dir}")
        
        # Save settings files
        for category, settings in request.settings.items():
            file_path = settings_dir / f"{category}.json"
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(settings, f, indent=2)
        
        return {"success": True}
    except Exception as e:
        print(f"Error saving settings files: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/system-information")
async def get_system_information():
    try:
        # Get OS information
        os_info = {
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor()
        }
        
        # Get RAM information
        ram = psutil.virtual_memory()
        ram_info = {
            "total": ram.total,
            "available": ram.available,
            "percent": ram.percent,
            "used": ram.used,
            "free": ram.free
        }
        
        # Get CPU information
        cpu_info = {
            "physical_cores": psutil.cpu_count(logical=False),
            "total_cores": psutil.cpu_count(logical=True),
            "cpu_freq": psutil.cpu_freq()._asdict() if psutil.cpu_freq() else None,
            "cpu_percent": psutil.cpu_percent(interval=1)
        }
        
        # Get GPU information
        try:
            gpus = GPUtil.getGPUs()
            gpu_info = [{
                "id": gpu.id,
                "name": gpu.name,
                "load": gpu.load * 100,
                "memory_total": gpu.memoryTotal,
                "memory_used": gpu.memoryUsed,
                "memory_free": gpu.memoryFree,
                "temperature": gpu.temperature
            } for gpu in gpus]
        except:
            gpu_info = []
        
        return {
            "os": os_info,
            "ram": ram_info,
            "cpu": cpu_info,
            "gpu": gpu_info
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/github/save-token")
async def save_github_token(request: GitHubTokenRequest):
    """Save GitHub token to settings."""
    settings_dir = get_app_data_path() / "settings"
    
    # Create directory if it doesn't exist
    settings_dir.mkdir(parents=True, exist_ok=True)
    
    token_path = settings_dir / "github_token.json"
    
    try:
        with open(token_path, 'w') as file:
            json.dump({"token": request.token}, file)
        
        # Validate token with GitHub API
        headers = {
            "Authorization": f"token {request.token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        response = requests.get(
            "https://api.github.com/user",
            headers=headers
        )
        
        if response.status_code == 200:
            user_data = response.json()
            return {
                "success": True, 
                "message": f"Successfully authenticated as {user_data.get('login')}"
            }
        else:
            return {
                "success": False,
                "message": f"GitHub API returned error: {response.status_code}"
            }
    except Exception as e:
        return {"success": False, "message": f"Error saving token: {str(e)}"}

# GitHub OAuth endpoints
@app.get("/github/auth")
async def github_auth():
    """Redirect to GitHub OAuth authorization page."""
    auth_url = github_oauth.get_authorization_url()
    return RedirectResponse(auth_url)

@app.get("/github/callback")
async def github_callback(code: str, state: str):
    """Handle the GitHub OAuth callback."""
    try:
        # Validate state parameter
        if state != "pointer_oauth":
            return HTMLResponse("""
                <html>
                    <head>
                        <title>GitHub Authentication Failed</title>
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                justify-content: center;
                                height: 100vh;
                                margin: 0;
                                background-color: #f6f8fa;
                            }
                            .container {
                                text-align: center;
                                padding: 2rem;
                                background: white;
                                border-radius: 8px;
                                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                            }
                            h1 { color: #24292e; }
                            p { color: #586069; }
                            .button {
                                display: inline-block;
                                padding: 8px 16px;
                                background-color: #2ea44f;
                                color: white;
                                text-decoration: none;
                                border-radius: 4px;
                                margin-top: 1rem;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>Authentication Failed</h1>
                            <p>Invalid state parameter. Please try again.</p>
                            <a href="http://localhost:23816/github/auth" class="button">Try Again</a>
                        </div>
                    </body>
                </html>
            """)
        
        # Exchange the code for an access token
        token_response = await github_oauth.get_access_token(code)
        if 'access_token' not in token_response:
            return HTMLResponse("""
                <html>
                    <head>
                        <title>GitHub Authentication Failed</title>
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                justify-content: center;
                                height: 100vh;
                                margin: 0;
                                background-color: #f6f8fa;
                            }
                            .container {
                                text-align: center;
                                padding: 2rem;
                                background: white;
                                border-radius: 8px;
                                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                            }
                            h1 { color: #24292e; }
                            p { color: #586069; }
                            .button {
                                display: inline-block;
                                padding: 8px 16px;
                                background-color: #2ea44f;
                                color: white;
                                text-decoration: none;
                                border-radius: 4px;
                                margin-top: 1rem;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>Authentication Failed</h1>
                            <p>There was an error connecting to GitHub. Please try again.</p>
                            <a href="http://localhost:23816/github/auth" class="button">Try Again</a>
                        </div>
                    </body>
                </html>
            """)
        
        # Save the token
        github_oauth.save_token(token_response['access_token'])
        
        # Return success page
        return HTMLResponse(open("backend/templates/github/auth/success.html").read())
    except Exception as e:
        print(f"Error in GitHub callback: {e}")
        return HTMLResponse("""
            <html>
                <head>
                    <title>GitHub Authentication Error</title>
                    <style>
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            height: 100vh;
                            margin: 0;
                            background-color: #f6f8fa;
                        }
                        .container {
                            text-align: center;
                            padding: 2rem;
                            background: white;
                            border-radius: 8px;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                        }
                        h1 { color: #24292e; }
                        p { color: #586069; }
                        .button {
                            display: inline-block;
                            padding: 8px 16px;
                            background-color: #2ea44f;
                            color: white;
                            text-decoration: none;
                            border-radius: 4px;
                            margin-top: 1rem;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>Authentication Error</h1>
                        <p>There was an error connecting to GitHub. Please try again.</p>
                        <a href="http://localhost:23816/github/auth" class="button">Try Again</a>
                    </div>
                </body>
            </html>
        """)

@app.get("/github/auth-status")
async def github_auth_status():
    """Check GitHub authentication status."""
    token = github_oauth.get_token()
    if token and github_oauth.validate_token(token):
        return {"authenticated": True}
    return {"authenticated": False}

@app.post("/github/logout")
async def github_logout():
    """Log out from GitHub."""
    try:
        settings_dir = get_app_data_path() / "settings"
        token_path = settings_dir / "github_token.json"
        if token_path.exists():
            token_path.unlink()
        return {"success": True, "message": "Successfully logged out"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.get("/serve-file")
async def serve_file(path: str, currentDir: str = None):
    """Serve any file (binary or text) for display in the editor."""
    try:
        # Handle relative paths and ensure they're safe
        paths_to_try = []
        
        # If path is absolute, use it directly
        if os.path.isabs(path):
            paths_to_try.append(path)
        else:
            # Try relative to current directory first if provided
            if currentDir:
                paths_to_try.append(os.path.join(currentDir, path))
            
            # Then try relative to base directory
            if base_directory:
                paths_to_try.append(os.path.join(base_directory, path))
        
        # Security check - ensure normalized base is set
        normalized_base = os.path.normpath(base_directory).replace('\\', '/') if base_directory else "/"
        
        for try_path in paths_to_try:
            # Normalize the full path
            full_path = os.path.normpath(try_path).replace('\\', '/')
            
            # Security check - make sure the path is within base directory or is absolute
            if not full_path.startswith(normalized_base) and not os.path.isabs(path):
                print(f"Security check failed for {full_path} (not within {normalized_base})")
                continue
                
            if os.path.exists(full_path) and os.path.isfile(full_path):
                # Determine the file's MIME type
                mime_type, _ = mimetypes.guess_type(full_path)
                if not mime_type:
                    # Default to octet-stream for unknown types
                    mime_type = "application/octet-stream"
                
                # Return the file as a response
                return FileResponse(full_path, media_type=mime_type, filename=os.path.basename(full_path))
        
        # If we get here, no valid path was found
        raise HTTPException(
            status_code=404, 
            detail=f"File not found: {path}\nTried paths: {paths_to_try}\nBase directory: {normalized_base}"
        )
    
    except Exception as e:
        print(f"Error serving file {path}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

class DatabasePathRequest(BaseModel):
    path: str

class DatabaseQueryRequest(BaseModel):
    path: str
    query: str

@app.post("/database/schema")
async def get_database_schema(request: DatabasePathRequest):
    """Get the schema (tables and columns) of a SQLite database."""
    try:
        # Resolve the full path
        if os.path.isabs(request.path):
            full_path = request.path
        else:
            # Try relative to base directory
            if base_directory:
                full_path = os.path.join(base_directory, request.path)
                if not os.path.exists(full_path):
                    return {"error": f"Database file not found: {request.path}"}
            else:
                return {"error": f"Database file not found: {request.path}"}
        
        # Check if file exists and is accessible
        if not os.path.exists(full_path):
            return {"error": f"Database file not found: {full_path}"}
        
        # Check file size - empty or very small files can't be valid databases
        file_size = os.path.getsize(full_path)
        if file_size < 100:  # SQLite header is at least 100 bytes
            return {"error": f"File is too small to be a valid SQLite database: {file_size} bytes"}
            
        # Print diagnostics
        print(f"Attempting to open database: {full_path}")
        print(f"File size: {file_size} bytes")
        print(f"SQLite version: {sqlite3.sqlite_version}")
        
        # Try to determine SQLite file version by reading the header
        sqlite_version_info = detect_sqlite_version(full_path)
        if sqlite_version_info:
            print(f"Database file appears to be SQLite version: {sqlite_version_info}")
        
        # Connect with timeout and extended error codes
        try:
            conn = sqlite3.connect(full_path, timeout=3.0, detect_types=sqlite3.PARSE_DECLTYPES)
            conn.execute("PRAGMA quick_check")  # Verify database integrity
        except sqlite3.DatabaseError as e:
            # Specific error for corrupt database
            error_msg = f"The file appears to be corrupted or not a valid SQLite database: {str(e)}"
            if sqlite_version_info:
                error_msg += f"\nDatabase file format: {sqlite_version_info}"
                error_msg += f"\nRunning with SQLite version: {sqlite3.sqlite_version}"
                if "unsupported file format" in str(e).lower():
                    error_msg += "\nThis might be a version incompatibility. The database may have been created with a newer version of SQLite."
            return {"error": error_msg}
        
        cursor = conn.cursor()
        
        # Get list of tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
        table_names = [row[0] for row in cursor.fetchall()]
        
        if not table_names:
            print("No tables found in the database")
        else:
            print(f"Found {len(table_names)} tables: {', '.join(table_names)}")
        
        tables = []
        for table_name in table_names:
            # Get columns for each table
            cursor.execute(f"PRAGMA table_info({table_name});")
            columns = [row[1] for row in cursor.fetchall()]
            
            tables.append({
                "name": table_name,
                "columns": columns
            })
        
        # Close connection
        conn.close()
        
        return {"tables": tables}
    except sqlite3.Error as e:
        error_msg = f"SQLite error: {str(e)}"
        print(f"Database error with {request.path}: {error_msg}")
        return {"error": error_msg}
    except Exception as e:
        error_msg = f"Error: {str(e)}"
        print(f"General error with {request.path}: {error_msg}")
        return {"error": error_msg}

# Add function to detect SQLite version from file header
def detect_sqlite_version(db_path):
    """Try to determine the SQLite version by reading the file header."""
    try:
        with open(db_path, 'rb') as f:
            header = f.read(100)  # Read first 100 bytes which should contain the header
            
            # Check SQLite format
            if header[0:16] != b'SQLite format 3\x00':
                return None  # Not a SQLite 3 database
                
            # Version information might be in the file, although this is a simplified check
            # SQLite doesn't store the exact version in the header, but we can detect some format features
            
            # Get the page size (bytes 16-17, big-endian)
            page_size = int.from_bytes(header[16:18], byteorder='big')
            
            # Get the file format write version (byte 18)
            write_version = header[18]
            
            # Get the file format read version (byte 19)
            read_version = header[19]
            
            format_info = f"Page size: {page_size}, Write format: {write_version}, Read format: {read_version}"
            
            # Rough version estimate based on file format versions
            if write_version > 2 or read_version > 2:
                return f"SQLite 3.7.0 or newer ({format_info})"
            elif write_version == 2:
                return f"SQLite 3.7.0 or equivalent ({format_info})"
            elif write_version == 1:
                return f"SQLite 3.0.0 or equivalent ({format_info})"
            else:
                return f"Unknown SQLite version ({format_info})"
                
    except Exception as e:
        print(f"Error detecting SQLite version: {str(e)}")
        return None

@app.post("/database/query")
async def execute_database_query(request: DatabaseQueryRequest):
    """Execute a SQL query on a SQLite database."""
    try:
        # Resolve the full path
        if os.path.isabs(request.path):
            full_path = request.path
        else:
            # Try relative to base directory
            if base_directory:
                full_path = os.path.join(base_directory, request.path)
                if not os.path.exists(full_path):
                    return {"error": f"Database file not found: {request.path}"}
            else:
                return {"error": f"Database file not found: {request.path}"}
        
        # Check if file exists and is accessible
        if not os.path.exists(full_path):
            return {"error": f"Database file not found: {full_path}"}
        
        print(f"Executing query on {full_path}: {request.query}")
        
        # Connect with timeout and extended error codes
        try:
            conn = sqlite3.connect(full_path, timeout=3.0, detect_types=sqlite3.PARSE_DECLTYPES)
            conn.execute("PRAGMA quick_check")  # Verify database integrity
        except sqlite3.DatabaseError as e:
            # Specific error for corrupt database
            return {"error": f"The file appears to be corrupted or not a valid SQLite database: {str(e)}"}
            
        conn.row_factory = sqlite3.Row  # This enables column access by name
        cursor = conn.cursor()
        
        # Execute the query
        cursor.execute(request.query)
        
        # Handle different query types
        if request.query.strip().upper().startswith(("SELECT", "PRAGMA", "EXPLAIN")):
            # For SELECT queries, return the results
            rows = cursor.fetchall()
            
            # Extract column names
            columns = [column[0] for column in cursor.description]
            
            # Convert rows to dictionaries
            result_rows = []
            for row in rows:
                result_rows.append({columns[i]: row[i] for i in range(len(columns))})
            
            result = {
                "columns": columns,
                "rows": result_rows
            }
        else:
            # For other queries (INSERT, UPDATE, DELETE), commit changes and return affected rows
            conn.commit()
            result = {
                "columns": ["rowcount"],
                "rows": [{"rowcount": cursor.rowcount}]
            }
        
        # Close connection
        conn.close()
        
        return result
    except sqlite3.Error as e:
        error_msg = f"SQLite error: {str(e)}"
        print(f"Database query error with {request.path}: {error_msg}")
        return {"error": error_msg}
    except Exception as e:
        error_msg = f"Error: {str(e)}"
        print(f"General error with {request.path}: {error_msg}")
        return {"error": error_msg}

@app.post("/database/repair")
async def repair_database(request: DatabasePathRequest):
    """Repair a corrupted database or create a new one."""
    try:
        # Resolve the full path
        if os.path.isabs(request.path):
            full_path = request.path
        else:
            # Try relative to base directory
            if base_directory:
                full_path = os.path.join(base_directory, request.path)
            else:
                return {"error": "No base directory set"}
        
        # Create a backup if the file exists
        backup_path = None
        if os.path.exists(full_path):
            backup_path = f"{full_path}.backup-{int(time.time())}"
            try:
                import shutil
                shutil.copy2(full_path, backup_path)
                print(f"Created backup of database at {backup_path}")
            except Exception as e:
                print(f"Warning: Could not create backup: {str(e)}")
                backup_path = None
        
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        # First try to repair the database if it exists
        repair_result = None
        if os.path.exists(full_path) and os.path.getsize(full_path) > 100:
            repair_result = await attempt_database_repair(full_path)
            if repair_result.get("success"):
                return repair_result
        
        # If repair failed or database doesn't exist, create a new one
        try:
            print(f"Creating new database at {full_path}")
            conn = sqlite3.connect(full_path)
            # Create a simple test table to ensure it's working
            conn.execute("CREATE TABLE IF NOT EXISTS sqlite_test (id INTEGER PRIMARY KEY, test_value TEXT)")
            conn.commit()
            conn.close()
            
            message = "New database created successfully"
            if backup_path:
                message += f". Your original database was backed up to {os.path.basename(backup_path)}"
            
            print(f"Successfully created new database at {full_path}")
            return {"success": True, "message": message}
        except Exception as e:
            return {"error": f"Failed to create database: {str(e)}"}
            
    except Exception as e:
        error_msg = f"Error repairing database: {str(e)}"
        print(error_msg)
        return {"error": error_msg}

async def attempt_database_repair(db_path):
    """Try to repair a SQLite database using various recovery techniques."""
    print(f"Attempting to repair database at {db_path}")
    
    try:
        # Try different pragmas to recover the database
        recovery_methods = [
            "PRAGMA integrity_check;",  # Check database integrity
            "PRAGMA quick_check;",      # Faster integrity check
            "VACUUM;",                  # Rebuild the database file
            "PRAGMA wal_checkpoint;",   # Ensure WAL changes are in the main db
            "PRAGMA journal_mode=DELETE;",  # Reset journal mode
            "PRAGMA synchronous=OFF;",  # Temporarily disable synchronous
        ]
        
        for method in recovery_methods:
            try:
                print(f"Trying recovery method: {method}")
                # Use a short timeout to avoid hanging
                conn = sqlite3.connect(db_path, timeout=5.0)
                conn.execute(method)
                conn.close()
            except sqlite3.Error as e:
                print(f"Recovery method {method} failed: {str(e)}")
                # Continue to next method
        
        # Final test: Can we open and query the database?
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            # Try to access the sqlite_master table which all databases have
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = cursor.fetchall()
            conn.close()
            
            print(f"Repair successful! Found {len(tables)} tables in the database.")
            return {
                "success": True, 
                "message": f"Database repaired successfully. Found {len(tables)} tables.",
                "tables": [table[0] for table in tables]
            }
        except sqlite3.Error as e:
            print(f"Database still corrupted after repair attempts: {str(e)}")
            return {"success": False, "error": f"Repair failed: {str(e)}"}
            
    except Exception as e:
        print(f"Error during repair attempt: {str(e)}")
        return {"success": False, "error": f"Repair attempt failed: {str(e)}"}

@app.post("/api/openai/chat")
async def openai_chat(request: OpenAIAPIRequest):
    try:
        # Get API key from request or settings
        api_key = request.api_key
        if not api_key:
            # Try to get from settings
            conn = sqlite3.connect('settings.db')
            cursor = conn.cursor()
            cursor.execute('SELECT value FROM settings WHERE key = ?', ('openai_api_key',))
            result = cursor.fetchone()
            conn.close()
            if result:
                api_key = result[0]
            else:
                raise HTTPException(status_code=401, detail="OpenAI API key not found")

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
        
        payload = {
            "model": request.model,
            "messages": request.messages,
            "temperature": request.temperature,
            "top_p": request.top_p,
            "frequency_penalty": request.frequency_penalty,
            "presence_penalty": request.presence_penalty,
            "stream": request.stream
        }
        
        # Only include max_tokens if it's not None and greater than 0
        if request.max_tokens is not None and request.max_tokens > 0:
            payload["max_tokens"] = request.max_tokens
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    request.api_endpoint or "https://api.openai.com/v1/chat/completions",
                    headers=headers,
                    json=payload
                )
                
                if response.status_code == 401:
                    raise HTTPException(status_code=401, detail="Invalid OpenAI API key")
                elif response.status_code == 429:
                    raise HTTPException(status_code=429, detail="Rate limit exceeded")
                elif response.status_code == 400:
                    error_data = response.json()
                    raise HTTPException(status_code=400, detail=error_data.get("error", {}).get("message", "Bad request"))
                
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401:
                    raise HTTPException(status_code=401, detail="Invalid OpenAI API key")
                elif e.response.status_code == 429:
                    raise HTTPException(status_code=429, detail="Rate limit exceeded")
                else:
                    raise HTTPException(status_code=e.response.status_code, detail=str(e))
            except httpx.RequestError as e:
                raise HTTPException(status_code=500, detail=f"Failed to connect to OpenAI API: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/settings")
async def save_settings(request: SaveSettingsRequest):
    try:
        conn = sqlite3.connect('settings.db')
        cursor = conn.cursor()
        
        # Create settings table if it doesn't exist
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        
        # Save OpenAI API settings
        cursor.execute('''
            INSERT OR REPLACE INTO settings (key, value)
            VALUES (?, ?)
        ''', ('openai_api_key', request.openai_api_key))
        
        cursor.execute('''
            INSERT OR REPLACE INTO settings (key, value)
            VALUES (?, ?)
        ''', ('openai_api_endpoint', request.openai_api_endpoint))
        
        cursor.execute('''
            INSERT OR REPLACE INTO settings (key, value)
            VALUES (?, ?)
        ''', ('show_password', str(request.show_password).lower()))
        
        conn.commit()
        conn.close()
        
        return {"success": True}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/settings")
async def get_settings():
    try:
        conn = sqlite3.connect('settings.db')
        cursor = conn.cursor()
        
        # Create settings table if it doesn't exist
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        
        # Get all settings
        cursor.execute('SELECT key, value FROM settings')
        settings = dict(cursor.fetchall())
        
        conn.close()
        
        return {
            "openai_api_key": settings.get('openai_api_key', ''),
            "openai_api_endpoint": settings.get('openai_api_endpoint', ''),
            "show_password": settings.get('show_password', 'false').lower() == 'true'
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Cross-platform path configuration
def get_app_data_path() -> Path:
    """Get the appropriate application data directory based on platform"""
    system = platform.system().lower()
    
    if system == "windows":
        # Windows: Use AppData/Roaming for user-specific settings
        base_path = os.environ.get('APPDATA', os.path.expanduser('~/AppData/Roaming'))
        return Path(base_path) / 'Pointer' / 'data'
    elif system == "darwin":  # macOS
        # macOS: Use Application Support directory - properly expand home directory
        home_dir = Path.home()
        return home_dir / 'Library' / 'Application Support' / 'Pointer' / 'data'
    else:  # Linux and other Unix-like systems
        # Linux: Use XDG data directory or fallback to home - properly expand paths
        xdg_data_home = os.environ.get('XDG_DATA_HOME')
        if xdg_data_home:
            return Path(xdg_data_home) / 'pointer' / 'data'
        else:
            home_dir = Path.home()
            return home_dir / '.local' / 'share' / 'pointer' / 'data'

def get_chats_directory() -> Path:
    """Get the chats directory path"""
    return get_app_data_path() / 'chats'

@app.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str):
    """Delete a specific chat by ID."""
    try:
        chats_dir = get_chats_directory()
        chat_file = chats_dir / f"{chat_id}.json"
        
        if not chat_file.exists():
            return JSONResponse(
                status_code=404,
                content={"detail": "Chat not found"}
            )
            
        # Delete the chat file
        chat_file.unlink()
        print(f"Chat {chat_id} deleted successfully")
        
        return {"success": True, "message": f"Chat {chat_id} deleted"}
        
    except Exception as e:
        print(f"Error deleting chat {chat_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"detail": f"Error deleting chat: {str(e)}"}
        )

# Remove the uvicorn.run() call since we're using run.py now
if __name__ == "__main__":
    pass