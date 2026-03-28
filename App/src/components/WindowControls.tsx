import React from 'react';
import '../styles/WindowControls.css';

interface WindowControlsProps {
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  isMaximized?: boolean;
  position?: 'left' | 'right';
  theme?: 'dark' | 'light';
}

/**
 * Enhanced Window Controls Component
 * Provides minimize, maximize, and close buttons with modern styling
 * and proper semantic HTML for accessibility
 */
const WindowControls: React.FC<WindowControlsProps> = ({
  onMinimize,
  onMaximize,
  onClose,
  isMaximized = false,
  position = 'right',
  theme = 'dark'
}) => {
  return (
    <div className={`window-controls window-controls-${position} window-controls-${theme}`}>
      <button
        className="window-control-btn minimize-btn"
        onClick={onMinimize}
        title="Minimize (Alt+F9)"
        aria-label="Minimize window"
        type="button"
      >
        <svg viewBox="0 0 24 24" width="10" height="10">
          <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>

      <button
        className={`window-control-btn maximize-btn ${isMaximized ? 'restored' : ''}`}
        onClick={onMaximize}
        title={isMaximized ? 'Restore (Alt+F10)' : 'Maximize (Alt+F10)'}
        aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
        type="button"
      >
        {isMaximized ? (
          <svg viewBox="0 0 24 24" width="10" height="10">
            {/* Restore icon - two overlapping squares */}
            <rect x="4" y="8" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="8" y="4" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="10" height="10">
            {/* Maximize icon - single square */}
            <rect x="4" y="4" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        )}
      </button>

      <button
        className="window-control-btn close-btn"
        onClick={onClose}
        title="Close (Alt+F4)"
        aria-label="Close window"
        type="button"
      >
        <svg viewBox="0 0 24 24" width="10" height="10">
          <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <line x1="20" y1="4" x2="4" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
};

export default WindowControls;
