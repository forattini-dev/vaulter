/**
 * Vaulter Smart Config
 *
 * Auto-detects environment and loads appropriate env vars:
 * - K8s: Skip (vars already injected via ConfigMap/Secret)
 * - CI/CD: Load deploy configs + secrets
 * - Local: Load .vaulter/local/shared.env
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
import type { VaulterConfig } from './types.js'

// ============================================================================
// Types
// ============================================================================

export type ConfigMode = 'auto' | 'local' | 'deploy' | 'skip'

export type DetectedEnvironment = 'kubernetes' | 'ci' | 'local'

export interface ConfigOptions {
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
}

export interface ConfigResult {
  /**
   * Detected or forced mode
   */
  mode: ConfigMode

  /**
   * Detected environment type
   */
  detectedEnv: DetectedEnvironment

  /**
   * Files that were loaded
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
    shared: string
    service?: string
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
  const localConfig = vaulterConfig.local || {}
  const deployConfig = vaulterConfig.deploy || {}

  // Local paths
  const localShared = localConfig.shared
    ? path.join(baseDir, localConfig.shared)
    : path.join(configDir, 'local', 'shared.env')

  const localService = service && localConfig.service
    ? path.join(baseDir, localConfig.service.replace('{service}', service))
    : undefined

  // Deploy paths
  const sharedConfigs = deployConfig.shared?.configs
    ? path.join(baseDir, deployConfig.shared.configs.replace('{env}', environment))
    : path.join(configDir, 'deploy', 'shared', 'configs', `${environment}.env`)

  const sharedSecrets = deployConfig.shared?.secrets
    ? path.join(baseDir, deployConfig.shared.secrets.replace('{env}', environment))
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
      service: localService
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

  const result = dotenv.config({ path: filePath, override })
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
 */
export function config(options: ConfigOptions = {}): ConfigResult {
  const {
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
    console.log(`[vaulter] Detected: ${detectedEnv}, mode: ${mode}, env: ${environment}`)
    if (service) console.log(`[vaulter] Service: ${service}`)
  }

  // Determine effective mode
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
    const result = dotenv.config({ override })
    const vars = result.parsed ? Object.keys(result.parsed).length : 0
    return {
      mode: effectiveMode,
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
    // LOCAL MODE: Load .vaulter/local/shared.env + optional service override
    const sharedResult = loadEnvFile(paths.local.shared, override, verbose)
    if (sharedResult.loaded) {
      loadedFiles.push(paths.local.shared)
      varsLoaded += sharedResult.vars
    } else {
      skippedFiles.push(paths.local.shared)
    }

    // Service override (optional)
    if (paths.local.service) {
      const serviceResult = loadEnvFile(paths.local.service, true, verbose)
      if (serviceResult.loaded) {
        loadedFiles.push(paths.local.service)
        varsLoaded += serviceResult.vars
      } else {
        skippedFiles.push(paths.local.service)
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
