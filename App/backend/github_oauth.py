import os
import json
import requests
import platform
from pathlib import Path
from typing import Optional, Dict
from fastapi import HTTPException

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

class GitHubOAuth:
    def __init__(self):
        # Prefer explicit project configuration
        self.client_id = os.getenv('GITHUB_CLIENT_ID')
        if not self.client_id:
            # Fallback: try remote service
            try:
                resp = requests.get('https://pointerapi.f1shy312.com/github/client_id', timeout=5)
                resp.raise_for_status()
                data = resp.json()
                self.client_id = data.get('client_id')
            except Exception as e:
                print(f"Warning: Could not fetch GitHub client ID (remote). {e}")
                self.client_id = None

        if not self.client_id:
            raise ValueError("GitHub OAuth client_id is not configured")

        self.redirect_uri = 'http://localhost:23816/github/callback'
        self.server_url = os.getenv('OAUTH_SERVER_URL', 'https://pointerapi.f1shy312.com')

        try:
            response = requests.get(f"{self.server_url}/health", timeout=5)
            if response.status_code != 200:
                print("Warning: OAuth server is not responding. GitHub OAuth will not work.")
                print("Please ensure the OAuth server is running.")
        except Exception as e:
            print(f"Warning: Could not connect to OAuth server: {str(e)}")
            print("Please ensure the OAuth server is running.")

    def get_authorization_url(self) -> str:
        """Generate GitHub OAuth authorization URL."""
        return f"https://github.com/login/oauth/authorize?client_id={self.client_id}&redirect_uri=http://localhost:23816/github/callback&scope=repo&state=pointer_oauth"

    async def get_access_token(self, code: str) -> Dict[str, str]:
        try:
            response = requests.post(
                f"{self.server_url}/exchange-token",
                json={"code": code},
                headers={'Accept': 'application/json'}
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=400, detail="Failed to get access token")
                
            return response.json()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    def save_token(self, token: str) -> bool:
        """Save the access token to settings."""
        try:
            settings_dir = get_app_data_path() / "settings"
            settings_dir.mkdir(parents=True, exist_ok=True)
            
            token_path = settings_dir / "github_token.json"
            with open(token_path, 'w') as file:
                json.dump({"token": token}, file)
            return True
        except Exception as e:
            print(f"Error saving GitHub token: {str(e)}")
            return False

    def get_token(self) -> Optional[str]:
        """Get the saved access token."""
        try:
            settings_dir = get_app_data_path() / "settings"
            token_path = settings_dir / "github_token.json"
            if token_path.exists():
                with open(token_path, 'r') as file:
                    data = json.load(file)
                    return data.get('token')
            return None
        except Exception:
            return None

    def validate_token(self, token: str) -> bool:
        """Validate the access token with GitHub API."""
        try:
            response = requests.get(
                "https://api.github.com/user",
                headers={
                    "Authorization": f"token {token}",
                    "Accept": "application/vnd.github.v3+json"
                }
            )
            return response.status_code == 200
        except Exception:
            return False 