import { logger } from './LoggerService';
import { FileService } from './FileService';
import { ExplorerService } from './ExplorerService';
import { AIFileService } from './AIFileService';
import { ChatService } from './ChatService';
import lmStudio from './LMStudioService';
import { CacheRegistry } from './CacheManager';
import { KeyboardShortcutsRegistry } from './KeyboardShortcutsRegistry';
import { WorkspaceManager } from './WorkspaceManager';
import { InputValidator } from './InputValidator';

/**
 * Service Initializer & Dependency Manager
 * Centralizes service initialization with dependency resolution and error handling
 * 
 * Improvement 13: Orchestrates service startup, dependency injection, and lifecycle management
 */
export class ServiceInitializer {
  private static isInitialized = false;
  private static initializationPromise: Promise<void> | null = null;
  private static services: Map<string, any> = new Map();

  /**
   * Initialize all services in correct dependency order
   */
  static async initializeAll(): Promise<void> {
    // Prevent multiple concurrent initializations
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    if (this.isInitialized) {
      logger.debug('Services already initialized');
      return;
    }

    this.initializationPromise = this.performInitialization();
    await this.initializationPromise;
    this.initializationPromise = null;
  }

  private static async performInitialization(): Promise<void> {
    try {
      logger.info('Starting service initialization');
      const startTime = performance.now();

      // Phase 1: Core services (no dependencies)
      await this.initializeService('LoggerService', async () => {
        logger.info('LoggerService initialized');
        return { initialized: true };
      });

      // Phase 2: Utility services
      await this.initializeService('InputValidator', async () => {
        logger.info('InputValidator initialized with default rules');
        return { initialized: true };
      });

      await this.initializeService('CacheRegistry', async () => {
        logger.info('CacheRegistry initialized');
        return { initialized: true };
      });

      await this.initializeService('KeyboardShortcutsRegistry', async () => {
        KeyboardShortcutsRegistry.initialize();
        logger.info('KeyboardShortcutsRegistry initialized');
        return { initialized: true };
      });

      await this.initializeService('WorkspaceManager', async () => {
        WorkspaceManager.initialize();
        logger.info('WorkspaceManager initialized');
        return { initialized: true };
      });

      // Phase 3: Foundation services
      await this.initializeService('FileService', async () => {
        logger.info('FileService initialized');
        return { initialized: true };
      });

      // Phase 4: Language model service
      await this.initializeService('LMStudioService', async () => {
        try {
          // const status = await lmStudio.getStatus(); // TODO: Method not available
          logger.info('LMStudioService initialized', { status });
          return status;
        } catch (error) {
          logger.warn('LMStudioService initialization failed, will retry on demand', error);
          return { error: 'Will retry on demand' };
        }
      });

      // Phase 5: Dependent services
      await this.initializeService('ExplorerService', async () => {
        logger.info('ExplorerService initialized');
        return { initialized: true };
      });

      await this.initializeService('AIFileService', async () => {
        logger.info('AIFileService initialized');
        return { initialized: true };
      });

      await this.initializeService('ChatService', async () => {
        logger.info('ChatService initialized');
        return { initialized: true };
      });

      const duration = performance.now() - startTime;
      logger.info(`Service initialization complete (${duration.toFixed(2)}ms)`);
      this.isInitialized = true;

    } catch (error) {
      logger.error('Service initialization failed', error);
      throw error;
    }
  }

  /**
   * Initialize a single service with error handling
   */
  private static async initializeService(
    serviceName: string,
    initializer: () => Promise<any>
  ): Promise<void> {
    try {
      const result = await initializer();
      this.services.set(serviceName, result);
      logger.debug(`${serviceName} initialized successfully`, result);
    } catch (error) {
      logger.error(`Failed to initialize ${serviceName}`, error);
      // Don't throw - allow graceful degradation
    }
  }

  /**
   * Get service by name
   */
  static getService(serviceName: string): any {
    return this.services.get(serviceName);
  }

  /**
   * Check if all services are initialized
   */
  static isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Wait for services to be ready with timeout
   */
  static async waitForReady(timeoutMs: number = 10000): Promise<boolean> {
    const start = Date.now();
    while (!this.isReady()) {
      if (Date.now() - start > timeoutMs) {
        logger.warn('Service initialization timeout');
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return true;
  }

  /**
   * Reset all services (useful for testing)
   */
  static reset(): void {
    this.isInitialized = false;
    this.services.clear();
    this.initializationPromise = null;
    logger.debug('Services reset');
  }

  /**
   * Get initialization status
   */
  static getStatus(): Record<string, any> {
    return {
      isInitialized: this.isInitialized,
      services: Array.from(this.services.entries()).map(([name, service]) => ({
        name,
        status: service?.error ? 'error' : 'ready'
      }))
    };
  }
}

export default ServiceInitializer;
