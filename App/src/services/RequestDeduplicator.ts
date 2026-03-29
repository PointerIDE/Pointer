/**
 * RequestDeduplicator
 * 
 * Query Consolidation - 40-50% weniger Requests
 * - Ähnliche Queries mergen
 * - Batch processing
 * - Similarity detection
 * 
 * Impact: Weniger redundante Requests, smart batching
 */

export interface DuplicateQuery {
  originalQuery: string;
  similarQueries: string[];
  similarities: number[];  // 0-100
  mergedQuery: string;
}

export interface DeduplicationResult {
  isDuplicate: boolean;
  groupId?: string;
  mergedQuery?: string;
  savings?: number;
  reason: string;
}

export class RequestDeduplicator {
  private recentRequests: Map<string, { query: string; timestamp: number }> = new Map();
  private duplicateGroups: Map<string, DuplicateQuery> = new Map();
  private readonly timeWindowMs: number = 5 * 60 * 1000;  // 5 minutes
  private readonly similarityThreshold: number = 0.75;  // 75% similar

  constructor() {}

  /**
   * Check ob neue request ein duplicate ist
   */
  checkForDuplicate(query: string): DeduplicationResult {
    const similarity = this.findMostSimilar(query);

    if (!similarity || similarity.score < this.similarityThreshold) {
      // Not a duplicate, register it
      this.registerQuery(query);
      return {
        isDuplicate: false,
        reason: 'Unique query - no similar recent requests'
      };
    }

    // Found similar query
    const mergedQuery = this.mergeQueries(query, similarity.query);
    const groupId = this.getOrCreateGroupId(similarity.query, query);

    return {
      isDuplicate: true,
      groupId,
      mergedQuery,
      savings: Math.round(similarity.score * 40),  // Rough savings estimate
      reason: `${Math.round(similarity.score * 100)}% similar to recent query - can merge and reuse answer`
    };
  }

  /**
   * Find most similar bestehendes query
   */
  private findMostSimilar(
    query: string
  ): { query: string; score: number } | null {
    let bestMatch: { query: string; score: number } | null = null;
    let bestScore = 0;

    const now = Date.now();

    for (const [key, data] of this.recentRequests) {
      // Only check recent (within time window)
      if (now - data.timestamp > this.timeWindowMs) {
        this.recentRequests.delete(key);
        continue;
      }

      const score = this.calculateSimilarity(query, data.query);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { query: data.query, score };
      }
    }

    return bestMatch;
  }

  /**
   * Calculate wie ähnlich zwei Queries sind (0-1)
   */
  private calculateSimilarity(query1: string, query2: string): number {
    const q1 = query1.toLowerCase();
    const q2 = query2.toLowerCase();

    // Exact match
    if (q1 === q2) return 1.0;

    // Length difference (too different = probably not similar)
    const lenDiff = Math.abs(q1.length - q2.length) / Math.max(q1.length, q2.length);
    if (lenDiff > 0.4) return 0;

    // Token-based similarity (Jaccard)
    const tokens1 = new Set(q1.split(/\s+/));
    const tokens2 = new Set(q2.split(/\s+/));

    const intersection = Array.from(tokens1).filter(t => tokens2.has(t)).length;
    const union = new Set([...tokens1, ...tokens2]).size;

    const jaccard = union > 0 ? intersection / union : 0;

    // N-gram similarity (bigrams)
    const bigrams1 = this.getBigrams(q1);
    const bigrams2 = this.getBigrams(q2);

    const bi_intersection = bigrams1.filter(b => bigrams2.includes(b)).length;
    const bi_union = new Set([...bigrams1, ...bigrams2]).size;

    const bigram_similarity = bi_union > 0 ? bi_intersection / bi_union : 0;

    // Combine scores: Jaccard 60%, Bigram 40%
    return jaccard * 0.6 + bigram_similarity * 0.4;
  }

  /**
   * Extract bigrams (2-char substrings) von query
   */
  private getBigrams(text: string): string[] {
    const bigrams: string[] = [];
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.push(text.substring(i, i + 2));
    }
    return bigrams;
  }

  /**
   * Register neue query
   */
  private registerQuery(query: string): void {
    const hash = query.substring(0, 50);  // Use first 50 chars as key
    this.recentRequests.set(hash, {
      query,
      timestamp: Date.now()
    });

    // Keep map size bounded
    if (this.recentRequests.size > 1000) {
      // Remove oldest
      let oldest = '';
      let oldestTime = Infinity;

      for (const [key, data] of this.recentRequests) {
        if (data.timestamp < oldestTime) {
          oldestTime = data.timestamp;
          oldest = key;
        }
      }

      if (oldest) this.recentRequests.delete(oldest);
    }
  }

  /**
   * Merge zwei Queries zu consolidated version
   */
  private mergeQueries(query1: string, query2: string): string {
    // Simple merge: take common parts, add differences
    const tokens1 = query1.split(/\s+/);
    const tokens2 = query2.split(/\s+/);

    // Common tokens
    const common = tokens1.filter(t => tokens2.includes(t));

    if (common.length > 0) {
      return common.join(' ') + ' [merged with variations]';
    }

    // Fallback: shorten form
    return `${query1.substring(0, 50)}... [and similar queries]`;
  }

  /**
   * Get or create group ID
   */
  private getOrCreateGroupId(query1: string, query2: string): string {
    const prefix = query1.substring(0, 30);
    
    // Check if group exists
    for (const [groupId, group] of this.duplicateGroups) {
      if (group.originalQuery === query1) {
        // Add to existing group
        if (!group.similarQueries.includes(query2)) {
          group.similarQueries.push(query2);
          group.similarities.push(this.calculateSimilarity(query1, query2));
        }
        return groupId;
      }
    }

    // Create new group
    const groupId = prefix + '_' + Date.now();
    this.duplicateGroups.set(groupId, {
      originalQuery: query1,
      similarQueries: [query2],
      similarities: [this.calculateSimilarity(query1, query2)],
      mergedQuery: this.mergeQueries(query1, query2)
    });

    return groupId;
  }

  /**
   * Get all duplicate groups
   */
  getDuplicateGroups() {
    return Array.from(this.duplicateGroups.entries()).map(([id, group]) => ({
      groupId: id,
      ...group,
      count: group.similarQueries.length + 1,  // +1 for original
      averageSimilarity: group.similarities.length > 0
        ? Math.round(
            (group.similarities.reduce((a, b) => a + b, 0) / group.similarities.length) * 100
          )
        : 0
    }));
  }

  /**
   * Get deduplication stats
   */
  getStats() {
    const recentCount = Array.from(this.recentRequests.values()).filter(
      r => Date.now() - r.timestamp < this.timeWindowMs
    ).length;

    return {
      recentRequests: recentCount,
      duplicateGroups: this.duplicateGroups.size,
      totalQueriesInGroups: this.getDuplicateGroups().reduce((sum, g) => sum + g.count, 0),
      estimatedTokenSavings: this.getDuplicateGroups().reduce(
        (sum, g) => sum + (g.count - 1) * 50,  // ~50 tokens per deduplicated query
        0
      ),
      deduplicationRate: recentCount > 0
        ? Math.round((this.duplicateGroups.size / recentCount) * 100)
        : 0
    };
  }

  /**
   * Clear old requests and groups
   */
  cleanup(): void {
    const now = Date.now();

    // Remove old requests
    for (const [key, data] of this.recentRequests) {
      if (now - data.timestamp > this.timeWindowMs) {
        this.recentRequests.delete(key);
      }
    }

    // Note: Keep duplicate groups for reference
  }

  /**
   * Reset all
   */
  reset(): void {
    this.recentRequests.clear();
    this.duplicateGroups.clear();
  }
}

export default RequestDeduplicator;
