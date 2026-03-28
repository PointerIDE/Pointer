import { Message } from '../types';
import { ChatSession, ExtendedMessage } from '../config/chatConfig';
import { API_CONFIG } from '../config/apiConfig';
import { logger } from './LoggerService';

// Re-export ChatSession for backward compatibility
export type { ChatSession };

export class ChatService {
  private static get API_URL(): string {
    return API_CONFIG.API_URL;
  }

  /**
   * Generate a simple chat name from the first user message
   */
  private static generateChatName(messages: ExtendedMessage[]): string {
    const firstUserMessage = messages.find(m => m.role === 'user');
    if (firstUserMessage && typeof firstUserMessage.content === 'string') {
      const nameBase = firstUserMessage.content.trim().substring(0, 50);
      return nameBase.length > 0 ? nameBase : `Chat ${new Date().toLocaleString()}`;
    }
    return `Chat ${new Date().toLocaleString()}`;
  }

  /**
   * Clean messages before saving - remove problematic content and ensure proper structure
   */
  private static cleanMessagesForSaving(messages: ExtendedMessage[]): ExtendedMessage[] {
    return messages.map(msg => {
      // Create a clean copy of the message
      const cleanMsg: any = {
        role: msg.role,
        content: msg.content || ''
      };

      // Only include essential fields
      if (msg.tool_call_id) {
        cleanMsg.tool_call_id = msg.tool_call_id;
      }

      if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        cleanMsg.tool_calls = msg.tool_calls.map((tc: any) => ({
          id: tc.id || `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'function',
          function: {
            name: tc.function?.name || tc.name || 'unknown',
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {})
          }
        }));
      }

      // Only filter out specific problematic patterns, not legitimate tool results
      if (typeof cleanMsg.content === 'string') {
        // For tool messages, be very conservative about cleaning
        if (msg.role === 'tool') {
          // Only clear tool messages that contain clearly malformed function call syntax
          if (cleanMsg.content.includes('function_call:') && 
              cleanMsg.content.includes('tool_call:') &&
              cleanMsg.content.includes('ERROR:')) {
            // This is likely malformed tool call syntax, clear it
            cleanMsg.content = '';
          }
          // Keep all other tool content, including "Success" and JSON objects
        } else {
          // For non-tool messages, be more aggressive about cleaning
          if (cleanMsg.content.includes('function_call:') && 
              cleanMsg.content.includes('tool_call:') &&
              cleanMsg.content.includes('ERROR:')) {
            // This is likely malformed tool call syntax, clear it
            cleanMsg.content = '';
          }
        }
      }

      return cleanMsg;
    });
  }

  /**
   * Save chat to the backend with clean, simple logic
   */
  static async saveChat(chatId: string, messages: ExtendedMessage[]): Promise<boolean> {
    try {
      if (messages.length <= 1) {
        logger.debug('Skipping save - not enough messages');
        return false;
      }

      // Clean messages before saving
      const cleanMessages = this.cleanMessagesForSaving(messages);
      
      const chatSession: ChatSession = {
        id: chatId,
        name: this.generateChatName(messages),
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        messages: cleanMessages,
      };

      logger.info(`Saving chat ${chatId} with ${cleanMessages.length} messages`);
      
      // Debug: log tool message content
      cleanMessages.forEach((msg, index) => {
        if (msg.role === 'tool') {
          console.log(`Tool message ${index}: content="${msg.content}" (length: ${msg.content.length})`);
        }
      });

      const response = await fetch(`${this.API_URL}/chats/${chatId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: cleanMessages,
          overwrite: true // Always overwrite to ensure clean state
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save chat: ${response.status}`);
      }

      console.log(`Chat ${chatId} saved successfully`);
      return true;
    } catch (error) {
      logger.error('Error saving chat', error);
      return false;
    }
  }

  /**
   * Load chat from the backend
   */
  static async loadChat(chatId: string): Promise<ChatSession | null> {
    try {
      const response = await fetch(`${this.API_URL}/chats/${chatId}`);
      if (!response.ok) {
        if (response.status === 404) {
          logger.warn(`Chat ${chatId} not found`);
          return null;
        }
        throw new Error(`Failed to load chat: ${response.status}`);
      }
      
      const chat = await response.json();
      
      // Validate chat structure
      if (!chat || !Array.isArray(chat.messages)) {
        logger.error('Invalid chat structure', new Error('Chat validation failed'), { chat });
        return null;
      }

      // Clean loaded messages
      const cleanMessages = this.cleanMessagesForSaving(chat.messages);
      
      return {
        id: chat.id || chatId,
        name: chat.name || 'New Chat',
        createdAt: chat.createdAt || new Date().toISOString(),
        lastModified: chat.lastModified || new Date().toISOString(),
        messages: cleanMessages
      };
    } catch (error) {
      logger.error('Error loading chat', error, { chatId });
      return null;
    }
  }

  /**
   * List all available chats
   */
  static async listChats(): Promise<ChatSession[]> {
    try {
      const response = await fetch(`${this.API_URL}/chats`);
      if (!response.ok) {
        throw new Error('Failed to list chats');
      }
      
      const chats = await response.json();
      
      // Filter out invalid chats and sort by creation time
      return chats
        .filter((chat: any) => chat && chat.messages && Array.isArray(chat.messages) && chat.messages.length > 0)
        .sort((a: ChatSession, b: ChatSession) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    } catch (error) {
      logger.error('Error listing chats', error);
      return [];
    }
  }

  /**
   * Delete a chat
   */
  static async deleteChat(chatId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.API_URL}/chats/${chatId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error(`Failed to delete chat: ${response.status}`);
      }
      
      logger.info(`Chat ${chatId} deleted successfully`);
      return true;
    } catch (error) {
      logger.error('Error deleting chat', error, { chatId });
      return false;
    }
  }
} 