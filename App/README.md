# Pointer Code Editor

A modern, AI-powered code editor built with Electron, React, TypeScript, and Python. Features VS Code-like interface, integrated terminal, AI assistance, and professional development tools.

![Pointer Editor](https://img.shields.io/badge/Electron-App-blue) ![Python](https://img.shields.io/badge/Python-Backend-green) ![React](https://img.shields.io/badge/React-Frontend-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-Typed-blue)

> **⚠️ Latest Updates:** Settings loading fixed with improved error handling | New comprehensive build scripts added | Enhanced proxy configuration for API endpoints

## ✨ Features

### 🎨 **Professional Interface**
- **VS Code-like UI** - Familiar interface with professional themes
- **Monaco Editor** - Full-featured editor with syntax highlighting for 50+ languages
- **Split View** - Side-by-side file editing with multiple panes
- **Customizable Themes** - Dark/light themes with VS Code compatibility

### 🤖 **AI-Powered Development**
- **Integrated AI Chat** - Built-in AI assistant for code help and explanations
- **Code Completion** - AI-powered autocomplete and suggestions
- **Code Analysis** - Intelligent code review and optimization suggestions
- **Web Search Integration** - Real-time web search using Google Search Results API

### 📁 **Advanced File Management**
- **File Explorer** - Full-featured file tree with create/edit/delete
- **Real-time Sync** - Live file synchronization and auto-save
- **Project Workspace** - Multi-project support with workspace management
- **Search & Replace** - Global search across files with regex support

### 💻 **Integrated Development Tools**
- **Built-in Terminal** - xterm.js powered terminal with shell integration
- **Git Integration** - Version control with visual diff and branch management
- **Multi-cursor Support** - Advanced editing with multiple cursors
- **Code Folding** - Collapsible code sections for better navigation

### 🎮 **Modern Features**
- **Discord Rich Presence** - Show your coding activity on Discord
- **Cross-platform** - Windows, macOS, and Linux support
- **Keyboard Shortcuts** - Full VS Code-compatible shortcuts
- **Extension Support** - Plugin architecture for custom functionality

## 🚀 Quick Start

### Prerequisites
- **Node.js** (v18 or higher)
- **Python** (v3.8 or higher)
- **Yarn** (recommended) or npm
- **Git**

### Installation

1. **Clone Repository**
   ```bash
   git clone https://github.com/PointerIDE/Pointer.git
   cd Pointer/App
   ```

2. **Install Frontend Dependencies**
   ```bash
   yarn install
   # or npm install
   ```

3. **Install Backend Dependencies**
   
   Choose your platform-specific requirements:
   
   ```bash
   # Windows
   pip install -r backend/requirements_windows.txt
   
   # macOS  
   pip install -r backend/requirements_macos.txt
   
   # Linux
   pip install -r backend/requirements_linux.txt
   ```

4. **Install Required Models**
   ```bash
   # Required for AI features
   python -m spacy download en_core_web_sm
   ```

5. **Configure Environment**
   ```bash
   # Create .env file
   echo "VITE_API_URL=http://localhost:23816" > .env
   ```

   or

   ```bash
   npm run env
   ```

6. **Launch Application**
   ```bash
   # Easy start (recommended) - uses new build scripts
   yarn dev
   
   # Alternative: Use automated build script
   # Windows (CMD):
   build.bat
   
   # Windows (PowerShell):
   .\build.ps1
   
   # macOS/Linux:
   ./build.sh
   
   # Alternative: Manual start
   node start-pointer.js
   ```

### 🎯 Using New Build Scripts (Recommended)

We've added comprehensive build scripts with enhanced error handling and automatic troubleshooting:

```bash
# Windows (Command Prompt)
build.bat [OPTIONS]

# Windows (PowerShell)
.\build.ps1 [OPTIONS]

# macOS/Linux
./build.sh [OPTIONS]
```

**Available Options:**
- `--skip-checks` / `-s` - Skip prerequisite checks (faster)
- `--debug` / `-d` - Enable debug mode with verbose output
- `--clean` / `-c` - Clean installation (removes node_modules)
- `--background` / `-b` - Run components in background
- `--help` / `-h` - Show help message

**Examples:**
```bash
build.bat --clean --debug           # Windows: Clean install with debug
./build.sh --skip-checks            # macOS/Linux: Skip checks for speed
.\build.ps1 -CleanInstall -Debug    # PowerShell: Clean install with debug
```

See [BUILD_SCRIPTS_README.md](./BUILD_SCRIPTS_README.md) for detailed documentation.

## � Recent Changes & Improvements

### 🔧 Fixed Issues

#### Settings Loading Error
**Problem:** `SyntaxError: Unexpected token '<', "<!DOCTYPE "..."`

**Solution:** 
- Added global HTTP exception handler in backend (`backend.py`) to ensure JSON responses
- Improved frontend error handling in `FileSystemService.ts` to detect and gracefully handle HTML responses
- Added detailed error logging with response preview for debugging

**Files Modified:**
- `backend/backend.py` - Added `@app.exception_handler(HTTPException)` for JSON error responses
- `src/services/FileSystemService.ts` - Enhanced error handling with content-type validation

#### API Endpoint Proxying
**Problem:** Frontend couldn't reach backend in development mode

**Solution:**
- Added comprehensive proxy configuration in `vite.config.ts` for all API endpoints
- Proxies now include: `/api`, `/read-settings-files`, `/save-settings-files`, `/execute-command`, `/read-file`, `/ws`

**Files Modified:**
- `vite.config.ts` - Added multiple proxy entries for backend communication

#### Settings Request Model
**Problem:** Optional parameters causing validation errors

**Solution:**
- Made `settingsDir` parameter optional with default empty string in `SettingsRequest` model
- Backend now uses its own cross-platform path resolution

**Files Modified:**
- `backend/backend.py` - Updated request model to handle optional parameters

### ✨ New Features

#### Comprehensive Build Scripts
Three unified build scripts with automatic error handling and troubleshooting:

**Scripts Created:**
- `build.bat` - Windows Command Prompt (CMD.exe)
- `build.ps1` - Windows PowerShell (PS 5.0+)
- `build.sh` - macOS/Linux Bash

**Features:**
- ✅ Automatic prerequisite checking (Node.js, Python, Yarn/npm, Git)
- ✅ Port conflict detection
- ✅ Platform-specific requirements installation
- ✅ Error handling with automatic alternatives (npm fallback, Python3/Python)
- ✅ Debug mode with verbose output
- ✅ Clean installation option
- ✅ Integrated troubleshooting guide
- ✅ Colorized output with timestamps
- ✅ Interactive startup assistant

**Files Created:**
- `build.bat` - Windows batch script
- `build.ps1` - PowerShell script
- `build.sh` - Bash script
- `BUILD_SCRIPTS_README.md` - Comprehensive documentation

## �🔧 Advanced Setup

### Manual Component Startup

If you prefer to start components individually:

```bash
# Terminal 1: Backend Server
cd backend
python run.py

# Terminal 2: Frontend Development Server  
yarn start

# Terminal 3: Electron App
yarn electron:dev
```

### Environment Configuration

Create `.env` file with optional configurations:

```env
# Backend API URL (default: http://localhost:23816)
VITE_API_URL=http://localhost:23816

# Development server port (default: 3000)
VITE_DEV_SERVER_PORT=3000

# OpenAI API key for enhanced AI features (optional)
OPENAI_API_KEY=your_openai_key_here

# Debug mode (optional)
DEBUG=true
```

### Build for Production

```bash
# Build web application
yarn build

# Build Electron application
yarn electron:build

# Build for specific platform
yarn electron:build --win
yarn electron:build --mac  
yarn electron:build --linux
```

## 📁 Project Structure

```
App/
├── src/                          # React TypeScript frontend
│   ├── components/               # UI components
│   │   ├── Editor/               # Monaco editor components
│   │   ├── FileExplorer/         # File tree components
│   │   ├── Terminal/             # Terminal components
│   │   └── AIChat/               # AI chat interface
│   ├── services/                 # API services and utilities
│   ├── hooks/                    # React hooks
│   ├── utils/                    # Utility functions
│   ├── themes/                   # UI themes and styling
│   ├── types/                    # TypeScript type definitions
│   └── App.tsx                   # Main application component
├── backend/                      # Python FastAPI backend
│   ├── backend.py                # Main FastAPI server
│   ├── tools_handlers.py         # AI tool handlers
│   ├── git_endpoints.py          # Git integration endpoints
│   ├── codebase_indexer.py       # Code analysis and indexing
│   ├── routes/                   # API route modules
│   ├── tools/                    # Backend utility tools
│   └── requirements*.txt         # Platform-specific dependencies
├── electron/                     # Electron main process
│   ├── main.js                   # Main Electron application
│   ├── preload.js                # Preload script for renderer
│   ├── server.js                 # Local server integration
│   └── git.js                    # Git operations for Electron
├── tools/                        # Development and build tools
├── start-pointer.js              # Unified startup script
├── vite.config.ts                # Vite build configuration
└── package.json                  # Dependencies and npm scripts
```

## ⚙️ Configuration Options

### Startup Script Options

```bash
# Standard startup
node start-pointer.js

# Background mode (detached terminal)
node start-pointer.js --background

# Skip connection checks (faster startup)
node start-pointer.js --skip-checks

# Both background and skip checks
node start-pointer.js --background --skip-checks
```

### Development Scripts

```bash
# Development
yarn dev                    # Start all components
yarn dev:server            # Frontend only
yarn dev:electron          # Electron only

# Building
yarn build                  # Build for web
yarn electron:build        # Build Electron app

# Utilities
yarn electron:start        # Start built Electron app
yarn serve                  # Serve built web app
```

### Discord Rich Presence

Configure Discord integration by editing settings in the application or manually:

```json
{
  "enabled": true,
  "details": "Editing {file} | Line {line}:{column}",
  "state": "Workspace: {workspace}",
  "largeImageKey": "pointer_logo",
  "button1Label": "Website",
  "button1Url": "https://pointr.sh"
}
```

### Web Search Integration

Enable real-time web search functionality using Startpage scraping:

**Features**:
- Real-time Google search results (via Startpage)
- No API keys or rate limits required
- Privacy-focused search (no tracking)
- Works immediately without setup

**Test Integration**:
```bash
cd backend
python test_startpage_scraping.py
```

For detailed implementation information, see `backend/WEB_SEARCH_IMPLEMENTATION.md`

## 🛠️ Troubleshooting

### Common Issues

**Backend Connection Errors**
```bash
# Check if backend is running
curl http://localhost:23816/health

# Restart backend
cd backend && python run.py
```

**Port Conflicts**
```bash
# Check what's using ports
netstat -an | grep :23816
netstat -an | grep :3000

# Use different ports
VITE_PORT=3001 yarn dev
```

**Frontend Build Issues**
```bash
# Clear dependencies and reinstall
rm -rf node_modules package-lock.json
yarn install

# Clear build cache
rm -rf dist
yarn build
```

**Electron App Issues**
```bash
# Rebuild Electron dependencies
yarn postinstall

# Start with debug info
DEBUG=* yarn electron:dev
```

**Python Dependencies**
```bash
# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # Linux/macOS
# or
venv\Scripts\activate     # Windows

# Reinstall requirements
pip install -r backend/requirements.txt
```

### Debug Mode

Enable detailed logging:

```bash
# Enable debug logging
DEBUG=true yarn dev

# Check backend logs
cd backend && python run.py --debug

# Electron with developer tools
yarn electron:dev --dev-tools
```

### Performance Issues

**Optimize for better performance:**

1. **Disable unnecessary features** in development
2. **Use `--skip-checks`** flag for faster startup
3. **Close unused file tabs** in the editor
4. **Limit terminal history** if terminal becomes slow

### Network Issues

**Configure proxy or firewall:**

```bash
# Check if ports are accessible
telnet localhost 23816
telnet localhost 3000

# Configure proxy in vite.config.ts if needed
```

## 🔌 API Endpoints

The backend provides these main endpoints:

- `GET /health` - Health check
- `POST /execute-command` - Execute terminal commands
- `GET /read-file` - Read file contents
- `POST /write-file` - Write file contents
- `GET /list-directory` - List directory contents
- `POST /git/*` - Git operations
- `POST /ai/chat` - AI chat interface
- `GET /ws` - WebSocket for real-time updates

## 🤝 Contributing to Code Editor

### Development Setup

1. **Fork the repository**
2. **Create feature branch** (`git checkout -b feature/editor-improvement`)
3. **Setup development environment** following the installation guide
4. **Make changes** and test thoroughly
5. **Submit pull request** with clear description

### Code Style Guidelines

- **TypeScript**: Use strict type checking
- **React**: Functional components with hooks
- **Python**: Follow PEP 8 style guide
- **File naming**: Use kebab-case for files, PascalCase for components

### Testing

```bash
# Run frontend tests (when available)
yarn test

# Test backend endpoints
cd backend && python -m pytest

# Manual testing checklist:
# - File operations (create, edit, delete)
# - Terminal functionality
# - AI chat features
# - Git integration
# - Cross-platform compatibility
```

## 📝 License

This component is part of the Pointer project, licensed under the MIT License.

## 🙏 Acknowledgments

- **Monaco Editor** - VS Code's editor component
- **xterm.js** - Terminal emulator
- **Electron** - Cross-platform desktop framework  
- **FastAPI** - Modern Python web framework
- **React** - UI library
- **Vite** - Build tool and dev server

---

**[← Back to Main README](../README.md)** | **[Website Component →](../Website/README.md)** | **[Discord Bots →](../DiscordBot/README.md)** 
