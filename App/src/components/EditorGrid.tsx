import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as monaco from 'monaco-editor';
import { FileSystemItem, TabInfo } from '../types';
import { getLanguageFromFileName } from '../utils/languageUtils';
import { AIFileService } from '../services/AIFileService';
import { FileSystemService } from '../services/FileSystemService';
import { showToast } from '../services/ToastService';
import { FileViewer, isImageFile, isBinaryFile, isPdfFile, isDatabaseFile } from './FileViewer';
import Modal from './Modal';
import PreviewPane from './PreviewPane';
import lmStudio from '../services/LMStudioService';

// Get access to the App's applyCustomTheme function through the window object
declare global {
  interface Window {
    editor?: monaco.editor.IStandaloneCodeEditor;
    editorSettings?: { autoAcceptGhostText: boolean };
  }
}

// Function to remove <think> and </think> tags and their content
const stripThinkTags = (text: string): string => {
  // Remove <think>...</think> blocks (case insensitive, handles multiline)
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
};

interface EditorPaneProps {
  fileId: string;
  file: FileSystemItem;
  onEditorReady: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  setSaveStatus?: (status: 'saving' | 'saved' | 'error' | null) => void;
}

// No longer needed as we're using the generic Modal component

const EditorPane: React.FC<EditorPaneProps> = ({ fileId, file, onEditorReady, setSaveStatus }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const contentRef = useRef<string>('');
  // Add state to track file type
  const [fileType, setFileType] = useState<'text' | 'image' | 'binary' | 'pdf' | 'database'>('text');
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResponsePreview, setShowResponsePreview] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [originalContent, setOriginalContent] = useState('');
  const editorInitializedRef = useRef(false);
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPositionRef = useRef<monaco.Position | null>(null);
  const inlineCompletionWidgetRef = useRef<any>(null);
  // Always enabled by default (was previously set to true but might have been changed by users)
  const [completionEnabled, setCompletionEnabled] = useState(true);
  // Add auto-save timeout ref
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Add separate timeout ref for function detection
  const functionDetectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track if content has changed since last save
  const contentChangedRef = useRef<boolean>(false);
  // Add tracking for function decorations
  const functionDecorationsRef = useRef<string[]>([]);
  const explainWidgetsRef = useRef<monaco.editor.IContentWidget[]>([]);
  // Store detected functions
  const detectedFunctionsRef = useRef<{
    lineNumber: number,
    name: string,
    code: string,
    range: monaco.Range
  }[]>([]);
  // Add state for function explanation dialog
  const [functionExplanationDialog, setFunctionExplanationDialog] = useState<{
    isOpen: boolean;
    functionName: string;
    explanation: string;
    isLoading: boolean;
    isStreaming: boolean;
  }>({
    isOpen: false,
    functionName: '',
    explanation: '',
    isLoading: false,
    isStreaming: false
  });

  // Add cleanup effect to reset streaming state on unmount
  useEffect(() => {
    return () => {
      // Reset streaming state when component unmounts
      setFunctionExplanationDialog(prev => ({
        ...prev,
        isStreaming: false
      }));
    };
  }, []);

  // Normalize content once when file changes
  useEffect(() => {
    if (file?.name) {
      // Determine file type based on extension
      if (isImageFile(file.name)) {
        setFileType('image');
      } else if (isPdfFile(file.name)) {
        setFileType('pdf');
      } else if (isDatabaseFile(file.name)) {
        setFileType('database');
      } else if (isBinaryFile(file.name)) {
        setFileType('binary');
      } else {
        setFileType('text');
      }
    }

    if (file?.content) {
      contentRef.current = file.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    } else if (fileId === 'welcome') {
      // Default content for welcome file if it doesn't have content
      contentRef.current = "// Welcome to your new code editor!\n// Start typing here...\n\n// By the way you can't delete or save this file. (future updates (maybe (if i have motivation)))"
    } else {
      contentRef.current = '';
    }
  }, [file?.content, file?.name, fileId]);

  // Setup editor with ghost text completion - only for text files
  useEffect(() => {
    // Only create editor for text files
    if (fileType !== 'text' || !editorRef.current || editorInitializedRef.current) return;

    const language = file ? getLanguageFromFileName(file.name) : 'javascript';
    const uri = monaco.Uri.parse(file?.path || `file:///${fileId}.js`);

    // Check if a model already exists for this file
    let model = monaco.editor.getModel(uri);
    
    // If model exists, update its value
    if (model) {
      if (model.getValue() !== contentRef.current) {
        model.setValue(contentRef.current);
      }
    } else {
      // Create new model only if it doesn't exist
      model = monaco.editor.createModel(
        contentRef.current,
        language,
        uri
      );
      model.setEOL(monaco.editor.EndOfLineSequence.LF);
    }

    // Define editor options with proper typing
    const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
      model: model,
      automaticLayout: true,
      minimap: {
        enabled: false
      },
      lineNumbers: 'on',
      wordWrap: 'off',
      renderWhitespace: 'selection',
      scrollBeyondLastLine: false,
      cursorStyle: 'line',
      lineHeight: 19,
      renderFinalNewline: 'on',
      detectIndentation: true,
      trimAutoWhitespace: true
    };

    // Create editor with the model
    editor.current = monaco.editor.create(editorRef.current, editorOptions);

    // Load settings first, then apply the custom theme
    if (window.loadSettings) {
      window.loadSettings().then(() => {
        // Apply the custom theme after settings are loaded
        if (window.applyCustomTheme) {
          window.applyCustomTheme();
        }
      }).catch(err => {
        console.error('Error loading settings:', err);
        // Apply theme anyway as fallback
        if (window.applyCustomTheme) {
          window.applyCustomTheme();
        }
      });
    } else if (window.applyCustomTheme) {
      // Fallback if loadSettings is not available
      window.applyCustomTheme();
    }

    // Handle all keyboard events in one place for consistency
    editor.current.onKeyDown((e) => {
      // Tab key to accept ghost text
      if (e.keyCode === monaco.KeyCode.Tab && inlineCompletionWidgetRef.current) {
        acceptGhostText();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      // Keys that should dismiss ghost text
      const dismissKeyCodes = [
        monaco.KeyCode.Escape,
        monaco.KeyCode.Enter,
        monaco.KeyCode.Backspace,
        monaco.KeyCode.Delete
      ];
      
      if (inlineCompletionWidgetRef.current && dismissKeyCodes.includes(e.keyCode)) {
        removeGhostText();
        // Default behavior continues naturally
      }
    });

    // Add keyboard event handler for Ctrl+I
    editor.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => {
      setShowPromptInput(true);
    });

    // Add Ctrl+Space command for manual code completion
    editor.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {
      console.log("Manual code completion triggered");
      const currentPosition = editor.current?.getPosition();
      if (currentPosition) {
        lastPositionRef.current = currentPosition;
        requestCodeCompletion();
      }
      return null;
    });

    // Add keyboard shortcut to toggle auto-completion (Ctrl+Shift+Space)
    editor.current.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Space, 
      () => {
        setCompletionEnabled(!completionEnabled);
        console.log(completionEnabled ? "Auto-completion disabled" : "Auto-completion enabled");
        return null;
      }
    );

    // Add content change listener for code completion
    if (editor.current && model) {
      model.onDidChangeContent((e) => {
        // Clear any existing timeouts
        if (completionTimeoutRef.current) {
          clearTimeout(completionTimeoutRef.current);
          completionTimeoutRef.current = null;
        }
        
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
          autoSaveTimeoutRef.current = null;
        }

        // Flag that content has changed and needs saving
        contentChangedRef.current = true;

        // Remove any existing ghost text
        removeGhostText();

        // Skip auto-completion if explicitly disabled by user
        if (!completionEnabled) return;

        // Only request completion if the change was due to typing (not programmatic)
        // and there are actual text changes (not just line breaks)
        const hasTextChanges = e.changes.some(change => 
          change.text && change.text.trim().length > 0);
          
        // Don't trigger completion after deleting text
        const isDeletion = e.changes.some(change => 
          change.text.length === 0 && change.rangeLength > 0);
        
        console.log("Content changed:", { hasTextChanges, isDeletion, completionEnabled });
        
        if (hasTextChanges && !isDeletion) {
          console.log("Setting up completion timeout (200ms)");
          // Setup a new timeout with proper delay
          completionTimeoutRef.current = setTimeout(() => {
            console.log("Timeout fired, triggering suggestions");
            completionTimeoutRef.current = null;
            
            // Get current position for both Monaco suggestions and our custom completions
            const currentPosition = editor.current?.getPosition();
            if (currentPosition && editor.current) {
              // Store position for our custom ghost text completion
              lastPositionRef.current = currentPosition;
              
              // First trigger Monaco's native suggestions (built-in autocomplete)
              try {
                console.log("Triggering Monaco built-in suggestions");
                editor.current.trigger('keyboard', 'editor.action.triggerSuggest', {});
              } catch (err) {
                console.error("Error triggering Monaco suggestions:", err);
              }
              
              // Then trigger our custom AI-powered completions
              requestCodeCompletion();
            }
          }, 200); // Changed to 200ms as requested
        }

        // Set up auto-save timeout
        if (fileId && fileId !== 'welcome') {
          console.log(`Setting up auto-save for file: ${fileId}, path: ${file?.path}`);
          autoSaveTimeoutRef.current = setTimeout(() => {
            console.log(`Auto-save timeout fired for file: ${fileId}`);
            autoSaveTimeoutRef.current = null;
            saveCurrentFile();
          }, 1000); // Fixed 1 second delay for auto-save
        } else {
          console.log(`Skipping auto-save setup - fileId: ${fileId}, welcome file or no fileId`);
        }
      });
    }

    if (editor.current) {
      editorInitializedRef.current = true;
      onEditorReady(editor.current);
    }

    // Handle cursor position changes
    editor.current.onDidChangeCursorPosition((e) => {
      // If the cursor position changes significantly, remove ghost text
      if (inlineCompletionWidgetRef.current && lastPositionRef.current) {
        const lastPos = lastPositionRef.current;
        const currentPos = e.position;
        
        // Remove ghost text if cursor moved to a different line or column
        if (lastPos.lineNumber !== currentPos.lineNumber || 
            Math.abs(lastPos.column - currentPos.column) > 1) {
          removeGhostText();
        }
        
        // Update the last position
        lastPositionRef.current = currentPos;
      }
    });

    // Clean up on unmount
    return () => {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
      }
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      if (functionDetectionTimeoutRef.current) {
        clearTimeout(functionDetectionTimeoutRef.current);
      }
      // Try to save once more before unmounting
      saveCurrentFile();
      removeGhostText();
    };
  }, [fileType, fileId, onEditorReady, completionEnabled]);

  // Helper function to extract imports from content
  const extractImports = (content: string): string[] => {
    const imports: string[] = [];
    
    // Match import statements in JavaScript/TypeScript
    const jsImportRegex = /import\s+.*?from\s+['"].*?['"]/g;
    const jsImports = content.match(jsImportRegex) || [];
    imports.push(...jsImports);
    
    // Match require statements in JavaScript
    const requireRegex = /(?:const|let|var)\s+.*?=\s+require\(['"].*?['"]\)/g;
    const requires = content.match(requireRegex) || [];
    imports.push(...requires);
    
    // Match Python imports
    const pyImportRegex = /(?:import|from)\s+.*?(?:import|\n|$)/g;
    const pyImports = content.match(pyImportRegex) || [];
    imports.push(...pyImports);
    
    return imports;
  };
  
  // Helper function to extract major declarations based on language
  const extractDeclarations = (content: string, language: string): string[] => {
    const declarations: string[] = [];
    
    if (language === 'javascript' || language === 'typescript') {
      // Match function and class declarations
      const funcClassRegex = /(?:function|class|const|let|var)\s+\w+\s*(?:[=({]|extends)/g;
      const funcClass = content.match(funcClassRegex) || [];
      declarations.push(...funcClass);
      
      // Match export statements
      const exportRegex = /export\s+(?:const|let|var|function|class|default|{)/g;
      const exports = content.match(exportRegex) || [];
      declarations.push(...exports);
    } else if (language === 'python') {
      // Match function and class declarations in Python
      const pyFuncClassRegex = /(?:def|class)\s+\w+\s*(?:\(|\:)/g;
      const pyFuncClass = content.match(pyFuncClassRegex) || [];
      declarations.push(...pyFuncClass);
    }
    
    return declarations;
  };

  // Helper function to extract imported modules/paths from content
  const extractImportPaths = (content: string): string[] => {
    const importPaths: string[] = [];
    
    // Extract import paths from JavaScript/TypeScript
    const jsImportPathRegex = /(?:import|require)\s+.*?(?:from\s+|['"'"])\s*['"]([^'"'"]+)['"'"]]/g;
    let match;
    while ((match = jsImportPathRegex.exec(content)) !== null) {
      if (match[1] && !match[1].startsWith('.')) continue; // Skip non-relative imports
      if (match[1]) importPaths.push(match[1]);
    }
    
    // Extract import paths from Python
    const pyImportPathRegex = /from\s+([^\s]+)\s+import/g;
    while ((match = pyImportPathRegex.exec(content)) !== null) {
      if (match[1] && !match[1].startsWith('.')) continue; // Skip non-relative imports
      if (match[1]) importPaths.push(match[1]);
    }
    
    return importPaths;
  };
  
  // Get context from related files based on imports
  const getRelatedFilesContext = async (currentFilePath: string, content: string): Promise<string> => {
    try {
      const importPaths = extractImportPaths(content);
      if (importPaths.length === 0) return '';
      
      let relatedFilesContext = '';
      
      // Get the directory of the current file
      const currentDir = currentFilePath.split('/').slice(0, -1).join('/');
      
      // Try to resolve each import path to a file
      for (const importPath of importPaths) {
        try {
          // Normalize path based on whether it's relative or not
          let fullPath = importPath;
          if (importPath.startsWith('.')) {
            // Resolve relative path
            fullPath = `${currentDir}/${importPath}`.replace(/\/\.\//g, '/');
          }
          
          // Handle different file extensions (.js, .ts, etc.) or no extension
          const potentialExtensions = ['', '.js', '.jsx', '.ts', '.tsx', '.py'];
          
          for (const ext of potentialExtensions) {
            const pathToTry = `${fullPath}${ext}`;
            
            try {
              // Fetch file content
              const response = await fetch(`http://localhost:23816/read-file?path=${encodeURIComponent(pathToTry)}`);
              
              if (response.ok) {
                const fileContent = await response.text();
                
                // Extract key functions and classes from the imported file
                const language = pathToTry.split('.').pop() || '';
                const declarations = extractDeclarations(fileContent, language);
                
                // Add to context
                if (declarations.length > 0) {
                  relatedFilesContext += `
# Imported file: ${pathToTry}
# Key declarations:
${declarations.join('\n')}

`;
                }
                
                // Found a match, so break the extension loop
                break;
              }
            } catch (error) {
              // Continue trying other extensions
            }
          }
        } catch (error) {
          // Skip this import path if there's an error
          console.error('Error fetching imported file:', error);
        }
      }
      
      return relatedFilesContext;
    } catch (error) {
      console.error('Error getting related files context:', error);
      return '';
    }
  };

  // Request code completion from LM Studio 
  const requestCodeCompletion = async () => {
    if (!editor.current || !lastPositionRef.current) return;
    
    try {
      console.log("Requesting AI code completion");
      
      const model = editor.current.getModel();
      if (!model) return;

      const position = lastPositionRef.current;
      
      // Get text before the cursor for context
      const content = model.getValue();
      const textBeforeCursor = content.substring(0, model.getOffsetAt(position));
      
      // Get current line content and analyze it
      const lineContent = model.getLineContent(position.lineNumber);
      const lineBeforeCursor = lineContent.substring(0, position.column - 1);
      const lineAfterCursor = lineContent.substring(position.column - 1);
      
      // Get file extension and language for better context
      const fileExt = file?.name ? file.name.split('.').pop()?.toLowerCase() : '';
      const language = getLanguageFromFileName(file?.name || '');
      
      // Determine current code context (import, function, class, etc.)
      let codeContext = 'unknown';
      
      // Get the line number of the cursor position
      const cursorLineNumber = position.lineNumber;
      
      // Count total lines in the file
      const totalLines = model.getLineCount();
      
      // Get all lines of the file to analyze the structure
      const allLines = [];
      for (let i = 1; i <= totalLines; i++) {
        allLines.push(model.getLineContent(i));
      }
      
      // For Python files, do a more thorough structure analysis
      if (language === 'python') {
        // Find where import statements end in the file
        let importSectionEndLine = 1;
        let foundNonImport = false;
        
        for (let i = 0; i < allLines.length; i++) {
          const line = allLines[i].trim();
          // Skip empty lines and comments
          if (line === '' || line.startsWith('#')) {
            continue;
          }
          
          if (line.startsWith('import ') || line.startsWith('from ')) {
            if (!foundNonImport) {
              importSectionEndLine = i + 1;
            }
          } else {
            foundNonImport = true;
            // If we already found a non-import and now see another import,
            // it's probably not in the primary import section
            if (i > importSectionEndLine + 5) {
              break;
            }
          }
        }
        
        console.log(`Import section ends at line ${importSectionEndLine}, cursor at line ${cursorLineNumber}`);
        
        // Check if cursor is in the import section
        if (cursorLineNumber <= importSectionEndLine + 2) { // +2 for a bit of buffer
          codeContext = 'import';
        } else {
          // Look for function or class definitions above the cursor
          let insideFunction = false;
          let insideClass = false;
          let functionIndentation = 0;
          let classIndentation = 0;
          
          // Scan from the cursor position backwards to find what context we're in
          for (let i = cursorLineNumber - 1; i >= 0; i--) {
            const line = allLines[i];
            const trimmedLine = line.trim();
            const indentation = line.length - line.trimStart().length;
            
            if (trimmedLine.startsWith('def ') && trimmedLine.includes(':')) {
              functionIndentation = indentation;
              insideFunction = true;
              break;
            } else if (trimmedLine.startsWith('class ') && trimmedLine.includes(':')) {
              classIndentation = indentation;
              insideClass = true;
              break;
            } else if (trimmedLine && !trimmedLine.startsWith('#')) {
              // If we hit a non-empty, non-comment line with less indentation
              // than our cursor position, we're not inside any function or class
              const currentLineIndentation = lineContent.length - lineContent.trimStart().length;
              if (indentation < currentLineIndentation) {
                break;
              }
            }
          }
          
          // Determine context based on indentation and definitions
          if (insideFunction) {
            codeContext = 'function';
          } else if (insideClass) {
            codeContext = 'class';
          } else {
            codeContext = 'module';
          }
        }
      } else {
        // Original context detection for non-Python files
        // Check if we're in an import section
        const lastImportMatch = textBeforeCursor.match(/^([\s\S]*?)(import|from)\s+[^;]*?$/m);
        const isInImportSection = lastImportMatch && 
                                 (position.lineNumber <= textBeforeCursor.split('\n').length - lastImportMatch[0].split('\n').length + 5);
        
        // Check if we're inside a function definition
        const lastFunctionMatch = textBeforeCursor.match(/def\s+\w+\s*\([^)]*\)\s*:/);
        const isInFunction = lastFunctionMatch && 
                             !textBeforeCursor.substring(textBeforeCursor.lastIndexOf(lastFunctionMatch[0])).includes('\ndef ');
        
        // Check if we're inside a class definition
        const lastClassMatch = textBeforeCursor.match(/class\s+\w+/);
        const isInClass = lastClassMatch && 
                          !textBeforeCursor.substring(textBeforeCursor.lastIndexOf(lastClassMatch[0])).includes('\nclass ');
        
        // Assign code context based on position
        if (isInImportSection) {
          codeContext = 'import';
        } else if (isInFunction) {
          codeContext = 'function';
        } else if (isInClass) {
          codeContext = 'class';
        }
      }
      
      console.log(`Current code context: ${codeContext}, Line: ${position.lineNumber}, Column: ${position.column}`);
      
      // Build stop sequences based on language
      const stopSequences = ['\n\n'];
      if (language === 'javascript' || language === 'typescript') {
        stopSequences.push(';\n', '}\n');
      } else if (language === 'python') {
        stopSequences.push('\ndef ', '\nclass ');
      } else if (language === 'html') {
        stopSequences.push('>\n', '</');
      }
      
      // Add HTML context if needed
      let htmlContext = '';
      if (language === 'html') {
        // Check if we're inside a tag
        const lastOpenTagMatch = textBeforeCursor.match(/<([a-zA-Z][a-zA-Z0-9]*)[^>]*$/);
        const isInsideTag = lastOpenTagMatch && !textBeforeCursor.endsWith('>')
        
        // Check for unclosed tags to help with proper tag completion
        const openTagsStack = [];
        const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
        let match;
        
        while ((match = tagRegex.exec(textBeforeCursor)) !== null) {
          const fullTag = match[0];
          const tagName = match[1];
          
          if (fullTag.startsWith('</')) {
            // Closing tag
            if (openTagsStack.length > 0 && openTagsStack[openTagsStack.length - 1] === tagName) {
              openTagsStack.pop();
            }
          } else if (!fullTag.endsWith('/>')) {
            // Opening tag (not self-closing)
            openTagsStack.push(tagName);
          }
        }
        
        if (openTagsStack.length > 0 || isInsideTag) {
          htmlContext = `
# HTML Context:
${isInsideTag ? `Currently typing tag: ${lastOpenTagMatch[1]}` : ''}
${openTagsStack.length > 0 ? `Unclosed tags: ${openTagsStack.join(', ')}` : ''}
`;
        }
      }
      
      // Get additional context about the current file and codebase
      let enhancedContextPrompt = '';
      try {
        // 1. Get imports and major declarations from the file
        const importStatements = extractImports(content);
        const declarations = extractDeclarations(content, language);
        
        // 2. Get surrounding code context (10 lines above and below cursor)
        const startLine = Math.max(1, position.lineNumber - 10);
        const endLine = Math.min(model.getLineCount(), position.lineNumber + 10);
        let surroundingContext = '';
        for (let i = startLine; i <= endLine; i++) {
          if (i === position.lineNumber) {
            // Mark the cursor position with [CURSOR] marker
            const lineText = model.getLineContent(i);
            surroundingContext += lineText.substring(0, position.column - 1) + 
                                 "[CURSOR]" + 
                                 lineText.substring(position.column - 1) + "\n";
          } else {
            surroundingContext += model.getLineContent(i) + "\n";
          }
        }
        
        // 3. Get context from related files based on imports
        const currentFilePath = file?.path || '';
        const relatedFilesContext = await getRelatedFilesContext(currentFilePath, content);
        
        // 4. Build the enhanced context prompt with code context information
        enhancedContextPrompt = `
# File: ${file?.name || 'untitled'}
# Language: ${language}
# Current Position: Line ${position.lineNumber}, Column ${position.column}
# Code Context: ${codeContext}
${htmlContext}
${importStatements.length > 0 ? '# Imports:\n' + importStatements.join('\n') : ''}

${declarations.length > 0 ? '# Major Declarations:\n' + declarations.join('\n') : ''}

${relatedFilesContext ? '# Related Files Context:\n' + relatedFilesContext : ''}

# Surrounding Context:
\`\`\`${language}
${surroundingContext}
\`\`\`

I need a completion that continues exactly from the [CURSOR] position. The completion should be VERY SHORT (ideally just a few words or a single line) and must be contextually appropriate for ${codeContext} context.

If I'm in the middle of a function, suggest only function body code, NOT imports or declarations.
If I'm at the top level outside functions, suggest declarations or logical next steps.
If I'm in an import section, suggest only relevant imports.

DO NOT include the [CURSOR] marker in your response. Provide ONLY the completion text without any explanation.
`;
      } catch (error) {
        console.error('Error building enhanced context:', error);
        enhancedContextPrompt = '';
      }
      
      console.log("Sending completion API request to LM Studio");
      
      // Request completion with the enhanced context
      const contextPrompt = `${enhancedContextPrompt}\n\nUser request: ${prompt}`;
      
      try {
        // Use autocompletion model for code completion
        const modelId = await AIFileService.getModelIdForPurpose('autocompletion');
        console.log(`Using model for code completion: ${modelId}`);

        // Get response from LM Studio
        const response = await lmStudio.createChatCompletion({
          model: modelId,
          messages: [
            {
              role: 'system',
              content: 'You are a code completion assistant. Provide ONLY the code changes without any explanation or markdown. The response should be the exact code to insert.'
            },
            {
              role: 'user',
              content: contextPrompt
            }
          ],
          temperature: 0.1, // Lowered from 0.3 for more focused responses
        });

        const aiContent = response.choices[0]?.message?.content;
        if (aiContent) {
          // Clean up the response
          let cleanedResponse = aiContent.trim();
          
          // Strip <think> tags from AI response
          cleanedResponse = stripThinkTags(cleanedResponse);
          
          // Remove markdown code blocks if present (only proper code blocks, not inline code)
          // Each pattern must start and end with exactly three backticks
          cleanedResponse = cleanedResponse.replace(/```[\w-]*\n[\s\S]*?```/g, ''); // Remove proper code blocks
          cleanedResponse = cleanedResponse.replace(/```[\w-]*\s+[\s\S]*?```/g, ''); // Remove code blocks with language on same line
          // Remove any language identifiers
          cleanedResponse = cleanedResponse.replace(/^(javascript|typescript|python|html|css|java|c\+\+|c#|go|rust|php|ruby|swift|kotlin|scala)\s+/i, '');
          
          // Remove any [CURSOR] markers
          cleanedResponse = cleanedResponse.replace('[CURSOR]', '');
          
          // Context-aware filtering based on where we are in the code
          if (codeContext === 'function' && cleanedResponse.includes('import ')) {
            console.log("Filtering out inappropriate import in function context");
            cleanedResponse = '';
          } else if (codeContext !== 'import' && cleanedResponse.trim().startsWith('from ') && cleanedResponse.includes(' import ')) {
            console.log("Filtering out inappropriate import outside import section");
            cleanedResponse = '';
          }
          
          // If cleanedResponse is not empty after cleaning, show it as ghost text
          if (cleanedResponse.trim()) {
            console.log("Showing ghost text suggestion:", cleanedResponse);
            
            // Additional Python-specific filtering
            if (language === 'python') {
              // If we're not in an import section but the suggestion starts with an import,
              // don't show it as ghost text
              if (codeContext !== 'import' && 
                 (cleanedResponse.trim().startsWith('from ') || 
                  cleanedResponse.trim().startsWith('import '))) {
                console.log("Blocking inappropriate import in Python context:", codeContext);
                return;
              }
              
              // If we're inside a function body, make sure we don't suggest non-indented code
              if (codeContext === 'function' && 
                  lineContent.startsWith(' ') && 
                  !cleanedResponse.startsWith(' ') && 
                  cleanedResponse.trim().length > 0) {
                // Add proper indentation to match the current line
                const currentIndent = lineContent.length - lineContent.trimStart().length;
                cleanedResponse = ' '.repeat(currentIndent) + cleanedResponse.trimStart();
              }
            }
            
            showGhostText(cleanedResponse);
          } else {
            console.log("No valid suggestion to show after filtering");
          }
        }
      } catch (error) {
        console.error('Error processing AI request:', error);
      }
    } catch (error) {
      console.error('Error getting code completion:', error);
    }
  };

  // Show ghost text in the editor
  const showGhostText = (text: string) => {
    if (!editor.current || !lastPositionRef.current) return;
    
    // First, remove any existing ghost text
    removeGhostText();
    
    // If the input text is empty or only whitespace, don't show anything
    if (!text || !text.trim()) {
      console.log("Empty text received in showGhostText, not displaying");
      return;
    }
    
    // Clean up the completion text
    const position = lastPositionRef.current;
    const model = editor.current.getModel();
    if (!model) return;
    
    const lineContent = model.getLineContent(position.lineNumber);
    const columnTextBefore = lineContent.substring(0, position.column - 1);
    
    let displayText = text;
    
    // Final check to make sure we're not showing imports at inappropriate places
    const totalLines = model.getLineCount();
    const isTopOfFile = position.lineNumber <= 3; // First 3 lines
    const isMiddleOfFile = position.lineNumber > 3 && position.lineNumber < totalLines - 3;
    
    if (isMiddleOfFile && (displayText.includes('import ') || displayText.includes('from '))) {
      // If it's an import statement in the middle of a file, don't show it
      console.log("Blocking import statement in middle of file");
      return;
    }
    
    // If we're at the beginning of a line, trim any leading whitespace
    if (columnTextBefore.trim() === '') {
      displayText = text.trimStart();
    }
    
    // Check if we're completing inside a word - if so, only suggest the remainder
    const lastWordMatch = columnTextBefore.match(/[\w\d_]+$/);
    if (lastWordMatch && displayText.startsWith(lastWordMatch[0])) {
      displayText = displayText.substring(lastWordMatch[0].length);
    }
    
    // Check if we're typing a function/method and it suggests the same one
    const lastParensMatch = columnTextBefore.match(/\w+\s*\(\s*$/);
    if (lastParensMatch && displayText.includes('(')) {
      const funcName = lastParensMatch[0].trim().replace(/\($/, '');
      if (displayText.startsWith(funcName)) {
        displayText = displayText.substring(displayText.indexOf('('));
      }
    }
    
    // If the completion is empty or only whitespace after processing, don't show it
    if (!displayText || displayText.trim() === '') {
      console.log("Completion became empty after processing, not displaying");
      return;
    }
    
    // Create the ghost text widget with improved styling
    const contentWidget = {
      getId: () => 'ghost-text-widget',
      getDomNode: () => {
        const node = document.createElement('div');
        node.className = 'ghost-text-widget';
        node.style.color = 'rgba(255, 255, 255, 0.5)'; // Semi-transparent white
        node.style.fontStyle = 'italic';
        node.style.display = 'inline-block';
        node.style.pointerEvents = 'none'; // Make it non-interactive
        node.textContent = displayText;
        return node;
      },
      getPosition: () => {
        // Get the current position every time to ensure it's accurate
        const currentPosition = editor.current?.getPosition() || position;
        return {
          position: currentPosition,
          preference: [monaco.editor.ContentWidgetPositionPreference.EXACT]
        };
      }
    };
    
    // Store the widget reference before adding it to the editor
    inlineCompletionWidgetRef.current = contentWidget;
    editor.current.addContentWidget(contentWidget);
    
    // Log success message
    console.log("Ghost text displayed:", displayText);

    // Check if auto-accept is enabled and accept the ghost text
    if (window.editorSettings?.autoAcceptGhostText) {
      acceptGhostText();
    }
  };

  // Remove ghost text from the editor
  const removeGhostText = () => {
    try {
      if (editor.current && inlineCompletionWidgetRef.current) {
        // Get the widget before clearing the reference
        const widget = inlineCompletionWidgetRef.current;
        
        // Clear the reference first to prevent race conditions
        inlineCompletionWidgetRef.current = null;
        
        // Now remove the widget from the editor
        editor.current.removeContentWidget(widget);
      }
    } catch (error) {
      console.error('Error removing ghost text widget:', error);
      // Reset the reference even if there was an error
      inlineCompletionWidgetRef.current = null;
    }
  };

  // Accept the ghost text and insert it into the editor
  const acceptGhostText = () => {
    if (!editor.current || !inlineCompletionWidgetRef.current || !lastPositionRef.current) return;
    
    const widget = inlineCompletionWidgetRef.current;
    const text = widget.getDomNode().textContent;
    
    if (text) {
      const position = lastPositionRef.current;
      editor.current.executeEdits('ghostText', [{
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column
        ),
        text: text,
        forceMoveMarkers: true
      }]);
    }
    
    removeGhostText();
  };

  // Update model when file changes
  useEffect(() => {
    if (editor.current && file) {
      const model = editor.current.getModel();
      if (model && model.getValue() !== contentRef.current) {
        const position = editor.current.getPosition();
        const selections = editor.current.getSelections();
        model.setValue(contentRef.current);
        // Restore cursor position and selections
        if (position) {
          editor.current.setPosition(position);
        }
        if (selections) {
          editor.current.setSelections(selections);
        }
        
        // Reapply the custom theme when file content changes
        if (window.applyCustomTheme) {
          window.applyCustomTheme();
        }
      }
    }
  }, [file?.content]);

  // Complete cleanup only when component is unmounted
  useEffect(() => {
    return () => {
      if (editor.current) {
        const model = editor.current.getModel();
        editor.current.dispose();
        editor.current = null;
        if (model && !model.isDisposed()) {
          model.dispose();
        }
        editorInitializedRef.current = false;
      }
    };
  }, []);

  const handlePromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsLoading(true);
    setShowResponsePreview(false);
    setShowDiff(false);

    // Get the current selection or cursor position
    const selection = editor.current?.getSelection();
    const position = selection?.getStartPosition();
    const model = editor.current?.getModel();
    
    // Get the current file path
    const currentFile = window.getCurrentFile?.();
    if (!currentFile) return;

    // Store original content for diff
    if (model) {
      setOriginalContent(model.getValue());
    }

    // Build enhanced context
    let enhancedContext = `File: ${currentFile.path}`;
    
    if (position && model) {
      enhancedContext += `\nPosition: Line ${position.lineNumber}, Column ${position.column}`;
      
      // Add surrounding code context (5 lines before and after cursor)
      const startLine = Math.max(1, position.lineNumber - 5);
      const endLine = Math.min(model.getLineCount(), position.lineNumber + 5);
      
      let surroundingCode = '\n\nSurrounding code:\n```\n';
      for (let i = startLine; i <= endLine; i++) {
        const lineContent = model.getLineContent(i);
        // Mark the current line
        surroundingCode += `${i === position.lineNumber ? '> ' : '  '}${lineContent}\n`;
      }
      surroundingCode += '```';
      
      enhancedContext += surroundingCode;
      
      // Add information about imports and structure
      try {
        const content = model.getValue();
        const fileExt = currentFile.path.split('.').pop()?.toLowerCase() || '';
        const language = getLanguageFromFileName(currentFile.path);
        
        const importStatements = extractImports(content);
        if (importStatements.length > 0) {
          enhancedContext += '\n\nImports in this file:\n```\n' + importStatements.join('\n') + '\n```';
        }
        
        const declarations = extractDeclarations(content, language);
        if (declarations.length > 0) {
          enhancedContext += '\n\nMajor declarations in this file:\n```\n' + declarations.join('\n') + '\n```';
        }
        
        // Add related files context
        const relatedFilesContext = await getRelatedFilesContext(currentFile.path, content);
        if (relatedFilesContext) {
          enhancedContext += '\n\nContext from related files:\n```\n' + relatedFilesContext + '\n```';
        }
      } catch (error) {
        console.error('Error adding imports/declarations to context:', error);
      }
    }
    
    // Create a context-aware prompt with file structure info
    const contextPrompt = `${enhancedContext}\n\nUser request: ${prompt}\n\nIMPORTANT: Provide ONLY the code changes without any explanation or markdown. The response should be the exact code to insert.`;
    
    try {
      // Use autocompletion model for code completion
      const modelId = await AIFileService.getModelIdForPurpose('autocompletion');
      console.log(`Using model for code completion: ${modelId}`);

      // Get response from LM Studio
      const response = await lmStudio.createChatCompletion({
        model: modelId,
        messages: [
          {
            role: 'system',
            content: 'You are a code completion assistant. Provide ONLY the code changes without any explanation or markdown. The response should be the exact code to insert.'
          },
          {
            role: 'user',
            content: contextPrompt
          }
        ],
        temperature: 0.1, // Lowered from 0.3 for more focused responses
      });

      const aiContent = response.choices[0]?.message?.content;
      if (aiContent) {
        // Clean up the response
        let cleanedResponse = aiContent.trim();
        
        // Strip <think> tags from AI response
        cleanedResponse = stripThinkTags(cleanedResponse);
        
        // Remove markdown code blocks if present (only proper code blocks, not inline code)
        // Each pattern must start and end with exactly three backticks
        cleanedResponse = cleanedResponse.replace(/```[\w-]*\n[\s\S]*?```/g, ''); // Remove proper code blocks
        cleanedResponse = cleanedResponse.replace(/```[\w-]*\s+[\s\S]*?```/g, ''); // Remove code blocks with language on same line
        // Remove any language identifiers
        cleanedResponse = cleanedResponse.replace(/^(javascript|typescript|python|html|css|java|c\+\+|c#|go|rust|php|ruby|swift|kotlin|scala)\s+/i, '');
        
        setAiResponse(cleanedResponse);
        setShowResponsePreview(true);
      }
    } catch (error) {
      console.error('Error processing AI request:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInsertResponse = () => {
    if (!editor.current || !aiResponse) return;
    
    const selection = editor.current.getSelection();
    if (!selection) return;
    
    // Insert the AI response after the current cursor position
    const position = selection.getEndPosition();
    editor.current.executeEdits('', [{
      range: new monaco.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column
      ),
      text: aiResponse
    }]);
    
    // Close the prompt overlay
    setShowPromptInput(false);
    setPrompt('');
    setAiResponse('');
    setShowResponsePreview(false);
    setShowDiff(false);
  };

  // Function to save the current file
  const saveCurrentFile = async () => {
    console.log(`saveCurrentFile called - editor: ${!!editor.current}, contentChanged: ${contentChangedRef.current}, fileId: ${fileId}, file.path: ${file?.path}`);
    
    if (!editor.current || !contentChangedRef.current || !fileId || fileId === 'welcome') {
      console.log(`saveCurrentFile early return - editor: ${!!editor.current}, contentChanged: ${contentChangedRef.current}, fileId: ${fileId}, welcome check: ${fileId === 'welcome'}`);
      return;
    }
    
    setSaveStatus?.('saving');
    
    try {
      const content = editor.current.getValue();
      console.log(`Attempting to save file: ${file?.path}, content length: ${content.length}`);
      
      // Only save if file path is valid and content has changed
      if (file?.path && contentChangedRef.current) {
        console.log(`Auto-saving file: ${file.path}`);
        const result = await FileSystemService.saveFile(fileId, content);
        
        if (result.success) {
          contentChangedRef.current = false;
          setSaveStatus?.('saved');
          console.log(`File auto-saved successfully: ${file.path}`);
          
          // Clear the saved status after 2 seconds
          setTimeout(() => {
            setSaveStatus?.(null);
          }, 2000);
        } else {
          console.error(`Save failed:`, result);
          throw new Error('Save failed');
        }
      } else {
        console.log(`Skipping save - file.path: ${file?.path}, contentChanged: ${contentChangedRef.current}`);
      }
    } catch (error) {
      console.error('Error auto-saving file:', error);
      setSaveStatus?.('error');
      
      // Clear error status after 3 seconds
      setTimeout(() => {
        setSaveStatus?.(null);
      }, 3000);
    }
  };

  // Add function detection after editor initialization
  useEffect(() => {
    if (!editor.current || !editorInitializedRef.current) return;
    
    // Run function detection on content changes
    const model = editor.current.getModel();
    if (!model) return;
    
    const disposable = model.onDidChangeContent(() => {
      if (functionDetectionTimeoutRef.current) {
        clearTimeout(functionDetectionTimeoutRef.current);
      }
      
      // Set up a new timeout to detect functions after content changes
      functionDetectionTimeoutRef.current = setTimeout(() => {
        detectFunctionsAndAddExplainButtons();
      }, 500); // Add some delay to avoid too frequent updates
    });
    
    // Initial function detection
    detectFunctionsAndAddExplainButtons();
    
    // Clean up on unmount
    return () => {
      disposable.dispose();
      removeAllExplainWidgets();
    };
  }, [editor.current, editorInitializedRef.current, file]);

  // Function to detect functions in the code
  const detectFunctionsAndAddExplainButtons = () => {
    if (!editor.current) return;
    
    const model = editor.current.getModel();
    if (!model) return;
    
    // Remove existing explain widgets
    removeAllExplainWidgets();
    
    // Get the content
    const content = model.getValue();
    
    // Detect language based on content patterns rather than just file extension
    let detectedLanguage = file ? getLanguageFromFileName(file.name) : 'javascript';
    
    // Check for language-specific patterns to determine the actual language
    if (content.includes('import React') || content.includes('from "react"') || 
        content.includes("from 'react'") || content.includes('extends Component') ||
        content.includes('<div>') || content.includes('<>')) {
      // Likely JSX/TSX
      if (content.includes(':') && 
          (content.includes('interface ') || content.includes('type ') || 
           content.includes(': string') || content.includes(': number') || 
           content.includes(': boolean') || content.includes(': React.'))) {
        detectedLanguage = 'tsx';
      } else {
        detectedLanguage = 'jsx';
      }
    } else if (content.includes('interface ') || content.includes('type ') || 
               content.includes(': string') || content.includes(': number') || 
               content.includes(': boolean') || content.includes('implements ')) {
      // Likely TypeScript
      detectedLanguage = 'typescript';
    } else if (content.includes('def ') && content.includes(':') && 
               (content.includes('    ') || content.includes('\t')) && 
               (content.includes('import ') || content.includes('class ') || 
                content.includes('self'))) {
      // Likely Python
      detectedLanguage = 'python';
    } else if (content.includes('function ') || content.includes('=>') || 
               content.includes('const ') || content.includes('let ')) {
      // Likely JavaScript
      detectedLanguage = 'javascript';
    }
    
    console.log(`Detected language: ${detectedLanguage} for file: ${file?.name}`);
    
    // Store detected functions
    const detectedFunctions: {
      lineNumber: number,
      name: string,
      code: string,
      range: monaco.Range
    }[] = [];
    
    // Different regex patterns based on detected language
    let functionMatches: RegExpMatchArray | null = null;
    const allLines = content.split('\n');
    
    if (detectedLanguage === 'javascript' || detectedLanguage === 'typescript' || 
        detectedLanguage === 'jsx' || detectedLanguage === 'tsx') {
      // Match JS/TS function declarations, arrow functions, and methods
      const functionRegex = /(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|(?:async\s+)?(\w+)\s*\([^)]*\)\s*{|class\s+(\w+)|(?:(?:public|private|protected)\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*{)/g;
      let match;
      
      while ((match = functionRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        // Get the first non-undefined capture group as the function name
        const name = match[1] || match[2] || match[3] || match[4] || match[5];
        if (!name) continue;
        
        // Find the line number for this match
        const upToMatch = content.substring(0, match.index);
        const lineNumber = upToMatch.split('\n').length;
        
        // Extract the full function code
        let functionCode = "";
        let bracesCount = 0;
        let startIndex = match.index;
        let endIndex = startIndex;
        
        // For function declarations and methods with braces
        if (fullMatch.includes('{')) {
          bracesCount = 1;
          endIndex = match.index + fullMatch.length;
          
          // Find the closing brace
          for (let i = endIndex; i < content.length; i++) {
            if (content[i] === '{') bracesCount++;
            if (content[i] === '}') bracesCount--;
            
            if (bracesCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        } 
        // For arrow functions without braces
        else if (fullMatch.includes('=>')) {
          // Find the end of the statement (semicolon or new line)
          const restOfContent = content.substring(match.index + fullMatch.length);
          const semicolonIndex = restOfContent.indexOf(';');
          const newLineIndex = restOfContent.indexOf('\n');
          
          let statementEndOffset;
          if (semicolonIndex >= 0 && (newLineIndex < 0 || semicolonIndex < newLineIndex)) {
            statementEndOffset = semicolonIndex + 1;
          } else if (newLineIndex >= 0) {
            statementEndOffset = newLineIndex;
          } else {
            statementEndOffset = restOfContent.length;
          }
          
          endIndex = match.index + fullMatch.length + statementEndOffset;
        }
        
        // Extract the function code
        functionCode = content.substring(startIndex, endIndex);
        
        // Create a range for the function
        const range = new monaco.Range(
          lineNumber,
          1,
          lineNumber + functionCode.split('\n').length - 1,
          1
        );
        
        detectedFunctions.push({
          lineNumber,
          name,
          code: functionCode,
          range
        });
      }
      
      // Also detect class methods that weren't caught by the above regex
      const classMethodRegex = /(\w+)\s*\([^)]*\)\s*{/g;
      const classRegex = /class\s+(\w+)/g;
      let classMatch;
      
      while ((classMatch = classRegex.exec(content)) !== null) {
        const className = classMatch[1];
        let classStart = classMatch.index;
        
        // Find the class end (closing brace)
        let bracesCount = 0;
        let classEnd = classStart;
        
        // First, find the opening brace
        for (let i = classStart; i < content.length; i++) {
          if (content[i] === '{') {
            bracesCount = 1;
            classStart = i + 1;
            break;
          }
        }
        
        // Then find the matching closing brace
        for (let i = classStart; i < content.length; i++) {
          if (content[i] === '{') bracesCount++;
          if (content[i] === '}') bracesCount--;
          
          if (bracesCount === 0) {
            classEnd = i;
            break;
          }
        }
        
        // Get the class body
        const classBody = content.substring(classStart, classEnd);
        
        // Find methods in the class body
        let methodMatch;
        while ((methodMatch = classMethodRegex.exec(classBody)) !== null) {
          const methodName = methodMatch[1];
          
          // Skip constructor and methods that aren't valid identifiers
          if (methodName === 'constructor' || !methodName.match(/^\w+$/)) continue;
          
          // Find the line number
          const upToMethod = content.substring(0, classStart + methodMatch.index);
          const lineNumber = upToMethod.split('\n').length;
          
          // Extract method body
          let methodCode = "";
          let methodBracesCount = 1;
          let methodStart = classStart + methodMatch.index;
          let methodEnd = methodStart + methodMatch[0].length;
          
          // Find the closing brace of the method
          for (let i = methodEnd; i < classEnd; i++) {
            if (content[i] === '{') methodBracesCount++;
            if (content[i] === '}') methodBracesCount--;
            
            if (methodBracesCount === 0) {
              methodEnd = i + 1;
              break;
            }
          }
          
          methodCode = content.substring(methodStart, methodEnd);
          
          // Create a range for the method
          const range = new monaco.Range(
            lineNumber,
            1,
            lineNumber + methodCode.split('\n').length - 1,
            1
          );
          
          detectedFunctions.push({
            lineNumber,
            name: methodName,
            code: methodCode,
            range
          });
        }
      }
    } else if (detectedLanguage === 'python') {
      // Match Python function definitions
      const lines = allLines;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^\s*def\s+(\w+)\s*\(/);
        
        if (match && match[1]) {
          const functionName = match[1];
          const lineNumber = i + 1;
          
          // Extract function body by finding all indented lines
          let j = i + 1;
          let functionCode = line + '\n';
          const baseIndentation = line.indexOf('def');
          
          // Continue until we find a line with same or less indentation
          while (j < lines.length) {
            const nextLine = lines[j];
            if (nextLine.trim() === '') {
              functionCode += nextLine + '\n';
              j++;
              continue;
            }
            
            const indentation = nextLine.indexOf(nextLine.trim());
            if (indentation <= baseIndentation && nextLine.trim() !== '') {
              break;
            }
            
            functionCode += nextLine + '\n';
            j++;
          }
          
          const range = new monaco.Range(
            lineNumber,
            1,
            lineNumber + functionCode.split('\n').length - 1,
            1
          );
          
          detectedFunctions.push({
            lineNumber,
            name: functionName,
            code: functionCode,
            range
          });
        }
        
        // Also detect Python class methods
        const classMatch = line.match(/^\s*class\s+(\w+)/);
        if (classMatch && classMatch[1]) {
          const className = classMatch[1];
          const classLineNumber = i + 1;
          const classIndentation = line.indexOf('class');
          
          // Skip to the class body
          let k = i + 1;
          while (k < lines.length) {
            const methodLine = lines[k];
            if (methodLine.trim() === '') {
              k++;
              continue;
            }
            
            const methodIndentation = methodLine.indexOf(methodLine.trim());
            if (methodIndentation <= classIndentation) {
              // We've left the class body
              break;
            }
            
            // Check if this is a method definition
            const methodMatch = methodLine.match(/^\s*def\s+(\w+)\s*\(/);
            if (methodMatch && methodMatch[1]) {
              const methodName = methodMatch[1];
              const methodLineNumber = k + 1;
              
              // Skip __init__ and other dunder methods
              if (methodName.startsWith('__') && methodName.endsWith('__')) {
                k++;
                continue;
              }
              
              // Extract method body
              let m = k + 1;
              let methodCode = methodLine + '\n';
              const methodBaseIndentation = methodIndentation;
              
              // Continue until we find a line with same or less indentation
              while (m < lines.length) {
                const nextLine = lines[m];
                if (nextLine.trim() === '') {
                  methodCode += nextLine + '\n';
                  m++;
                  continue;
                }
                
                const nextIndentation = nextLine.indexOf(nextLine.trim());
                if (nextIndentation <= methodBaseIndentation && nextLine.trim() !== '') {
                  break;
                }
                
                methodCode += nextLine + '\n';
                m++;
              }
              
              const range = new monaco.Range(
                methodLineNumber,
                1,
                methodLineNumber + methodCode.split('\n').length - 1,
                1
              );
              
              detectedFunctions.push({
                lineNumber: methodLineNumber,
                name: methodName,
                code: methodCode,
                range
              });
              
              // Update k to skip the method body we just processed
              k = m - 1;
            }
            
            k++;
          }
        }
      }
    }
    
    // Store the detected functions
    detectedFunctionsRef.current = detectedFunctions;
    
    // Add an "Explain" button next to each function
    for (const func of detectedFunctions) {
      addExplainButton(func.lineNumber, func.name);
    }
  };

  // Remove all explain widgets
  const removeAllExplainWidgets = () => {
    if (!editor.current) return;
    
    // Remove all existing explain widgets
    for (const widget of explainWidgetsRef.current) {
      editor.current.removeContentWidget(widget);
    }
    
    explainWidgetsRef.current = [];
  };

  // Add an "Explain" button widget next to a function declaration
  const addExplainButton = (lineNumber: number, functionName: string) => {
    if (!editor.current) return;
    
    const widget = {
      getId: () => `explain-button-${lineNumber}-${functionName}`,
      getDomNode: () => {
        const node = document.createElement('div');
        node.className = 'explain-function-button';
        node.textContent = 'Explain';
        node.style.fontSize = '11px';
        node.style.padding = '2px 6px';
        node.style.background = 'var(--accent-color)';
        node.style.color = 'var(--bg-primary)';
        node.style.borderRadius = '4px';
        node.style.cursor = 'pointer';
        node.style.opacity = '0.7';
        node.style.transition = 'opacity 0.2s';
        node.style.marginLeft = '8px';
        node.style.display = 'inline-block';
        
        node.onmouseover = () => {
          node.style.opacity = '1';
        };
        
        node.onmouseout = () => {
          node.style.opacity = '0.7';
        };
        
        node.onclick = async () => {
          // Find the function with this line number
          const func = detectedFunctionsRef.current.find(f => 
            f.lineNumber === lineNumber && f.name === functionName);
          
          if (func) {
            await explainFunction(func.name, func.code);
          }
        };
        
        return node;
      },
      getPosition: () => {
        // Position after the function name
        return {
          position: {
            lineNumber: lineNumber,
            column: 1000 // Position at end of line
          },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.EXACT
          ]
        };
      }
    };
    
    editor.current.addContentWidget(widget);
    explainWidgetsRef.current.push(widget);
  };

  // Function to generate and show explanation for a function
  const explainFunction = async (functionName: string, functionCode: string) => {
    if (!file || !file.path) {
      showToast('Cannot explain function: File data incomplete', 'error');
      return;
    }

    try {
      // Show loading dialog immediately
      setFunctionExplanationDialog({
        isOpen: true,
        functionName,
        explanation: '',
        isLoading: true,
        isStreaming: false
      });

      // Show feedback that we're starting the explanation
      showToast(`Explaining function: ${functionName}...`, 'info');
      
      // Find any functions that are called within this function
      const calledFunctions = findCalledFunctions(functionCode);
      
      // Get the full content to find helper functions
      const model = editor.current?.getModel();
      const content = model?.getValue() || '';
      
      // Build helper functions context
      let helperFunctionsContext = '';
      
      if (calledFunctions.length > 0) {
        // Look for the helper function definitions in the file content
        for (const calledFunc of calledFunctions) {
          const helperFunc = detectedFunctionsRef.current.find(f => f.name === calledFunc);
          if (helperFunc) {
            helperFunctionsContext += `\n\n/* Helper function: ${calledFunc} */\n${helperFunc.code}`;
          }
        }
      }
      
      console.log(`Found ${calledFunctions.length} called functions:`, calledFunctions);
      
      // Use a string builder to collect the streaming response
      let streamedExplanation = '';
      
      // Add timeout to ensure streaming state is reset
      const timeoutId = setTimeout(() => {
        console.warn('Function explanation timeout - resetting streaming state');
        setFunctionExplanationDialog(prev => ({
          ...prev,
          isStreaming: false
        }));
        showToast('Function explanation timed out', 'error');
      }, 30000); // 30 second timeout
      
      // Call the function explanation service with streaming
      await AIFileService.getFunctionExplanation(
        file.path,
        functionName,
        functionCode + helperFunctionsContext, // Include any helper functions
        (chunk) => {
          // Update the explanation text with each chunk
          streamedExplanation += chunk;
          setFunctionExplanationDialog(prev => ({
            ...prev,
            explanation: streamedExplanation,
            isLoading: false,
            isStreaming: true
          }));
        }
      );
      
      // Clear timeout since operation completed
      clearTimeout(timeoutId);
      
      // Update with the final result and mark streaming as complete
      setFunctionExplanationDialog(prev => ({
        ...prev,
        isStreaming: false
      }));
      
      showToast(`Explanation ready for ${functionName}`, 'success');
      
    } catch (error) {
      console.error('Error explaining function:', error);
      showToast('Error generating function explanation', 'error');
      
      // Update state to show error in dialog
      setFunctionExplanationDialog(prev => ({
        ...prev,
        explanation: "An error occurred while generating the explanation. Please try again later.",
        isLoading: false,
        isStreaming: false
      }));
    }
  };

  // Helper function to find functions called within a function
  const findCalledFunctions = (functionCode: string): string[] => {
    const calledFunctions: string[] = [];
    
    // Get all detected functions from the current file
    const allFunctionNames = detectedFunctionsRef.current.map(f => f.name);
    
    // Look for each function name in the function code
    for (const funcName of allFunctionNames) {
      // Skip the function itself
      if (functionCode.startsWith(`function ${funcName}`) || 
          functionCode.startsWith(`const ${funcName}`) ||
          functionCode.startsWith(`let ${funcName}`) ||
          functionCode.startsWith(`var ${funcName}`)) {
        continue;
      }
      
      // Simple regex to find function calls: functionName(...)
      // This is a basic approach and may have false positives
      const callRegex = new RegExp(`[^a-zA-Z0-9_]${funcName}\\s*\\(`, 'g');
      
      // Also look for method calls: obj.functionName(...)
      const methodCallRegex = new RegExp(`\\.${funcName}\\s*\\(`, 'g');
      
      // Check if the function is called (and not just declared)
      if (callRegex.test(functionCode) || methodCallRegex.test(functionCode)) {
        calledFunctions.push(funcName);
      }
    }
    
    return calledFunctions;
  };

  // Render based on file type
  if (fileType === 'image' || fileType === 'binary' || fileType === 'pdf' || fileType === 'database') {
    return <FileViewer file={file} fileId={fileId} />;
  }

  // Render the explanation content for the modal
  const renderExplanationContent = () => {
    if (functionExplanationDialog.isLoading) {
      return (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
            <div className="enhanced-pulse" style={{ 
              width: '10px', 
              height: '10px', 
              borderRadius: '50%', 
              background: 'var(--accent-color)',
              marginRight: '8px'
            }}></div>
            <span>Waiting for model...</span>
          </div>
        </div>
      );
    }
    
    if (functionExplanationDialog.isStreaming && functionExplanationDialog.explanation === '') {
      return <span className="blinking-cursor">|</span>;
    }
    
    return (
      <div style={{ 
        fontFamily: 'var(--font-mono)', 
        borderLeft: '3px solid var(--accent-color)',
        paddingLeft: '15px',
        backgroundColor: 'rgba(0, 122, 204, 0.05)'
      }}>
        {functionExplanationDialog.explanation}
        {functionExplanationDialog.isStreaming && <span className="blinking-cursor">|</span>}
      </div>
    );
  };

  // Load auto-save settings from user preferences
  // Auto-save is enabled by default with 1 second delay

  // Update the file type detection
  useEffect(() => {
    if (file?.name) {
      // Determine file type based on extension
      if (isImageFile(file.name)) {
        setFileType('image');
      } else if (isPdfFile(file.name)) {
        setFileType('pdf');
      } else if (isDatabaseFile(file.name)) {
        setFileType('database');
      } else if (isBinaryFile(file.name)) {
        setFileType('binary');
      } else {
        setFileType('text');
      }
    }
  }, [file?.name]);

  // Render the editor with save status indicator
  if (fileType === 'text') {
    return (
      <div style={{ position: 'relative', height: '100%', width: '100%' }}>
        <div ref={editorRef} style={{ height: '100%', width: '100%' }} />
        
        {/* Add the spinner animation styles */}
        <style>
          {`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
        </style>

        {/* AI Prompt Modal */}
        {showPromptInput && (
          <Modal
            isOpen={showPromptInput}
            onClose={() => {
              setShowPromptInput(false);
              setPrompt('');
              setAiResponse('');
              setShowResponsePreview(false);
              setShowDiff(false);
            }}
            title="AI Assistant"
            content={renderExplanationContent()}
          />
        )}
      </div>
    );
  } else {
    // Render FileViewer for non-text files
    return <FileViewer file={file} fileId={fileId} />;
  }
};

interface EditorGridProps {
  openFiles: string[];
  currentFileId: string | null;
  items: Record<string, FileSystemItem>;
  onEditorChange: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  onTabClose: (fileId: string) => void;
  isGridLayout?: boolean;
  onToggleGrid?: () => void;
  setSaveStatus?: (status: 'saving' | 'saved' | 'error' | null) => void;
  // Preview functionality
  previewTabs: TabInfo[];
  currentPreviewTabId?: string | null;
}

interface EditorLayout {
  id: string;
  fileId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const DragHandle: React.FC<{ onMouseDown: (e: React.MouseEvent) => void }> = ({ onMouseDown }) => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '24px',
      background: 'var(--bg-secondary)',
      cursor: 'move',
      zIndex: 10,
      display: 'flex',
      alignItems: 'center',
      padding: '0 8px',
      fontSize: '12px',
      color: 'var(--text-secondary)',
      userSelect: 'none',
    }}
    onMouseDown={onMouseDown}
  >
    ⋮⋮ Drag to move
  </div>
);

const EditorGrid: React.FC<EditorGridProps> = ({ 
  openFiles, 
  currentFileId, 
  items,
  onEditorChange,
  onTabClose,
  isGridLayout = false,
  onToggleGrid,
  setSaveStatus,
  previewTabs,
  currentPreviewTabId,
}) => {
  const [layouts, setLayouts] = useState<EditorLayout[]>([]);
  const [draggingLayout, setDraggingLayout] = useState<EditorLayout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  // Make sure theme is applied when currentFileId changes
  useEffect(() => {
    // Apply custom theme whenever the current file changes if available on window
    if (window.applyCustomTheme && currentFileId) {
      // Small delay to ensure editor is ready
      setTimeout(() => {
        window.applyCustomTheme?.();
      }, 50);
    }
  }, [currentFileId]);

  useEffect(() => {
    // Initialize layout when files change or grid layout changes
    setLayouts(prevLayouts => {
      const newLayouts: EditorLayout[] = [];
      openFiles.forEach((fileId, index) => {
        const existingLayout = prevLayouts.find(l => l.fileId === fileId);
        if (existingLayout && isGridLayout) {
          newLayouts.push(existingLayout);
        } else {
          // Calculate grid position for new files or when switching to grid
          if (isGridLayout) {
            const column = index % 2;
            const row = Math.floor(index / 2);
            newLayouts.push({
              id: `editor-${fileId}`,
              fileId,
              x: column * 50,
              y: row * 50,
              width: 50,
              height: 50,
            });
          } else {
            // Single editor mode - full width and height
            newLayouts.push({
              id: `editor-${fileId}`,
              fileId,
              x: 0,
              y: 0,
              width: 100,
              height: 100,
            });
          }
        }
      });
      return newLayouts;
    });
  }, [openFiles, isGridLayout]);

  const handleDragStart = (layout: EditorLayout, e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingLayout(layout);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current || !dragStartPos.current) return;

      const container = containerRef.current.getBoundingClientRect();
      const deltaX = moveEvent.clientX - dragStartPos.current.x;
      const deltaY = moveEvent.clientY - dragStartPos.current.y;
      
      const newX = ((deltaX / container.width) * 100) + layout.x;
      const newY = ((deltaY / container.height) * 100) + layout.y;

      // Snap to grid
      const snapX = Math.max(0, Math.min(50, Math.round(newX / 50) * 50));
      const snapY = Math.max(0, Math.min(50, Math.round(newY / 50) * 50));

      // Find if there's another layout at the target position
      const targetLayout = layouts.find(l => 
        l.id !== layout.id && 
        l.x === snapX && 
        l.y === snapY
      );

      setLayouts(prevLayouts => {
        if (targetLayout) {
          // Swap positions with the target layout
          return prevLayouts.map(l => {
            if (l.id === layout.id) {
              return { ...l, x: snapX, y: snapY };
            }
            if (l.id === targetLayout.id) {
              return { ...l, x: layout.x, y: layout.y };
            }
            return l;
          });
        } else {
          // Just move the current layout
          return prevLayouts.map(l => 
            l.id === layout.id 
              ? { ...l, x: snapX, y: snapY }
              : l
          );
        }
      });
    };

    const handleMouseUp = () => {
      setDraggingLayout(null);
      dragStartPos.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div 
      ref={containerRef}
      style={{ 
        position: 'relative', 
        width: '100%', 
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Check if we should show a preview instead of editor */}
      {currentPreviewTabId && previewTabs.find(tab => tab.id === currentPreviewTabId) ? (
        <div style={{ height: '100%', width: '100%' }}>
          {(() => {
            const previewTab = previewTabs.find(tab => tab.id === currentPreviewTabId);
            const file = previewTab ? items[previewTab.fileId!] : null;
            
            if (!file) {
              return (
                <div style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)',
                }}>
                  Preview file not found
                </div>
              );
            }
            
            return (
              <PreviewPane 
                file={file} 
                content={file.content}
              />
            );
          })()}
        </div>
      ) : (
        // Show editor layouts
        layouts.map(layout => {
          const isVisible = isGridLayout || layout.fileId === currentFileId;
          const fileExists = !!items[layout.fileId];
          
          // Check if file exists before rendering
          if (!fileExists) {
            console.warn(`Missing file for id: ${layout.fileId}`);
          }
          
          return isVisible ? (
            <div
              key={layout.id}
              style={{
                position: 'absolute',
                left: `${layout.x}%`,
                top: `${layout.y}%`,
                width: `${layout.width}%`,
                height: `${layout.height}%`,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                transition: draggingLayout?.id === layout.id ? 'none' : 'all 0.2s ease',
                display: isVisible ? 'block' : 'none',
              }}
            >
              {isGridLayout && (
                <DragHandle onMouseDown={(e) => handleDragStart(layout, e)} />
              )}
              <div style={{ 
                height: isGridLayout ? 'calc(100% - 24px)' : '100%', 
                marginTop: isGridLayout ? '24px' : '0',
              }}>
                {fileExists ? (
                  <EditorPane
                    fileId={layout.fileId}
                    file={items[layout.fileId]}
                    onEditorReady={onEditorChange}
                    setSaveStatus={setSaveStatus}
                  />
                ) : (
                  <div style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-secondary)',
                    padding: '20px',
                    textAlign: 'center',
                    fontSize: '14px'
                  }}>
                    File not found. The file may have been moved or deleted.
                  </div>
                )}
              </div>
            </div>
          ) : null;
        })
      )}
    </div>
  );
};

export default EditorGrid;