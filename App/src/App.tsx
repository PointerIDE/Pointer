import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as monaco from 'monaco-editor';
import FileExplorer from './components/FileExplorer';
import Tabs from './components/Tabs';
import Resizable from './components/Resizable';
import { FileSystemItem, FileSystemState, TabInfo } from './types';
import { FileService } from './services/FileService';
import EditorGrid from './components/EditorGrid';
import { initializeLanguageSupport, getLanguageFromFileName } from './utils/languageUtils';
import { LLMChat } from './components/LLMChat';
import './styles/App.css';
import { ChatService, ChatSession } from './services/ChatService';
import { v4 as uuidv4 } from 'uuid';
import Terminal from './components/Terminal';
import { DiffViewer } from './components/DiffViewer';
import LoadingScreen from './components/LoadingScreen';
import { Settings } from './components/Settings';
import ToastContainer from './components/ToastContainer';
import Titlebar from './components/Titlebar';
import GitView from './components/Git/GitView';
import { GitService } from './services/gitService';
import CloneRepositoryModal from './components/CloneRepositoryModal';
import { PathConfig } from './config/paths';
import { isPreviewableFile, getPreviewType } from './utils/previewUtils';
import PreviewPane from './components/PreviewPane';
import ErrorBoundary from './components/ErrorBoundary';

// TODO: Services to be integrated in next phase
// import { ServiceInitializer } from './services/ServiceInitializer';
// import { PerformanceMonitor } from './services/PerformanceMonitor';
// import { WorkspaceManager, Workspace } from './services/WorkspaceManager';
// import { KeyboardShortcutsRegistry } from './services/KeyboardShortcutsRegistry';

// Initialize language support
initializeLanguageSupport();

// Simple debounce implementation to replace lodash
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: number | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait) as any;
  };
}

interface IEditor extends monaco.editor.IStandaloneCodeEditor {}

// Update the top bar styles
const topBarStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '2px 4px',
  borderBottom: '1px solid var(--border-color)',
  background: 'var(--titlebar-bg)',
  gap: '4px',
  height: '28px',
  transition: 'height 0.2s ease',
  overflow: 'hidden',
} as const;

const topBarCollapsedStyle = {
  ...topBarStyle,
  height: '0px',
  padding: '0px 4px',
  border: 'none',
} as const;

const topBarButtonStyle = {
  padding: '2px 6px',
  fontSize: '12px',
  background: 'transparent',
  border: 'none',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  height: '22px',
  borderRadius: '3px',
} as const;

// Add this near the top of App.tsx, after the importsdeclare global {  interface Window {    getCurrentFile: () => { path: string; } | null;    editor?: monaco.editor.IStandaloneCodeEditor;    reloadFileContent?: (fileId: string) => Promise<void>;    fileSystem?: Record<string, FileSystemItem>;    applyCustomTheme?: () => void;    loadSettings?: () => Promise<void>;    loadAllSettings?: () => Promise<void>;    cursorUpdateTimeout?: number;    appSettings?: {      theme?: {        customColors?: {          customFileExtensions?: Record<string, string>;        };      };    };    editorSettings?: {      autoAcceptGhostText: boolean;    };  }}

const App: React.FC = () => {
  const editorRef = useRef<HTMLDivElement>(null);
  const editor = useRef<IEditor | null>(null);
  const currentThemeRef = useRef<{
    name: string;
    editorColors: Record<string, string>;
    tokenColors: Array<any>;
  }>({
    name: 'vs-dark',
    editorColors: {},
    tokenColors: []
  });
  const [fileSystem, setFileSystem] = useState<FileSystemState>(() => {
    const rootId = 'root';
    return {
      items: {
        [rootId]: {
          id: rootId,
          name: 'workspace',
          type: 'directory',
          parentId: null,
          path: '',
        },
        'welcome': {
          id: 'welcome',
          name: 'notes.js',
          type: 'file',
          content: "// Welcome to your new code editor!\n// Start typing here...\n\n// By the way you can't delete or save this file. (future updates (maybe (if i have motivation)))",
          parentId: rootId,
          path: 'notes.js',
        },
      },
      currentFileId: null,
      rootId,
      terminalOpen: false,
    };
  });

  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: 'file' | 'folder' | null;
    parentId: string | null;
    name: string;
  }>({
    isOpen: false,
    type: null,
    parentId: null,
    name: '',
  });

  // Add loading state
  const [isLoading, setIsLoading] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  // Add connection loading state
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionMessage, setConnectionMessage] = useState('');

  // Add backend health status
  const [backendHealthStatus, setBackendHealthStatus] = useState<'healthy' | 'unhealthy' | 'unknown'>('unknown');
  const [backendHealthMessage, setBackendHealthMessage] = useState('Backend health status unknown');
  const [backendHealthLastChecked, setBackendHealthLastChecked] = useState<number | null>(null);

  // Add save status state
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error' | null>(null);

  const [isTopBarCollapsed, setIsTopBarCollapsed] = useState(false);

  // Add state for cursor position
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  
  // Add debounced function to update cursor position on the server
  const updateCursorPositionOnServer = useCallback(
    debounce(async (filePath: string, line: number, column: number) => {
      try {
        // Only update if we have a valid file path
        if (filePath) {
          const response = await fetch('http://localhost:23816/ide-state/update-cursor', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              file_path: filePath,
              line,
              column
            })
          });
          
          if (!response.ok) {
            console.warn('Failed to update cursor position on server');
          }
        }
      } catch (error) {
        console.error('Error updating cursor position:', error);
      }
    }, 500), // Debounce for 500ms to avoid too many requests
    []
  );

  // Add state for grid layout
  const [isGridLayout, setIsGridLayout] = useState(false);

  // Add state for chat visibility
  const [isLLMChatVisible, setIsLLMChatVisible] = useState(true);

  // Add state for chat width
  const [width, setWidth] = useState(() => {
    const savedWidth = localStorage.getItem('chatWidth');
    if (savedWidth) {
      const parsedWidth = parseInt(savedWidth, 10);
      if (parsedWidth >= 250 && parsedWidth <= 1200) {
        return parsedWidth;
      }
    }
    return 700; // Default width to match chat component
  });

  // Preview tab state management
  const [previewTabs, setPreviewTabs] = useState<TabInfo[]>([]);
  const [currentPreviewTabId, setCurrentPreviewTabId] = useState<string | null>(null);

  // Add this inside the App component, near other state declarations
  const [isChatListVisible, setIsChatListVisible] = useState(false);
  const [chats, setChats] = useState<ChatSession[]>([]);

  // Add state for dynamic title format
  const [dynamicTitleFormat, setDynamicTitleFormat] = useState<string | undefined>(undefined);

  // Add this for settings modal
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsData, setSettingsData] = useState<Record<string, any>>({});

  // Multi-workspace support (Improvement 23)
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [showWorkspaceSwitcher, setShowWorkspaceSwitcher] = useState(false);

  // Add this inside the App component
  const loadChats = async () => {
    const loadedChats = await ChatService.listChats();
    setChats(loadedChats);
  };

  // Initialize services on component mount (Improvement 13, 19, 23)
  // TODO: Integrate new services in next phase
  useEffect(() => {
    // PerformanceMonitor.mark('app:initialization');
    
    // // Initialize services
    // ServiceInitializer.initializeAll().catch(error => {
    //   console.error('Service initialization failed:', error);
    // });

    // // Initialize keyboard shortcuts (Improvement 19)
    // KeyboardShortcutsRegistry.initialize();
    
    // // Register custom commands
    // KeyboardShortcutsRegistry.registerCommand(
    //   'editor.action.newFile',
    //   'ctrl+n',
    //   () => console.log('New file'),
    //   'Create new file',
    //   { mac: 'cmd+n' }
    // );

    // KeyboardShortcutsRegistry.registerCommand(
    //   'editor.action.openFile',
    //   'ctrl+o',
    //   () => console.log('Open file'),
    //   'Open file',
    //   { mac: 'cmd+o' }
    // );

    // // Initialize workspace manager (Improvement 23)
    // WorkspaceManager.initialize({ maxWorkspaces: 10, autoSave: true });
    // setWorkspaces(WorkspaceManager.listWorkspaces());

    // // Update workspace list when workspaces change
    // const updateWorkspaceList = () => {
    //   setWorkspaces(WorkspaceManager.listWorkspaces());
    // };

    return () => {
      // PerformanceMonitor.measure('app:initialization');
    };
  }, []);

  // Add this for Discord RPC settings
  const [discordRpcSettings, setDiscordRpcSettings] = useState({
    enabled: true,
    details: "Editing {file} | Line {line}:{column}",
    state: "Workspace: {workspace}",
    largeImageKey: "pointer_logo",
    largeImageText: "Pointer - Code Editor",
    smallImageKey: "code",
    smallImageText: "{languageId} | Line {line}:{column}",
    button1Label: "Website",
    button1Url: "https://pointr.sh",
    button2Label: "Join the Discord 🚀",
    button2Url: "https://discord.gg/vhgc8THmNk"
  });

  // Load settings, including Discord settings
  const loadSettings = async () => {
    try {
      const result = await FileService.readSettingsFiles(PathConfig.getActiveSettingsPath());
      if (result && result.success) {
        setSettingsData(result.settings);
        
        // Apply editor settings if they exist
        if (result.settings.editor && editor.current) {
          // Add a small delay to ensure editor is ready
          setTimeout(() => {
            const editorSettings = result.settings.editor;
            
            // Apply editor settings to Monaco
            editor.current?.updateOptions({
              fontFamily: editorSettings.fontFamily,
              fontSize: editorSettings.fontSize,
              lineHeight: editorSettings.lineHeight,
              tabSize: editorSettings.tabSize,
              insertSpaces: editorSettings.insertSpaces,
              wordWrap: editorSettings.wordWrap ? 'on' : 'off',
              formatOnPaste: editorSettings.formatOnPaste,
              formatOnType: editorSettings.formatOnSave,
            });

            // Pass editor settings to window object for ghost text functionality
            window.editorSettings = {
              autoAcceptGhostText: editorSettings.autoAcceptGhostText
            };
          }, 100);
        }
        
        // Apply theme settings if they exist
        if (result.settings.theme) {
          const themeSettings = result.settings.theme;
          
          // Validate the base theme
          const validBaseThemes = ['vs', 'vs-dark', 'hc-black', 'hc-light'];
          const baseTheme = validBaseThemes.includes(themeSettings.name) 
            ? themeSettings.name as monaco.editor.BuiltinTheme
            : 'vs-dark';
          
          // Process colors to ensure they're in a valid format
          const processedEditorColors: Record<string, string> = {};
          Object.entries(themeSettings.editorColors || {}).forEach(([key, value]) => {
            if (value && typeof value === 'string') {
              // Remove alpha component if present (e.g., #rrggbbaa → #rrggbb)
              const processedValue = value.length > 7 ? value.substring(0, 7) : value;
              processedEditorColors[key] = processedValue;
            }
          });

          // Store the current theme in the ref for persistence
          currentThemeRef.current = {
            name: baseTheme,
            editorColors: processedEditorColors,
            tokenColors: themeSettings.tokenColors || []
          };
          
          // Add a small delay before applying theme
          setTimeout(() => {
            // Create and apply custom Monaco theme
            applyCustomTheme();

            // Apply custom UI colors
            Object.entries(themeSettings.customColors).forEach(([key, value]) => {
              if (value && typeof value === 'string') {
                const cssVarName = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
                document.documentElement.style.setProperty(cssVarName, value);
              }
            });
            
            // Store customFileExtensions for file explorer to access
            if (themeSettings.customColors.customFileExtensions) {
              window.appSettings = window.appSettings || {};
              window.appSettings.theme = window.appSettings.theme || {};
              window.appSettings.theme.customColors = window.appSettings.theme.customColors || {};
              window.appSettings.theme.customColors.customFileExtensions = 
                { ...themeSettings.customColors.customFileExtensions };
            }
          }, 100);
        }

        // Process Discord RPC settings
        if (result.settings.discordRpc) {
          setDiscordRpcSettings(prev => ({
            ...prev,
            ...result.settings.discordRpc
          }));
          
          // Send settings to main process
          if (window.electron && window.electron.discord) {
            window.electron.discord.updateSettings(result.settings.discordRpc);
          }
        }
      } else {
        console.error('Failed to load settings');
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  // Create a function to apply the custom theme
  const applyCustomTheme = () => {
    const { name, editorColors, tokenColors } = currentThemeRef.current;
    
    monaco.editor.defineTheme('custom-theme', {
      base: name as monaco.editor.BuiltinTheme,
      inherit: true,
      rules: tokenColors.map(item => ({
        token: item.token,
        foreground: item.foreground?.replace('#', ''),
        background: item.background?.replace('#', ''),
        fontStyle: item.fontStyle
      })),
      colors: editorColors
    });
    
    // Apply the custom theme
    monaco.editor.setTheme('custom-theme');
    
    // Apply custom UI colors from the current settings
    const themeSettings = window.appSettings?.theme;
    if (themeSettings?.customColors) {
      // Make custom extension colors available to the FileExplorer component
      window.appSettings = window.appSettings || {};
      window.appSettings.theme = window.appSettings.theme || {};
      window.appSettings.theme.customColors = window.appSettings.theme.customColors || {};
      
      // Make a copy of the custom file extensions for the FileExplorer to access
      if (themeSettings.customColors.customFileExtensions) {
        window.appSettings.theme.customColors.customFileExtensions = 
          { ...themeSettings.customColors.customFileExtensions };
      }
      
      // Notify components that the theme has changed
      window.dispatchEvent(new Event('theme-changed'));
    }
  };

  // Expose the custom theme function to the window object for use by other components
  useEffect(() => {
    window.applyCustomTheme = applyCustomTheme;
    
    return () => {
      // Clean up when the component unmounts
      delete window.applyCustomTheme;
    };
  }, []);

  // Load settings immediately on component mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Add a dedicated effect to ensure theme is applied on app start and whenever editor changes
  useEffect(() => {
    // Only apply if editor exists
    if (editor.current) {
      // Use a small timeout to ensure Monaco editor is fully initialized
      const timeoutId = setTimeout(() => {
        applyCustomTheme();
        console.log('Applied theme on startup/editor change');
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [editor.current]);

  // Add this effect to load chats
  useEffect(() => {
    loadChats();
  }, []);

    // Add effect to track cursor position and update the server  useEffect(() => {    if (editor.current) {      const disposable = editor.current.onDidChangeCursorPosition((e) => {        const position = e.position;        setCursorPosition({          line: position.lineNumber,          column: position.column,        });                // Update the server with cursor position        if (fileSystem.currentFileId && fileSystem.items[fileSystem.currentFileId]) {          const currentFile = fileSystem.items[fileSystem.currentFileId];          // Only update for actual files (not welcome screen)          if (currentFile.type === 'file' && currentFile.path) {            try {              // Debounce this operation by using setTimeout              const filePath = currentFile.path;              const line = position.lineNumber;              const column = position.column;                            // Use a simple debounce to avoid too many requests              if (window.cursorUpdateTimeout) {                clearTimeout(window.cursorUpdateTimeout);              }                            window.cursorUpdateTimeout = setTimeout(async () => {                try {                  const response = await fetch('http://localhost:23816/ide-state/update-cursor', {                    method: 'POST',                    headers: {                      'Content-Type': 'application/json',                    },                    body: JSON.stringify({                      file_path: filePath,                      line,                      column                    })                  });                                    if (!response.ok) {                    console.warn('Failed to update cursor position on server');                  }                } catch (error) {                  console.error('Error updating cursor position:', error);                }              }, 500); // 500ms debounce            } catch (error) {              console.error('Error preparing cursor position update:', error);            }          }        }      });      return () => disposable.dispose();    }  }, [editor.current, fileSystem.currentFileId, fileSystem.items]);

  useEffect(() => {
    if (editorRef.current) {
      // Ensure the container is properly sized before creating the editor
      const container = editorRef.current;
      if (container.offsetHeight === 0 || container.offsetWidth === 0) {
        console.warn('Editor container has zero dimensions');
        return;
      }

      // Create editor with explicit dimensions
      editor.current = monaco.editor.create(container, {
        value: fileSystem.currentFileId 
          ? fileSystem.items[fileSystem.currentFileId].content || ''
          : '',
        language: 'javascript',
        theme: 'vs-dark', // Initial theme, will be replaced
        automaticLayout: false, // We'll handle layout updates manually
        dimension: {
          width: container.offsetWidth,
          height: container.offsetHeight
        },
        minimap: {
          enabled: true,
          scale: 0.8,
          renderCharacters: false,
          maxColumn: 60,
          showSlider: 'mouseover',
        },
        fontSize: 13,
        fontFamily: 'var(--font-mono)',
        lineHeight: 20,
        letterSpacing: 0.5,
        lineNumbers: 'on',
        roundedSelection: false,
        scrollBeyondLastLine: false,
        cursorStyle: 'line',
        cursorWidth: 2,
        wordWrap: 'on',
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        renderLineHighlight: 'line',
        renderWhitespace: 'selection',
        padding: { top: 4, bottom: 4 },
        suggest: {
          showWords: true,
          preview: true,
          showIcons: true,
          snippetsPreventQuickSuggestions: false, // Allow quick suggestions even when snippets are active
          localityBonus: true, // Favor nearby words in suggestions
          shareSuggestSelections: true, // Remember selections across widgets
        },
        // Add more robust trigger suggestion settings
        quickSuggestions: {
          other: true,
          comments: false, 
          strings: false
        },
        acceptSuggestionOnCommitCharacter: true,
        acceptSuggestionOnEnter: 'on',
        suggestOnTriggerCharacters: true,
        tabCompletion: 'on',
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
          vertical: 'visible',
          horizontal: 'visible',
          verticalHasArrows: false,
          horizontalHasArrows: false,
          useShadows: false,
        }
      });

      // Set up a proper resize observer
      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry && editor.current) {
          // Debounce layout updates
          window.requestAnimationFrame(() => {
            try {
              editor.current?.layout({
                width: entry.contentRect.width,
                height: entry.contentRect.height
              });
            } catch (error) {
              console.error('Error updating editor layout:', error);
            }
          });
        }
      });

      resizeObserver.observe(container);

      // Set VSCode's exact theme colors
      monaco.editor.defineTheme('vscode-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#1e1e1e',
          'editor.foreground': '#d4d4d4',
          'editor.lineHighlightBackground': '#2d2d2d50',
          'editorCursor.foreground': '#d4d4d4',
          'editorLineNumber.foreground': '#858585',
          'editorLineNumber.activeForeground': '#c6c6c6',
        }
      });

      // Apply our custom theme if it exists, otherwise use the default
      if (currentThemeRef.current.name !== 'vs-dark' || 
          Object.keys(currentThemeRef.current.editorColors).length > 0 || 
          currentThemeRef.current.tokenColors.length > 0) {
        applyCustomTheme();
      } else {
        monaco.editor.setTheme('vscode-dark');
      }

      const updateContent = () => {
        if (fileSystem.currentFileId && editor.current) {
          setFileSystem(prev => ({
            ...prev,
            items: {
              ...prev.items,
              [prev.currentFileId!]: {
                ...prev.items[prev.currentFileId!],
                content: editor.current?.getValue() || '',
              },
            },
          }));
        }
      };

      editor.current.onDidChangeModelContent(() => {
        updateContent();
      });

      // Set up editor global settings for suggestions to be automatic
      try {
        // Configure Monaco's global settings to ensure suggestions are shown automatically 
        monaco.languages.registerCompletionItemProvider('*', {
          provideCompletionItems: () => {
            return { suggestions: [] };
          },
          // Remove trigger characters since we're using timeout-based autocompletion instead
          triggerCharacters: [],
        });
        
        // Remove the onKeyUp handler that was triggering on specific characters
        // We'll rely solely on the timeout-based triggering in EditorGrid.tsx
      } catch (err) {
        console.error("Error setting up auto-suggestions:", err);
      }

      // Make editor globally available
      window.editor = editor.current;

      return () => {
        resizeObserver.disconnect();
        window.editor = undefined;
        editor.current?.dispose();
      };
    }
  }, [fileSystem.currentFileId]);

  const handleFileSelect = async (fileId: string) => {
    // Apply custom theme at the beginning to ensure it's set
    applyCustomTheme();
    
    // Check if file exists in the current file system state
    if (!fileSystem.items[fileId]) {
      console.error(`Attempted to select non-existent file with id: ${fileId}`);
      return;
    }

    const file = fileSystem.items[fileId];
    if (file.type === 'file') {
      if (!openFiles.includes(fileId)) {
        setOpenFiles(prev => [...prev, fileId]);
      }
      
      try {
        // Refresh structure before loading file
        await FileService.refreshStructure();
        
        // Then load the file
        const content = await FileService.readFile(fileId);
        if (content !== null) {
          setFileSystem(prev => ({
            ...prev,
            currentFileId: fileId,
            items: {
              ...prev.items,
              [fileId]: {
                ...prev.items[fileId],
                content: content,
              },
            },
          }));
          if (editor.current) {
            editor.current.setValue(content);
            // Reapply the custom theme after setting editor content
            applyCustomTheme();
          }
        }
      } catch (error) {
        console.error('Error loading file content:', error);
      }
    }
  };

  const handleTabSelect = async (tabId: string) => {
    console.log('handleTabSelect called with:', tabId);
    
    // Apply custom theme at the beginning of tab select to ensure it's set
    applyCustomTheme();
    
    // Special handling for welcome tab
    if (tabId === 'welcome') {
      // Make sure welcome file exists in the state
      if (!fileSystem.items['welcome']) {
        // If welcome file doesn't exist, recreate it
        setFileSystem(prev => ({
          ...prev,
          currentFileId: 'welcome',
          items: {
            ...prev.items,
            'welcome': {
              id: 'welcome',
              name: 'notes.js',
              type: 'file',
              content: "// Welcome to your new code editor!\n// Start typing here...\n\n// By the way you can't delete or save this file. (future updates (maybe (if i have motivation)))",
              parentId: prev.rootId,
              path: 'notes.js',
            }
          }
        }));
        
        if (editor.current) {
          editor.current.setValue((fileSystem.items['welcome'] as FileSystemItem)?.content || '');
          // Reapply the custom theme after setting editor content
          applyCustomTheme();
        }
        return;
      }
      
      setFileSystem(prev => ({ ...prev, currentFileId: 'welcome' }));
      if (editor.current) {
        editor.current.setValue((fileSystem.items['welcome'] as FileSystemItem)?.content || '');
        // Reapply the custom theme after setting editor content
        applyCustomTheme();
      }
      return;
    }

    // Check if regular file exists
    if (!fileSystem.items[tabId]) {
      console.error(`Attempted to select non-existent tab with id: ${tabId}`);
      // Fall back to welcome file
      handleTabSelect('welcome');
      return;
    }

    // First update the UI to show the selected tab
    setFileSystem(prev => ({ ...prev, currentFileId: tabId }));
    
    // Then load the file content
    try {
      const content = await FileService.readFile(tabId);
      console.log('File content loaded:', content ? 'success' : 'null');
      
      if (content !== null) {
        // Update file system with new content
        setFileSystem(prev => ({
          ...prev,
          items: {
            ...prev.items,
            [tabId]: {
              ...prev.items[tabId],
              content: content,
            },
          },
        }));
        
        if (editor.current) {
          editor.current.setValue(content);
          // Reapply the custom theme after setting editor content
          applyCustomTheme();
        }
      }
    } catch (error) {
      console.error('Error loading file content:', error);
    }
  };

  const handleTabClose = async (tabId: string) => {
    // First save the file if it exists and is not the welcome file
    if (tabId !== 'welcome' && tabId && fileSystem.items[tabId]) {
      try {
        // Get the file content from the editor if it's the current file,
        // otherwise use the content from fileSystem state
        const content = tabId === fileSystem.currentFileId && editor.current 
          ? editor.current.getValue() 
          : fileSystem.items[tabId].content || '';

        // Only save if there's actual content and a valid path
        if (content && fileSystem.items[tabId].path) {
          await FileService.saveFile(tabId, content);
        }
      } catch (error) {
        console.error(`Error saving file before closing tab: ${tabId}`, error);
      }
    }

    setOpenFiles(prev => {
      const newOpenFiles = prev.filter(id => id !== tabId);
      
      // If we're closing the current file, switch to the last open file
      if (tabId === fileSystem.currentFileId) {
        const lastFileId = newOpenFiles[newOpenFiles.length - 1];
        if (lastFileId) {
          // Use setTimeout to ensure state updates don't conflict
          setTimeout(() => handleTabSelect(lastFileId), 0);
        } else {
          // No files left open, show welcome screen
          setFileSystem(prev => ({ 
            ...prev, 
            currentFileId: 'welcome'  // Set to welcome instead of null
          }));
          
          // Don't clear the editor if we still have the content in fileSystem
          if (editor.current && fileSystem.items['welcome']) {
            // Set to welcome message instead of empty string
            const welcomeContent = (fileSystem.items['welcome'] as FileSystemItem).content ||
              "// Welcome to your new code editor!\n// Start typing here...\n\n// By the way you can't delete or save this file.";
            editor.current.setValue(welcomeContent);
            
            // Apply theme when switching to welcome screen
            applyCustomTheme();
          }
        }
      }
      
      return newOpenFiles;
    });
  };

  const handleOpenFolder = async () => {
    try {
      setIsLoading(true);
      setLoadingError(null);

      // Clear loaded folders when opening a new directory
      FileService.clearLoadedFolders();

      const result = await FileService.openDirectory();
      
      if (result) {
        // Update editor content
        if (editor.current) {
          editor.current.setValue('');
        }

        // Update file system state
        setFileSystem({
          items: result.items,
          rootId: result.rootId,
          currentFileId: null,
          terminalOpen: false,
        });

        // Clear open files
        setOpenFiles([]);
        
        // Show sidebar
        setIsSidebarCollapsed(false);

        // Save the directory path
        localStorage.setItem('lastDirectory', result.path);

        if (result.errors?.length > 0) {
          console.warn('Some files could not be accessed:', result.errors);
          setLoadingError('Some files could not be accessed');
        }
      }
    } catch (error) {
      console.error('Failed to open folder:', error);
      setLoadingError(error instanceof Error ? error.message : 'Failed to open folder');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloneRepository = async () => {
    // Open the clone repository modal
    setIsCloneModalOpen(true);
  };

  const handleOpenFile = async () => {
    // Apply custom theme at the beginning to ensure it's set
    applyCustomTheme();
    
    try {
      const result = await FileService.openFile();
      if (!result) {
        console.error('Failed to open file: No result returned');
        return;
      }

      // Update the file system state
      setFileSystem(prev => {
        const newItems = { ...prev.items };
        
        // Create a special "Opened Files" directory if it doesn't exist
        const openedFilesDirId = 'opened_files_dir';
        if (!newItems[openedFilesDirId]) {
          newItems[openedFilesDirId] = {
            id: openedFilesDirId,
            name: 'Opened Files',
            type: 'directory',
            parentId: prev.rootId,
            path: 'opened_files',
          };
        }
        
        // Add the file under the "Opened Files" directory
        newItems[result.id] = {
          id: result.id,
          name: result.filename,
          type: 'file',
          content: result.content,
          parentId: openedFilesDirId,
          path: result.fullPath, // Store the full path for saving
        };

        // Update the content in the file system state
        const updatedItems = {
          ...newItems,
          [result.id]: {
            ...newItems[result.id],
            content: result.content,
          },
        };

        return {
          ...prev,
          items: updatedItems,
          currentFileId: result.id,
        };
      });

      // Add to open files
      setOpenFiles(prev => [...prev, result.id]);

      // Set the editor content
      if (editor.current) {
        editor.current.setValue(result.content);
        // Apply custom theme after setting content
        applyCustomTheme();
      } else {
        console.error('Editor not initialized');
      }
    } catch (error) {
      console.error('Error opening file:', error);
    }
  };

  const handleModalSubmit = async () => {
    if (!modalState.parentId || !modalState.type || !modalState.name) return;

    if (modalState.type === 'file') {
      const result = await FileService.createFile(modalState.parentId, modalState.name);
      if (result) {
        setFileSystem(prev => ({
          ...prev,
          items: {
            ...prev.items,
            [result.id]: result.file,
          },
        }));
      }
    } else {
      const result = await FileService.createDirectory(modalState.parentId, modalState.name);
      if (result) {
        setFileSystem(prev => ({
          ...prev,
          items: {
            ...prev.items,
            [result.id]: result.directory,
          },
        }));
      }
    }
    setModalState({ isOpen: false, type: null, parentId: null, name: '' });
  };

  const createFile = async (parentId: string) => {
    setModalState({
      isOpen: true,
      type: 'file',
      parentId,
      name: '',
    });
  };

  const createFolder = async (parentId: string) => {
    setModalState({
      isOpen: true,
      type: 'folder',
      parentId,
      name: '',
    });
  };

  const getCurrentFileName = () => {
    if (!fileSystem.currentFileId) return 'No file open';
    if (fileSystem.currentFileId === 'welcome') return 'Welcome';
    
    const currentFile = fileSystem.items[fileSystem.currentFileId];
    return currentFile?.name || 'No file open';
  };

  // Add save handler
  const handleSave = useCallback(async () => {
    if (!fileSystem.currentFileId || !editor.current) return;

    setSaveStatus('saving');
    const content = editor.current.getValue();
    
    try {
      const result = await FileService.saveFile(fileSystem.currentFileId, content);
      
      if (result.success) {
        // Update the file system state with the saved content
        setFileSystem(prev => ({
          ...prev,
          items: {
            ...prev.items,
            [prev.currentFileId!]: {
              ...prev.items[prev.currentFileId!],
              content: result.content,
            },
          },
        }));

        // Update editor content if needed
        if (editor.current && editor.current.getValue() !== result.content) {
          editor.current.setValue(result.content);
        }

        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(null), 2000);
      } else {
        setSaveStatus('error');
      }
    } catch (error) {
      console.error('Save error:', error);
      setSaveStatus('error');
    }
  }, [fileSystem.currentFileId]);

  // Find the keyboard shortcut handler and add the LLMChat toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsTopBarCollapsed(!isTopBarCollapsed);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (fileSystem.currentFileId) {
          handleTabClose(fileSystem.currentFileId);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setIsLLMChatVisible(!isLLMChatVisible);
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setIsSettingsModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, isTopBarCollapsed, fileSystem.currentFileId, handleTabClose, isLLMChatVisible]);

  // Modify the auto-save functionality
  useEffect(() => {
    let saveTimeout: number;

    const handleContentChange = () => {
      if (fileSystem.currentFileId && editor.current) {
        const content = editor.current.getValue();
        
        // Clear previous timeout
        if (saveTimeout) {
          clearTimeout(saveTimeout);
        }

        // Set new timeout for auto-save
        saveTimeout = window.setTimeout(async () => {
          setSaveStatus('saving');
          try {
            const result = await FileService.saveFile(fileSystem.currentFileId!, content);
            if (result.success) {
              // Update the file system state with the saved content
              setFileSystem(prev => ({
                ...prev,
                items: {
                  ...prev.items,
                  [prev.currentFileId!]: {
                    ...prev.items[prev.currentFileId!],
                    content: result.content,
                  },
                },
              }));

              setSaveStatus('saved');
              setTimeout(() => setSaveStatus(null), 2000);
            } else {
              setSaveStatus('error');
            }
          } catch (error) {
            console.error('Auto-save error:', error);
            setSaveStatus('error');
          }
        }, 1000); // Auto-save after 1 second of no changes
      }
    };

    if (editor.current) {
      editor.current.onDidChangeModelContent(() => {
        handleContentChange();
      });
    }

    return () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
    };
  }, [fileSystem.currentFileId]);

  const handleProjectSelected = () => {
    // Refresh the file tree or handle any other necessary updates
    // This will depend on your existing code structure
  };

  // Add a function to update file system items
  const handleFolderContentsLoaded = (newItems: Record<string, FileSystemItem>) => {
    setFileSystem(prev => {
      // Don't update file system if it would affect currently open files
      const currentlyOpenFile = prev.currentFileId ? prev.items[prev.currentFileId] : null;
      
      // Get the root item from the new items if it exists
      const rootItem = Object.values(newItems).find(item => item.parentId === null);
      
      // Make sure we're preserving all existing open files without modifications
      const updatedItems = { ...prev.items };
      
      // Only add new items that don't replace existing items with the same ID
      Object.entries(newItems).forEach(([id, item]) => {
        if (!updatedItems[id]) {
          updatedItems[id] = item;
        }
      });
      
      // Always ensure the 'welcome' file is preserved
      if (!updatedItems['welcome'] && prev.items['welcome']) {
        updatedItems['welcome'] = prev.items['welcome'];
      }
      
      // Make sure currentFileId is pointing to an existing file
      let currentFileId = prev.currentFileId;
      if (currentFileId && !updatedItems[currentFileId]) {
        // If current file no longer exists, default to welcome file
        currentFileId = 'welcome';
      }
      
      return {
        ...prev,
        items: updatedItems,
        currentFileId,
        // Update root item name if we found one
        rootId: prev.rootId
      };
    });
  };

  const handleDeleteItem = async (item: FileSystemItem) => {
    const success = await FileService.deleteItem(item.path);
    if (success) {
      // If the deleted item was a file and it was open, close its tab
      if (item.type === 'file' && openFiles.includes(item.id)) {
        handleTabClose(item.id);
      }

      // Remove the item and its children from the file system
      const newItems = { ...fileSystem.items };
      const itemsToDelete = new Set<string>();

      // Helper function to collect all child items
      const collectChildren = (parentId: string) => {
        Object.entries(newItems).forEach(([id, item]) => {
          if (item.parentId === parentId) {
            itemsToDelete.add(id);
            if (item.type === 'directory') {
              collectChildren(id);
            }
          }
        });
      };

      // Add the item itself and collect all its children if it's a directory
      itemsToDelete.add(item.id);
      if (item.type === 'directory') {
        collectChildren(item.id);
      }

      // Remove all collected items
      itemsToDelete.forEach(id => {
        delete newItems[id];
      });

      setFileSystem(prev => ({
        ...prev,
        items: newItems,
      }));
    }
  };

  const handleRenameItem = async (item: FileSystemItem, newName: string) => {
    try {
      const result = await FileService.renameItem(item.path, newName);
      if (result.success && result.newPath) {
        // Update the item in the file system state
        setFileSystem(prev => {
          const updatedItems = { ...prev.items };
          updatedItems[item.id] = {
            ...item,
            name: newName,
            path: result.newPath as string, // Use type assertion to fix TypeScript error
          };
          return {
            ...prev,
            items: updatedItems,
          };
        });
      }
    } catch (error) {
      console.error('Error renaming item:', error);
    }
  };

  // Move reloadFileContent before the useEffect
  const reloadFileContent = async (fileId: string) => {
    try {
      const file = fileSystem.items[fileId];
      if (!file || file.type !== 'file') return;

      // Re-fetch the file content
      const content = await FileService.readFile(fileId);
      if (content !== null) {
        // Update file system state
        setFileSystem(prev => ({
          ...prev,
          items: {
            ...prev.items,
            [fileId]: {
              ...prev.items[fileId],
              content: content,
            },
          },
        }));

        // Update editor content if this is the current file
        if (fileId === fileSystem.currentFileId && editor.current) {
          editor.current.setValue(content);
        }
      }
    } catch (err) {
      console.error('Failed to reload file content:', err);
    }
  };

  // Combine both useEffects into one
  useEffect(() => {
    // Expose the current file information and file system globally
    window.getCurrentFile = () => {
      if (fileSystem.currentFileId) {
        const currentFile = fileSystem.items[fileSystem.currentFileId];
        return currentFile ? { path: currentFile.path } : null;
      }
      return null;
    };
    
    // Expose the file system
    window.fileSystem = fileSystem.items;

    // Expose reloadFileContent
    window.reloadFileContent = reloadFileContent;

    // Expose applyCustomTheme
    window.applyCustomTheme = applyCustomTheme;

      // Expose loadSettings
  window.loadSettings = loadSettings;

  // Add event listener for opening files from chat
  const handleOpenFileEvent = (event: CustomEvent) => {
    const { fileId, content, filename, path } = event.detail;
    
    // Add the file to the file system
    setFileSystem(prev => ({
      ...prev,
      items: {
        ...prev.items,
        [fileId]: {
          id: fileId,
          name: filename,
          type: 'file',
          content: content,
          parentId: prev.rootId,
          path: path,
        },
      },
      currentFileId: fileId,
    }));

    // Add to open files
    setOpenFiles(prev => [...prev, fileId]);

    // Set the editor content
    if (editor.current) {
      editor.current.setValue(content);
      applyCustomTheme();
    }
  };

  window.addEventListener('openFile', handleOpenFileEvent as EventListener);

  return () => {
    window.fileSystem = undefined;
    window.getCurrentFile = null;
    window.reloadFileContent = undefined;
    window.applyCustomTheme = undefined;
    window.loadSettings = undefined;
    window.removeEventListener('openFile', handleOpenFileEvent as EventListener);
  };
  }, [fileSystem, reloadFileContent, applyCustomTheme, loadSettings]);

  // Add to the App component state declarations
  const [currentChatId, setCurrentChatId] = useState<string>(uuidv4());

  // Add this state for Explorer and Git view toggle
  const [isGitViewActive, setIsGitViewActive] = useState(false);
  const [isExplorerViewActive, setIsExplorerViewActive] = useState(true);

  useEffect(() => {
    let mounted = true;
    
    const initializeApp = async () => {
      try {
        // Set connecting state
        setIsConnecting(true);
        setConnectionMessage('');
        
        // Only try to open directory if we're mounted
        if (!mounted) return;

        // Load settings using loadAllSettings
        if (window.loadSettings) {
          await window.loadSettings();
        } else {
          // Fallback to local loadSettings if window.loadSettings is not available
          await loadSettings();
        }

        // Try to open directory only if we have a saved path
        const lastDir = localStorage.getItem('lastDirectory');
        if (lastDir) {
          setConnectionMessage('');
          const result = await FileService.openSpecificDirectory(lastDir);
          if (result) {
            setFileSystem(prevState => ({
              ...prevState,
              items: result.items,
              rootId: result.rootId,
              currentFileId: null, // Don't open the welcome tab
              terminalOpen: false,
            }));
          }
        }
        
        // Connection is established
        setTimeout(() => {
          setIsConnecting(false);
        }, 1000); // Small delay to ensure UI is ready
      } catch (error) {
        console.error('Error initializing app:', error);
        setLoadingError('Failed to initialize app');
        setConnectionMessage('Failed to initialize application. Please try again.');
        setTimeout(() => {
          setIsConnecting(false);
        }, 3000);
      }
    };

    initializeApp();

    // Cleanup function to prevent state updates after unmount
    return () => {
      mounted = false;
    };
  }, []); // Empty dependency array

  // Periodic backend health check
  useEffect(() => {
    let isActive = true;

    const checkBackendHealth = async () => {
      try {
        const response = await fetch('http://localhost:23816/health');

        if (!isActive) return;

        const now = Date.now();

        if (response.ok) {
          const data = await response.json();
          const status = data?.status === 'healthy' ? 'healthy' : 'unhealthy';
          const message = status === 'healthy'
            ? `Backend healthy (${new Date(now).toLocaleTimeString()})`
            : `Backend unhealthy: ${data?.error || JSON.stringify(data)}`;

          setBackendHealthStatus(status);
          setBackendHealthMessage(message);
          setBackendHealthLastChecked(now);

          if (status === 'healthy') {
            if (isConnecting) setIsConnecting(false);
            setConnectionMessage('');
          } else {
            setConnectionMessage('Backend appears unhealthy. Check logs and settings.');
          }
        } else {
          const text = await response.text();
          setBackendHealthStatus('unhealthy');
          setBackendHealthMessage(`Health check failed: ${response.status} ${response.statusText}`);
          setBackendHealthLastChecked(now);
          setConnectionMessage(`Health check failed: ${response.statusText}`);
        }
      } catch (error: unknown) {
        if (!isActive) return;
        const message = error instanceof Error ? error.message : String(error);

        setBackendHealthStatus('unhealthy');
        setBackendHealthMessage(`Health check error: ${message}`);
        setBackendHealthLastChecked(Date.now());
        setConnectionMessage(`Cannot reach backend: ${message}`);
      }
    };

    checkBackendHealth();
    const interval = setInterval(checkBackendHealth, 15000);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, []);

  // Add a function to handle terminal toggle
  const toggleTerminal = () => {
    setFileSystem(prev => ({
      ...prev,
      terminalOpen: !prev.terminalOpen
    }));
  };

  // Update Discord RPC when editor state changes
  useEffect(() => {
    if (!editor.current || !discordRpcSettings.enabled) return;
    
    const updateDiscordRPC = () => {
      if (!window.electron || !window.electron.discord) return;
      
      const position = editor.current?.getPosition();
      const model = editor.current?.getModel();
      const fileName = getCurrentFileName();
      const workspaceName = fileSystem.items[fileSystem.rootId]?.name || 'Pointer';
      const languageId = model?.getLanguageId() || 'plaintext';
      const content = model?.getValue() || '';
      const fileSize = `${Math.round(content.length / 1024)} KB`;
      
      window.electron.discord.updateEditorInfo({
        file: fileName || 'Untitled',
        workspace: workspaceName,
        line: position?.lineNumber || 1,
        column: position?.column || 1,
        languageId,
        fileSize,
      });
    };
    
    // Update initially
    updateDiscordRPC();
    
    // Set up event listeners for cursor position changes
    const disposable = editor.current.onDidChangeCursorPosition(() => {
      updateDiscordRPC();
    });
    
    // Set up event listener for model changes (file changes)
    const modelDisposable = editor.current.onDidChangeModel(() => {
      updateDiscordRPC();
    });
    
    return () => {
      disposable.dispose();
      modelDisposable.dispose();
    };
  }, [editor.current, discordRpcSettings.enabled, fileSystem.currentFileId]);
  
  // Update Discord settings in main process when they change
  useEffect(() => {
    if (!window.electron || !window.electron.discord) return;
    window.electron.discord.updateSettings(discordRpcSettings);
  }, [discordRpcSettings]);

  // Ensure theme is applied whenever file system state changes
  useEffect(() => {
    if (fileSystem.currentFileId && editor.current) {
      setTimeout(() => {
        applyCustomTheme();
      }, 50);
    }
  }, [fileSystem.currentFileId]);

  // Update the toggle Git view function
  const handleToggleGitView = () => {
    if (isGitViewActive) {
      // If Git view is already active, deactivate it and collapse sidebar
      setIsGitViewActive(false);
      setIsExplorerViewActive(false);
      setIsSidebarCollapsed(true); // Hide sidebar completely
    } else {
      // If Git view is not active, activate it and deactivate Explorer
      setIsGitViewActive(true);
      setIsExplorerViewActive(false);
      setIsSidebarCollapsed(false); // Show sidebar
    }
  };

  // Add a function to toggle Explorer view
  const handleToggleExplorerView = () => {
    // Toggle explorer on/off
    setIsExplorerViewActive(!isExplorerViewActive);
    
    // Also collapse/expand the sidebar based on Explorer state
    setIsSidebarCollapsed(isExplorerViewActive);
    
    // If we're turning Explorer on, make sure Git view is off
    if (!isExplorerViewActive) {
      setIsGitViewActive(false);
    }
  };

  // Corrected useEffect for loadAllSettings
  useEffect(() => {
    if (typeof loadSettings === 'function') {
      window.loadSettings = loadSettings;
    }
    return () => {
      delete window.loadSettings;
    };
  }, []);

  // Listen for title format changes
  useEffect(() => {
    const handleTitleFormatChange = (event: Event) => {
      const customEvent = event as CustomEvent<{titleFormat: string}>;
      setDynamicTitleFormat(customEvent.detail?.titleFormat);
    };

    window.addEventListener('title-format-changed', handleTitleFormatChange);

    return () => {
      window.removeEventListener('title-format-changed', handleTitleFormatChange);
    };
  }, []);

  const saveAllSettings = async () => {
    // Implementation of saveAllSettings function
  };

  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);

  const handleToggleGrid = () => {
    setIsGridLayout(prev => !prev);
  };

  // Preview handlers
  const handlePreviewToggle = (fileId: string) => {
    const file = fileSystem.items[fileId];
    if (!file || !isPreviewableFile(file.name)) return;

    const previewType = getPreviewType(file.name);
    if (!previewType) return;

    // Check if preview tab already exists for this file
    const existingPreviewTab = previewTabs.find(tab => tab.fileId === fileId);
    
    if (existingPreviewTab) {
      // Switch to existing preview tab
      setCurrentPreviewTabId(existingPreviewTab.id);
    } else {
      // Create new preview tab
      const newPreviewTab: TabInfo = {
        id: `preview-${fileId}-${Date.now()}`,
        fileId,
        type: 'preview',
        previewType,
      };
      
      setPreviewTabs(prev => [...prev, newPreviewTab]);
      setCurrentPreviewTabId(newPreviewTab.id);
    }
  };

  const handlePreviewTabSelect = (tabId: string) => {
    setCurrentPreviewTabId(tabId);
    // Clear current file selection when switching to preview
    setFileSystem(prev => ({ ...prev, currentFileId: null }));
  };

  const handlePreviewTabClose = (tabId: string) => {
    setPreviewTabs(prev => prev.filter(tab => tab.id !== tabId));
    
    // If closing the current preview tab, switch to another tab or clear selection
    if (tabId === currentPreviewTabId) {
      const remainingPreviewTabs = previewTabs.filter(tab => tab.id !== tabId);
      if (remainingPreviewTabs.length > 0) {
        setCurrentPreviewTabId(remainingPreviewTabs[remainingPreviewTabs.length - 1].id);
      } else {
        setCurrentPreviewTabId(null);
        // Switch back to the last open editor file if available
        if (openFiles.length > 0) {
          const lastFileId = openFiles[openFiles.length - 1];
          setFileSystem(prev => ({ ...prev, currentFileId: lastFileId }));
        }
      }
    }
  };

  return (
    <ErrorBoundary>
      <div className="app-container">
        {isConnecting && (
          <LoadingScreen message={connectionMessage} />
        )}
      
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100vh', 
        overflow: 'hidden',
        background: 'var(--bg-primary)',
      }}>
        <Titlebar
          onOpenFolder={handleOpenFolder} 
          onOpenFile={handleOpenFile} 
          onCloneRepository={handleCloneRepository}
          onToggleGitView={handleToggleGitView}
          onToggleExplorerView={handleToggleExplorerView}
          onToggleLLMChat={() => setIsLLMChatVisible(!isLLMChatVisible)}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onToggleTerminal={toggleTerminal}
          isGitViewActive={isGitViewActive}
          isExplorerViewActive={isExplorerViewActive}
          isLLMChatVisible={isLLMChatVisible}
          terminalOpen={fileSystem.terminalOpen}
          currentFileName={getCurrentFileName()}
          workspaceName={fileSystem.items[fileSystem.rootId]?.name || ''}
          titleFormat={dynamicTitleFormat || settingsData.advanced?.titleFormat || '{filename} - {workspace} - Pointer'}
          backendHealthStatus={backendHealthStatus}
          backendHealthMessage={backendHealthMessage}
        />
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          {/* Sidebar removed - content will now be controlled via titlebar buttons */}
          <div style={{ display: 'flex' }}>
            {!isSidebarCollapsed && (
              <Resizable
                defaultWidth={300}
                minWidth={170}
                maxWidth={850}
                isCollapsed={isSidebarCollapsed}
                onCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                shortcutKey="sidebar"
              >
                {isLoading ? (
                  <div style={{
                    padding: '16px',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}>
                    <div>Loading folder contents...</div>
                    {loadingError && (
                      <div style={{ color: 'var(--error-color)' }}>
                        {loadingError}
                      </div>
                    )}
                  </div>
                ) : (
                  isGitViewActive ? (
                    <GitView onBack={handleToggleExplorerView} />
                  ) : isExplorerViewActive ? (
                    <FileExplorer
                      items={fileSystem.items}
                      rootId={fileSystem.rootId}
                      currentFileId={fileSystem.currentFileId}
                      onFileSelect={handleFileSelect}
                      onCreateFile={createFile}
                      onCreateFolder={createFolder}
                      onFolderContentsLoaded={handleFolderContentsLoaded}
                      onDeleteItem={handleDeleteItem}
                      onRenameItem={handleRenameItem}
                    />
                  ) : (
                    <div style={{ padding: '16px', color: 'var(--text-primary)' }}>
                      Select a view from the titlebar
                    </div>
                  )
                )}
              </Resizable>
            )}
          </div>

          {/* Main Editor Area */}
          <div 
            className="editor-area"
            style={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: 'column',
              marginRight: isLLMChatVisible ? `${width}px` : '0',
              transition: 'margin-right 0.2s ease-in-out'
            }}>
            <Tabs
              openFiles={openFiles}
              currentFileId={fileSystem.currentFileId}
              items={fileSystem.items}
              onTabSelect={handleTabSelect}
              onTabClose={handleTabClose}
              onToggleGrid={handleToggleGrid}
              isGridLayout={isGridLayout}
              previewTabs={previewTabs}
              onPreviewToggle={handlePreviewToggle}
              onPreviewTabSelect={handlePreviewTabSelect}
              onPreviewTabClose={handlePreviewTabClose}
              currentPreviewTabId={currentPreviewTabId}
            />
            <EditorGrid
              openFiles={openFiles}
              currentFileId={fileSystem.currentFileId}
              items={fileSystem.items}
              onEditorChange={(newEditor) => {
                editor.current = newEditor;
                // Set up a resize observer for the editor container
                if (editorRef.current) {
                  const resizeObserver = new ResizeObserver((entries) => {
                    const entry = entries[0];
                    if (entry && editor.current) {
                      // Use requestAnimationFrame to ensure smooth updates
                      requestAnimationFrame(() => {
                        try {
                          editor.current?.layout({
                            width: entry.contentRect.width,
                            height: entry.contentRect.height
                          });
                        } catch (error) {
                          console.error('Error updating editor layout:', error);
                        }
                      });
                    }
                  });
                  resizeObserver.observe(editorRef.current);
                }
              }}
              onTabClose={handleTabClose}
              isGridLayout={isGridLayout}
              onToggleGrid={handleToggleGrid}
              setSaveStatus={setSaveStatus}
              previewTabs={previewTabs}
              currentPreviewTabId={currentPreviewTabId}
            />
          </div>

          {/* LLMChat */}
          {isLLMChatVisible && (
            <LLMChat
              isVisible={isLLMChatVisible}
              onClose={() => setIsLLMChatVisible(false)}
              onResize={(newWidth) => {
                setWidth(newWidth);
                // Force editor layout update with proper timing
                if (editor.current) {
                  // Use a small delay to ensure the DOM has updated
                  setTimeout(() => {
                    requestAnimationFrame(() => {
                      try {
                        editor.current?.layout();
                        // Dispatch a resize event after the layout update
                        window.dispatchEvent(new Event('resize'));
                      } catch (error) {
                        console.error('Error updating editor layout:', error);
                      }
                    });
                  }, 0);
                }
              }}
              currentChatId={currentChatId}
              onSelectChat={setCurrentChatId}
            />
          )}
        </div>

        {/* Status Bar */}
        <div style={{
          height: '22px',
          background: 'var(--statusbar-bg)',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          gap: '16px',
        }}>
          {/* File name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>{getCurrentFileName()}</span>
          </div>

          {/* Syntax - Only show if we have a valid file */}
          {fileSystem.currentFileId && 
           fileSystem.items[fileSystem.currentFileId] && 
           fileSystem.items[fileSystem.currentFileId].type === 'file' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>
                {getLanguageFromFileName(fileSystem.items[fileSystem.currentFileId].name)}
              </span>
            </div>
          )}

          {/* Line and Column */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
          </div>

          {/* Encoding and Line Ending */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>UTF-8</span>
            <span>LF</span>
          </div>

          {/* Indentation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>Spaces: 2</span>
          </div>

          {/* Save status */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {saveStatus === 'saving' && (
              <span>Saving...</span>
            )}
            {saveStatus === 'saved' && (
              <span>Saved</span>
            )}
            {saveStatus === 'error' && (
              <span style={{ color: 'var(--error-color)' }}>Error saving file</span>
            )}
          </div>
        </div>

        {modalState.isOpen && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}>
            <div style={{
              background: 'var(--bg-primary)',
              padding: '20px',
              borderRadius: '4px',
              minWidth: '300px',
            }}>
              <h3 style={{ margin: '0 0 16px 0', color: 'var(--text-primary)' }}>
                Create New {modalState.type === 'file' ? 'File' : 'Folder'}
              </h3>
              <input
                type="text"
                value={modalState.name}
                onChange={(e) => setModalState(prev => ({ ...prev, name: e.target.value }))}
                placeholder={`Enter ${modalState.type} name`}
                style={{
                  width: '100%',
                  padding: '8px',
                  marginBottom: '16px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setModalState({ isOpen: false, type: null, parentId: null, name: '' })}
                  style={{
                    padding: '6px 12px',
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleModalSubmit}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--accent-color)',
                    border: 'none',
                    borderRadius: '4px',
                    color: 'white',
                    cursor: 'pointer',
                  }}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Terminal */}
        {fileSystem.terminalOpen && (
          <Terminal isVisible={fileSystem.terminalOpen} />
        )}

        <DiffViewer />

        {/* Toast notifications */}
        <ToastContainer />

        {/* Settings Modal */}
        <Settings 
          isVisible={isSettingsModalOpen} 
          onClose={() => {
            setIsSettingsModalOpen(false);
            setDynamicTitleFormat(undefined); // Reset dynamic title format on close
            loadSettings();
          }}
          initialSettings={{
            discordRpc: discordRpcSettings,
            onDiscordSettingsChange: (settings) => {
              setDiscordRpcSettings(prev => ({...prev, ...settings}));
            }
          }}
        />

        {/* Clone Repository Modal */}
        <CloneRepositoryModal
          isOpen={isCloneModalOpen}
          onClose={() => setIsCloneModalOpen(false)}
          onClone={async (url, directory) => {
            setIsLoading(true);
            setLoadingError(null);
            
            try {
              const cloneResult = await GitService.cloneRepository(url, directory);
              
              if (!cloneResult.success) {
                throw new Error(cloneResult.error || 'Failed to clone repository');
              }
              
              // If successful, open the folder
              await handleOpenFolder();
            } catch (error: any) {
              console.error('Error cloning repository:', error);
              setLoadingError(`Error cloning repository: ${error.message}`);
              throw error; // Rethrow to be caught by the modal
            } finally {
              setIsLoading(false);
            }
          }}
        />
      </div>
    </div>
    </ErrorBoundary>
  );
};

const activityBarButtonStyle = {
  width: '48px',
  height: '48px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  color: 'var(--activity-bar-fg)',
  cursor: 'pointer',
  opacity: 0.7,
  transition: 'opacity 0.1s ease',
  ':hover': {
    opacity: 1,
  }
};

const titleBarButtonStyle = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-primary)',
  padding: '4px 8px',
  cursor: 'pointer',
  fontSize: '12px',
  ':hover': {
    background: 'var(--bg-hover)',
  },
  // @ts-ignore
  WebkitAppRegion: 'no-drag',
};

// Add this near the other button styles
const chatSwitcherButtonStyle = {
  ...activityBarButtonStyle,
  position: 'relative' as const,
};

export default App; 
