import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { FileSystemItem, TabInfo } from '../types';
import { ChatService, ChatSession } from '../services/ChatService';

/**
 * App State Store using Zustand
 * Centralized state management replacing React Context
 * 
 * Improvement 17: Modern state management with Zustand devtools and persistence
 */

// File System State
interface FileSystemState {
  fileSystem: {
    items: Record<string, FileSystemItem>;
    currentFileId: string | null;
    rootId: string;
    terminalOpen: boolean;
  };
  setFileSystem: (state: any) => void;
  updateFileItem: (id: string, updates: Partial<FileSystemItem>) => void;
  setCurrentFile: (fileId: string | null) => void;
  setTerminalOpen: (open: boolean) => void;
  setRootId: (rootId: string) => void;
}

// UI State
interface UIState {
  isSidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  isGitViewActive: boolean;
  setGitViewActive: (active: boolean) => void;
  isExplorerViewActive: boolean;
  setExplorerViewActive: (active: boolean) => void;
  isGridLayout: boolean;
  setGridLayout: (grid: boolean) => void;
  isLLMChatVisible: boolean;
  setLLMChatVisible: (visible: boolean) => void;
  isSettingsModalOpen: boolean;
  setSettingsModalOpen: (open: boolean) => void;
  saveStatus: 'saved' | 'saving' | 'error' | null;
  setSaveStatus: (status: 'saved' | 'saving' | 'error' | null) => void;
}

// Editor State
interface EditorState {
  openFiles: string[];
  addOpenFile: (fileId: string) => void;
  removeOpenFile: (fileId: string) => void;
  cursorPosition: { line: number; column: number };
  setCursorPosition: (line: number, column: number) => void;
  chatWidth: number;
  setChatWidth: (width: number) => void;
}

// Chat State
interface ChatStateStore {
  chats: ChatSession[];
  setChats: (chats: ChatSession[]) => void;
  isChatListVisible: boolean;
  setIsChatListVisible: (visible: boolean) => void;
  currentChatId: string | null;
  setCurrentChatId: (id: string | null) => void;
  addChat: (chat: ChatSession) => void;
  removeChat: (chatId: string) => void;
}

// Settings State
interface SettingsState {
  settingsData: Record<string, any>;
  setSettingsData: (data: Record<string, any>) => void;
  discordRpcSettings: any;
  setDiscordRpcSettings: (settings: any) => void;
}

// Loading State
interface LoadingState {
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
  isConnecting: boolean;
  setConnecting: (connecting: boolean) => void;
  connectionMessage: string;
  setConnectionMessage: (message: string) => void;
  loadingError: string | null;
  setLoadingError: (error: string | null) => void;
}

// Combined Store Type
export type AppStore = FileSystemState & UIState & EditorState & ChatStateStore & SettingsState & LoadingState;

// Create stores with proper middleware
export const useFileSystemStore = create<FileSystemState>()(
  devtools(
    persist(
      (set) => ({
        fileSystem: {
          items: {},
          currentFileId: null,
          rootId: 'root',
          terminalOpen: false,
        },
        setFileSystem: (state) => set({ fileSystem: state }),
        updateFileItem: (id, updates) =>
          set((state) => ({
            fileSystem: {
              ...state.fileSystem,
              items: {
                ...state.fileSystem.items,
                [id]: { ...state.fileSystem.items[id], ...updates },
              },
            },
          })),
        setCurrentFile: (fileId) =>
          set((state) => ({
            fileSystem: { ...state.fileSystem, currentFileId: fileId },
          })),
        setTerminalOpen: (open) =>
          set((state) => ({
            fileSystem: { ...state.fileSystem, terminalOpen: open },
          })),
        setRootId: (rootId) =>
          set((state) => ({
            fileSystem: { ...state.fileSystem, rootId },
          })),
      }),
      { name: 'file-system-store' }
    ),
    { name: 'FileSystemStore' }
  )
);

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        isSidebarCollapsed: false,
        setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
        isGitViewActive: false,
        setGitViewActive: (active) => set({ isGitViewActive: active }),
        isExplorerViewActive: true,
        setExplorerViewActive: (active) => set({ isExplorerViewActive: active }),
        isGridLayout: false,
        setGridLayout: (grid) => set({ isGridLayout: grid }),
        isLLMChatVisible: true,
        setLLMChatVisible: (visible) => set({ isLLMChatVisible: visible }),
        isSettingsModalOpen: false,
        setSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),
        saveStatus: null,
        setSaveStatus: (status) => set({ saveStatus: status }),
      }),
      { name: 'ui-store' }
    ),
    { name: 'UIStore' }
  )
);

export const useEditorStore = create<EditorState>()(
  devtools(
    persist(
      (set) => ({
        openFiles: [],
        addOpenFile: (fileId) =>
          set((state) => ({
            openFiles: state.openFiles.includes(fileId)
              ? state.openFiles
              : [...state.openFiles, fileId],
          })),
        removeOpenFile: (fileId) =>
          set((state) => ({
            openFiles: state.openFiles.filter((id) => id !== fileId),
          })),
        cursorPosition: { line: 1, column: 1 },
        setCursorPosition: (line, column) =>
          set({ cursorPosition: { line, column } }),
        chatWidth: 700,
        setChatWidth: (width) => set({ chatWidth: width }),
      }),
      { name: 'editor-store' }
    ),
    { name: 'EditorStore' }
  )
);

export const useChatStore = create<ChatStateStore>()(
  devtools(
    persist(
      (set) => ({
        chats: [],
        setChats: (chats) => set({ chats }),
        isChatListVisible: false,
        setIsChatListVisible: (visible) => set({ isChatListVisible: visible }),
        currentChatId: null,
        setCurrentChatId: (id) => set({ currentChatId: id }),
        addChat: (chat) =>
          set((state) => ({
            chats: [...state.chats, chat],
          })),
        removeChat: (chatId) =>
          set((state) => ({
            chats: state.chats.filter((chat) => chat.id !== chatId),
          })),
      }),
      { name: 'chat-store' }
    ),
    { name: 'ChatStore' }
  )
);

export const useSettingsStore = create<SettingsState>()(
  devtools(
    persist(
      (set) => ({
        settingsData: {},
        setSettingsData: (data) => set({ settingsData: data }),
        discordRpcSettings: {
          enabled: true,
          details: 'Editing {file}',
        },
        setDiscordRpcSettings: (settings) => set({ discordRpcSettings: settings }),
      }),
      { name: 'settings-store' }
    ),
    { name: 'SettingsStore' }
  )
);

export const useLoadingStore = create<LoadingState>()(
  devtools(
    (set) => ({
      isLoading: false,
      setLoading: (loading) => set({ isLoading: loading }),
      isConnecting: true,
      setConnecting: (connecting) => set({ isConnecting: connecting }),
      connectionMessage: '',
      setConnectionMessage: (message) => set({ connectionMessage: message }),
      loadingError: null,
      setLoadingError: (error) => set({ loadingError: error }),
    }),
    { name: 'LoadingStore' }
  )
);

// Combined hook for accessing all stores
export const useAppStore = () => ({
  fileSystem: useFileSystemStore(),
  ui: useUIStore(),
  editor: useEditorStore(),
  chat: useChatStore(),
  settings: useSettingsStore(),
  loading: useLoadingStore(),
});

export default useAppStore;
