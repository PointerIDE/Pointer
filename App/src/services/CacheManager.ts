import { logger } from './LoggerService';

/**
 * Caching Strategy with LRU (Least Recently Used) Eviction
 * Provides sophisticated caching for file reads, API responses, and parsed ASTs
 * 
 * Improvement 18: Smart caching with statistics and eviction policy
 */

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
  size?: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  entries: number;
  hitRate: number;
}

interface CacheConfig {
  maxEntries?: number;
  maxSizeBytes?: number;
  defaultTTL?: number; // in milliseconds
  strategy?: 'LRU' | 'LFU' | 'FIFO';
}

export class CacheManager<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    entries: 0,
    hitRate: 0,
  };
  private config: Required<CacheConfig>;
  private name: string;

  constructor(name: string, config: CacheConfig = {}) {
    this.name = name;
    this.config = {
      maxEntries: config.maxEntries ?? 100,
      maxSizeBytes: config.maxSizeBytes ?? 50 * 1024 * 1024, // 50MB
      defaultTTL: config.defaultTTL ?? 3600000, // 1 hour
      strategy: config.strategy ?? 'LRU',
    };
    
    logger.debug(`Cache initialized: ${this.name}`, { config: this.config });
  }

  /**
   * Get value from cache
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      logger.debug(`Cache miss: ${this.name}`, { key });
      return null;
    }

    // Check TTL
    const age = Date.now() - entry.timestamp;
    if (age > this.config.defaultTTL) {
      this.cache.delete(key);
      this.stats.size -= entry.size || 0;
      this.stats.entries--;
      logger.debug(`Cache entry expired: ${this.name}`, { key });
      return null;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessed = Date.now();

    this.stats.hits++;
    this.updateHitRate();
    logger.debug(`Cache hit: ${this.name}`, { key, accessCount: entry.accessCount });

    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T, sizeBytesEstimate?: number): void {
    const size = sizeBytesEstimate || this.estimateSize(value);

    // Check if adding this entry would exceed limits
    if (this.cache.size >= this.config.maxEntries || this.stats.size + size > this.config.maxSizeBytes) {
      this.evictEntries(size);
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
      size,
    };

    // If updating existing entry, subtract old size
    const oldEntry = this.cache.get(key);
    if (oldEntry) {
      this.stats.size -= oldEntry.size || 0;
    }

    this.cache.set(key, entry);
    this.stats.size += size;
    this.stats.entries = this.cache.size;

    logger.debug(`Cache set: ${this.name}`, { key, size, totalSize: this.stats.size });
  }

  /**
   * Check if key exists and is valid
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    const age = Date.now() - entry.timestamp;
    if (age > this.config.defaultTTL) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete entry from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.stats.size -= entry.size || 0;
    this.cache.delete(key);
    this.stats.entries = this.cache.size;

    logger.debug(`Cache deleted: ${this.name}`, { key });
    return true;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
    this.stats.entries = 0;
    logger.debug(`Cache cleared: ${this.name}`);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get all keys in cache
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Evict entries based on strategy
   */
  private evictEntries(spaceNeeded: number): void {
    const strategy = this.config.strategy;
    let evicted = 0;

    if (strategy === 'LRU') {
      this.evictLRU(spaceNeeded);
    } else if (strategy === 'LFU') {
      this.evictLFU(spaceNeeded);
    } else if (strategy === 'FIFO') {
      this.evictFIFO(spaceNeeded);
    }

    logger.debug(`Cache eviction: ${this.name}`, { strategy, spaceFreed: evicted });
  }

  /**
   * LRU (Least Recently Used) eviction
   */
  private evictLRU(spaceNeeded: number): void {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    let freed = 0;
    for (const [key, entry] of entries) {
      if (freed >= spaceNeeded) break;

      const size = entry.size || 0;
      this.cache.delete(key);
      this.stats.size -= size;
      freed += size;
    }
  }

  /**
   * LFU (Least Frequently Used) eviction
   */
  private evictLFU(spaceNeeded: number): void {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].accessCount - b[1].accessCount);

    let freed = 0;
    for (const [key, entry] of entries) {
      if (freed >= spaceNeeded) break;

      const size = entry.size || 0;
      this.cache.delete(key);
      this.stats.size -= size;
      freed += size;
    }
  }

  /**
   * FIFO (First In First Out) eviction
   */
  private evictFIFO(spaceNeeded: number): void {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    let freed = 0;
    for (const [key, entry] of entries) {
      if (freed >= spaceNeeded) break;

      const size = entry.size || 0;
      this.cache.delete(key);
      this.stats.size -= size;
      freed += size;
    }
  }

  /**
   * Estimate size of value in bytes
   */
  private estimateSize(value: any): number {
    if (typeof value === 'string') {
      return value.length * 2; // UTF-16
    }
    if (typeof value === 'number') {
      return 8;
    }
    if (typeof value === 'boolean') {
      return 4;
    }
    if (Array.isArray(value)) {
      return value.reduce((sum, item) => sum + this.estimateSize(item), 0);
    }
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).reduce(
        (sum, [key, val]) => sum + this.estimateSize(key) + this.estimateSize(val),
        0
      );
    }
    return 0;
  }

  /**
   * Update hit rate
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Export cache statistics
   */
  export(): Record<string, any> {
    return {
      name: this.name,
      config: this.config,
      statistics: this.getStats(),
      entries: this.cache.size,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Global Cache Registry for managing multiple cache instances
 */
export class CacheRegistry {
  private static caches = new Map<string, CacheManager>();

  /**
   * Create or get a cache instance
   */
  static getOrCreateCache<T = any>(name: string, config?: CacheConfig): CacheManager<T> {
    if (this.caches.has(name)) {
      return this.caches.get(name) as CacheManager<T>;
    }

    const cache = new CacheManager<T>(name, config);
    this.caches.set(name, cache);
    logger.debug('Cache registered', { name });
    return cache;
  }

  /**
   * Get cache by name
   */
  static getCache<T = any>(name: string): CacheManager<T> | null {
    return (this.caches.get(name) as CacheManager<T>) || null;
  }

  /**
   * List all caches
   */
  static listCaches(): string[] {
    return Array.from(this.caches.keys());
  }

  /**
   * Get statistics for all caches
   */
  static getAllStats(): Record<string, CacheStats> {
    const stats: Record<string, CacheStats> = {};
    for (const [name, cache] of this.caches) {
      stats[name] = cache.getStats();
    }
    return stats;
  }

  /**
   * Clear specific cache
   */
  static clearCache(name: string): boolean {
    const cache = this.caches.get(name);
    if (!cache) return false;

    cache.clear();
    return true;
  }

  /**
   * Clear all caches
   */
  static clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    logger.debug('All caches cleared');
  }

  /**
   * Export all cache data
   */
  static exportAll(): Record<string, any> {
    const data: Record<string, any> = {};
    for (const [name, cache] of this.caches) {
      data[name] = cache.export();
    }
    return data;
  }
}

export default CacheManager;
