import React, { useState, useEffect, useRef } from 'react';
import { KeyboardShortcutsRegistry } from '../services/KeyboardShortcutsRegistry';
import { logger } from '../services/LoggerService';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Command Palette Component
 * Provides fuzzy search through all available commands with keyboard navigation
 */
const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showRecent, setShowRecent] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Update results when query changes
  useEffect(() => {
    if (query.length === 0) {
      setShowRecent(true);
      const analytics = KeyboardShortcutsRegistry.getMostUsedCommands(10);
      setResults(analytics as any);
    } else {
      setShowRecent(false);
      const searchResults = KeyboardShortcutsRegistry.searchCommands(query);
      setResults(searchResults);
    }
    setSelectedIndex(0);
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => (prev + 1) % Math.max(results.length, 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => (prev - 1 + Math.max(results.length, 1)) % Math.max(results.length, 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            executeSelectedCommand();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, results]);

  // Execute selected command
  const executeSelectedCommand = () => {
    const command = results[selectedIndex];
    if (command) {
      KeyboardShortcutsRegistry.executeCommand(command.id || command.command);
      setQuery('');
      onClose();
      logger.debug('Command executed from palette', { command: command.id });
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = resultsRef.current?.children[selectedIndex];
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingTop: '10vh',
      zIndex: 1000,
      fontFamily: 'var(--font-family)',
      animation: 'fadeIn 0.15s ease-out'
    }}>
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.key === 'Escape' && onClose()}
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          width: '90%',
          maxWidth: '600px',
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          overflow: 'hidden'
        }}
      >
        {/* Search Input */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-primary)'
        }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type command name... (Ctrl+Shift+P)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '14px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              outline: 'none'
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
            }}
          />
        </div>

        {/* Results List */}
        <div
          ref={resultsRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            maxHeight: 'calc(60vh - 60px)'
          }}
        >
          {results.length === 0 ? (
            <div style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '14px'
            }}>
              {query ? 'No commands found' : 'No recent commands'}
            </div>
          ) : (
            results.map((result, index) => (
              <div
                key={index}
                onClick={() => {
                  setSelectedIndex(index);
                  executeSelectedCommand();
                }}
                style={{
                  padding: '12px 16px',
                  backgroundColor: index === selectedIndex ? 'var(--list-hover-bg)' : 'transparent',
                  borderLeft: index === selectedIndex ? '3px solid var(--accent)' : '3px solid transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'background-color 0.1s ease'
                }}
              >
                <div>
                  <div style={{
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    fontWeight: 500
                  }}>
                    {result.description || result.command || result.id}
                  </div>
                  <div style={{
                    color: 'var(--text-secondary)',
                    fontSize: '11px',
                    marginTop: '2px'
                  }}>
                    {result.usageCount ? `Used ${result.usageCount} times` : ''}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-primary)',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <span>↑↓ Navigate • Enter Execute • Esc Dismiss</span>
          <span>{results.length} commands available</span>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
};

export default CommandPalette;
