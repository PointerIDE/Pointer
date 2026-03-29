import { logger } from './LoggerService';
import InputValidator from './InputValidator';

/**
 * Comprehensive Keyboard Shortcuts Registry
 * Central management of all keyboard shortcuts with conflict detection
 * 
 * Improvement 19 (Enhanced): Advanced keyboard shortcuts system (sehr umfassend/very comprehensive)
 * - VS Code-compatible keybinding format
 * - Conflict detection and resolution
 * - Macro recording and playback
 * - Keyboard layout detection
 * - Usage analytics
 * - Visual cheat sheet generation
 * - Command palette with fuzzy search
 * - Context-aware shortcuts
 */

export interface Keybinding {
  key: string;
  command: string;
  when?: string;
  mac?: string;
  linux?: string;
  win?: string;
  description?: string;
  category?: string;
  priority?: number; // For conflict resolution (higher = more important)
}

export interface KeybindingProfile {
  name: string;
  description?: string;
  bindings: Keybinding[];
  isDefault?: boolean;
  created: number;
  modified: number;
}

export interface KeybindingConflict {
  keys: string[];
  commands: string[];
  severity: 'warning' | 'error';
}

export interface MacroRecord {
  id: string;
  name: string;
  keys: string[];
  commands: string[];
  created: number;
  usageCount: number;
}

export interface MacroPlaybackOptions {
  speed?: 'slow' | 'normal' | 'fast';
  repeatCount?: number;
}

export interface ShortcutAnalytics {
  command: string;
  usageCount: number;
  lastUsed: number;
  averageResponseTime: number;
  category?: string;
}

interface ParsedKeybinding {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
  isSequence: boolean;
}

export class KeyboardShortcutsRegistry {
  private static bindings = new Map<string, Keybinding>();
  private static profiles = new Map<string, KeybindingProfile>();
  private static currentProfile = 'default';
  private static commands = new Map<string, { callback: Function; description: string }>();
  private static keyListeners = new Map<string, Set<string>>();
  private static contextStack: Set<string> = new Set();
  private static conflicts: KeybindingConflict[] = [];
  private static sequenceBuffer = '';
  private static sequenceTimeout: NodeJS.Timeout | null = null;
  
  // New features for enhancements
  private static macros = new Map<string, MacroRecord>();
  private static isRecordingMacro = false;
  private static currentMacroBuffer: { keys: string[]; commands: string[] } | null = null;
  private static analytics = new Map<string, ShortcutAnalytics>();
  private static keyboardLayout = 'QWERTY';
  private static commandPaletteQuery = '';
  private static lastCommandExecutionTime = 0;

  /**
   * Initialize keyboard shortcuts
   */
  static initialize(): void {
    this.registerDefaultBindings();
    this.loadProfiles();
    this.setupKeyListener();
    logger.info('Keyboard Shortcuts Registry initialized with default bindings');
  }

  /**
   * Register a command with keybinding
   */
  static registerCommand(
    commandId: string,
    keybinding: string,
    callback: Function,
    description: string = '',
    options: { mac?: string; linux?: string; win?: string; when?: string } = {}
  ): void {
    // Validate command ID
    const validation = InputValidator.validate(commandId, {
      type: 'alphanumeric',
      minLength: 1,
      maxLength: 100,
      required: true,
      message: 'Invalid command ID'
    });

    if (!validation.isValid) {
      logger.error('Invalid command ID', { commandId, errors: validation.errors });
      return;
    }

    // Register command
    this.commands.set(commandId, { callback, description });

    // Register keybinding
    const binding: Keybinding = {
      key: keybinding,
      command: commandId,
      when: options.when,
      mac: options.mac,
      linux: options.linux,
      win: options.win,
    };

    this.registerKeybinding(binding);
    logger.debug('Command registered', { commandId, keybinding, description });
  }

  /**
   * Register a single keybinding
   */
  static registerKeybinding(binding: Keybinding, profile: string = 'default'): void {
    const conflictingCommand = this.checkConflict(binding.key, binding.command);
    
    if (conflictingCommand && conflictingCommand !== binding.command) {
      logger.warn('Keybinding conflict detected', {
        key: binding.key,
        newCommand: binding.command,
        existingCommand: conflictingCommand
      });
      
      this.conflicts.push({
        keys: [binding.key],
        commands: [conflictingCommand, binding.command],
        severity: 'warning'
      });
    }

    this.bindings.set(`${profile}:${binding.key}`, binding);
    
    // Track key listeners
    const parsedKey = this.parseKeybinding(binding.key);
    const keyString = this.keybindingToString(parsedKey);
    
    if (!this.keyListeners.has(keyString)) {
      this.keyListeners.set(keyString, new Set());
    }
    this.keyListeners.get(keyString)?.add(binding.command);

    logger.debug('Keybinding registered', {
      key: binding.key,
      command: binding.command,
      profile
    });
  }

  /**
   * Unregister a keybinding
   */
  static unregisterKeybinding(key: string, profile: string = 'default'): boolean {
    const removed = this.bindings.delete(`${profile}:${key}`);
    if (removed) {
      logger.debug('Keybinding unregistered', { key, profile });
    }
    return removed;
  }

  /**
   * Set keyboard context (for conditional bindings)
   */
  static setContext(context: string, active: boolean = true): void {
    if (active) {
      this.contextStack.add(context);
    } else {
      this.contextStack.delete(context);
    }
    logger.debug('Context updated', { context, active, activeContexts: Array.from(this.contextStack) });
  }

  /**
   * Check if context is active
   */
  static isContextActive(context: string): boolean {
    return this.contextStack.has(context);
  }

  /**
   * Execute command by ID
   */
  static executeCommand(commandId: string, args?: any): any {
    const command = this.commands.get(commandId);
    if (!command) {
      logger.warn('Command not found', { commandId });
      return null;
    }

    try {
      const startTime = performance.now();
      logger.debug('Executing command', { commandId, args });
      
      const result = command.callback(args);
      
      // Record analytics and track in macro if recording
      const executionTime = performance.now() - startTime;
      this.recordCommandExecution(commandId, executionTime);
      
      if (this.isRecordingMacro && this.currentMacroBuffer) {
        this.currentMacroBuffer.commands.push(commandId);
      }
      
      return result;
    } catch (error) {
      logger.error('Command execution failed', error, { commandId });
      return null;
    }
  }

  /**
   * Trigger key event (called by DOM listener)
   */
  static triggerKeyEvent(event: KeyboardEvent): void {
    const keybinding = this.parseKeybinding(this.keyEventToString(event));
    const keyString = this.keybindingToString(keybinding);

    // Handle key sequences
    if (this.sequenceBuffer) {
      this.sequenceBuffer += ' ' + keyString;
    } else {
      this.sequenceBuffer = keyString;
    }

    // Clear previous sequence timeout
    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout);
    }

    // Set new sequence timeout
    this.sequenceTimeout = setTimeout(() => {
      this.sequenceBuffer = '';
    }, 2000);

    // Try to find matching binding
    const matchedCommands = this.findMatchingBindings(this.sequenceBuffer);
    
    if (matchedCommands.length > 0) {
      logger.debug('Keybinding matched', { keys: this.sequenceBuffer, commands: matchedCommands });
      
      // Execute first matching command that meets context requirements
      for (const commandId of matchedCommands) {
        this.executeCommand(commandId);
        event.preventDefault();
        this.sequenceBuffer = '';
        if (this.sequenceTimeout) clearTimeout(this.sequenceTimeout);
        break;
      }
    }
  }

  /**
   * Find matching bindings for key sequence
   */
  private static findMatchingBindings(keySequence: string, profile: string = this.currentProfile): string[] {
    const bindings = Array.from(this.bindings.entries())
      .filter(([key]) => key.startsWith(`${profile}:`))
      .map(([_, binding]) => binding);

    const matched: string[] = [];

    for (const binding of bindings) {
      if (binding.key === keySequence || this.getNativeKeybinding(binding) === keySequence) {
        // Check context condition
        if (binding.when && !this.evaluateContext(binding.when)) {
          continue;
        }
        matched.push(binding.command);
      }
    }

    return matched;
  }

  /**
   * Get native keybinding for current OS
   */
  private static getNativeKeybinding(binding: Keybinding): string {
    const platform = this.getPlatform();
    
    if (platform === 'darwin' && binding.mac) return binding.mac;
    if (platform === 'linux' && binding.linux) return binding.linux;
    if (platform === 'win32' && binding.win) return binding.win;
    
    return binding.key;
  }

  /**
   * Parse keybinding string to components
   */
  private static parseKeybinding(keybinding: string): ParsedKeybinding {
    const parts = keybinding.toLowerCase().split('+');
    const result: ParsedKeybinding = {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
      key: '',
      isSequence: keybinding.includes(' ') && keybinding.split(' ').length > 1
    };

    for (const part of parts) {
      switch (part.trim()) {
        case 'ctrl':
        case 'control':
          result.ctrl = true;
          break;
        case 'shift':
          result.shift = true;
          break;
        case 'alt':
        case 'option':
          result.alt = true;
          break;
        case 'cmd':
        case 'meta':
        case 'command':
          result.meta = true;
          break;
        default:
          result.key = part.trim();
      }
    }

    return result;
  }

  /**
   * Convert parsed keybinding to string
   */
  private static keybindingToString(parsed: ParsedKeybinding): string {
    const parts: string[] = [];
    
    if (parsed.ctrl) parts.push('ctrl');
    if (parsed.shift) parts.push('shift');
    if (parsed.alt) parts.push('alt');
    if (parsed.meta) parts.push('meta');
    if (parsed.key) parts.push(parsed.key);

    return parts.join('+').toLowerCase();
  }

  /**
   * Convert KeyboardEvent to keybinding string
   */
  private static keyEventToString(event: KeyboardEvent): string {
    const parts: string[] = [];
    
    if (event.ctrlKey || event.metaKey) {
      parts.push(event.metaKey && this.getPlatform() === 'darwin' ? 'cmd' : 'ctrl');
    }
    if (event.shiftKey) parts.push('shift');
    if (event.altKey) parts.push('alt');
    
    const key = event.key.toLowerCase();
    if (key !== 'control' && key !== 'shift' && key !== 'alt' && key !== 'meta') {
      parts.push(key === ' ' ? 'space' : key);
    }

    return parts.join('+');
  }

  /**
   * Check for conflicts
   */
  private static checkConflict(key: string, commandId: string): string | null {
    for (const [_, binding] of this.bindings) {
      if (binding.key === key && binding.command !== commandId) {
        return binding.command;
      }
    }
    return null;
  }

  /**
   * Get all bindings
   */
  static getAllBindings(profile: string = this.currentProfile): Keybinding[] {
    return Array.from(this.bindings.values()).filter(
      binding => !binding.command.startsWith(`${profile}:`)
    );
  }

  /**
   * Get specific binding
   */
  static getBinding(key: string, profile: string = this.currentProfile): Keybinding | null {
    return this.bindings.get(`${profile}:${key}`) || null;
  }

  /**
   * Create keybinding profile
   */
  static createProfile(name: string, description?: string, baseProfile?: string): KeybindingProfile {
    const profile: KeybindingProfile = {
      name,
      description,
      bindings: baseProfile ? [...this.profiles.get(baseProfile)?.bindings || []] : [],
      created: Date.now(),
      modified: Date.now()
    };

    this.profiles.set(name, profile);
    logger.debug('Keybinding profile created', { name, description });
    return profile;
  }

  /**
   * Get profile
   */
  static getProfile(name: string): KeybindingProfile | null {
    return this.profiles.get(name) || null;
  }

  /**
   * Switch to profile
   */
  static switchProfile(name: string): boolean {
    if (!this.profiles.has(name)) {
      logger.warn('Profile not found', { name });
      return false;
    }

    this.currentProfile = name;
    logger.info('Keybinding profile switched', { profile: name });
    return true;
  }

  /**
   * List all profiles
   */
  static listProfiles(): string[] {
    return Array.from(this.profiles.keys());
  }

  /**
   * Export profile as JSON
   */
  static exportProfile(name: string): Record<string, any> | null {
    const profile = this.profiles.get(name);
    if (!profile) return null;

    return {
      name: profile.name,
      description: profile.description,
      bindings: profile.bindings.map(b => ({
        key: b.key,
        command: b.command,
        when: b.when,
        mac: b.mac,
        linux: b.linux,
        win: b.win
      }))
    };
  }

  /**
   * Import profile from JSON
   */
  static importProfile(profileData: Record<string, any>): boolean {
    try {
      const profile = this.createProfile(profileData.name, profileData.description);
      profile.bindings = profileData.bindings || [];
      this.profiles.set(profileData.name, profile);
      logger.info('Profile imported', { name: profileData.name });
      return true;
    } catch (error) {
      logger.error('Profile import failed', error);
      return false;
    }
  }

  /**
   * Get conflicts
   */
  static getConflicts(): KeybindingConflict[] {
    return [...this.conflicts];
  }

  /**
   * Resolve conflict by removing one binding
   */
  static resolveConflict(key: string, keepCommand: string): boolean {
    const binding = this.getBinding(key);
    if (!binding) return false;

    if (binding.command !== keepCommand) {
      this.unregisterKeybinding(key);
      this.conflicts = this.conflicts.filter(c => !c.keys.includes(key));
      logger.info('Conflict resolved', { key, keepCommand });
      return true;
    }

    return false;
  }

  /**
   * Get help/documentation
   */
  static getHelp(): Record<string, any> {
    const commands = Array.from(this.commands.entries()).map(([id, cmd]) => ({
      id,
      description: cmd.description,
      bindings: this.getAllBindings().filter(b => b.command === id)
    }));

    return {
      currentProfile: this.currentProfile,
      totalCommands: this.commands.size,
      totalBindings: this.bindings.size,
      availableProfiles: this.listProfiles(),
      platformInfo: {
        platform: this.getPlatform(),
        ctrlKey: this.getPlatform() === 'darwin' ? 'cmd' : 'ctrl'
      },
      commands
    };
  }

  // ==================== MACRO Recording & Playback ====================

  /**
   * Start recording keyboard macro
   */
  static startMacroRecording(macroName: string): void {
    this.isRecordingMacro = true;
    this.currentMacroBuffer = { keys: [], commands: [] };
    logger.info('Macro recording started', { name: macroName });
  }

  /**
   * Stop recording and save macro
   */
  static stopMacroRecording(macroName: string): MacroRecord | null {
    if (!this.isRecordingMacro || !this.currentMacroBuffer) {
      logger.warn('No macro recording in progress');
      return null;
    }

    const macro: MacroRecord = {
      id: `macro_${Date.now()}`,
      name: macroName,
      keys: this.currentMacroBuffer.keys,
      commands: this.currentMacroBuffer.commands,
      created: Date.now(),
      usageCount: 0
    };

    this.macros.set(macro.id, macro);
    this.isRecordingMacro = false;
    this.currentMacroBuffer = null;

    logger.info('Macro recorded', { macroName, commandCount: macro.commands.length });
    return macro;
  }

  /**
   * Play back recorded macro
   */
  static playMacro(macroId: string, options: MacroPlaybackOptions = {}): boolean {
    const macro = this.macros.get(macroId);
    if (!macro) {
      logger.warn('Macro not found', { macroId });
      return false;
    }

    const repeatCount = options.repeatCount || 1;
    const speedMultiplier = options.speed === 'slow' ? 1.5 : options.speed === 'fast' ? 0.5 : 1;

    for (let i = 0; i < repeatCount; i++) {
      for (const command of macro.commands) {
        this.executeCommand(command);
      }
    }

    macro.usageCount++;
    logger.info('Macro played', { macroId: macro.name, repeatCount });
    return true;
  }

  /**
   * List all recorded macros
   */
  static listMacros(): MacroRecord[] {
    return Array.from(this.macros.values());
  }

  /**
   * Delete macro
   */
  static deleteMacro(macroId: string): boolean {
    const removed = this.macros.delete(macroId);
    if (removed) {
      logger.debug('Macro deleted', { macroId });
    }
    return removed;
  }

  // ==================== ANALYTICS & USAGE TRACKING ====================

  /**
   * Record command execution for analytics
   */
  static recordCommandExecution(commandId: string, executionTime: number): void {
    let stats = this.analytics.get(commandId);
    if (!stats) {
      stats = {
        command: commandId,
        usageCount: 0,
        lastUsed: 0,
        averageResponseTime: 0,
      };
    }

    stats.usageCount++;
    stats.lastUsed = Date.now();
    stats.averageResponseTime =
      (stats.averageResponseTime * (stats.usageCount - 1) + executionTime) / stats.usageCount;

    this.analytics.set(commandId, stats);
  }

  /**
   * Get usage analytics
   */
  static getAnalytics(): ShortcutAnalytics[] {
    return Array.from(this.analytics.values()).sort((a, b) => b.usageCount - a.usageCount);
  }

  /**
   * Get most used commands
   */
  static getMostUsedCommands(limit: number = 10): ShortcutAnalytics[] {
    return this.getAnalytics().slice(0, limit);
  }

  /**
   * Clear analytics
   */
  static clearAnalytics(): void {
    this.analytics.clear();
    logger.debug('Analytics cleared');
  }

  // ==================== FUZZY SEARCH & COMMAND PALETTE ====================

  /**
   * Search commands with fuzzy matching
   */
  static searchCommands(query: string): Array<{ id: string; description: string; score: number }> {
    const results: Array<{ id: string; description: string; score: number }> = [];

    for (const [id, cmd] of this.commands) {
      const score = this.fuzzyScore(query, id) + this.fuzzyScore(query, cmd.description);

      if (score > 0) {
        results.push({
          id,
          description: cmd.description,
          score
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Fuzzy scoring algorithm
   */
  private static fuzzyScore(query: string, target: string): number {
    const q = query.toLowerCase();
    const t = target.toLowerCase();

    if (q === t) return 100;
    if (t.includes(q)) return 50;

    let score = 0;
    let tIndex = 0;

    for (let i = 0; i < q.length; i++) {
      const char = q[i];
      tIndex = t.indexOf(char, tIndex);

      if (tIndex === -1) return 0;

      score += 10;
      tIndex++;
    }

    return score;
  }

  // ==================== KEYBOARD LAYOUT DETECTION ====================

  /**
   * Detect keyboard layout
   */
  static detectKeyboardLayout(): string {
    // Simple detection based on browser/OS
    const lang = (navigator as any).language || 'en-US';

    if (lang.includes('fr')) return 'AZERTY';
    if (lang.includes('de')) return 'QWERTZ';
    if (lang.includes('ru')) return 'ЙЦУКЕН';

    return 'QWERTY';
  }

  /**
   * Get keyboard layout
   */
  static getKeyboardLayout(): string {
    return this.keyboardLayout;
  }

  /**
   * Set keyboard layout
   */
  static setKeyboardLayout(layout: string): void {
    this.keyboardLayout = layout;
    logger.info('Keyboard layout set', { layout });
  }

  /**
   * Get layout-optimized bindings
   */
  static getOptimizedBindingsForLayout(): Keybinding[] {
    // Return bindings optimized for current layout
    return this.getAllBindings().map(binding => ({
      ...binding,
      key: this.optimizeKeyForLayout(binding.key)
    }));
  }

  private static optimizeKeyForLayout(key: string): string {
    // Could implement layout-specific optimizations here
    return key;
  }

  // ==================== VISUAL CHEAT SHEET ====================

  /**
   * Generate markdown cheat sheet
   */
  static generateMarkdownCheatSheet(): string {
    const commands = this.getAllBindings();
    const grouped: Record<string, Keybinding[]> = {};

    for (const binding of commands) {
      const category = binding.category || 'Other';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(binding);
    }

    let markdown = '# Keyboard Shortcuts Cheat Sheet\n\n';

    for (const [category, bindings] of Object.entries(grouped)) {
      markdown += `## ${category}\n\n`;
      markdown += '| Command | Shortcut |\n';
      markdown += '|---------|----------|\n';

      for (const binding of bindings) {
        const key = this.getPlatform() === 'darwin' && binding.mac ? binding.mac : binding.key;
        markdown += `| ${binding.description || binding.command} | \`${key}\` |\n`;
      }

      markdown += '\n';
    }

    return markdown;
  }

  /**
   * Generate HTML cheat sheet
   */
  static generateHtmlCheatSheet(): string {
    const markdown = this.generateMarkdownCheatSheet();
    // Simple HTML conversion (in production, use marked or similar)
    return `<pre>${markdown}</pre>`;
  }

  /**
   * Export bindings as JSON with comments
   */
  static exportAsJson(): string {
    const bindings: Record<string, Keybinding> = {};

    for (const binding of this.getAllBindings()) {
      bindings[binding.command] = binding;
    }

    return JSON.stringify(bindings, null, 2);
  }

  // ==================== CONTEXT MODES ====================

  /**
   * Set multiple contexts at once
   */
  static setContextMode(mode: string, contexts: string[]): void {
    this.contextStack.clear();
    contexts.forEach(ctx => this.contextStack.add(ctx));
    logger.debug('Context mode set', { mode, contexts });
  }

  /**
   * Get current active contexts
   */
  static getActiveContexts(): string[] {
    return Array.from(this.contextStack);
  }

  /**
   * Define context mode templates
   */
  static defineContextMode(
    modeName: string,
    contexts: string[],
    description?: string
  ): void {
    // Could be stored and reused
    logger.debug('Context mode defined', { modeName, contexts, description });
  }

  // ==================== ADAPTIVE SHORTCUTS ====================

  /**
   * Suggest shortcuts based on frequent commands
   */
  static suggestShortcuts(): Array<{ command: string; suggested: string; reason: string }> {
    const suggestions: Array<{ command: string; suggested: string; reason: string }> = [];
    const topCommands = this.getMostUsedCommands(5);

    for (const cmd of topCommands) {
      const hasBinding = this.getAllBindings().some(b => b.command === cmd.command);
      if (!hasBinding) {
        suggestions.push({
          command: cmd.command,
          suggested: `ctrl+${cmd.command.charAt(0).toLowerCase()}`,
          reason: `Frequently used (${cmd.usageCount} times)`
        });
      }
    }

    return suggestions;
  }

  /**
   * Get platform-specific help
   */
  static getPlatformSpecificHelp(): Record<string, any> {
    const platform = this.getPlatform();
    const modifierKey = platform === 'darwin' ? '⌘' : 'Ctrl';

    return {
      platform,
      modifierKey,
      commonPatterns: [
        `${modifierKey}+S: Save`,
        `${modifierKey}+Z: Undo`,
        `${modifierKey}+Shift+Z: Redo`,
        `${modifierKey}+F: Find`,
        `${modifierKey}+H: Replace`,
        `${modifierKey}+P: Quick Open`,
        `${modifierKey}+Shift+P: Command Palette`,
        `${modifierKey}+B: Toggle Sidebar`
      ]
    };
  }

  // ==================== Helper Methods ====================

  private static getPlatform(): string {
    if (typeof window === 'undefined') return 'unknown';
    return process.platform;
  }

  private static evaluateContext(condition: string): boolean {
    // Simple context evaluation (can be extended)
    return this.contextStack.has(condition) || condition === '';
  }

  private static registerDefaultBindings(): void {
    // File operations
    this.registerCommand('editor.action.quickOpen', 'ctrl+p', () => {}, 'Quick Open File', {
      mac: 'cmd+p'
    });

    this.registerCommand('editor.action.commandPalette', 'ctrl+shift+p', () => {}, 'Command Palette', {
      mac: 'cmd+shift+p'
    });

    // Edit operations
    this.registerCommand('editor.action.selectAll', 'ctrl+a', () => {}, 'Select All', {
      mac: 'cmd+a'
    });

    this.registerCommand('editor.action.undo', 'ctrl+z', () => {}, 'Undo', {
      mac: 'cmd+z'
    });

    this.registerCommand('editor.action.redo', 'ctrl+shift+z', () => {}, 'Redo', {
      mac: 'cmd+shift+z'
    });

    this.registerCommand('editor.action.find', 'ctrl+f', () => {}, 'Find', {
      mac: 'cmd+f'
    });

    this.registerCommand('editor.action.replace', 'ctrl+h', () => {}, 'Replace', {
      mac: 'cmd+h'
    });

    // View operations
    this.registerCommand('view.toggleTerminal', 'ctrl+grave', () => {}, 'Toggle Terminal', {
      mac: 'cmd+grave'
    });

    this.registerCommand('view.toggleSidebar', 'ctrl+b', () => {}, 'Toggle Sidebar', {
      mac: 'cmd+b'
    });

    logger.debug('Default keybindings registered');
  }

  private static loadProfiles(): void {
    const defaultProfile = this.createProfile('default', 'Default keybindings');
    defaultProfile.isDefault = true;
    this.profiles.set('default', defaultProfile);
  }

  private static setupKeyListener(): void {
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', (event: KeyboardEvent) => {
        this.triggerKeyEvent(event);
      });
      logger.debug('Global key listener installed');
    }
  }
}

export default KeyboardShortcutsRegistry;
