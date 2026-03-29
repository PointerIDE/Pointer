import { FileSystemItem } from '../types';
import { RecentProjectsService } from './RecentProjectsService';
import { logger } from './LoggerService';
import { API_CONFIG } from '../config/apiConfig';

export type FileChangeListener = (filePath: string, oldContent: string, newContent: string) => void;

interface DiffChange {
  filePath: string;
  oldContent: string;
  newContent: string;
  timestamp: number;
}

/**
 * Consolidated File Service
 * Combines FileSystemService, FileReaderService, and FileChangeEventService
 * Reduces code duplication and improves maintainability
 */
export class FileService {
  private static readonly API_URL = API_CONFIG.API_URL;
  private static filePaths = new Map<string, string>();
  private static loadedFolders = new Set<string>();
  private static currentDirectory: string | null = null;
  private static fileCache: Map<string, string> = new Map();
  private static changeListeners: FileChangeListener[] = [];
  private static diffs: DiffChange[] = [];

  // ==================== Path Utilities ====================

  private static normalizePath(path: string): string {
    let normalized = path.replace(/\\/g, '/');
    if (path.startsWith('/') || path.startsWith('\\')) {
      return normalized;
    }
    return normalized.replace(/^\/+/, '');
  }

  private static generateFileId(path: string): string {
    const normalizedPath = this.normalizePath(path);
    return `file_${normalizedPath}`;
  }

  // ==================== File Reading ====================

  /**
   * Read file content from disk
   */
  static async readFile(filePath: string): Promise<string | null> {
    try {
      logger.debug('Reading file', { filePath });

      // Check cache first
      const cacheKey = this.normalizePath(filePath);
      if (this.fileCache.has(cacheKey)) {
        logger.debug('File served from cache', { filePath });
        return this.fileCache.get(cacheKey) || null;
      }

      const params = new URLSearchParams();
      params.append('path', filePath);

      if (this.currentDirectory && !filePath.startsWith('/') && !filePath.startsWith('\\')) {
        params.append('currentDir', this.currentDirectory);
      }

      const response = await fetch(`${this.API_URL}/read-file?${params}`, {
        method: 'GET',
        headers: {
          'Accept': 'text/plain',
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok) {
        logger.warn('Failed to read file', {
          filePath,
          status: response.status,
          statusText: response.statusText
        });
        return null;
      }

      const content = await response.text();
      this.fileCache.set(cacheKey, content);
      return content || '';
    } catch (error) {
      logger.error('Error reading file', error, { filePath });
      return null;
    }
  }

  /**
   * Save file content to disk
   */
  static async saveFile(filePath: string, content: string): Promise<boolean> {
    try {
      logger.debug('Saving file', { filePath });

      const response = await fetch(`${this.API_URL}/save-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content })
      });

      if (!response.ok) {
        logger.warn('Failed to save file', {
          filePath,
          status: response.status
        });
        return false;
      }

      // Invalidate cache
      const cacheKey = this.normalizePath(filePath);
      this.fileCache.delete(cacheKey);

      logger.info('File saved successfully', { filePath });
      return true;
    } catch (error) {
      logger.error('Error saving file', error, { filePath });
      return false;
    }
  }

  // ==================== Directory Operations ====================

  /**
   * Fetch contents of a folder
   */
  static async fetchFolderContents(path: string): Promise<{
    items: Record<string, FileSystemItem>;
    rootId: string;
    errors: string[];
  } | null> {
    try {
      await this.refreshStructure();
      const normalizedPath = this.normalizePath(path);

      const response = await fetch(`${this.API_URL}/fetch-folder-contents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: normalizedPath,
          currentDir: this.currentDirectory
        })
      });

      if (!response.ok) {
        logger.warn('Failed to fetch folder contents', {
          path: normalizedPath,
          status: response.status
        });
        return null;
      }

      const data = await response.json();

      Object.values(data.items as Record<string, FileSystemItem>).forEach((item: FileSystemItem) => {
        if (item.type === 'file') {
          this.filePaths.set(item.id, this.normalizePath(item.path));
        }
      });

      this.loadedFolders.add(normalizedPath);
      return data;
    } catch (error) {
      logger.error('Error fetching folder contents', error, { path });
      return null;
    }
  }

  /**
   * Open directory dialog
   */
  static async openDirectory(): Promise<{
    items: Record<string, FileSystemItem>;
    rootId: string;
    path: string;
    errors: string[];
  } | null> {
    try {
      await this.refreshStructure();
      this.filePaths.clear();
      this.currentDirectory = null;

      const response = await fetch(`${this.API_URL}/open-directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        logger.error('Failed to open directory', new Error(response.statusText));
        return null;
      }

      const data = await response.json();
      this.setCurrentDirectory(data.path);

      Object.values(data.items as Record<string, FileSystemItem>).forEach((item: FileSystemItem) => {
        if (item.type === 'file') {
          this.filePaths.set(item.id, this.normalizePath(item.path));
        }
      });

      logger.info('Directory opened', { path: data.path });
      return data;
    } catch (error) {
      logger.error('Error opening directory', error);
      return null;
    }
  }

  /**
   * Open specific directory by path
   */
  static async openSpecificDirectory(path: string): Promise<{
    items: Record<string, FileSystemItem>;
    rootId: string;
    errors: string[];
  } | null> {
    try {
      await this.refreshStructure();
      this.filePaths.clear();

      const response = await fetch(`${this.API_URL}/open-specific-directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });

      if (!response.ok) {
        logger.warn('Failed to open specific directory', { path, status: response.status });
        return null;
      }

      const data = await response.json();
      this.setCurrentDirectory(data.path);
      this.loadedFolders.add(this.normalizePath(path));

      Object.values(data.items as Record<string, FileSystemItem>).forEach((item: FileSystemItem) => {
        if (item.type === 'file') {
          this.filePaths.set(item.id, this.normalizePath(item.path));
        }
      });

      return data;
    } catch (error) {
      logger.error('Error opening specific directory', error, { path });
      return null;
    }
  }

  // ==================== File Change Events ====================

  /**
   * Subscribe to file change events
   */
  static subscribeToChanges(listener: FileChangeListener): () => void {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter(l => l !== listener);
    };
  }

  /**
   * Emit file change event
   */
  static emitChange(filePath: string, oldContent: string, newContent: string): void {
    this.diffs.push({
      filePath,
      oldContent,
      newContent,
      timestamp: Date.now()
    });

    this.changeListeners.forEach(listener => {
      try {
        listener(filePath, oldContent, newContent);
      } catch (error) {
        logger.error('Error in file change listener', error);
      }
    });

    this.refreshFileExplorer();
  }

  /**
   * Get all pending diffs
   */
  static getAllDiffs(): DiffChange[] {
    return this.diffs;
  }

  /**
   * Clear all diffs
   */
  static clearDiffs(): void {
    this.diffs = [];
  }

  /**
   * Refresh file explorer UI
   */
  private static refreshFileExplorer(): void {
    try {
      const refreshEvent = new CustomEvent('file-explorer-refresh');
      window.dispatchEvent(refreshEvent);
    } catch (error) {
      logger.error('Error refreshing file explorer', error);
    }
  }

  // ==================== Utilities ====================

  static isFolderLoaded(path: string): boolean {
    return this.loadedFolders.has(path);
  }

  static clearLoadedFolders(): void {
    this.loadedFolders.clear();
  }

  static setCurrentDirectory(path: string): void {
    this.currentDirectory = path;
    logger.debug('Current directory changed', { path });
  }

  static getCurrentDirectory(): string | null {
    return this.currentDirectory;
  }

  static clearCache(): void {
    this.fileCache.clear();
    logger.debug('File cache cleared');
  }

  /**
   * Refresh file structure from backend
   */
  private static async refreshStructure(): Promise<void> {
    try {
      const response = await fetch(`${this.API_URL}/refresh-structure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        logger.warn('Failed to refresh structure', { status: response.status });
      }
    } catch (error) {
      logger.debug('Structure refresh error', error);
    }
  }

  /**
   * Open file dialog for selecting a file
   */
  static async openFile(): Promise<{ 
    fileId: string; 
    path: string; 
    items: Record<string, FileSystemItem>; 
    rootId: string 
  } | null> {
    try {
      const response = await fetch(`${this.API_URL}/open-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        logger.warn('Failed to open file dialog', { status: response.status });
        return null;
      }

      return await response.json();
    } catch (error) {
      logger.error('Error opening file dialog', error);
      return null;
    }
  }

  /**
   * Create a new file
   */
  static async createFile(parentId: string, fileName: string): Promise<{ 
    item: FileSystemItem; 
    items: Record<string, FileSystemItem> 
  } | null> {
    try {
      const response = await fetch(`${this.API_URL}/create-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, fileName })
      });

      if (!response.ok) {
        logger.warn('Failed to create file', { status: response.status, fileName });
        return null;
      }

      logger.info('File created', { fileName });
      return await response.json();
    } catch (error) {
      logger.error('Error creating file', error, { fileName });
      return null;
    }
  }

  /**
   * Create a new directory
   */
  static async createDirectory(parentId: string, dirName: string): Promise<{ 
    item: FileSystemItem; 
    items: Record<string, FileSystemItem> 
  } | null> {
    try {
      const response = await fetch(`${this.API_URL}/create-directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, dirName })
      });

      if (!response.ok) {
        logger.warn('Failed to create directory', { status: response.status, dirName });
        return null;
      }

      logger.info('Directory created', { dirName });
      return await response.json();
    } catch (error) {
      logger.error('Error creating directory', error, { dirName });
      return null;
    }
  }

  /**
   * Delete a file or directory
   */
  static async deleteItem(path: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.API_URL}/delete-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });

      if (!response.ok) {
        logger.warn('Failed to delete item', { status: response.status, path });
        return false;
      }

      logger.info('Item deleted', { path });
      // Invalidate cache after deletion
      this.fileCache.delete(this.normalizePath(path));
      return true;
    } catch (error) {
      logger.error('Error deleting item', error, { path });
      return false;
    }
  }

  /**
   * Rename a file or directory
   */
  static async renameItem(path: string, newName: string): Promise<{ 
    item: FileSystemItem; 
    items: Record<string, FileSystemItem> 
  } | null> {
    try {
      const response = await fetch(`${this.API_URL}/rename-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, newName })
      });

      if (!response.ok) {
        logger.warn('Failed to rename item', { status: response.status, path });
        return null;
      }

      logger.info('Item renamed', { path, newName });
      // Invalidate cache after rename
      this.fileCache.delete(this.normalizePath(path));
      return await response.json();
    } catch (error) {
      logger.error('Error renaming item', error, { path });
      return null;
    }
  }

  /**
   * Read settings files from backend
   */
  static async readSettingsFiles(path: string): Promise<{ 
    settings?: any; 
    error?: string 
  } | null> {
    try {
      logger.debug('Reading settings files', { path });

      const response = await fetch(`${this.API_URL}/read-settings-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });

      if (!response.ok) {
        logger.warn('Failed to read settings files', { status: response.status });
        return null;
      }

      return await response.json();
    } catch (error) {
      logger.error('Error reading settings files', error, { path });
      return null;
    }
  }
}
