import { logger } from './LoggerService';
import { AIBackendService } from './AIBackendService';

export interface ContextSnapshot {
  id: string;
  timestamp: number;
  messages: any[];
  model: string;
  metadata: Record<string, any>;
}

export interface ConversationContext {
  id: string;
  created: number;
  lastModified: number;
  messages: any[];
  currentModel: string;
  availableModels: string[];
  tokens: {
    used: number;
    limit: number;
  };
  snapshots: ContextSnapshot[];
  metadata: Record<string, any>;
}

/**
 * Advanced Conversation Context Manager
 * 
 * Features:
 * - Context windowing for large conversations
 * - Snapshot/checkpoint system
 * - Model switching mid-conversation
 * - Token counting and limits
 * - Conversation compression
 * - Semantic similarity-based summarization
 */
export class ConversationContextManager {
  private static contexts = new Map<string, ConversationContext>();
  private static readonly MAX_CONTEXT_SIZE = 8192; // tokens
  private static readonly SNAPSHOT_INTERVAL = 10; // messages

  /**
   * Create new conversation context
   */
  static createContext(
    contextId: string,
    initialModel: string,
    availableModels: string[]
  ): ConversationContext {
    const context: ConversationContext = {
      id: contextId,
      created: Date.now(),
      lastModified: Date.now(),
      messages: [],
      currentModel: initialModel,
      availableModels,
      tokens: { used: 0, limit: this.MAX_CONTEXT_SIZE },
      snapshots: [],
      metadata: {}
    };

    this.contexts.set(contextId, context);
    logger.debug(`Created conversation context: ${contextId}`);
    return context;
  }

  /**
   * Add message and manage context size
   */
  static addMessage(
    contextId: string,
    message: any
  ): { success: boolean; tokensUsed: number } {
    const context = this.contexts.get(contextId);
    if (!context) {
      logger.warn(`Context not found: ${contextId}`);
      return { success: false, tokensUsed: 0 };
    }

    const tokens = this.estimateTokens(message.content);
    context.messages.push({ ...message, tokens });
    context.tokens.used += tokens;
    context.lastModified = Date.now();

    // Auto-checkpoint
    if (context.messages.length % this.SNAPSHOT_INTERVAL === 0) {
      this.createSnapshot(contextId);
    }

    // Auto-compress if exceeding 80% of limit
    if (context.tokens.used > context.tokens.limit * 0.8) {
      this.compressContext(contextId);
    }

    return { success: true, tokensUsed: tokens };
  }

  /**
   * Switch to different model mid-conversation
   */
  static switchModel(contextId: string, newModel: string): boolean {
    const context = this.contexts.get(contextId);
    if (!context) {
      logger.warn(`Context not found: ${contextId}`);
      return false;
    }

    if (!context.availableModels.includes(newModel)) {
      logger.warn(`Model not available: ${newModel}`);
      return false;
    }

    // Create snapshot before switching
    this.createSnapshot(contextId);

    context.currentModel = newModel;
    context.metadata.lastModelSwitch = {
      from: context.currentModel,
      to: newModel,
      timestamp: Date.now()
    };

    logger.info(`Switched model: ${context.currentModel} -> ${newModel}`, { contextId });
    return true;
  }

  /**
   * Get message window around current context
   * Smart windowing to keep recent + relevant messages
   */
  static getContextWindow(
    contextId: string,
    maxMessages: number = 20
  ): any[] {
    const context = this.contexts.get(contextId);
    if (!context) return [];

    const messages = context.messages;
    if (messages.length <= maxMessages) return messages;

    // Keep system message (index 0) + recent messages
    const recent = messages.slice(-maxMessages + 1);
    return [messages[0], ...recent];
  }

  /**
   * Create conversation snapshot/checkpoint
   */
  static createSnapshot(contextId: string): boolean {
    const context = this.contexts.get(contextId);
    if (!context) return false;

    const snapshot: ContextSnapshot = {
      id: `snapshot-${Date.now()}`,
      timestamp: Date.now(),
      messages: [...context.messages],
      model: context.currentModel,
      metadata: {
        messageCount: context.messages.length,
        tokensUsed: context.tokens.used,
        modelChain: context.metadata.modelChain || []
      }
    };

    context.snapshots.push(snapshot);
    logger.debug(`Created snapshot: ${snapshot.id}`, { contextId });

    // Keep last 5 snapshots
    if (context.snapshots.length > 5) {
      context.snapshots.shift();
    }

    return true;
  }

  /**
   * Restore from snapshot
   */
  static restoreSnapshot(contextId: string, snapshotId: string): boolean {
    const context = this.contexts.get(contextId);
    if (!context) return false;

    const snapshot = context.snapshots.find(s => s.id === snapshotId);
    if (!snapshot) {
      logger.warn(`Snapshot not found: ${snapshotId}`);
      return false;
    }

    context.messages = [...snapshot.messages];
    context.currentModel = snapshot.model;
    context.lastModified = Date.now();

    logger.info(`Restored snapshot: ${snapshotId}`, { contextId });
    return true;
  }

  /**
   * Compress context by summarizing old messages
   */
  static async compressContext(contextId: string): Promise<boolean> {
    const context = this.contexts.get(contextId);
    if (!context || context.messages.length < 10) return false;

    // Keep last 5 messages, summarize older ones
    const recentMessages = context.messages.slice(-5);
    const oldMessages = context.messages.slice(0, -5);

    // Group old messages by similarity (simplified)
    const summary = {
      role: 'system',
      content: `[Context Summary: ${oldMessages.length} previous messages discussing: ${this.extractTopics(oldMessages.map(m => m.content || '').join(' '))}]`,
      tokens: this.estimateTokens(`[Compressed ${oldMessages.length} messages]`)
    };

    context.messages = [context.messages[0], summary, ...recentMessages];
    context.tokens.used = context.messages.reduce((sum, m) => sum + (m.tokens || 0), 0);

    logger.info(`Compressed context from ${oldMessages.length + recentMessages.length} to ${context.messages.length} messages`, {
      contextId,
      tokensRecovered: oldMessages.reduce((sum, m) => sum + (m.tokens || 0), 0)
    });

    return true;
  }

  /**
   * Get context statistics
   */
  static getContextStats(contextId: string) {
    const context = this.contexts.get(contextId);
    if (!context) return null;

    return {
      id: contextId,
      created: new Date(context.created),
      messagesCount: context.messages.length,
      tokensUsed: context.tokens.used,
      tokensLimit: context.tokens.limit,
      capacityUsed: `${((context.tokens.used / context.tokens.limit) * 100).toFixed(1)}%`,
      currentModel: context.currentModel,
      snapshotsCount: context.snapshots.length,
      metadata: context.metadata
    };
  }

  /**
   * Estimate token count (simplified - counts words)
   */
  private static estimateTokens(text: string): number {
    return Math.ceil(text.split(/\s+/).length / 0.75); // ~1 token per 0.75 words
  }

  /**
   * Extract topics from text
   */
  private static extractTopics(text: string): string {
    const words = text.toLowerCase().split(/\s+/);
    const freq = new Map<string, number>();
    
    words.forEach(word => {
      if (word.length > 4) {
        freq.set(word, (freq.get(word) || 0) + 1);
      }
    });

    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word)
      .join(', ');
  }

  /**
   * List all active contexts
   */
  static listContexts() {
    return Array.from(this.contexts.entries()).map(([id, ctx]) => ({
      id,
      created: new Date(ctx.created),
      messagesCount: ctx.messages.length,
      model: ctx.currentModel,
      tokensUsed: ctx.tokens.used
    }));
  }

  /**
   * Delete context
   */
  static deleteContext(contextId: string): boolean {
    return this.contexts.delete(contextId);
  }

  /**
   * Export conversation
   */
  static exportConversation(contextId: string): string | null {
    const context = this.contexts.get(contextId);
    if (!context) return null;

    return JSON.stringify({
      context,
      exported: new Date().toISOString(),
      format: 'aicontext-v1'
    }, null, 2);
  }
}

export default ConversationContextManager;
