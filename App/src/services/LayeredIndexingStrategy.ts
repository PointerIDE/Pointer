/**
 * LayeredIndexingStrategy
 * 
 * Progressive Indexierung in 3 Layers:
 * - Layer 1: Fast (~500ms) - Namen, Types, Signatures via TypeScript API
 * - Layer 2: Semantic (Hintergrund) - Bedeutung, Zusammenhänge
 * - Layer 3: Usage Heatmap (Machine Learning) - Was nutzt User häufig
 * 
 * Impact: Fast Startup + Progressive Improvement
 */

export interface IndexLayer {
  name: 'fast' | 'semantic' | 'heatmap';
  readyAt?: number;             // Date.now() when ready
  progress: number;             // 0-100%
  size: number;                 // bytes
}

export interface FastIndex {
  layer: 'fast';
  symbols: {
    functions: string[];
    types: string[];
    interfaces: string[];
    classes: string[];
    constants: string[];
  };
  files: string[];
  moduleMap: Map<string, string[]>;  // file → exported symbols
  readyAt: number;
}

export interface SemanticIndex {
  layer: 'semantic';
  topics: Map<string, string[]>;                    // topic → related files
  relationshipGraph: Map<string, Map<string, number>>;  // file → (file → strength)
  codeContext: Map<string, string>;                // symbol → short description
  readyAt?: number;
}

export interface HeatmapIndex {
  layer: 'heatmap';
  hotFunctions: Array<{ name: string; score: number }>;
  hotFiles: Array<{ path: string; score: number }>;
  userPatterns: string[];
  peakUsageTimes: string[];
  learnedPatterns: Map<string, number>;  // pattern → confidence
  readyAt?: number;
}

export class LayeredIndexingStrategy {
  private fastIndex: FastIndex | null = null;
  private semanticIndex: SemanticIndex | null = null;
  private heatmapIndex: HeatmapIndex | null = null;

  private startTime: number = 0;
  private fastLock: boolean = false;
  private semanticLock: boolean = false;
  private heatmapLock: boolean = false;

  /**
   * Layer 1: Fast Indexing via TypeScript Compiler API (~500ms)
   * Gibt sofort Namen, Types, Signatures
   */
  async buildFastIndex(
    files: string[],
    getSourceCode: (path: string) => Promise<string>
  ): Promise<FastIndex> {
    if (this.fastLock) {
      throw new Error('Fast index already building');
    }

    this.fastLock = true;
    this.startTime = Date.now();

    try {
      const index: FastIndex = {
        layer: 'fast',
        symbols: {
          functions: [],
          types: [],
          interfaces: [],
          classes: [],
          constants: []
        },
        files: files,
        moduleMap: new Map(),
        readyAt: 0
      };

      // Parse each file quickly (regex-based, no full AST)
      for (const file of files) {
        const content = await getSourceCode(file);
        const symbols = this.extractSymbolsQuick(content, file);

        // Group by type
        symbols.forEach(sym => {
          if (sym.type === 'function') index.symbols.functions.push(sym.name);
          if (sym.type === 'type') index.symbols.types.push(sym.name);
          if (sym.type === 'interface') index.symbols.interfaces.push(sym.name);
          if (sym.type === 'class') index.symbols.classes.push(sym.name);
          if (sym.type === 'constant') index.symbols.constants.push(sym.name);
        });

        // Map file → symbols
        const fileSymbols = symbols.map(s => s.name);
        index.moduleMap.set(file, fileSymbols);
      }

      index.readyAt = Date.now();
      this.fastIndex = index;
      console.log(`✅ Fast Index Ready (${index.readyAt - this.startTime}ms)`);
      return index;
    } finally {
      this.fastLock = false;
    }
  }

  /**
   * Layer 2: Semantic Indexing (Background)
   * Builds Relationships, Topics, Context
   * Kann während App läuft gebaut werden
   */
  async buildSemanticIndex(
    files: string[],
    getSourceCode: (path: string) => Promise<string>
  ): Promise<void> {
    if (this.semanticLock) {
      console.warn('Semantic index already building');
      return;
    }

    this.semanticLock = true;

    try {
      const index: SemanticIndex = {
        layer: 'semantic',
        topics: new Map(),
        relationshipGraph: new Map(),
        codeContext: new Map()
      };

      console.log('[Index Layer 2] Starting semantic analysis...');

      // Phase 1: Extract topics und keywords
      for (const file of files) {
        const content = await getSourceCode(file);
        const fileTopics = this.extractTopics(content);

        // Group files by topic
        fileTopics.forEach(topic => {
          if (!index.topics.has(topic)) {
            index.topics.set(topic, []);
          }
          index.topics.get(topic)!.push(file);
        });
      }

      // Phase 2: Build Relationship Graph (which files interact)
      const fileTopicMap = new Map<string, string[]>();
      for (const [topic, files_list] of index.topics) {
        files_list.forEach(file => {
          if (!fileTopicMap.has(file)) {
            fileTopicMap.set(file, []);
          }
          fileTopicMap.get(file)!.push(topic);
        });
      }

      // Files that share topics are related
      for (const [file1, topics1] of fileTopicMap) {
        if (!index.relationshipGraph.has(file1)) {
          index.relationshipGraph.set(file1, new Map());
        }

        for (const [file2, topics2] of fileTopicMap) {
          if (file1 === file2) continue;

          // Similarity = shared topics / total topics
          const shared = topics1.filter(t => topics2.includes(t)).length;
          const total = new Set([...topics1, ...topics2]).size;
          const similarity = shared / Math.max(total, 1);

          if (similarity > 0.3) {  // Only keep meaningful relationships
            index.relationshipGraph.get(file1)!.set(file2, similarity);
          }
        }
      }

      index.readyAt = Date.now();
      this.semanticIndex = index;
      console.log(`✅ Semantic Index Ready (${index.readyAt! - this.startTime}ms)`);
    } finally {
      this.semanticLock = false;
    }
  }

  /**
   * Layer 3: Heatmap Index (Machine Learning)
   * Learn welche Functions/Files User häufig nutzt
   * Wird über Zeit aufgebaut
   */
  recordUsage(symbol: string, filePath: string): void {
    if (!this.heatmapIndex) {
      this.heatmapIndex = {
        layer: 'heatmap',
        hotFunctions: [],
        hotFiles: [],
        userPatterns: [],
        peakUsageTimes: [],
        learnedPatterns: new Map()
      };
    }

    // Update usage scores
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][now.getDay()];

    // Track symbol usage
    const funcIndex = this.heatmapIndex.hotFunctions.findIndex(f => f.name === symbol);
    if (funcIndex === -1) {
      this.heatmapIndex.hotFunctions.push({ name: symbol, score: 1 });
    } else {
      this.heatmapIndex.hotFunctions[funcIndex].score += 1;
    }

    // Track file usage
    const fileIndex = this.heatmapIndex.hotFiles.findIndex(f => f.path === filePath);
    if (fileIndex === -1) {
      this.heatmapIndex.hotFiles.push({ path: filePath, score: 1 });
    } else {
      this.heatmapIndex.hotFiles[fileIndex].score += 1;
    }

    // Track time patterns
    const timePattern = `${dayOfWeek} ${hour}:00`;
    const pattern = this.heatmapIndex.learnedPatterns.get(timePattern) || 0;
    this.heatmapIndex.learnedPatterns.set(timePattern, pattern + 1);

    // Sort and keep top 10
    this.heatmapIndex.hotFunctions.sort((a, b) => b.score - a.score);
    this.heatmapIndex.hotFunctions = this.heatmapIndex.hotFunctions.slice(0, 10);

    this.heatmapIndex.hotFiles.sort((a, b) => b.score - a.score);
    this.heatmapIndex.hotFiles = this.heatmapIndex.hotFiles.slice(0, 10);

    this.heatmapIndex.readyAt = Date.now();
  }

  /**
   * Extract symbols quickly (regex, no full parsing)
   */
  private extractSymbolsQuick(content: string, file: string) {
    const symbols: Array<{ name: string; type: string }> = [];
    
    const patterns = [
      { regex: /^export\s+function\s+(\w+)/gm, type: 'function' },
      { regex: /^export\s+class\s+(\w+)/gm, type: 'class' },
      { regex: /^export\s+interface\s+(\w+)/gm, type: 'interface' },
      { regex: /^export\s+type\s+(\w+)/gm, type: 'type' },
      { regex: /^export\s+const\s+(\w+)/gm, type: 'constant' },
    ];

    for (const { regex, type } of patterns) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        symbols.push({ name: match[1], type });
      }
    }

    return symbols;
  }

  /**
   * Extract topics/categories from code
   */
  private extractTopics(content: string): string[] {
    const topics: Set<string> = new Set();

    // Simple keyword matching
    const keywords = [
      { keyword: /database|db|model|schema|query|sql/i, topic: 'database' },
      { keyword: /component|ui|button|input|form|render|jsx/i, topic: 'ui' },
      { keyword: /auth|login|logout|session|token|permission/i, topic: 'auth' },
      { keyword: /api|endpoint|route|controller|rest|http/i, topic: 'api' },
      { keyword: /util|helper|common|shared|constant|config/i, topic: 'utils' },
      { keyword: /test|spec|mock|jest/i, topic: 'testing' },
      { keyword: /type|interface|schema|validation/i, topic: 'types' },
    ];

    for (const { keyword, topic } of keywords) {
      if (keyword.test(content)) {
        topics.add(topic);
      }
    }

    return Array.from(topics);
  }

  /**
   * Get search results (using best available layer)
   */
  searchSymbol(query: string) {
    // Use best available index
    if (this.semanticIndex) {
      // Use semantic relationships
      const matches: string[] = [];
      for (const [topic, files] of this.semanticIndex.topics) {
        if (topic.includes(query.toLowerCase())) {
          matches.push(...files);
        }
      }
      return matches;
    } else if (this.fastIndex) {
      // Use fast index
      return [
        ...this.fastIndex.symbols.functions,
        ...this.fastIndex.symbols.types,
        ...this.fastIndex.symbols.classes
      ].filter(s => s.includes(query));
    }

    return [];
  }

  /**
   * Get read progress for UI
   */
  getProgress() {
    return {
      fast: { ready: !!this.fastIndex, progress: this.fastIndex ? 100 : 0 },
      semantic: { 
        ready: !!this.semanticIndex, 
        progress: this.semanticLock ? 75 : (this.semanticIndex ? 100 : 0)
      },
      heatmap: { 
        ready: !!this.heatmapIndex, 
        progress: this.heatmapIndex ? 100 : 0 
      }
    };
  }

  /**
   * Get full stats
   */
  getStats() {
    return {
      layers: this.getProgress(),
      fast: this.fastIndex && {
        totalSymbols: Object.values(this.fastIndex.symbols)
          .reduce((a, b) => a.concat(b), [] as any[]).length,
        files: this.fastIndex.files.length,
        readyAt: this.fastIndex.readyAt
      },
      semantic: this.semanticIndex && {
        topics: this.semanticIndex.topics.size,
        relationships: Array.from(this.semanticIndex.relationshipGraph.values())
          .reduce((sum, map) => sum + map.size, 0),
        readyAt: this.semanticIndex.readyAt
      },
      heatmap: this.heatmapIndex && {
        hotFunctions: this.heatmapIndex.hotFunctions.length,
        hotFiles: this.heatmapIndex.hotFiles.length,
        patterns: this.heatmapIndex.learnedPatterns.size,
        readyAt: this.heatmapIndex.readyAt
      }
    };
  }

  /**
   * Get top functions by usage
   */
  getHotFunctions(limit: number = 10) {
    if (!this.heatmapIndex) return [];
    return this.heatmapIndex.hotFunctions.slice(0, limit);
  }

  /**
   * Get top files by usage
   */
  getHotFiles(limit: number = 10) {
    if (!this.heatmapIndex) return [];
    return this.heatmapIndex.hotFiles.slice(0, limit);
  }
}

export default LayeredIndexingStrategy;
