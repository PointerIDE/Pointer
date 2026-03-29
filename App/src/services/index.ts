/**
 * Enhanced Services & Components Export
 * Centralized exports for all new improvements
 */

// Core Services
export { AIBackendService } from './AIBackendService';
export type { StreamingOptions } from './AIBackendService';

export { ConversationContextManager } from './ConversationContextManager';
export type { 
  ConversationContext,
  ContextSnapshot
} from './ConversationContextManager';

export { PerformanceOptimizer } from './PerformanceOptimizer';
export type { 
  PerformanceMetric,
  PerformanceThresholds
} from './PerformanceOptimizer';

export { LMStudioStreamingService } from './LMStudioStreamingService';

// Backend Architecture Services (Tier 1 Implementation)
export { AdaptiveTokenBatcher } from './AdaptiveTokenBatcher';
export type { StreamMetrics, BatchConfig } from './AdaptiveTokenBatcher';

export { PredictiveContextManager } from './PredictiveContextManager';
export type { 
  PredictionConfidence,
  QueryPattern
} from './PredictiveContextManager';

export { HierarchicalTokenTreeChunking } from './HierarchicalTokenTreeChunking';
export type { 
  CodeNode,
  TokenTree
} from './HierarchicalTokenTreeChunking';

export { SemanticDependencyIndex } from './SemanticDependencyIndex';
export type { 
  DependencyNode,
  CallGraph,
  DependencyGraph
} from './SemanticDependencyIndex';

export { LayeredIndexingStrategy } from './LayeredIndexingStrategy';
export type { 
  IndexLayer,
  FastIndex,
  SemanticIndex,
  HeatmapIndex
} from './LayeredIndexingStrategy';

// Backend Architecture Services (Tier 2 Implementation)
export { IncrementalCodebaseSync } from './IncrementalCodebaseSync';
export type {
  FileChange,
  ASTDiff
} from './IncrementalCodebaseSync';

export { TokenBudgetManager } from './TokenBudgetManager';
export type {
  TokenRequest,
  BudgetStats
} from './TokenBudgetManager';

export { CodeCompressor } from './CodeCompressor';
export type {
  CompressionResult,
  CompressionOptions
} from './CodeCompressor';

export { SemanticVersionedCache } from './SemanticVersionedCache';
export type {
  CacheEntry,
  CacheDecision
} from './SemanticVersionedCache';

export { ResponseInterceptionManager } from './ResponseInterceptionManager';
export type {
  InterceptionContext,
  InterceptionResult
} from './ResponseInterceptionManager';

export { RequestDeduplicator } from './RequestDeduplicator';
export type {
  DuplicateQuery,
  DeduplicationResult
} from './RequestDeduplicator';

export { LayeredResponseGenerator } from './LayeredResponseGenerator';
export type {
  ResponseLayer,
  LayeredResponse
} from './LayeredResponseGenerator';

export { PersistentMemoryIndexBuilder } from './PersistentMemoryIndexBuilder';
export type {
  MemoryEntry,
  ConceptHub,
  SessionMetadata
} from './PersistentMemoryIndexBuilder';

export { BatchQueryOptimizer } from './BatchQueryOptimizer';
export type {
  BatchableQuery,
  QueryBatch,
  BatchResult
} from './BatchQueryOptimizer';

export { OutputStreamOptimizer } from './OutputStreamOptimizer';
export type {
  StreamChunk,
  StreamConfig,
  StreamStats
} from './OutputStreamOptimizer';

// Components are exported from respective files
// import Breadcrumb from '../components/Breadcrumb';
// import WindowControls from '../components/WindowControls';
