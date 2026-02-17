/**
 * Vaulter - Local Overrides & Snapshots
 *
 * Local overrides are plaintext, gitignored files that layer on top of
 * a base environment (fetched from the backend). They never touch the backend.
 *
 * STRUCTURE (unified for single repo and monorepo):
 *
 * .vaulter/local/
 * ├── configs.env             # shared configs (sensitive=false)
 * ├── secrets.env             # shared secrets (sensitive=true)
 * └── services/               # monorepo only
 *     ├── web/
 *     │   ├── configs.env
 *     │   └── secrets.env
 *     └── api/
 *         ├── configs.env
 *         └── secrets.env
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseEnvString } from './env-parser.js'
import { formatEnvFile } from './outputs.js'
import { getSnapshotCount } from './snapshot.js'
import type { VaulterConfig } from '../types.js'
import { isMonorepoFromConfig } from './monorepo.js'

// ============================================================================
// Constants
// ============================================================================

const CONFIGS_FILE = 'configs.env'
const SECRETS_FILE = 'secrets.env'
const LOCAL_ENV_FILE_MODE = 0o600

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Get the local directory path (.vaulter/local/)
 */
export function getLocalDir(configDir: string): string {
  return path.join(configDir, 'local')
}

/**
 * Get the shared directory path (.vaulter/local/)
 * Shared configs/secrets are at the root of local dir (not in a subdirectory)
 */
export function getSharedDir(configDir: string): string {
  return getLocalDir(configDir)
}

/**
 * Get path to shared configs.env
 */
export function getSharedConfigPath(configDir: string): string {
  return path.join(getSharedDir(configDir), CONFIGS_FILE)
}

/**
 * Get path to shared secrets.env
 */
export function getSharedSecretsPath(configDir: string): string {
  return path.join(getSharedDir(configDir), SECRETS_FILE)
}

/**
 * Get the service directory path
 * - Single repo: returns local dir itself (files at root)
 * - Monorepo: .vaulter/local/services/<service>/
 */
export function getServiceDir(configDir: string, service?: string): string {
  const localDir = getLocalDir(configDir)
  if (service) {
    return path.join(localDir, 'services', service)
  }
  // Single repo: files directly in .vaulter/local/
  return localDir
}

/**
 * Get path to service configs.env
 * - Single repo: .vaulter/local/configs.env
 * - Monorepo: .vaulter/local/services/<service>/configs.env
 */
export function getServiceConfigPath(configDir: string, service?: string): string {
  return path.join(getServiceDir(configDir, service), CONFIGS_FILE)
}

/**
 * Get path to service secrets.env
 * - Single repo: .vaulter/local/secrets.env
 * - Monorepo: .vaulter/local/services/<service>/secrets.env
 */
export function getServiceSecretsPath(configDir: string, service?: string): string {
  return path.join(getServiceDir(configDir, service), SECRETS_FILE)
}

// ============================================================================
// Generic File Operations
// ============================================================================

/**
 * Read an env file if it exists
 */
function readEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  return parseEnvString(content, { expand: false })
}

/**
 * Write an env file, creating directories as needed
 */
function writeEnvFile(filePath: string, vars: Record<string, string>): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const content = formatEnvFile(vars)
  fs.writeFileSync(filePath, content, 'utf-8')
  ensureLocalFilePermissions(filePath)
}

function ensureLocalFilePermissions(filePath: string): void {
  if (process.platform === 'win32') {
    return
  }

  try {
    fs.chmodSync(filePath, LOCAL_ENV_FILE_MODE)
  } catch {
    // Ignore permission failures to keep CLI behavior non-blocking.
  }
}

/**
 * Set a variable in an env file
 */
function setInFile(filePath: string, key: string, value: string): void {
  const vars = readEnvFile(filePath)
  vars[key] = value
  writeEnvFile(filePath, vars)
}

/**
 * Delete a variable from an env file
 * Returns true if deleted, false if not found
 */
function deleteFromFile(filePath: string, key: string): boolean {
  const vars = readEnvFile(filePath)
  if (!(key in vars)) {
    return false
  }
  delete vars[key]
  if (Object.keys(vars).length === 0) {
    // Remove empty file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } else {
    writeEnvFile(filePath, vars)
  }
  return true
}

/**
 * Validate local scope usage in monorepo mode.
 *
 * In monorepo mode, service-specific operations should always be explicit
 * unless the operation is targeting shared vars.
 */
export function validateLocalServiceScope(options: {
  config: VaulterConfig | null | undefined
  service?: string
  shared?: boolean
  command: string
}): { ok: true } | { ok: false; error: string; hint: string } {
  const { config, service, shared, command } = options

  if (!isMonorepoFromConfig(config)) {
    return { ok: true }
  }

  if (shared) {
    return { ok: true }
  }

  if (service) {
    return { ok: true }
  }

  const configuredService = config?.services?.[0]
  const sampleService = typeof configuredService === 'string'
    ? configuredService
    : configuredService?.name || 'api'

  return {
    ok: false,
    error: `${command} in monorepo mode requires a service.`,
    hint: `Use --service ${sampleService} (or run in --shared mode when the var is global).`
  }
}

// ============================================================================
// Local Shared Vars Operations
// ============================================================================

/**
 * Load local shared configs from .vaulter/local/configs.env
 */
export function loadLocalSharedConfigs(configDir: string): Record<string, string> {
  return readEnvFile(getSharedConfigPath(configDir))
}

/**
 * Load local shared secrets from .vaulter/local/secrets.env
 */
export function loadLocalSharedSecrets(configDir: string): Record<string, string> {
  return readEnvFile(getSharedSecretsPath(configDir))
}

/**
 * Load ALL local shared vars (configs + secrets merged)
 */
export function loadLocalShared(configDir: string): Record<string, string> {
  const configs = loadLocalSharedConfigs(configDir)
  const secrets = loadLocalSharedSecrets(configDir)
  return { ...configs, ...secrets }
}

/**
 * Set a local shared var (routes to config or secrets based on sensitive flag)
 */
export function setLocalShared(configDir: string, key: string, value: string, sensitive = false): void {
  if (sensitive) {
    setInFile(getSharedSecretsPath(configDir), key, value)
    // Also delete from config if exists (to avoid duplicates)
    deleteFromFile(getSharedConfigPath(configDir), key)
  } else {
    setInFile(getSharedConfigPath(configDir), key, value)
    // Also delete from secrets if exists (to avoid duplicates)
    deleteFromFile(getSharedSecretsPath(configDir), key)
  }
}

/**
 * Delete a local shared var (from both config and secrets)
 */
export function deleteLocalShared(configDir: string, key: string): boolean {
  const deletedConfig = deleteFromFile(getSharedConfigPath(configDir), key)
  const deletedSecrets = deleteFromFile(getSharedSecretsPath(configDir), key)
  return deletedConfig || deletedSecrets
}

// ============================================================================
// Service/Default Overrides Operations
// ============================================================================

/**
 * Load service configs
 * - Single repo: .vaulter/local/configs.env
 * - Monorepo: .vaulter/local/services/<svc>/configs.env
 */
export function loadServiceConfigs(configDir: string, service?: string): Record<string, string> {
  return readEnvFile(getServiceConfigPath(configDir, service))
}

/**
 * Load service secrets
 * - Single repo: .vaulter/local/secrets.env
 * - Monorepo: .vaulter/local/services/<svc>/secrets.env
 */
export function loadServiceSecrets(configDir: string, service?: string): Record<string, string> {
  return readEnvFile(getServiceSecretsPath(configDir, service))
}

/**
 * Load ALL overrides (configs + secrets merged)
 */
export function loadOverrides(configDir: string, service?: string): Record<string, string> {
  const configs = loadServiceConfigs(configDir, service)
  const secrets = loadServiceSecrets(configDir, service)
  return { ...configs, ...secrets }
}

/**
 * Set a single override (routes to config or secrets based on sensitive flag)
 */
export function setOverride(configDir: string, key: string, value: string, service?: string, sensitive = false): void {
  if (sensitive) {
    setInFile(getServiceSecretsPath(configDir, service), key, value)
    // Also delete from config if exists (to avoid duplicates)
    deleteFromFile(getServiceConfigPath(configDir, service), key)
  } else {
    setInFile(getServiceConfigPath(configDir, service), key, value)
    // Also delete from secrets if exists (to avoid duplicates)
    deleteFromFile(getServiceSecretsPath(configDir, service), key)
  }
}

/**
 * Delete a single override (from both config and secrets)
 */
export function deleteOverride(configDir: string, key: string, service?: string): boolean {
  const deletedConfig = deleteFromFile(getServiceConfigPath(configDir, service), key)
  const deletedSecrets = deleteFromFile(getServiceSecretsPath(configDir, service), key)
  return deletedConfig || deletedSecrets
}

/**
 * Reset (clear) all overrides for a service
 */
export function resetOverrides(configDir: string, service?: string): void {
  const configPath = getServiceConfigPath(configDir, service)
  const secretsPath = getServiceSecretsPath(configDir, service)
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath)
  if (fs.existsSync(secretsPath)) fs.unlinkSync(secretsPath)

  // Clean up empty service directory (only for monorepo, not single repo root)
  if (service) {
    const serviceDir = getServiceDir(configDir, service)
    if (fs.existsSync(serviceDir) && fs.readdirSync(serviceDir).length === 0) {
      fs.rmdirSync(serviceDir)
    }
  }
}

/**
 * Reset (clear) all shared vars
 */
export function resetShared(configDir: string): void {
  const configPath = getSharedConfigPath(configDir)
  const secretsPath = getSharedSecretsPath(configDir)
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath)
  if (fs.existsSync(secretsPath)) fs.unlinkSync(secretsPath)
}

// ============================================================================
// Merge Logic
// ============================================================================

/**
 * Merge base environment vars with local overrides
 * Overrides take precedence over base vars.
 */
export function mergeWithOverrides(
  baseVars: Record<string, string>,
  overrides: Record<string, string>
): Record<string, string> {
  return { ...baseVars, ...overrides }
}

/**
 * Full merge for local pull:
 * 1. Backend vars (base)
 * 2. Local shared vars (from .vaulter/local/configs.env + secrets.env)
 * 3. Service-specific overrides (from .vaulter/local/services/<svc>/)
 *
 * Priority: overrides > localShared > backend
 */
export function mergeAllLocalVars(
  backendVars: Record<string, string>,
  localShared: Record<string, string>,
  serviceOverrides: Record<string, string>
): Record<string, string> {
  return { ...backendVars, ...localShared, ...serviceOverrides }
}

// ============================================================================
// Diff
// ============================================================================

export interface LocalDiffResult {
  /** Keys that exist only in overrides (added locally) */
  added: string[]
  /** Keys that exist in both but with different values */
  modified: string[]
  /** Keys only in base (not overridden) */
  baseOnly: string[]
  /** Overrides map */
  overrides: Record<string, string>
  /** Base vars map */
  baseVars: Record<string, string>
}

/**
 * Diff overrides against base vars
 */
export function diffOverrides(
  baseVars: Record<string, string>,
  overrides: Record<string, string>
): LocalDiffResult {
  const added: string[] = []
  const modified: string[] = []

  for (const key of Object.keys(overrides)) {
    if (!(key in baseVars)) {
      added.push(key)
    } else if (baseVars[key] !== overrides[key]) {
      modified.push(key)
    }
  }

  const overrideKeys = new Set(Object.keys(overrides))
  const baseOnly = Object.keys(baseVars).filter(k => !overrideKeys.has(k))

  return { added, modified, baseOnly, overrides, baseVars }
}

// ============================================================================
// Status
// ============================================================================

export interface LocalStatusResult {
  // Shared vars info
  /** Path to shared directory */
  sharedPath: string
  sharedExist: boolean
  /** Total shared var count */
  sharedCount: number
  /** Shared config count */
  sharedConfigCount: number
  /** Shared secrets count */
  sharedSecretsCount: number

  // Service overrides info
  /** Path to service directory */
  overridesPath: string
  overridesExist: boolean
  /** Total overrides count */
  overridesCount: number
  /** Service config count */
  overridesConfigCount: number
  /** Service secrets count */
  overridesSecretsCount: number

  baseEnvironment: string
  snapshotsCount: number
}

/**
 * Get local status info
 */
export function getLocalStatus(
  configDir: string,
  config: VaulterConfig,
  service?: string
): LocalStatusResult {
  const baseEnvironment = resolveBaseEnvironment(config)
  const snapshotsCount = getSnapshotCount(configDir)

  const sharedConfigs = loadLocalSharedConfigs(configDir)
  const sharedSecrets = loadLocalSharedSecrets(configDir)
  const sharedConfigCount = Object.keys(sharedConfigs).length
  const sharedSecretsCount = Object.keys(sharedSecrets).length

  const serviceConfigs = loadServiceConfigs(configDir, service)
  const serviceSecrets = loadServiceSecrets(configDir, service)
  const overridesConfigCount = Object.keys(serviceConfigs).length
  const overridesSecretsCount = Object.keys(serviceSecrets).length

  return {
    sharedPath: getSharedDir(configDir),
    sharedExist: sharedConfigCount > 0 || sharedSecretsCount > 0,
    sharedCount: sharedConfigCount + sharedSecretsCount,
    sharedConfigCount,
    sharedSecretsCount,
    overridesPath: getServiceDir(configDir, service),
    overridesExist: overridesConfigCount > 0 || overridesSecretsCount > 0,
    overridesCount: overridesConfigCount + overridesSecretsCount,
    overridesConfigCount,
    overridesSecretsCount,
    baseEnvironment,
    snapshotsCount
  }
}

// ============================================================================
// Config Helpers
// ============================================================================

/**
 * Resolve the base environment from config
 */
export function resolveBaseEnvironment(config: VaulterConfig): string {
  return config.default_environment || 'dev'
}
