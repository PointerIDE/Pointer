import { logger } from './LoggerService';

export interface StreamingOptions {
  batchSize?: number;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface ModelMetrics {
  responseTime: number;
  tokenCount: number;
  successRate: number;
  lastUsed: number;
}

/**
 * Enhanced AI Backend Service
 * 
 * Improvements:
 * - Smart streaming with progressive token batching
 * - Response caching with TTL
 * - Model performance tracking
 * - Automatic retry with exponential backoff
 * - Context management for large files
 * - Error recovery mechanisms
 */
export class AIBackendService {
  private static cache = new Map<string, CacheEntry<any>>();
  private static metrics = new Map<string, ModelMetrics>();
  private static readonly MAX_CACHE_SIZE = 100;
  private static readonly DEFAULT_CACHE_TTL = 60 * 60 * 1000; // 1 hour
  private static activeRequests = new Map<string, AbortController>();

  /**
   * Stream response with optimized token batching
   * Progressively yields tokens in batches for better performance
   */
  static async *streamResponse(
    endpoint: string,
    prompt: string,
    options: StreamingOptions = {}
  ): AsyncGenerator<string> {
    const {
      batchSize = 5,
      maxRetries = 3,
      retryDelay = 1000,
      timeout = 30000
    } = options;

    let retries = 0;
    let decodedBuffer = '';
    const requestId = `${Date.now()}-${Math.random()}`;
    const abortController = new AbortController();
    this.activeRequests.set(requestId, abortController);

    const timeoutId = setTimeout(() => abortController.abort(), timeout);

    try {
      while (retries < maxRetries) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream'
            },
            body: JSON.stringify({ prompt, stream: true }),
            signal: abortController.signal
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error('No response body');

          const decoder = new TextDecoder();
          let tokenBuffer: string[] = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            decodedBuffer += decoder.decode(value, { stream: true });
            
            // Parse complete lines (SSE events)
            const lines = decodedBuffer.split('\n');
            decodedBuffer = lines[lines.length - 1]; // Keep incomplete line

            for (const line of lines.slice(0, -1)) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.choices?.[0]?.delta?.content) {
                    tokenBuffer.push(data.choices[0].delta.content);
                    
                    // Batch emit for performance
                    if (tokenBuffer.length >= batchSize) {
                      yield tokenBuffer.join('');
                      tokenBuffer = [];
                    }
                  }
                } catch (e) {
                  logger.debug('Failed to parse SSE event', { line });
                }
              }
            }
          }

          // Final flush of remaining tokens
          if (tokenBuffer.length > 0) {
            yield tokenBuffer.join('');
          }

          this.recordMetrics('stream_success', { tokenCount: tokenBuffer.length });
          break; // Success - exit retry loop

        } catch (error) {
          retries++;
          if (retries < maxRetries) {
            const delay = retryDelay * Math.pow(2, retries - 1); // Exponential backoff
            logger.warn(`Streaming error, retrying in ${delay}ms`, { retries, error });
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            throw error;
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Get cached response or fetch new one
   */
  static async getCachedOrFresh<T>(
    cacheKey: string,
    fetchFn: () => Promise<T>,
    ttl: number = this.DEFAULT_CACHE_TTL
  ): Promise<T> {
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      logger.debug(`Cache hit: ${cacheKey}`);
      return cached.data;
    }

    logger.debug(`Cache miss: ${cacheKey}, fetching fresh data`);
    const data = await fetchFn();
    
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
      ttl
    });

    // Maintain max cache size
    if (this.cache.size > this.MAX_CACHE_SIZE) {
      const oldestKey = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.cache.delete(oldestKey);
    }

    return data;
  }

  /**
   * Extract relevant context from large files
   * Smart context windowing for better token usage
   */
  static extractRelevantContext(
    fileContent: string,
    query: string,
    maxLines: number = 50
  ): string {
    const lines = fileContent.split('\n');
    
    // Simple relevance scoring based on keyword matching
    const queryWords = query.toLowerCase().split(/\s+/);
    
    const scoredLines = lines.map((line, idx) => ({
      line,
      idx,
      score: queryWords.filter(word => 
        line.toLowerCase().includes(word)
      ).length
    }));

    // Get top 50% highest scored lines, then get context around them
    const relevantIndices = new Set(
      scoredLines
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(5, Math.floor(maxLines * 0.5)))
        .map(s => s.idx)
    );

    // Expand window around relevant lines
    const contextIndices = new Set(relevantIndices);
    relevantIndices.forEach(idx => {
      for (let i = Math.max(0, idx - 3); i <= Math.min(lines.length - 1, idx + 3); i++) {
        contextIndices.add(i);
      }
    });

    return Array.from(contextIndices)
      .sort((a, b) => a - b)
      .map((idx, pos, arr) => {
        const line = lines[idx];
        // Add separator if there's a gap
        const gap = idx - (arr[pos - 1] ?? -1);
        return gap > 1 ? `\n... (${gap - 1} lines omitted) ...\n${line}` : line;
      })
      .join('\n')
      .slice(0, 5000); // Limit total length
  }

  /**
   * Track model performance metrics
   */
  static recordMetrics(
    modelId: string,
    metrics: Partial<ModelMetrics>
  ): void {
    const existing = this.metrics.get(modelId) || {
      responseTime: 0,
      tokenCount: 0,
      successRate: 1,
      lastUsed: 0
    };

    const updated: ModelMetrics = {
      responseTime: metrics.responseTime ?? existing.responseTime,
      tokenCount: (existing.tokenCount + (metrics.tokenCount ?? 0)) / 2,
      successRate: metrics.successRate ?? existing.successRate,
      lastUsed: Date.now()
    };

    this.metrics.set(modelId, updated);
  }

  /**
   * Get model performance comparison
   */
  static getModelMetrics(): Record<string, ModelMetrics> {
    const result: Record<string, ModelMetrics> = {};
    this.metrics.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * Cancel active request
   */
  static cancelRequest(requestId: string): boolean {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(requestId);
      return true;
    }
    return false;
  }

  /**
   * Clear cache
   */
  static clearCache(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      logger.debug('Cache cleared');
      return;
    }

    const regex = new RegExp(pattern);
    let cleared = 0;
    this.cache.forEach((_, key) => {
      if (regex.test(key)) {
        this.cache.delete(key);
        cleared++;
      }
    });
    logger.debug(`Cleared ${cleared} cache entries matching ${pattern}`);
  }

  /**
   * Get cache statistics
   */
  static getCacheStats() {
    const entries: Array<[string, number]> = [];
    let totalSize = 0;

    this.cache.forEach((value, key) => {
      const size = JSON.stringify(value.data).length;
      entries.push([key, size]);
      totalSize += size;
    });

    return {
      size: this.cache.size,
      totalBytes: totalSize,
      avgBytes: totalSize / this.cache.size || 0,
      entries: entries.sort((a, b) => b[1] - a[1]).slice(0, 10)
    };
  }
}

export default AIBackendService;
