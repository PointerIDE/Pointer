import { logger } from './LoggerService';

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

interface ResourceMetrics {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
  fps?: number;
  paint?: Array<{ name: string; duration: number }>;
}

/**
 * Performance Monitoring & Metrics Service
 * Tracks application performance, page load times, and resource usage
 * 
 * Improvement 15: Comprehensive performance monitoring with real-time metrics
 */
export class PerformanceMonitor {
  private static metrics: PerformanceMetric[] = [];
  private static marks: Map<string, number> = new Map();
  private static readonly MAX_METRICS = 1000;
  private static isEnabled = true;
  private static fpsCounter = { last: 0, fps: 60 };

  /**
   * Mark the start of an operation
   */
  static mark(operationName: string, metadata?: Record<string, any>): void {
    if (!this.isEnabled) return;
    
    this.marks.set(operationName, performance.now());
    logger.debug(`Performance mark: ${operationName}`, metadata);
  }

  /**
   * Measure operation duration and record metric
   */
  static measure(
    operationName: string,
    metadata?: Record<string, any>
  ): number | null {
    if (!this.isEnabled) return null;

    const startTime = this.marks.get(operationName);
    if (!startTime) {
      logger.warn(`No start mark found for: ${operationName}`);
      return null;
    }

    const duration = performance.now() - startTime;
    
    const metric: PerformanceMetric = {
      name: operationName,
      duration,
      timestamp: Date.now(),
      metadata
    };

    this.metrics.push(metric);
    
    // Keep metrics array bounded
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics.shift();
    }

    logger.debug(`Performance metric: ${operationName}`, {
      duration: `${duration.toFixed(2)}ms`,
      metadata
    });

    this.marks.delete(operationName);
    return duration;
  }

  /**
   * Record network request metrics
   */
  static recordNetworkMetric(
    url: string,
    duration: number,
    status: number,
    size?: number
  ): void {
    if (!this.isEnabled) return;

    this.metrics.push({
      name: `network:${new URL(url).pathname}`,
      duration,
      timestamp: Date.now(),
      metadata: { status, size, url }
    });
  }

  /**
   * Get current resource metrics (memory, FPS, paint timing)
   */
  static getResourceMetrics(): ResourceMetrics {
    const metrics: ResourceMetrics = {};

    // Memory metrics (Chrome/Node.js only)
    if ((performance as any).memory) {
      metrics.memory = {
        usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
        totalJSHeapSize: (performance as any).memory.totalJSHeapSize,
        jsHeapSizeLimit: (performance as any).memory.jsHeapSizeLimit
      };
    }

    // Paint timing metrics
    const paintMetrics = performance.getEntriesByType('paint');
    if (paintMetrics.length > 0) {
      metrics.paint = paintMetrics.map(entry => ({
        name: entry.name,
        duration: entry.duration
      }));
    }

    // FPS tracking (estimated)
    metrics.fps = this.fpsCounter.fps;

    return metrics;
  }

  /**
   * Get all recorded metrics
   */
  static getMetrics(filter?: { name?: string; minDuration?: number }): PerformanceMetric[] {
    let result = [...this.metrics];

    if (filter?.name) {
      result = result.filter(m => m.name.includes(filter.name!));
    }

    if (filter?.minDuration) {
      result = result.filter(m => m.duration >= filter.minDuration!);
    }

    return result;
  }

  /**
   * Get metrics summary (average, min, max)
   */
  static getSummary(operationName?: string): Record<string, any> {
    const metrics = operationName
      ? this.metrics.filter(m => m.name === operationName)
      : this.metrics;

    if (metrics.length === 0) {
      return { count: 0 };
    }

    const durations = metrics.map(m => m.duration);
    const sum = durations.reduce((a, b) => a + b, 0);
    const avg = sum / durations.length;
    const min = Math.min(...durations);
    const max = Math.max(...durations);

    return {
      count: metrics.length,
      average: Number(avg.toFixed(2)),
      min: Number(min.toFixed(2)),
      max: Number(max.toFixed(2)),
      total: Number(sum.toFixed(2))
    };
  }

  /**
   * Enable or disable monitoring
   */
  static setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    logger.debug(`Performance monitoring ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Clear all recorded metrics
   */
  static clear(): void {
    this.metrics = [];
    this.marks.clear();
    logger.debug('Performance metrics cleared');
  }

  /**
   * Export metrics as JSON
   */
  static export(): Record<string, any> {
    return {
      timestamp: new Date().toISOString(),
      metrics: this.metrics,
      summary: {
        totalMetrics: this.metrics.length,
        byOperation: this.getOperationSummary()
      },
      resources: this.getResourceMetrics()
    };
  }

  /**
   * Get summary grouped by operation
   */
  private static getOperationSummary(): Record<string, any> {
    const grouped: Record<string, PerformanceMetric[]> = {};
    
    for (const metric of this.metrics) {
      if (!grouped[metric.name]) {
        grouped[metric.name] = [];
      }
      grouped[metric.name].push(metric);
    }

    const summary: Record<string, any> = {};
    for (const [name, metrics] of Object.entries(grouped)) {
      summary[name] = this.getSummary(name);
    }

    return summary;
  }

  /**
   * Start automatic FPS monitoring
   */
  static startFPSMonitoring(): void {
    let frameCount = 0;
    let lastTime = performance.now();

    const updateFPS = () => {
      const now = performance.now();
      frameCount++;

      if (now - lastTime >= 1000) {
        this.fpsCounter.fps = frameCount;
        frameCount = 0;
        lastTime = now;
      }

      requestAnimationFrame(updateFPS);
    };

    requestAnimationFrame(updateFPS);
    logger.debug('FPS monitoring started');
  }
}

// Initialize FPS monitoring when module loads
try {
  PerformanceMonitor.startFPSMonitoring();
} catch (e) {
  // FPS monitoring not available in all environments
}

export default PerformanceMonitor;
