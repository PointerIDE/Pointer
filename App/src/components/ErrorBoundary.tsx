import React, { ReactNode } from 'react';
import { logger } from '../services/LoggerService';

interface Props {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary Component
 * Catches React component errors and displays graceful error UI
 * Prevents entire app from crashing due to component errors
 * 
 * Improvement 11: Comprehensive error handling with logging
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('React component error caught', {
      error: error.toString(),
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback?.(this.state.error!) || (
          <div style={{
            padding: '20px',
            margin: '10px',
            backgroundColor: '#fdd',
            border: '1px solid #f00',
            borderRadius: '4px',
            color: '#c00',
            fontFamily: 'monospace'
          }}>
            <h2>⚠️ Component Error</h2>
            <p>{this.state.error?.message || 'An unexpected error occurred'}</p>
            <button 
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                backgroundColor: '#f00',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Reload Application
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
