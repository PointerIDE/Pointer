import { logger } from './LoggerService';

export interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface PerformanceThresholds {
  excellent: number;   // < this is excellent
  good: number;        // < this is good
  acceptable: number;  // < this is acceptable
  poor: number;        // < this is poor
}

/**
 * Comprehensive Performance Optimization Service
 * 
 * Features:
 * - Real-time performance tracking
 * - Bottleneck identification
 * - Component rendering optimization
 * - Memory usage monitoring
 * - FPS tracking
 * - Network performance metrics
 */
export class PerformanceOptimizer {
  private static metrics: PerformanceMetric[] = [];
  private static readonly MAX_METRICS = 1000;
  private static observer: PerformanceObserver | null = null;
  private static frameCount = 0;
  private static fps = 60;
  private static lastFrameTime = performance.now();

  // Thresholds (in ms)
  private static readonly THRESHOLDS: Record<string, PerformanceThresholds> = {
    render: { excellent: 16, good: 33, acceptable: 50, poor: 100 },
    api_call: { excellent: 100, good: 500, acceptable: 1000, poor: 3000 },
    file_operation: { excellent: 50, good: 200, acceptable: 500, poor: 1500 },
    memory_check: { excellent: 50, good: 100, acceptable: 200, poor: 500 }
  };

  /**
   * Initialize performance monitoring
   */
  static initialize(): void {
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.recordMetric(entry.name, entry.duration, {
            entryType: entry.entryType
          });

          // Log slow operations
          if (entry.duration > 100) {
            logger.warn(`Slow operation detected: ${entry.name} (${entry.duration.toFixed(2)}ms)`);
          }
        }
      });

      // Observe different entry types
      this.observer.observe({
        entryTypes: ['measure', 'navigation', 'resource', 'long-task', 'largest-contentful-paint']
      });

      // Start FPS monitoring
      this.startFpsMonitoring();

      logger.info('Performance optimizer initialized');
    } catch (error) {
      logger.warn('Performance observer not supported', error);
    }
  }

  /**
   * Start FPS monitoring
   */
  private static startFpsMonitoring(): void {
    const monitor = () => {
      const now = performance.now();
      this.frameCount++;

      // Calculate FPS every second
      if (now - this.lastFrameTime >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.lastFrameTime = now;

        if (this.fps < 50) {
          logger.debug(`Low FPS detected: ${this.fps}fps`);
        }
      }

      requestAnimationFrame(monitor);
    };

    requestAnimationFrame(monitor);
  }

  /**
   * Record a performance metric
   */
  static recordMetric(
    name: string,
    duration: number,
    metadata?: Record<string, any>
  ): void {
    const metric: PerformanceMetric = {
      name,
      duration,
      timestamp: Date.now(),
      metadata
    };

    this.metrics.push(metric);

    // Maintain max metrics size
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics.shift();
    }
  }

  /**
   * Mark start of operation
   */
  static mark(name: string): void {
    try {
      performance.mark(`${name}-start`);
    } catch (error) {
      logger.debug('Unable to mark performance', { name });
    }
  }

  /**
   * Measure operation duration
   */
  static measure(
    name: string,
    metadata?: Record<string, any>
  ): number | null {
    try {
      const startMark = `${name}-start`;
      const endMark = `${name}-end`;

      performance.mark(endMark);
      performance.measure(name, startMark, endMark);

      const measure = performance.getEntriesByName(name, 'measure').pop();
      const duration = measure?.duration ?? 0;

      this.recordMetric(name, duration, metadata);

      // Cleanup
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
      performance.clearMeasures(name);

      return duration;
    } catch (error) {
      logger.debug('Unable to measure performance', { name });
      return null;
    }
  }

  /**
   * Get performance grade for a metric
   */
  static getGrade(metricType: string, duration: number): 'excellent' | 'good' | 'acceptable' | 'poor' {
    const thresholds = this.THRESHOLDS[metricType] || this.THRESHOLDS.api_call;

    if (duration < thresholds.excellent) return 'excellent';
    if (duration < thresholds.good) return 'good';
    if (duration < thresholds.acceptable) return 'acceptable';
    return 'poor';
  }

  /**
   * Get metrics summary
   */
  static getSummary() {
    const now = Date.now();
    const last60Seconds = this.metrics.filter(m => now - m.timestamp < 60000);

    const grouped = new Map<string, PerformanceMetric[]>();
    last60Seconds.forEach(m => {
      if (!grouped.has(m.name)) {
        grouped.set(m.name, []);
      }
      grouped.get(m.name)!.push(m);
    });

    const summary: Record<string, any> = {
      fps: this.fps,
      totalMetrics: this.metrics.length,
      lastMinute: last60Seconds.length,
      metrics: {}
    };

    grouped.forEach((metrics, name) => {
      const durations = metrics.map(m => m.duration);
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const max = Math.max(...durations);
      const min = Math.min(...durations);

      summary.metrics[name] = {
        count: metrics.length,
        avg: avg.toFixed(2),
        min: min.toFixed(2),
        max: max.toFixed(2),
        grade: this.getGrade(name, avg)
      };
    });

    return summary;
  }

  /**
   * Find performance bottlenecks
   */
  static findBottlenecks(threshold: number = 100) {
    const slow = this.metrics.filter(m => m.duration > threshold);

    const grouped = new Map<string, number[]>();
    slow.forEach(m => {
      if (!grouped.has(m.name)) {
        grouped.set(m.name, []);
      }
      grouped.get(m.name)!.push(m.duration);
    });

    const bottlenecks: Array<{
      name: string;
      avgDuration: number;
      count: number;
      impact: 'critical' | 'high' | 'medium';
    }> = [];

    grouped.forEach((durations, name) => {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const impact = avg > 500 ? 'critical' : avg > 200 ? 'high' : 'medium';

      bottlenecks.push({
        name,
        avgDuration: parseFloat(avg.toFixed(2)),
        count: durations.length,
        impact
      });
    });

    return bottlenecks.sort((a, b) => b.avgDuration - a.avgDuration);
  }

  /**
   * Check memory usage
   */
  static getMemoryUsage() {
    if ((performance as any).memory) {
      const used = (performance as any).memory.usedJSHeapSize;
      const limit = (performance as any).memory.jsHeapSizeLimit;
      const percentage = (used / limit) * 100;

      return {
        usedMB: (used / 1024 / 1024).toFixed(2),
        limitMB: (limit / 1024 / 1024).toFixed(2),
        percentage: percentage.toFixed(1),
        healthy: percentage < 80
      };
    }

    return null;
  }

  /**
   * get FPS
   */
  static getFps(): number {
    return this.fps;
  }

  /**
   * Clear metrics
   */
  static clear(): void {
    this.metrics = [];
    logger.debug('Performance metrics cleared');
  }

  /**
   * Export metrics for analysis
   */
  static export() {
    return {
      metrics: this.metrics,
      summary: this.getSummary(),
      bottlenecks: this.findBottlenecks(),
      memory: this.getMemoryUsage(),
      exported: new Date().toISOString()
    };
  }
}

export default PerformanceOptimizer;
