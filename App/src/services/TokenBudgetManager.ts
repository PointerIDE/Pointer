/**
 * TokenBudgetManager
 * 
 * Tracke jeden Request, Kosten, Efficiency
 * - Total Transparency über Token-Verbrauch
 * - Trending & Recommendations
 * - Cost Optimization
 * 
 * Impact: Cost Control, Better Planning, Optimization Insights
 */

export interface TokenRequest {
  id: string;
  timestamp: number;
  query: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  queryType: 'search' | 'refactor' | 'explain' | 'analyze' | 'other';
  efficiency: number;         // outputTokens / inputTokens
  duration: number;           // milliseconds
  model: string;
}

export interface BudgetStats {
  totalTokensUsed: number;
  budget: number;
  percentageUsed: number;
  dailyAverage: number;
  remainingDays: number;
  projectedEndDate: string;
}

export class TokenBudgetManager {
  private requests: TokenRequest[] = [];
  private budget: number;
  private dayStartTime: number;
  private readonly maxRequestHistory: number = 1000;

  constructor(dailyBudget: number = 100000) {
    this.budget = dailyBudget;
    this.dayStartTime = this.getStartOfDay();
  }

  /**
   * Tracke neuen Request
   */
  recordRequest(data: {
    query: string;
    inputTokens: number;
    outputTokens: number;
    queryType: 'search' | 'refactor' | 'explain' | 'analyze' | 'other';
    duration: number;
    model: string;
  }): TokenRequest {
    const request: TokenRequest = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      query: data.query,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.inputTokens + data.outputTokens,
      queryType: data.queryType,
      efficiency: data.outputTokens / Math.max(data.inputTokens, 1),
      duration: data.duration,
      model: data.model
    };

    this.requests.push(request);
    if (this.requests.length > this.maxRequestHistory) {
      this.requests.shift();
    }

    return request;
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): BudgetStats {
    const now = Date.now();
    const totalUsed = this.requests.reduce((sum, r) => sum + r.totalTokens, 0);
    const todayRequests = this.requests.filter(r => r.timestamp > this.dayStartTime);
    const dailyUsed = todayRequests.reduce((sum, r) => sum + r.totalTokens, 0);
    const dailyAverage = this.requests.length > 0 
      ? totalUsed / ((now - this.requests[0].timestamp) / (24 * 60 * 60 * 1000))
      : 0;

    const remainingTokens = Math.max(0, this.budget - dailyUsed);
    const remainingDays = dailyAverage > 0 ? remainingTokens / dailyAverage : 0;
    const projectedEndDate = new Date(now + remainingDays * 24 * 60 * 60 * 1000).toLocaleDateString();

    return {
      totalTokensUsed: dailyUsed,
      budget: this.budget,
      percentageUsed: Math.round((dailyUsed / this.budget) * 100),
      dailyAverage: Math.round(dailyAverage),
      remainingDays: Math.ceil(remainingDays),
      projectedEndDate
    };
  }

  /**
   * Get analytics by query type
   */
  getByQueryType() {
    const types: Record<string, {
      count: number;
      totalTokens: number;
      avgTokens: number;
      avgEfficiency: number;
    }> = {};

    const queryTypes = ['search', 'refactor', 'explain', 'analyze', 'other'] as const;
    
    for (const type of queryTypes) {
      const typeRequests = this.requests.filter(r => r.queryType === type);
      const totalTokens = typeRequests.reduce((sum, r) => sum + r.totalTokens, 0);
      const avgEfficiency = typeRequests.length > 0
        ? typeRequests.reduce((sum, r) => sum + r.efficiency, 0) / typeRequests.length
        : 0;

      types[type] = {
        count: typeRequests.length,
        totalTokens,
        avgTokens: Math.round(totalTokens / Math.max(typeRequests.length, 1)),
        avgEfficiency: Math.round(avgEfficiency * 100) / 100
      };
    }

    return types;
  }

  /**
   * Get most expensive queries
   */
  getMostExpensive(limit: number = 10): TokenRequest[] {
    return [...this.requests]
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, limit);
  }

  /**
   * Get optimization recommendations
   */
  getRecommendations(): string[] {
    const recommendations: string[] = [];
    const stats = this.getStats();
    const byType = this.getByQueryType();

    // Check if using too many tokens
    if (stats.percentageUsed > 80) {
      recommendations.push('⚠️ Near budget limit! Consider optimizing queries.');
    }

    // Identify expensive query type
    const typesSorted = Object.entries(byType)
      .sort((a, b) => b[1].avgTokens - a[1].avgTokens);
    
    if (typesSorted.length > 0) {
      const mostExpensive = typesSorted[0];
      const leastExpensive = typesSorted[typesSorted.length - 1];
      
      if (mostExpensive[1].avgTokens > leastExpensive[1].avgTokens * 2) {
        recommendations.push(
          `💡 "${mostExpensive[0]}" queries are 2x more expensive than "${leastExpensive[0]}". Consider breaking them into smaller queries.`
        );
      }
    }

    // Peak time analysis
    const peakHour = this.findPeakHour();
    if (peakHour !== null) {
      recommendations.push(`📊 Peak usage is around ${peakHour}:00. Consider scheduling heavy tasks at off-peak times.`);
    }

    // Efficiency analysis
    const avgEfficiency = this.requests.length > 0
      ? this.requests.reduce((sum, r) => sum + r.efficiency, 0) / this.requests.length
      : 0;

    if (avgEfficiency > 1) {
      recommendations.push(`✅ Good query efficiency (${(avgEfficiency).toFixed(2)}). Output is ${Math.round(avgEfficiency)}x input size.`);
    }

    return recommendations;
  }

  /**
   * Find peak usage hour
   */
  private findPeakHour(): number | null {
    const hourCounts = new Array(24).fill(0);
    
    this.requests.forEach(r => {
      const hour = new Date(r.timestamp).getHours();
      hourCounts[hour]++;
    });

    const maxCount = Math.max(...hourCounts);
    if (maxCount === 0) return null;
    
    return hourCounts.indexOf(maxCount);
  }

  /**
   * Get start of current day (00:00)
   */
  private getStartOfDay(): number {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return start.getTime();
  }

  /**
   * Reset für neuen Tag
   */
  resetDaily(): void {
    this.dayStartTime = this.getStartOfDay();
    this.requests = [];
  }

  /**
   * Export data for analysis
   */
  exportData() {
    return {
      requests: this.requests,
      stats: this.getStats(),
      byQueryType: this.getByQueryType(),
      recommendations: this.getRecommendations(),
      exportedAt: new Date().toISOString()
    };
  }
}

export default TokenBudgetManager;
