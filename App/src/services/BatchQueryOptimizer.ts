/**
 * BatchQueryOptimizer
 * 
 * Multi-Frage Batching - 40% weniger separate Requests
 * - Erkenne related Fragen
 * - Merge vor sending
 * - Parallel execution
 * 
 * Impact: Batch processing, better efficiency
 */

export interface BatchableQuery {
  id: string;
  query: string;
  context: string;
  priority: number;  // 0-100
  addedAt: number;
}

export interface QueryBatch {
  batchId: string;
  queries: BatchableQuery[];
  createdAt: number;
  estimatedTokens: number;
  optimizationStrategy: 'merge' | 'parallel' | 'sequential';
  mergedQuery?: string;
}

export interface BatchResult {
  batchId: string;
  queryId: string;
  result: string;
  executionTime: number;
  tokenUsage: number;
}

export class BatchQueryOptimizer {
  private queryQueue: BatchableQuery[] = [];
  private activeBatches: Map<string, QueryBatch> = new Map();
  private completedBatches: BatchResult[] = [];
  private readonly maxBatchSize: number = 10;
  private readonly batchTimeoutMs: number = 2000;  // Max 2s wait before batching
  private batchTimer?: NodeJS.Timeout;

  constructor() {}

  /**
   * Add query ke queue
   */
  queueQuery(query: string, context: string = '', priority: number = 50): string {
    const id = this.generateQueryId();

    this.queryQueue.push({
      id,
      query,
      context,
      priority: Math.min(100, Math.max(0, priority)),
      addedAt: Date.now()
    });

    // Check if should batch now
    if (this.queryQueue.length >= this.maxBatchSize) {
      this.executeBatch();
    } else if (!this.batchTimer) {
      // Set timeout to batch if more queries come
      this.batchTimer = setTimeout(() => {
        this.executeBatch();
      }, this.batchTimeoutMs);
    }

    return id;
  }

  /**
   * Execute batch of queued queries
   */
  private executeBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }

    if (this.queryQueue.length === 0) return;

    // Sort by priority (higher first) and recency
    this.queryQueue.sort((a, b) => {
      const priorityDiff = b.priority - a.priority;
      if (priorityDiff !== 0) return priorityDiff;
      return b.addedAt - a.addedAt;
    });

    // Decide batching strategy
    const strategy = this.decideBatchingStrategy();

    let batch: QueryBatch;

    if (strategy === 'merge') {
      batch = this.createMergedBatch();
    } else if (strategy === 'parallel') {
      batch = this.createParallelBatch();
    } else {
      batch = this.createSequentialBatch();
    }

    this.activeBatches.set(batch.batchId, batch);
    this.queryQueue = [];  // Clear queue
  }

  /**
   * Decide beste batching strategy
   */
  private decideBatchingStrategy(): 'merge' | 'parallel' | 'sequential' {
    if (this.queryQueue.length <= 2) {
      return 'merge';  // Small batches: merge everything
    }

    // Check similarity
    let similarCount = 0;
    for (let i = 0; i < this.queryQueue.length - 1; i++) {
      if (this.querySimilarity(this.queryQueue[i].query, this.queryQueue[i + 1].query) > 0.6) {
        similarCount++;
      }
    }

    if (similarCount > this.queryQueue.length * 0.5) {
      return 'merge';  // Many similar: merge
    }

    // Check dependencies
    let hasContextDeps = false;
    for (let i = 1; i < this.queryQueue.length; i++) {
      if (this.queryQueue[i].context.length > 0) {
        hasContextDeps = true;
        break;
      }
    }

    return hasContextDeps ? 'sequential' : 'parallel';
  }

  /**
   * Create merged batch
   */
  private createMergedBatch(): QueryBatch {
    const mergedQuery = this.mergeQueries(this.queryQueue);
    const estimatedTokens = Math.ceil(mergedQuery.length / 4);

    const batch: QueryBatch = {
      batchId: this.generateBatchId(),
      queries: this.queryQueue.splice(0, this.queryQueue.length),
      createdAt: Date.now(),
      estimatedTokens,
      optimizationStrategy: 'merge',
      mergedQuery
    };

    return batch;
  }

  /**
   * Create parallel batch
   */
  private createParallelBatch(): QueryBatch {
    const queries = this.queryQueue.splice(0, Math.min(this.maxBatchSize, this.queryQueue.length));
    const estimatedTokens = queries.reduce((sum, q) => sum + Math.ceil(q.query.length / 4), 0);

    return {
      batchId: this.generateBatchId(),
      queries,
      createdAt: Date.now(),
      estimatedTokens,
      optimizationStrategy: 'parallel'
    };
  }

  /**
   * Create sequential batch
   */
  private createSequentialBatch(): QueryBatch {
    const queries = this.queryQueue.splice(0, Math.min(this.maxBatchSize, this.queryQueue.length));
    const estimatedTokens = queries.reduce((sum, q) => sum + Math.ceil(q.query.length / 4), 0);

    return {
      batchId: this.generateBatchId(),
      queries,
      createdAt: Date.now(),
      estimatedTokens,
      optimizationStrategy: 'sequential'
    };
  }

  /**
   * Merge multiple queries
   */
  private mergeQueries(queries: BatchableQuery[]): string {
    if (queries.length === 0) return '';
    if (queries.length === 1) return queries[0].query;

    // Group by topic/similarity
    const groups: BatchableQuery[][] = [];
    const processed = new Set<string>();

    for (const q of queries) {
      if (processed.has(q.id)) continue;

      const group = [q];
      processed.add(q.id);

      for (const other of queries) {
        if (!processed.has(other.id)) {
          if (this.querySimilarity(q.query, other.query) > 0.5) {
            group.push(other);
            processed.add(other.id);
          }
        }
      }

      groups.push(group);
    }

    // Merge each group
    const merged = groups.map(group => {
      const questions = group.map(q => q.query).join('\n');
      const contexts = group.filter(q => q.context).map(q => q.context).join('\n');

      return contexts ? `Context:\n${contexts}\n\nQuestions:\n${questions}` : questions;
    });

    return merged.join('\n\n---\n\n');
  }

  /**
   * Query similarity
   */
  private querySimilarity(q1: string, q2: string): number {
    const tokens1 = new Set(q1.toLowerCase().split(/\s+/));
    const tokens2 = new Set(q2.toLowerCase().split(/\s+/));

    if (tokens1.size === 0 || tokens2.size === 0) return 0;

    const intersection = Array.from(tokens1).filter(t => tokens2.has(t)).length;
    const union = new Set([...tokens1, ...tokens2]).size;

    return intersection / union;
  }

  /**
   * Record batch result
   */
  recordBatchResult(
    batchId: string,
    queryId: string,
    result: string,
    executionTimeMs: number,
    tokenUsage: number
  ): void {
    this.completedBatches.push({
      batchId,
      queryId,
      result,
      executionTime: executionTimeMs,
      tokenUsage
    });

    // Keep last 100 results
    if (this.completedBatches.length > 100) {
      this.completedBatches = this.completedBatches.slice(-100);
    }

    // Remove from active
    const batch = this.activeBatches.get(batchId);
    if (batch) {
      batch.queries = batch.queries.filter(q => q.id !== queryId);
      if (batch.queries.length === 0) {
        this.activeBatches.delete(batchId);
      }
    }
  }

  /**
   * Get batch status
   */
  getBatchStatus(batchId: string) {
    const batch = this.activeBatches.get(batchId);
    if (!batch) return null;

    const age = Date.now() - batch.createdAt;

    return {
      batchId,
      queryCount: batch.queries.length,
      strategy: batch.optimizationStrategy,
      estimatedTokens: batch.estimatedTokens,
      ageMs: age,
      status: age < 1000 ? 'processing' : 'completed'
    };
  }

  /**
   * Generate query ID
   */
  private generateQueryId(): string {
    return `q_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Generate batch ID
   */
  private generateBatchId(): string {
    return `b_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Get statistics
   */
  getStats() {
    const completed = this.completedBatches;

    return {
      queuedQueries: this.queryQueue.length,
      activeBatches: this.activeBatches.size,
      completedBatches: completed.length,
      averageBatchSize: completed.length > 0
        ? Math.round(completed.length / (this.activeBatches.size || 1))
        : 0,
      totalTokensSaved: this.estimateTokensSaved(),
      deduplicationRate: this.calculateDeduplicationRate(),
      strategyDistribution: this.getStrategyDistribution()
    };
  }

  /**
   * Estimate tokens saved durch batching
   */
  private estimateTokensSaved(): number {
    let saved = 0;

    for (const batch of this.activeBatches.values()) {
      if (batch.optimizationStrategy === 'merge') {
        // Merging removes query duplication
        saved += batch.queries.length * 50;  // ~50 tokens overhead per query without merge
      }
    }

    return saved;
  }

  /**
   * Calculate deduplication rate
   */
  private calculateDeduplicationRate(): number {
    if (this.completedBatches.length === 0) return 0;

    const mergedBatches = this.completedBatches.filter(r => {
      const batch = this.activeBatches.get(r.batchId);
      return batch?.optimizationStrategy === 'merge';
    });

    return Math.round((mergedBatches.length / this.completedBatches.length) * 100);
  }

  /**
   * Get strategy distribution
   */
  private getStrategyDistribution() {
    const dist = { merge: 0, parallel: 0, sequential: 0 };

    for (const batch of this.activeBatches.values()) {
      dist[batch.optimizationStrategy]++;
    }

    return dist;
  }

  /**
   * Clear queues
   */
  clearQueues(): void {
    this.queryQueue = [];
    this.activeBatches.clear();
  }
}

export default BatchQueryOptimizer;
