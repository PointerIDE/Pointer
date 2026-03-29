import { logger } from './LoggerService';

/**
 * Input Validator & Sanitization Service
 * Provides centralized validation and sanitization for all user inputs
 * 
 * Improvement 16: Security-focused input validation and XSS prevention
 */

interface ValidationRule {
  type: 'string' | 'number' | 'email' | 'url' | 'path' | 'alphanumeric' | 'custom';
  pattern?: RegExp;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
  customValidator?: (value: any) => boolean;
  message?: string;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitized?: any;
}

export class InputValidator {
  // XSS Prevention patterns
  private static readonly XSS_PATTERNS = {
    scriptTag: /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    eventHandler: /on\w+\s*=\s*["'][^"']*["']/gi,
    dangerouskeywords: /javascript:|data:|vbscript:/gi,
    htmlTags: /<[^>]*>/g
  };

  private static readonly PATH_SANITIZATION = {
    traversal: /\.\.\//g,
    invalid: /[<>:"|?*]/g,
    nullByte: /\0/g
  };

  private static readonly RULES: Record<string, ValidationRule> = {
    // Common validators
    filePath: {
      type: 'path',
      required: true,
      message: 'Invalid file path'
    },
    folderPath: {
      type: 'path',
      required: true,
      message: 'Invalid folder path'
    },
    fileName: {
      type: 'string',
      pattern: /^[a-zA-Z0-9._-]+$/,
      minLength: 1,
      maxLength: 255,
      required: true,
      message: 'Invalid file name (use alphanumeric, dots, hyphens, underscores only)'
    },
    email: {
      type: 'email',
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      required: true,
      message: 'Invalid email address'
    },
    url: {
      type: 'url',
      required: true,
      message: 'Invalid URL'
    },
    gitUrl: {
      type: 'custom',
      customValidator: (value: string) => {
        return /^https?:\/\/github\.com\/[\w-]+\/[\w.-]+(?:\.git)?$/.test(value);
      },
      message: 'Invalid GitHub repository URL'
    },
    variable: {
      type: 'alphanumeric',
      pattern: /^[a-zA-Z_$][a-zA-Z0-9_$]*$/,
      required: true,
      message: 'Invalid variable name'
    },
    portNumber: {
      type: 'number',
      customValidator: (value: number) => value >= 1 && value <= 65535,
      message: 'Port must be between 1 and 65535'
    }
  };

  /**
   * Validate input against a rule
   */
  static validate(value: any, rule: ValidationRule | string): ValidationResult {
    const actualRule = typeof rule === 'string' ? this.RULES[rule] : rule;
    
    if (!actualRule) {
      logger.warn('Validation rule not found', { rule });
      return { isValid: true, errors: [] };
    }

    const errors: string[] = [];
    let sanitized = value;

    // Check required
    if (actualRule.required && (value === null || value === undefined || value === '')) {
      errors.push(actualRule.message || 'This field is required');
      return { isValid: false, errors };
    }

    // Type-specific validation
    switch (actualRule.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push('Value must be a string');
          break;
        }
        sanitized = this.sanitizeString(value);
        break;

      case 'number':
        if (typeof value !== 'number') {
          errors.push('Value must be a number');
          break;
        }
        break;

      case 'email':
        if (!actualRule.pattern?.test(value)) {
          errors.push(actualRule.message || 'Invalid email format');
        }
        break;

      case 'url':
        try {
          new URL(value);
        } catch {
          errors.push(actualRule.message || 'Invalid URL format');
        }
        break;

      case 'path':
        sanitized = this.sanitizePath(value);
        break;

      case 'alphanumeric':
        if (!/^[a-zA-Z0-9_-]*$/.test(value)) {
          errors.push(actualRule.message || 'Only alphanumeric characters, hyphens, and underscores allowed');
        }
        break;

      case 'custom':
        if (actualRule.customValidator && !actualRule.customValidator(value)) {
          errors.push(actualRule.message || 'Validation failed');
        }
        break;
    }

    // Length validation
    if (typeof sanitized === 'string') {
      if (actualRule.minLength && sanitized.length < actualRule.minLength) {
        errors.push(`Minimum length is ${actualRule.minLength} characters`);
      }
      if (actualRule.maxLength && sanitized.length > actualRule.maxLength) {
        errors.push(`Maximum length is ${actualRule.maxLength} characters`);
      }
    }

    // Pattern validation
    if (actualRule.pattern && !actualRule.pattern.test(sanitized)) {
      errors.push(actualRule.message || 'Invalid format');
    }

    logger.debug('Validation result', { value, rule: actualRule, isValid: errors.length === 0 });

    return {
      isValid: errors.length === 0,
      errors,
      sanitized
    };
  }

  /**
   * Sanitize string to prevent XSS
   */
  static sanitizeString(value: string): string {
    if (typeof value !== 'string') return value;

    let sanitized = value;

    // Remove script tags
    sanitized = sanitized.replace(this.XSS_PATTERNS.scriptTag, '');

    // Remove event handlers
    sanitized = sanitized.replace(this.XSS_PATTERNS.eventHandler, '');

    // Remove dangerous protocols
    sanitized = sanitized.replace(this.XSS_PATTERNS.dangerouskeywords, '');

    logger.debug('String sanitized', { original: value, sanitized });
    return sanitized;
  }

  /**
   * Sanitize file paths
   */
  static sanitizePath(path: string): string {
    if (typeof path !== 'string') return path;

    let sanitized = path;

    // Remove directory traversal attempts
    sanitized = sanitized.replace(this.PATH_SANITIZATION.traversal, '/');

    // Remove invalid characters
    sanitized = sanitized.replace(this.PATH_SANITIZATION.invalid, '_');

    // Remove null bytes
    sanitized = sanitized.replace(this.PATH_SANITIZATION.nullByte, '');

    // Normalize separators
    sanitized = sanitized.replace(/\\/g, '/');
    sanitized = sanitized.replace(/\/+/g, '/');

    logger.debug('Path sanitized', { original: path, sanitized });
    return sanitized;
  }

  /**
   * Validate multiple inputs at once
   */
  static validateBatch(inputs: Record<string, { value: any; rule: ValidationRule | string }>): ValidationResult {
    const allErrors: string[] = [];
    const sanitized: Record<string, any> = {};
    let isValid = true;

    for (const [key, { value, rule }] of Object.entries(inputs)) {
      const result = this.validate(value, rule);
      if (!result.isValid) {
        isValid = false;
        allErrors.push(`${key}: ${result.errors.join(', ')}`);
      }
      if (result.sanitized !== undefined) {
        sanitized[key] = result.sanitized;
      }
    }

    return { isValid, errors: allErrors, sanitized };
  }

  /**
   * Register custom validation rule
   */
  static registerRule(name: string, rule: ValidationRule): void {
    this.RULES[name] = rule;
    logger.debug('Custom validation rule registered', { name });
  }

  /**
   * Get all registered rules
   */
  static getRules(): Record<string, ValidationRule> {
    return { ...this.RULES };
  }
}

export default InputValidator;
