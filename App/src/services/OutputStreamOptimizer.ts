/**
 * OutputStreamOptimizer
 * 
 * Streaming Rate Normalization - Smooth 60fps experience
 * - Buffer management
 * - Rate limiting
 * - Backpressure handling
 * 
 * Impact: Smooth user experience, optimal memory usage
 */

export interface StreamChunk {
  id: string;
  data: string;
  timestamp: number;
  priority: number;  // Higher = more important to show quickly
  size: number;      // bytes
}

export interface StreamConfig {
  targetFps: number;                    // 60, 30, 24
  maxBufferSize: number;                // bytes
  maxChunkSize: number;                 // bytes per chunk
  priorityWeights: { [level: string]: number };
}

export interface StreamStats {
  chunksProcessed: number;
  totalBytesStreamed: number;
  currentBufferUtilization: number;
  averageChunkTime: number;
  framesPerSecond: number;
  backpressureEvents: number;
}

export class OutputStreamOptimizer {
  private buffer: StreamChunk[] = [];
  private stats: StreamStats = {
    chunksProcessed: 0,
    totalBytesStreamed: 0,
    currentBufferUtilization: 0,
    averageChunkTime: 0,
    framesPerSecond: 0,
    backpressureEvents: 0
  };

  private config: StreamConfig = {
    targetFps: 60,
    maxBufferSize: 10 * 1024 * 1024,   // 10MB
    maxChunkSize: 64 * 1024,            // 64KB
    priorityWeights: {
      critical: 10,
      high: 5,
      normal: 1,
      low: 0.1
    }
  };

  private lastFrameTime: number = Date.now();
  private frameCount: number = 0;
  private totalChunkTime: number = 0;
  private isStreaming: boolean = false;

  constructor(config: Partial<StreamConfig> = {}) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Start streaming
   */
  startStream(): void {
    this.isStreaming = true;
    this.lastFrameTime = Date.now();
    this.frameCount = 0;
  }

  /**
   * Stop streaming
   */
  stopStream(): void {
    this.isStreaming = false;
  }

  /**
   * Add data ke stream buffer
   */
  addChunk(data: string, priority: string = 'normal'): string {
    if (!this.isStreaming) {
      return '';  // Streaming not active
    }

    const id = this.generateChunkId();
    const chunk: StreamChunk = {
      id,
      data,
      timestamp: Date.now(),
      priority: this.config.priorityWeights[priority] || 1,
      size: Buffer.byteLength(data, 'utf8')
    };

    // Check backpressure
    const currentSize = this.calculateBufferSize();
    if (currentSize + chunk.size > this.config.maxBufferSize) {
      // Backpressure: too much data
      this.stats.backpressureEvents++;
      
      // Try to flush some low-priority items
      this.flushLowPriority();

      // If still too much, drop the chunk
      if (this.calculateBufferSize() + chunk.size > this.config.maxBufferSize) {
        return '';  // Dropped
      }
    }

    // Insert chunk respecting priority
    this.insertChunkByPriority(chunk);
    this.stats.currentBufferUtilization = this.calculateBufferUtilization();

    return id;
  }

  /**
   * Insert chunk maintaining priority order
   */
  private insertChunkByPriority(chunk: StreamChunk): void {
    // Find insertion point (higher priority first)
    let insertIndex = this.buffer.length;

    for (let i = 0; i < this.buffer.length; i++) {
      if (chunk.priority > this.buffer[i].priority) {
        insertIndex = i;
        break;
      }
    }

    this.buffer.splice(insertIndex, 0, chunk);
  }

  /**
   * Get next chunk to stream
   */
  getNextChunk(): StreamChunk | null {
    if (this.buffer.length === 0) return null;

    // Calculate frame timing
    const now = Date.now();
    const frameDuration = 1000 / this.config.targetFps;
    const timeSinceLastFrame = now - this.lastFrameTime;

    // Don't output faster than target FPS
    if (timeSinceLastFrame < frameDuration) {
      return null;  // Too soon
    }

    // Take chunk from front (highest priority)
    const chunk = this.buffer.shift();

    if (chunk) {
      // Update stats
      const chunkTime = now - chunk.timestamp;
      this.stats.chunksProcessed++;
      this.stats.totalBytesStreamed += chunk.size;
      this.totalChunkTime += chunkTime;
      this.stats.averageChunkTime = this.stats.totalBytesStreamed > 0
        ? this.totalChunkTime / this.stats.chunksProcessed
        : 0;

      // Update FPS
      this.frameCount++;
      const fpsInterval = now - this.lastFrameTime;
      if (fpsInterval >= 1000) {
        this.stats.framesPerSecond = Math.round(
          (this.frameCount * 1000) / fpsInterval
        );
        this.frameCount = 0;
        this.lastFrameTime = now;
      }

      this.stats.currentBufferUtilization = this.calculateBufferUtilization();
    }

    return chunk || null;
  }

  /**
   * Flush low priority items
   */
  private flushLowPriority(): void {
    // Remove items with priority <= 0.1 (low priority)
    this.buffer = this.buffer.filter(c => c.priority > 0.1);
  }

  /**
   * Calculate current buffer size
   */
  private calculateBufferSize(): number {
    return this.buffer.reduce((sum, chunk) => sum + chunk.size, 0);
  }

  /**
   * Calculate buffer utilization (0-1)
   */
  private calculateBufferUtilization(): number {
    return this.calculateBufferSize() / this.config.maxBufferSize;
  }

  /**
   * Get buffer status
   */
  getBufferStatus() {
    const utilization = this.calculateBufferUtilization();
    const status = utilization < 0.5 ? 'good' : utilization < 0.8 ? 'moderate' : 'critical';

    return {
      chunkCount: this.buffer.length,
      bufferSizeMB: Math.round((this.calculateBufferSize() / 1024 / 1024) * 100) / 100,
      maxSizeMB: Math.round((this.config.maxBufferSize / 1024 / 1024) * 100) / 100,
      utilization: Math.round(utilization * 100),
      status,
      isBackpressured: utilization > 0.9,
      highestPriority: this.buffer.length > 0 ? this.buffer[0].priority : 0
    };
  }

  /**
   * Adjust frame rate dynamically based on load
   */
  adjustFrameRate(): void {
    const utilization = this.calculateBufferUtilization();

    if (utilization > 0.9) {
      // Too much buffered: reduce frame rate
      this.config.targetFps = Math.max(15, this.config.targetFps - 5);
    } else if (utilization < 0.3 && this.config.targetFps < 60) {
      // Good capacity: increase frame rate
      this.config.targetFps = Math.min(60, this.config.targetFps + 2);
    }
  }

  /**
   * Chunk data into optimal sizes
   */
  chunkData(fullData: string, priority: string = 'normal'): string[] {
    const chunks: string[] = [];
    const maxSize = this.config.maxChunkSize;

    for (let i = 0; i < fullData.length; i += maxSize) {
      const chunk = fullData.substring(i, i + maxSize);
      const chunkId = this.addChunk(chunk, priority);
      if (chunkId) {
        chunks.push(chunkId);
      }
    }

    return chunks;
  }

  /**
   * Estimate time to stream all buffered data
   */
  estimateFlushTime(): number {
    if (this.buffer.length === 0) return 0;

    const frameDuration = 1000 / this.config.targetFps;
    return this.buffer.length * frameDuration;
  }

  /**
   * Get comprehensive stats
   */
  getStats(): StreamStats {
    return { ...this.stats };
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    this.stats = {
      chunksProcessed: 0,
      totalBytesStreamed: 0,
      currentBufferUtilization: 0,
      averageChunkTime: 0,
      framesPerSecond: 0,
      backpressureEvents: 0
    };
    this.totalChunkTime = 0;
  }

  /**
   * Generate chunk ID
   */
  private generateChunkId(): string {
    return `chunk_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Clear buffer
   */
  clearBuffer(): void {
    this.buffer = [];
    this.stats.currentBufferUtilization = 0;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<StreamConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current config
   */
  getConfig(): StreamConfig {
    return { ...this.config };
  }

  /**
   * Stream summary
   */
  getSummary() {
    const utilizationPct = Math.round(this.stats.currentBufferUtilization * 100);

    return {
      isStreaming: this.isStreaming,
      bufferedChunks: this.buffer.length,
      bufferUtilization: `${utilizationPct}%`,
      actualFps: this.stats.framesPerSecond,
      targetFps: this.config.targetFps,
      backpressureActive: this.stats.currentBufferUtilization > 0.9,
      estimateFlushTimeMs: this.estimateFlushTime(),
      totalMBStreamed: Math.round((this.stats.totalBytesStreamed / 1024 / 1024) * 100) / 100
    };
  }
}

export default OutputStreamOptimizer;
