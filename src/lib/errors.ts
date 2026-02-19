/**
 * Vaulter Error Hierarchy
 *
 * Provides typed error classes for better error handling in CLI, MCP, and programmatic usage.
 *
 * Hierarchy:
 *   VaulterError (base)
 *   ├── ConfigError (configuration issues)
 *   │   ├── ConfigNotFoundError
 *   │   ├── InvalidConfigError
 *   │   └── CircularExtendsError
 *   ├── BackendError (backend connectivity/operations)
 *   │   ├── ConnectionError
 *   │   └── NotInitializedError
 *   ├── EncryptionError (encryption/decryption issues)
 *   │   ├── KeyNotFoundError
 *   │   └── DecryptionError
 *   ├── ValidationError (input validation)
 *   │   ├── InvalidEnvironmentError
 *   │   └── InvalidKeyNameError
 *   └── OperationError (operational failures)
 *       ├── FileNotFoundError
 *       ├── VariableNotFoundError
 *       └── SyncConflictError
 */

/**
 * Base error class for all Vaulter errors
 */
export class VaulterError extends Error {
  /** Error code for programmatic handling */
  readonly code: string

  /** Suggestion for how to fix the error */
  readonly suggestion?: string

  /** Additional context/data about the error */
  readonly context?: Record<string, unknown>

  constructor(
    message: string,
    code: string,
    options?: {
      suggestion?: string
      context?: Record<string, unknown>
      cause?: Error
    }
  ) {
    super(message, { cause: options?.cause })
    this.name = 'VaulterError'
    this.code = code
    this.suggestion = options?.suggestion
    this.context = options?.context

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * Format error for CLI output
   */
  toCliOutput(): string {
    const lines = [`Error: ${this.message}`]
    if (this.suggestion) {
      lines.push(`  Suggestion: ${this.suggestion}`)
    }
    return lines.join('\n')
  }

  /**
   * Format error for MCP response
   */
  toMcpResponse(): string {
    const lines = [`Error [${this.code}]: ${this.message}`]
    if (this.suggestion) {
      lines.push(`\nSuggestion: ${this.suggestion}`)
    }
    return lines.join('\n')
  }

  /**
   * Convert to JSON for logging/debugging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      suggestion: this.suggestion,
      context: this.context,
      stack: this.stack
    }
  }
}

// =============================================================================
// Configuration Errors
// =============================================================================

/**
 * Base class for configuration-related errors
 */
export class ConfigError extends VaulterError {
  constructor(
    message: string,
    code: string,
    options?: {
      suggestion?: string
      context?: Record<string, unknown>
      cause?: Error
    }
  ) {
    super(message, code, options)
    this.name = 'ConfigError'
  }
}

/**
 * Thrown when .vaulter/config.yaml is not found
 */
export class ConfigNotFoundError extends ConfigError {
  constructor(searchedPath?: string) {
    super(
      searchedPath
        ? `Config file not found: ${searchedPath}`
        : 'No .vaulter/config.yaml found',
      'CONFIG_NOT_FOUND',
      {
        suggestion: 'Run "vaulter init" to create a new project',
        context: searchedPath ? { searchedPath } : undefined
      }
    )
    this.name = 'ConfigNotFoundError'
  }
}

/**
 * Thrown when config.yaml has invalid content
 */
export class InvalidConfigError extends ConfigError {
  constructor(message: string, configPath?: string, cause?: Error) {
    super(
      configPath ? `Invalid config in ${configPath}: ${message}` : `Invalid config: ${message}`,
      'INVALID_CONFIG',
      {
        suggestion: 'Check your .vaulter/config.yaml syntax',
        context: configPath ? { configPath } : undefined,
        cause
      }
    )
    this.name = 'InvalidConfigError'
  }
}

/**
 * Thrown when config inheritance creates a loop
 */
export class CircularExtendsError extends ConfigError {
  constructor(configPath: string) {
    super(
      `Circular config inheritance detected: ${configPath}`,
      'CIRCULAR_EXTENDS',
      {
        suggestion: 'Check your "extends" fields for circular references',
        context: { configPath }
      }
    )
    this.name = 'CircularExtendsError'
  }
}

/**
 * Thrown when config inheritance is too deep
 */
export class ExtendsDepthError extends ConfigError {
  constructor(maxDepth: number) {
    super(
      `Config inheritance depth exceeded (max ${maxDepth})`,
      'EXTENDS_DEPTH_EXCEEDED',
      {
        suggestion: 'Reduce nesting of "extends" in your config files',
        context: { maxDepth }
      }
    )
    this.name = 'ExtendsDepthError'
  }
}

// =============================================================================
// Backend Errors
// =============================================================================

/**
 * Base class for backend-related errors
 */
export class BackendError extends VaulterError {
  constructor(
    message: string,
    code: string,
    options?: {
      suggestion?: string
      context?: Record<string, unknown>
      cause?: Error
    }
  ) {
    super(message, code, options)
    this.name = 'BackendError'
  }
}

/**
 * Thrown when unable to connect to any backend
 */
export class ConnectionError extends BackendError {
  constructor(urls: string[], errors: string[]) {
    const errorList = errors.map((e, i) => `  ${urls[i] || 'unknown'}: ${e}`).join('\n')
    super(
      `Failed to connect to any backend:\n${errorList}`,
      'CONNECTION_FAILED',
      {
        suggestion: 'Check your backend URL and credentials',
        context: { urls, errors }
      }
    )
    this.name = 'ConnectionError'
  }
}

/**
 * Thrown when VaulterClient is used before connect()
 */
export class NotInitializedError extends BackendError {
  constructor() {
    super(
      'VaulterClient not initialized',
      'NOT_INITIALIZED',
      {
        suggestion: 'Call connect() before using the client'
      }
    )
    this.name = 'NotInitializedError'
  }
}

/**
 * Thrown when no backend URL is configured
 */
export class NoBackendError extends BackendError {
  constructor() {
    super(
      'No backend URL configured',
      'NO_BACKEND',
      {
        suggestion: 'Set backend.url in .vaulter/config.yaml or use --backend flag'
      }
    )
    this.name = 'NoBackendError'
  }
}

// =============================================================================
// Encryption Errors
// =============================================================================

/**
 * Base class for encryption-related errors
 */
export class EncryptionError extends VaulterError {
  constructor(
    message: string,
    code: string,
    options?: {
      suggestion?: string
      context?: Record<string, unknown>
      cause?: Error
    }
  ) {
    super(message, code, options)
    this.name = 'EncryptionError'
  }
}

/**
 * Thrown when encryption key is not found
 */
export class KeyNotFoundError extends EncryptionError {
  constructor(keyName?: string, environment?: string) {
    const envPart = environment ? ` for environment "${environment}"` : ''
    const keyPart = keyName ? ` (${keyName})` : ''
    super(
      `No encryption key found${envPart}${keyPart}`,
      'KEY_NOT_FOUND',
      {
        suggestion: environment
          ? `Set VAULTER_KEY_${environment.toUpperCase()} environment variable or run "vaulter key generate"`
          : 'Set VAULTER_KEY environment variable or run "vaulter key generate"',
        context: { keyName, environment }
      }
    )
    this.name = 'KeyNotFoundError'
  }
}

/**
 * Thrown when decryption fails
 */
export class DecryptionError extends EncryptionError {
  constructor(reason: string, cause?: Error) {
    super(
      `Decryption failed: ${reason}`,
      'DECRYPTION_FAILED',
      {
        suggestion: 'Ensure you are using the correct encryption key',
        cause
      }
    )
    this.name = 'DecryptionError'
  }
}

/**
 * Thrown for asymmetric encryption configuration issues
 */
export class AsymmetricKeyError extends EncryptionError {
  constructor(message: string, missingKey: 'public' | 'private' | 'both') {
    super(
      message,
      'ASYMMETRIC_KEY_ERROR',
      {
        suggestion: missingKey === 'public'
          ? 'Configure a public key for encryption'
          : missingKey === 'private'
            ? 'Configure a private key for decryption'
            : 'Asymmetric mode requires at least a public key (for encryption) or private key (for decryption)',
        context: { missingKey }
      }
    )
    this.name = 'AsymmetricKeyError'
  }
}

// =============================================================================
// Validation Errors
// =============================================================================

/**
 * Base class for validation errors
 */
export class ValidationError extends VaulterError {
  constructor(
    message: string,
    code: string,
    options?: {
      suggestion?: string
      context?: Record<string, unknown>
      cause?: Error
    }
  ) {
    super(message, code, options)
    this.name = 'ValidationError'
  }
}

/**
 * Thrown when an invalid environment is specified
 */
export class InvalidEnvironmentError extends ValidationError {
  constructor(environment: string, validEnvironments: string[]) {
    super(
      `Invalid environment: "${environment}"`,
      'INVALID_ENVIRONMENT',
      {
        suggestion: `Valid environments: ${validEnvironments.join(', ')}`,
        context: { environment, validEnvironments }
      }
    )
    this.name = 'InvalidEnvironmentError'
  }
}

/**
 * Thrown when a key name is invalid
 */
export class InvalidKeyNameError extends ValidationError {
  constructor(keyName: unknown) {
    super(
      `Invalid key name: expected string, got ${typeof keyName}`,
      'INVALID_KEY_NAME',
      {
        suggestion: 'Key names must be non-empty strings',
        context: { receivedType: typeof keyName }
      }
    )
    this.name = 'InvalidKeyNameError'
  }
}

/**
 * Thrown when required input is missing
 */
export class MissingInputError extends ValidationError {
  constructor(inputName: string) {
    super(
      `Input required and not supplied: ${inputName}`,
      'MISSING_INPUT',
      {
        suggestion: `Provide the "${inputName}" parameter`,
        context: { inputName }
      }
    )
    this.name = 'MissingInputError'
  }
}

// =============================================================================
// Operation Errors
// =============================================================================

/**
 * Base class for operational errors
 */
export class OperationError extends VaulterError {
  constructor(
    message: string,
    code: string,
    options?: {
      suggestion?: string
      context?: Record<string, unknown>
      cause?: Error
    }
  ) {
    super(message, code, options)
    this.name = 'OperationError'
  }
}

/**
 * Thrown when a required file is not found
 */
export class FileNotFoundError extends OperationError {
  constructor(filePath: string) {
    super(
      `File not found: ${filePath}`,
      'FILE_NOT_FOUND',
      {
        suggestion: 'Check if the file path is correct',
        context: { filePath }
      }
    )
    this.name = 'FileNotFoundError'
  }
}

/**
 * Thrown when a variable is not found
 */
export class VariableNotFoundError extends OperationError {
  constructor(key: string, environment?: string) {
    const envPart = environment ? ` in "${environment}"` : ''
    super(
      `Variable "${key}" not found${envPart}`,
      'VARIABLE_NOT_FOUND',
      {
        suggestion: `Use "vaulter list${environment ? ` -e ${environment}` : ''}" to see available variables`,
        context: { key, environment }
      }
    )
    this.name = 'VariableNotFoundError'
  }
}

/**
 * Thrown when sync conflicts are detected
 */
export class SyncConflictError extends OperationError {
  constructor(conflictingKeys: string[]) {
    super(
      `Sync conflicts detected: ${conflictingKeys.join(', ')}`,
      'SYNC_CONFLICT',
      {
        suggestion: 'Use "vaulter plan" to inspect drift, then "vaulter apply" to push changes',
        context: { conflictingKeys }
      }
    )
    this.name = 'SyncConflictError'
  }
}

/**
 * Thrown when required variables are missing
 */
export class MissingRequiredVarsError extends OperationError {
  constructor(environment: string, missingVars: string[]) {
    super(
      `Missing required keys for ${environment}: ${missingVars.join(', ')}`,
      'MISSING_REQUIRED_VARS',
      {
        suggestion: 'Set the missing variables before proceeding',
        context: { environment, missingVars }
      }
    )
    this.name = 'MissingRequiredVarsError'
  }
}

/**
 * Thrown when batch operation partially fails
 */
export class BatchOperationError extends OperationError {
  /** Number of successful operations */
  readonly successCount: number

  /** Details of failed operations */
  readonly failures: Array<{ key: string; error: string }>

  constructor(
    operation: string,
    successCount: number,
    failures: Array<{ key: string; error: string }>
  ) {
    const failedKeys = failures.map(f => f.key).join(', ')
    super(
      `Failed to ${operation} some variables: ${failedKeys}`,
      'BATCH_OPERATION_FAILED',
      {
        context: { operation, successCount, failures }
      }
    )
    this.name = 'BatchOperationError'
    this.successCount = successCount
    this.failures = failures
  }
}

/**
 * Thrown when a version is not found for rollback
 */
export class VersionNotFoundError extends OperationError {
  constructor(key: string, version: number) {
    super(
      `Version ${version} not found for key "${key}"`,
      'VERSION_NOT_FOUND',
      {
        suggestion: 'Use "vaulter versions <key> -e <env>" to see available versions',
        context: { key, version }
      }
    )
    this.name = 'VersionNotFoundError'
  }
}

/**
 * Thrown when an output target is not found
 */
export class OutputNotFoundError extends OperationError {
  constructor(outputName: string, availableOutputs: string[]) {
    super(
      `Output "${outputName}" not found`,
      'OUTPUT_NOT_FOUND',
      {
        suggestion: `Available outputs: ${availableOutputs.join(', ')}`,
        context: { outputName, availableOutputs }
      }
    )
    this.name = 'OutputNotFoundError'
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if an error is a VaulterError
 */
export function isVaulterError(error: unknown): error is VaulterError {
  return error instanceof VaulterError
}

/**
 * Check if an error is a ConfigError
 */
export function isConfigError(error: unknown): error is ConfigError {
  return error instanceof ConfigError
}

/**
 * Check if an error is a BackendError
 */
export function isBackendError(error: unknown): error is BackendError {
  return error instanceof BackendError
}

/**
 * Check if an error is an EncryptionError
 */
export function isEncryptionError(error: unknown): error is EncryptionError {
  return error instanceof EncryptionError
}

/**
 * Check if an error is a ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError
}

/**
 * Check if an error is an OperationError
 */
export function isOperationError(error: unknown): error is OperationError {
  return error instanceof OperationError
}

// =============================================================================
// Error Formatting Helpers
// =============================================================================

/**
 * Format any error for CLI output
 */
export function formatErrorForCli(error: unknown): string {
  if (isVaulterError(error)) {
    return error.toCliOutput()
  }
  if (error instanceof Error) {
    return `Error: ${error.message}`
  }
  return `Error: ${String(error)}`
}

/**
 * Format any error for MCP response
 */
export function formatErrorForMcp(error: unknown): string {
  if (isVaulterError(error)) {
    return error.toMcpResponse()
  }
  if (error instanceof Error) {
    return `Error: ${error.message}`
  }
  return `Error: ${String(error)}`
}

/**
 * Wrap a generic error into a VaulterError if needed
 */
export function wrapError(error: unknown, defaultCode: string = 'UNKNOWN_ERROR'): VaulterError {
  if (isVaulterError(error)) {
    return error
  }
  if (error instanceof Error) {
    return new VaulterError(error.message, defaultCode, { cause: error })
  }
  return new VaulterError(String(error), defaultCode)
}
