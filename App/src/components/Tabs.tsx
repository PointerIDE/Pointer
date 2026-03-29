import React, { useState, useEffect } from 'react';
import { FileSystemItem, TabInfo } from '../types';
import { getIconForFile, PreviewIcon } from './FileIcons';
import ContextMenu from './ContextMenu';
import { AIFileService } from '../services/AIFileService';
import { showToast } from '../services/ToastService';
import { FileSystemService } from '../services/FileSystemService';
import { ExplorerService } from '../services/ExplorerService';
import Modal from './Modal';
import { isPreviewableFile } from '../utils/previewUtils';

interface TabsProps {
  openFiles: string[];
  currentFileId: string | null;
  items: Record<string, FileSystemItem>;
  onTabSelect?: (fileId: string) => void;
  onTabClose?: (fileId: string) => void;
  onToggleGrid?: () => void;
  isGridLayout?: boolean;
  // Preview functionality
  previewTabs: TabInfo[];
  onPreviewToggle?: (fileId: string) => void;
  onPreviewTabSelect?: (tabId: string) => void;
  onPreviewTabClose?: (tabId: string) => void;
  currentPreviewTabId?: string | null;
}

const tabsContainerStyle = {
  display: 'flex',
  overflowX: 'auto' as const,
  background: 'var(--bg-secondary)',
  borderBottom: '1px solid var(--border-color)',
  height: '35px',
  WebkitScrollbarHeight: '8px',
  WebkitScrollbarTrack: {
    background: 'var(--bg-secondary)',
  },
  WebkitScrollbarThumb: {
    background: 'var(--border-color)',
    borderRadius: '4px',
  },
} as const;

const Tabs: React.FC<TabsProps> = ({
  openFiles,
  currentFileId,
  items,
  onTabSelect,
  onTabClose,
  onToggleGrid,
  isGridLayout,
  previewTabs,
  onPreviewToggle,
  onPreviewTabSelect,
  onPreviewTabClose,
  currentPreviewTabId,
}) => {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    fileId: string;
  } | null>(null);
  
  const [summaryDialog, setSummaryDialog] = useState<{
    isOpen: boolean;
    fileName: string;
    summary: string;
    isStreaming: boolean;
  }>({
    isOpen: false,
    fileName: '',
    summary: '',
    isStreaming: false,
  });

  // Add cleanup effect to reset streaming state on unmount
  useEffect(() => {
    return () => {
      // Reset streaming state when component unmounts
      setSummaryDialog(prev => ({
        ...prev,
        isStreaming: false
      }));
    };
  }, []);

  const handleTabClick = (fileId: string) => {
    console.log('Tab clicked:', fileId);
    
    if (window.applyCustomTheme) {
      window.applyCustomTheme();
    }
    
    if (onTabSelect && fileId !== currentFileId) {
      onTabSelect(fileId);
    }
  };

  const handlePreviewTabClick = (tabId: string) => {
    if (onPreviewTabSelect && tabId !== currentPreviewTabId) {
      onPreviewTabSelect(tabId);
    }
  };

  const handleTabClose = (e: React.MouseEvent, fileId: string) => {
    e.stopPropagation();
    if (onTabClose) {
      onTabClose(fileId);
    }
  };

  const handlePreviewTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    if (onPreviewTabClose) {
      onPreviewTabClose(tabId);
    }
  };

  const handlePreviewToggle = () => {
    if (currentFileId && onPreviewToggle) {
      onPreviewToggle(currentFileId);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, fileId: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      fileId,
    });
  };

  const handleSummarizeFile = async (fileId: string) => {
    const file = items[fileId];
    if (!file || !file.path) {
      console.error('Cannot summarize: File data incomplete');
      showToast('Cannot summarize file: File data incomplete', 'error');
      return;
    }

    try {
      showToast(`Summarizing ${file.name}...`, 'info');
      
      let fileContent = file.content;
      if (!fileContent) {
        try {
          const loadedContent = await FileSystemService.readFile(fileId);
          if (loadedContent) {
            fileContent = loadedContent;
          } else {
            showToast(`Could not read content of ${file.name}`, 'error');
            return;
          }
        } catch (error) {
          console.error('Error loading file content for summarization:', error);
          showToast(`Error reading file: ${file.name}`, 'error');
          return;
        }
      }
      
      setSummaryDialog({
        isOpen: true,
        fileName: file.name,
        summary: '',
        isStreaming: true
      });
      
      let accumulatedSummary = '';
      
      // Add timeout to ensure streaming state is reset
      const timeoutId = setTimeout(() => {
        console.warn('File summarization timeout - resetting streaming state');
        setSummaryDialog(prev => ({
          ...prev,
          isStreaming: false
        }));
        showToast('File summarization timed out', 'error');
      }, 30000); // 30 second timeout
      
      console.log("Requesting streaming summary for file:", file.path);
      
      const summary = await AIFileService.getFileSummary(
        file.path, 
        fileContent,
        (chunk) => {
          accumulatedSummary += chunk;
          setSummaryDialog(prev => ({
            ...prev,
            summary: accumulatedSummary
          }));
        }
      );

      // Clear timeout since operation completed
      clearTimeout(timeoutId);

      setSummaryDialog(prev => ({
        ...prev,
        summary: summary || accumulatedSummary,
        isStreaming: false
      }));
      
      showToast(`Summary ready for ${file.name}`, 'success');
      
    } catch (error) {
      console.error('Error summarizing file:', error);
      showToast('Error generating file summary', 'error');
      
      setSummaryDialog(prev => ({
        ...prev,
        isStreaming: false
      }));
    }
  };

  const validOpenFiles = openFiles.filter(fileId => 
    fileId === 'welcome' || items[fileId]
  );

  const renderSummaryContent = () => {
    if (summaryDialog.isStreaming && summaryDialog.summary === '') {
      return <span className="blinking-cursor">|</span>;
    }
    
    return (
      <>
        {summaryDialog.summary || 'No summary available.'}
        {summaryDialog.isStreaming && <span className="blinking-cursor">|</span>}
      </>
    );
  };

  return (
    <>
      <div style={tabsContainerStyle}>
        {validOpenFiles.map((fileId) => {
          const file = items[fileId];
          const isActive = fileId === currentFileId;
          
          const fileName = fileId === 'welcome' && !file 
            ? 'Welcome' 
            : file?.name || 'Unknown File';
          
          return (
            <div
              key={fileId}
              onClick={() => handleTabClick(fileId)}
              onContextMenu={(e) => handleContextMenu(e, fileId)}
              style={{
                padding: '0 10px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                borderRight: '1px solid var(--border-color)',
                background: isActive ? 'var(--bg-selected)' : 'transparent',
                color: isActive ? 'var(--text-active)' : 'var(--text-primary)',
                fontWeight: isActive ? 500 : 'normal',
                fontSize: '13px',
                position: 'relative',
                whiteSpace: 'nowrap',
                userSelect: 'none',
                minWidth: 0,
              }}
            >
              <div style={{ 
                marginRight: '8px', 
                display: 'flex', 
                alignItems: 'center',
                flexShrink: 0,
              }}>
                {file ? getIconForFile(file.name) : null}
              </div>
              <div style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '150px',
              }}>
                {fileName}
              </div>
              {fileId !== 'welcome' && onTabClose && (
                <div
                  onClick={(e) => handleTabClose(e, fileId)}
                  style={{
                    marginLeft: '8px',
                    opacity: 0.6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    flexShrink: 0,
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.background = 'transparent'; }}
                >
                  ✕
                </div>
              )}
              {isActive && (
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '2px',
                  background: 'var(--accent-color)',
                }} />
              )}
            </div>
          );
        })}
        
        {/* Render preview tabs */}
        {previewTabs.map((tab) => {
          const file = items[tab.fileId!];
          const isActive = tab.id === currentPreviewTabId;
          
          if (!file) return null;
          
          return (
            <div
              key={tab.id}
              onClick={() => handlePreviewTabClick(tab.id)}
              style={{
                padding: '0 10px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                borderRight: '1px solid var(--border-color)',
                background: isActive ? 'var(--bg-selected)' : 'transparent',
                color: isActive ? 'var(--text-active)' : 'var(--text-primary)',
                fontWeight: isActive ? 500 : 'normal',
                fontSize: '13px',
                position: 'relative',
                whiteSpace: 'nowrap',
                userSelect: 'none',
                minWidth: 0,
              }}
            >
              <div style={{ 
                marginRight: '8px', 
                display: 'flex', 
                alignItems: 'center',
                flexShrink: 0,
              }}>
                <PreviewIcon />
              </div>
              <div style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '150px',
              }}>
                {file.name} (Preview)
              </div>
              <div
                onClick={(e) => handlePreviewTabClose(e, tab.id)}
                style={{
                  marginLeft: '8px',
                  opacity: 0.6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  flexShrink: 0,
                }}
                onMouseOver={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseOut={(e) => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.background = 'transparent'; }}
              >
                ✕
              </div>
              {isActive && (
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '2px',
                  background: 'var(--accent-color)',
                }} />
              )}
            </div>
          );
        })}
        
        {/* Preview button - show when current file is previewable */}
        {currentFileId && items[currentFileId] && isPreviewableFile(items[currentFileId].name) && onPreviewToggle && (
          <button
            onClick={handlePreviewToggle}
            style={{
              padding: '4px 8px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '3px',
              marginLeft: '8px',
            }}
            title="Open Preview"
          >
            <PreviewIcon />
          </button>
        )}
        
        {onToggleGrid && (
          <button
            onClick={onToggleGrid}
            style={{
              padding: '4px 8px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '3px',
              marginLeft: '8px',
            }}
            title={isGridLayout ? 'Single Editor' : 'Grid Layout'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
              {isGridLayout ? (
                <path d="M2 2h12v12H2z" strokeWidth="1.5" fill="none"/>
              ) : (
                <>
                  <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" strokeWidth="1.5" fill="none"/>
                </>
              )}
            </svg>
          </button>
        )}
        
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            options={[
              {
                label: 'Open in Explorer',
                onClick: async () => {
                  const file = items[contextMenu.fileId];
                  if (file && file.path) {
                    try {
                      // Get the current directory from FileSystemService
                      const currentDir = FileSystemService.getCurrentDirectory();
                      
                      const result = await ExplorerService.openInExplorer(file.path, currentDir || undefined);
                      if (!result.success) {
                        console.error('Failed to open in explorer:', result.error);
                        showToast('Failed to open in explorer', 'error');
                      }
                    } catch (error) {
                      console.error('Error opening in explorer:', error);
                      showToast('Error opening in explorer', 'error');
                    }
                  }
                },
                disabled: contextMenu.fileId === 'welcome',
              },
              {
                label: 'Summarize',
                onClick: () => handleSummarizeFile(contextMenu.fileId),
                disabled: contextMenu.fileId === 'welcome',
              },
              {
                label: 'Close',
                onClick: () => {
                  if (onTabClose) {
                    onTabClose(contextMenu.fileId);
                  }
                },
                disabled: contextMenu.fileId === 'welcome',
              },
            ]}
          />
        )}
      </div>
      
      <Modal
        isOpen={summaryDialog.isOpen}
        onClose={() => {
          console.log("Closing summary dialog");
          setSummaryDialog(prev => ({ ...prev, isOpen: false }));
        }}
        title={`File Summary: ${summaryDialog.fileName}`}
        content={renderSummaryContent()}
        isStreaming={summaryDialog.isStreaming}
      />
    </>
  );
};

export default Tabs; 