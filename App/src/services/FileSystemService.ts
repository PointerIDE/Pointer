import { FileSystemItem } from '../types';
import { RecentProjectsService } from './RecentProjectsService';
import { FileReaderService } from './FileReaderService';

export class FileSystemService {
  private static readonly API_URL = 'http://localhost:23816';
  private static filePaths = new Map<string, string>();
  private static loadedFolders = new Set<string>();
  private static currentDirectory: string | null = null;
  private static fileCache: Map<string, string> = new Map();

  private static normalizePath(path: string): string {
    // Normalize the path to use forward slashes
    let normalized = path.replace(/\\/g, '/');
    
    // If it's a root path (e.g. /file.txt), keep the leading slash
    if (path.startsWith('/') || path.startsWith('\\')) {
      return normalized;
    }
    
    // Otherwise, remove any leading slashes
    return normalized.replace(/^\/+/, '');
  }

  // Helper method to generate consistent file IDs
  private static generateFileId(path: string): string {
    const normalizedPath = this.normalizePath(path);
    return `file_${normalizedPath}`;
  }

  static async fetchFolderContents(path: string): Promise<{ 
    items: Record<string, FileSystemItem>; 
    rootId: string; 
    errors: string[] 
  } | null> {
    try {
      await this.refreshStructure();
      const normalizedPath = this.normalizePath(path);
      console.log('Fetching contents for normalized path:', normalizedPath);

      const response = await fetch(`${this.API_URL}/fetch-folder-contents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          path: normalizedPath,
          currentDir: this.currentDirectory 
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch((): null => null);
        console.error('Failed to fetch folder contents:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData,
          path: normalizedPath
        });
        return null;
      }

      const data = await response.json();
      
      // Store file paths
      Object.values(data.items as Record<string, FileSystemItem>).forEach((item: FileSystemItem) => {
        if (item.type === 'file') {
          this.filePaths.set(item.id, this.normalizePath(item.path));
        }
      });

      this.loadedFolders.add(normalizedPath);
      return data;
    } catch (error) {
      console.error('Error fetching folder contents:', error);
      return null;
    }
  }

  static isFolderLoaded(path: string): boolean {
    return this.loadedFolders.has(path);
  }

  static clearLoadedFolders() {
    this.loadedFolders.clear();
  }

  static setCurrentDirectory(path: string) {
    this.currentDirectory = path;
    console.log('Set current directory to:', path);
  }

  static async openDirectory(): Promise<{ 
    items: Record<string, FileSystemItem>; 
    rootId: string;
    path: string;
    errors: string[] 
  } | null> {
    try {
      await this.refreshStructure();
      // Reset file paths when opening a new directory
      this.filePaths.clear();
      this.currentDirectory = null;

      const response = await fetch(`${this.API_URL}/open-directory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to open directory: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Set current directory
      this.setCurrentDirectory(data.path);

      // Store file paths
      Object.values(data.items as Record<string, FileSystemItem>).forEach((item: FileSystemItem) => {
        if (item.type === 'file') {
          this.filePaths.set(item.id, this.normalizePath(item.path));
        }
      });

      return data;
    } catch (error) {
      console.error('Error opening directory:', error);
      return null;
    }
  }

  static async openSpecificDirectory(path: string): Promise<{ 
    items: Record<string, FileSystemItem>; 
    rootId: string; 
    errors: string[] 
  } | null> {
    try {
      await this.refreshStructure();
      // Reset file paths when opening a new directory
      this.filePaths.clear();

      const response = await fetch(`${this.API_URL}/open-specific-directory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path })
      });

      if (!response.ok) {
        throw new Error(`Failed to open directory: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Set current directory
      this.setCurrentDirectory(path);

      // Store file paths
      Object.values(data.items as Record<string, FileSystemItem>).forEach((item: FileSystemItem) => {
        if (item.type === 'file') {
          this.filePaths.set(item.id, this.normalizePath(item.path));
        }
      });

      return data;
    } catch (error) {
      console.error('Error opening directory:', error);
      return null;
    }
  }

  static async readFile(fileId: string): Promise<string | null> {
    try {
      await this.refreshStructure();
      // Clear the cache for this specific file
      this.fileCache.delete(fileId);
      
      let filePath = this.filePaths.get(fileId);
      
      // If we can't find the path directly, try a fallback strategy
      if (!filePath) {
        console.warn(`No direct path found for file ID: ${fileId}, trying fallback methods`);
        
        // If it starts with 'file_', try to extract the path
        if (fileId.startsWith('file_')) {
          const extractedPath = fileId.substring(5); // Remove 'file_' prefix
          console.log(`Extracted path from ID: ${extractedPath}`);
          
          // Try to normalize the extracted path
          const normalizedPath = this.normalizePath(extractedPath);
          
          // Check if this path exists on disk or is accessible
          try {
            // Let's try to use it directly
            filePath = normalizedPath;
            
            // Also store this mapping for future use
            this.filePaths.set(fileId, filePath);
            console.log(`Created new mapping for ID ${fileId} -> ${filePath}`);
            
            // Also add mapping with consistent ID for future use
            const consistentId = this.generateFileId(normalizedPath);
            if (consistentId !== fileId) {
              console.log(`Adding alternative mapping: ${consistentId} -> ${filePath}`);
              this.filePaths.set(consistentId, filePath);
            }
          } catch (err) {
            console.error(`Failed to validate path ${normalizedPath}:`, err);
          }
        }
      }
      
      if (!filePath) {
        console.error(`No path found for file ID: ${fileId}`);
        return null;
      }

      const normalizedPath = this.normalizePath(filePath);
      console.log('Reading file:', { fileId, filePath, normalizedPath, currentDir: this.currentDirectory });
      
      // For root paths, use the path as is without modifying current directory
      const effectiveCurrentDir = this.currentDirectory;
      if (!effectiveCurrentDir && (filePath.startsWith('/') || filePath.startsWith('\\'))) {
        console.log('Reading root file with path:', normalizedPath);
      }
      
      return await FileReaderService.readFile(normalizedPath);
      
    } catch (error) {
      console.error(`Error reading file ${fileId}:`, error);
      return null;
    }
  }

  static async saveFile(path: string, content: string): Promise<{ success: boolean, content: string }> {
    try {
      await this.refreshStructure();
      
      // Handle both file IDs and regular paths
      // If this is a file ID that we already know about, use the stored path
      let pathToUse = path;
      if (path.startsWith('file_')) {
        const storedPath = this.filePaths.get(path);
        if (storedPath) {
          console.log(`Using stored path for file ID ${path}: ${storedPath}`);
          pathToUse = storedPath;
        }
      } else {
        // Regular path, normalize it
        pathToUse = this.normalizePath(path);
      }
      
      // Don't require currentDirectory for root paths or absolute paths
      const isRootPath = pathToUse.startsWith('/') || pathToUse.startsWith('\\');
      if (!this.currentDirectory && !isRootPath) {
        throw new Error('No directory opened');
      }

      const response = await fetch(`${this.API_URL}/save-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          path: pathToUse,
          content,
          currentDir: isRootPath ? null : this.currentDirectory
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch((): null => null);
        console.error('Server error:', {
          status: response.status,
          statusText: response.statusText
        });
        if (errorData) {
          console.error('Error details:', errorData);
        }
        throw new Error(`Failed to save file: ${response.statusText}`);
      }

      // Return both success status and the saved content
      return { success: true, content };
    } catch (error) {
      console.error(`Error saving file ${path}:`, error);
      throw error;
    }
  }

  static async createFile(parentId: string, name: string): Promise<{ id: string, file: FileSystemItem } | null> {
    try {
      await this.refreshStructure();
      const response = await fetch(`${this.API_URL}/create-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parentId,
          name,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create file: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating file:', error);
      return null;
    }
  }

  static async createDirectory(parentId: string, name: string): Promise<{ id: string, directory: FileSystemItem } | null> {
    try {
      await this.refreshStructure();
      const response = await fetch(`${this.API_URL}/create-directory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parentId,
          name,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create directory: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating directory:', error);
      return null;
    }
  }

  static async openFile(): Promise<{ content: string, filename: string, fullPath: string, id: string } | null> {
    try {
      await this.refreshStructure();
      const response = await fetch(`${this.API_URL}/open-file`, {
        method: 'POST',
        headers: {
          'Accept': 'text/plain'
        }
      });

      if (!response.ok) {
        console.error('Failed to open file:', response.statusText);
        return null;
      }

      // Log all response headers for debugging
      console.log('Response headers:', Array.from(response.headers.entries()));

      const content = await response.text();
      const filename = response.headers.get('X-Filename');
      const fullPath = response.headers.get('X-Full-Path');
      
      console.log('Received headers:', { filename, fullPath });

      if (!filename || !fullPath) {
        console.error('Missing required headers:', {
          filename: filename || 'missing',
          fullPath: fullPath || 'missing'
        });
        return null;
      }

      // Generate a consistent file ID based on the path using our helper
      const id = this.generateFileId(fullPath);
      
      // Store the original full path in our map
      this.filePaths.set(id, fullPath);
      
      console.log('Stored file path:', { id, path: fullPath });
      
      return { content, filename, fullPath, id };
    } catch (error) {
      console.error('Error opening file:', error);
      return null;
    }
  }

  static async deleteItem(path: string): Promise<boolean> {
    try {
      await this.refreshStructure();
      const response = await fetch(`${this.API_URL}/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to delete item:', errorData);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error deleting item:', error);
      return false;
    }
  }

  static async readText(filePath: string): Promise<string | null> {
    try {
      await this.refreshStructure();
      console.log('Reading text file:', filePath);
      return await FileReaderService.readFile(filePath);
    } catch (error) {
      console.error(`Error reading text file:`, error);
      return null;
    }
  }

  static async renameItem(path: string, newName: string): Promise<{ success: boolean, newPath: string | null }> {
    try {
      await this.refreshStructure();
      const response = await fetch(`${this.API_URL}/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path,
          new_name: newName,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to rename item:', errorData);
        return { success: false, newPath: null };
      }

      const data = await response.json();
      return { 
        success: data.success, 
        newPath: data.new_path || null // Ensure we always return a string or null
      };
    } catch (error) {
      console.error('Error renaming item:', error);
      return { success: false, newPath: null };
    }
  }

  static getCurrentDirectory(): string | null {
    return this.currentDirectory;
  }

  static async readSettingsFiles(settingsDir: string): Promise<{ success: boolean, settings: Record<string, any> }> {
    try {
      await this.refreshStructure();
      
      const response = await fetch(`${this.API_URL}/read-settings-files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ settingsDir })
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('text/html')) {
          console.error(`Backend returned HTML instead of JSON (Status: ${response.status})`);
          console.error('This usually means the backend server is not running or encountered an error.');
          return { success: false, settings: {} };
        }
        throw new Error(`Failed to read settings files: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        const text = await response.text();
        console.error(`Backend returned non-JSON response: ${contentType}`);
        console.error('Response preview:', text.substring(0, 100));
        return { success: false, settings: {} };
      }

      const data = await response.json();
      return { success: true, settings: data.settings };
    } catch (error) {
      console.error('Error reading settings files:', error);
      return { success: false, settings: {} };
    }
  }

  static async saveSettingsFiles(settingsDir: string, settings: Record<string, any>): Promise<{ success: boolean }> {
    try {
      await this.refreshStructure();
      
      const response = await fetch(`${this.API_URL}/save-settings-files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ settingsDir, settings })
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('text/html')) {
          console.error(`Backend returned HTML instead of JSON (Status: ${response.status})`);
          console.error('This usually means the backend server is not running or encountered an error.');
          return { success: false };
        }
        throw new Error(`Failed to save settings files: ${response.statusText}`);
      }

      return { success: true };
    } catch (error) {
      console.error('Error saving settings files:', error);
      return { success: false };
    }
  }

  static async refreshStructure() {
    if (!this.getCurrentDirectory()) {
      return null;
    }

    try {
      // Store the old file paths before clearing
      const oldFilePaths = new Map(this.filePaths);
      
      // Clear all caches
      this.loadedFolders.clear();
      this.fileCache.clear();
      this.filePaths.clear();  // Also clear file paths

      const response = await fetch(`${this.API_URL}/open-specific-directory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: this.getCurrentDirectory()
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to refresh directory');
      }

      const data = await response.json();

      // Update file paths after refresh
      Object.values(data.items as Record<string, FileSystemItem>).forEach((item: FileSystemItem) => {
        if (item.type === 'file') {
          // Store both normalized and original paths for more robust lookup
          const normalizedPath = this.normalizePath(item.path);
          this.filePaths.set(item.id, normalizedPath);
          
          // Also create an alternative ID entry for any externally opened files
          // This helps handle files opened directly from disk
          const alternativeId = this.generateFileId(normalizedPath);
          if (alternativeId !== item.id) {
            console.log(`Adding alternative mapping: ${alternativeId} -> ${normalizedPath} (original ID: ${item.id})`);
            this.filePaths.set(alternativeId, normalizedPath);
          }
          
          // Restore any old mappings to maintain compatibility with existing file IDs
          if (oldFilePaths.has(item.id)) {
            this.filePaths.set(item.id, oldFilePaths.get(item.id)!);
          }
        }
      });

      return data;
    } catch (error) {
      console.error('Error refreshing directory:', error);
      throw error;
    }
  }

  static async listDirectory(path: string): Promise<string[]> {
    try {
      const response = await fetch(`http://localhost:23816/list-directory?path=${encodeURIComponent(path)}`);
      if (!response.ok) {
        throw new Error(`Failed to list directory: ${response.statusText}`);
      }
      const data = await response.json();
      return data.contents;
    } catch (error) {
      console.error('Error listing directory:', error);
      throw error;
    }
  }
}