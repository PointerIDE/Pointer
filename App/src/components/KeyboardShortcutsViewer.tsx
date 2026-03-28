import React, { useState, useEffect } from 'react';
import { KeyboardShortcutsRegistry } from '../services/KeyboardShortcutsRegistry';
import { logger } from '../services/LoggerService';

/**
 * Keyboard Shortcuts Viewer & Editor
 * Display, search, and customize keyboard shortcuts
 */
const KeyboardShortcutsViewer: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const [shortcuts, setShortcuts] = useState<any[]>([]);
  const [filteredShortcuts, setFilteredShortcuts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [categories, setCategories] = useState<Set<string>>(new Set());

  // Load shortcuts on mount
  useEffect(() => {
    const allShortcuts = KeyboardShortcutsRegistry.getAllBindings();
    setShortcuts(allShortcuts);

    const cats = new Set(allShortcuts.map(s => s.category || 'Other'));
    setCategories(cats);
  }, [isOpen]);

  // Filter shortcuts based on search and category
  useEffect(() => {
    let filtered = shortcuts;

    if (searchQuery) {
      filtered = filtered.filter(
        s =>
          s.command.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.key.includes(searchQuery) ||
          (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    if (selectedCategory) {
      filtered = filtered.filter(s => (s.category || 'Other') === selectedCategory);
    }

    setFilteredShortcuts(filtered);
  }, [searchQuery, selectedCategory, shortcuts]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 999,
      fontFamily: 'var(--font-family)',
      fontSize: '14px'
    }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          width: '90%',
          maxWidth: '900px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 70px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--bg-primary)'
        }}>
          <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px 8px'
            }}
          >
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div style={{
          padding: '12px 16px',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-primary)',
          flexWrap: 'wrap'
        }}>
          <input
            type="text"
            placeholder="Search shortcuts..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              minWidth: '200px',
              padding: '6px 10px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '12px',
              outline: 'none'
            }}
          />

          <select
            value={selectedCategory || ''}
            onChange={e => setSelectedCategory(e.target.value || null)}
            style={{
              padding: '6px 10px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '12px',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="">All Categories</option>
            {Array.from(categories).map(cat => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowAnalytics(!showAnalytics)}
            style={{
              padding: '6px 12px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              backgroundColor: showAnalytics ? 'var(--accent)' : 'var(--bg-secondary)',
              color: showAnalytics ? '#fff' : 'var(--text-primary)',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: showAnalytics ? 'bold' : 'normal'
            }}
          >
            📊 Analytics
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {showAnalytics ? (
            <AnalyticsView />
          ) : (
            <ShortcutsGrid shortcuts={filteredShortcuts} />
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-primary)',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <span>Showing {filteredShortcuts.length} shortcuts</span>
          <span>Total: {shortcuts.length}</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Shortcuts Grid Component
 */
const ShortcutsGrid: React.FC<{ shortcuts: any[] }> = ({ shortcuts }) => {
  if (shortcuts.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px' }}>
        No shortcuts found
      </div>
    );
  }

  return (
    <table style={{
      width: '100%',
      borderCollapse: 'collapse',
      backgroundColor: 'var(--bg-secondary)'
    }}>
      <thead>
        <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
          <th style={{ padding: '8px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-primary)' }}>
            Command
          </th>
          <th style={{ padding: '8px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-primary)' }}>
            Shortcut
          </th>
          <th style={{ padding: '8px', textAlign: 'left', fontWeight: 'bold', color: 'var(--text-primary)' }}>
            Category
          </th>
        </tr>
      </thead>
      <tbody>
        {shortcuts.map((shortcut, idx) => (
          <tr
            key={idx}
            style={{
              borderBottom: '1px solid var(--border-color)',
              backgroundColor: idx % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)',
              cursor: 'pointer'
            }}
          >
            <td style={{
              padding: '8px',
              color: 'var(--text-primary)',
              fontSize: '13px'
            }}>
              {shortcut.description || shortcut.command}
            </td>
            <td style={{
              padding: '8px',
              fontFamily: 'monospace',
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: '3px',
              color: 'var(--accent)',
              fontSize: '12px'
            }}>
              <code>{shortcut.key}</code>
            </td>
            <td style={{
              padding: '8px',
              color: 'var(--text-secondary)',
              fontSize: '12px'
            }}>
              {shortcut.category || 'Other'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/**
 * Analytics View Component
 */
const AnalyticsView: React.FC = () => {
  const analytics = KeyboardShortcutsRegistry.getAnalytics();
  const topCommands = analytics.slice(0, 10);

  return (
    <div>
      <h3 style={{ marginTop: 0, color: 'var(--text-primary)' }}>Most Used Shortcuts</h3>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '16px'
      }}>
        {topCommands.map((stat, idx) => (
          <div
            key={idx}
            style={{
              padding: '12px',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)'
            }}
          >
            <div style={{ color: 'var(--text-primary)', fontWeight: 'bold', marginBottom: '4px' }}>
              {stat.command}
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
              color: 'var(--text-secondary)'
            }}>
              <span>Used: {stat.usageCount} times</span>
              <span>Avg: {stat.averageResponseTime.toFixed(1)}ms</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default KeyboardShortcutsViewer;
