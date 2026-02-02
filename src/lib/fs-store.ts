/**
 * Vaulter Filesystem Store
 *
 * Simplified local file management for environment variables.
 *
 * Structure:
 * .vaulter/
 * ├── {env}/
 * │   ├── configs.env       # shared configs (non-sensitive)
 * │   ├── secrets.env       # shared secrets (sensitive)
 * │   └── services/
 * │       └── {service}/
 * │           ├── configs.env
 * │           └── secrets.env
 * └── config.yaml
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Environment } from '../types.js'

// =============================================================================
// Types
// =============================================================================

export interface EnvVar {
  key: string
  value: string
  sensitive: boolean
}

export interface LoadedVars {
  configs: Record<string, string>
  secrets: Record<string, string>
}

// =============================================================================
// Path Helpers
// =============================================================================

/**
 * Get the environment directory path
 */
export function getEnvDir(vaulterDir: string, env: Environment): string {
  return join(vaulterDir, env)
}

/**
 * Get the services directory for an environment
 */
export function getServicesDir(vaulterDir: string, env: Environment): string {
  return join(vaulterDir, env, 'services')
}

/**
 * Get a specific service directory
 */
export function getServiceDir(vaulterDir: string, env: Environment, service: string): string {
  return join(vaulterDir, env, 'services', service)
}

/**
 * Get configs.env path (shared or service)
 */
export function getConfigsPath(vaulterDir: string, env: Environment, service?: string): string {
  if (service) {
    return join(getServiceDir(vaulterDir, env, service), 'configs.env')
  }
  return join(getEnvDir(vaulterDir, env), 'configs.env')
}

/**
 * Get secrets.env path (shared or service)
 */
export function getSecretsPath(vaulterDir: string, env: Environment, service?: string): string {
  if (service) {
    return join(getServiceDir(vaulterDir, env, service), 'secrets.env')
  }
  return join(getEnvDir(vaulterDir, env), 'secrets.env')
}

// =============================================================================
// File Operations
// =============================================================================

/**
 * Parse a .env file into a key-value object
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {}
  }

  const content = readFileSync(filePath, 'utf-8')
  const result: Record<string, string> = {}

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    // Parse KEY=value
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (key) {
      result[key] = value
    }
  }

  return result
}

/**
 * Write a key-value object to a .env file
 */
export function writeEnvFile(filePath: string, vars: Record<string, string>): void {
  // Ensure directory exists
  mkdirSync(dirname(filePath), { recursive: true })

  const lines: string[] = []
  const sortedKeys = Object.keys(vars).sort()

  for (const key of sortedKeys) {
    const value = vars[key]

    // Quote if needed
    const needsQuotes =
      value.includes('\n') ||
      value.includes(' ') ||
      value.includes('#') ||
      value.includes('"') ||
      value.includes("'")

    if (needsQuotes) {
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
      lines.push(`${key}="${escaped}"`)
    } else {
      lines.push(`${key}=${value}`)
    }
  }

  writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8')
}

// =============================================================================
// Load Operations
// =============================================================================

/**
 * Load shared vars (configs + secrets) for an environment
 */
export function loadShared(vaulterDir: string, env: Environment): LoadedVars {
  return {
    configs: parseEnvFile(getConfigsPath(vaulterDir, env)),
    secrets: parseEnvFile(getSecretsPath(vaulterDir, env))
  }
}

/**
 * Load service-specific vars for an environment
 */
export function loadService(vaulterDir: string, env: Environment, service: string): LoadedVars {
  return {
    configs: parseEnvFile(getConfigsPath(vaulterDir, env, service)),
    secrets: parseEnvFile(getSecretsPath(vaulterDir, env, service))
  }
}

/**
 * Load merged vars for a service (shared + service-specific)
 * Service-specific vars override shared vars
 */
export function loadMerged(vaulterDir: string, env: Environment, service?: string): LoadedVars {
  const shared = loadShared(vaulterDir, env)

  if (!service) {
    return shared
  }

  const serviceVars = loadService(vaulterDir, env, service)

  return {
    configs: { ...shared.configs, ...serviceVars.configs },
    secrets: { ...shared.secrets, ...serviceVars.secrets }
  }
}

/**
 * Load all vars as a flat object (configs + secrets merged)
 */
export function loadFlat(vaulterDir: string, env: Environment, service?: string): Record<string, string> {
  const { configs, secrets } = loadMerged(vaulterDir, env, service)
  return { ...configs, ...secrets }
}

/**
 * Convert LoadedVars to EnvVar array
 */
export function toEnvVarArray(loaded: LoadedVars): EnvVar[] {
  const result: EnvVar[] = []

  for (const [key, value] of Object.entries(loaded.configs)) {
    result.push({ key, value, sensitive: false })
  }

  for (const [key, value] of Object.entries(loaded.secrets)) {
    result.push({ key, value, sensitive: true })
  }

  return result.sort((a, b) => a.key.localeCompare(b.key))
}

// =============================================================================
// Save Operations
// =============================================================================

/**
 * Save a variable to the appropriate file
 */
export function saveVar(
  vaulterDir: string,
  env: Environment,
  key: string,
  value: string,
  sensitive: boolean,
  service?: string
): void {
  const filePath = sensitive
    ? getSecretsPath(vaulterDir, env, service)
    : getConfigsPath(vaulterDir, env, service)

  const existing = parseEnvFile(filePath)
  existing[key] = value
  writeEnvFile(filePath, existing)
}

/**
 * Delete a variable from local files
 */
export function deleteVar(
  vaulterDir: string,
  env: Environment,
  key: string,
  service?: string
): boolean {
  let deleted = false

  // Try configs
  const configsPath = getConfigsPath(vaulterDir, env, service)
  if (existsSync(configsPath)) {
    const configs = parseEnvFile(configsPath)
    if (key in configs) {
      delete configs[key]
      writeEnvFile(configsPath, configs)
      deleted = true
    }
  }

  // Try secrets
  const secretsPath = getSecretsPath(vaulterDir, env, service)
  if (existsSync(secretsPath)) {
    const secrets = parseEnvFile(secretsPath)
    if (key in secrets) {
      delete secrets[key]
      writeEnvFile(secretsPath, secrets)
      deleted = true
    }
  }

  return deleted
}

// =============================================================================
// List Operations
// =============================================================================

/**
 * List all services in an environment
 */
export function listServices(vaulterDir: string, env: Environment): string[] {
  const servicesDir = getServicesDir(vaulterDir, env)

  if (!existsSync(servicesDir)) {
    return []
  }

  return readdirSync(servicesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
}

/**
 * List all environments
 */
export function listEnvironments(vaulterDir: string): string[] {
  if (!existsSync(vaulterDir)) {
    return []
  }

  return readdirSync(vaulterDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort()
}

// =============================================================================
// Init Operations
// =============================================================================

/**
 * Initialize environment directory structure
 */
export function initEnv(vaulterDir: string, env: Environment, services?: string[]): void {
  const envDir = getEnvDir(vaulterDir, env)

  // Create env dir
  mkdirSync(envDir, { recursive: true })

  // Create empty shared files
  const configsPath = getConfigsPath(vaulterDir, env)
  const secretsPath = getSecretsPath(vaulterDir, env)

  if (!existsSync(configsPath)) {
    writeFileSync(configsPath, '# Shared configs (non-sensitive)\n', 'utf-8')
  }

  if (!existsSync(secretsPath)) {
    writeFileSync(secretsPath, '# Shared secrets (sensitive)\n', 'utf-8')
  }

  // Create service dirs
  if (services) {
    for (const service of services) {
      const serviceDir = getServiceDir(vaulterDir, env, service)
      mkdirSync(serviceDir, { recursive: true })

      const svcConfigsPath = getConfigsPath(vaulterDir, env, service)
      const svcSecretsPath = getSecretsPath(vaulterDir, env, service)

      if (!existsSync(svcConfigsPath)) {
        writeFileSync(svcConfigsPath, `# ${service} configs\n`, 'utf-8')
      }

      if (!existsSync(svcSecretsPath)) {
        writeFileSync(svcSecretsPath, `# ${service} secrets\n`, 'utf-8')
      }
    }
  }
}
