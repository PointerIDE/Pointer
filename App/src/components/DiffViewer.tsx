import React, { useEffect, useState, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { FileService } from '../services/FileService';
import { getIconForFile } from './FileIcons';
import { ThemeSettings } from '../types';

interface DiffChange {
  filePath: string;
  oldContent: string;
  newContent: string;
  timestamp: number;
  stats?: {
    added: number;
    removed: number;
  };
}

const styles = {
  indicator: {
    position: 'fixed' as const,
    bottom: '1rem',
    right: '1rem',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    borderRadius: '0.375rem',
    padding: '0.5rem 0.75rem',
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '12px',
    border: '1px solid var(--border-primary)',
    transition: 'background-color 0.2s',
    zIndex: 50,
  },
  indicatorHover: {
    backgroundColor: 'var(--bg-hover)',
  },
  modal: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  modalContent: {
    backgroundColor: 'var(--bg-primary)',
    borderRadius: '0.5rem',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    width: '90vw',
    maxWidth: '1200px',
    height: '85vh',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    transition: 'all 0.3s ease',
  },
  modalContentFullscreen: {
    width: '100vw',
    height: '100vh',
    maxWidth: '100vw',
    borderRadius: 0,
  },
  modalHeader: {
    padding: '1rem',
    backgroundColor: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-primary)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    color: 'var(--text-primary)',
    fontSize: '14px',
    fontWeight: 500,
  },
  modalSubtitle: {
    color: 'var(--text-secondary)',
    fontSize: '12px',
    marginTop: '0.25rem',
  },
  buttonGroup: {
    display: 'flex',
    gap: '0.5rem',
  },
  buttonBase: {
    padding: '0.375rem 0.75rem',
    fontSize: '12px',
    borderRadius: '0.25rem',
    transition: 'all 0.2s',
    cursor: 'pointer',
    border: 'none',
    color: 'var(--text-primary)',
  },
  declineButton: {
    backgroundColor: 'transparent',
    border: '1px solid var(--text-error)',
    color: 'var(--text-error)',
  },
  declineButtonHover: {
    backgroundColor: 'var(--bg-error)',
  },
  acceptButton: {
    backgroundColor: 'var(--accent-color)',
    border: '1px solid transparent',
  },
  acceptButtonHover: {
    backgroundColor: 'var(--accent-color-hover)',
  },
  closeButton: {
    backgroundColor: 'transparent',
    marginLeft: '0.5rem',
  },
  closeButtonHover: {
    backgroundColor: 'var(--bg-hover)',
  },
  fullscreenButton: {
    backgroundColor: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.375rem',
  },
  fullscreenButtonHover: {
    backgroundColor: 'var(--bg-hover)',
  },
  editorContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  disabledButton: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  fileList: {
    width: '200px',
    borderRight: '1px solid var(--border-primary)',
    backgroundColor: 'var(--bg-secondary)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'auto',
    position: 'relative' as const,
  },
  fileItem: {
    padding: '8px 12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: 'var(--text-primary)',
    transition: 'background-color 0.2s ease',
  },
  fileItemActive: {
    backgroundColor: 'var(--bg-hover)',
    borderLeft: '2px solid var(--accent-color)',
  },
  fileItemIcon: {
    display: 'flex',
    alignItems: 'center',
    opacity: 0.7,
  },
  diffContainer: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    position: 'relative' as const,
  },
  resizeHandle: {
    width: '4px',
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    right: 0,
    cursor: 'col-resize',
    backgroundColor: 'transparent',
    zIndex: 10,
    '&:hover': {
      backgroundColor: 'var(--accent-color)',
    },
    '&.active': {
      backgroundColor: 'var(--accent-color)',
    }
  },
  fileItemStats: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '10px',
  },
  statAdded: {
    color: '#28a745',
    backgroundColor: 'rgba(40, 167, 69, 0.1)',
    padding: '2px 4px',
    borderRadius: '3px',
    whiteSpace: 'nowrap' as const,
  },
  statRemoved: {
    color: '#dc2626',
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    padding: '2px 4px',
    borderRadius: '3px',
    whiteSpace: 'nowrap' as const,
  },
  diffStats: {
    marginLeft: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
  },
};

const ANIMATION_STYLES = `
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.85;
      transform: scale(1.03);
    }
  }

  @keyframes glow {
    0%, 100% {
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    50% {
      box-shadow: 0 0 8px var(--accent-color);
    }
  }

  .diff-indicator {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  .diff-indicator:hover {
    animation: none;
  }

  .diff-indicator-icon {
    color: var(--accent-color);
    transition: transform 0.2s;
  }

  .diff-indicator-text {
    color: var(--accent-color);
    font-weight: 500;
  }
`;

export const DiffViewer: React.FC = () => {
  const [diffs, setDiffs] = useState<DiffChange[]>([]);
  const [currentDiffIndex, setCurrentDiffIndex] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isHovering, setIsHovering] = useState<{[key: string]: boolean}>({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fileListWidth, setFileListWidth] = useState(200);
  const [isResizing, setIsResizing] = useState(false);
  
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Calculate diff statistics for a pair of strings
  const calculateDiffStats = (oldContent: string, newContent: string) => {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    let added = 0;
    let removed = 0;
    
    // Simple approach: count lines that differ
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      if (i >= oldLines.length) {
        added++;
      } else if (i >= newLines.length) {
        removed++;
      } else if (oldLines[i] !== newLines[i]) {
        if (newLines[i].trim() === '') {
          removed++;
        } else if (oldLines[i].trim() === '') {
          added++;
        } else {
          // Line was changed - count as both add and remove
          added++;
          removed++;
        }
      }
    }
    
    return { added, removed };
  };

  useEffect(() => {
    const unsubscribe = FileService.subscribe(async (filePath, oldContent, newContent) => {
      // Check if there's already a diff for this file path
      const existingDiffIndex = diffs.findIndex(diff => diff.filePath === filePath);
      
      // First try to get the actual current content of the file
      try {
        const response = await fetch(`http://localhost:23816/read-file?path=${encodeURIComponent(filePath)}`);
        if (response.ok) {
          oldContent = await response.text();
        }
      } catch (error) {
        console.error('Error reading current file content:', error);
      }

      // Calculate diff statistics
      const stats = calculateDiffStats(oldContent, newContent);
      
      // If there's an existing diff, update it instead of adding a new one
      if (existingDiffIndex !== -1) {
        const updatedDiffs = [...diffs];
        updatedDiffs[existingDiffIndex] = {
          filePath,
          oldContent,
          newContent,
          timestamp: Date.now(),
          stats
        };
        setDiffs(updatedDiffs);
        setCurrentDiffIndex(existingDiffIndex);
      } else {
        // Add a new diff
        setDiffs(prevDiffs => [...prevDiffs, {
          filePath,
          oldContent,
          newContent,
          timestamp: Date.now(),
          stats
        }]);
        setCurrentDiffIndex(diffs.length);
      }
      
      // Open the modal to show the diff
      setIsModalOpen(true);
      // Force refresh the diff editor to show the latest content
      setRefreshKey(prev => prev + 1);

      // Update the current editor if it's the file being changed
      const currentFile = window.getCurrentFile?.();
      if (currentFile?.path === filePath && window.editor) {
        const currentModel = window.editor.getModel();
        if (currentModel) {
          // Create decorations for the diff
          const originalLines = oldContent.split('\n');
          const newLines = newContent.split('\n');
          const diffDecorations: monaco.editor.IModelDeltaDecoration[] = [];

          // First pass: find all changes
          const changes = [];
          for (let i = 0; i < Math.max(originalLines.length, newLines.length); i++) {
            if (originalLines[i] !== newLines[i]) {
              changes.push({
                lineNumber: i + 1,
                type: originalLines[i] === undefined ? 'add' : 
                       newLines[i] === undefined ? 'remove' : 'modify'
              });
            }
          }

          // Second pass: create decorations with proper ranges
          changes.forEach(change => {
            const options = {
              isWholeLine: true,
              className: `${change.type === 'add' ? 'diffLineAdditionContent' : 
                         change.type === 'remove' ? 'diffLineRemovalContent' : 
                         'diffLineModifiedContent'}`,
              linesDecorationsClassName: `${change.type === 'add' ? 'diffLineAddition' : 
                                         change.type === 'remove' ? 'diffLineRemoval' : 
                                         'diffLineModified'}`,
              marginClassName: `${change.type === 'add' ? 'diffLineAdditionMargin' : 
                               change.type === 'remove' ? 'diffLineRemovalMargin' : 
                               'diffLineModifiedMargin'}`
            };

            diffDecorations.push({
              range: new monaco.Range(
                change.lineNumber,
                1,
                change.lineNumber,
                1
              ),
              options
            });
          });

          // Add the decorations to the editor
          window.editor.deltaDecorations([], diffDecorations);

          // Add the CSS if not already added
          if (!document.getElementById('diff-styles')) {
            const styleSheet = document.createElement('style');
            styleSheet.id = 'diff-styles';
            styleSheet.textContent = `
              .diffLineAddition { background-color: rgba(40, 167, 69, 0.2) !important; }
              .diffLineAdditionContent { background-color: rgba(40, 167, 69, 0.1) !important; }
              .diffLineAdditionMargin { border-left: 3px solid #28a745 !important; }
              
              .diffLineRemoval { background-color: rgba(220, 38, 38, 0.2) !important; }
              .diffLineRemovalContent { background-color: rgba(220, 38, 38, 0.1) !important; }
              .diffLineRemovalMargin { border-left: 3px solid #dc2626 !important; }
              
              .diffLineModified { background-color: rgba(58, 130, 246, 0.2) !important; }
              .diffLineModifiedContent { background-color: rgba(58, 130, 246, 0.1) !important; }
              .diffLineModifiedMargin { border-left: 3px solid #3a82f6 !important; }
            `;
            document.head.appendChild(styleSheet);
          }
        }
      }
    });

    return () => {
      unsubscribe();
      cleanupEditor();
      // Remove the diff styles
      const styleSheet = document.getElementById('diff-styles');
      if (styleSheet) {
        styleSheet.remove();
      }
    };
  }, []);

  const cleanupEditor = () => {
    if (diffEditorRef.current) {
      const { original, modified } = diffEditorRef.current.getModel() || {};
      original?.dispose();
      modified?.dispose();
      diffEditorRef.current.dispose();
      diffEditorRef.current = null;
    }
  };

  useEffect(() => {
    if (!isModalOpen || !containerRef.current) return;

    cleanupEditor();

    if (diffs.length > 0) {
      const currentDiff = diffs[currentDiffIndex];
      
      // Get the current theme from the app settings
      const currentTheme = window.appSettings?.theme;
      let themeName = 'vs-dark'; // default fallback
      
      // If we have a custom theme, use it
      const themeSettings = currentTheme as ThemeSettings;
      if (currentTheme && (themeSettings.name !== 'vs-dark' || 
          Object.keys(themeSettings.editorColors || {}).length > 0 || 
          (themeSettings.tokenColors || []).length > 0)) {
        themeName = 'custom-theme';
        // Ensure the custom theme is applied
        if (window.applyCustomTheme) {
          window.applyCustomTheme();
        }
      }
      
      diffEditorRef.current = monaco.editor.createDiffEditor(containerRef.current, {
        automaticLayout: true,
        readOnly: true,
        renderSideBySide: true,
        ignoreTrimWhitespace: false,
        theme: themeName,
        fontSize: 12,
        lineHeight: 1.5,
        minimap: { enabled: false },
        scrollbar: {
          vertical: 'visible',
          horizontal: 'visible',
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
        renderOverviewRuler: false,
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        diffWordWrap: 'on',
        padding: { top: 8, bottom: 8 },
        originalEditable: false,
        renderIndicators: true,
        renderMarginRevertIcon: true,
        enableSplitViewResizing: true,
      });

      const fileExtension = currentDiff.filePath.split('.').pop() || '';
      const language = getLanguageFromExtension(fileExtension);

      // Create models with the correct content
      const oldModel = monaco.editor.createModel(
        currentDiff.oldContent,
        language
      );
      const newModel = monaco.editor.createModel(
        currentDiff.newContent,
        language
      );
      
      diffEditorRef.current.setModel({
        original: oldModel,
        modified: newModel
      });

      // Set editor options for better diff visibility
      diffEditorRef.current.updateOptions({
        renderSideBySide: true,
        enableSplitViewResizing: true,
        originalEditable: false,
        lineNumbers: 'on',
        folding: false,
        renderIndicators: true,
        renderMarginRevertIcon: true,
      });

      // Add custom styles for the split view grabber to make it more visible
      if (!document.getElementById('split-view-styles')) {
        const styleSheet = document.createElement('style');
        styleSheet.id = 'split-view-styles';
        styleSheet.textContent = `
          .monaco-diff-editor .diffViewport {
            background-color: var(--border-primary) !important;
            width: 5px !important;
            cursor: col-resize !important;
          }
          .monaco-diff-editor .diffViewport:hover,
          .monaco-diff-editor .diffViewport.active {
            background-color: var(--accent-color) !important;
            width: 5px !important;
          }
        `;
        document.head.appendChild(styleSheet);
      }

      setTimeout(() => {
        diffEditorRef.current?.layout();
        // Scroll both editors to top
        diffEditorRef.current?.getOriginalEditor().setScrollTop(0);
        diffEditorRef.current?.getModifiedEditor().setScrollTop(0);
      }, 50);
    }
  }, [isModalOpen, currentDiffIndex, diffs, refreshKey]);

  const refreshDiffView = (newDiffs: DiffChange[], newIndex: number) => {
    // Force cleanup of the editor
    cleanupEditor();
    
    // Update the diffs array first
    setDiffs(newDiffs);
    
    // If there are no more diffs, close the modal
    if (newDiffs.length === 0) {
      setIsModalOpen(false);
      return;
    }
    
    // Update the current index
    setCurrentDiffIndex(newIndex);
    
    // Force a re-render by updating the refresh key
    setRefreshKey(prev => prev + 1);
  };

  const handleAccept = async () => {
    if (diffs.length === 0 || isProcessing) return;
    
    const currentDiff = diffs[currentDiffIndex];
    setIsProcessing(true);
    
    try {
      // Use FileService to accept the diff
      const success = await FileService.acceptDiff(currentDiff.filePath);
      
      if (success) {
        // Create a new array without the current diff
        const newDiffs = diffs.filter((_, i) => i !== currentDiffIndex);
        
        // Calculate the new index for the diffs array after removing the current item
        const newIndex = currentDiffIndex >= newDiffs.length ? 0 : currentDiffIndex;
        
        // Refresh the diff view with the new state
        refreshDiffView(newDiffs, newIndex);
      } else {
        // If the accept failed, try the original method
        const modifiedContent = diffEditorRef.current?.getModifiedEditor().getValue() || '';
        await FileService.saveFile(currentDiff.filePath, modifiedContent);
        
        // Create a new array without the current diff
        const newDiffs = diffs.filter((_, i) => i !== currentDiffIndex);
        
        // Update the current open file if this is the file being changed
        const currentFile = window.getCurrentFile?.();
        if (currentFile?.path === currentDiff.filePath && window.editor) {
          window.editor.setValue(modifiedContent);
        }

        // Reload the file in the file system
        const fileId = Object.entries(window.fileSystem?.items || {})
          .find(([_, item]) => item.path === currentDiff.filePath)?.[0];
        if (fileId && window.reloadFileContent) {
          await window.reloadFileContent(fileId);
        }

        // Calculate the new index for the diffs array after removing the current item
        const newIndex = currentDiffIndex >= newDiffs.length ? 0 : currentDiffIndex;
        
        // Refresh the diff view with the new state
        refreshDiffView(newDiffs, newIndex);
      }
    } catch (error) {
      console.error('Error accepting changes:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (isProcessing) return;
    
    setIsProcessing(true);
    
    try {
      const currentDiff = diffs[currentDiffIndex];
      
      // Use FileService to reject the diff
      FileService.rejectDiff(currentDiff.filePath);
      
      // Create a new array without the current diff
      const newDiffs = diffs.filter((_, i) => i !== currentDiffIndex);
      
      // Calculate the new index for the diffs array after removing the current item
      const newIndex = currentDiffIndex >= newDiffs.length ? 0 : currentDiffIndex;
      
      // Refresh the file explorer using a custom event
      try {
        const refreshEvent = new CustomEvent('file-explorer-refresh');
        window.dispatchEvent(refreshEvent);
      } catch (error) {
        console.error('Error dispatching refresh event:', error);
      }
      
      // Refresh the diff view with the new state
      refreshDiffView(newDiffs, newIndex);
    } catch (error) {
      console.error('Error rejecting changes:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAcceptAll = async () => {
    if (diffs.length === 0 || isProcessing) return;
    
    setIsProcessing(true);
    
    try {
      // Use FileService to accept all diffs
      const success = await FileService.acceptAllDiffs();
      
      if (success) {
        // Refresh the diff view with the new state
        refreshDiffView([], 0);
      } else {
        // Try the fallback method for each diff individually
        for (const diff of diffs) {
          try {
            const modifiedContent = diff.newContent;
            await FileService.saveFile(diff.filePath, modifiedContent);
            
            // Update the current open file if this is the file being changed
            const currentFile = window.getCurrentFile?.();
            if (currentFile?.path === diff.filePath && window.editor) {
              window.editor.setValue(modifiedContent);
            }
            
            // Reload the file in the file system
            const fileId = Object.entries(window.fileSystem?.items || {})
              .find(([_, item]) => item.path === diff.filePath)?.[0];
            if (fileId && window.reloadFileContent) {
              await window.reloadFileContent(fileId);
            }
          } catch (error) {
            console.error(`Error accepting changes for ${diff.filePath}:`, error);
          }
        }
        
        // Refresh the diff view with the new state
        refreshDiffView([], 0);
      }
    } catch (error) {
      console.error('Error accepting all changes:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRejectAll = async () => {
    if (isProcessing) return;
    
    setIsProcessing(true);
    
    try {
      // Use FileService to reject all diffs
      FileService.rejectAllDiffs();
      
      // Refresh the file explorer using a custom event
      try {
        const refreshEvent = new CustomEvent('file-explorer-refresh');
        window.dispatchEvent(refreshEvent);
      } catch (error) {
        console.error('Error dispatching refresh event:', error);
      }
      
      // Refresh the diff view with the new state
      refreshDiffView([], 0);
    } catch (error) {
      console.error('Error rejecting all changes:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const getLanguageFromExtension = (ext: string): string => {
    const languageMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'py': 'python',
      'json': 'json',
      'html': 'html',
      'css': 'css',
      'md': 'markdown',
    };
    return languageMap[ext] || 'plaintext';
  };

  // Add styles when component mounts
  useEffect(() => {
    if (!document.getElementById('diff-viewer-animations')) {
      const styleSheet = document.createElement('style');
      styleSheet.id = 'diff-viewer-animations';
      styleSheet.textContent = ANIMATION_STYLES;
      document.head.appendChild(styleSheet);

      return () => {
        styleSheet.remove();
        // Also remove split-view-styles when component unmounts
        const splitViewStyles = document.getElementById('split-view-styles');
        if (splitViewStyles) {
          splitViewStyles.remove();
        }
      };
    }
  }, []);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    // Force the diff editor to re-layout when fullscreen changes
    setTimeout(() => {
      diffEditorRef.current?.layout();
    }, 100);
  };

  // Add resize functionality for the file list
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  // Handle mouse move during resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !fileListRef.current) return;
      
      const containerRect = fileListRef.current.parentElement?.getBoundingClientRect();
      if (!containerRect) return;
      
      let newWidth = e.clientX - containerRect.left;
      
      // Set minimum and maximum width constraints
      newWidth = Math.max(100, Math.min(newWidth, 400));
      
      setFileListWidth(newWidth);
      
      // Force re-layout of the diff editor
      diffEditorRef.current?.layout();
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
    };
    
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Add keyboard shortcuts for fullscreen (F11 or ESC to exit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isModalOpen) {
        if (e.key === 'F11') {
          e.preventDefault();
          toggleFullscreen();
        } else if (e.key === 'Escape' && isFullscreen) {
          e.preventDefault();
          setIsFullscreen(false);
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen, isFullscreen]);

  // Listen for theme changes and update the diff editor theme
  useEffect(() => {
    const handleThemeChange = () => {
      if (diffEditorRef.current && isModalOpen) {
        // Get the current theme from the app settings
        const currentTheme = window.appSettings?.theme;
        let themeName = 'vs-dark'; // default fallback
        
        // If we have a custom theme, use it
        const themeSettings = currentTheme as ThemeSettings;
        if (currentTheme && (themeSettings.name !== 'vs-dark' || 
            Object.keys(themeSettings.editorColors || {}).length > 0 || 
            (themeSettings.tokenColors || []).length > 0)) {
          themeName = 'custom-theme';
        }
        
        // Update the diff editor theme - need to recreate the editor for theme changes
        // diffEditorRef.current.updateOptions({ theme: themeName });
        // For now, just apply the custom theme function
        if (window.applyCustomTheme) {
          window.applyCustomTheme();
        }
      }
    };
    
    // Listen for theme change events
    window.addEventListener('theme-changed', handleThemeChange);
    
    return () => {
      window.removeEventListener('theme-changed', handleThemeChange);
    };
  }, [isModalOpen]);

  // Update calculateDiffStats for all diffs if they don't have stats
  useEffect(() => {
    const updateDiffsWithStats = () => {
      const needsUpdate = diffs.some(diff => !diff.stats);
      if (needsUpdate) {
        const updatedDiffs = diffs.map(diff => {
          if (!diff.stats) {
            return {
              ...diff,
              stats: calculateDiffStats(diff.oldContent, diff.newContent)
            };
          }
          return diff;
        });
        setDiffs(updatedDiffs);
      }
    };
    
    updateDiffsWithStats();
  }, [diffs]);

  if (diffs.length === 0) {
    return null;
  }

  const currentDiff = diffs[currentDiffIndex];
  const fileName = currentDiff.filePath.split('/').pop() || currentDiff.filePath;

  return (
    <>
      <div 
        onClick={() => setIsModalOpen(true)}
        onMouseEnter={() => setIsHovering({ ...isHovering, indicator: true })}
        onMouseLeave={() => setIsHovering({ ...isHovering, indicator: false })}
        className={diffs.length > 0 ? 'diff-indicator' : undefined}
        style={{
          ...styles.indicator,
          ...(isHovering.indicator ? styles.indicatorHover : {}),
          ...(diffs.length > 0 ? {
            backgroundColor: '#1a2634',
            border: '1px solid #234876',
          } : {})
        }}
      >
        <svg 
          width="14" 
          height="14" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor"
          className={diffs.length > 0 ? 'diff-indicator-icon' : undefined}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        <span className={diffs.length > 0 ? 'diff-indicator-text' : undefined}>
          {diffs.length} pending {diffs.length === 1 ? 'change' : 'changes'}
        </span>
      </div>

      {isModalOpen && (
        <div style={styles.modal}>
          <div 
            style={{
              ...styles.modalContent,
              ...(isFullscreen ? styles.modalContentFullscreen : {})
            }}
          >
            <div style={styles.modalHeader}>
              <div>
                <div style={styles.modalTitle}>Review Changes</div>
                <div style={styles.modalSubtitle}>
                  {fileName} {diffs.length > 1 && `(${currentDiffIndex + 1}/${diffs.length} files)`}
                  {currentDiff.stats && (
                    <span style={styles.diffStats}>
                      {currentDiff.stats.added > 0 && (
                        <span style={styles.statAdded}>+{currentDiff.stats.added}</span>
                      )}
                      {currentDiff.stats.removed > 0 && (
                        <span style={styles.statRemoved}>-{currentDiff.stats.removed}</span>
                      )}
                    </span>
                  )}
                </div>
              </div>
              <div style={styles.buttonGroup}>
                {diffs.length > 1 && (
                  <>
                    <button
                      onClick={handleRejectAll}
                      disabled={isProcessing}
                      onMouseEnter={() => setIsHovering({ ...isHovering, declineAll: true })}
                      onMouseLeave={() => setIsHovering({ ...isHovering, declineAll: false })}
                      style={{
                        ...styles.buttonBase,
                        ...styles.declineButton,
                        ...(isHovering.declineAll ? styles.declineButtonHover : {}),
                        ...(isProcessing ? styles.disabledButton : {})
                      }}
                    >
                      Reject All
                    </button>
                    <button
                      onClick={handleAcceptAll}
                      disabled={isProcessing}
                      onMouseEnter={() => setIsHovering({ ...isHovering, acceptAll: true })}
                      onMouseLeave={() => setIsHovering({ ...isHovering, acceptAll: false })}
                      style={{
                        ...styles.buttonBase,
                        ...styles.acceptButton,
                        ...(isHovering.acceptAll ? styles.acceptButtonHover : {}),
                        ...(isProcessing ? styles.disabledButton : {})
                      }}
                    >
                      Accept All
                    </button>
                  </>
                )}
                <button
                  onClick={handleReject}
                  disabled={isProcessing}
                  onMouseEnter={() => setIsHovering({ ...isHovering, decline: true })}
                  onMouseLeave={() => setIsHovering({ ...isHovering, decline: false })}
                  style={{
                    ...styles.buttonBase,
                    ...styles.declineButton,
                    ...(isHovering.decline ? styles.declineButtonHover : {}),
                    ...(isProcessing ? styles.disabledButton : {})
                  }}
                >
                  Reject
                </button>
                <button
                  onClick={handleAccept}
                  disabled={isProcessing}
                  onMouseEnter={() => setIsHovering({ ...isHovering, accept: true })}
                  onMouseLeave={() => setIsHovering({ ...isHovering, accept: false })}
                  style={{
                    ...styles.buttonBase,
                    ...styles.acceptButton,
                    ...(isHovering.accept ? styles.acceptButtonHover : {}),
                    ...(isProcessing ? styles.disabledButton : {})
                  }}
                >
                  {isProcessing ? 'Accepting...' : 'Accept'}
                </button>
                <button
                  onClick={toggleFullscreen}
                  onMouseEnter={() => setIsHovering({ ...isHovering, fullscreen: true })}
                  onMouseLeave={() => setIsHovering({ ...isHovering, fullscreen: false })}
                  style={{
                    ...styles.buttonBase,
                    ...styles.fullscreenButton,
                    ...(isHovering.fullscreen ? styles.fullscreenButtonHover : {})
                  }}
                  title={isFullscreen ? 'Exit Fullscreen (ESC)' : 'Fullscreen (F11)'}
                >
                  {isFullscreen ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => setIsModalOpen(false)}
                  onMouseEnter={() => setIsHovering({ ...isHovering, close: true })}
                  onMouseLeave={() => setIsHovering({ ...isHovering, close: false })}
                  style={{
                    ...styles.buttonBase,
                    ...styles.closeButton,
                    ...(isHovering.close ? styles.closeButtonHover : {})
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <div style={styles.diffContainer}>
              <div 
                ref={fileListRef}
                style={{
                  ...styles.fileList,
                  width: `${fileListWidth}px`,
                }}
              >
                {diffs.map((diff, index) => {
                  const fileName = diff.filePath.split('/').pop() || diff.filePath;
                  const isActive = index === currentDiffIndex;
                  
                  return (
                    <div
                      key={diff.filePath}
                      onClick={() => setCurrentDiffIndex(index)}
                      style={{
                        ...styles.fileItem,
                        ...(isActive ? styles.fileItemActive : {}),
                        marginLeft: isActive ? '-2px' : '0',
                      }}
                    >
                      <span style={styles.fileItemIcon}>
                        {getIconForFile(fileName)}
                      </span>
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {fileName}
                      </span>
                      {diff.stats && (
                        <div style={styles.fileItemStats}>
                          {diff.stats.added > 0 && (
                            <span style={styles.statAdded}>+{diff.stats.added}</span>
                          )}
                          {diff.stats.removed > 0 && (
                            <span style={styles.statRemoved}>-{diff.stats.removed}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div 
                  className={isResizing ? 'active' : ''}
                  style={{
                    ...styles.resizeHandle,
                    backgroundColor: isResizing ? 'var(--accent-color)' : 'transparent',
                  }}
                  onMouseDown={startResize}
                />
              </div>
              <div ref={containerRef} style={styles.editorContainer} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}; 
