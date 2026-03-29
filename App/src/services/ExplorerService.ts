import { logger } from './LoggerService';

export class ExplorerService {
  /**
   * Opens a file or folder in the system's default file explorer
   * @param filePath - The path to the file or folder
   * @param currentDirectory - The current working directory (optional)
   * @returns Promise<{success: boolean, error?: string}>
   */
  static async openInExplorer(filePath: string, currentDirectory?: string): Promise<{success: boolean, error?: string}> {
    try {
      // Construct the full path if needed
      let fullPath = filePath;
      
      // If the path is not absolute and we have a current directory, construct the full path
      if (!this.isAbsolutePath(filePath) && currentDirectory) {
        fullPath = this.joinPaths(currentDirectory, filePath);
      }
      
      logger.debug('Opening in explorer', { 
        originalPath: filePath, 
        fullPath, 
        currentDirectory,
        isAbsolute: this.isAbsolutePath(filePath)
      });
      
      // Check if we're running in Electron
      if (typeof window !== 'undefined' && (window as any).electron?.openInExplorer) {
        const result = await (window as any).electron.openInExplorer(fullPath);
        return result;
      } else {
        // Fallback for non-Electron environments (web)
        throw new Error('Not running in Electron environment');
      }
    } catch (error) {
      logger.error('Error opening in explorer', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Checks if a path is absolute
   * @param path - The path to check
   * @returns boolean
   */
  private static isAbsolutePath(path: string): boolean {
    // Check for absolute paths on different platforms
    return path.startsWith('/') || // Unix/Linux/macOS
           path.startsWith('\\') || // Windows
           /^[A-Za-z]:[\\\/]/.test(path); // Windows drive letter
  }

  /**
   * Joins two path segments
   * @param basePath - The base path
   * @param relativePath - The relative path to join
   * @returns string
   */
  private static joinPaths(basePath: string, relativePath: string): string {
    // Normalize slashes to forward slashes
    const normalizedBase = basePath.replace(/\\/g, '/');
    const normalizedRelative = relativePath.replace(/\\/g, '/');
    
    // Remove trailing slash from base path if it exists
    const cleanBase = normalizedBase.endsWith('/') ? normalizedBase.slice(0, -1) : normalizedBase;
    
    // Remove leading slash from relative path if it exists
    const cleanRelative = normalizedRelative.startsWith('/') ? normalizedRelative.slice(1) : normalizedRelative;
    
    return `${cleanBase}/${cleanRelative}`;
  }

  /**
   * Opens the parent folder of a file in the system explorer
   * @param filePath - The path to the file
   * @returns Promise<{success: boolean, error?: string}>
   */
  static async openParentFolder(filePath: string): Promise<{success: boolean, error?: string}> {
    try {
      // Use string manipulation instead of require('path')
      const lastSlashIndex = filePath.lastIndexOf('/');
      const lastBackslashIndex = filePath.lastIndexOf('\\');
      const lastSeparatorIndex = Math.max(lastSlashIndex, lastBackslashIndex);
      
      if (lastSeparatorIndex === -1) {
        throw new Error('No directory separator found in path');
      }
      
      const parentDir = filePath.substring(0, lastSeparatorIndex);
      return await this.openInExplorer(parentDir);
    } catch (error) {
      logger.error('Error opening parent folder', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
} 