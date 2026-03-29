/**
 * LayeredResponseGenerator
 * 
 * Multi-Depth Responses - ELI5/Summary/Full
 * - Verschiedene Komplexitätslevel
 * - Basierend auf user preference
 * - Smart depth selection
 * 
 * Impact: Jeder User kriegt richtig komplexe Antwort
 */

export interface ResponseLayer {
  name: string;
  description: string;
  targetAudience: string;
  tokenBudget: number;
  style: 'simple' | 'intermediate' | 'expert';
}

export interface LayeredResponse {
  eli5: string;        // 5 years old
  summary: string;     // Executive summary
  full: string;        // Complete explanation
  selectedLevel: 'eli5' | 'summary' | 'full';
  metadata: {
    tokensUsed: number;
    complexity: number;
    estimatedReadTime: number;
  };
}

export class LayeredResponseGenerator {
  private readonly layers: Map<string, ResponseLayer> = new Map();
  private readonly stylePatterns: Map<string, string[]> = new Map();

  constructor() {
    this.initializeLayers();
    this.initializeStylePatterns();
  }

  /**
   * Initialize response layers mit defaults
   */
  private initializeLayers(): void {
    this.layers.set('eli5', {
      name: 'ELI5',
      description: 'Explain like I\'m 5 - Very simple, short, concrete',
      targetAudience: 'Non-technical, beginners',
      tokenBudget: 100,
      style: 'simple'
    });

    this.layers.set('summary', {
      name: 'Summary',
      description: 'Executive summary - Key points only',
      targetAudience: 'Busy professionals, decision makers',
      tokenBudget: 300,
      style: 'intermediate'
    });

    this.layers.set('full', {
      name: 'Full',
      description: 'Complete explanation with details and examples',
      targetAudience: 'Developers, experts',
      tokenBudget: 1000,
      style: 'expert'
    });
  }

  /**
   * Initialize style patterns
   */
  private initializeStylePatterns(): void {
    this.stylePatterns.set('simple', [
      'use short sentences',
      'use common words',
      'use examples and analogies',
      'avoid technical jargon',
      'be concrete and specific'
    ]);

    this.stylePatterns.set('intermediate', [
      'structure with clear sections',
      'highlight key points',
      'include relevant context',
      'use moderate technical terms',
      'provide reasoning'
    ]);

    this.stylePatterns.set('expert', [
      'include comprehensive details',
      'use technical terminology',
      'provide multiple perspectives',
      'include edge cases',
      'reference related concepts'
    ]);
  }

  /**
   * Generate layered responses von base response
   */
  generateLayers(
    baseResponse: string,
    userExpertiseLevel: 'beginner' | 'intermediate' | 'expert' = 'intermediate'
  ): LayeredResponse {
    const eli5 = this.simplifyResponse(baseResponse, 'simple');
    const summary = this.summarizeResponse(baseResponse, 'intermediate');
    const full = baseResponse;

    // Select appropriate level based on expertise
    const selectedLevel = this.selectAppropriateLevel(userExpertiseLevel);

    const tokensEli5 = this.estimateTokens(eli5);
    const tokensSummary = this.estimateTokens(summary);
    const tokensFull = this.estimateTokens(full);

    return {
      eli5,
      summary,
      full,
      selectedLevel,
      metadata: {
        tokensUsed: this.getTokensForLevel(selectedLevel, tokensEli5, tokensSummary, tokensFull),
        complexity: this.calculateComplexity(full),
        estimatedReadTime: Math.ceil(tokensFull / 200)  // ~200 tokens per minute
      }
    };
  }

  /**
   * Simplify response
   */
  private simplifyResponse(response: string, style: 'simple' | 'intermediate' | 'expert'): string {
    const patterns = this.stylePatterns.get(style) || [];
    let simplified = response;

    // Remove technical jargon
    const technicalTerms = this.extractTechnicalTerms(response);
    simplified = this.replaceTechnicalTerms(simplified, technicalTerms, style);

    // Shorten sentences
    simplified = this.shortenSentences(simplified, style);

    // Add examples if needed
    if (style === 'simple' && !simplified.includes('example')) {
      simplified += '\n\nExample: Think of it like...';
    }

    return simplified.substring(0, this.layers.get('eli5')?.tokenBudget! * 4);
  }

  /**
   * Summarize response
   */
  private summarizeResponse(response: string, style: 'simple' | 'intermediate' | 'expert'): string {
    const sentences = response.split(/[.!?]+/).filter(s => s.trim());
    
    // Keep ~30% of sentences (most important ones)
    const keepCount = Math.max(3, Math.ceil(sentences.length * 0.3));
    const scored = sentences.map(s => ({
      sentence: s.trim(),
      score: this.scoreSentenceImportance(s)
    }));

    const topSentences = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, keepCount)
      .map(s => s.sentence);

    let summary = topSentences.join('. ') + '.';

    // Add key points format
    if (style === 'intermediate') {
      summary = 'Key Points:\n' + topSentences
        .map(s => '• ' + s)
        .join('\n');
    }

    return summary.substring(0, this.layers.get('summary')?.tokenBudget! * 4);
  }

  /**
   * Score wie wichtig ein sentence ist
   */
  private scoreSentenceImportance(sentence: string): number {
    let score = 0;

    // Longer sentences might be more important
    score += Math.min(sentence.length / 10, 5);

    // Keywords
    const keywords = ['important', 'key', 'main', 'should', 'must', 'critical', 'note'];
    if (keywords.some(k => sentence.toLowerCase().includes(k))) {
      score += 3;
    }

    // Has specific details
    if (/\d+/.test(sentence)) score += 2;  // Has numbers
    if (/`[^`]+`/.test(sentence)) score += 2;  // Has code

    return score;
  }

  /**
   * Extract technical terms von response
   */
  private extractTechnicalTerms(response: string): string[] {
    // Simple heuristic: CamelCase words, words in backticks
    const camelCase = response.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g) || [];
    const inBackticks = response.match(/`([^`]+)`/g) || [];

    return [
      ...new Set([
        ...camelCase,
        ...inBackticks.map(t => t.replace(/`/g, ''))
      ])
    ];
  }

  /**
   * Replace technical terms mit simple alternatives
   */
  private replaceTechnicalTerms(
    text: string,
    terms: string[],
    style: string
  ): string {
    const replacements: { [key: string]: string } = {
      'API': style === 'simple' ? 'connection' : 'API',
      'Query': style === 'simple' ? 'question' : 'query',
      'Parameter': style === 'simple' ? 'setting' : 'parameter',
      'Cache': style === 'simple' ? 'memory' : 'cache',
      'Schema': style === 'simple' ? 'structure' : 'schema',
      'Algorithm': style === 'simple' ? 'method' : 'algorithm',
      'Index': style === 'simple' ? 'list' : 'index'
    };

    let result = text;
    for (const term of terms) {
      const replacement = replacements[term] || term;
      result = result.replace(new RegExp('\\b' + term + '\\b', 'g'), replacement);
    }

    return result;
  }

  /**
   * Shorten sentences
   */
  private shortenSentences(text: string, style: string): string {
    const maxLength = style === 'simple' ? 20 : style === 'intermediate' ? 30 : 50;
    
    return text
      .split(/[.!?]+/)
      .map(s => {
        const trimmed = s.trim();
        if (trimmed.length > maxLength) {
          return trimmed.substring(0, maxLength) + '...';
        }
        return trimmed;
      })
      .join('. ');
  }

  /**
   * Select appropriate level for user
   */
  private selectAppropriateLevel(
    expertise: 'beginner' | 'intermediate' | 'expert'
  ): 'eli5' | 'summary' | 'full' {
    if (expertise === 'beginner') return 'eli5';
    if (expertise === 'intermediate') return 'summary';
    return 'full';
  }

  /**
   * Get token count for selected level
   */
  private getTokensForLevel(
    level: 'eli5' | 'summary' | 'full',
    eli5Tokens: number,
    summaryTokens: number,
    fullTokens: number
  ): number {
    if (level === 'eli5') return eli5Tokens;
    if (level === 'summary') return summaryTokens;
    return fullTokens;
  }

  /**
   * Estimate tokens in text (rough: 4 chars per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate complexity (0-100)
   */
  private calculateComplexity(text: string): number {
    // Count technical terms and complex words
    const technicalTerms = this.extractTechnicalTerms(text).length;
    const sentences = text.split(/[.!?]+/).length;
    const avgLength = text.length / Math.max(sentences, 1);

    // Score: 0-30 terms, 0-20 sentence complexity, 0-50 length
    const termScore = Math.min(technicalTerms, 30);
    const sentenceScore = Math.min(sentences / 5, 20);  // More sentences = more complex
    const lengthScore = Math.min(avgLength / 2, 50);   // Longer sentences = more complex

    return Math.round(termScore + sentenceScore + lengthScore) / 100 * 100;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      availableLayers: Array.from(this.layers.entries()).map(([id, layer]) => ({
        id,
        name: layer.name,
        tokenBudget: layer.tokenBudget,
        style: layer.style
      })),
      stylePatterns: Array.from(this.stylePatterns.entries()).map(([style, patterns]) => ({
        style,
        patternCount: patterns.length
      }))
    };
  }

  /**
   * Customize layer
   */
  customizeLayer(
    levelId: string,
    updates: Partial<ResponseLayer>
  ): void {
    const current = this.layers.get(levelId);
    if (current) {
      this.layers.set(levelId, { ...current, ...updates });
    }
  }
}

export default LayeredResponseGenerator;
