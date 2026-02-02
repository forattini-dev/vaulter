/**
 * Vaulter Smart Config
 *
 * Auto-detects environment and loads appropriate env vars:
 * - K8s: Skip (vars already injected via ConfigMap/Secret)
 * - CI/CD: Load deploy configs + secrets
 * - Local: Load .vaulter/local/configs.env + secrets.env (or shared/ for monorepo)
 *
 * @example
 * import { config } from 'vaulter'
 *
 * // Auto-detect (recommended)
 * config()
 *
 * // With options
 * config({ mode: 'local', verbose: true })
 */

import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import { loadConfig, findConfigDir, getBaseDir } from './lib/config-loader.js'
import { loadRuntime, isRuntimeAvailable } from './runtime/index.js'
import type { VaulterConfig } from './types.js'

// ============================================================================
// Types
// ============================================================================

export type ConfigMode = 'auto' | 'local' | 'deploy' | 'skip'

export type ConfigSource = 'local' | 'backend' | 'auto'

export type DetectedEnvironment = 'kubernetes' | 'ci' | 'local'

export interface ConfigOptions {
  /**
   * Where to load variables from:
   * - 'local': Load from .vaulter/local/*.env files (dotenv-style)
   * - 'backend': Load dynamically from S3/backend
   * - 'auto': Use backend in K8s/CI, local otherwise
   * @default 'auto'
   */
  source?: ConfigSource

  /**
   * Force a specific mode instead of auto-detecting
   * @default 'auto'
   */
  mode?: ConfigMode

  /**
   * Environment name for deploy mode (dev, sdx, prd)
   * @default process.env.VAULTER_ENV || process.env.DEPLOY_ENV || process.env.NODE_ENV || 'dev'
   */
  environment?: string

  /**
   * Service name for monorepo (loads service-specific overrides)
   * @default process.env.VAULTER_SERVICE
   */
  service?: string

  /**
   * Working directory to search for .vaulter config
   * @default process.cwd()
   */
  cwd?: string

  /**
   * Override existing process.env values
   * @default false
   */
  override?: boolean

  /**
   * Print debug information
   * @default false
   */
  verbose?: boolean

  /**
   * If true, throws error when vars cannot be loaded from backend.
   * If false, logs warning and falls back to local files.
   * Only applies when source='backend' or 'auto'.
   * @default true in production, false otherwise
   */
  required?: boolean
}

export interface ConfigResult {
  /**
   * Detected or forced mode
   */
  mode: ConfigMode

  /**
   * Source used for loading: 'local' or 'backend'
   */
  source: 'local' | 'backend' | 'none'

  /**
   * Detected environment type
   */
  detectedEnv: DetectedEnvironment

  /**
   * Files that were loaded (only for source='local')
   */
  loadedFiles: string[]

  /**
   * Files that were skipped (not found)
   */
  skippedFiles: string[]

  /**
   * Number of variables loaded
   */
  varsLoaded: number

  /**
   * Backend URL used (only for source='backend')
   */
  backend?: string

  /**
   * Time taken to load from backend (ms)
   */
  durationMs?: number

  /**
   * Whether loading was skipped entirely
   */
  skipped: boolean

  /**
   * Reason for skipping (if skipped)
   */
  skipReason?: string
}

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * Detect if running in Kubernetes
 * K8s sets KUBERNETES_SERVICE_HOST and KUBERNETES_SERVICE_PORT automatically
 */
export function isKubernetes(): boolean {
  return !!(process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT)
}

/**
 * Detect if running in CI/CD environment
 */
export function isCI(): boolean {
  return !!(
    process.env.CI === 'true' ||
    process.env.CI === '1' ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.JENKINS_URL ||
    process.env.BUILDKITE
  )
}

/**
 * Detect the current environment type
 */
export function detectEnvironment(): DetectedEnvironment {
  if (isKubernetes()) return 'kubernetes'
  if (isCI()) return 'ci'
  return 'local'
}

/**
 * Get the deploy environment name from various sources
 */
export function getDeployEnvironment(options?: ConfigOptions): string {
  return (
    options?.environment ||
    process.env.VAULTER_ENV ||
    process.env.DEPLOY_ENV ||
    mapNodeEnvToVaulterEnv(process.env.NODE_ENV) ||
    'dev'
  )
}

/**
 * Map NODE_ENV to vaulter environment names
 */
function mapNodeEnvToVaulterEnv(nodeEnv?: string): string | undefined {
  const mapping: Record<string, string> = {
    'development': 'dev',
    'staging': 'sdx',
    'sandbox': 'sdx',
    'production': 'prd',
    'prod': 'prd'
  }
  return nodeEnv ? mapping[nodeEnv.toLowerCase()] || nodeEnv : undefined
}

// ============================================================================
// File Path Resolution
// ============================================================================

interface ResolvedPaths {
  local: {
    shared: string  // kept for backward compat
    sharedConfigs: string
    sharedSecrets: string
    service?: string  // kept for backward compat
    serviceConfigs?: string
    serviceSecrets?: string
  }
  deploy: {
    sharedConfigs: string
    sharedSecrets: string
    serviceConfigs?: string
    serviceSecrets?: string
  }
}

/**
 * Resolve file paths based on config structure
 */
function resolvePaths(
  vaulterConfig: VaulterConfig,
  configDir: string,
  environment: string,
  service?: string
): ResolvedPaths {
  const baseDir = getBaseDir(configDir)
  const deployConfig = vaulterConfig.deploy || {}

  // Local paths - unified structure for single repo and monorepo
  // Shared files are always at .vaulter/local/{configs,secrets}.env
  // Service-specific files at .vaulter/local/services/<svc>/{configs,secrets}.env
  const localSharedConfigs = path.join(configDir, 'local', 'configs.env')
  const localSharedSecrets = path.join(configDir, 'local', 'secrets.env')
  const localShared = localSharedConfigs // For backward compat in return type

  // Service-specific overrides (monorepo)
  const localServiceConfigs = service
    ? path.join(configDir, 'local', 'services', service, 'configs.env')
    : undefined
  const localServiceSecrets = service
    ? path.join(configDir, 'local', 'services', service, 'secrets.env')
    : undefined
  const localService = localServiceConfigs

  // Deploy paths
  const sharedConfigs = deployConfig.shared?.configs
    ? path.join(baseDir, deployConfig.shared.configs.replace('{env}', environment))
    : deployConfig.configs
      ? path.join(baseDir, deployConfig.configs.replace('{env}', environment))
      : path.join(configDir, 'deploy', 'shared', 'configs', `${environment}.env`)

  const sharedSecrets = deployConfig.shared?.secrets
    ? path.join(baseDir, deployConfig.shared.secrets.replace('{env}', environment))
    : deployConfig.secrets
      ? path.join(baseDir, deployConfig.secrets.replace('{env}', environment))
      : path.join(configDir, 'deploy', 'shared', 'secrets', `${environment}.env`)

  // Service-specific paths (monorepo)
  let serviceConfigs: string | undefined
  let serviceSecrets: string | undefined

  if (service) {
    serviceConfigs = deployConfig.services?.configs
      ? path.join(baseDir, deployConfig.services.configs
          .replace('{service}', service)
          .replace('{env}', environment))
      : path.join(configDir, 'deploy', 'services', service, 'configs', `${environment}.env`)

    serviceSecrets = deployConfig.services?.secrets
      ? path.join(baseDir, deployConfig.services.secrets
          .replace('{service}', service)
          .replace('{env}', environment))
      : path.join(configDir, 'deploy', 'services', service, 'secrets', `${environment}.env`)
  }

  return {
    local: {
      shared: localShared,
      sharedConfigs: localSharedConfigs,
      sharedSecrets: localSharedSecrets,
      service: localService,
      serviceConfigs: localServiceConfigs,
      serviceSecrets: localServiceSecrets
    },
    deploy: {
      sharedConfigs,
      sharedSecrets,
      serviceConfigs,
      serviceSecrets
    }
  }
}

// ============================================================================
// File Loading
// ============================================================================

/**
 * Load a single env file if it exists
 */
function loadEnvFile(
  filePath: string,
  override: boolean,
  verbose: boolean
): { loaded: boolean; vars: number } {
  if (!fs.existsSync(filePath)) {
    if (verbose) {
      console.log(`[vaulter] Skip (not found): ${filePath}`)
    }
    return { loaded: false, vars: 0 }
  }

  // Suppress dotenv's debug output (it prints even without debug flag in newer versions)
  const originalDebug = process.env.DEBUG
  if (!verbose) {
    delete process.env.DEBUG
  }

  const result = dotenv.config({ path: filePath, override, quiet: true })
  const varsCount = result.parsed ? Object.keys(result.parsed).length : 0

  // Restore DEBUG
  if (originalDebug !== undefined) {
    process.env.DEBUG = originalDebug
  }

  if (verbose) {
    console.log(`[vaulter] Loaded: ${filePath} (${varsCount} vars)`)
  }

  return { loaded: true, vars: varsCount }
}

// ============================================================================
// Backend Loading
// ============================================================================

/**
 * Load variables from the backend (S3/MinIO)
 */
async function loadFromBackend(
  options: ConfigOptions,
  detectedEnv: DetectedEnvironment,
  environment: string
): Promise<ConfigResult> {
  const {
    service,
    cwd = process.cwd(),
    override = false,
    verbose = process.env.VAULTER_VERBOSE === 'true',
    required
  } = options

  if (verbose) {
    console.log(`[vaulter] Loading from backend for ${environment}...`)
  }

  // Check if backend is available
  if (!isRuntimeAvailable(cwd)) {
    const msg = 'No .vaulter config found, cannot load from backend'
    if (verbose) {
      console.log(`[vaulter] ${msg}`)
    }
    return {
      mode: 'auto',
      source: 'none',
      detectedEnv,
      loadedFiles: [],
      skippedFiles: [],
      varsLoaded: 0,
      skipped: true,
      skipReason: msg
    }
  }

  try {
    const result = await loadRuntime({
      cwd,
      environment,
      service,
      override,
      required,
      verbose,
      silent: !verbose
    })

    if (verbose) {
      console.log(`[vaulter] Loaded ${result.varsLoaded} vars from backend in ${result.durationMs}ms`)
    }

    return {
      mode: 'auto',
      source: 'backend',
      detectedEnv,
      loadedFiles: [],
      skippedFiles: [],
      varsLoaded: result.varsLoaded,
      backend: result.backend,
      durationMs: result.durationMs,
      skipped: false
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)

    if (verbose) {
      console.error(`[vaulter] Backend load failed: ${errMsg}`)
    }

    // If required, re-throw
    if (required) {
      throw err
    }

    // Otherwise return empty result
    return {
      mode: 'auto',
      source: 'none',
      detectedEnv,
      loadedFiles: [],
      skippedFiles: [],
      varsLoaded: 0,
      skipped: true,
      skipReason: `Backend load failed: ${errMsg}`
    }
  }
}

// ============================================================================
// Main Config Function
// ============================================================================

/**
 * Smart config loader that auto-detects environment
 *
 * @example
 * // Auto-detect and load appropriate env vars
 * import { config } from 'vaulter'
 * config()
 *
 * @example
 * // Force local mode
 * config({ mode: 'local' })
 *
 * @example
 * // Deploy mode with specific environment
 * config({ mode: 'deploy', environment: 'prd' })
 *
 * @example
 * // Monorepo with service-specific vars
 * config({ service: 'svc-auth' })
 *
 * @example
 * // Load from backend (S3)
 * await config({ source: 'backend' })
 */
export function config(options: ConfigOptions = {}): ConfigResult | Promise<ConfigResult> {
  const {
    source = 'auto',
    mode = 'auto',
    service = process.env.VAULTER_SERVICE,
    cwd = process.cwd(),
    override = false,
    verbose = process.env.VAULTER_VERBOSE === 'true'
  } = options

  const detectedEnv = detectEnvironment()
  const environment = getDeployEnvironment(options)
  const loadedFiles: string[] = []
  const skippedFiles: string[] = []
  let varsLoaded = 0

  if (verbose) {
    console.log(`[vaulter] Detected: ${detectedEnv}, mode: ${mode}, env: ${environment}, source: ${source}`)
    if (service) console.log(`[vaulter] Service: ${service}`)
  }

  // Determine if we should use backend
  // Only use backend when explicitly requested (source='backend')
  // 'auto' mode keeps the original behavior (local files)
  if (source === 'backend') {
    return loadFromBackend(options, detectedEnv, environment)
  }

  // Determine effective mode for local loading
  let effectiveMode: ConfigMode = mode
  if (mode === 'auto') {
    if (detectedEnv === 'kubernetes') {
      effectiveMode = 'skip'
    } else if (detectedEnv === 'ci') {
      effectiveMode = 'deploy'
    } else {
      effectiveMode = 'local'
    }
  }

  // Skip mode - vars already injected
  if (effectiveMode === 'skip') {
    if (verbose) {
      console.log('[vaulter] Skipped: Running in Kubernetes, vars already injected')
    }
    return {
      mode: effectiveMode,
      source: 'none',
      detectedEnv,
      loadedFiles,
      skippedFiles,
      varsLoaded,
      skipped: true,
      skipReason: 'Running in Kubernetes - environment variables already injected via ConfigMap/Secret'
    }
  }

  // Find vaulter config
  const configDir = findConfigDir(cwd)
  if (!configDir) {
    if (verbose) {
      console.log('[vaulter] No .vaulter directory found, falling back to dotenv')
    }
    // Fallback to standard dotenv behavior
    const result = dotenv.config({ override, quiet: true })
    const vars = result.parsed ? Object.keys(result.parsed).length : 0
    return {
      mode: effectiveMode,
      source: 'local',
      detectedEnv,
      loadedFiles: result.parsed ? ['.env'] : [],
      skippedFiles: result.parsed ? [] : ['.env'],
      varsLoaded: vars,
      skipped: false
    }
  }

  // Load vaulter config
  const vaulterConfig = loadConfig(cwd)
  const paths = resolvePaths(vaulterConfig, configDir, environment, service)

  // Load files based on mode
  if (effectiveMode === 'local') {
    // LOCAL MODE: Load configs.env + secrets.env (shared, then service)

    // 1. Shared/default configs (non-sensitive)
    const sharedConfigsResult = loadEnvFile(paths.local.sharedConfigs, override, verbose)
    if (sharedConfigsResult.loaded) {
      loadedFiles.push(paths.local.sharedConfigs)
      varsLoaded += sharedConfigsResult.vars
    } else {
      skippedFiles.push(paths.local.sharedConfigs)
    }

    // 2. Shared/default secrets (sensitive)
    const sharedSecretsResult = loadEnvFile(paths.local.sharedSecrets, true, verbose)
    if (sharedSecretsResult.loaded) {
      loadedFiles.push(paths.local.sharedSecrets)
      varsLoaded += sharedSecretsResult.vars
    } else {
      skippedFiles.push(paths.local.sharedSecrets)
    }

    // 3. Service-specific configs (optional, monorepo)
    if (paths.local.serviceConfigs) {
      const svcConfigsResult = loadEnvFile(paths.local.serviceConfigs, true, verbose)
      if (svcConfigsResult.loaded) {
        loadedFiles.push(paths.local.serviceConfigs)
        varsLoaded += svcConfigsResult.vars
      } else {
        skippedFiles.push(paths.local.serviceConfigs)
      }
    }

    // 4. Service-specific secrets (optional, monorepo)
    if (paths.local.serviceSecrets) {
      const svcSecretsResult = loadEnvFile(paths.local.serviceSecrets, true, verbose)
      if (svcSecretsResult.loaded) {
        loadedFiles.push(paths.local.serviceSecrets)
        varsLoaded += svcSecretsResult.vars
      } else {
        skippedFiles.push(paths.local.serviceSecrets)
      }
    }

  } else if (effectiveMode === 'deploy') {
    // DEPLOY MODE: Load configs (git) + secrets (CI-generated) + service overrides

    // 1. Shared configs (from git)
    const configsResult = loadEnvFile(paths.deploy.sharedConfigs, override, verbose)
    if (configsResult.loaded) {
      loadedFiles.push(paths.deploy.sharedConfigs)
      varsLoaded += configsResult.vars
    } else {
      skippedFiles.push(paths.deploy.sharedConfigs)
    }

    // 2. Shared secrets (generated in CI)
    const secretsResult = loadEnvFile(paths.deploy.sharedSecrets, true, verbose)
    if (secretsResult.loaded) {
      loadedFiles.push(paths.deploy.sharedSecrets)
      varsLoaded += secretsResult.vars
    } else {
      skippedFiles.push(paths.deploy.sharedSecrets)
    }

    // 3. Service configs (optional)
    if (paths.deploy.serviceConfigs) {
      const svcConfigsResult = loadEnvFile(paths.deploy.serviceConfigs, true, verbose)
      if (svcConfigsResult.loaded) {
        loadedFiles.push(paths.deploy.serviceConfigs)
        varsLoaded += svcConfigsResult.vars
      } else {
        skippedFiles.push(paths.deploy.serviceConfigs)
      }
    }

    // 4. Service secrets (optional)
    if (paths.deploy.serviceSecrets) {
      const svcSecretsResult = loadEnvFile(paths.deploy.serviceSecrets, true, verbose)
      if (svcSecretsResult.loaded) {
        loadedFiles.push(paths.deploy.serviceSecrets)
        varsLoaded += svcSecretsResult.vars
      } else {
        skippedFiles.push(paths.deploy.serviceSecrets)
      }
    }
  }

  if (verbose) {
    console.log(`[vaulter] Done: ${varsLoaded} vars loaded from ${loadedFiles.length} files`)
  }

  return {
    mode: effectiveMode,
    source: 'local',
    detectedEnv,
    loadedFiles,
    skippedFiles,
    varsLoaded,
    skipped: false
  }
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Check if environment vars should be loaded from files
 * Returns false if running in K8s (vars already injected)
 */
export function shouldLoadEnvFiles(): boolean {
  return !isKubernetes()
}

/**
 * Get info about the current environment without loading anything
 */
export function getEnvironmentInfo(cwd?: string): {
  detected: DetectedEnvironment
  shouldLoad: boolean
  environment: string
  configDir: string | null
} {
  return {
    detected: detectEnvironment(),
    shouldLoad: shouldLoadEnvFiles(),
    environment: getDeployEnvironment(),
    configDir: findConfigDir(cwd)
  }
}
