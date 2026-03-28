/**
 * Tool call function definition
 */
export interface ToolFunctionCall {
  name: string;
  arguments: string | Record<string, unknown>;
}

/**
 * Tool call information
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolFunctionCall;
}

/**
 * Editor information for Discord Rich Presence
 */
export interface EditorInfo {
  currentFile?: string;
  lineNumber?: number;
  language?: string;
  projectName?: string;
  [key: string]: string | number | undefined;
}

/**
 * Settings information for Discord Rich Presence
 */
export interface DiscordSettings {
  showFileName?: boolean;
  showLanguage?: boolean;
  showProject?: boolean;
  [key: string]: boolean | undefined;
}

/**
 * Electron IPC channel data types
 */
export interface ElectronMessage {
  channel: string;
  data: unknown;
}

/**
 * Electron API interface
 */
export interface ElectronAPI {
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
  };
  send: (channel: string, data: ElectronMessage['data']) => void;
  receive: (channel: string, func: (data: ElectronMessage['data']) => void) => void;
  discord: {
    updateEditorInfo: (info: EditorInfo) => void;
    updateSettings: (settings: DiscordSettings) => void;
  };
  openInExplorer: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
}

export interface FileSystemItem {
  id: string;
  name: string;
  type: 'file' | 'directory';
  content?: string;
  children?: FileSystemItem[];
  parentId: string | null;
  path: string;
}

export interface PreviewTab {
  id: string;
  fileId: string;
  type: 'preview';
  previewType: 'html' | 'markdown';
}

export interface TabInfo {
  id: string;
  fileId?: string;
  type: 'editor' | 'preview';
  previewType?: 'html' | 'markdown';
}

/**
 * Base message interface for chat interactions
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface FileSystemState {
  items: Record<string, FileSystemItem>;
  currentFileId: string | null;
  rootId: string;
  terminalOpen: boolean;
}

export interface ModelConfig {
  id?: string;
  name: string;
  temperature: number;
  maxTokens: number | null;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  contextLength?: number;
  stopSequences?: string[];
  modelProvider?: string;
  apiEndpoint?: string;
  apiKey?: string;
  purpose?: 'chat' | 'insert' | 'autocompletion' | 'summary' | 'agent' | 'general';
}

export interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  rulers: number[];
  formatOnSave: boolean;
  formatOnPaste: boolean;
  autoSave: boolean;
  autoSaveDelay: number; // Auto-save delay in milliseconds (default: 1000)
  autoAcceptGhostText: boolean;
}

export interface ThemeSettings {
  name: string;
  customColors: {
    // App UI Colors
    bgPrimary?: string;
    bgSecondary?: string;
    bgTertiary?: string;
    bgSelected?: string;
    bgHover?: string;
    bgAccent?: string;
    textPrimary?: string;
    textSecondary?: string;
    borderColor?: string;
    borderPrimary?: string;
    accentColor?: string;
    accentHover?: string;
    errorColor?: string;
    titlebarBg?: string;
    statusbarBg?: string;
    statusbarFg?: string;
    activityBarBg?: string;
    activityBarFg?: string;
    inlineCodeColor?: string;
    textMuted?: string;
    
    // Explorer Colors
    explorerFolderFg?: string;
    explorerFolderExpandedFg?: string;
    explorerFileFg?: string;
    /**
     * @deprecated Use customFileExtensions instead
     */
    explorerFileJavaScriptFg?: string;
    /**
     * @deprecated Use customFileExtensions instead
     */
    explorerFileTypeScriptFg?: string;
    /**
     * @deprecated Use customFileExtensions instead
     */
    explorerFileJsonFg?: string;
    /**
     * @deprecated Use customFileExtensions instead
     */
    explorerFileHtmlFg?: string;
    /**
     * @deprecated Use customFileExtensions instead
     */
    explorerFileCssFg?: string;
    /**
     * @deprecated Use customFileExtensions instead
     */
    explorerFileMarkdownFg?: string;
    /**
     * @deprecated Use customFileExtensions instead
     */
    explorerFileYamlFg?: string;
    /**
     * @deprecated Use customFileExtensions instead
     */
    explorerFileImageFg?: string;
    
    // Custom file extension colors - key is the extension, value is the color
    customFileExtensions?: Record<string, string>;
  };
  // Monaco Editor Colors
  editorColors: {
    // Basic colors
    "editor.background"?: string;
    "editor.foreground"?: string;
    "editorLineNumber.foreground"?: string;
    "editorLineNumber.activeForeground"?: string;
    "editorCursor.background"?: string;
    "editorCursor.foreground"?: string;
    
    // Selection colors
    "editor.selectionBackground"?: string;
    "editor.selectionForeground"?: string;
    "editor.inactiveSelectionBackground"?: string;
    "editor.selectionHighlightBackground"?: string;
    "editor.selectionHighlightBorder"?: string;
    
    // Word highlight
    "editor.wordHighlightBackground"?: string;
    "editor.wordHighlightStrongBackground"?: string;
    "editor.wordHighlightBorder"?: string;
    "editor.wordHighlightStrongBorder"?: string;
    
    // Find matches
    "editor.findMatchBackground"?: string;
    "editor.findMatchHighlightBackground"?: string;
    "editor.findRangeHighlightBackground"?: string;
    "editor.findMatchBorder"?: string;
    "editor.findMatchHighlightBorder"?: string;
    
    // Line highlight
    "editor.lineHighlightBackground"?: string;
    "editor.lineHighlightBorder"?: string;
    
    // Gutter
    "editorGutter.background"?: string;
    "editorGutter.modifiedBackground"?: string;
    "editorGutter.addedBackground"?: string;
    "editorGutter.deletedBackground"?: string;
    
    // Bracket matching
    "editorBracketMatch.background"?: string;
    "editorBracketMatch.border"?: string;
    
    // Overview ruler
    "editorOverviewRuler.border"?: string;
    "editorOverviewRuler.findMatchForeground"?: string;
    "editorOverviewRuler.rangeHighlightForeground"?: string;
    "editorOverviewRuler.selectionHighlightForeground"?: string;
    "editorOverviewRuler.wordHighlightForeground"?: string;
    "editorOverviewRuler.wordHighlightStrongForeground"?: string;
    "editorOverviewRuler.modifiedForeground"?: string;
    "editorOverviewRuler.addedForeground"?: string;
    "editorOverviewRuler.deletedForeground"?: string;
    "editorOverviewRuler.errorForeground"?: string;
    "editorOverviewRuler.warningForeground"?: string;
    "editorOverviewRuler.infoForeground"?: string;
    
    // Errors and warnings
    "editorError.foreground"?: string;
    "editorError.border"?: string;
    "editorWarning.foreground"?: string;
    "editorWarning.border"?: string;
    
    // Widget colors
    "editorWidget.background"?: string;
    "editorWidget.border"?: string;
    "editorSuggestWidget.background"?: string;
    "editorSuggestWidget.border"?: string;
    "editorSuggestWidget.foreground"?: string;
    "editorSuggestWidget.highlightForeground"?: string;
    "editorSuggestWidget.selectedBackground"?: string;
    "editorHoverWidget.background"?: string;
    "editorHoverWidget.border"?: string;
  };
  // Token syntax highlighting rules
  tokenColors?: Array<{
    token: string;
    foreground?: string;
    background?: string;
    fontStyle?: string;
  }>;
}

export interface DiscordRpcSettings {
  enabled: boolean;
  details: string;
  state: string;
  largeImageKey: string;
  largeImageText: string;
  smallImageKey: string;
  smallImageText: string;
  button1Label: string;
  button1Url: string;
  button2Label: string;
  button2Url: string;
}

export interface CustomRule {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
}

export interface PromptsSettings {
  // Essential prompts (can only be enabled/disabled)
  enhancedSystemMessage: boolean;
  conciseChatSystem: boolean;
  advancedAgentSystem: boolean;
  refreshKnowledgeSystem: boolean;
  coreTraits: boolean;
  fileOperations: boolean;
  explorationProtocol: boolean;
  enhancedCapabilities: boolean;
  communicationExcellence: boolean;
  
  // Custom rules (can be added/deleted)
  customRules: CustomRule[];
}

export interface ModelAssignments {
  chat: string;
  insert: string;
  autocompletion: string;
  summary: string;
  agent: string;
}

export interface AppSettings {
  models: Record<string, ModelConfig>;
  modelAssignments: ModelAssignments;
  editor: EditorSettings;
  theme: ThemeSettings;
  keybindings?: Record<string, string>;
  terminal?: Record<string, any>;
  discordRpc?: DiscordRpcSettings;
  prompts?: PromptsSettings;
  advanced?: {
    titleFormat?: string;
    [key: string]: any;
  };
}

export interface AttachedFile {
  name: string;
  path: string;
  content: string;
}

export interface ExtendedMessage extends Message {
  attachments?: AttachedFile[];
  id?: string;
  timestamp?: string;
  tool_call_id?: string;
  messageId?: string; // Change from number to string for UUIDs
} 