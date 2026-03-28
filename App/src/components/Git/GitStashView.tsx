import React, { useState, useEffect } from 'react';
import { GitService } from '../../services/gitService';
import { FileSystemService } from '../../services/FileSystemService';

interface GitStashViewProps {
  refreshStatus: () => Promise<void>;
}

interface GitStash {
  index: string;
  message: string;
}

const styles = {
  container: {
    padding: '0 8px',
  },
  heading: {
    fontSize: '14px',
    fontWeight: 'bold',
    marginBottom: '16px',
  },
  stashList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    marginBottom: '20px',
  },
  stashItem: {
    padding: '12px',
    backgroundColor: 'var(--bg-secondary)',
    borderRadius: '4px',
    transition: 'background-color 0.2s',
  },
  stashHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  stashDesc: {
    fontSize: '13px',
    fontWeight: 'bold',
  },
  stashActions: {
    display: 'flex',
    gap: '8px',
  },
  button: {
    background: 'var(--bg-accent)',
    color: 'var(--text-primary)',
    border: 'none',
    borderRadius: '4px',
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  input: {
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    padding: '8px',
    width: '100%',
    fontSize: '13px',
    marginBottom: '12px',
  },
  stashSection: {
    padding: '16px',
    backgroundColor: 'var(--bg-secondary)',
    borderRadius: '4px',
    marginBottom: '20px',
  },
  error: {
    color: 'var(--error-color)',
    padding: '12px',
    backgroundColor: 'rgba(244, 135, 113, 0.1)',
    borderRadius: '4px',
    marginBottom: '16px',
  },
  loading: {
    textAlign: 'center' as const,
    padding: '20px',
    color: 'var(--text-secondary)',
  },
  emptyState: {
    textAlign: 'center' as const,
    color: 'var(--text-secondary)',
    padding: '40px 0',
  },
};

const GitStashView: React.FC<GitStashViewProps> = ({ refreshStatus }) => {
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stashMessage, setStashMessage] = useState('');
  const [isStashing, setIsStashing] = useState(false);
  const [isPopping, setIsPopping] = useState(false);

  const currentDirectory = FileSystemService.getCurrentDirectory();

  useEffect(() => {
    loadStashes();
  }, []);

  const loadStashes = async () => {
    if (!currentDirectory) {
      setError('No current directory selected');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const stashList = await GitService.listStashes(currentDirectory);
      setStashes(stashList.map((s: string, i: number) => ({ index: `stash_${i}`, message: s })));
    } catch (err) {
      console.error('Error loading stashes:', err);
      setError(`Error loading stashes: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateStash = async () => {
    if (!currentDirectory) return;
    
    setIsStashing(true);
    setError(null);
    
    try {
      const result = await GitService.stash(currentDirectory, stashMessage || undefined);
      
      if (!result.success) {
        setError(`Failed to create stash: ${result.error}`);
      } else {
        setStashMessage('');
        await loadStashes();
        await refreshStatus();
      }
    } catch (err) {
      console.error('Error creating stash:', err);
      setError(`Error creating stash: ${err}`);
    } finally {
      setIsStashing(false);
    }
  };

  const handlePopStash = async (index: number) => {
    if (!currentDirectory) return;
    
    setIsPopping(true);
    setError(null);
    
    try {
      const result = await GitService.stashPop(currentDirectory, index);
      
      if (!result.success) {
        setError(`Failed to apply stash: ${result.error}`);
      } else {
        await loadStashes();
        await refreshStatus();
      }
    } catch (err) {
      console.error('Error applying stash:', err);
      setError(`Error applying stash: ${err}`);
    } finally {
      setIsPopping(false);
    }
  };

  // Parse stash index from the stash string (e.g., "stash@{0}: ..." => 0)
  const getStashIndex = (stash: GitStash): number => {
    return parseInt(stash.index, 10);
  };

  // Extract message from stash string
  const getStashMessage = (stash: GitStash): string => {
    return stash.message;
  };

  return (
    <div style={styles.container}>
      {error && (
        <div style={styles.error}>
          {error}
          <button 
            onClick={() => setError(null)}
            style={{ float: 'right', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
          >
            ✕
          </button>
        </div>
      )}
      
      <div style={styles.stashSection}>
        <div style={styles.heading}>Create New Stash</div>
        <input
          type="text"
          style={styles.input}
          placeholder="Stash message (optional)"
          value={stashMessage}
          onChange={(e) => setStashMessage(e.target.value)}
        />
        <button 
          style={styles.button}
          onClick={handleCreateStash}
          disabled={isStashing}
        >
          {isStashing ? 'Stashing...' : 'Stash Changes'}
        </button>
      </div>
      
      <div style={styles.heading}>
        Stashes
        <button 
          style={{ ...styles.button, float: 'right', fontSize: '12px', padding: '4px 8px' }}
          onClick={loadStashes}
          disabled={isLoading}
        >
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      
      {isLoading ? (
        <div style={styles.loading}>Loading stashes...</div>
      ) : stashes.length === 0 ? (
        <div style={styles.emptyState}>No stashes found</div>
      ) : (
        <div style={styles.stashList}>
          {stashes.map((stash, idx) => {
            const stashIdx = getStashIndex(stash);
            const stashMsg = getStashMessage(stash);
            
            return (
              <div key={idx} style={styles.stashItem}>
                <div style={styles.stashHeader}>
                  <span style={styles.stashDesc}>
                    {stashMsg || `Stash ${stashIdx}`}
                  </span>
                  <div style={styles.stashActions}>
                    <button 
                      style={styles.button}
                      onClick={() => handlePopStash(stashIdx)}
                      disabled={isPopping}
                    >
                      {isPopping ? 'Applying...' : 'Apply & Drop'}
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  stash@{stashIdx}: {stashMsg}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default GitStashView; 