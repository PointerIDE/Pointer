import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import lmStudio from '../services/LMStudioService';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { v4 as uuidv4 } from 'uuid';
import '../styles/LLMChat.css';
import { DiffViewer } from './DiffViewer';
import { FileChangeEventService } from '../services/FileChangeEventService';
import { AIFileService } from '../services/AIFileService';
import { Message, FileSystemItem } from '../types';
import { FileSystemService } from '../services/FileSystemService';

import ToolService from '../services/ToolService';
import LinkHoverCard from './LinkHoverCard';
// Import configurations from the new chatConfig file
import { 
  generateSystemMessage,
  REFRESH_KNOWLEDGE_PROMPT,
  ExtendedMessage, 
  AttachedFile, 
  ChatSession,
  getFileExtension,
  generateValidToolCallId,
  generatePrompts,
  defaultModelConfigs,
  AFTER_TOOL_CALL_PROMPT,
  getChatSystemMessage,
  getAgentSystemMessage,
  generateEnhancedSystemMessage
} from '../config/chatConfig';
import { CodebaseContextService } from '../services/CodebaseContextService';
import { stripThinkTags, extractCodeBlocks } from '../utils/textUtils';
import { resizePerformanceMonitor } from '../utils/performance';
import { ChatService } from '../services/ChatService';

// Add TypeScript declarations for window properties
declare global {
  interface Window {
  lastSaveChatTime?: number;
  chatSaveCounter?: number;
  lastContentLength?: number;
  chatSaveVersion?: number; // Track the version of saves to prevent old overwrites
  lastSavedMessageCount?: number; // Track the number of messages saved
  highestMessageId?: number; // Track the highest message ID we've seen
  handleFileSelect?: (fileId: string) => void;
  electronAPI?: import('../types').ElectronAPI;
}
}

// LLMChat props
interface LLMChatProps {
  isVisible: boolean;
  onClose: () => void;
  onResize?: (width: number) => void;
  currentChatId: string;
  onSelectChat: (chatId: string) => void;
}

// Combined actions button component for code blocks
const CodeActionsButton: React.FC<{ content: string; filename: string; isProcessing?: boolean }> = ({ content, filename, isProcessing: parentIsProcessing = false }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Combine local processing state with parent processing state
  const isAnyProcessing = isProcessing || parentIsProcessing;

  // Debug logging
  console.log('CodeActionsButton rendered:', { filename, hasFilename: !!filename, isMenuOpen, isAnyProcessing });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setIsMenuOpen(false);
  };

  const handleInsert = async () => {
    setIsProcessing(true);
    setIsMenuOpen(false);
    // Declare originalContent at the function scope so it's accessible in the catch blocks
    let originalContent = '';
    
    try {
      // Check if file exists first
      
      // Get directory path for the file
      const directoryPath = filename.substring(0, filename.lastIndexOf('/'));
       
      try {
        // Try to read the file
        const response = await fetch(`http://localhost:23816/read-file?path=${encodeURIComponent(filename)}`);
        if (response.ok) {
          originalContent = await response.text();
        } else {
          // If file doesn't exist, check if we need to create directories
          if (directoryPath) {
            // Try to create the directory structure
            const createDirResponse = await fetch(`http://localhost:23816/create-directory`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                parentId: 'root_' + directoryPath.split('/')[0], // Use root as parent for first level
                name: directoryPath.split('/').pop() || ''
              })
            });
            
            if (!createDirResponse.ok) {
              console.log(`Created directory structure: ${directoryPath}`);
            }
          }
          
          // For non-existing files, we'll use empty content
          originalContent = '';
        }
      } catch (error) {
        console.error('Error reading file:', error);
        // For errors, use empty content
        originalContent = '';
      }

      // Get model ID for insert purpose
      const insertModelId = await AIFileService.getModelIdForPurpose('insert');
      
      // Get insert model settings from localStorage
      const insertModelConfigStr = localStorage.getItem('insertModelConfig');
      const insertModelConfig = insertModelConfigStr ? JSON.parse(insertModelConfigStr) : {
        temperature: 0.2,
        maxTokens: null,
      };

      // Create a prompt for the AI to merge the changes
      const mergePrompt = generatePrompts.codeMerging(filename, originalContent, content);

      // Use the chat completions endpoint for merging
      const result = await lmStudio.createChatCompletion({
        model: insertModelId,
        messages: [
          {
            role: 'system',
            content: 'You are a code merging expert. Return only the merged code without any explanations.'
          },
          {
            role: 'user',
            content: mergePrompt
          }
        ],
        temperature: insertModelConfig.temperature || 0.2,
        ...(insertModelConfig.maxTokens && insertModelConfig.maxTokens > 0 ? { max_tokens: insertModelConfig.maxTokens } : {}),
        stream: false
      });

      let mergedContent = result.choices[0].message.content.trim();
      
      // Strip <think> tags from the merged content before showing in diff viewer
      mergedContent = stripThinkTags(mergedContent);

      // Use the FileChangeEventService to trigger the diff viewer
      FileChangeEventService.emitChange(filename, originalContent, mergedContent);
    } catch (error) {
      console.error('Error during insert:', error);
      // Fallback to using the chat model if the Insert-Model fails
      try {
        console.log('Falling back to chat model for insertion...');
        
        // Get chat model ID for fallback
        const chatModelId = await AIFileService.getModelIdForPurpose('chat');
        
        // Get chat model settings from localStorage
        const modelConfigStr = localStorage.getItem('modelConfig');
        const modelConfig = modelConfigStr ? JSON.parse(modelConfigStr) : {
          temperature: 0.3,
          maxTokens: null,
          frequencyPenalty: 0,
          presencePenalty: 0,
        };

        // Create a prompt for the AI to merge the changes
        const mergePrompt = generatePrompts.codeMerging(filename, originalContent, content);

        // Use the lmStudio service for merging
        const result = await lmStudio.createChatCompletion({
          model: chatModelId,
          messages: [
            {
              role: 'system',
              content: 'You are a code merging expert. Return only the merged code without any explanations.'
            },
            {
              role: 'user',
              content: mergePrompt
            }
          ],
          temperature: modelConfig.temperature || 0.3,
          ...(modelConfig.maxTokens && modelConfig.maxTokens > 0 ? { max_tokens: modelConfig.maxTokens } : {}),
          stream: false
        });

        let mergedContent = result.choices[0].message.content.trim();
        
        // Strip <think> tags from the merged content before showing in diff viewer
        mergedContent = stripThinkTags(mergedContent);

        // Use the FileChangeEventService to trigger the diff viewer
        FileChangeEventService.emitChange(filename, originalContent, mergedContent);
      } catch (fallbackError) {
        console.error('Fallback insertion also failed:', fallbackError);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        style={{
          position: 'absolute',
          right: '10px',
          top: '10px',
          background: 'rgba(30, 30, 30, 0.7)',
          border: 'none',
          borderRadius: '4px',
          padding: '6px 10px',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '5px',
          backdropFilter: 'blur(3px)',
          fontSize: '12px',
          fontWeight: 'bold',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          zIndex: 5,
        }}
        title="Code actions"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="1" />
          <circle cx="12" cy="5" r="1" />
          <circle cx="12" cy="19" r="1" />
        </svg>
      </button>

      {isMenuOpen && (
        <div
          style={{
            position: 'absolute',
            right: '10px',
            top: '40px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
            zIndex: 6,
            minWidth: '150px',
            overflow: 'hidden',
          }}
        >
          <button
            onClick={handleCopy}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'none',
              border: 'none',
              color: copied ? 'var(--accent-color)' : 'var(--text-primary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              transition: 'background-color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {copied ? 'Copied!' : 'Copy code'}
          </button>
          {filename && (
            <button
              onClick={handleInsert}
              disabled={isAnyProcessing}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                color: isAnyProcessing ? 'var(--accent-color)' : 'var(--text-primary)',
                cursor: isAnyProcessing ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                transition: 'background-color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                if (!isAnyProcessing) {
                  e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {isAnyProcessing ? (
                <svg 
                  width="14" 
                  height="14" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  style={{ animation: 'spin 1s linear infinite' }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              )}
              {isAnyProcessing ? 'Inserting...' : 'Insert code'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Update CollapsibleCodeBlock component to use the new combined button
const CollapsibleCodeBlock: React.FC<{ 
  language: string; 
  filename?: string; 
  content: string; 
  isProcessing?: boolean;
  startLine?: number;
  endLine?: number;
  isLineEdit?: boolean;
}> = React.memo(({ language, filename, content, isProcessing = false, startLine, endLine, isLineEdit = false }) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [loadedOriginal, setLoadedOriginal] = useState(false);
  
  // Calculate if the code block should be collapsible
  const lines = content.split('\n');
  const shouldBeCollapsible = lines.length > 10; // Only collapse if more than 10 lines
  const isCollapsible = shouldBeCollapsible && isCollapsed;
  
  // Allow line-edit syntax in first code line as fallback: 10:15:src/file.ts (any comment prefix)
  let displayContent = content;
  let localStartLine: number | undefined;
  let localEndLine: number | undefined;
  let localIsLineEdit = false;
  try {
    const firstLine = content.split('\n')[0] || '';
    const lineEditHeader = firstLine.replace(/^\s*(?:\/\/|#|;|--)?\s*/, '');
    const m = lineEditHeader.match(/^(\d+):(\d+):(.+)$/);
    if (m) {
      localStartLine = parseInt(m[1], 10);
      localEndLine = parseInt(m[2], 10);
      if (!filename && m[3]) {
        // Set filename implicitly if not provided
        filename = m[3].trim();
      }
      localIsLineEdit = Number.isFinite(localStartLine) && Number.isFinite(localEndLine) && localStartLine! > 0 && localEndLine! >= localStartLine!;
      if (localIsLineEdit) {
        displayContent = content.split('\n').slice(1).join('\n');
      }
    }
  } catch {}

  const effectiveStartLine = startLine ?? localStartLine;
  const effectiveEndLine = endLine ?? localEndLine;
  const effectiveIsLineEdit = isLineEdit || localIsLineEdit;

  // Create display text for the header
  const getHeaderText = () => {
    const fileName = filename || `${language}.${getFileExtension(language)}`;
    if (effectiveIsLineEdit && effectiveStartLine && effectiveEndLine) {
      return `${fileName} (lines ${effectiveStartLine}-${effectiveEndLine})`;
    }
    return fileName;
  };

  // Load existing file content for inline diff view
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (filename) {
          const current = await FileSystemService.readText(filename);
          if (!cancelled) {
            setOriginalContent(current);
            setLoadedOriginal(true);
          }
        } else {
          setLoadedOriginal(true);
        }
      } catch {
        if (!cancelled) {
          setOriginalContent(null);
          setLoadedOriginal(true);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [filename]);

  // Build a simple inline diff representation
  const buildInlineDiff = (): { type: 'ctx' | 'add' | 'rem'; text: string }[] | null => {
    if (!loadedOriginal) return null;
    const newLines = displayContent.split('\n');
    const oldLines = (originalContent ?? '').split('\n');

    // If file doesn't exist, mark all as additions
    if (originalContent === null) {
      return newLines.map(l => ({ type: 'add', text: l }));
    }

    // Line-edit mode: show small window around edited range
    if (effectiveIsLineEdit && effectiveStartLine && effectiveEndLine) {
      const startIdx = Math.max(0, effectiveStartLine - 1);
      const endIdxExclusive = Math.min(oldLines.length, effectiveEndLine);
      const beforeStart = Math.max(0, startIdx - 3);
      const afterEnd = Math.min(oldLines.length, endIdxExclusive + 3);

      const result: { type: 'ctx' | 'add' | 'rem'; text: string }[] = [];
      // Context before
      for (let i = beforeStart; i < startIdx; i++) result.push({ type: 'ctx', text: oldLines[i] ?? '' });
      // Removed lines
      for (let i = startIdx; i < endIdxExclusive; i++) result.push({ type: 'rem', text: oldLines[i] ?? '' });
      // Added lines (new content provided for edit block)
      for (const l of newLines) result.push({ type: 'add', text: l });
      // Context after
      for (let i = endIdxExclusive; i < afterEnd; i++) result.push({ type: 'ctx', text: oldLines[i] ?? '' });
      return result;
    }

    // Fallback unified diff: naive line-by-line compare by index
    const maxLen = Math.max(oldLines.length, newLines.length);
    const out: { type: 'ctx' | 'add' | 'rem'; text: string }[] = [];
    for (let i = 0; i < maxLen; i++) {
      const o = oldLines[i];
      const n = newLines[i];
      if (o === n) {
        if (o !== undefined) out.push({ type: 'ctx', text: o });
      } else {
        if (o !== undefined) out.push({ type: 'rem', text: o });
        if (n !== undefined) out.push({ type: 'add', text: n });
      }
    }
    return out;
  };
  
  return (
    <div 
      style={{ 
        position: 'relative', 
        marginTop: '15px',
        marginBottom: '15px',
        borderRadius: '8px',
        overflow: 'hidden',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        border: isLineEdit ? '2px solid var(--accent-color)' : '1px solid var(--border-primary)',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div 
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            background: isLineEdit ? 'rgba(0, 123, 255, 0.1)' : 'rgba(40, 44, 52, 0.9)',
            padding: '8px 16px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            color: isLineEdit ? 'var(--accent-color)' : 'var(--text-secondary)',
            fontSize: '12px',
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            alignItems: 'center',
            backdropFilter: 'blur(3px)',
            zIndex: 4,
          }}
        >
          <svg 
            width="14" 
            height="14" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            style={{ marginRight: '8px' }}
          >
            {isLineEdit ? (
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            ) : (
              <>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </>
            )}
          </svg>
          {getHeaderText()}
          {isLineEdit && (
            <span style={{ 
              marginLeft: '8px', 
              fontSize: '10px', 
              padding: '2px 6px', 
              backgroundColor: 'var(--accent-color)', 
              color: 'white', 
              borderRadius: '3px',
              fontWeight: 'bold'
            }}>
              LINE EDIT
            </span>
          )}
        </div>
        <CodeActionsButton content={content} filename={filename || ''} isProcessing={isProcessing} />
      </div>
      <div style={{ 
        maxHeight: isCollapsible ? '200px' : 'none',
        overflow: 'hidden',
        transition: 'max-height 0.3s ease-out'
      }}>
        <SyntaxHighlighter
              language={language}
          style={vscDarkPlus as any}
              wrapLines={true}
          showLineNumbers={true}
          lineNumberStyle={{ 
            minWidth: '2.5em', 
            paddingRight: '1em', 
            color: 'rgba(150, 150, 150, 0.5)',
            textAlign: 'right',
            userSelect: 'none',
            borderRight: '1px solid rgba(100, 100, 100, 0.4)',
            marginRight: '10px',
            background: 'transparent'
          }}
          customStyle={{
            margin: '0',
            padding: '16px 0',
            paddingTop: '40px',
            borderRadius: '8px',
            fontSize: '13px',
            backgroundColor: 'var(--bg-code)',
            overflowX: 'auto',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              padding: '0 16px',
              background: 'transparent'
            }
          }}
          lineProps={(lineNumber) => {
            // Inline diff playback: if this is a line edit block, mark adds/removes
            if (effectiveIsLineEdit && effectiveStartLine && effectiveEndLine) {
              const inReplaced = lineNumber >= effectiveStartLine && lineNumber <= effectiveEndLine;
              return {
                style: {
                  backgroundColor: inReplaced ? 'rgba(220, 38, 38, 0.12)' : 'transparent',
                  display: 'block',
                  width: '100%'
                }
              };
            }
            return {
              style: {
                backgroundColor: 'transparent',
                display: 'block',
                width: '100%'
              }
            };
          }}
        >
          {content}
        </SyntaxHighlighter>
      </div>
      {isCollapsible && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '40px',
            background: 'linear-gradient(transparent, var(--bg-code))',
            pointerEvents: 'none'
          }}
        />
      )}
      {shouldBeCollapsible && (
      <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
            position: 'absolute',
            left: '50%',
            bottom: '5px',
            transform: 'translateX(-50%)',
            background: isHovered ? 'rgba(30, 30, 30, 0.9)' : 'rgba(30, 30, 30, 0.7)',
          border: 'none',
            borderRadius: '4px',
            padding: '6px 12px',
            color: 'var(--text-secondary)',
          cursor: 'pointer',
            transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            backdropFilter: 'blur(3px)',
            fontSize: '12px',
            fontWeight: 'bold',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            zIndex: 5,
            opacity: isHovered ? 1 : 0,
          }}
          title={isCollapsed ? 'Show more' : 'Show less'}
        >
          <svg 
            width="14" 
            height="14" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            style={{
              transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
              transition: 'transform 0.2s ease'
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span>{isCollapsed ? `Show ${lines.length - 10} more lines` : 'Show less'}</span>
            </button>
      )}
    </div>
  );
});

// Add this near the top with other component definitions
interface ThinkTimes {
  [key: string]: number;
}

// Add this near the top with other interfaces
interface CodeProps extends React.HTMLAttributes<HTMLElement> {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

// Component to handle long user messages with fade-out effect
const LongMessageWrapper: React.FC<{ 
  message: ExtendedMessage; 
  children: React.ReactNode;
}> = React.memo(({ message, children }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isLongMessage, setIsLongMessage] = useState(false);
  const [lineCount, setLineCount] = useState(0);

  // Check if message is long enough to need truncation
  useEffect(() => {
    if (contentRef.current && message.role === 'user') {
      const content = contentRef.current;
      
      // Use a more reliable method to calculate line count
      const style = window.getComputedStyle(content);
      const lineHeight = parseInt(style.lineHeight) || parseInt(style.fontSize) * 1.2 || 20;
      const height = content.scrollHeight;
      const lines = Math.ceil(height / lineHeight);
      
      setLineCount(lines);
      setIsLongMessage(lines > 6);
    }
  }, [message.content, message.role]);

  if (message.role !== 'user' || !isLongMessage || isExpanded) {
    return <div ref={contentRef}>{children}</div>;
  }

      return (
      <div ref={contentRef} style={{ position: 'relative', width: '100%' }}>
        <div
          style={{
            maxHeight: '120px', // Approximately 6 lines
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
          }}
        >
          {children}
          {/* Fade-out overlay */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '40px',
              background: 'linear-gradient(transparent, var(--bg-primary))',
              pointerEvents: 'none',
            }}
          />
        </div>
        {/* Show full message button */}
        <button
          onClick={() => setIsExpanded(true)}
          style={{
            position: 'absolute',
            bottom: '-8px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            borderRadius: '12px',
            padding: '4px 12px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
            transition: 'all 0.2s ease',
            zIndex: 1,
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-primary)';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          Show full message ({lineCount} lines)
        </button>
      </div>
    );
});

// Memoized MessageRenderer to prevent unnecessary re-renders during resize
const MessageRenderer: React.FC<{ 
  message: ExtendedMessage; 
  isAnyProcessing?: boolean;
  onContinue?: (messageIndex: number) => void;
  messageIndex?: number;
}> = React.memo(({ message, isAnyProcessing = false, onContinue, messageIndex }) => {
  const [thinkTimes] = useState<ThinkTimes>({});
  
  // Handle non-string content
  const messageContent = typeof message.content === 'string' 
    ? message.content 
    : JSON.stringify(message.content, null, 2);
  
  // Check if we have an incomplete think block
  const hasIncompleteThink = messageContent.includes('<think>') && 
    !messageContent.includes('</think>');

  // Start timing when a think block starts
  useEffect(() => {
    if (hasIncompleteThink) {
      const thinkStart = Date.now();
      const thinkKey = messageContent; // Use the full message content as the key
      thinkTimes[thinkKey] = thinkStart;
    }
  }, [hasIncompleteThink, messageContent, thinkTimes]);

  // If we have an incomplete think, extract the content after <think>
  if (hasIncompleteThink) {
    const parts = messageContent.split('<think>');
    
    // If the thinking content is empty, just render the content before the <think> tag
    if (!parts[1] || !parts[1].trim()) {
      return (
        <div className="message-content">
          {message.attachments && message.attachments.length > 0 && (
            <div className="message-attachments">
              <div className="attachments-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span>{message.attachments.length} attached {message.attachments.length === 1 ? 'file' : 'files'}</span>
              </div>
              <div className="attachments-list">
                {message.attachments.map((file, index) => (
                  <div key={index} className="attachment-item">
                    <div className="attachment-name">
                      <span className="attachment-icon">📄</span>
                      {file.name}
                    </div>
                    <button
                      className="attachment-expand-button"
                      onClick={() => window.open(`data:text/plain;charset=utf-8,${encodeURIComponent(file.content)}`, '_blank')}
                      title="View file content"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <polyline points="9 21 3 21 3 15"></polyline>
                        <line x1="21" y1="3" x2="14" y2="10"></line>
                        <line x1="3" y1="21" x2="10" y2="14"></line>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children, ...props }) => {
                const hasCodeBlock = React.Children.toArray(children).some(
                  child => React.isValidElement(child) && child.type === 'code'
                );
                return hasCodeBlock ? <div {...props}>{children}</div> : <p {...props}>{children}</p>;
              },
              ul: ({ children, ...props }) => (
                <ul style={{ 
                  margin: '8px 0',
                  paddingLeft: '24px',
                  listStyleType: 'disc'
                }} {...props}>
                  {children}
                </ul>
              ),
              ol: ({ children, ...props }) => (
                <ol style={{ 
                  margin: '8px 0',
                  paddingLeft: '24px',
                  listStyleType: 'decimal'
                }} {...props}>
                  {children}
                </ol>
              ),
              li: ({ children, ...props }) => (
                <li style={{ 
                  margin: '4px 0',
                  lineHeight: '1.5'
                }} {...props}>
                  {children}
                </li>
              ),
              a: ({ href, children, ...props }) => {
                const isExternalLink = href && (href.startsWith('http://') || href.startsWith('https://'));
                
                const linkElement = (
                  <a
                    href={href}
                    target={isExternalLink ? '_blank' : undefined}
                    rel={isExternalLink ? 'noopener noreferrer' : undefined}
                    style={{
                      color: 'var(--accent-color)',
                      textDecoration: 'none',
                      borderBottom: '1px solid var(--accent-color)',
                      transition: 'all 0.2s ease',
                      padding: '1px 2px',
                      borderRadius: '3px',
                      background: 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (isExternalLink) {
                        e.currentTarget.style.background = 'var(--accent-color)';
                        e.currentTarget.style.color = 'var(--bg-primary)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (isExternalLink) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--accent-color)';
                      }
                    }}
                    {...props}
                  >
                    {children}
                  </a>
                );
                
                // Wrap external links with LinkHoverCard
                if (isExternalLink && href) {
                  return (
                    <LinkHoverCard url={href}>
                      {linkElement}
                    </LinkHoverCard>
                  );
                }
                
                return linkElement;
              },
              // Strikethrough support
              del: ({ children, ...props }) => (
                <del style={{
                  textDecoration: 'line-through',
                  color: 'var(--text-secondary)',
                  opacity: 0.8
                }} {...props}>
                  {children}
                </del>
              ),
              // Blockquote support
              blockquote: ({ children, ...props }) => (
                <blockquote style={{
                  borderLeft: '4px solid var(--accent-color)',
                  margin: '16px 0',
                  padding: '8px 16px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '4px',
                  fontStyle: 'italic',
                  color: 'var(--text-secondary)'
                }} {...props}>
                  {children}
                </blockquote>
              ),
              // Table support
              table: ({ children, ...props }) => (
                <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                  <table style={{
                    borderCollapse: 'collapse',
                    width: '100%',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px'
                  }} {...props}>
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children, ...props }) => (
                <thead style={{
                  background: 'var(--bg-secondary)',
                  borderBottom: '2px solid var(--border-color)'
                }} {...props}>
                  {children}
                </thead>
              ),
              tbody: ({ children, ...props }) => (
                <tbody {...props}>
                  {children}
                </tbody>
              ),
              tr: ({ children, ...props }) => (
                <tr style={{
                  borderBottom: '1px solid var(--border-color)'
                }} {...props}>
                  {children}
                </tr>
              ),
              th: ({ children, ...props }) => (
                <th style={{
                  padding: '8px 12px',
                  textAlign: 'left',
                  fontWeight: 'bold',
                  color: 'var(--text-primary)',
                  borderRight: '1px solid var(--border-color)'
                }} {...props}>
                  {children}
                </th>
              ),
              td: ({ children, ...props }) => (
                <td style={{
                  padding: '8px 12px',
                  borderRight: '1px solid var(--border-color)',
                  color: 'var(--text-primary)'
                }} {...props}>
                  {children}
                </td>
              ),
              // Horizontal rule with better margins
              hr: ({ ...props }) => (
                <hr style={{
                  border: 'none',
                  height: '2px',
                  background: 'var(--border-color, #444)',
                  margin: '24px 0',
                  borderRadius: '1px',
                  opacity: 0.8
                }} {...props} />
              ),
              code({ className, children, ...props }: CodeProps) {
                let content = String(children).replace(/\n$/, '');
                
                // Check if this is a code block (triple backticks) or inline code (single backtick)
                const isCodeBlock = content.includes('\n') || content.length > 50;
                
                if (!isCodeBlock) {
                  return (
                    <code
                      style={{
                        background: 'var(--bg-code)',
                        padding: '2px 4px',
                        borderRadius: '3px',
                        fontSize: '0.9em',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--inline-code-color, #cc0000)',
                      }}
                      {...props}
                    >
                      {content}
                    </code>
                  );
                }

                let language = '';
                let filename = '';
                
                if (className) {
                  const match = /language-(\w+)(?::(.+))?/.exec(className);
                  if (match) {
                    language = match[1] || '';
                    filename = match[2] || '';
                  }
                }

                // If no filename was provided in the className, try to extract it from the first line
                if (!filename) {
                  const lines = content.split('\n');
                  const firstLine = lines[0].trim();
                  
                  // Extract potential filename from any comment style
                  // Match HTML comments, regular comments, and other common comment styles
                  const commentPatterns = [
                    /^<!--\s*(.*?\.[\w]+)\s*-->/, // HTML comments
                    /^\/\/\s*(.*?\.[\w]+)\s*$/, // Single line comments
                    /^#\s*(.*?\.[\w]+)\s*$/, // Hash comments
                    /^\/\*\s*(.*?\.[\w]+)\s*\*\/$/, // Multi-line comments
                    /^--\s*(.*?\.[\w]+)\s*$/, // SQL comments
                    /^%\s*(.*?\.[\w]+)\s*$/, // Matlab/LaTeX comments
                    /^;\s*(.*?\.[\w]+)\s*$/, // Assembly/Lisp comments
                  ];

                  for (const pattern of commentPatterns) {
                    const match = firstLine.match(pattern);
                    if (match && match[1]) {
                      const potentialPath = match[1].trim();
                      // Basic check if it looks like a file path (no spaces)
                      if (!potentialPath.includes(' ')) {
                        filename = potentialPath;
                        // Remove the first line from the content since we're using it as the filename
                        content = lines.slice(1).join('\n').trim();
                        break;
                      }
                    }
                  }
                }
                
                return (
                  <CollapsibleCodeBlock
                    language={language || 'text'}
                    filename={filename}
                    content={content}
                    isProcessing={isAnyProcessing}
                  />
                );
              }
            }}
          >
            {messageContent}
          </ReactMarkdown>
        </div>
      );
    }
    
    return (
      <>
        {/* Render content before <think> tag */}
        {parts[0] && (
          <div className="message-content">
            {message.attachments && message.attachments.length > 0 && (
              <div className="message-attachments">
                <div className="attachments-header">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span>{message.attachments.length} attached {message.attachments.length === 1 ? 'file' : 'files'}</span>
                </div>
                <div className="attachments-list">
                  {message.attachments.map((file, index) => (
                    <div key={index} className="attachment-item">
                      <div className="attachment-name">
                        <span className="attachment-icon">📄</span>
                        {file.name}
                      </div>
                      <button
                        className="attachment-expand-button"
                        onClick={() => window.open(`data:text/plain;charset=utf-8,${encodeURIComponent(file.content)}`, '_blank')}
                        title="View file content"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="15 3 21 3 21 9"></polyline>
                          <polyline points="9 21 3 21 3 15"></polyline>
                          <line x1="21" y1="3" x2="14" y2="10"></line>
                          <line x1="3" y1="21" x2="10" y2="14"></line>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children, ...props }) => {
                  const hasCodeBlock = React.Children.toArray(children).some(
                    child => React.isValidElement(child) && child.type === 'code'
                  );
                  return hasCodeBlock ? <div {...props}>{children}</div> : <p {...props}>{children}</p>;
                },
                ul: ({ children, ...props }) => (
                  <ul style={{ 
                    margin: '8px 0',
                    paddingLeft: '24px',
                    listStyleType: 'disc'
                  }} {...props}>
                    {children}
                  </ul>
                ),
                ol: ({ children, ...props }) => (
                  <ol style={{ 
                    margin: '8px 0',
                    paddingLeft: '24px',
                    listStyleType: 'decimal'
                  }} {...props}>
                    {children}
                  </ol>
                ),
                li: ({ children, ...props }) => (
                  <li style={{ 
                    margin: '4px 0',
                    lineHeight: '1.5'
                  }} {...props}>
                    {children}
                  </li>
                ),
                a: ({ href, children, ...props }) => {
                  const isExternalLink = href && (href.startsWith('http://') || href.startsWith('https://'));
                  
                  const linkElement = (
                    <a
                      href={href}
                      target={isExternalLink ? '_blank' : undefined}
                      rel={isExternalLink ? 'noopener noreferrer' : undefined}
                      style={{
                        color: 'var(--accent-color)',
                        textDecoration: 'none',
                        borderBottom: '1px solid var(--accent-color)',
                        transition: 'all 0.2s ease',
                        padding: '1px 2px',
                        borderRadius: '3px',
                        background: 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (isExternalLink) {
                          e.currentTarget.style.background = 'var(--accent-color)';
                          e.currentTarget.style.color = 'var(--bg-primary)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (isExternalLink) {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = 'var(--accent-color)';
                        }
                      }}
                      {...props}
                    >
                      {children}
                    </a>
                  );
                  
                  // Wrap external links with LinkHoverCard
                  if (isExternalLink && href) {
                    return (
                      <LinkHoverCard url={href}>
                        {linkElement}
                      </LinkHoverCard>
                    );
                  }
                  
                  return linkElement;
                },
                // Strikethrough support
                del: ({ children, ...props }) => (
                  <del style={{
                    textDecoration: 'line-through',
                    color: 'var(--text-secondary)',
                    opacity: 0.8
                  }} {...props}>
                    {children}
                  </del>
                ),
                // Blockquote support
                blockquote: ({ children, ...props }) => (
                  <blockquote style={{
                    borderLeft: '4px solid var(--accent-color)',
                    margin: '16px 0',
                    padding: '8px 16px',
                    background: 'var(--bg-secondary)',
                    borderRadius: '4px',
                    fontStyle: 'italic',
                    color: 'var(--text-secondary)'
                  }} {...props}>
                    {children}
                  </blockquote>
                ),
                // Table support
                table: ({ children, ...props }) => (
                  <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                    <table style={{
                      borderCollapse: 'collapse',
                      width: '100%',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px'
                    }} {...props}>
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children, ...props }) => (
                  <thead style={{
                    background: 'var(--bg-secondary)',
                    borderBottom: '2px solid var(--border-color)'
                  }} {...props}>
                    {children}
                  </thead>
                ),
                tbody: ({ children, ...props }) => (
                  <tbody {...props}>
                    {children}
                  </tbody>
                ),
                tr: ({ children, ...props }) => (
                  <tr style={{
                    borderBottom: '1px solid var(--border-color)'
                  }} {...props}>
                    {children}
                  </tr>
                ),
                th: ({ children, ...props }) => (
                  <th style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    fontWeight: 'bold',
                    color: 'var(--text-primary)',
                    borderRight: '1px solid var(--border-color)'
                  }} {...props}>
                    {children}
                  </th>
                ),
                td: ({ children, ...props }) => (
                  <td style={{
                    padding: '8px 12px',
                    borderRight: '1px solid var(--border-color)',
                    color: 'var(--text-primary)'
                  }} {...props}>
                    {children}
                  </td>
                ),
                // Horizontal rule with better margins
                hr: ({ ...props }) => (
                  <hr style={{
                    border: 'none',
                    height: '2px',
                    background: 'var(--border-color, #444)',
                    margin: '24px 0',
                    borderRadius: '1px',
                    opacity: 0.8
                  }} {...props} />
                ),
                code({ inline, className, children, ...props }: CodeProps) {
                  let content = String(children).replace(/\n$/, '');

                  // Respect inline flag from ReactMarkdown to distinguish inline vs block code
                  if (inline) {
                    // Improve Windows path readability by unescaping double backslashes in inline code
                    let displayContent = content;
                    if ((/[A-Za-z]:\\\\/.test(displayContent)) || (/^\\\\\\\\/.test(displayContent))) {
                      displayContent = displayContent.replace(/\\\\/g, '\\');
                    }
                    return (
                      <code
                        style={{
                          background: 'var(--bg-code)',
                          padding: '2px 4px',
                          borderRadius: '3px',
                          fontSize: '0.9em',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--inline-code-color, #cc0000)',
                        }}
                        {...props}
                      >
                        {displayContent}
                      </code>
                    );
                  }

                  let language = '';
                  let filename = '';
                  
                  if (className) {
                    const match = /language-(\w+)(?::(.+))?/.exec(className);
                    if (match) {
                      language = match[1] || '';
                      filename = match[2] || '';
                    }
                  }

                  // If no filename was provided in the className, try to extract it from the first line
                  if (!filename) {
                    const lines = content.split('\n');
                    const firstLine = lines[0].trim();
                    
                    // Extract potential filename from any comment style
                    // Match HTML comments, regular comments, and other common comment styles
                    const commentPatterns = [
                      /^<!--\s*(.*?\.[\w]+)\s*-->/, // HTML comments
                      /^\/\/\s*(.*?\.[\w]+)\s*$/, // Single line comments
                      /^#\s*(.*?\.[\w]+)\s*$/, // Hash comments
                      /^\/\*\s*(.*?\.[\w]+)\s*\*\/$/, // Multi-line comments
                      /^--\s*(.*?\.[\w]+)\s*$/, // SQL comments
                      /^%\s*(.*?\.[\w]+)\s*$/, // Matlab/LaTeX comments
                      /^;\s*(.*?\.[\w]+)\s*$/, // Assembly/Lisp comments
                    ];

                    for (const pattern of commentPatterns) {
                      const match = firstLine.match(pattern);
                      if (match && match[1]) {
                        const potentialPath = match[1].trim();
                        // Basic check if it looks like a file path (no spaces)
                        if (!potentialPath.includes(' ')) {
                          filename = potentialPath;
                          // Remove the first line from the content since we're using it as the filename
                          content = lines.slice(1).join('\n').trim();
                          break;
                        }
                      }
                    }
                  }
                  
                  return (
                    <CollapsibleCodeBlock
                      language={language || 'text'}
                      filename={filename}
                      content={content}
                      isProcessing={isAnyProcessing}
                    />
                  );
                }
              }}
            >
              {parts[0]}
            </ReactMarkdown>
          </div>
        )}
        <ThinkingBlock content={parts[1]} />
      </>
    );
  }

  // Split content into think blocks and other content
  const parts = messageContent.split(/(<think>.*?<\/think>)/s);
  
  // If no think blocks and no special parts, render as a regular message
  if (parts.length === 1) {
    return (
      <div className="message-content">
        {message.attachments && message.attachments.length > 0 && (
          <div className="message-attachments">
            <div className="attachments-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              <span>{message.attachments.length} attached {message.attachments.length === 1 ? 'file' : 'files'}</span>
            </div>
            <div className="attachments-list">
              {message.attachments.map((file, index) => (
                <div key={index} className="attachment-item">
                  <div className="attachment-name">
                    <span className="attachment-icon">📄</span>
                    {file.name}
                  </div>
                  <button
                    className="attachment-expand-button"
                    onClick={() => window.open(`data:text/plain;charset=utf-8,${encodeURIComponent(file.content)}`, '_blank')}
                    title="View file content"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <polyline points="9 21 3 21 3 15"></polyline>
                      <line x1="21" y1="3" x2="14" y2="10"></line>
                      <line x1="3" y1="21" x2="10" y2="14"></line>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children, ...props }) => {
              const hasCodeBlock = React.Children.toArray(children).some(
                child => React.isValidElement(child) && child.type === 'code'
              );
              return hasCodeBlock ? <div {...props}>{children}</div> : <p {...props}>{children}</p>;
            },
            ul: ({ children, ...props }) => (
              <ul style={{ 
                margin: '8px 0',
                paddingLeft: '24px',
                listStyleType: 'disc'
              }} {...props}>
                {children}
              </ul>
            ),
            ol: ({ children, ...props }) => (
              <ol style={{ 
                margin: '8px 0',
                paddingLeft: '24px',
                listStyleType: 'decimal'
              }} {...props}>
                {children}
              </ol>
            ),
            li: ({ children, ...props }) => (
              <li style={{ 
                margin: '4px 0',
                lineHeight: '1.5'
              }} {...props}>
                {children}
              </li>
            ),
            a: ({ href, children, ...props }) => {
              const isExternalLink = href && (href.startsWith('http://') || href.startsWith('https://'));
              
              const linkElement = (
                <a
                  href={href}
                  target={isExternalLink ? '_blank' : undefined}
                  rel={isExternalLink ? 'noopener noreferrer' : undefined}
                  style={{
                    color: 'var(--accent-color)',
                    textDecoration: 'none',
                    borderBottom: '1px solid var(--accent-color)',
                    transition: 'all 0.2s ease',
                    padding: '1px 2px',
                    borderRadius: '3px',
                    background: 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (isExternalLink) {
                      e.currentTarget.style.background = 'var(--accent-color)';
                      e.currentTarget.style.color = 'var(--bg-primary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (isExternalLink) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--accent-color)';
                    }
                  }}
                  {...props}
                >
                  {children}
                </a>
              );
              
              // Wrap external links with LinkHoverCard
              if (isExternalLink && href) {
                return (
                  <LinkHoverCard url={href}>
                    {linkElement}
                  </LinkHoverCard>
                );
              }
              
              return linkElement;
            },
            // Strikethrough support
            del: ({ children, ...props }) => (
              <del style={{
                textDecoration: 'line-through',
                color: 'var(--text-secondary)',
                opacity: 0.8
              }} {...props}>
                {children}
              </del>
            ),
            // Blockquote support
            blockquote: ({ children, ...props }) => (
              <blockquote style={{
                borderLeft: '4px solid var(--accent-color)',
                margin: '16px 0',
                padding: '8px 16px',
                background: 'var(--bg-secondary)',
                borderRadius: '4px',
                fontStyle: 'italic',
                color: 'var(--text-secondary)'
              }} {...props}>
                {children}
              </blockquote>
            ),
            // Table support
            table: ({ children, ...props }) => (
              <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                <table style={{
                  borderCollapse: 'collapse',
                  width: '100%',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px'
                }} {...props}>
                  {children}
                </table>
              </div>
            ),
            thead: ({ children, ...props }) => (
              <thead style={{
                background: 'var(--bg-secondary)',
                borderBottom: '2px solid var(--border-color)'
              }} {...props}>
                {children}
              </thead>
            ),
            tbody: ({ children, ...props }) => (
              <tbody {...props}>
                {children}
              </tbody>
            ),
            tr: ({ children, ...props }) => (
              <tr style={{
                borderBottom: '1px solid var(--border-color)'
              }} {...props}>
                {children}
              </tr>
            ),
            th: ({ children, ...props }) => (
              <th style={{
                padding: '8px 12px',
                textAlign: 'left',
                fontWeight: 'bold',
                color: 'var(--text-primary)',
                borderRight: '1px solid var(--border-color)'
              }} {...props}>
                {children}
              </th>
            ),
            td: ({ children, ...props }) => (
              <td style={{
                padding: '8px 12px',
                borderRight: '1px solid var(--border-color)',
                color: 'var(--text-primary)'
              }} {...props}>
                {children}
              </td>
            ),
            // Horizontal rule with better margins
            hr: ({ ...props }) => (
              <hr style={{
                border: 'none',
                height: '2px',
                background: 'var(--border-color, #444)',
                margin: '24px 0',
                borderRadius: '1px',
                opacity: 0.8
              }} {...props} />
            ),
            code({ inline, className, children, ...props }: CodeProps) {
              let content = String(children).replace(/\n$/, '');

              // ReactMarkdown correctly identifies:
              // - Single backticks (`code`) as inline (props.inline = true)
              // - Triple backticks (```code```) as block (props.inline = false/undefined)
              
              // Additional check: if content doesn't contain newlines and is short, treat as inline
              const isShortContent = content.length < 50 && !content.includes('\n');
              const shouldBeInline = inline === true || isShortContent;
              
              if (shouldBeInline) {
                return (
                  <code
                    style={{
                      background: 'var(--bg-code)',
                      padding: '2px 4px',
                      borderRadius: '3px',
                      fontSize: '0.9em',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--inline-code-color, #cc0000)',
                    }}
                    {...props}
                  >
                    {content}
                  </code>
                );
              }

              let language = '';
              let filename = '';
              
              if (className) {
                const match = /language-(\w+)(?::(.+))?/.exec(className);
                if (match) {
                  language = match[1] || '';
                  filename = match[2] || '';
                }
              }

              // If no filename was provided in the className, try to extract it from the first line
              if (!filename) {
                const lines = content.split('\n');
                const firstLine = lines[0].trim();
                
                // Extract potential filename from any comment style
                // Match HTML comments, regular comments, and other common comment styles
                const commentPatterns = [
                  /^<!--\s*(.*?\.[\w]+)\s*-->/, // HTML comments
                  /^\/\/\s*(.*?\.[\w]+)\s*$/, // Single line comments
                  /^#\s*(.*?\.[\w]+)\s*$/, // Hash comments
                  /^\/\*\s*(.*?\.[\w]+)\s*\*\/$/, // Multi-line comments
                  /^--\s*(.*?\.[\w]+)\s*$/, // SQL comments
                  /^%\s*(.*?\.[\w]+)\s*$/, // Matlab/LaTeX comments
                  /^;\s*(.*?\.[\w]+)\s*$/, // Assembly/Lisp comments
                ];

                for (const pattern of commentPatterns) {
                  const match = firstLine.match(pattern);
                  if (match && match[1]) {
                    const potentialPath = match[1].trim();
                    // Basic check if it looks like a file path (no spaces)
                    if (!potentialPath.includes(' ')) {
                      filename = potentialPath;
                      // Remove the first line from the content since we're using it as the filename
                      content = lines.slice(1).join('\n').trim();
                      break;
                    }
                  }
                }
              }
              
              return (
                <CollapsibleCodeBlock
                  language={language || 'text'}
                  filename={filename}
                  content={content}
                  isProcessing={isAnyProcessing}
                />
              );
            }
          }}
        >
          {parts[0]}
        </ReactMarkdown>
      </div>
    );
  }

  // Handle messages with think blocks
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('<think>') && part.endsWith('</think>')) {
          // Extract content between think tags
          const thinkContent = part.slice(7, -8); // Remove <think> and </think>
          
          // Skip rendering if think content is empty
          if (!thinkContent.trim()) {
            return null;
          }
          
          // Calculate actual thinking time using the full message as key
          const thinkKey = messageContent;
          const thinkTime = thinkTimes[thinkKey] ? Math.round((Date.now() - thinkTimes[thinkKey]) / 1000) : 0;
          return <ThinkBlock key={index} content={thinkContent} thinkTime={thinkTime} />;
        }

        // Regular content
        return part ? (
          <div key={index} className="message-content">
            {/* Display file attachments if they exist and it's the first part */}
            {index === 0 && message.attachments && message.attachments.length > 0 && (
              <div className="message-attachments">
                <div className="attachments-header">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span>{message.attachments.length} attached {message.attachments.length === 1 ? 'file' : 'files'}</span>
                </div>
                <div className="attachments-list">
                  {message.attachments.map((file, index) => (
                    <div key={index} className="attachment-item">
                      <div className="attachment-name">
                        <span className="attachment-icon">📄</span>
                        {file.name}
                      </div>
                      <button
                        className="attachment-expand-button"
                        onClick={() => window.open(`data:text/plain;charset=utf-8,${encodeURIComponent(file.content)}`, '_blank')}
                        title="View file content"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="15 3 21 3 21 9"></polyline>
                          <polyline points="9 21 3 21 3 15"></polyline>
                          <line x1="21" y1="3" x2="14" y2="10"></line>
                          <line x1="3" y1="21" x2="10" y2="14"></line>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children, ...props }) => {
                  const hasCodeBlock = React.Children.toArray(children).some(
                    child => React.isValidElement(child) && child.type === 'code'
                  );
                  return hasCodeBlock ? <div {...props}>{children}</div> : <p {...props}>{children}</p>;
                },
                ul: ({ children, ...props }) => (
                  <ul style={{ 
                    margin: '8px 0',
                    paddingLeft: '24px',
                    listStyleType: 'disc'
                  }} {...props}>
                    {children}
                  </ul>
                ),
                ol: ({ children, ...props }) => (
                  <ol style={{ 
                    margin: '8px 0',
                    paddingLeft: '24px',
                    listStyleType: 'decimal'
                  }} {...props}>
                    {children}
                  </ol>
                ),
                li: ({ children, ...props }) => (
                  <li style={{ 
                    margin: '4px 0',
                    lineHeight: '1.5'
                  }} {...props}>
                    {children}
                  </li>
                ),
                // Strikethrough support
                del: ({ children, ...props }) => (
                  <del style={{
                    textDecoration: 'line-through',
                    color: 'var(--text-secondary)',
                    opacity: 0.8
                  }} {...props}>
                    {children}
                  </del>
                ),
                // Blockquote support
                blockquote: ({ children, ...props }) => (
                  <blockquote style={{
                    borderLeft: '4px solid var(--accent-color)',
                    margin: '16px 0',
                    padding: '8px 16px',
                    background: 'var(--bg-secondary)',
                    borderRadius: '4px',
                    fontStyle: 'italic',
                    color: 'var(--text-secondary)'
                  }} {...props}>
                    {children}
                  </blockquote>
                ),
                // Table support
                table: ({ children, ...props }) => (
                  <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                    <table style={{
                      borderCollapse: 'collapse',
                      width: '100%',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px'
                    }} {...props}>
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children, ...props }) => (
                  <thead style={{
                    background: 'var(--bg-secondary)',
                    borderBottom: '2px solid var(--border-color)'
                  }} {...props}>
                    {children}
                  </thead>
                ),
                tbody: ({ children, ...props }) => (
                  <tbody {...props}>
                    {children}
                  </tbody>
                ),
                tr: ({ children, ...props }) => (
                  <tr style={{
                    borderBottom: '1px solid var(--border-color)'
                  }} {...props}>
                    {children}
                  </tr>
                ),
                th: ({ children, ...props }) => (
                  <th style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    fontWeight: 'bold',
                    color: 'var(--text-primary)',
                    borderRight: '1px solid var(--border-color)'
                  }} {...props}>
                    {children}
                  </th>
                ),
                td: ({ children, ...props }) => (
                  <td style={{
                    padding: '8px 12px',
                    borderRight: '1px solid var(--border-color)',
                    color: 'var(--text-primary)'
                  }} {...props}>
                    {children}
                  </td>
                ),
                // Horizontal rule with better margins
                hr: ({ ...props }) => (
                  <hr style={{
                    border: 'none',
                    height: '2px',
                    background: 'var(--border-color, #444)',
                    margin: '24px 0',
                    borderRadius: '1px',
                    opacity: 0.8
                  }} {...props} />
                ),
                code({ inline, className, children, ...props }: CodeProps) {
                  let content = String(children).replace(/\n$/, '');
                  
                  // Use the inline prop from ReactMarkdown to properly distinguish inline vs block code
                  if (inline) {
                    return (
                      <code
                        style={{
                          background: 'var(--bg-code, rgba(0, 0, 0, 0.2))',
                          padding: '2px 4px',
                          borderRadius: '3px',
                          fontSize: '0.9em',
                          fontFamily: 'var(--font-mono, "Fira Code", "Consolas", monospace)',
                          color: 'var(--inline-code-color, inherit)',
                          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                        }}
                        {...props}
                      >
                        {content}
                      </code>
                    );
                  }

                  let language = '';
                  let filename = '';
                  
                  if (className) {
                    const match = /language-(\w+)(?::(.+))?/.exec(className);
                    if (match) {
                      language = match[1] || '';
                      filename = match[2] || '';
                    }
                  }

                  // If no filename was provided in the className, try to extract it from the first line
                  if (!filename) {
                    const lines = content.split('\n');
                    const firstLine = lines[0].trim();
                    
                    // Extract potential filename from any comment style
                    // Match HTML comments, regular comments, and other common comment styles
                    const commentPatterns = [
                      /^<!--\s*(.*?\.[\w]+)\s*-->/, // HTML comments
                      /^\/\/\s*(.*?\.[\w]+)\s*$/, // Single line comments
                      /^#\s*(.*?\.[\w]+)\s*$/, // Hash comments
                      /^\/\*\s*(.*?\.[\w]+)\s*\*\/$/, // Multi-line comments
                      /^--\s*(.*?\.[\w]+)\s*$/, // SQL comments
                      /^%\s*(.*?\.[\w]+)\s*$/, // Matlab/LaTeX comments
                      /^;\s*(.*?\.[\w]+)\s*$/, // Assembly/Lisp comments
                    ];

                    for (const pattern of commentPatterns) {
                      const match = firstLine.match(pattern);
                      if (match && match[1]) {
                        const potentialPath = match[1].trim();
                        // Basic check if it looks like a file path (no spaces)
                        if (!potentialPath.includes(' ')) {
                          filename = potentialPath;
                          // Remove the first line from the content since we're using it as the filename
                          content = lines.slice(1).join('\n').trim();
                          break;
                        }
                      }
                    }
                  }
                  
                  return (
                    <CollapsibleCodeBlock
                      language={language || 'text'}
                      filename={filename}
                      content={content}
                      isProcessing={isAnyProcessing}
                    />
                  );
                }
              }}
            >
              {part}
            </ReactMarkdown>
          </div>
        ) : null;
      })}
    </>
  );
});

// Update ThinkBlock component to accept actual think time
const ThinkBlock: React.FC<{ content: string; thinkTime: number }> = ({ content, thinkTime }) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        marginTop: '8px',
        marginBottom: '12px', // Increased from 4px to 12px to create more space before tool calls
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="think-block-container" // Added for easier targeting in CSS
    >
      <button 
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          width: '100%',
          background: 'var(--bg-tertiary)',
          border: 'none',
          borderRadius: '4px',
          padding: '6px 12px',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg 
            width="14" 
            height="14" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            style={{
              transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease'
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span>Thoughts</span>
        </span>
      </button>
      {!isCollapsed && (
        <div
          style={{
            marginTop: '8px',
            padding: '12px 12px 12px 12px',
            background: 'var(--bg-tertiary)',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
            fontSize: '13px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {content.startsWith('\n') ? content.replace(/^\n/, '') : content}
        </div>
      )}
    </div>
  );
};


// ... removed code ...

// Add this component for handling incomplete think blocks
const ThinkingBlock: React.FC<{ content: string }> = ({ content }) => {
  // Skip rendering if content is empty
  if (!content || !content.trim()) {
    return null;
  }

  const [isExpanded, setIsExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Recompute overflow whenever content changes or window resizes
  useEffect(() => {
    const updateOverflow = () => {
      if (contentRef.current) {
        const el = contentRef.current;
        setHasOverflow(el.scrollHeight > el.clientHeight + 1); // +1 to avoid rounding glitches
      }
    };

    updateOverflow();
    window.addEventListener('resize', updateOverflow);
    const id = window.setInterval(updateOverflow, 250); // content grows during streaming
    return () => {
      window.removeEventListener('resize', updateOverflow);
      window.clearInterval(id);
    };
  }, [content]);

  // Always keep the bottom-most part visible when collapsed
  useEffect(() => {
    if (!isExpanded && contentRef.current) {
      const el = contentRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [content, isExpanded]);

  const collapsedMaxHeight = 160; // px

  // Create a stronger mask to fade the top when collapsed and overflowing
  const maskStyle: React.CSSProperties | undefined = !isExpanded && hasOverflow
    ? {
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0, black 32px, black 100%)',
        maskImage:
          'linear-gradient(to bottom, transparent 0, black 32px, black 100%)',
      }
    : undefined;

  return (
    <div
      style={{
        marginTop: '4px',
        marginBottom: '8px',
        padding: '4px 12px',
        color: 'var(--text-secondary)',
        fontSize: '13px',
        opacity: 0.7,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ animation: 'spin 2s linear infinite' }}
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span style={{ fontWeight: 500 }}>Thinking...</span>
      </div>

      <div
        ref={contentRef}
        style={{
          paddingLeft: '22px',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5,
          maxHeight: isExpanded ? 'none' : `${collapsedMaxHeight}px`,
          overflowY: isExpanded ? 'visible' : 'auto',
          ...maskStyle,
        }}
      >
        {content.startsWith('\n') ? content.replace(/^\n/, '') : content}
      </div>

      {/* Ensure we always show the latest part when collapsed */}
      <style>{`@keyframes spin {from{transform:rotate(0)} to{transform:rotate(360deg)}}`}</style>

      {(hasOverflow || isExpanded) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((v) => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '2px 4px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>{isExpanded ? 'Show less' : 'Show more'}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

// Add this section before the LLMChat component
const AutoInsertIndicator = ({ count, isProcessing }: { count: number; isProcessing: boolean }) => {
  if (count === 0) return null;
  
  return (
    <div 
      style={{
        position: 'fixed',
        bottom: '1rem',
        left: '1rem',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        borderRadius: '0.375rem',
        padding: '0.5rem 0.75rem',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '12px',
        border: '1px solid var(--border-primary)',
        zIndex: 50,
        transition: 'all 0.3s ease',
      }}
    >
      {isProcessing ? (
        <svg 
          width="14" 
          height="14" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="var(--accent-color)" 
          strokeWidth="2"
          className="rotating-svg"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ) : (
        <svg 
          width="14" 
          height="14" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="var(--accent-color)" 
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}
      <span style={{ color: 'var(--text-primary)' }}>
        {isProcessing ? 
          `Auto-inserting code (${count} remaining)...` : 
          `${count} code ${count === 1 ? 'block' : 'blocks'} queued for insertion`
        }
      </span>
    </div>
  );
};

// Keyframe animation styles for the spinner
const AUTO_INSERT_STYLES = `
  @keyframes rotate {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(-360deg);
    }
  }

  .rotating-svg {
    animation: rotate 1.5s linear infinite;
  }
  
  /* Add spacing between thinking blocks and subsequent tool messages */
  .think-block-container + div .message.tool {
    margin-top: 6px !important;
  }
  
  /* Typing dots animation */
  .typing-dots {
    animation: typing-pulse 1.4s infinite ease-in-out;
  }
  
  @keyframes typing-pulse {
    0%, 100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }
`;

// First, restore the interface for FunctionCall and ToolArgs
interface FunctionCall {
  id: string;
  name: string;
  arguments: string | Record<string, any>;
}

interface ToolArgs {
  directory_path?: string;
  file_path?: string;
  query?: string;
  url?: string;
  [key: string]: any;
}

// Add a function to normalize conversation history before sending to LLM
const normalizeConversationHistory = (messages: ExtendedMessage[]): Message[] => {
  console.log('Normalizing conversation history, messages count:', messages.length);
  
  // Track seen tool call IDs to avoid duplicates
  const seenToolCallIds = new Set<string>();
  
  // First pass: identify and log all tool-related messages
  console.log('--- MESSAGE ANALYSIS START ---');
  messages.forEach((msg, idx) => {
    if (msg.role === 'tool' && msg.tool_call_id) {
      console.log(`Tool response at index ${idx}, ID: ${msg.tool_call_id}, content: ${typeof msg.content === 'string' ? msg.content.substring(0, 50) + '...' : '[object]'}`);
    } else if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls && msg.tool_calls.length > 0) {
      console.log(`Assistant with tool calls at index ${idx}, count: ${msg.tool_calls.length}`);
      msg.tool_calls.forEach(tc => console.log(`  Tool call: ${tc.function?.name}, ID: ${tc.id}, args: ${typeof tc.function?.arguments === 'string' ? tc.function.arguments.substring(0, 50) + '...' : '[object]'}`));
    } else if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.includes('function_call:')) {
      console.log(`Assistant with function_call string at index ${idx}, content: ${msg.content.substring(0, 100)}...`);
    } else {
      console.log(`Message at index ${idx}, role: ${msg.role}, content: ${typeof msg.content === 'string' ? msg.content.substring(0, 50) + '...' : '[object]'}`);
    }
  });
  console.log('--- MESSAGE ANALYSIS END ---');
  
  // Second pass: filter and normalize messages
  const normalizedMessages = messages
    // First filter out duplicate tool responses - keep only the first one for each tool_call_id
    .filter((msg) => {
      if (msg.role === 'tool' && msg.tool_call_id) {
        if (seenToolCallIds.has(msg.tool_call_id)) {
          console.log(`Filtering out duplicate tool response for ID: ${msg.tool_call_id}`);
          return false;
        }
        seenToolCallIds.add(msg.tool_call_id);
      }
      return true;
    })
    // Also filter out empty tool messages that might cause issues
    .filter((msg) => {
      if (msg.role === 'tool' && (!msg.content || msg.content.trim() === '')) {
        console.log(`Filtering out empty tool message for ID: ${msg.tool_call_id || 'unknown'}`);
        return false;
      }
      return true;
    })
    // Temporarily disable aggressive filtering in normalizeConversationHistory as well
    // TODO: Re-enable with better logic once we confirm this fixes the issue
    .filter((msg, index) => {
      // Only filter out completely empty tool messages
      if (msg.role === 'tool' && (!msg.content || msg.content.trim() === '')) {
        console.log(`Normalize: Filtering out empty tool message for ID: ${msg.tool_call_id || 'unknown'}`);
        return false;
      }
      return true;
    })
    // Then map to the correct format for the API
    .map((msg) => {
      // Handle file attachments
      if (msg.attachments && msg.attachments.length > 0) {
        let contentWithAttachments = msg.content || '';
        if (contentWithAttachments && contentWithAttachments.trim() !== '') {
          contentWithAttachments += '\n\n';
        }
        msg.attachments.forEach(file => {
          contentWithAttachments += `File: ${file.name}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
        });
        return { role: msg.role, content: contentWithAttachments };
      }

      // Handle tool messages - ensure proper formatting
      if (msg.role === 'tool' && msg.tool_call_id) {
        const formattedToolResponse = { 
          role: 'tool' as const, 
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          tool_call_id: msg.tool_call_id
        };
        console.log(`Normalized tool response for ID: ${msg.tool_call_id}`);
        return formattedToolResponse;
      }

      // Special handling for assistant messages with function_call syntax in content
      // Only process if this is NOT a thinking message and the function_call looks like a real tool call
      if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.includes('function_call:')) {
        // Skip if this is a thinking message (contains <think> tags)
        if (msg.content.includes('<think>') || msg.content.includes('</think>')) {
          console.log('Skipping function_call extraction from thinking message');
          return { 
            role: msg.role, 
            content: msg.content || ''
          };
        }
        
        try {
          // Extract the function call - try multiple patterns
          const functionCallMatch = msg.content.match(/function_call:\s*({[\s\S]*?})(?=function_call:|$)/);
          if (functionCallMatch && functionCallMatch[1]) {
            console.log('Found function_call in content, extracting...');
            let functionCall: any;
            
            try {
              functionCall = JSON.parse(functionCallMatch[1]);
            } catch (e) {
              console.error('Error parsing function call JSON:', e);
              
              // Try manual extraction if JSON parsing fails
              const idMatch = functionCallMatch[1].match(/"id"\s*:\s*"([^"]+)"/);
              const nameMatch = functionCallMatch[1].match(/"name"\s*:\s*"([^"]+)"/);
              const argsMatch = functionCallMatch[1].match(/"arguments"\s*:\s*({[^}]+}|"[^"]+")/);
              
              functionCall = {
                id: idMatch?.[1] || generateValidToolCallId(),
                name: nameMatch?.[1] || 'unknown_function',
                arguments: argsMatch?.[1] || '{}'
              };
              console.log('Manually extracted function call:', functionCall);
            }
            
            // Validate that this is a real tool call, not an example or thinking
            if (functionCall.name === 'unknown_function' || !functionCall.name) {
              console.log('Skipping invalid function call with name:', functionCall.name);
              return { 
                role: msg.role, 
                content: msg.content || ''
              };
            }
            
            // Ensure valid ID format
            if (!functionCall.id || functionCall.id.length !== 9 || !/^[a-z0-9]+$/.test(functionCall.id)) {
              functionCall.id = generateValidToolCallId();
            }
            
            // Create a tool calls format message
            const formattedAssistantMessage = {
              role: 'assistant' as const,
              content: '', // Empty content when it's a tool call
              tool_calls: [{
                id: functionCall.id,
                type: 'function' as const,
                function: {
                  name: functionCall.name,
                  arguments: typeof functionCall.arguments === 'string' ? 
                    functionCall.arguments : JSON.stringify(functionCall.arguments)
                }
              }]
            };
            
            console.log('Converted string function_call to proper tool_calls format:', 
              JSON.stringify(formattedAssistantMessage.tool_calls));
            
            return formattedAssistantMessage;
          }
        } catch (e) {
          console.error('Error extracting function call from content:', e);
          // On error, fallback to original content
        }
      }

      // Handle normal assistant messages with tool_calls property
      if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls && msg.tool_calls.length > 0) {
        // Properly format each tool call
                    const formattedToolCalls = msg.tool_calls.map(tc => {
              // Generate valid ID if missing or invalid
              const validId = (!tc.id || tc.id.length !== 9 || !/^[a-z0-9]+$/.test(tc.id)) 
                ? generateValidToolCallId() 
                : tc.id;
                
              return {
                id: validId,
                type: 'function' as const,
                function: {
                  name: tc.function?.name || 'unknown',
                  arguments: typeof tc.function?.arguments === 'string' ? 
                    tc.function.arguments : JSON.stringify(tc.function?.arguments)
                }
              };
            });
        
        console.log(`Formatted ${formattedToolCalls.length} tool calls for assistant message`);
        
        return {
          role: 'assistant' as const,
          content: '', // Clear content when there are tool calls
          tool_calls: formattedToolCalls
        };
      }

      // Default for regular messages
      return { 
        role: msg.role as ('user' | 'assistant' | 'system' | 'tool'), 
        content: msg.content || '',
        // Include tool_call_id if present
        ...(msg.tool_call_id && {
          tool_call_id: msg.tool_call_id
        })
      };
    });
    
  console.log(`Normalized ${messages.length} messages to ${normalizedMessages.length} messages for API`);
  
  // Log the final normalized messages
  console.log('--- NORMALIZED MESSAGES START ---');
  normalizedMessages.forEach((msg, idx) => {
    if (msg.role === 'tool') {
      const toolCallId = 'tool_call_id' in msg ? (msg as any).tool_call_id : 'unknown';
    console.log(`Normalized tool message at index ${idx}, ID: ${toolCallId}`);
    } else if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
      console.log(`Normalized assistant with tool_calls at index ${idx}, count: ${msg.tool_calls.length}`);
    } else {
      console.log(`Normalized message at index ${idx}, role: ${msg.role}`);
    }
  });
  console.log('--- NORMALIZED MESSAGES END ---');
  
  // Add the REFRESH_KNOWLEDGE_PROMPT at the beginning of every API call
  // This automatically provides context about the application to every message
  // without requiring the user to explicitly refresh the AI's knowledge
  const refreshKnowledgeMessage: Message = {
    role: REFRESH_KNOWLEDGE_PROMPT.role,
    content: REFRESH_KNOWLEDGE_PROMPT.content
  };
  
  // Return the normalized messages with the refresh knowledge prompt inserted at the beginning
  return [refreshKnowledgeMessage, ...normalizedMessages];
};

export function LLMChat({ isVisible, onClose, onResize, currentChatId, onSelectChat }: LLMChatProps) {
  console.log('LLMChat rendered with currentChatId:', currentChatId);
  // Always use agent mode
  const mode: 'agent' = 'agent';
  
  // Get current prompts settings and generate initial system message
  const getCurrentPromptsSettings = () => {
    try {
      const settings = localStorage.getItem('appSettings');
      if (settings) {
        const parsed = JSON.parse(settings);
        return parsed.prompts || {};
      }
    } catch (error) {
      console.warn('Failed to load prompts settings:', error);
    }
    return {};
  };

  const initialSystemMessage = generateSystemMessage(getCurrentPromptsSettings());
  
  // Update the initial state and types to use ExtendedMessage
  const [messages, setMessages] = useState<ExtendedMessage[]>([initialSystemMessage]);
  const [currentMessageId, setCurrentMessageId] = useState<number>(1); // Track current message ID counter (not used for uuidv4)
  
  // Function to get the next message ID and increment the counter
  // Use ascending numeric IDs for stable persistence
  const getNextMessageId = () => {
    const current = Number((window.highestMessageId as any) || 0);
    const next = Number.isFinite(current) ? current + 1 : 1;
    window.highestMessageId = next;
    console.log(`getNextMessageId: current=${current}, next=${next}`);
    return String(next);
  };
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [width, setWidth] = useState(700);
  const [isResizing, setIsResizing] = useState(false);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [isChatListVisible, setIsChatListVisible] = useState(false);
  const [chatTitle, setChatTitle] = useState<string>('');
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  // Add state for tracking pending code inserts
  const [pendingInserts, setPendingInserts] = useState<{
    filename: string; 
    content: string; 
    startLine?: number; 
    endLine?: number; 
    isLineEdit?: boolean;
  }[]>([]);
  const [autoInsertInProgress, setAutoInsertInProgress] = useState<boolean>(false);
  // Add state to track if insert model has been preloaded
  const [insertModelPreloaded, setInsertModelPreloaded] = useState(false);
  // Add state for auto-insert setting
  const [autoInsertEnabled, setAutoInsertEnabled] = useState(true);
  // Add state to track processed code blocks to avoid duplicates during streaming
  const [processedCodeBlocks, setProcessedCodeBlocks] = useState<Set<string>>(new Set());

  // Add state for tracking attached files
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [showFileSuggestions, setShowFileSuggestions] = useState(false);
  const [fileSuggestions, setFileSuggestions] = useState<{ name: string; path: string }[]>([]);
  const [mentionPosition, setMentionPosition] = useState<{ start: number; end: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suggestionBoxRef = useRef<HTMLDivElement>(null);
  // New state for tracking the width explicitly
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null); // Add textarea ref

  // Add a state variable to track streaming completion
  const [isStreamingComplete, setIsStreamingComplete] = useState(false);
  
  // Add a ref to track current messages during streaming to prevent race conditions
  const currentMessagesRef = useRef<ExtendedMessage[]>([]);
  
  // Restore tool-related state
  const [toolResults, setToolResults] = useState<{[key: string]: any}[]>([]);
  const [isExecutingTool, setIsExecutingTool] = useState(false);
  const [isInToolExecutionChain, setIsInToolExecutionChain] = useState<boolean>(false);
  
  // Add state for tracking collapsed tool results - default to all collapsed
  const [collapsedToolResults, setCollapsedToolResults] = useState<Set<string>>(new Set());
  
  // Function to toggle tool result collapsed state
  const toggleToolResultCollapsed = (messageId: string) => {
    setCollapsedToolResults(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      // Save collapsed state to localStorage for persistence
      localStorage.setItem('collapsedToolResults', JSON.stringify(Array.from(newSet)));
      return newSet;
    });
  };
  
  // Load collapsed state from localStorage on component mount, default to all collapsed
  useEffect(() => {
    const savedCollapsed = localStorage.getItem('collapsedToolResults');
    if (savedCollapsed) {
      try {
        const collapsedArray = JSON.parse(savedCollapsed);
        setCollapsedToolResults(new Set(collapsedArray));
      } catch (error) {
        console.warn('Failed to load collapsed tool results state:', error);
        // Default to all collapsed if loading fails
        setCollapsedToolResults(new Set());
      }
    } else {
      // Default to all collapsed for new users
      setCollapsedToolResults(new Set());
    }
  }, []);
  
  // Add a state variable to track thinking content
  const [thinking, setThinking] = useState<string>('');
  
  // Add timeout refs for proper cleanup during cancellation
  const toolCallTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedToolCallIds = useRef<Set<string>>(new Set());
  
  // Preload the insert model only when needed
  const preloadInsertModel = async () => {
    if (insertModelPreloaded) return; // Only preload once
    
    try {
      console.log("Preloading insert model...");
      // Get model ID without actually loading the model
      await AIFileService.getModelIdForPurpose('insert');
      setInsertModelPreloaded(true);
    } catch (error) {
      console.error("Error preloading insert model:", error);
    }
  };
  
  // Function to initialize system message with codebase context
  const initializeEnhancedSystemMessage = async (): Promise<ExtendedMessage> => {
    try {
      // Try to get codebase context
      const codebaseContext = await CodebaseContextService.getInitialCodebaseContext();
      
      if (codebaseContext) {
        console.log('Initializing chat with codebase context');
        return generateEnhancedSystemMessage(codebaseContext);
      } else {
        console.log('No codebase context available, using default system message');
        return generateSystemMessage(getCurrentPromptsSettings());
      }
    } catch (error) {
      console.warn('Failed to get codebase context:', error);
      return generateSystemMessage(getCurrentPromptsSettings());
    }
  };
  
  // Performance optimized resize implementation
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    
    const startX = e.clientX;
    const startWidth = width;
    let animationFrameId: number | null = null;
    let lastUpdateTime = 0;
    const THROTTLE_MS = 16; // ~60fps

    // Start performance monitoring in development (check if console is available)
    const isDevelopment = typeof console !== 'undefined' && console.log;
    if (isDevelopment) {
      resizePerformanceMonitor.startMonitoring();
    }

    const handleMouseMove = (e: MouseEvent) => {
      const now = performance.now();
      
      // Throttle updates to improve performance
      if (now - lastUpdateTime < THROTTLE_MS) {
        return;
      }
      lastUpdateTime = now;

      // Use requestAnimationFrame for smooth updates
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = requestAnimationFrame(() => {
        // Record frame for performance monitoring
        if (isDevelopment) {
          resizePerformanceMonitor.recordFrame();
        }

        // Calculate how much the mouse has moved
        const dx = startX - e.clientX;
        // Update width directly (adding dx because this is on the right side)
        // Increase max width and add screen size awareness
        const maxWidth = Math.min(Math.max(window.innerWidth * 0.7, 600), 1200); // 70% of screen or max 1200px
        const minWidth = 250; // Slightly smaller minimum
        const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + dx));
        
        // Update locally
        setWidth(newWidth);
        
        // Update container width immediately for smooth visual feedback
        if (containerRef.current) {
          containerRef.current.style.width = `${newWidth}px`;
        }
        
        // Indicate active resize state
        setIsResizing(true);
        
        // Prevent text selection while resizing
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ew-resize';
      });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      
      // Clean up animation frame
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      
      // Stop performance monitoring and log results
      if (isDevelopment) {
        resizePerformanceMonitor.stopMonitoring();
      }
      
      // Reset states
      setIsResizing(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      
      // Debounced final resize update to parent
      setTimeout(() => {
        if (onResize) {
          onResize(width);
        }
      }, 100);
    };
    
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseup', handleMouseUp);
  }, [width, onResize]);
  
  // Optimized ResizeObserver effect
  useEffect(() => {
    if (containerRef.current && onResize) {
      let timeoutId: NodeJS.Timeout | null = null;
      
      const observer = new ResizeObserver((entries) => {
        // Debounce resize observer calls
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          const entry = entries[0];
          if (entry) {
            onResize(entry.contentRect.width);
          }
        }, 50);
      });
      
      observer.observe(containerRef.current);
      return () => {
        observer.disconnect();
        clearTimeout(timeoutId);
      };
    }
  }, [onResize]);

  // Optimized width persistence with debouncing
  useEffect(() => {
    // Load saved width only once on mount
    const savedWidth = localStorage.getItem('chatWidth');
    if (savedWidth) {
      const parsedWidth = parseInt(savedWidth, 10);
      if (parsedWidth >= 250 && parsedWidth <= 1200) {
        setWidth(parsedWidth);
      }
    }
  }, []);

  useEffect(() => {
    // Debounced save width changes to prevent excessive localStorage writes
    const timeoutId = setTimeout(() => {
      localStorage.setItem('chatWidth', width.toString());
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [width]);

  // Add keyboard shortcuts for resize operations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!isVisible) return;
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible]);

  // Generate a title based on the first user message
  const generateChatTitle = async (messages: ExtendedMessage[]): Promise<string> => {
    try {
      const modelId = await AIFileService.getModelIdForPurpose('chat');
      
      // Get model settings from localStorage
      const modelConfigStr = localStorage.getItem('modelConfig');
      const modelConfig = modelConfigStr ? JSON.parse(modelConfigStr) : defaultModelConfigs.chat;

      // Use the prompt from chatConfig
      const prompt = generatePrompts.titleGeneration(messages);

      // Create completion with the conversation
      const result = await lmStudio.createCompletion({
        model: modelId,
        prompt: prompt,
        temperature: modelConfig.temperature || 0.3,
        max_tokens: 20
        // Remove the 'stream: false' property that was causing linter error
      });

      // Extract and clean the generated title
      let title = result.choices[0].text.trim();
      // Remove quotes if present
      if ((title.startsWith('"') && title.endsWith('"')) || (title.startsWith("'") && title.endsWith("'"))) {
        title = title.substring(1, title.length - 1);
      }
      return title || 'New Chat';
    } catch (err) { // Fixed the error variable name
      console.error('Error generating chat title:', err);
      return 'New Chat';
    }
  };

  // Add a save queue to prevent race conditions
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const isSavingRef = useRef<boolean>(false);
  const lastSaveTimeRef = useRef<number>(0);
  const saveThrottleMs = 200; // Reduced to 200ms to allow more frequent saves during tool processing

  // Enhanced saveChat function with queue management and throttling
  const saveChatWithQueue = useCallback(async (chatId: string, messages: ExtendedMessage[], reloadAfterSave = false): Promise<boolean> => {
    // Check if we're already saving
    if (isSavingRef.current) {
      console.log('Save already in progress, skipping...');
      return false;
    }
    
    // Check throttle - don't save too frequently
    const now = Date.now();
    if (now - lastSaveTimeRef.current < saveThrottleMs) {
      console.log(`Save throttled - last save was ${now - lastSaveTimeRef.current}ms ago`);
      return false;
    }
    
    // Wait for any ongoing save to complete
    await saveQueueRef.current;
    
    // Create a new save promise
    saveQueueRef.current = (async () => {
      if (isSavingRef.current) {
        console.log('Save already in progress, queuing...');
        return false;
      }
      
      isSavingRef.current = true;
      lastSaveTimeRef.current = now;
      
      try {
        console.log(`=== SAVE CHAT CALLED ===`);
        console.log(`ChatId: ${chatId}`);
        console.log(`Messages count: ${messages.length}`);
        console.log(`Reload after save: ${reloadAfterSave}`);
        
        // Check if we have meaningful messages to save (not just system message)
        const meaningfulMessages = messages.filter(msg => msg.role !== 'system');
        if (meaningfulMessages.length === 0) {
          console.log('Skipping save - no meaningful messages (only system message)');
          return false;
        }
        
        // Filter out empty assistant messages before saving
        const messagesToSave = messages.filter(msg => {
          if (msg.role === 'assistant' && (!msg.content || msg.content.trim() === '')) {
            console.log(`Filtering out empty assistant message with ID: ${msg.messageId}`);
            return false;
          }
          return true;
        });
        
        console.log(`Meaningful messages to save: ${meaningfulMessages.length}`);
        console.log(`Messages after filtering empty assistants: ${messagesToSave.length}`);
        console.log('Messages to save:', messagesToSave.map(m => ({ role: m.role, content: m.content?.substring(0, 100), messageId: m.messageId })));
        
        // Use the simplified ChatService
        const success = await ChatService.saveChat(chatId, messagesToSave);
        
        if (success) {
          console.log(`Chat ${chatId} saved successfully`);
          
          // Only reload if specifically requested
          if (reloadAfterSave) {
            setTimeout(() => {
              loadChat(chatId, true);
            }, 200);
          }
          return true;
        } else {
          console.error(`Failed to save chat ${chatId}`);
          return false;
        }
      } catch (error) {
        console.error('Error in saveChat function:', error);
        return false;
      } finally {
        isSavingRef.current = false;
      }
    })();
    
    return saveQueueRef.current;
  }, []);

  // Function to save chat (now uses the queued version)
  const saveChat = async (chatId: string, messages: ExtendedMessage[], reloadAfterSave = false) => {
    return await saveChatWithQueue(chatId, messages, reloadAfterSave);
  };

  // Load chat data with cache-busting
  const loadChat = async (chatId: string, forceReload = false) => {
    // Don't load chat if streaming is in progress (unless forced)
    if (isProcessing && !forceReload) {
      console.log(`Skipping chat load - streaming in progress (forceReload: ${forceReload})`);
      return;
    }
    
    try {
      setIsProcessing(true);
      
      console.log(`Loading chat ${chatId} (forceReload: ${forceReload})`);
      
      // Use the simplified ChatService
      const chat = await ChatService.loadChat(chatId);
      
      if (chat) {
        // Update title if available
        if (chat.name && chat.name !== 'New Chat') {
          setChatTitle(chat.name);
        }
        
        // Clean up empty assistant messages when loading
        const cleanedMessages = chat.messages.filter(msg => {
          if (msg.role === 'assistant' && (!msg.content || msg.content.trim() === '')) {
            console.log(`Removing empty assistant message when loading chat: ${msg.messageId}`);
            return false;
          }
          return true;
        });
        
        setMessages(cleanedMessages);
        console.log(`Loaded chat ${chatId} with ${cleanedMessages.length} messages (cleaned from ${chat.messages.length})`);
      } else {
        // Chat not found, create a new one
        console.log(`Chat ${chatId} not found, creating new chat`);
        const systemMsg = generateSystemMessage(getCurrentPromptsSettings());
        setMessages([systemMsg]);
        saveChat(chatId, [systemMsg]);
      }
      
      // Reset editing state
      setEditingMessageIndex(null);
      setInput('');
      setAttachedFiles([]);
      
    } catch (error) {
      console.error('Error loading chat:', error);
      // Initialize with default system message on error
      const systemMsg = generateSystemMessage(getCurrentPromptsSettings());
      setMessages([systemMsg]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Load all chats
  const loadChats = async () => {
    try {
      const loadedChats = await ChatService.listChats();
      setChats(loadedChats);
    } catch (error) {
      console.error('Error loading chats:', error);
      setChats([]);
    }
  };

  // Handle chat selection
  const handleSelectChat = (chatId: string) => {
    onSelectChat(chatId);
  };

  // Handle opening chat file in editor
  const handleOpenChatFile = async (chatId: string) => {
    try {
      console.log(`Opening chat file for chat ID: ${chatId}`);
      
      // Get the chat file path and content from the backend
      const response = await fetch(`http://localhost:23816/get-chat-file-path?chat_id=${chatId}`);
      if (!response.ok) {
        console.error('Failed to get chat file');
        return;
      }
      
      const data = await response.json();
      const { file_path: chatFilePath, content: chatContent, filename } = data;
      
      console.log('Chat file data received:', { chatFilePath, filename, contentLength: chatContent?.length });
      
      if (!chatFilePath || !chatContent) {
        console.error('No chat file data returned');
        return;
      }

      // Create a file ID for the chat file
      const chatFileId = `chat_${chatId}`;
      
      console.log('File system availability:', {
        hasFileSystem: !!(window as any).fileSystem,
        hasItems: !!(window as any).fileSystem?.items
      });
      
      // Add the chat file to the file system and open it in the editor
      if ((window as any).fileSystem && (window as any).fileSystem.items) {
        // Add the chat file to the file system
        ((window as any).fileSystem.items as any)[chatFileId] = {
          id: chatFileId,
          name: filename || `${chatId}.json`,
          type: 'file',
          content: chatContent,
          parentId: 'root',
          path: chatFilePath,
        };
        
        // Open the file in the editor
        if ((window as any).handleFileSelect) {
          (window as any).handleFileSelect(chatFileId);
        } else {
          // Fallback: dispatch a custom event to open the file
          const event = new CustomEvent('openFile', {
            detail: {
              fileId: chatFileId,
              content: chatContent,
              filename: filename || `${chatId}.json`,
              path: chatFilePath
            }
          });
          window.dispatchEvent(event);
        }
      } else {
        // File system not available, use fallback method
        console.log('File system not available, using fallback method to open chat file');
        
        // Dispatch a custom event to open the file
        const event = new CustomEvent('openFile', {
          detail: {
            fileId: chatFileId,
            content: chatContent,
            filename: filename || `${chatId}.json`,
            path: chatFilePath
          }
        });
        window.dispatchEvent(event);
      }
    } catch (error) {
      console.error('Error opening chat file:', error);
    }
  };

  // Function to handle line-specific edits
  const handleLineSpecificEdit = (originalContent: string, newContent: string, startLine: number, endLine: number): string => {
    const lines = originalContent.split('\n');
    const newLines = newContent.split('\n');
    
    // Convert to 0-based indexing for array operations
    const startIndex = startLine - 1;
    // FIXED: For inclusive replacement of lines startLine to endLine,
    // we need endIndex to be endLine (not endLine - 1) because slice is exclusive of end
    const endIndex = endLine;
    
    // Validate line numbers
    if (startIndex < 0 || startIndex >= lines.length || startIndex > endLine - 1) {
      console.warn(`Invalid line range: ${startLine}-${endLine} for file with ${lines.length} lines`);
      return originalContent; // Return original if invalid range
    }
    
    if (endLine < startLine || endLine > lines.length) {
      console.warn(`Invalid line range: ${startLine}-${endLine} for file with ${lines.length} lines`);
      return originalContent; // Return original if invalid range
    }
    
    // Replace the specified lines (inclusive of both startLine and endLine)
    const result = [
      ...lines.slice(0, startIndex),        // Lines before replacement
      ...newLines,                          // New content
      ...lines.slice(endIndex)             // Lines after replacement (fixed: was endIndex + 1)
    ];
    
    console.log(`Line edit: replacing lines ${startLine}-${endLine} (${endIndex - startIndex} lines) with ${newLines.length} new lines`);
    
    return result.join('\n');
  };

  // Process auto-insert for code blocks
  const processAutoInsert = async () => {
    if (pendingInserts.length === 0 || autoInsertInProgress) return;
    
    // Make sure the insert model is preloaded before starting
    if (!insertModelPreloaded) {
      await preloadInsertModel();
    }
    
    setAutoInsertInProgress(true);
    const currentInsert = pendingInserts[0];
    // Declare originalContent at the function scope so it's accessible in the catch blocks
    let originalContent = '';
    
    try {
      // Get directory path for the file
      const directoryPath = currentInsert.filename.substring(0, currentInsert.filename.lastIndexOf('/'));
      
      try {
        // Try to read the file
        const response = await fetch(`http://localhost:23816/read-file?path=${encodeURIComponent(currentInsert.filename)}`);
        if (response.ok) {
          originalContent = await response.text();
        } else {
          // File doesn't exist - handle based on edit type
          if (currentInsert.isLineEdit) {
            console.error(`Cannot perform line edit on non-existent file: ${currentInsert.filename}`);
            setPendingInserts(prev => prev.slice(1));
            setAutoInsertInProgress(false);
            return;
          }
          
          console.log(`File ${currentInsert.filename} doesn't exist, creating directly`);
          
          // If file doesn't exist, check if we need to create directories
          if (directoryPath) {
            // Try to create the directory structure
            const createDirResponse = await fetch(`http://localhost:23816/create-directory`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                parentId: 'root_' + directoryPath.split('/')[0], // Use root as parent for first level
                name: directoryPath.split('/').pop() || ''
              })
            });
            
            if (!createDirResponse.ok) {
              console.log(`Created directory structure: ${directoryPath}`);
            }
          }
          
          // Create the file directly with the cleaned content
          const cleanedContent = stripThinkTags(currentInsert.content);
          FileChangeEventService.emitChange(currentInsert.filename, '', cleanedContent);
          
          // Remove the processed insert from the queue
          setPendingInserts(prev => prev.slice(1));
          setAutoInsertInProgress(false);
          return;
        }
      } catch (error) {
        console.error('Error reading file:', error);
        // For errors, create the file directly (only if not a line edit)
        if (!currentInsert.isLineEdit) {
          const cleanedContent = stripThinkTags(currentInsert.content);
          FileChangeEventService.emitChange(currentInsert.filename, '', cleanedContent);
        }
        setPendingInserts(prev => prev.slice(1));
        setAutoInsertInProgress(false);
        return;
      }

      // Handle line-specific edits differently
      if (currentInsert.isLineEdit && currentInsert.startLine && currentInsert.endLine) {
        console.log(`Performing line-specific edit on ${currentInsert.filename}, lines ${currentInsert.startLine}-${currentInsert.endLine}`);
        
        // Apply line-specific edit directly
        const cleanedContent = stripThinkTags(currentInsert.content);
        const editedContent = handleLineSpecificEdit(originalContent, cleanedContent, currentInsert.startLine, currentInsert.endLine);
        
        // Use the FileChangeEventService to trigger the diff viewer
        FileChangeEventService.emitChange(currentInsert.filename, originalContent, editedContent);
        
        // Remove the processed insert from the queue
        setPendingInserts(prev => prev.slice(1));
        setAutoInsertInProgress(false);
        return;
      }

      // If we reach here, the file exists and we need AI merging (for full file insertions)
      // Get model ID for insert purpose
      const insertModelId = await AIFileService.getModelIdForPurpose('insert');
      
      // Get insert model settings from localStorage
      const insertModelConfigStr = localStorage.getItem('insertModelConfig');
      const insertModelConfig = insertModelConfigStr ? JSON.parse(insertModelConfigStr) : {
        temperature: 0.2,
        maxTokens: null,
      };

      // Create a prompt for the AI to merge the changes
      const mergePrompt = generatePrompts.codeMerging(currentInsert.filename, originalContent, currentInsert.content);

      // Use the chat completions endpoint for merging
      const result = await lmStudio.createChatCompletion({
        model: insertModelId,
        messages: [
          {
            role: 'system',
            content: 'You are a code merging expert. Return only the merged code without any explanations.'
          },
          {
            role: 'user',
            content: mergePrompt
          }
        ],
        temperature: insertModelConfig.temperature || 0.2,
        ...(insertModelConfig.maxTokens && insertModelConfig.maxTokens > 0 ? { max_tokens: insertModelConfig.maxTokens } : {}),
        stream: false
      });

      let mergedContent = result.choices[0].message.content.trim();
      
      // Strip <think> tags from the merged content before showing in diff viewer
      mergedContent = stripThinkTags(mergedContent);

      // Use the FileChangeEventService to trigger the diff viewer
      FileChangeEventService.emitChange(currentInsert.filename, originalContent, mergedContent);
      
      // Remove the processed insert from the queue
      setPendingInserts(prev => prev.slice(1));
    } catch (error) {
      console.error('Error during auto-insert:', error);
      // Fallback to using the chat model if the Insert-Model fails
      try {
        console.log('Falling back to chat model for auto-insertion...');
        
        // Get chat model ID for fallback
        const chatModelId = await AIFileService.getModelIdForPurpose('chat');
        
        // Get chat model settings from localStorage
        const modelConfigStr = localStorage.getItem('modelConfig');
        const modelConfig = modelConfigStr ? JSON.parse(modelConfigStr) : {
          temperature: 0.3,
          maxTokens: null,
          frequencyPenalty: 0,
          presencePenalty: 0,
        };

        // Create a prompt for the AI to merge the changes
        const mergePrompt = generatePrompts.codeMerging(currentInsert.filename, originalContent, currentInsert.content);

        // Use the lmStudio service for merging
        const result = await lmStudio.createChatCompletion({
          model: chatModelId,
          messages: [
            {
              role: 'system',
              content: 'You are a code merging expert. Return only the merged code without any explanations.'
            },
            {
              role: 'user',
              content: mergePrompt
            }
          ],
          temperature: modelConfig.temperature || 0.3,
          ...(modelConfig.maxTokens && modelConfig.maxTokens > 0 ? { max_tokens: modelConfig.maxTokens } : {}),
          stream: false
        });

        let mergedContent = result.choices[0].message.content.trim();
        
        // Strip <think> tags from the merged content before showing in diff viewer
        mergedContent = stripThinkTags(mergedContent);

        // Use the FileChangeEventService to trigger the diff viewer
        FileChangeEventService.emitChange(currentInsert.filename, originalContent, mergedContent);
        
        // Remove the processed insert from the queue
        setPendingInserts(prev => prev.slice(1));
      } catch (fallbackError) {
        console.error('Fallback auto-insertion also failed:', fallbackError);
        // Remove the failed insert and continue with others
        setPendingInserts(prev => prev.slice(1));
      }
    } finally {
      setAutoInsertInProgress(false);
    }
  };

  // Function to detect and process complete code blocks during streaming
  const processStreamingCodeBlocks = (content: string) => {
    // During streaming, we only collect code blocks but don't process them yet
    // This prevents premature insertion while AI is still generating content
    if (!autoInsertEnabled) return;
    
    // Extract code blocks from the current content using the robust function from textUtils
    const codeBlocks = extractCodeBlocks(content);
    
    // Store code blocks for later processing after streaming is complete
    // We'll process them in processFinalCodeBlocks after streaming is fully done
    codeBlocks.forEach(block => {
      const blockType = block.isLineEdit ? 'line-specific edit' : 'full file insertion';
      console.log(`Collecting ${blockType} during streaming: ${block.filename} (will process after streaming completes)`);
      
      // Check if we already have this filename in pending inserts
      const alreadyPending = pendingInserts.some(insert => insert.filename === block.filename);
      
      if (!alreadyPending) {
        // Add to pending inserts with all properties
        setPendingInserts(prev => [
          ...prev,
          { 
            filename: block.filename, 
            content: block.content,
            ...(block.isLineEdit && {
              startLine: block.startLine,
              endLine: block.endLine,
              isLineEdit: block.isLineEdit
            })
          }
        ]);
      } else {
        console.log(`Skipping ${block.filename} - already pending insertion`);
      }
    });
  };

  // Function to process code blocks after streaming is fully complete
  const processFinalCodeBlocks = (content: string) => {
    if (!autoInsertEnabled) return;
    
    console.log('Streaming is fully complete, now processing final code blocks for insertion');
    
    // Extract code blocks from the final content
    const codeBlocks = extractCodeBlocks(content);
    
    // Process code blocks with filename-based duplicate checking to prevent multiple inserts
    codeBlocks.forEach(block => {
      const blockType = block.isLineEdit ? 'line-specific edit' : 'full file insertion';
      console.log(`Processing final ${blockType}: ${block.filename}`);
      
      // Check if we already have this filename in pending inserts
      const alreadyPending = pendingInserts.some(insert => insert.filename === block.filename);
      
      if (!alreadyPending) {
        // Add to pending inserts with all properties
        setPendingInserts(prev => [
          ...prev,
          { 
            filename: block.filename, 
            content: block.content,
            ...(block.isLineEdit && {
              startLine: block.startLine,
              endLine: block.endLine,
              isLineEdit: block.isLineEdit
            })
          }
        ]);
      } else {
        console.log(`Skipping ${block.filename} - already pending insertion`);
      }
    });
  };

  // Auto-accept all pending changes
  const autoAcceptChanges = async () => {
    try {
      // Use the FileChangeEventService to accept all diffs
      await FileChangeEventService.acceptAllDiffs();
    } catch (error) {
      console.error('Error auto-accepting changes:', error);
    }
  };

  // Run auto-insert whenever pendingInserts changes, but only after streaming is complete
  useEffect(() => {
    // Only process auto-insert if streaming is fully complete
    if (pendingInserts.length > 0 && autoInsertEnabled && isStreamingComplete) {
      console.log('Streaming is complete, processing auto-insert for', pendingInserts.length, 'pending inserts');
      const timer = setTimeout(() => {
        processAutoInsert();
      }, 500); // 500ms delay for more responsive insertion
      
      return () => clearTimeout(timer);
    } else if (pendingInserts.length > 0 && autoInsertEnabled && !isStreamingComplete) {
      console.log('Pending inserts available but streaming not complete yet, waiting...');
    }
  }, [pendingInserts, autoInsertInProgress, autoInsertEnabled, isStreamingComplete]);

  // Function to handle file attachment via dialog
  const handleFileAttachment = async () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Function to handle file input change
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      try {
        const file = e.target.files[0];
        const content = await readFileContent(file);
        
        // Add file to attached files
        setAttachedFiles(prev => [...prev, {
          name: file.name,
          path: file.name, // Just using filename as path for uploaded files
          content
        }]);
        
        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } catch (error) {
        console.error('Error reading file:', error);
      }
    }
  };

  // Function to read file content
  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          resolve(e.target.result.toString());
        } else {
          reject(new Error('Failed to read file'));
        }
      };
      reader.onerror = (e) => {
        reject(e);
      };
      reader.readAsText(file);
    });
  };

  // Function to remove an attached file
  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Function to handle input change and check for @ mentions
  const handleInputChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const inputValue = e.target.value;
    setInput(inputValue);
    
    // Auto-resize the textarea based on content
    autoResizeTextarea();
    
    // Check for @ mentions
    const match = /@([^@\s]*)$/.exec(inputValue);
    
    if (match) {
      // If there's a match, show file suggestions
      const currentDir = FileSystemService.getCurrentDirectory();
      if (currentDir) {
        try {
          // Fetch current directory contents
          const result = await FileSystemService.fetchFolderContents(currentDir);
          if (result && result.items) {
            // Filter files based on match
            const files = Object.values(result.items)
              .filter(item => item.type === 'file')
              .filter(item => match[1] === '' || item.name.toLowerCase().includes(match[1].toLowerCase()))
              .map(item => ({ name: item.name, path: item.path }));
            
            setFileSuggestions(files);
            setShowFileSuggestions(files.length > 0);
            setMentionPosition({ start: match.index, end: match.index + match[0].length });
          }
        } catch (error) {
          console.error('Error fetching directory contents:', error);
        }
      }
    } else {
      // Hide suggestions if there's no match
      setShowFileSuggestions(false);
    }
  };

  // Function to select a file suggestion
  const selectFileSuggestion = async (file: { name: string; path: string }) => {
    if (mentionPosition) {
      // Replace the @mention with the file name
      const newInput = input.substring(0, mentionPosition.start) + file.name + input.substring(mentionPosition.end);
      setInput(newInput);
      
      // Hide suggestions
      setShowFileSuggestions(false);
      
      // Read file content
      try {
        // Try to read the file directly using the path
        const content = await FileSystemService.readText(file.path);
        
        if (content) {
          // Add file to attached files
          setAttachedFiles(prev => [...prev, {
            name: file.name,
            path: file.path,
            content
          }]);
        }
      } catch (error) {
        console.error('Error reading file:', error);
      }
    }
  };

  // Handle click outside of suggestion box
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionBoxRef.current && !suggestionBoxRef.current.contains(event.target as Node)) {
        setShowFileSuggestions(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Add state for current working directory
  const [currentWorkingDirectory, setCurrentWorkingDirectory] = useState<string>('');

  // Combine all processing states to determine when input should be disabled/grayed out
  const isAnyProcessing = isProcessing || isExecutingTool || isInToolExecutionChain;

  // Fetch current working directory on component mount
  useEffect(() => {
    const fetchCwd = async () => {
      try {
        const response = await fetch('http://localhost:23816/get-workspace-directory');
        if (response.ok) {
          const data = await response.json();
          setCurrentWorkingDirectory(data.workspace_directory || data.effective_directory || '');
        }
      } catch (error) {
        console.error('Failed to fetch workspace directory:', error);
      }
    };
    
    fetchCwd();
  }, []);

  // System messages for different modes
  const chatSystemMessage = getChatSystemMessage(currentWorkingDirectory);
  const agentSystemMessage = getAgentSystemMessage();

  // Add a shared function to handle both new and edited messages
  const processUserMessage = async (
    content: string, 
    attachments: AttachedFile[] = [], 
    editIndex: number | null = null
  ) => {
    if ((!content.trim() && attachments.length === 0) || isProcessing) return;
    
    // Declare streamingTimeoutId at function scope so it's accessible in finally block
    let streamingTimeoutId: ReturnType<typeof setTimeout> | null = null;
    
    try {
      setIsProcessing(true);
      setIsStreamingComplete(false); // Reset streaming complete state
      
      // Clear any pending inserts from previous streaming sessions
      // This ensures we don't process old code blocks when new streaming starts
      setPendingInserts([]);
      
      // Auto-accept any pending changes before sending new message
      await autoAcceptChanges();
      
      // Create the user message with ID
      const userMessage: ExtendedMessage = {
        messageId: getNextMessageId(),
        role: 'user',
        content,
        attachments: attachments.length > 0 ? [...attachments] : undefined
      };
      
      console.log(`Created user message with ID: ${userMessage.messageId}`);
      
      // Always append user and assistant message for a new turn
      let assistantMessageId = getNextMessageId();
      
      // Create the updated messages array BEFORE calling setMessages
      let updatedMessages: ExtendedMessage[] = [];
      if (editIndex !== null) {
        // Editing an existing message: replace and remove all after, then append new assistant
        updatedMessages = [...messages];
        updatedMessages[editIndex] = userMessage;
        updatedMessages = updatedMessages.slice(0, editIndex + 1);
        updatedMessages.push({ role: 'assistant', content: '', messageId: assistantMessageId });
      } else {
        // New message: append user and assistant
        updatedMessages = [...messages, userMessage, { role: 'assistant', content: '', messageId: assistantMessageId }];
      }
      
      // Now update the state with the messages we just created
      setMessages(updatedMessages);
      
      // Save chat history immediately after updating messages
      if (currentChatId) {
        console.log(`Saving chat with ${updatedMessages.length} messages after user input`);
        console.log('Messages being saved:', updatedMessages.map(m => ({ role: m.role, contentLength: m.content?.length || 0, messageId: m.messageId })));
        console.log('Current chatId for initial save:', currentChatId);
        
        // Ensure the chat exists by saving it immediately
        try {
          await saveChat(currentChatId, updatedMessages, false);
          console.log('Initial chat save completed successfully');
        } catch (error) {
          console.error('Initial chat save failed:', error);
        }
      } else {
        console.warn('No currentChatId available for initial save');
      }
      
      setInput('');
      if (editIndex !== null) {
        setEditingMessageIndex(null);
      }
      setAttachedFiles([]);

      // Create a new AbortController for this request
      abortControllerRef.current = new AbortController();

      // Add timeout to ensure streaming state is reset if operation hangs
      streamingTimeoutId = setTimeout(() => {
        console.warn('Chat streaming timeout - resetting streaming state');
        setIsStreamingComplete(true);
        setIsProcessing(false);
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        console.warn('Chat streaming timed out');
      }, 60000); // 60 second timeout for chat streaming

      // Clear processed code blocks for the new response
      setProcessedCodeBlocks(new Set());

      // Get model configuration based on mode
      const modelConfig = await AIFileService.getModelConfigForPurpose('agent');
      const modelId = modelConfig.modelId;

      // Use the normalizeConversationHistory function to properly handle tool calls
      // Exclude the last message (the empty assistant) for the API
      const messagesForAPI = normalizeConversationHistory(updatedMessages.slice(0, -1));
      
      // Add additional data for agent mode if this is a new message (not an edit)
      if (editIndex === null) {
        // Get the user's workspace directory instead of the program's working directory
        const workspaceDir = await fetch('/get-workspace-directory')
          .then(res => res.json())
          .then(data => data.workspace_path)
          .catch(() => currentWorkingDirectory); // Fallback to current if API fails
          
        const additionalData = {
          current_file: workspaceDir ? { path: workspaceDir } : undefined,
          message_count: updatedMessages.length,
          mode: 'agent'
        };
        messagesForAPI.push({
          role: 'system',
          content: `<additional_data>${JSON.stringify(additionalData)}</additional_data>`
        });
      }
      
      // Add tools configuration if in agent mode
      const apiConfig = {
        model: modelId,
        messages: [
          {
            role: 'system' as const,
            content: agentSystemMessage,
          },
          ...messagesForAPI
        ],
        temperature: modelConfig.temperature || 0.7,
        ...(modelConfig.maxTokens && modelConfig.maxTokens > 0 ? { max_tokens: modelConfig.maxTokens } : {}),
        top_p: modelConfig.topP,
        frequency_penalty: modelConfig.frequencyPenalty,
        presence_penalty: modelConfig.presencePenalty,
        ...({
          tools: [
            {
              type: "function",
              function: {
                name: "read_file",
                description: "Read the contents of a file",
                parameters: {
                  type: "object",
                  properties: {
                    file_path: {
                      type: "string",
                      description: "The path to the file to read"
                    }
                  },
                  required: ["file_path"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "list_directory",
                description: "List the contents of a directory",
                parameters: {
                  type: "object",
                  properties: {
                    directory_path: {
                      type: "string",
                      description: "The path to the directory to list"
                    }
                  },
                  required: ["directory_path"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "web_search",
                description: "Search the web for information",
                parameters: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "The search query"
                    },
                    num_results: {
                      type: "integer",
                      description: "Number of results to return (default: 3)"
                    }
                  },
                  required: ["query"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "run_terminal_cmd",
                description: "Execute a terminal/console command and return the output. IMPORTANT: You MUST provide the 'command' parameter with the actual shell command to execute (e.g., 'ls -la', 'npm run build', 'git status'). This tool runs the command in a shell and returns stdout, stderr, and exit code.",
                parameters: {
                  type: "object",
                  properties: {
                    command: {
                      type: "string",
                      description: "REQUIRED: The actual shell command to execute. Examples: 'ls -la', 'npm install', 'python --version', 'git status'. Do not include shell operators like '&&' unless necessary."
                    },
                    working_directory: {
                      type: "string",
                      description: "Optional: The directory path where the command should be executed. If not provided, uses current working directory."
                    },
                    timeout: {
                      type: "integer",
                      description: "Optional: Maximum seconds to wait for command completion (default: 30). Use higher values for long-running commands."
                    }
                  },
                  required: ["command"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "get_codebase_overview",
                description: "Get a comprehensive overview of the current codebase including languages, file counts, framework info, and project structure",
                parameters: {
                  type: "object",
                  properties: {},
                  additionalProperties: false
                }
              }
            },
            {
              type: "function",
              function: {
                name: "search_codebase",
                description: "Search for code elements (functions, classes, interfaces, components) in the indexed codebase",
                parameters: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "Search query for code element names or signatures"
                    },
                    element_types: {
                      type: "string",
                      description: "Optional comma-separated list of element types to filter by (function, class, interface, component, type)"
                    },
                    limit: {
                      type: "integer",
                      description: "Maximum number of results to return (default: 20)"
                    }
                  },
                  required: ["query"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "get_file_overview",
                description: "Get an overview of a specific file including its language, line count, and code elements",
                parameters: {
                  type: "object",
                  properties: {
                    file_path: {
                      type: "string",
                      description: "Path to the file to get overview for"
                    }
                  },
                  required: ["file_path"]
                }
              }
            }
          ],
          tool_choice: "auto"
        })
      };
      
      // For initial messages in agent mode, we use list_directory as default
      if (editIndex === null) {
        apiConfig.tool_choice = "auto"; // Use a supported string value
      }

      // Debug log
      const isEdit = editIndex !== null;
      const logPrefix = isEdit ? 'Edit - ' : '';
              console.log(`${logPrefix}Mode: agent, Tools included: ${apiConfig.tools ? 'yes' : 'no'}`);
      {
        console.log(`${logPrefix}API Config in agent mode:`, JSON.stringify({
          ...apiConfig,
          messages: '[Messages included]',
          tools: apiConfig.tools ? `[${apiConfig.tools.length} tools included]` : 'No tools',
          tool_choice: apiConfig.tool_choice || 'No tool_choice'
        }, null, 2));
      }

      let currentContent = '';
      // Keep track of the current messages during streaming to avoid race conditions
      // Initialize with the updated messages that include the new user and assistant messages
      currentMessagesRef.current = [...updatedMessages];
      
      // Create a unique session ID for this streaming session to help with debugging
      const streamingSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`=== STREAMING START [${streamingSessionId}] ===`);
      console.log(`Initial currentMessages count: ${currentMessagesRef.current.length}`);
      console.log(`Initial currentMessages roles:`, currentMessagesRef.current.map(m => ({ role: m.role, contentLength: m.content?.length || 0, messageId: m.messageId })));
      console.log(`Initial currentMessages content preview:`, currentMessagesRef.current.map(m => ({ 
        role: m.role, 
        contentPreview: m.content?.substring(0, 50) || 'empty',
        messageId: m.messageId 
      })));
      
      // Log what we're about to pass to the API
      console.log(`${logPrefix}Passing to API:`, {
        ...apiConfig,
        messages: '[Messages included]',
        tools: apiConfig.tools ? `[${apiConfig.tools.length} tools included]` : 'No tools',
        tool_choice: apiConfig.tool_choice || 'No tool_choice'
      });
      
      // Add a debounce timeout reference for tool calls
      let toolCallTimeoutRef: ReturnType<typeof setTimeout> | null = null;
      
      await lmStudio.createStreamingChatCompletion({
        ...apiConfig,
        purpose: 'agent',
        signal: abortControllerRef.current?.signal, // Add abort signal for cancellation
        onUpdate: async (content: string) => {
          currentContent = content;
          console.log(`Streaming update: content length ${content.length}, currentContent now: ${currentContent.length}`);
          setMessages(prev => {
            console.log(`Streaming callback: prev messages count: ${prev.length}`);
            console.log(`Streaming callback: prev message roles:`, prev.map(m => ({ role: m.role, contentLength: m.content?.length || 0, messageId: m.messageId })));
            
            // Always update the last assistant message (not necessarily the last message in the array)
            // Prefer messages with empty content as they are likely the streaming message we just created
            const newMessages = [...prev];
            let lastAssistantMessageIndex = -1;
            let streamingMessageIndex = -1;
            
            console.log(`Looking for assistant messages in ${newMessages.length} messages`);
            for (let i = newMessages.length - 1; i >= 0; i--) {
              const msg = newMessages[i];
              console.log(`Message ${i}: role=${msg.role}, contentLength=${msg.content?.length || 0}, content="${msg.content?.substring(0, 50)}"`);
              
              if (msg.role === 'assistant') {
                if (lastAssistantMessageIndex === -1) {
                  lastAssistantMessageIndex = i;
                  console.log(`Found last assistant message at index ${i}`);
                }
                // Check if this is the streaming message (empty content)
                if (msg.content === '') {
                  streamingMessageIndex = i;
                  console.log(`Found streaming message (empty) at index ${i}`);
                  break; // Prefer the streaming message
                }
              }
            }
            
            console.log(`Assistant message search results: lastAssistantMessageIndex=${lastAssistantMessageIndex}, streamingMessageIndex=${streamingMessageIndex}`);
            
            // Use streaming message if found, otherwise fall back to last assistant message
            const targetIndex = streamingMessageIndex !== -1 ? streamingMessageIndex : lastAssistantMessageIndex;
            
            if (targetIndex !== -1) {
              const targetMessage = newMessages[targetIndex];
              console.log(`Updating assistant message at index ${targetIndex} with messageId ${targetMessage.messageId} (${targetMessage.content === '' ? 'streaming' : 'existing'} message)`);
              
              newMessages[targetIndex] = {
                ...targetMessage,  // Preserve ALL original properties (messageId, etc)
                content: content  // Only update the content
              };
            } else {
              console.warn('No assistant message found to update during streaming');
            }
            
            console.log(`Streaming callback: newMessages count: ${newMessages.length}`);
            console.log(`Streaming callback: newMessages roles:`, newMessages.map(m => ({ role: m.role, contentLength: m.content?.length || 0, messageId: m.messageId })));
            
            // Update our ref to avoid race conditions
            currentMessagesRef.current = newMessages;
            console.log(`Streaming update: currentMessages now has ${currentMessagesRef.current.length} messages`);
            console.log(`Streaming update: currentMessages roles:`, currentMessagesRef.current.map(m => ({ role: m.role, contentLength: m.content?.length || 0, messageId: m.messageId })));
            
            // Verify that the ref is properly updated
            if (currentMessagesRef.current.length !== newMessages.length) {
              console.error(`CRITICAL: Ref update failed! newMessages has ${newMessages.length} but ref has ${currentMessagesRef.current.length}`);
            }
            
            // Save chat during streaming with proper tool_calls format
            if (currentChatId && (!window.lastContentLength || 
                Math.abs(content.length - window.lastContentLength) > 100)) {
              window.lastContentLength = content.length;
              
              // Increment the version to ensure we're not overwritten
              window.chatSaveVersion = (window.chatSaveVersion || 0) + 1;
              const saveVersion = window.chatSaveVersion;
              
              // Don't save during streaming - let the main save at the end handle it
              // This prevents race conditions during streaming
            }
            
            return newMessages;
          });

          // Process code blocks in real-time during streaming
          processStreamingCodeBlocks(content);

          // Process tool calls as needed
          // Debounce tool call processing
          if (toolCallTimeoutRef) clearTimeout(toolCallTimeoutRef);
          toolCallTimeoutRef = setTimeout(() => {
            processToolCalls(content);
            toolCallTimeoutRef = null;
          }, 300);
        }
      });

      // Clear streaming timeout since operation completed
      clearTimeout(streamingTimeoutId);
      
      console.log('Streaming operation completed, currentContent length:', currentContent.length);
      console.log('Final currentContent:', currentContent.substring(0, 200) + '...');
      
      // Ensure we process any final tool calls after streaming is complete
      setIsStreamingComplete(true);
      
      // ALWAYS save the chat once at the end of streaming, regardless of tool calls
      console.log(`=== STREAMING COMPLETION SAVE [${streamingSessionId}] ===`);
      console.log('Streaming completed, ALWAYS saving final message');
      console.log('Final content length:', currentContent.length);
      console.log('Current messages count:', currentMessagesRef.current.length);
      console.log('Current messages roles:', currentMessagesRef.current.map(m => ({ role: m.role, contentLength: m.content?.length || 0, messageId: m.messageId })));
      console.log('Current chatId for saving:', currentChatId);
      console.log('Current messages ref content:', JSON.stringify(currentMessagesRef.current, null, 2));
      
      // Check if we have any empty assistant messages to update
      const emptyAssistantMessages = currentMessagesRef.current.filter(msg => msg.role === 'assistant' && msg.content === '');
      console.log('Empty assistant messages found:', emptyAssistantMessages.length);
      
      if (emptyAssistantMessages.length === 0) {
        console.warn('No empty assistant messages found to update! This might cause the save to fail.');
        console.warn('All messages in ref:', currentMessagesRef.current.map(m => ({ role: m.role, content: m.content?.substring(0, 50) })));
      }
      
      // Create the final messages for saving (but don't update state yet)
      let finalMessagesForSave = currentMessagesRef.current.map(msg => {
        if (msg.role === 'assistant' && msg.content === '') {
          // This is the streaming message, update it with final content
          console.log('Updating streaming message with final content for save');
          return { ...msg, content: currentContent };
        }
        return msg;
      });
      
      // FALLBACK: If no empty assistant message was found, find the last assistant message and update it
      const hasUpdatedMessage = finalMessagesForSave.some(msg => msg.role === 'assistant' && msg.content === currentContent);
      if (!hasUpdatedMessage && currentContent.length > 0) {
        console.warn('No empty assistant message found, using fallback to update last assistant message');
        
        // Find the last assistant message and update it
        for (let i = finalMessagesForSave.length - 1; i >= 0; i--) {
          if (finalMessagesForSave[i].role === 'assistant') {
            console.log(`Fallback: updating assistant message at index ${i} with final content`);
            finalMessagesForSave[i] = { ...finalMessagesForSave[i], content: currentContent };
            break;
          }
        }
      }
      
      console.log('Final messages for save count:', finalMessagesForSave.length);
      console.log('Final messages for save roles:', finalMessagesForSave.map(m => ({ role: m.role, contentLength: m.content?.length || 0 })));
      
      // Save chat with the complete response
      // Only reload if we expect there to be tool calls
      const containsToolCalls = currentContent.includes('function_call:') || 
                               currentContent.includes('<function_calls>');
      console.log('Saving chat with complete AI response (ALWAYS)');
      console.log('Final message content length:', currentContent.length);
      console.log('Final messages count:', finalMessagesForSave.length);
      console.log('Messages being saved:', finalMessagesForSave.map(m => ({ role: m.role, contentLength: m.content?.length || 0, messageId: m.messageId })));
      
      // ALWAYS try to save, even if currentChatId is undefined
      if (currentChatId) {
        console.log(`Attempting to save chat with ID: ${currentChatId}`);
        try {
          await saveChat(currentChatId, finalMessagesForSave, containsToolCalls);
          console.log(`=== SAVE COMPLETED SUCCESSFULLY [${streamingSessionId}] ===`);
        } catch (error) {
          console.error(`=== SAVE FAILED [${streamingSessionId}] ===`, error);
        }
      } else {
        console.warn('No currentChatId available, but still updating state with final messages');
      }
      
      // ALWAYS update the state with final messages, regardless of save success
      setMessages(finalMessagesForSave);
      console.log('State updated with final messages');
      
      // Process tool calls if they exist (but don't affect the save)
      if (currentContent.includes('function_call:')) {
        // Cancel any pending timeout
        if (toolCallTimeoutRef) {
          clearTimeout(toolCallTimeoutRef);
          toolCallTimeoutRef = null;
        }
        setIsInToolExecutionChain(true); 
        await processToolCalls(currentContent);
      } else {
        // No tool calls found, ensure we don't trigger any additional saves
        console.log('No tool calls found in final content, skipping tool processing');
      }

      // Process final code blocks for auto-insert after streaming is fully complete
      processFinalCodeBlocks(currentContent);
      
      // Preload insert model after a short delay
      setTimeout(() => {
        preloadInsertModel();
      }, 3000);
      
    } catch (error) {
      console.error(`Error in ${editIndex !== null ? 'handleSubmitEdit' : 'handleSubmit'}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `I apologize, but I encountered an error processing your request. Please try again.\n\nError: ${errorMessage}`,
          messageId: getNextMessageId()
        }
      ]);
    } finally {
      // Clear streaming timeout in case of error or completion
      clearTimeout(streamingTimeoutId);
      setIsProcessing(false);
    }
  };

  // Simplify handleSubmit to use the shared function
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await processUserMessage(input, attachedFiles);
  };
  
  // Cancel ongoing requests
  const handleCancel = () => {
    console.log('Comprehensive cancellation initiated...');
    
    // 1. Abort any ongoing HTTP requests (streaming chat completions, tool calls)
    if (abortControllerRef.current) {
      console.log('Aborting ongoing AI request...');
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // 2. Clear all timeout operations
    if (toolCallTimeoutRef.current) {
      console.log('Clearing tool call timeout...');
      clearTimeout(toolCallTimeoutRef.current);
      toolCallTimeoutRef.current = null;
    }
    
    if (conversationTimeoutRef.current) {
      console.log('Clearing conversation timeout...');
      clearTimeout(conversationTimeoutRef.current);
      conversationTimeoutRef.current = null;
    }
    
    // 3. Reset all processing states immediately
    setIsProcessing(false);
    setIsExecutingTool(false);
    setIsStreamingComplete(false);
    setIsInToolExecutionChain(false);
    setThinking('');
    
    // 4. Reset tool execution state in ToolService
    try {
      if (ToolService && typeof (ToolService as any).setToolExecutionState === 'function') {
        (ToolService as any).setToolExecutionState(false);
        console.log('Reset ToolService execution state');
      }
    } catch (error) {
      console.warn('Could not reset ToolService state:', error);
    }
    
    // 5. Clear processed tool call IDs to prevent state inconsistencies
    processedToolCallIds.current.clear();
    
    // 6. Clean up any partial messages and add cancellation message
    setMessages(prev => {
      const lastMessage = prev[prev.length - 1];
      
      // If the last message is an empty or very short assistant message, remove it
      if (lastMessage && lastMessage.role === 'assistant' && 
          (!lastMessage.content || lastMessage.content.trim().length < 10)) {
        const messagesWithoutEmpty = prev.slice(0, -1);
        
        // Add a cancellation message
        return [...messagesWithoutEmpty, {
          role: 'assistant',
          content: '**Operation cancelled by user.** I stopped processing and am ready for your next request.',
          messageId: getNextMessageId()
        }];
      }
      
      // If there's substantial content, just add a cancellation note
      if (lastMessage && lastMessage.role === 'assistant') {
        return [...prev, {
          role: 'assistant', 
          content: '**Operation cancelled by user.** I stopped processing and am ready for your next request.',
          messageId: getNextMessageId()
        }];
      }
      
      return prev;
    });
    
    console.log('Comprehensive cancellation completed - all operations stopped');
  };

  // Create a new chat
  const handleNewChat = async () => {
    const newChatId = uuidv4();
    
    // Initialize with enhanced system message that includes codebase context
    const enhancedSystemMessage = await initializeEnhancedSystemMessage();
    setMessages([enhancedSystemMessage]);
    
    setInput('');
    setChatTitle(''); // Reset chat title for new chat
    onSelectChat(newChatId);
    setIsChatListVisible(false);
    
    // Reset content length tracking for the streaming save optimization
    window.lastContentLength = undefined;
  };

  // Close chat list when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isChatListVisible) {
        const target = e.target as HTMLElement;
        if (!target.closest('.chat-switcher')) {
          setIsChatListVisible(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isChatListVisible]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load chat when currentChatId changes
  useEffect(() => {
    console.log('currentChatId changed to:', currentChatId);
    if (currentChatId) {
      loadChat(currentChatId);
    }
  }, [currentChatId]);

  // Debug: log when messages change
  useEffect(() => {
    console.log('Messages state changed:', messages.length, 'messages');
    if (messages.length > 0) {
      console.log('Message roles:', messages.map(m => m.role));
    }
  }, [messages]);

  // Debug: log when currentChatId changes
  useEffect(() => {
    console.log('currentChatId changed to:', currentChatId);
  }, [currentChatId]);

  // Initialize message ID counter
  useEffect(() => {
    if (!window.highestMessageId) {
      // Find the highest message ID from existing messages
      const highestId = messages.reduce((max, msg) => {
        const msgId = Number(msg.messageId || '0');
        return Math.max(max, msgId);
      }, 0);
      window.highestMessageId = highestId;
      console.log(`Initialized highestMessageId to: ${highestId}`);
    }
  }, [messages]);

  // Load chats on component mount
  useEffect(() => {
    loadChats();
  }, []);

  // Load auto-insert setting from editor settings
  useEffect(() => {
    const loadAutoInsertSetting = async () => {
      try {
        const response = await fetch('http://localhost:23816/read-file?path=settings/editor.json');
        if (response.ok) {
          const editorSettings = JSON.parse(await response.text());
          setAutoInsertEnabled(editorSettings.autoInsertCodeBlocks !== false); // Default to true if not set
        }
      } catch (error) {
        console.log('Could not load auto-insert setting, using default (enabled)');
      }
    };
    
    loadAutoInsertSetting();
  }, []);

  // Initialize system message with codebase context on component mount
  useEffect(() => {
    const enhanceInitialSystemMessage = async () => {
      // Only enhance if we have the default system message (no chat loaded yet)
      const currentSystemMessage = generateSystemMessage(getCurrentPromptsSettings());
      if (messages.length === 1 && messages[0].content === currentSystemMessage.content) {
        try {
          const enhancedSystemMessage = await initializeEnhancedSystemMessage();
          if (enhancedSystemMessage.content !== currentSystemMessage.content) {
            console.log('Enhancing initial system message with codebase context');
            setMessages([enhancedSystemMessage]);
          }
        } catch (error) {
          console.warn('Failed to enhance initial system message:', error);
        }
      }
    };

    // Small delay to ensure component is fully mounted
    const timer = setTimeout(enhanceInitialSystemMessage, 100);
    return () => clearTimeout(timer);
  }, []); // Only run once on mount

  // Define the saveBeforeToolExecution function (disabled to prevent infinite loops)
  const saveBeforeToolExecution = useCallback(async () => {
    console.log('Save before tool execution disabled to prevent infinite loops');
    return false;
  }, []);

  // Define the saveAfterToolExecution function (disabled to prevent infinite loops)
  const saveAfterToolExecution = useCallback(async () => {
    console.log('Save after tool execution disabled to prevent infinite loops');
    return false;
  }, []);

  // Expose the saveBeforeToolExecution and saveAfterToolExecution methods to the DOM
  useEffect(() => {
    const chatElement = document.querySelector('[data-chat-container="true"]');
    if (chatElement) {
      (chatElement as any).saveBeforeToolExecution = saveBeforeToolExecution;
      (chatElement as any).saveAfterToolExecution = saveAfterToolExecution;
    }

    return () => {
      // Clean up when component unmounts
      const chatElement = document.querySelector('[data-chat-container="true"]');
      if (chatElement) {
        (chatElement as any).saveBeforeToolExecution = undefined;
        (chatElement as any).saveAfterToolExecution = undefined;
      }
    };
  }, [saveBeforeToolExecution, saveAfterToolExecution]);

  // Listen for save-chat-request events from ToolService (disabled to prevent infinite loops)
  useEffect(() => {
    const handleSaveChatRequest = (e: CustomEvent) => {
      console.log('Save chat request received but disabled to prevent infinite loops');
      // Don't save here - let the auto-save mechanism handle it
    };

    window.addEventListener('save-chat-request', handleSaveChatRequest as EventListener);
    
    return () => {
      window.removeEventListener('save-chat-request', handleSaveChatRequest as EventListener);
    };
  }, []);

  // Add this before the return statement
  const handleEditMessage = (index: number) => {
    const message = messages[index];
    if (message.role === 'user') {
      setEditingMessageIndex(index);
      setInput(message.content);
    }
  };

  const handleCancelEdit = () => {
    setEditingMessageIndex(null);
    setInput('');
  };

  // Function to handle message editing
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingMessageIndex === null) return;
    await processUserMessage(input, attachedFiles, editingMessageIndex);
  };

  // Add styles for the auto-insert spinner animation
  useEffect(() => {
    if (!document.getElementById('auto-insert-styles')) {
      const styleSheet = document.createElement('style');
      styleSheet.id = 'auto-insert-styles';
      styleSheet.textContent = AUTO_INSERT_STYLES;
      document.head.appendChild(styleSheet);

      return () => {
        styleSheet.remove();
      };
    }
  }, []);

  // Add a helper function to process tool calls
  const addMessage = (message: ExtendedMessage) => {
    console.log(`Adding message with role ${message.role}${message.tool_call_id ? ` and tool_call_id ${message.tool_call_id}` : ''}`);
    
    // Ensure the message has all required properties including a messageId
    const formattedMessage: ExtendedMessage = {
      messageId: message.messageId || getNextMessageId(), // Use existing ID or generate a new one
      role: message.role,
      content: message.content || '',
      ...(message.tool_call_id && { tool_call_id: message.tool_call_id }),
      ...(message.tool_calls && message.tool_calls.length > 0 && { tool_calls: message.tool_calls }),
      ...(message.attachments && message.attachments.length > 0 && { attachments: message.attachments })
    };
    
    console.log(`Message assigned ID: ${formattedMessage.messageId}`);
    console.log(`Current messages count: ${messages.length}, will be ${messages.length + 1}`);
    
    setMessages(prev => {
      const updatedMessages = [...prev, formattedMessage];
      console.log(`setMessages callback - prev count: ${prev.length}, new count: ${updatedMessages.length}`);
      
      // Don't save here - let the auto-save mechanism handle it
      // This prevents infinite loops during tool processing
      
      return updatedMessages;
    });
  };

  // Updated handleToolCall function with user prompt reincorporation
  const handleToolCall = async (functionCall: any) => {
    const { name, arguments: args, id: rawId } = functionCall;
    
    try {
      console.log(`Processing tool call: ${name}`, args);
      setIsExecutingTool(true);
      
      // Ensure we have a valid ID
      const toolCallId = (rawId && rawId.length === 9 && /^[a-z0-9]+$/.test(rawId))
        ? rawId
        : generateValidToolCallId();
      
      console.log(`Using tool call ID: ${toolCallId} (validated from ${rawId || 'undefined'})`);
      
      // Parse arguments if they're a string
      let parsedArgs;
      try {
        parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
      } catch (e) {
        console.error('Error parsing arguments:', e);
        parsedArgs = {};
      }
      
      // Backend now handles relative path resolution automatically
      // No need for frontend path manipulation
      
      // Call the ToolService to get real results
      const result = await ToolService.callTool(name, parsedArgs);
      
      // Don't save here - we'll save at the end of tool processing
      // This prevents multiple saves during tool execution
      
      // Check if this is an error from the tool service
      if (result?.success === false || !result) {
        const errorMessage = result?.error || "Unknown error";
        console.warn(`Tool call failed for ${name}:`, errorMessage);
        
        // Instead of returning an error as a tool message, add it as an assistant message
        setMessages(prev => {
          const assistantErrorMessage: ExtendedMessage = {
            role: 'assistant',
            content: `I tried to ${name.replace(/_/g, ' ')} but encountered an error: ${errorMessage}\n\nLet me try to help you with what I know instead.`,
            messageId: getNextMessageId()
          };
          
          const updatedMessages = [...prev, assistantErrorMessage];
          
          // Don't save here - let the auto-save mechanism handle it
          
          return updatedMessages;
        });
        
        // Return null to indicate we handled the error separately
        return null;
      }
      
      // The ToolService returns a complete tool message object
      // We need to use the tool_call_id from the result and ensure proper formatting
      const formattedResult: ExtendedMessage = {
        role: 'tool',
        content: result.content || '',
        tool_call_id: result.tool_call_id || toolCallId,
        messageId: getNextMessageId()
      };
      
      console.log(`Tool call ${name} completed successfully with ID: ${toolCallId}`);
      return formattedResult;
    } catch (error) {
      console.error(`Error in handleToolCall for ${name}:`, error);
      
      // Add an error message to the chat
      setMessages(prev => {
        const errorMessage: ExtendedMessage = {
          role: 'assistant',
          content: `I encountered an error trying to ${name.replace(/_/g, ' ')}: ${(error as Error).message}\n\nLet me try a different approach.`
        };
        
        const updatedMessages = [...prev, errorMessage];
        
        // Save the chat after adding the error message
        if (currentChatId) {
          saveChat(currentChatId, updatedMessages, true);
        }
        
        return updatedMessages;
      });
      
      return null;
    } finally {
      setIsExecutingTool(false);
    }
  };



  // Update the processToolCalls function for proper ID handling
  const processToolCalls = async (content: string): Promise<{ hasToolCalls: boolean }> => {
    // Parse multiple function calls more reliably
    // Split by "function_call:" and process each one
    const functionCallParts = content.split('function_call:');
    let processedAnyCalls = false;
    let hadToolErrors = false; // Track if we had any tool errors
    
    // Skip the first part (before any function_call)
    const functionCallStrings = functionCallParts.slice(1);
    
    // Create a process version to track this specific tool processing operation
    const processVersion = (window.chatSaveVersion || 0) + 1;
    window.chatSaveVersion = processVersion;
    
    console.log(`Processing tool calls (version: ${processVersion}):\n${content.substring(0, 100)}...`);
    
    // Track current execution to prevent multiple concurrent tool chains
    setIsInToolExecutionChain(true);
    
    // Skip this processing if already running a tool call
    if (isExecutingTool) {
      console.log('Tool already executing, skipping this processing round');
      return { hasToolCalls: false };
    }
    
    // Don't save before tool execution - we'll save once at the end
    // This prevents multiple saves during tool processing
    
    try {
      // Create a set to track tool call IDs that have already been processed
      const processedToolCallIds = new Set<string>();
      
      // Get current messages directly from state to ensure we have the latest data
      let currentMessages: ExtendedMessage[] = [];
      setMessages(prev => {
        currentMessages = [...prev];
        return prev;
      });
      
      // Allow state update to complete
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Find tool call IDs that already have responses in the conversation
      currentMessages.forEach(msg => {
        if (msg.role === 'tool' && msg.tool_call_id) {
          processedToolCallIds.add(msg.tool_call_id);
          console.log(`Found existing tool response for ID: ${msg.tool_call_id}`);
        }
      });
      
      // Extract all function calls from the content
      const functionCalls: FunctionCall[] = [];
      
      // Parse all function calls first
      console.log(`Found ${functionCallStrings.length} function call parts to process`);
      
      for (const functionCallPart of functionCallStrings) {
        try {
          console.log(`Processing function call part: "${functionCallPart.substring(0, 100)}..."`);
          
          // Find the JSON object in this part
          const jsonMatch = functionCallPart.match(/^\s*({[\s\S]*?})\s*(?=function_call:|$)/);
          if (!jsonMatch) {
            console.log('No JSON match found in function call part, skipping');
            continue;
          }
          
          const functionCallStr = jsonMatch[1];
          if (!functionCallStr) {
            console.log('Empty function call string, skipping');
            continue;
          }
          
          // Try to parse the function call JSON
          let functionCall: FunctionCall;
          try {
            functionCall = JSON.parse(functionCallStr.trim());
          } catch (error) {
            // If JSON parsing fails, try to extract components manually
            const idMatch = functionCallStr.match(/"id"\s*:\s*"([^"]+)"/);
            const id = idMatch ? idMatch[1] : generateValidToolCallId();
            
            const nameMatch = functionCallStr.match(/"name"\s*:\s*"([^"]+)"/);
            const name = nameMatch ? nameMatch[1] : '';
            
            // Improved argument extraction that handles complex JSON
            let args = '{}';
            const argsStart = functionCallStr.indexOf('"arguments"');
            if (argsStart !== -1) {
              const afterArgs = functionCallStr.substring(argsStart);
              const colonIndex = afterArgs.indexOf(':');
              if (colonIndex !== -1) {
                const afterColon = afterArgs.substring(colonIndex + 1).trim();
                
                if (afterColon.startsWith('{')) {
                  // Find the matching closing brace for complex JSON objects
                  let braceCount = 0;
                  let endIndex = -1;
                  
                  for (let i = 0; i < afterColon.length; i++) {
                    if (afterColon[i] === '{') braceCount++;
                    else if (afterColon[i] === '}') {
                      braceCount--;
                      if (braceCount === 0) {
                        endIndex = i + 1;
                        break;
                      }
                    }
                  }
                  
                  if (endIndex !== -1) {
                    args = afterColon.substring(0, endIndex);
                  }
                } else if (afterColon.startsWith('"')) {
                  // Handle string arguments
                  const quoteEnd = afterColon.indexOf('"', 1);
                  if (quoteEnd !== -1) {
                    args = afterColon.substring(0, quoteEnd + 1);
                  }
                }
              }
            }
            
            // Try to parse the arguments as JSON
            let parsedArgs: any;
            try {
              parsedArgs = JSON.parse(args);
              } catch (e) {
              console.warn('Failed to parse tool arguments as JSON:', args);
              parsedArgs = {};
            }
            
            args = parsedArgs;
            
            // Create the function call object
            functionCall = {
              id: id,
              name: name,
              arguments: args
            };
            
            // Debug logging
            console.log(`Parsed function call: ${functionCall.name}`, {
              id: functionCall.id,
              arguments: functionCall.arguments,
              argumentsType: typeof functionCall.arguments
            });
          }
          
          // Add to function calls array if valid
          if (functionCall.name) {
            // Ensure ID has correct format
            if (!functionCall.id || functionCall.id.length !== 9 || !/^[a-z0-9]+$/.test(functionCall.id)) {
              functionCall.id = generateValidToolCallId();
            }
            
            // Validate tool name (prevent phantom tools)
            const validToolNames = ['list_directory', 'list_dir', 'read_file', 'delete_file', 'move_file', 'copy_file', 'get_file_overview', 'get_codebase_overview', 'grep_search', 'web_search', 'fetch_webpage', 'run_terminal_cmd', 'search_codebase', 'query_codebase_natural_language', 'get_relevant_codebase_context', 'get_ai_codebase_context'];
            
            if (!validToolNames.includes(functionCall.name)) {
              console.warn(`Invalid tool name: ${functionCall.name}. This might be due to multiple tool calls being concatenated.`);
              
              // Check if this looks like concatenated tool names (more comprehensive detection)
              const allValidToolNames = ['list_directory', 'list_dir', 'read_file', 'delete_file', 'move_file', 'copy_file', 'get_file_overview', 'get_codebase_overview', 'grep_search', 'web_search', 'fetch_webpage', 'run_terminal_cmd', 'search_codebase', 'query_codebase_natural_language', 'get_relevant_codebase_context', 'get_ai_codebase_context'];
              
              // Check if the name contains multiple valid tool names (indicating concatenation)
              const detectedTools = allValidToolNames.filter(toolName => 
                functionCall.name.includes(toolName)
              );
              
              if (detectedTools.length > 1) {
                console.warn(`Detected concatenated tool names: ${functionCall.name}. This suggests a parsing issue with multiple tool calls.`);
                console.warn(`Detected individual tools: ${detectedTools.join(', ')}`);
                console.warn(`This function call will be skipped and marked as an error`);
                
                const errorMessage = `Error: Multiple tool calls were concatenated into "${functionCall.name}". Detected tools: ${detectedTools.join(', ')}. Please call tools one at a time.`;
                
                // Add a failed tool call message to inform the AI about the issue
                const failedToolMessage: ExtendedMessage = {
                  role: 'tool',
                  content: errorMessage,
                  tool_call_id: functionCall.id,
                  messageId: getNextMessageId()
                };
                
                // Add the failed tool call to the conversation
                setMessages(prev => [...prev, failedToolMessage]);
                
                // Mark that we processed a tool call (even though it failed)
                processedAnyCalls = true;
                hadToolErrors = true;
                
                // Don't abort the response, just skip this tool call
                console.log(`Skipping concatenated tool call: ${functionCall.name}`);
                continue;
              }
              
              // Find the most similar valid tool name
              const suggestions = validToolNames.filter(validName => 
                validName.includes(functionCall.name) || 
                functionCall.name.includes(validName) ||
                validName.startsWith(functionCall.name) ||
                functionCall.name.startsWith(validName)
              );
              
              const suggestedTool = suggestions.length > 0 ? suggestions[0] : 'read_file';
              
              // Cancel the current response by aborting the controller
              if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
              }
              
              // Add a failed tool call message to inform the AI about the invalid tool name
              const failedToolMessage: ExtendedMessage = {
                role: 'tool',
                content: `Error: Invalid tool name "${functionCall.name}". Did you mean "${suggestedTool}"? Please try again with the correct tool name.`,
                tool_call_id: functionCall.id,
                messageId: getNextMessageId() // Add unique message ID to prevent deduplication
              };
              
              // Add the failed tool call to the conversation
              setMessages(prev => [...prev, failedToolMessage]);
              
              // Don't save here - let the main save at the end handle it
              // This prevents race conditions during tool execution
              
              // Continue the conversation to let the AI retry
              setTimeout(() => {
                continueLLMConversation();
              }, 100);
              
              // Don't return early - let the function continue to the normal continuation logic
            }
            
            // Validate that required arguments are present
            const requiredArgs = {
              'read_file': ['file_path'], // Can also use target_file
              'delete_file': ['file_path'], // Can also use target_file
              'move_file': ['source_path', 'destination_path'],
              'copy_file': ['source_path', 'destination_path'],
              'list_directory': ['directory_path']
            };
            
            const requiredForTool = requiredArgs[functionCall.name as keyof typeof requiredArgs];
            if (requiredForTool) {
              let missingArgs: string[] = [];
              
              // Special handling for file operations that can use either file_path or target_file
              if (['read_file', 'delete_file'].includes(functionCall.name)) {
                const hasFilePath = functionCall.arguments && 
                  typeof functionCall.arguments === 'object' && 
                  (functionCall.arguments.file_path || functionCall.arguments.target_file);
                
                if (!hasFilePath) {
                  missingArgs = ['file_path or target_file'];
                }
              } else {
                // Standard validation for other tools
                missingArgs = requiredForTool.filter(arg => 
                  !functionCall.arguments || 
                  typeof functionCall.arguments === 'string' || 
                  !functionCall.arguments[arg]
                );
              }
              
              if (missingArgs.length > 0) {
                console.warn(`Missing required arguments for ${functionCall.name}: ${missingArgs.join(', ')}. Cancelling response and retrying.`);
                
                // Cancel the current response by aborting the controller
                if (abortControllerRef.current) {
                  abortControllerRef.current.abort();
                  abortControllerRef.current = null;
                }
                
                // Add a failed tool call message
                const failedToolMessage: ExtendedMessage = {
                  role: 'tool',
                  content: `Error: Missing required arguments for ${functionCall.name}: ${missingArgs.join(', ')}. Please provide all required parameters.`,
                  tool_call_id: functionCall.id,
                  messageId: getNextMessageId() // Add unique message ID to prevent deduplication
                };
                
                // Add the failed tool call to the conversation
                setMessages(prev => [...prev, failedToolMessage]);
                
                // Don't save here - let the main save at the end handle it
                // This prevents race conditions during tool execution
                
                // Mark that we processed a tool call (even though it failed)
                processedAnyCalls = true;
                hadToolErrors = true;
                
                // Continue the conversation to let the AI retry
                setTimeout(() => {
                  continueLLMConversation();
                }, 100);
                
                // Don't return early - let the function continue to the normal continuation logic
              }
            }
            
            // Only add if this is a new function call
            if (!processedToolCallIds.has(functionCall.id)) {
              functionCalls.push(functionCall);
              console.log(`Added function call to processing queue: ${functionCall.name} (ID: ${functionCall.id})`);
            } else {
              console.log(`Skipping already processed function call: ${functionCall.name} (ID: ${functionCall.id})`);
            }
          } else {
            console.warn('Function call has no name, skipping:', functionCall);
          }
        } catch (error) {
          console.error("Error parsing function call:", error);
        }
      }
      
      // Debug summary of what we found
      console.log(`Function call parsing summary:`);
      console.log(`- Total function call parts found: ${functionCallStrings.length}`);
      console.log(`- Valid function calls parsed: ${functionCalls.length}`);
      console.log(`- Had tool errors: ${hadToolErrors}`);
      console.log(`- Processed any calls: ${processedAnyCalls}`);
      
      // Update the assistant message with proper tool_calls first
      if (functionCalls.length > 0) {
        console.log(`Updating assistant message with ${functionCalls.length} tool calls (version: ${processVersion})`);
        
        // Extract thinking content if present
        let thinkingContent = '';
        const lastMsg = currentMessages[currentMessages.length - 1];
        
        if (lastMsg && lastMsg.role === 'assistant' && typeof lastMsg.content === 'string') {
          // Check for <think> blocks in the content
          const thinkMatch = /<think>([\s\S]*?)<\/think>/g.exec(lastMsg.content);
          if (thinkMatch && thinkMatch[1]) {
            thinkingContent = thinkMatch[0];
            console.log('Extracted thinking content to preserve:', thinkingContent.substring(0, 50) + '...');
          }
          
          // Also check for content before the function_call
          if (!thinkingContent) {
            const contentBeforeFunctionCall = content.split('function_call:')[0].trim();
            if (contentBeforeFunctionCall && contentBeforeFunctionCall.length > 0) {
              // Clean up any potential HTML tags or 'thinking...' messages
              const cleanedThinking = contentBeforeFunctionCall
                .replace(/^Thinking\.\.\./i, '')
                .replace(/^I'm thinking about this\.\.\./i, '')
                .trim();
                
              if (cleanedThinking) {
                thinkingContent = cleanedThinking;
                console.log('Extracted content before function_call:', thinkingContent.substring(0, 50) + '...');
              }
            }
          }
        }
        
        // Update messages with all function calls at once
        setMessages(prev => {
          const newMessages = [...prev];
          const lastAssistantIndex = prev.length - 1;
          
          if (lastAssistantIndex >= 0 && newMessages[lastAssistantIndex].role === 'assistant') {
            // Create the updated assistant message for the tool call
            let updatedAssistantMessage: ExtendedMessage = {
              role: 'assistant' as const,
              content: '', // Clear content since it's a tool call
              tool_calls: functionCalls.map(fc => ({
                id: fc.id,
                type: 'function' as const,
                function: {
                  name: fc.name,
                  arguments: typeof fc.arguments === 'string' ? fc.arguments : JSON.stringify(fc.arguments)
                }
              }))
            };
            
            // If we extracted thinking content, create a separate message for it
            if (thinkingContent) {
              // Create a separate assistant message with proper think tags
              const thinkingMessage: ExtendedMessage = {
                role: 'assistant' as const,
                content: `${thinkingContent}`
              };
              
              // Replace the current message with thinking content, preserving original properties
              const originalMessage = newMessages[lastAssistantIndex];
              newMessages[lastAssistantIndex] = {
                ...originalMessage,  // Preserve all original properties (especially messageId)
                content: thinkingMessage.content
              };
              
              // Add the tool call as a new message
              newMessages.push(updatedAssistantMessage);
            } else {
              // No thinking content, just update with tool calls, preserving original properties
              const originalMessage = newMessages[lastAssistantIndex];
              newMessages[lastAssistantIndex] = {
                ...originalMessage,  // Preserve all original properties (especially messageId)
                content: updatedAssistantMessage.content,
                tool_calls: updatedAssistantMessage.tool_calls
              };
            }
            
            // Don't save here - let the main save at the end handle it
            // This prevents race conditions during tool execution
          }
          
          return newMessages;
        });
        
        // Wait for state to update
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Process each tool call sequentially (can be changed to parallel if needed)
      const processSequentially = true; // Set to false to process in parallel
      
      if (processSequentially) {
        // Process tools one by one
        for (const functionCall of functionCalls) {
          try {
            // Skip if already processed
            if (processedToolCallIds.has(functionCall.id)) {
              console.log(`Skipping duplicate tool call: ${functionCall.name} (ID: ${functionCall.id})`);
              continue;
            }
          
          // Add to processed set
          processedToolCallIds.add(functionCall.id);
          
          // Set executing flag
          setIsExecutingTool(true);
          console.log(`Executing tool: ${functionCall.name} (ID: ${functionCall.id})`);
          
          // Execute the tool call
            const result = await handleToolCall(functionCall);
            
          // If result is null, error was already handled
            if (result) {
              processedAnyCalls = true;
              
              // Check if this is a "File not found" error for get_file_overview
              if (functionCall.name === 'get_file_overview' && 
                  typeof result.content === 'string' && 
                  result.content.includes('File not found in index')) {
                console.log('get_file_overview returned "File not found" - this is normal for non-existent files');
                // Enhance the error message to provide guidance
                result.content = result.content.replace(
                  'File not found in index',
                  'File not found in index. This is normal for files that haven\'t been created yet. You can proceed to create the file using code blocks.'
                );
              }
              
              // Add the tool result to messages
              setMessages(prev => {
                // Use the formatted result directly since it's already a proper tool message
                const toolMessage: ExtendedMessage = result;
                
                console.log(`Creating tool message with content: "${toolMessage.content}" (length: ${toolMessage.content.length})`);
                console.log(`Tool result object:`, result);
                
                const updatedMessages = [...prev, toolMessage];
                
                // Don't save here - let the main save at the end handle it
                // This prevents race conditions during tool execution
                
                return updatedMessages;
              });
              
            console.log(`Added tool result for ${functionCall.name} (ID: ${functionCall.id})`);
              
            // Wait for state to update
            await new Promise(resolve => setTimeout(resolve, 150));
            } else {
            // Error was already handled
              processedAnyCalls = true;
          }
        } catch (error) {
          console.error(`Error executing tool ${functionCall.name}:`, error);
        } finally {
          // Reset executing flag
          setIsExecutingTool(false);
        }
      }
      
      } else {
        // Process tools in parallel (experimental)
        console.log(`Processing ${functionCalls.length} tools in parallel`);
        
        const toolPromises = functionCalls.map(async (functionCall) => {
          try {
            // Skip if already processed
            if (processedToolCallIds.has(functionCall.id)) {
              console.log(`Skipping duplicate tool call: ${functionCall.name} (ID: ${functionCall.id})`);
              return null;
            }
            
            // Add to processed set
            processedToolCallIds.add(functionCall.id);
            
            console.log(`Executing tool in parallel: ${functionCall.name} (ID: ${functionCall.id})`);
            
            // Execute the tool call
            const result = await handleToolCall(functionCall);
            
            if (result) {
              // Add the tool result to messages
              setMessages(prev => {
                const toolMessage: ExtendedMessage = result;
                const updatedMessages = [...prev, toolMessage];
                
                // Save immediately after adding tool result to prevent loss during reloads
                if (currentChatId) {
                  setTimeout(() => {
                    console.log(`Saving chat immediately after parallel tool result: ${functionCall.name}`);
                    saveChat(currentChatId, updatedMessages, false);
                  }, 50);
                }
                
                return updatedMessages;
              });
              
              console.log(`Added parallel tool result for ${functionCall.name} (ID: ${functionCall.id})`);
              return result;
            }
          } catch (error) {
            console.error(`Error executing parallel tool ${functionCall.name}:`, error);
          }
        });
        
        // Wait for all tools to complete
        const results = await Promise.all(toolPromises);
        const successfulResults = results.filter(r => r !== null);
        
        if (successfulResults.length > 0) {
          processedAnyCalls = true;
        }
      }
    } finally {
      // No need to save here since we're saving after each tool call
      console.log('Tool processing completed - saves were done after each tool call');
      
      // Continue the conversation if we processed any tool calls (including errors)
      if (processedAnyCalls) {
        console.log(`Tool calls processed (${hadToolErrors ? 'with errors' : 'successfully'}), continuing conversation...`);
        
        // Continue conversation with slight delay
        setTimeout(() => {
          continueLLMConversation();
        }, 300);
      } else if (hadToolErrors) {
        // Even if no valid tool calls were processed, if we had errors, we should continue
        console.log("No valid tool calls processed, but had tool errors - continuing conversation anyway");
        setTimeout(() => {
          continueLLMConversation();
        }, 300);
      } else {
        console.log("No tool calls processed and no errors");
        setIsInToolExecutionChain(false);
      }
    }
    
    return { hasToolCalls: processedAnyCalls };
  };
  
  // Add a continuation method to the LLM conversation
  const continueLLMConversation = async () => {
    console.log("Continuing conversation. Tool execution chain:", isInToolExecutionChain);
    
    try {
      setIsProcessing(true);
      
      // Create a continuation version to track this specific continuation
      const continuationVersion = (window.chatSaveVersion || 0) + 1;
      window.chatSaveVersion = continuationVersion;
      
      console.log(`Starting to process conversation continuation (version: ${continuationVersion})`);
      
      // Don't reload chat from disk during continuation as it might overwrite recent error messages
      // Instead, use the current state which should have the latest messages including any error messages
      console.log(`Continuing conversation with current state (version: ${continuationVersion})`);
      
      // Get a fresh copy of the messages from state to ensure we have the latest data
      let relevantMessages: ExtendedMessage[] = [];
      setMessages(prev => {
        relevantMessages = [...prev];
        return prev;
      });
      
      // Allow state update to complete
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Debug: Log all messages before filtering
      console.log('=== MESSAGES BEFORE FILTERING ===');
      relevantMessages.forEach((msg, idx) => {
        if (msg.role === 'tool') {
          console.log(`Tool message ${idx}: ID=${msg.tool_call_id}, content=${typeof msg.content === 'string' ? msg.content.substring(0, 50) + '...' : '[object]'}`);
        } else if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
          console.log(`Assistant message ${idx}: has ${msg.tool_calls.length} tool_calls`);
          msg.tool_calls.forEach(tc => console.log(`  Tool call: ${tc.function?.name}, ID=${tc.id}`));
        } else {
          console.log(`Message ${idx}: role=${msg.role}, content=${typeof msg.content === 'string' ? msg.content.substring(0, 50) + '...' : '[object]'}`);
        }
      });
      
      // Temporarily disable aggressive filtering to ensure tool responses are passed to backend
      // TODO: Re-enable with better logic once we confirm this fixes the issue
      console.log('WARNING: Tool message filtering disabled to ensure tool responses reach backend');
      const filteredMessages = relevantMessages.filter((msg, index) => {
        // Only filter out completely empty tool messages
        if (msg.role === 'tool' && (!msg.content || msg.content.trim() === '')) {
          console.log(`Filtering out empty tool message with ID: ${msg.tool_call_id || 'unknown'}`);
          return false;
        }
        return true;
      });
      
      // Debug: Log all messages after filtering
      console.log('=== MESSAGES AFTER FILTERING ===');
      filteredMessages.forEach((msg, idx) => {
        if (msg.role === 'tool') {
          console.log(`Tool message ${idx}: ID=${msg.tool_call_id}, content=${typeof msg.content === 'string' ? msg.content.substring(0, 50) + '...' : '[object]'}`);
        } else if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
          console.log(`Assistant message ${idx}: has ${msg.tool_calls.length} tool_calls`);
          msg.tool_calls.forEach(tc => console.log(`  Tool call: ${tc.function?.name}, ID=${tc.id}`));
        } else {
          console.log(`Message ${idx}: role=${msg.role}, content=${typeof msg.content === 'string' ? msg.content.substring(0, 50) + '...' : '[object]'}`);
        }
      });
      
      console.log(`Filtered ${relevantMessages.length} messages to ${filteredMessages.length} messages for context`);
      
      // Use the filtered messages
      relevantMessages = filteredMessages;
      
      // Get the last user message for the continuation prompt
      const lastUserMessage = [...relevantMessages].reverse().find(msg => msg.role === 'user');
      
      // Add the AFTER_TOOL_CALL_PROMPT as the continuation prompt for better tool call handling
      const continuationPrompt: ExtendedMessage = {
        role: AFTER_TOOL_CALL_PROMPT.role,
        content: AFTER_TOOL_CALL_PROMPT.content
      };
      
      // Debug: Log what we're passing to normalizeConversationHistory
      console.log('=== MESSAGES BEING PASSED TO NORMALIZE ===');
      relevantMessages.forEach((msg, idx) => {
        if (msg.role === 'tool') {
          console.log(`Tool message ${idx}: ID=${msg.tool_call_id}, content=${typeof msg.content === 'string' ? msg.content.substring(0, 50) + '...' : '[object]'}`);
        } else if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
          console.log(`Assistant message ${idx}: has ${msg.tool_calls.length} tool_calls`);
          msg.tool_calls.forEach(tc => console.log(`  Tool call: ${tc.function?.name}, ID=${tc.id}`));
        } else {
          console.log(`Message ${idx}: role=${msg.role}, content=${typeof msg.content === 'string' ? msg.content.substring(0, 50) + '...' : '[object]'}`);
        }
      });
      
      // Prepare conversation context that includes everything the model needs
      const normalizedMessages = normalizeConversationHistory(relevantMessages);
      
      // Debug: Log what normalizeConversationHistory returned
      console.log('=== MESSAGES AFTER NORMALIZE ===');
      normalizedMessages.forEach((msg, idx) => {
        if (msg.role === 'tool') {
          console.log(`Tool message ${idx}: ID=${msg.tool_call_id}, content=${typeof msg.content === 'string' ? msg.content.substring(0, 50) + '...' : '[object]'}`);
        } else if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
          console.log(`Assistant message ${idx}: has ${msg.tool_calls.length} tool_calls`);
          msg.tool_calls.forEach(tc => console.log(`  Tool call: ${tc.function?.name}, ID=${tc.id}`));
        } else {
          console.log(`Message ${idx}: role=${msg.role}, content=${typeof msg.content === 'string' ? msg.content.substring(0, 50) + '...' : '[object]'}`);
        }
      });
      
      const conversationContext: Message[] = [
        ...normalizedMessages,
        // Add the continuation prompt at the end
        continuationPrompt
      ];
      
      console.log('Complete conversation context:', conversationContext.map(m => ({ 
        role: m.role, 
        content: m.content?.substring(0, 50),
        tool_call_id: m.tool_call_id || undefined
      })));
      
      // Get model configuration
      const modelConfig = await AIFileService.getModelConfigForPurpose('agent');
      const modelId = modelConfig.modelId;
      
      if (!modelId) {
        throw new Error('No model ID configured for agent purpose');
      }
      
      // Log what we're sending to the model
      console.log('Continuing conversation with complete context. Model:', modelId);
      console.log('Full messages being sent to API:', JSON.stringify(conversationContext.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? 
          (m.content.length > 100 ? m.content.substring(0, 100) + '...' : m.content) : 
          'Non-string content',
        tool_call_id: m.tool_call_id || undefined,
        tool_calls: 'tool_calls' in m ? m.tool_calls?.length || 0 : undefined
      })), null, 2));
      
      // Temporarily disable strict validation to ensure tool responses reach backend
      // TODO: Re-enable with better logic once we confirm this fixes the issue
      console.log('WARNING: Message validation disabled to ensure tool responses reach backend');
      
      // Only validate that tool messages have content
      let hasValidationError = false;
      for (let i = 0; i < conversationContext.length; i++) {
        const msg = conversationContext[i];
        if (msg.role === 'tool') {
          if (!msg.content || msg.content.trim() === '') {
            console.error(`VALIDATION ERROR: Tool message at index ${i} has no content`);
            hasValidationError = true;
          } else {
            console.log(`Tool message at index ${i} validated: has content and tool_call_id=${msg.tool_call_id}`);
          }
        }
      }
      
      if (hasValidationError) {
        console.error('Message validation failed - aborting continuation');
        setIsProcessing(false);
        setIsInToolExecutionChain(false);
        return;
      }
      
      // Format the API config with the full conversation context
      const apiConfig = {
        model: modelId,
        messages: conversationContext,
        temperature: modelConfig.temperature || 0.7,
        ...(modelConfig.maxTokens && modelConfig.maxTokens > 0 ? { max_tokens: modelConfig.maxTokens } : {}),
        top_p: modelConfig.topP,
        frequency_penalty: modelConfig.frequencyPenalty,
        presence_penalty: modelConfig.presencePenalty,
        // Add tools configuration for agent mode
        tools: [
          {
            type: "function",
            function: {
              name: "read_file",
              description: "Read the contents of a file",
              parameters: {
                type: "object",
                properties: {
                  file_path: {
                    type: "string",
                    description: "The path to the file to read"
                  }
                },
                required: ["file_path"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "list_directory",
              description: "List the contents of a directory",
              parameters: {
                type: "object",
                properties: {
                  directory_path: {
                    type: "string",
                    description: "The path to the directory to list"
                  }
                },
                required: ["directory_path"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "web_search",
              description: "Search the web for information",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "The search query"
                  },
                  num_results: {
                    type: "integer",
                    description: "Number of results to return (default: 3)"
                  }
                },
                required: ["query"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "run_terminal_cmd",
              description: "Execute a terminal/console command and return the output",
              parameters: {
                type: "object",
                properties: {
                  command: {
                    type: "string",
                    description: "The command to execute"
                  },
                  working_directory: {
                    type: "string",
                    description: "Optional working directory to run the command in"
                  },
                  timeout: {
                    type: "integer",
                    description: "Maximum time to wait for command completion in seconds (default: 30)"
                  }
                },
                required: ["command"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "get_codebase_overview",
              description: "Get a comprehensive overview of the current codebase including languages, file counts, framework info, and project structure",
              parameters: {
                type: "object",
                properties: {},
                additionalProperties: false
              }
            }
          },
          {
            type: "function",
            function: {
              name: "search_codebase",
              description: "Search for code elements (functions, classes, interfaces, components) in the indexed codebase",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Search query for code element names or signatures"
                  },
                  element_types: {
                    type: "string",
                    description: "Optional comma-separated list of element types to filter by (function, class, interface, component, type)"
                  },
                  limit: {
                    type: "integer",
                    description: "Maximum number of results to return (default: 20)"
                  }
                },
                required: ["query"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "get_file_overview",
              description: "Get an overview of a specific file including its language, line count, and code elements",
              parameters: {
                type: "object",
                properties: {
                  file_path: {
                    type: "string",
                    description: "Path to the file to get overview for"
                  }
                },
                required: ["file_path"]
              }
            }
          }
        ],
        tool_choice: "auto"
      };
      
      // Debug log to check if tools are present
      console.log('Continuation - API Config:', JSON.stringify({
        model: modelConfig.modelId,
        messageCount: apiConfig.messages.length,
        toolsIncluded: apiConfig.tools ? apiConfig.tools.length : 0,
        toolChoice: apiConfig.tool_choice
      }));
      
      console.log("Calling AI with complete context");
      
      // Add timeout mechanism
      const timeoutId = setTimeout(() => {
        console.log("Conversation continuation timed out");
        setIsProcessing(false);
        setIsInToolExecutionChain(false);
        addMessage({
          role: 'assistant',
          content: "I apologize, but I'm having trouble continuing our conversation. (30 second timeout reached)"
        });
      }, 30000); // 30 seconds timeout
      
      // Add the initial empty response message for streaming
      setMessages(prev => {
        const newMessages = [...prev, { 
          role: 'assistant' as const, 
          content: '',
          messageId: getNextMessageId()  // Ensure proper message ID assignment
        }];
        return newMessages;
      });
      
      // Let state update before starting the stream
      await new Promise(resolve => setTimeout(resolve, 50));
      
      let currentContent = '';
      // Add a debounce timeout reference for tool calls
      let toolCallTimeoutRef: ReturnType<typeof setTimeout> | null = null;
      
      // Use streaming API for continuation
        try {
          await lmStudio.createStreamingChatCompletion({
            model: modelId,
            messages: apiConfig.messages as any,
            temperature: modelConfig.temperature || 0.7,
            top_p: modelConfig.topP || 1,
            frequency_penalty: modelConfig.frequencyPenalty || 0,
            presence_penalty: modelConfig.presencePenalty || 0,
            tools: apiConfig.tools,
            tool_choice: apiConfig.tool_choice,
            purpose: 'agent',
            signal: abortControllerRef.current?.signal, // Add abort signal for cancellation
          onUpdate: async (content) => {
            currentContent = content;
            
            // Check for function calls in streaming content
            const hasFunctionCall = content.includes('function_call:');
            let newMessage: ExtendedMessage = {
              role: 'assistant',
              content: content
            };
            
            // If we have a function call, try to extract and properly format it
            if (hasFunctionCall) {
              try {
                // Try multiple patterns to extract function calls
                const functionCallMatch = content.match(/function_call:\s*({[\s\S]*?})(?=function_call:|$)/);
                
                if (functionCallMatch && functionCallMatch[1]) {
                  console.log('Detected function call in streaming response:', functionCallMatch[1].substring(0, 50) + '...');
                  
                  try {
                    // Parse the function call
                    const functionCallJson = functionCallMatch[1].trim();
                    const functionCall = JSON.parse(functionCallJson);
                    
                    // Ensure we have a valid ID and other required fields
                    const toolCall = {
                      id: functionCall.id || generateValidToolCallId(),
                      name: functionCall.name || '',
                      arguments: functionCall.arguments || '{}'
                    };
                    
                    if (toolCall.name) {
                      console.log(`Extracted tool call during streaming: ${toolCall.name} with ID ${toolCall.id}`);
                      
                      // Format as a proper tool call message
                      newMessage = {
                        role: 'assistant',
                        content: '',
                        tool_calls: [{
                          id: toolCall.id || 'unknown',
                          type: 'function',
                          function: {
                            name: toolCall.name || 'unknown',
                            arguments: typeof toolCall.arguments === 'string' 
                              ? toolCall.arguments 
                              : JSON.stringify(toolCall.arguments || {})
                          }
                        }]
                      };
                      
                      console.log('Created properly formatted tool_calls structure for streaming response');
                    }
                  } catch (e) {
                    console.error('Error parsing function call in streaming response:', e);
                    // Continue with regular content if parsing fails
                  }
                }
              } catch (e) {
                console.error('Error processing function call in streaming response:', e);
              }
            }
            
            // Update the messages state with the streaming content
            setMessages(prev => {
              const newMessages = [...prev];
              // Find the last assistant message to update (not necessarily the last message in the array)
              // Prefer messages with empty content as they are likely the streaming message we just created
              let lastAssistantMessageIndex = -1;
              let streamingMessageIndex = -1;
              
              for (let i = newMessages.length - 1; i >= 0; i--) {
                if (newMessages[i].role === 'assistant') {
                  if (lastAssistantMessageIndex === -1) {
                    lastAssistantMessageIndex = i;
                  }
                  // Check if this is the streaming message (empty content)
                  if (newMessages[i].content === '') {
                    streamingMessageIndex = i;
                    break; // Prefer the streaming message
                  }
                }
              }
              
              // Use streaming message if found, otherwise fall back to last assistant message
              const targetIndex = streamingMessageIndex !== -1 ? streamingMessageIndex : lastAssistantMessageIndex;
              
              if (targetIndex !== -1) {
                const targetMessage = newMessages[targetIndex];
                console.log(`Updating assistant message at index ${targetIndex} with messageId ${targetMessage.messageId} (${targetMessage.content === '' ? 'streaming' : 'existing'} message)`);
                
                // SAFE UPDATE: Preserve all original properties, only update specific fields
                newMessages[targetIndex] = {
                  ...targetMessage,  // Preserve ALL original properties (messageId, etc)
                  content: content,  // Use the streaming content directly
                  ...(hasFunctionCall && { tool_calls: [] })  // Add empty tool_calls array if function call detected
                };
              } else {
                console.warn('No assistant message found to update during streaming');
              }
              
              // Save chat during streaming with proper tool_calls format
              if (currentChatId && (!window.lastContentLength || 
                  Math.abs(content.length - window.lastContentLength) > 100)) {
                window.lastContentLength = content.length;
                
                // Increment the version to ensure we're not overwritten
                window.chatSaveVersion = (window.chatSaveVersion || 0) + 1;
                const saveVersion = window.chatSaveVersion;
                
                setTimeout(() => {
                  // Don't save during streaming - let the main save at the end handle it
                  // This prevents race conditions during streaming
                }, 100);
              }
              
              return newMessages;
            });
            
            // In agent mode, debounce the tool call processing
            if (hasFunctionCall) {
              // Clear any existing timeout
              if (toolCallTimeoutRef) {
                clearTimeout(toolCallTimeoutRef);
              }
              
              // Set a new timeout to process tool calls after 300ms of no updates
              toolCallTimeoutRef = setTimeout(() => {
                processToolCalls(content);
                toolCallTimeoutRef = null;
              }, 300);
            }
            }
          });
          
          clearTimeout(timeoutId);
        console.log('Final continuation response:', currentContent);
        
        // Set streaming complete flag
        setIsStreamingComplete(true);
        
        // Save the chat with final content
        // Don't save here - let the main save at the end handle it
        // This prevents race conditions during streaming
        
        // Process any final tool calls after streaming is complete
        if (currentContent.includes('function_call:')) {
          console.log('Processing final tool calls after streaming completion');
          // Cancel any pending timeout
          if (toolCallTimeoutRef) {
            clearTimeout(toolCallTimeoutRef);
            toolCallTimeoutRef = null;
          }
          // Process immediately
          const toolCallResult = await processToolCalls(currentContent);
          
          // If no tool calls were processed, reset tool execution chain and processing state
          if (!toolCallResult.hasToolCalls) {
            console.log('No tool calls found, resetting processing state');
            setIsInToolExecutionChain(false);
            setIsExecutingTool(false);
            setIsProcessing(false);
          }
          // If tool calls were processed, don't set isProcessing to false here
          // as the tool execution will handle the processing state
        } else {
          // No function calls in the response - always reset processing state
          console.log('No function calls detected, resetting all processing states');
          
          // Process final code blocks for auto-insert after streaming is fully complete
          processFinalCodeBlocks(currentContent);
          
          // Preload insert model after a short delay
          setTimeout(() => {
            preloadInsertModel();
          }, 3000);
          
          // Always reset all processing states when there are no function calls
          setIsInToolExecutionChain(false);
          setIsExecutingTool(false);
          setIsProcessing(false);
        }
          
        } catch (error) {
          console.error('Error in AI continuation:', error);
          clearTimeout(timeoutId);
          
        setMessages(prev => {
          const newMessages = [...prev];
          // Find the last assistant message to update with error message
          let lastAssistantMessageIndex = -1;
          for (let i = newMessages.length - 1; i >= 0; i--) {
            if (newMessages[i].role === 'assistant') {
              lastAssistantMessageIndex = i;
              break;
            }
          }
          
          if (lastAssistantMessageIndex !== -1 && 
              (!newMessages[lastAssistantMessageIndex].content || 
               newMessages[lastAssistantMessageIndex].content.length < 5)) {
            // Update the existing assistant message with error content
            newMessages[lastAssistantMessageIndex] = {
              ...newMessages[lastAssistantMessageIndex],
              content: "I apologize, but I encountered an error while trying to continue our conversation.\n\nError: Failed to continue conversation due to processing issues."
            };
          } else {
            // Add a new error message if no suitable assistant message found
            newMessages.push({
              role: 'assistant' as const,
              content: "I apologize, but I encountered an error while trying to continue our conversation.\n\nError: Failed to continue conversation due to processing issues.",
              messageId: getNextMessageId()
            });
          }
          return newMessages;
        });
          
          setIsInToolExecutionChain(false);
          setIsProcessing(false);
        }
      
      // Don't set isProcessing to false here as it's now handled conditionally above
      setThinking('');
    } catch (error) {
      console.error('Error setting up conversation continuation:', error);
      setIsProcessing(false);
      setIsExecutingTool(false);
      setIsInToolExecutionChain(false);
      setThinking('');
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      addMessage({
        role: 'assistant',
        content: `I apologize, but I'm having trouble processing your request. Please try again.\n\nError: ${errorMessage}`
      });
    }
  };

  // Handle continue from error message
  const handleContinueFromError = async (messageIndex: number) => {
    try {
      setIsProcessing(true);
      
      // Find the error message and the last user message before it
      const errorMessageIndex = messageIndex + 1; // +1 because we slice messages from index 1
      const lastUserMessageIndex = errorMessageIndex - 1;
      
      // Get the last user message content
      const lastUserMessage = messages[lastUserMessageIndex];
      if (lastUserMessage && lastUserMessage.role === 'user') {
        // Remove the error message
        setMessages(prev => prev.filter((_, i) => i !== errorMessageIndex));
        
        // Retry the conversation with the last user message
        await processUserMessage(lastUserMessage.content, lastUserMessage.attachments || []);
      }
    } catch (error) {
      console.error('Error continuing from error message:', error);
      setIsProcessing(false);
    }
  };

  // Check if this is an error message
  const isErrorMessage = (content: string): boolean => {
    const errorPatterns = [
      /I apologize, but I encountered an error/,
      /I apologize, but an error occurred/,
      /I'm having trouble processing your request/,
      /encountered an error while trying to continue/,
      /Error processing your request/,
      /Failed to process/,
      /An error occurred/,
      /Operation cancelled by user/,
      /but encountered an error:/
    ];
    
    return errorPatterns.some(pattern => pattern.test(content));
  };

  // Update the message rendering to handle the new message structure
  const renderMessage = (message: ExtendedMessage, index: number) => {
    // Skip system messages
    if (message.role === 'system') return null;
    
    // Check if message has think blocks
    const hasThinkBlocks = message.content.includes('<think>');
    
    // Calculate if this message should be faded
    const shouldBeFaded = editingMessageIndex !== null && index + 1 > editingMessageIndex;
    
    // Check if this is an error message
    const messageContent = typeof message.content === 'string' ? message.content : '';
    const isError = isErrorMessage(messageContent);
    
    // For assistant messages with function calls, process them but clean the content for display
    if (message.role === 'assistant') {
      // Check if message has tool_calls or contains function_call syntax
      const hasToolCalls = (message.tool_calls && message.tool_calls.length > 0) || 
                          (typeof message.content === 'string' && message.content.includes('function_call:'));
      
      if (hasToolCalls) {
        // Extract any code blocks from the message content before hiding it
        const messageContent = typeof message.content === 'string' ? message.content : '';
        const codeBlocks = extractCodeBlocks(messageContent);
        
        // If there are code blocks, render them and hide the function call syntax
        if (codeBlocks.length > 0) {
          // Create a cleaned message without function call syntax but with code blocks
          let cleanedContent = messageContent;
          
          // Remove function_call syntax
          cleanedContent = cleanedContent.replace(/function_call:\s*\{[\s\S]*?\}/g, '');
          cleanedContent = cleanedContent.replace(/<function_calls>[\s\S]*?<\/antml:function_calls>/g, '');
          cleanedContent = cleanedContent.trim();
          
          // If there's still meaningful content after cleaning, show it
          if (cleanedContent) {
            const cleanedMessage = { ...message, content: cleanedContent };
            return (
              <div
                key={message.messageId}
                style={{
                  width: '100%',
                  opacity: shouldBeFaded ? 0.33 : 1,
                  transition: 'opacity 0.2s ease',
                }}
              >
                <MessageRenderer 
                  message={cleanedMessage} 
                  isAnyProcessing={isAnyProcessing}
                  onContinue={handleContinueFromError}
                  messageIndex={index}
                />
              </div>
            );
          }
        }
        
        // If no meaningful content remains after cleaning, hide the message
        return null;
      }
    }
    
    // If it's a thinking message, render it differently
    if (hasThinkBlocks) {
    return (
      <div
        key={message.messageId}
        style={{
          width: '100%',
          opacity: shouldBeFaded ? 0.33 : 1,
          transition: 'opacity 0.2s ease',
        }}
      >
        <MessageRenderer 
          message={message} 
          isAnyProcessing={isAnyProcessing}
          onContinue={handleContinueFromError}
          messageIndex={index}
        />
      </div>
    );
    }
    
    // If editing this message
    if (editingMessageIndex === index + 1) {
      return (
        <div
          key={message.messageId}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            placeholder={editingMessageIndex !== null ? "Edit your message..." : "Type your message... (Use @ to attach files)"}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '4px',
              border: '1px solid var(--border-primary)',
              background: isAnyProcessing ? 'var(--bg-tertiary, #f5f5f5)' : 'var(--bg-primary)',
              color: isAnyProcessing ? 'var(--text-disabled, #888)' : 'var(--text-primary)',
              resize: 'none',
              fontSize: '13px',
              minHeight: '60px',
              maxHeight: '150px',
              overflow: 'auto',
              opacity: isAnyProcessing ? 0.6 : 1,
              cursor: isAnyProcessing ? 'not-allowed' : 'text',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (editingMessageIndex !== null) {
                  handleSubmitEdit(e);
                } else {
                  handleSubmit(e);
                }
              } else if (e.key === 'Escape' && editingMessageIndex !== null) {
                handleCancelEdit();
              } else if (e.key === 'Escape' && showFileSuggestions) {
                setShowFileSuggestions(false);
                e.preventDefault();
              }
            }}
            disabled={isAnyProcessing}
          />
          <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
            <button
              onClick={handleCancelEdit}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid var(--border-primary)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitEdit}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid var(--accent-color)',
                background: 'var(--accent-color)',
                color: 'var(--text-on-accent)',
                cursor: 'pointer',
              }}
            >
              Save
            </button>
            </div>
        </div>
      );
    }
    
    // Handle tool role messages
    if (message.role === 'tool') {
      // Parse tool call content to get details
      let content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      let toolName = "Tool";
      const toolCallId = message.tool_call_id || `tool_${index}`;
      let toolArgs = null;
      let shortContent = '';
      let detailedTitle = '';
      
      try {
        // Check if the content has the new detailed title format
        if (typeof content === 'string') {
          const firstNewlineIndex = content.indexOf('\n');
          if (firstNewlineIndex > 0) {
            // Extract the detailed title and the rest of the content
            detailedTitle = content.substring(0, firstNewlineIndex).trim();
            content = content.substring(firstNewlineIndex + 1).trim();
          }
        }
        
        // Determine tool type and create appropriate label
        if (message.tool_call_id) {
          const toolCall = messages
            .find(m => m.tool_calls?.some(tc => tc.id === message.tool_call_id))
            ?.tool_calls?.find(tc => tc.id === message.tool_call_id);
            
          if (toolCall && toolCall.function?.name) {
            toolName = toolCall.function.name;
            
            // Store the tool arguments
            toolArgs = typeof toolCall.function?.arguments === 'string' 
              ? toolCall.function.arguments 
              : JSON.stringify(toolCall.function?.arguments, null, 2);
              
            // Try to parse the arguments if they're a string
            if (typeof toolCall.function?.arguments === 'string') {
              try {
                toolArgs = JSON.stringify(JSON.parse(toolCall.function.arguments || '{}'), null, 2);
              } catch (e) {
                // Keep original string if not valid JSON
              }
            }
          }
        }
        
        // Fallback: try to extract tool name from content if still unknown
        if (toolName === "Tool") {
          if (typeof message.content === 'string') {
            const toolPatterns = [
              /read_file/i,
              /list_directory/i,
              /web_search/i,
              /get_codebase_overview/i,
              /search_codebase/i,
              /delete_file/i
            ];
            
            for (const pattern of toolPatterns) {
              if (pattern.test(message.content)) {
                toolName = pattern.source.replace(/[^a-zA-Z_]/g, '');
                break;
              }
            }
          }
        }
      
      // Format content for display
      try {
        // Try to clean up the content by removing function call info
        let cleanContent = content;
        const functionCallIndex = content.indexOf('function_call:');
        if (functionCallIndex >= 0) {
          cleanContent = content.substring(0, functionCallIndex).trim();
        }
        
        // If nothing is left, extract useful information from the result
        if (!cleanContent) {
          try {
              // Try to parse the content as JSON
              let resultObj;
              if (typeof content === 'string') {
                resultObj = JSON.parse(content);
              } else {
                resultObj = content;
              }
            
            // Create a simplified preview for collapsed state
            if (typeof resultObj === 'object') {
              if (resultObj.success !== undefined) {
                shortContent = resultObj.success ? 'Operation successful' : 'Operation failed';
              } else if (resultObj.contents) {
                const contentStr = resultObj.contents.toString() || '';
                shortContent = `${contentStr.slice(0, 60)}${contentStr.length > 60 ? '...' : ''}`;
              } else if (Array.isArray(resultObj)) {
                shortContent = `${resultObj.length} items found`;
              } else {
                // Don't show generic text, the dropdown icon is enough
                shortContent = '';
              }
            } else {
              // Don't show generic text, the dropdown icon is enough
              shortContent = '';
            }
          } catch (error) {
            // If not JSON or parsing fails, use the clean content
            shortContent = cleanContent || '';
          }
        } else {
          // Use the cleaned content
          shortContent = cleanContent.split('\n')[0].slice(0, 60) + (cleanContent.length > 60 ? '...' : '');
        }
      } catch (error) {
        // If anything fails, take the first line only
        shortContent = content.split('\n')[0].slice(0, 60) + (content.length > 60 ? '...' : '');
        }
      } catch (e) {
        // Use default if parsing fails
        console.error("Error parsing tool result:", e);
        shortContent = typeof content === 'string' ? 
          content.split('\n')[0].slice(0, 60) + (content.length > 60 ? '...' : '') : 
          'Unknown tool result';
      }
      
      return (
        <div
          key={message.messageId}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            position: 'relative',
            width: '100%',
            opacity: shouldBeFaded ? 0.5 : 1,
            transition: 'opacity 0.2s ease',
          }}
        >
          <div
            className={`message tool`}
            style={{
          padding: '6px 10px', // Slightly tighter for a more minimal look
              borderRadius: '8px',
              border: '1px solid var(--border-secondary)',
              width: '100%', // Add width to prevent overflow
              boxSizing: 'border-box', // Ensure padding is included in width
              //    boxShadow: index > 0 && messages[index-1]?.role === 'assistant' && messages[index-1]?.content?.includes('<think>') ? '0 2px 6px rgba(0, 0, 0, 0.2)' : 'none', // Add shadow for better separation after thinking blocks
            }}
          >
            <div className="tool-header"
                 style={{
                   display: 'flex',
                   justifyContent: 'space-between',
                   alignItems: 'center',
                   cursor: 'pointer',
                   padding: '0', // Removed padding for more compact look
                 }}
                 onClick={() => toggleToolResultCollapsed(message.messageId || `tool_${index}`)}>
              <div className="tool-header-content"
                     style={{
                       display: 'flex',
                       alignItems: 'center',
                       gap: '6px',
                     }}>
                  <span className="tool-icon"
                        style={{
                          display: 'inline-flex',
                          width: '20px',
                          height: '20px',
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}>
                    {toolName && toolName === 'read_file' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>}
                  
                    {toolName && toolName === 'list_directory' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>}
                  
                    {toolName && toolName === 'web_search' && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>}
                  
                    {toolName && !['read_file', 'list_directory', 'web_search'].includes(toolName) && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>}
                </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                    {detailedTitle || (() => {
                      // Try to extract the path from arguments
                      let pathInfo = '';
                      if (toolArgs) {
                        try {
                          // For list_directory, extract directory_path
                          if (toolName === 'list_directory') {
                            const args = typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs;
                            if (args.directory_path) {
                              // Extract just the last part of the path for cleaner display
                              const pathParts = args.directory_path.split(/[/\\]/);
                              const dirName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || args.directory_path;
                              pathInfo = dirName;
                            }
                          }
                          // For read_file, extract file_path
                          else if (toolName === 'read_file') {
                            const args = typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs;
                            if (args.file_path) {
                              // Extract just the filename for cleaner display
                              const pathParts = args.file_path.split(/[/\\]/);
                              const fileName = pathParts[pathParts.length - 1];
                              pathInfo = fileName;
                            }
                          }
                          // For web_search, extract query
                          else if (toolName === 'web_search') {
                            const args = typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs;
                            if (args.query || args.search_term) {
                              pathInfo = args.query || args.search_term;
                            }
                          }
                        } catch (e) {
                          // Ignore parsing errors
                        }
                      }

                      // Generate human-friendly descriptions
                      if (toolName === 'read_file') {
                        return `Read file${pathInfo ? `: ${pathInfo}` : ''}`;
                      } else if (toolName === 'list_directory') {
                        return `Listed directory${pathInfo ? `: ${pathInfo}` : ''}`;
                      } else if (toolName === 'web_search') {
                        return `Searched web${pathInfo ? ` for "${pathInfo}"` : ''}`;
                      } else if (toolName) {
                        // Default for other tool types
                        return toolName.replace(/_/g, ' ') + (shortContent ? `: ${shortContent}` : '');
                      } else {
                        return 'Used tool' + (shortContent ? `: ${shortContent}` : '');
                      }
                    })()}
                  </span>
              </div>
              
              {/* Collapse/Expand toggle button */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                borderRadius: '4px',
              }}>
                {collapsedToolResults.has(message.messageId || `tool_${index}`) ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9,18 15,12 9,6"></polyline>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6,9 12,15 18,9"></polyline>
                  </svg>
                )}
              </div>
            </div>

            {/* Show content when expanded, nothing when collapsed */}
            {!collapsedToolResults.has(message.messageId || `tool_${index}`) && (
              <>
                {/* Show tool arguments and results when expanded */}
                {toolArgs && (
                  <div style={{
                    marginTop: '6px',
                    padding: '6px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'pre-wrap',
                    overflowX: 'auto',
                  }}>
                    <div style={{
                      marginBottom: '4px',
                      fontWeight: 'bold',
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                    }}>Arguments Used:</div>
                    {toolArgs}
                  </div>
                )}
                
                <>
                  <div style={{
                    marginTop: '6px',
                    fontWeight: 'bold',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                  }}>Result:</div>
                  <pre style={{
                    marginTop: '3px',
                    padding: '6px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'pre-wrap',
                    overflowX: 'auto',
                  }}>
                    {content}
                  </pre>
                </>
              </>
            )}
          </div>
        </div>
      );
    }

    // Regular message
    return (
      <div
        key={message.messageId}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: message.role === 'user' ? 'flex-end' : 'flex-start',
            position: 'relative',
            width: '100%',
            opacity: shouldBeFaded ? 0.5 : 1,
            transition: 'opacity 0.2s ease',
            gap: '6px',
          }}
      >
        <div
          className={`message ${message.role}`}
          style={{
              background: message.role === 'user' ? 'var(--bg-primary)' : 'var(--bg-secondary)',
              padding: '10px',
              borderRadius: '10px',
            maxWidth: '100%',
            border: message.role === 'user' ? '1px solid var(--border-primary)' : 'none',
          }}
        >
          {/* Assistant message */}
          {message.role === 'assistant' && (
            <div
              style={{
                backgroundColor: isError ? 'var(--error-bg)' : 'var(--bg-secondary)',
                padding: '10px',
                borderRadius: '10px',
                marginBottom: '8px',
                position: 'relative',
                borderLeft: isError ? '4px solid var(--error-color)' : 'none',
              }}
            >
              <MessageRenderer 
                message={message} 
                isAnyProcessing={isAnyProcessing}
                onContinue={handleContinueFromError}
                messageIndex={index}
              />
              
              {/* Continue button for error messages */}
              {isError && (
                <div
                  style={{
                    marginTop: '8px',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '8px',
                  }}
                >
                  <button
                    onClick={() => handleContinueFromError(index)}
                    disabled={isAnyProcessing}
                    style={{
                      background: 'var(--accent-color)',
                      border: '1px solid var(--accent-color)',
                      color: 'white',
                      cursor: isAnyProcessing ? 'not-allowed' : 'pointer',
                      padding: '4px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                      transition: 'all 0.2s ease',
                      opacity: isAnyProcessing ? 0.6 : 1,
                    }}
                    title={isAnyProcessing ? "Processing..." : "Retry this conversation"}
                    onMouseEnter={(e) => {
                      if (!isAnyProcessing) {
                        e.currentTarget.style.background = 'var(--accent-hover)';
                        e.currentTarget.style.borderColor = 'var(--accent-hover)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isAnyProcessing) {
                        e.currentTarget.style.background = 'var(--accent-color)';
                        e.currentTarget.style.borderColor = 'var(--accent-color)';
                      }
                    }}
                  >
                    {isAnyProcessing ? 'Processing...' : 'Continue'}
                  </button>
                </div>
              )}
            </div>
          )}
          {/* User message */}
          {message.role === 'user' && (
            <LongMessageWrapper message={message}>
              <MessageRenderer 
                message={message} 
                isAnyProcessing={isAnyProcessing}
                onContinue={handleContinueFromError}
                messageIndex={index}
              />
            </LongMessageWrapper>
          )}
        </div>
        {message.role === 'user' && (
          <div
            style={{
              marginTop: '4px',
              display: 'flex',
              justifyContent: 'flex-end',
              paddingRight: '4px',
            }}
            className="edit-button-container"
          >
            <button
              className="edit-button"
              onClick={() => handleEditMessage(index + 1)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                background: 'none',
                border: 'none',
                color: 'var(--text-tertiary)',
                cursor: shouldBeFaded ? 'not-allowed' : 'pointer',
                padding: '2px 4px',
                borderRadius: '3px',
                fontSize: '11px',
                transition: 'all 0.2s ease',
                opacity: shouldBeFaded ? 0.3 : 0.7,
                pointerEvents: shouldBeFaded ? 'none' : 'auto',
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                if (!shouldBeFaded) {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                if (!shouldBeFaded) {
                  e.currentTarget.style.background = 'none';
                  e.currentTarget.style.opacity = '0.7';
                  e.currentTarget.style.color = 'var(--text-tertiary)';
                }
              }}
              title={shouldBeFaded ? "Can't edit while another message is being edited" : "Edit message"}
              disabled={shouldBeFaded}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span>Edit</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  // Add a function to restart the conversation with fresh data
  const restartConversation = async () => {
    if (!currentChatId) return;
    
    console.log("Restarting conversation with fresh data");
    setIsProcessing(true);
    
    try {
      // Force reload the chat from disk when switching chats
      // Remove the conditional that skips loading when messages exist
      await loadChat(currentChatId, true);
      
      // Reset tool execution state
      setIsInToolExecutionChain(false);
      setIsExecutingTool(false);
      
      // Clear any thinking state
      setThinking('');
      
      console.log("Conversation restarted successfully");
    } catch (error) {
      console.error("Error restarting conversation:", error);
    } finally {
      setIsProcessing(false);
    }
  };
  
  // Add an automatic recovery mechanism for stuck tool chains
  useEffect(() => {
    if (isInToolExecutionChain) {
      // Set a timeout to auto-recover from stuck tool chains
      const recoveryTimeout = setTimeout(() => {
        if (isInToolExecutionChain) {
          console.log("Tool execution chain possibly stuck, attempting auto-recovery");
          restartConversation();
        }
      }, 30000); // 30 seconds timeout
      
      return () => clearTimeout(recoveryTimeout);
    }
  }, [isInToolExecutionChain, currentChatId]);
  
  // Also restart when changing chats
  useEffect(() => {
    if (currentChatId) {
      restartConversation();
          }
    }, [currentChatId]);

  // Optimized auto-resize function for textarea
  const autoResizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    // Use requestAnimationFrame for smooth updates
    requestAnimationFrame(() => {
      // Store current values to avoid recalculation
      const currentHeight = parseInt(textarea.style.height) || 60;
      
      // Reset height to auto to get the natural height
      textarea.style.height = 'auto';
      
      // Calculate the new height based on content
      const newHeight = Math.max(60, Math.min(150, textarea.scrollHeight));
      
      // Only update if height actually changed to avoid unnecessary reflows
      if (newHeight !== currentHeight) {
        textarea.style.height = newHeight + 'px';
      }
    });
  }, []);

  // Throttled auto-resize textarea when input changes
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    
    // Debounce the auto-resize to avoid excessive calls during typing
    timeoutId = setTimeout(() => {
      autoResizeTextarea();
    }, 100);
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [input, autoResizeTextarea]);

  // Add debugging for processing states
  useEffect(() => {
    console.log('Processing states changed:', { 
      isProcessing, 
      isExecutingTool, 
      isInToolExecutionChain, 
      isAnyProcessing 
    });
  }, [isProcessing, isExecutingTool, isInToolExecutionChain, isAnyProcessing]);

  // Add cleanup effect to reset streaming state on unmount
  useEffect(() => {
    return () => {
      // Reset streaming state when component unmounts
      setIsStreamingComplete(false);
    };
  }, []);

  // Auto-save with throttling to prevent infinite loops
  useEffect(() => {
    if (currentChatId && messages.length > 1) {
      // Use a debounced save to prevent too frequent saves
      const saveTimer = setTimeout(() => {
        console.log(`Auto-saving chat ${currentChatId} with ${messages.length} messages`);
        saveChat(currentChatId, messages, false);
      }, 2000); // 2 second debounce
      
      return () => clearTimeout(saveTimer);
    }
  }, [messages, currentChatId]);

  // Add global save mechanism
  useEffect(() => {
    // Add global save function to window object
    (window as any).saveCurrentChat = async () => {
      if (currentChatId && messages.length > 1) {
        console.log('Global save triggered');
        return await saveChat(currentChatId, messages, false);
      }
      return false;
    };

    return () => {
      // Clean up global save function
      delete (window as any).saveCurrentChat;
    };
  }, [currentChatId, messages, saveChat]);



  if (!isVisible) return null;

  return (
    <div 
      ref={containerRef}
      className="llm-chat"
      data-chat-container="true"
      style={{ 
        display: isVisible ? 'flex' : 'none',
        flexDirection: 'column',
        position: 'fixed',
        top: '32px', // Account for titlebar height
        right: 0,
        width: `${width}px`,
        height: 'calc(100vh - 54px)', // Subtract titlebar (32px) + statusbar (22px)
        backgroundColor: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-primary)',
        zIndex: 1,
        // Performance optimizations
        contain: 'layout style size',
        willChange: isResizing ? 'none' : 'auto',
        transform: 'translateZ(0)', // Create compositing layer
      }}
    >
      {/* Resize Handle */}
      <div
        className={`chat-resize-handle ${isResizing ? 'resizing' : ''}`}
        onMouseDown={handleResizeStart}
        onDoubleClick={() => {
          const defaultWidth = 700;
          setWidth(defaultWidth);
          if (onResize) onResize(defaultWidth);
        }}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '4px',
          cursor: 'ew-resize',
          zIndex: 10,
        }}
        title={`Drag to resize chat (${width}px) | Double-click to reset | Ctrl+Shift+←/→ to resize | Ctrl+Shift+0 to reset`}
      />
      
      <div style={{ 
        padding: '10px', 
        borderBottom: '1px solid var(--border-primary)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: '35px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span style={{ 
            fontSize: '14px', 
            fontWeight: '400', 
            color: 'var(--text-secondary)'
          }}>
            Agent
          </span>
          <div className="chat-switcher" style={{ marginRight: '16px' }}>
            <button
              onClick={async () => {
                // Reload chats first, then toggle visibility
                await loadChats();
                setIsChatListVisible(!isChatListVisible);
              }}
              className="settings-button"
              title="Switch chats"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            {isChatListVisible && (
              <div
                className="chat-switcher-dropdown"
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '4px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  zIndex: 1000,
                  minWidth: '200px',
                  maxHeight: '400px',
                  overflowY: 'auto',
                }}
              >
                <div
                  style={{
                    padding: '8px',
                    borderBottom: '1px solid var(--border-primary)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Recent Chats</span>
                  <button
                  onClick={handleNewChat}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      padding: '4px 8px',
                    }}
                  >
                    New Chat
                  </button>
                </div>
                {chats.length === 0 ? (
                  <div style={{ padding: '10px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                    No saved chats
                  </div>
                ) : (
                  chats.map(chat => (
                    <button
                      key={chat.id}
                      className="chat-button"
                      onClick={(e) => {
                        // Check if Ctrl or Cmd key is pressed
                        if (e.ctrlKey || e.metaKey) {
                          e.preventDefault();
                          e.stopPropagation();
                          handleOpenChatFile(chat.id);
                        } else {
                          handleSelectChat(chat.id);
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: chat.id === currentChatId ? 'var(--bg-hover)' : 'none',
                        border: 'none',
                        borderBottom: '1px solid var(--border-primary)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: '12px',
                      }}
                      title="Click to open chat • Ctrl+Click to open JSON file"
                    >
                      <div style={{ fontSize: '13px', fontWeight: chat.id === currentChatId ? 'bold' : 'normal' }}>
                        {chat.name}
                      </div>
                      <div style={{ 
                        fontSize: '11px', 
                        color: 'var(--text-secondary)',
                        marginTop: '2px' 
                      }}>
                        {new Date(chat.createdAt).toLocaleString()}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Remove Refresh Knowledge button since it's always included now */}
          <button
            onClick={onClose}
            className="close-button"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={chatContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px', // Changed from 16px to 12px for tighter spacing
          // Performance optimizations for smooth scrolling during resize
          contain: 'layout style',
          willChange: isResizing ? 'none' : 'auto',
          transform: 'translateZ(0)', // Create compositing layer
        }}
      >
        {messages.length <= 1 ? (
          <div className="empty-chat-message" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-secondary)',
            textAlign: 'center',
            padding: '0 20px'
          }}>
            <svg 
              width="48" 
              height="48" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="1.5" 
              style={{ marginBottom: '16px', opacity: 0.7 }}
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Start a new conversation</h3>
            <p style={{ fontSize: '14px', opacity: 0.8, maxWidth: '400px' }}>
              Ask a question, get coding help, or have a chat with your AI assistant.
            </p>
          </div>
        ) : (
          <>
            {messages.slice(1).map((message, index) => (
              <div key={message.messageId || `message-${index}`}>
                {renderMessage(message, index)}
              </div>
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Attached Files Section */}
      {attachedFiles.length > 0 && (
        <div className="attached-files-container">
          <div
            style={{
              fontSize: '12px',
              fontWeight: 'bold',
              marginBottom: '6px',
              color: 'var(--text-secondary)',
            }}
          >
            Attached Files ({attachedFiles.length})
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {attachedFiles.map((file, index) => (
              <div key={index} className="attached-file-item">
                <div className="attached-file-name">
                  <span className="attached-file-icon">📎</span>
                  {file.name}
                </div>
                <button
                  onClick={() => removeAttachedFile(index)}
                  className="remove-file-button"
                  title="Remove file"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={editingMessageIndex !== null ? handleSubmitEdit : handleSubmit}
        style={{
          borderTop: attachedFiles.length > 0 ? 'none' : '1px solid var(--border-primary)',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary)',
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            placeholder={editingMessageIndex !== null ? "Edit your message..." : "Type your message... (Use @ to attach files)"}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '4px',
              border: '1px solid var(--border-primary)',
              background: isAnyProcessing ? 'var(--bg-tertiary, #f5f5f5)' : 'var(--bg-primary)',
              color: isAnyProcessing ? 'var(--text-disabled, #888)' : 'var(--text-primary)',
              resize: 'none',
              fontSize: '13px',
              minHeight: '60px',
              maxHeight: '150px',
              overflow: 'auto',
              opacity: isAnyProcessing ? 0.6 : 1,
              cursor: isAnyProcessing ? 'not-allowed' : 'text',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (editingMessageIndex !== null) {
                  handleSubmitEdit(e);
                } else {
                  handleSubmit(e);
                }
              } else if (e.key === 'Escape' && editingMessageIndex !== null) {
                handleCancelEdit();
              } else if (e.key === 'Escape' && showFileSuggestions) {
                setShowFileSuggestions(false);
                e.preventDefault();
              }
            }}
            disabled={isAnyProcessing}
          />

          {/* File suggestions dropdown */}
          {showFileSuggestions && (
            <div
              ref={suggestionBoxRef}
              className="file-suggestions-dropdown"
            >
              {fileSuggestions.map((file, index) => (
                <div
                  key={index}
                  onClick={() => selectFileSuggestion(file)}
                  className="file-suggestion-item"
                >
                  <span className="file-suggestion-icon">📄</span>
                  {file.name}
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginTop: '8px',
              gap: '8px',
            }}
          >
            {editingMessageIndex !== null && (
              <button
                onClick={handleCancelEdit}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
                type="button"
              >
                Cancel
              </button>
            )}
            
            {/* Add hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />
            
            {/* File attachment button */}
            {!editingMessageIndex && !isAnyProcessing && (
              <button
                onClick={handleFileAttachment}
                type="button"
                className="add-file-button"
                title="Attach file"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            )}
            
            {isAnyProcessing ? (
              <button
                onClick={handleCancel}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-error)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
                type="button"
              >
                Cancel
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() && attachedFiles.length === 0}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-primary)',
                  background: (input.trim() || attachedFiles.length > 0) ? 'var(--accent-color)' : 'var(--bg-secondary)',
                  color: (input.trim() || attachedFiles.length > 0) ? 'white' : 'var(--text-secondary)',
                  cursor: (input.trim() || attachedFiles.length > 0) ? 'pointer' : 'not-allowed',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
              >
                {editingMessageIndex !== null ? 'Update' : 'Send'}
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Auto-insert indicator */}
      {autoInsertEnabled && (
      <AutoInsertIndicator 
        count={pendingInserts.length} 
        isProcessing={autoInsertInProgress} 
      />
      )}
    </div>
  );
}