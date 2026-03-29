# Quick Integration Guide

## 🎯 Wie die neuen Komponenten & Services nutzen

### 1. **Breadcrumb in FileExplorer integrieren**

```tsx
// src/App.tsx (oder FileExplorer)
import Breadcrumb from './components/Breadcrumb';
import { FileSystemItem } from './types';

// Breadcrumb items aus aktuellem Pfad erzeugen
const getBreadcrumbItems = (items: Record<string, FileSystemItem>, currentFile: string | null) => {
  if (!currentFile) return [];
  
  const file = items[currentFile];
  if (!file) return [];

  const breadcrumbs: Array<{ id: string; name: string; path: string; isDirectory?: boolean }> = [];
  let current: FileSystemItem | undefined = file;

  while (current) {
    breadcrumbs.unshift({
      id: current.id,
      name: current.name,
      path: current.path,
      isDirectory: current.type === 'directory'
    });
    
    current = current.parentId ? items[current.parentId] : undefined;
  }

  return breadcrumbs;
};

// Im JSX:
const breadcrumbItems = getBreadcrumbItems(fileSystem.items, fileSystem.currentFileId);

<Breadcrumb
  items={breadcrumbItems}
  onNavigate={(itemId) => {
    const item = fileSystem.items[itemId];
    if (item) onFileSelect(itemId);
  }}
/>
```

---

### 2. **Window Controls in Titlebar nutzen**

```tsx
// src/components/Titlebar.tsx
import WindowControls from './WindowControls';

// Ersetze die alten Buttons mit:
<WindowControls
  onMinimize={handleMinimize}
  onMaximize={handleMaximize}
  onClose={handleClose}
  isMaximized={isMaximized}
  position="right"
  theme="dark"
/>
```

---

### 3. **AI Backend Service in LLMChat nutzen**

```tsx
// src/components/LLMChat.tsx
import { AIBackendService } from '../services';

// Streaming mit Optimierungen:
const streamResponse = async (endpoint: string, prompt: string) => {
  try {
    for await (const chunk of AIBackendService.streamResponse(endpoint, prompt, {
      batchSize: 5,
      maxRetries: 3,
      timeout: 30000
    })) {
      // Update UI mit neuem chunk
      setStreamingContent(prev => prev + chunk);
    }
  } catch (error) {
    console.error('Streaming error:', error);
  }
};

// Response cachen:
const getCachedResponse = () => {
  return AIBackendService.getCachedOrFresh(
    `query-${prompt}`,
    () => fetchFromAPI(prompt),
    3600000 // 1 hour
  );
};
```

---

### 4. **Conversation Context Manager**

```tsx
// src/components/LLMChat.tsx
import { ConversationContextManager } from '../services';

const handleNewChat = (chatId: string) => {
  ConversationContextManager.createContext(chatId, 'default-model', [
    'model-1',
    'model-2',
    'model-3'
  ]);
};

const addMessageToContext = (chatId: string, message: any) => {
  const { success, tokensUsed } = ConversationContextManager.addMessage(chatId, message);
  console.log(`Tokens used: ${tokensUsed}`);
};

const switchModel = (chatId: string, newModel: string) => {
  const success = ConversationContextManager.switchModel(chatId, newModel);
  if (success) {
    console.log(`Switched to ${newModel}`);
  }
};

// Get Context window für API request:
const getContextForAPI = (chatId: string) => {
  return ConversationContextManager.getContextWindow(chatId, 20);
};
```

---

### 5. **Performance Monitoring**

```tsx
// src/App.tsx (am Start)
import { PerformanceOptimizer } from './services';

useEffect(() => {
  PerformanceOptimizer.initialize();
}, []);

// Track operations:
const handleFileLoad = async (fileId: string) => {
  PerformanceOptimizer.mark('file-load');
  
  // Load file...
  await loadFile(fileId);
  
  const duration = PerformanceOptimizer.measure('file-load', {
    fileId,
    size: fileSize
  });
  
  console.log(`File loaded in ${duration}ms`);
};

// Get performance dashboard:
const getMetrics = () => {
  const summary = PerformanceOptimizer.getSummary();
  const bottlenecks = PerformanceOptimizer.findBottlenecks(100);
  const memory = PerformanceOptimizer.getMemoryUsage();
  
  console.table({
    summary,
    bottlenecks,
    memory
  });
};
```

---

### 6. **Utility Functions**

```tsx
// Extract relevant context from large files
import { AIBackendService } from '../services';

const getSmartContext = (fileContent: string, query: string) => {
  return AIBackendService.extractRelevantContext(
    fileContent,
    query,
    50 // max lines
  );
};

// Get model performance comparison
import { PerformanceOptimizer } from '../services';

const compareModels = () => {
  const metrics = AIBackendService.getModelMetrics();
  console.log('Model Performance:', metrics);
};

// Export conversation for backup
import { ConversationContextManager } from '../services';

const exportCurrentChat = (chatId: string) => {
  const json = ConversationContextManager.exportConversation(chatId);
  downloadFile(json, `chat-${chatId}.json`);
};
```

---

## 📊 Performance Monitoring UI (Optional)

Erstelle ein Dev Panel zur Anzeige von Metrics:

```tsx
// src/components/DevPanel.tsx
const DevPanel = () => {
  const [metrics, setMetrics] = useState(null);

  const refresh = () => {
    const summary = PerformanceOptimizer.getSummary();
    const bottlenecks = PerformanceOptimizer.findBottlenecks();
    const memory = PerformanceOptimizer.getMemoryUsage();
    
    setMetrics({ summary, bottlenecks, memory });
  };

  return (
    <div className="dev-panel">
      <button onClick={refresh}>Refresh Metrics</button>
      <div>FPS: {metrics?.summary?.fps}</div>
      <div>Memory: {memory?.percentage}%</div>
      <div>Bottlenecks: {bottlenecks?.length}</div>
    </div>
  );
};
```

---

## 🔄 Nächste Sicherungsschritte

1. Integriere **Breadcrumb** in FileExplorer
2. Ersetze **Window Controls** im Titlebar
3. Nutze **AIBackendService** für LM Studio Streaming
4. Aktiviere **ConversationContextManager** für Chat Sessions
5. Starte **PerformanceOptimizer** beim App-Init
6. Teste alle Services auf Typsicherheit
7. Committe & push zu Feature Branch

---

**Status**: Ready for integration
**Last Updated**: March 28, 2026
