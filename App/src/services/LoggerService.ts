/**
 * Logger Service - Centralized logging with structure
 * Handles both client-side logging and sends to backend
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  context?: Record<string, any>;
  stack?: string;
  source?: string;
}

class LoggerService {
  private logs: LogEntry[] = [];
  private readonly maxLogs = 1000;
  private isDevelopment = import.meta.env.MODE === 'development';

  private log(level: LogLevel, message: string, context?: any, stack?: string): void {
    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message,
      context,
      stack,
      source: 'frontend',
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Console output in development
    if (this.isDevelopment) {
      const style = this.getConsoleStyle(level);
      console.log(`%c[${level}]`, style, message, context || '');
    }

    // Send to backend for persistent storage
    this.sendToBackend(entry);
  }

  private getConsoleStyle(level: LogLevel): string {
    const styles: Record<LogLevel, string> = {
      DEBUG: 'color: #888; font-size: 12px;',
      INFO: 'color: #0066cc; font-weight: bold;',
      WARN: 'color: #ff9900; font-weight: bold;',
      ERROR: 'color: #cc0000; font-weight: bold;',
      CRITICAL: 'color: #cc0000; background: #ffcccc; font-weight: bold;',
    };
    return styles[level];
  }

  private async sendToBackend(entry: LogEntry): Promise<void> {
    try {
      // Only send ERROR and CRITICAL to backend to avoid spam
      if (entry.level !== LogLevel.ERROR && entry.level !== LogLevel.CRITICAL) {
        return;
      }

      await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {
        // Fail silently if backend is unavailable
      });
    } catch (e) {
      // Fail silently
    }
  }

  debug(message: string, context?: any): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: any): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: any): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error | any, context?: any): void {
    const stack = error?.stack || '';
    const errorContext = {
      ...context,
      errorMsg: error?.message || String(error),
    };
    this.log(LogLevel.ERROR, message, errorContext, stack);
  }

  critical(message: string, error?: Error | any, context?: any): void {
    const stack = error?.stack || '';
    const errorContext = {
      ...context,
      errorMsg: error?.message || String(error),
    };
    this.log(LogLevel.CRITICAL, message, errorContext, stack);
  }

  /**
   * Get all logs (for debugging)
   */
  getLogs(level?: LogLevel): LogEntry[] {
    if (!level) return [...this.logs];
    return this.logs.filter(log => log.level === level);
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Export logs as JSON (for support/debugging)
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

// Export singleton instance
export const logger = new LoggerService();

// Global error handler for unhandled promises
window.addEventListener('unhandledrejection', (event) => {
  logger.error('Unhandled Promise Rejection', event.reason);
});

// Global error handler for uncaught errors
window.addEventListener('error', (event) => {
  logger.error('Uncaught Error', event.error, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});
