/**
 * Vaulter Runtime Loader
 *
 * Load environment variables directly from the backend at application startup,
 * without needing .env files or Kubernetes ConfigMaps/Secrets.
 *
 * @example
 * ```typescript
 * // Simple usage - auto-detects everything from .vaulter/config.yaml
 * await loadRuntime()
 *
 * // With options
 * await loadRuntime({
 *   environment: 'prd',
 *   service: 'api',
 *   required: true
 * })
 *
 * // Now process.env has all your secrets!
 * console.log(process.env.DATABASE_URL)
 * ```
 */

import fs from 'node:fs'
import path from 'node:path'
import type { VaulterConfig, AsymmetricAlgorithm } from '../types.js'
import type {
  RuntimeLoaderOptions,
  RuntimeLoaderResult,
  ResolvedRuntimeOptions
} from './types.js'
import { VaulterClient } from '../client.js'
import {
  loadConfig,
  findConfigDir,
  getEncryptionMode,
  loadEncryptionKeyForEnv,
  resolveBackendUrls
} from '../lib/config-loader.js'
import { loadKeyForEnv } from '../lib/keys.js'
import { filterVarsByPatterns } from '../lib/outputs.js'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ENVIRONMENT = 'dev'

// ============================================================================
// Logging Helpers
// ============================================================================

function log(message: string, verbose: boolean, silent: boolean): void {
  if (!silent && verbose) {
    console.log(`[vaulter] ${message}`)
  }
}

function warn(message: string, silent: boolean): void {
  if (!silent) {
    console.warn(`[vaulter] WARN: ${message}`)
  }
}

function error(message: string, silent: boolean): void {
  if (!silent) {
    console.error(`[vaulter] ERROR: ${message}`)
  }
}

// ============================================================================
// Key Resolution (delegates to config-loader)
// ============================================================================

/**
 * Load encryption key with per-environment support
 *
 * Delegates to loadEncryptionKeyForEnv from config-loader.
 * Allows explicit override via options.encryptionKey.
 */
async function loadRuntimeEncryptionKey(
  config: VaulterConfig | null,
  project: string,
  environment: string,
  explicitKey?: string
): Promise<string | undefined> {
  // Explicit key from options takes highest priority
  if (explicitKey) {
    return explicitKey
  }

  // Delegate to centralized key loading
  const key = await loadEncryptionKeyForEnv(config, project, environment)
  return key || undefined
}

// ============================================================================
// Option Resolution
// ============================================================================

/**
 * Resolve and validate all options with defaults and environment variables
 */
async function resolveOptions(
  options: RuntimeLoaderOptions
): Promise<ResolvedRuntimeOptions> {
  const cwd = options.cwd || process.cwd()

  // Load config if not provided
  let config = options.config
  if (config === undefined) {
    if (options.configPath) {
      // configPath is the project root directory (contains .vaulter/config.yaml)
      // If .vaulter directory is passed, get its parent (project root)
      let configDir = options.configPath
      if (path.basename(configDir) === '.vaulter') {
        configDir = path.dirname(configDir)
      }
      config = loadConfig(configDir)
    } else {
      // Search from cwd
      const configDir = findConfigDir(cwd)
      config = configDir ? loadConfig(path.dirname(configDir)) : null
    }
  }

  // Resolve environment
  // Priority: options > NODE_ENV > config default > 'dev'
  const environment =
    options.environment ||
    process.env.NODE_ENV ||
    config?.default_environment ||
    DEFAULT_ENVIRONMENT

  // Resolve project
  // Priority: options > config > VAULTER_PROJECT > directory name
  const project =
    options.project ||
    config?.project ||
    process.env.VAULTER_PROJECT ||
    path.basename(cwd)

  // Resolve service
  // Priority: options > config > VAULTER_SERVICE
  const service = options.service || config?.service || process.env.VAULTER_SERVICE

  // Resolve backend
  // Priority: options > VAULTER_BACKEND > config
  let backend = options.backend || process.env.VAULTER_BACKEND
  if (!backend && config) {
    const urls = resolveBackendUrls(config)
    backend = urls[0] // Runtime uses first backend only (no fallback for speed)
  }
  // Note: backend can be empty - will be handled by loadRuntime based on required flag

  // Resolve encryption key (per-environment support)
  const encryptionKey = await loadRuntimeEncryptionKey(
    config,
    project,
    environment,
    options.encryptionKey
  )

  // Resolve required flag
  // Default: true in production-like environments
  const isProduction = ['prd', 'prod', 'production'].includes(environment.toLowerCase())
  const required = options.required ?? isProduction

  // Resolve other options
  const override = options.override ?? false
  const includeShared = options.includeShared ?? true
  const verbose = options.verbose ?? process.env.VAULTER_VERBOSE === '1'
  const silent = options.silent ?? false
  const localFallback = options.localFallback ?? false

  const filter = {
    include: options.filter?.include || [],
    exclude: options.filter?.exclude || []
  }

  return {
    cwd,
    project,
    environment,
    service,
    backend,
    encryptionKey,
    required,
    override,
    includeShared,
    verbose,
    silent,
    localFallback,
    filter,
    config
  }
}

// ============================================================================
// Client Creation
// ============================================================================

/**
 * Create a VaulterClient for runtime loading
 * Note: This function expects backend to be defined (checked by caller)
 */
async function createRuntimeClient(
  opts: ResolvedRuntimeOptions & { backend: string }
): Promise<VaulterClient> {
  const { config, backend, encryptionKey, project, environment, verbose, silent } = opts

  // Determine encryption mode - check per-environment override first
  const envKeyConfig = config?.encryption?.keys?.[environment]
  const encryptionMode = envKeyConfig?.mode || (config ? getEncryptionMode(config) : 'symmetric')

  if (encryptionMode === 'asymmetric' && config) {
    // Asymmetric mode - delegate to loadKeyForEnv for consistent key resolution
    const keyResult = await loadKeyForEnv({
      project,
      environment,
      config,
      loadPublicKey: true,
      loadPrivateKey: true
    })

    if (!keyResult.key) {
      throw new Error(
        `Asymmetric encryption mode requires a private key for reading (env: ${environment}). ` +
        `Set VAULTER_PRIVATE_KEY_${environment.toUpperCase()} or configure encryption.keys.${environment}.asymmetric`
      )
    }

    const algorithm = (keyResult.algorithm || 'rsa-4096') as AsymmetricAlgorithm
    log(`Using asymmetric encryption (${algorithm}) for ${environment}`, verbose, silent)

    return new VaulterClient({
      connectionStrings: [backend],
      encryptionMode: 'asymmetric',
      publicKey: keyResult.publicKey || undefined,
      privateKey: keyResult.key,
      asymmetricAlgorithm: algorithm,
      verbose
    })
  }

  // Symmetric mode (default)
  if (!encryptionKey) {
    // Check if it's a remote backend (not file:// or memory://)
    const isRemote = !backend.startsWith('file://') && !backend.startsWith('memory://')
    if (isRemote) {
      warn(
        'No encryption key found for remote backend. ' +
        `Set VAULTER_KEY_${opts.environment.toUpperCase()} or VAULTER_KEY`,
        silent
      )
    }
  }

  log('Using symmetric encryption', verbose, silent)

  return new VaulterClient({
    connectionStrings: [backend],
    encryptionMode: 'symmetric',
    passphrase: encryptionKey,
    verbose
  })
}

// ============================================================================
// Local Fallback
// ============================================================================

/**
 * Load vars from local .env files as a fallback when backend is unavailable.
 * Reads (in order): .env.{environment}, .env.local, .env — merges all found.
 * Does NOT throw; missing files are silently skipped.
 */
function loadLocalEnvFallback(
  cwd: string,
  environment: string,
  override: boolean
): string[] {
  const candidates = [
    path.join(cwd, `.env.${environment}`),
    path.join(cwd, '.env.local'),
    path.join(cwd, '.env'),
  ]

  const loaded: string[] = []

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx === -1) continue
        const key = trimmed.slice(0, eqIdx).trim()
        const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
        if (key && (override || process.env[key] === undefined)) {
          process.env[key] = value
          loaded.push(key)
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return loaded
}

// ============================================================================
// Main Loader Function
// ============================================================================

/**
 * Load environment variables from the backend into process.env
 *
 * @example
 * ```typescript
 * // Auto-detect everything from .vaulter/config.yaml
 * await loadRuntime()
 *
 * // With explicit options
 * await loadRuntime({
 *   environment: 'prd',
 *   service: 'api',
 *   required: true
 * })
 *
 * // With filters
 * await loadRuntime({
 *   filter: {
 *     include: ['DATABASE_*', 'REDIS_*'],
 *     exclude: ['*_DEV']
 *   }
 * })
 * ```
 */
export async function loadRuntime(
  options: RuntimeLoaderOptions = {}
): Promise<RuntimeLoaderResult> {
  const startTime = Date.now()

  try {
    // Resolve all options
    const opts = await resolveOptions(options)

    // Check if backend is configured
    if (!opts.backend) {
      if (opts.localFallback) {
        log('No backend configured, falling back to local .env files', opts.verbose, opts.silent)
        const keys = loadLocalEnvFallback(opts.cwd, opts.environment, opts.override)
        log(`Loaded ${keys.length} variables from local .env files`, opts.verbose, opts.silent)
        return {
          varsLoaded: keys.length,
          environment: opts.environment,
          project: opts.project,
          service: opts.service,
          backend: 'local',
          durationMs: Date.now() - startTime,
          includedShared: opts.includeShared,
          keys,
          dryRun: false
        }
      }
      const errMsg = 'No backend configured. Set VAULTER_BACKEND env var or configure backend in .vaulter/config.yaml'
      if (opts.required) {
        throw new Error(errMsg)
      }
      warn(errMsg, opts.silent)
      return {
        varsLoaded: 0,
        environment: opts.environment,
        project: opts.project,
        service: opts.service,
        backend: 'none',
        durationMs: Date.now() - startTime,
        includedShared: opts.includeShared,
        keys: [],
        dryRun: false
      }
    }

    log(`Loading secrets for ${opts.project}/${opts.environment}`, opts.verbose, opts.silent)
    if (opts.service) {
      log(`Service: ${opts.service}`, opts.verbose, opts.silent)
    }

    // Create client (backend is guaranteed to exist at this point)
    const client = await createRuntimeClient({ ...opts, backend: opts.backend! })

    try {
      await client.connect()
      log(`Connected to backend: ${maskBackendUrl(opts.backend!)}`, opts.verbose, opts.silent)

      // Export variables from backend
      let vars = await client.export(
        opts.project,
        opts.environment,
        opts.service,
        { includeShared: opts.includeShared }
      )

      // Apply filters if specified
      if (opts.filter.include.length > 0 || opts.filter.exclude.length > 0) {
        vars = filterVarsByPatterns(vars, opts.filter.include, opts.filter.exclude)
        log(`Filtered to ${Object.keys(vars).length} variables`, opts.verbose, opts.silent)
      }

      // Set to process.env
      const keys: string[] = []
      for (const [key, value] of Object.entries(vars)) {
        if (opts.override || process.env[key] === undefined) {
          process.env[key] = value
          keys.push(key)
        }
      }

      const durationMs = Date.now() - startTime
      const result: RuntimeLoaderResult = {
        varsLoaded: keys.length,
        environment: opts.environment,
        project: opts.project,
        service: opts.service,
        backend: maskBackendUrl(opts.backend),
        durationMs,
        includedShared: opts.includeShared,
        keys,
        dryRun: false
      }

      log(
        `Loaded ${keys.length} variables in ${durationMs}ms`,
        opts.verbose,
        opts.silent
      )

      // Call onLoaded callback
      if (options.onLoaded) {
        options.onLoaded(result)
      }

      return result
    } finally {
      await client.disconnect()
    }
  } catch (err) {
    const errObj = err instanceof Error ? err : new Error(String(err))

    // Resolve options again for error handling (may fail, use defaults)
    let required = true
    let silent = false
    let localFallback = false
    let cwd = process.cwd()
    let environment = options.environment || process.env.NODE_ENV || DEFAULT_ENVIRONMENT
    try {
      const opts = await resolveOptions(options)
      required = opts.required
      silent = opts.silent
      localFallback = opts.localFallback
      cwd = opts.cwd
      environment = opts.environment
    } catch {
      // Use defaults
    }

    // localFallback: try local .env files before giving up
    if (localFallback) {
      log(`Backend unavailable, falling back to local .env files`, false, silent)
      try {
        const keys = loadLocalEnvFallback(cwd, environment, options.override ?? false)
        log(`Loaded ${keys.length} variables from local .env files`, false, silent)
        return {
          varsLoaded: keys.length,
          environment,
          project: options.project || 'unknown',
          service: options.service,
          backend: 'local',
          durationMs: Date.now() - startTime,
          includedShared: options.includeShared ?? true,
          keys,
          dryRun: false
        }
      } catch {
        // fallback also failed, continue to normal error handling
      }
    }

    // Handle error
    if (options.onError) {
      options.onError(errObj)
    }

    if (required) {
      error(`Failed to load runtime secrets: ${errObj.message}`, silent)
      throw errObj
    } else {
      warn(`Failed to load runtime secrets: ${errObj.message}`, silent)

      // Return empty result
      return {
        varsLoaded: 0,
        environment,
        project: options.project || 'unknown',
        service: options.service,
        backend: 'unknown',
        durationMs: Date.now() - startTime,
        includedShared: options.includeShared ?? true,
        keys: [],
        dryRun: false
      }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Mask sensitive parts of backend URL for logging
 */
function maskBackendUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.password) {
      parsed.password = '***'
    }
    if (parsed.username && parsed.username.length > 4) {
      parsed.username = parsed.username.slice(0, 4) + '***'
    }
    return parsed.toString()
  } catch {
    // Not a valid URL, return as-is (e.g., file:// paths)
    return url.replace(/:[^@]+@/, ':***@')
  }
}

/**
 * Check if runtime loading is available (config exists)
 */
export function isRuntimeAvailable(cwd?: string): boolean {
  return findConfigDir(cwd || process.cwd()) !== null
}

/**
 * Get info about what would be loaded without actually loading
 */
export async function getRuntimeInfo(options: RuntimeLoaderOptions = {}): Promise<{
  available: boolean
  project?: string
  environment?: string
  service?: string
  backend?: string
  /** Full path to config file (.vaulter/config.yaml) */
  configFile?: string
}> {
  const cwd = options.cwd || process.cwd()
  const configDir = findConfigDir(cwd)

  if (!configDir) {
    return { available: false }
  }

  try {
    const opts = await resolveOptions(options)
    return {
      available: true,
      project: opts.project,
      environment: opts.environment,
      service: opts.service,
      backend: opts.backend ? maskBackendUrl(opts.backend) : undefined,
      configFile: path.join(configDir, 'config.yaml')
    }
  } catch {
    return {
      available: true,
      configFile: path.join(configDir, 'config.yaml')
    }
  }
}
