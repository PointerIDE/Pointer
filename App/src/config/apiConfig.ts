/**
 * Centralized API configuration
 * Loads from environment variables for flexibility across dev/prod
 */

export const getApiUrl = (): string => {
  return import.meta.env.VITE_API_URL || 'http://localhost:23816';
};

export const getDevServerPort = (): number => {
  return parseInt(import.meta.env.VITE_DEV_SERVER_PORT || '3000', 10);
};

export const API_CONFIG = {
  // API endpoint
  API_URL: getApiUrl(),
  
  // Development server
  DEV_SERVER_PORT: getDevServerPort(),
  
  // CORS origins for backend (comma-separated for production)
  ALLOWED_ORIGINS: (import.meta.env.VITE_ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  
  // Environment
  IS_PRODUCTION: import.meta.env.MODE === 'production',
  IS_DEVELOPMENT: import.meta.env.MODE === 'development',
  
  // API paths
  ENDPOINTS: {
    WS: '/ws',
    EXECUTE_COMMAND: '/execute-command',
    READ_FILE: '/read-file',
    HEALTH: '/health',
    CHAT: '/chat',
    SAVE_CHAT: '/save-chat',
    GET_CHATS: '/get-chats',
    DELETE_CHAT: '/delete-chat',
  }
} as const;

// Helper to build full URLs
export const buildApiUrl = (endpoint: string): string => {
  return `${API_CONFIG.API_URL}${endpoint}`;
};
