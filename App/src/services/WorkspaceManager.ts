import { logger } from './LoggerService';
import { FileSystemItem } from '../types';

/**
 * Multi-Workspace Support Manager
 * Manages multiple workspaces with independent contexts and shared settings
 * 
 * Improvement 23: Professional multi-workspace architecture
 */

export interface Workspace {
  id: string;
  name: string;
  path: string;
  description?: string;
  created: number;
  lastOpened: number;
  settings: Record<string, any>; // Workspace-specific settings
  fileSystemState?: {
    items: Record<string, FileSystemItem>;
    currentFileId: string | null;
    rootId: string;
  };
  openFiles: string[];
  openTabs: string[];
  currentTabId: string | null;
  gitBranch?: string;
  isDirty: boolean;
}

export interface WorkspaceConfig {
  maxWorkspaces?: number;
  autoSave?: boolean;
  autoSaveInterval?: number;
}

export class WorkspaceManager {
  private static workspaces = new Map<string, Workspace>();
  private static currentWorkspaceId: string | null = null;
  private static config: WorkspaceConfig;
  private static sharedSettings: Record<string, any> = {};
  private static autoSaveTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Initialize workspace manager
   */
  static initialize(config: WorkspaceConfig = {}): void {
    this.config = {
      maxWorkspaces: config.maxWorkspaces ?? 10,
      autoSave: config.autoSave ?? true,
      autoSaveInterval: config.autoSaveInterval ?? 30000 // 30 seconds
    };

    this.loadWorkspaces();
    logger.info('WorkspaceManager initialized', { config: this.config });
  }

  /**
   * Create a new workspace
   */
  static createWorkspace(
    name: string,
    path: string,
    description?: string
  ): Workspace | null {
    // Validate workspace count
    if (this.workspaces.size >= this.config.maxWorkspaces!) {
      logger.warn('Maximum workspace limit reached', {
        limit: this.config.maxWorkspaces,
        current: this.workspaces.size
      });
      return null;
    }

    // Check for duplicate paths/names
    for (const ws of this.workspaces.values()) {
      if (ws.path === path) {
        logger.warn('Workspace with this path already exists', { path });
        return null;
      }
      if (ws.name === name) {
        logger.warn('Workspace with this name already exists', { name });
        return null;
      }
    }

    const id = this.generateWorkspaceId();
    const workspace: Workspace = {
      id,
      name,
      path,
      description,
      created: Date.now(),
      lastOpened: Date.now(),
      settings: this.getDefaultWorkspaceSettings(),
      openFiles: [],
      openTabs: [],
      currentTabId: null,
      isDirty: false
    };

    this.workspaces.set(id, workspace);
    logger.info('Workspace created', { id, name, path });

    if (this.config.autoSave) {
      this.startAutoSave(id);
    }

    return workspace;
  }

  /**
   * Open/switch to workspace
   */
  static openWorkspace(workspaceId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      logger.warn('Workspace not found', { workspaceId });
      return false;
    }

    // Save current workspace state before switching
    if (this.currentWorkspaceId) {
      const current = this.workspaces.get(this.currentWorkspaceId);
      if (current) {
        current.lastOpened = Date.now();
        logger.debug('Saved workspace state', { workspaceId: this.currentWorkspaceId });
      }
    }

    this.currentWorkspaceId = workspaceId;
    workspace.lastOpened = Date.now();

    logger.info('Workspace opened', { workspaceId, name: workspace.name });
    return true;
  }

  /**
   * Get current workspace
   */
  static getCurrentWorkspace(): Workspace | null {
    if (!this.currentWorkspaceId) return null;
    return this.workspaces.get(this.currentWorkspaceId) || null;
  }

  /**
   * Get workspace by ID
   */
  static getWorkspace(workspaceId: string): Workspace | null {
    return this.workspaces.get(workspaceId) || null;
  }

  /**
   * List all workspaces
   */
  static listWorkspaces(): Workspace[] {
    return Array.from(this.workspaces.values()).sort(
      (a, b) => b.lastOpened - a.lastOpened
    );
  }

  /**
   * Rename workspace
   */
  static renameWorkspace(workspaceId: string, newName: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      logger.warn('Workspace not found', { workspaceId });
      return false;
    }

    // Check for duplicate names
    for (const ws of this.workspaces.values()) {
      if (ws.id !== workspaceId && ws.name === newName) {
        logger.warn('Workspace with this name already exists', { newName });
        return false;
      }
    }

    const oldName = workspace.name;
    workspace.name = newName;
    workspace.isDirty = true;

    logger.info('Workspace renamed', { workspaceId, oldName, newName });
    return true;
  }

  /**
   * Update workspace settings (workspace-specific)
   */
  static updateWorkspaceSettings(
    workspaceId: string,
    settings: Record<string, any>
  ): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      logger.warn('Workspace not found', { workspaceId });
      return false;
    }

    workspace.settings = { ...workspace.settings, ...settings };
    workspace.isDirty = true;

    logger.debug('Workspace settings updated', { workspaceId, settings });
    return true;
  }

  /**
   * Get workspace settings (merged with shared settings)
   */
  static getWorkspaceSettings(workspaceId: string): Record<string, any> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return { ...this.sharedSettings };

    return {
      ...this.sharedSettings,
      ...workspace.settings
    };
  }

  /**
   * Update shared settings (applies to all workspaces)
   */
  static updateSharedSettings(settings: Record<string, any>): void {
    this.sharedSettings = { ...this.sharedSettings, ...settings };
    logger.debug('Shared settings updated', { settings });

    // Mark all workspaces as dirty
    for (const ws of this.workspaces.values()) {
      ws.isDirty = true;
    }
  }

  /**
   * Get shared settings
   */
  static getSharedSettings(): Record<string, any> {
    return { ...this.sharedSettings };
  }

  /**
   * Update workspace file system state
   */
  static updateWorkspaceFileSystem(workspaceId: string, fileSystemState: any): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    workspace.fileSystemState = fileSystemState;
    workspace.isDirty = true;
    logger.debug('Workspace file system updated', { workspaceId });
  }

  /**
   * Update workspace open files
   */
  static updateOpenFiles(workspaceId: string, files: string[]): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    workspace.openFiles = files;
    workspace.isDirty = true;
  }

  /**
   * Update workspace open tabs
   */
  static updateOpenTabs(workspaceId: string, tabs: string[], currentTabId?: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    workspace.openTabs = tabs;
    if (currentTabId) workspace.currentTabId = currentTabId;
    workspace.isDirty = true;
  }

  /**
   * Close workspace (don't delete, just close)
   */
  static closeWorkspace(workspaceId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;

    if (this.currentWorkspaceId === workspaceId) {
      // Switch to another workspace if available
      const remaining = this.listWorkspaces().find(ws => ws.id !== workspaceId);
      if (remaining) {
        this.openWorkspace(remaining.id);
      } else {
        this.currentWorkspaceId = null;
      }
    }

    // Stop auto-save
    const timer = this.autoSaveTimers.get(workspaceId);
    if (timer) {
      clearInterval(timer);
      this.autoSaveTimers.delete(workspaceId);
    }

    logger.info('Workspace closed', { workspaceId, name: workspace.name });
    return true;
  }

  /**
   * Delete workspace (remove permanently)
   */
  static deleteWorkspace(workspaceId: string): boolean {
    if (this.currentWorkspaceId === workspaceId) {
      this.closeWorkspace(workspaceId);
    }

    const removed = this.workspaces.delete(workspaceId);
    if (removed) {
      logger.warn('Workspace deleted', { workspaceId });
    }
    return removed;
  }

  /**
   * Save workspace state to storage
   */
  static saveWorkspace(workspaceId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;

    try {
      const serialized = this.serializeWorkspace(workspace);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`workspace:${workspaceId}`, JSON.stringify(serialized));
        workspace.isDirty = false;
        logger.debug('Workspace saved', { workspaceId, name: workspace.name });
      }
      return true;
    } catch (error) {
      logger.error('Failed to save workspace', error, { workspaceId });
      return false;
    }
  }

  /**
   * Save all workspaces
   */
  static saveAll(): void {
    for (const ws of this.workspaces.values()) {
      if (ws.isDirty) {
        this.saveWorkspace(ws.id);
      }
    }
    logger.debug('All workspaces saved');
  }

  /**
   * Load all workspaces from storage
   */
  private static loadWorkspaces(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('workspace:')) {
          const data = JSON.parse(localStorage.getItem(key) || '{}');
          const workspace = this.deserializeWorkspace(data);
          this.workspaces.set(workspace.id, workspace);
        }
      }
      logger.info('Workspaces loaded', { count: this.workspaces.size });
    } catch (error) {
      logger.error('Failed to load workspaces', error);
    }
  }

  /**
   * Export workspace as JSON
   */
  static exportWorkspace(workspaceId: string): Record<string, any> | null {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return null;

    return {
      name: workspace.name,
      path: workspace.path,
      description: workspace.description,
      settings: workspace.settings,
      created: new Date(workspace.created).toISOString(),
      lastOpened: new Date(workspace.lastOpened).toISOString()
    };
  }

  /**
   * Get workspace statistics
   */
  static getStats(): Record<string, any> {
    return {
      totalWorkspaces: this.workspaces.size,
      maxWorkspaces: this.config.maxWorkspaces,
      currentWorkspaceId: this.currentWorkspaceId,
      currentWorkspaceName: this.getCurrentWorkspace()?.name || null,
      workspaces: this.listWorkspaces().map(ws => ({
        id: ws.id,
        name: ws.name,
        path: ws.path,
        created: new Date(ws.created).toISOString(),
        lastOpened: new Date(ws.lastOpened).toISOString(),
        isDirty: ws.isDirty,
        openFilesCount: ws.openFiles.length
      }))
    };
  }

  // ==================== Private Helpers ====================

  private static generateWorkspaceId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private static getDefaultWorkspaceSettings(): Record<string, any> {
    return {
      theme: 'vs-dark',
      fontSize: 14,
      fontFamily: 'Fira Code',
      autoSave: true,
      autoSaveDelay: 5000,
      wordWrap: 'off',
      lineNumbers: 'on'
    };
  }

  private static serializeWorkspace(workspace: Workspace): Record<string, any> {
    return {
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      description: workspace.description,
      created: workspace.created,
      lastOpened: workspace.lastOpened,
      settings: workspace.settings,
      openFiles: workspace.openFiles,
      openTabs: workspace.openTabs,
      currentTabId: workspace.currentTabId,
      gitBranch: workspace.gitBranch,
      isDirty: false
    };
  }

  private static deserializeWorkspace(data: Record<string, any>): Workspace {
    return {
      id: data.id,
      name: data.name,
      path: data.path,
      description: data.description,
      created: data.created || Date.now(),
      lastOpened: data.lastOpened || Date.now(),
      settings: data.settings || this.getDefaultWorkspaceSettings(),
      fileSystemState: data.fileSystemState,
      openFiles: data.openFiles || [],
      openTabs: data.openTabs || [],
      currentTabId: data.currentTabId || null,
      gitBranch: data.gitBranch,
      isDirty: false
    };
  }

  private static startAutoSave(workspaceId: string): void {
    const timer = setInterval(() => {
      const workspace = this.workspaces.get(workspaceId);
      if (workspace && workspace.isDirty) {
        this.saveWorkspace(workspaceId);
      }
    }, this.config.autoSaveInterval);

    this.autoSaveTimers.set(workspaceId, timer);
  }
}

export default WorkspaceManager;
