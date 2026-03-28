/**
 * Type-safe environment configuration
 * Validates and provides typed access to environment variables
 */

export interface EnvironmentConfig {
  // API Configuration
  apiUrl: string;
  apiPort: number;
  apiHost: string;
  
  // Development
  devServerPort: number;
  isDevelopment: boolean;
  isProduction: boolean;
  
  // CORS
  allowedOrigins: string[];
  
  // Feature Flags
  enableBackgroundIndexing: boolean;
  enableDiscordRpc: boolean;
  
  // GitHub OAuth (optional)
  githubClientId?: string;
  githubClientSecret?: string;
}

class EnvConfigService {
  private config: EnvironmentConfig;
  private errors: string[] = [];

  constructor() {
    this.config = this.loadConfig();
    this.validate();
  }

  /**
   * Load configuration from environment variables
   */
  private loadConfig(): EnvironmentConfig {
    const apiUrl = this.getEnv('VITE_API_URL', 'http://localhost:23816');
    const devServerPort = this.getEnvNumber('VITE_DEV_SERVER_PORT', 3000);
    const allowedOrigins = this.getEnvArray('VITE_ALLOWED_ORIGINS', ['http://localhost:3000']);

    // Parse API URL to extract host and port
    const apiUrlObj = new URL(apiUrl);
    const apiHost = apiUrlObj.hostname;
    const apiPort = parseInt(apiUrlObj.port || '23816', 10);

    return {
      apiUrl,
      apiPort,
      apiHost,
      devServerPort,
      isDevelopment: import.meta.env.MODE === 'development',
      isProduction: import.meta.env.MODE === 'production',
      allowedOrigins,
      enableBackgroundIndexing: this.getEnvBoolean('ENABLE_BACKGROUND_INDEXING', true),
      enableDiscordRpc: this.getEnvBoolean('ENABLE_DISCORD_RPC', true),
      githubClientId: this.getEnvOptional('GITHUB_CLIENT_ID'),
      githubClientSecret: this.getEnvOptional('GITHUB_CLIENT_SECRET'),
    };
  }

  /**
   * Validate configuration
   */
  private validate(): void {
    this.errors = [];

    // Validate API URL format
    try {
      new URL(this.config.apiUrl);
    } catch (e) {
      this.errors.push(`Invalid VITE_API_URL: ${this.config.apiUrl}`);
    }

    // Validate port ranges
    if (this.config.apiPort < 1 || this.config.apiPort > 65535) {
      this.errors.push(`Invalid API port: ${this.config.apiPort}`);
    }

    if (this.config.devServerPort < 1 || this.config.devServerPort > 65535) {
      this.errors.push(`Invalid dev server port: ${this.config.devServerPort}`);
    }

    // Validate allowed origins
    if (!Array.isArray(this.config.allowedOrigins) || this.config.allowedOrigins.length === 0) {
      this.errors.push('No allowed origins configured');
    }

    // Log errors in development
    if (this.errors.length > 0 && this.config.isDevelopment) {
      console.warn('⚠️  Environment configuration issues:', this.errors);
    }
  }

  /**
   * Get string environment variable
   */
  private getEnv(key: string, defaultValue: string): string {
    return import.meta.env[key] || defaultValue;
  }

  /**
   * Get optional environment variable
   */
  private getEnvOptional(key: string): string | undefined {
    return import.meta.env[key] || undefined;
  }

  /**
   * Get number environment variable
   */
  private getEnvNumber(key: string, defaultValue: number): number {
    const value = import.meta.env[key];
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Get boolean environment variable
   */
  private getEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = import.meta.env[key];
    if (!value) return defaultValue;
    return value === 'true' || value === '1' || value === 'yes';
  }

  /**
   * Get array environment variable (comma-separated)
   */
  private getEnvArray(key: string, defaultValue: string[]): string[] {
    const value = import.meta.env[key];
    if (!value) return defaultValue;
    return value.split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0);
  }

  /**
   * Get complete configuration
   */
  getConfig(): Readonly<EnvironmentConfig> {
    return Object.freeze({ ...this.config });
  }

  /**
   * Get specific config value with type safety
   */
  get<K extends keyof EnvironmentConfig>(key: K): EnvironmentConfig[K] {
    return this.config[key];
  }

  /**
   * Get validation errors
   */
  getErrors(): string[] {
    return [...this.errors];
  }

  /**
   * Check if configuration is valid
   */
  isValid(): boolean {
    return this.errors.length === 0;
  }

  /**
   * Get configuration as query string (for backend calls)
   */
  toQueryString(): string {
    const params = new URLSearchParams();
    params.append('apiUrl', this.config.apiUrl);
    params.append('devServerPort', this.config.devServerPort.toString());
    return params.toString();
  }

  /**
   * Print configuration summary
   */
  printSummary(): void {
    console.table({
      'API URL': this.config.apiUrl,
      'Dev Server Port': this.config.devServerPort,
      'Environment': this.config.isDevelopment ? 'Development' : 'Production',
      'Allowed Origins': this.config.allowedOrigins.join(', '),
      'Background Indexing': this.config.enableBackgroundIndexing,
      'Discord RPC': this.config.enableDiscordRpc,
    });
  }
}

// Export singleton instance
export const envConfig = new EnvConfigService();

// Export type
// Re-export handled by DefaultEnvironmentConfig

// For development: log config on startup
if (import.meta.env.MODE === 'development' && envConfig.isValid()) {
  console.log('✅ Environment configuration loaded successfully');
}
