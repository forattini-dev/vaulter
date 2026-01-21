/**
 * Runtime Loader Types
 *
 * Types for loading environment variables directly from the backend at runtime,
 * without needing .env files or Kubernetes ConfigMaps/Secrets.
 */

import type { VaulterConfig } from '../types.js'

/**
 * Options for the runtime loader
 */
export interface RuntimeLoaderOptions {
  // ============================================================================
  // Config Source
  // ============================================================================

  /**
   * Pre-loaded config object.
   * If not provided, will search for .vaulter/config.yaml from cwd.
   */
  config?: VaulterConfig | null

  /**
   * Project root directory containing .vaulter/config.yaml.
   * If not provided, searches from cwd upward.
   */
  configPath?: string

  /**
   * Directory to search for .vaulter/config.yaml.
   * Defaults to process.cwd()
   */
  cwd?: string

  // ============================================================================
  // Runtime Context
  // ============================================================================

  /**
   * Project name.
   * Overrides config.project if specified.
   */
  project?: string

  /**
   * Environment name (dev, prd, etc).
   * Defaults to NODE_ENV or 'dev'.
   */
  environment?: string

  /**
   * Service name for monorepos.
   * If not specified, uses config.service or loads all shared vars.
   */
  service?: string

  // ============================================================================
  // Backend Connection
  // ============================================================================

  /**
   * Backend URL override.
   * Overrides config.backend if specified.
   * Can also be set via VAULTER_BACKEND env var.
   */
  backend?: string

  /**
   * Encryption key (passphrase for symmetric mode).
   * Can also be set via VAULTER_KEY env var.
   */
  encryptionKey?: string

  // ============================================================================
  // Loading Behavior
  // ============================================================================

  /**
   * If true, throws error when vars cannot be loaded.
   * If false, logs warning and continues.
   * Defaults to true in production, false otherwise.
   */
  required?: boolean

  /**
   * If true, overrides existing process.env values.
   * If false, only sets vars that are not already defined.
   * Defaults to false.
   */
  override?: boolean

  /**
   * Filter patterns for variables.
   * If specified, only matching vars are loaded.
   */
  filter?: {
    /** Glob patterns to include */
    include?: string[]
    /** Glob patterns to exclude */
    exclude?: string[]
  }

  /**
   * Include shared vars when loading a service.
   * Defaults to true.
   */
  includeShared?: boolean

  // ============================================================================
  // Debugging
  // ============================================================================

  /**
   * Enable verbose logging.
   * Defaults to VAULTER_VERBOSE=1 or false.
   */
  verbose?: boolean

  /**
   * Silent mode - no output at all.
   * Defaults to false.
   */
  silent?: boolean

  // ============================================================================
  // Callbacks
  // ============================================================================

  /**
   * Called after vars are loaded successfully.
   */
  onLoaded?: (result: RuntimeLoaderResult) => void

  /**
   * Called when an error occurs.
   * If not provided and required=true, error is thrown.
   */
  onError?: (error: Error) => void
}

/**
 * Result of the runtime loader
 */
export interface RuntimeLoaderResult {
  /** Number of variables loaded into process.env */
  varsLoaded: number

  /** Environment that was loaded */
  environment: string

  /** Project that was loaded */
  project: string

  /** Service that was loaded (if monorepo) */
  service?: string

  /** Backend URL that was used */
  backend: string

  /** Time taken to load (ms) */
  durationMs: number

  /** Whether shared vars were included */
  includedShared: boolean

  /** List of variable keys that were loaded */
  keys: string[]

  /** Whether this was a dry run (no process.env mutation) */
  dryRun: boolean
}

/**
 * Internal resolved options after merging defaults and env vars
 */
export interface ResolvedRuntimeOptions {
  cwd: string
  project: string
  environment: string
  service: string | undefined
  backend: string | undefined
  encryptionKey: string | undefined
  required: boolean
  override: boolean
  includeShared: boolean
  verbose: boolean
  silent: boolean
  filter: {
    include: string[]
    exclude: string[]
  }
  config: VaulterConfig | null
}
