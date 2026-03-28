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

// Components are exported from respective files
// import Breadcrumb from '../components/Breadcrumb';
// import WindowControls from '../components/WindowControls';
