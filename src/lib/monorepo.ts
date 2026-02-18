/**
 * Monorepo Support
 *
 * Discovers services in monorepos and supports batch operations
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, findConfigDir } from './config-loader.js'
import type { VaulterConfig, ServiceConfig } from '../types.js'

const CONFIG_DIR = '.vaulter'
const CONFIG_FILE = 'config.yaml'
const MAX_DEPTH = 5

export interface ServiceInfo {
  name: string
  path: string
  configDir: string
  config: VaulterConfig
}

const DEFAULT_SERVICES_PATTERN = 'apps/*'

interface DiscoverServicesOptions {
  includeConfiguredServices?: boolean
}

/**
 * Find all services in a monorepo
 * Searches for .vaulter directories in subdirectories
 */
export function discoverServices(
  rootDir: string = process.cwd(),
  options: DiscoverServicesOptions = {}
): ServiceInfo[] {
  const { includeConfiguredServices = true } = options
  const discovered: ServiceInfo[] = []
  const visited = new Set<string>()

  function searchDir(dir: string, depth: number): void {
    if (depth > MAX_DEPTH) return

    const absoluteDir = path.resolve(dir)
    if (visited.has(absoluteDir)) return
    visited.add(absoluteDir)

    try {
      const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        // Skip common non-service directories
        if (shouldSkipDir(entry.name)) continue

        const subDir = path.join(absoluteDir, entry.name)

        // Check if this directory has a .vaulter config
        const configDir = path.join(subDir, CONFIG_DIR)
        const configFile = path.join(configDir, CONFIG_FILE)

        if (fs.existsSync(configFile)) {
          try {
            const config = loadConfig(subDir)
            const serviceName = config.service || entry.name

            discovered.push({
              name: serviceName,
              path: subDir,
              configDir,
              config
            })
          } catch (err) {
            // Skip invalid configs
          }
        }

        // Recurse into subdirectories
        searchDir(subDir, depth + 1)
      }
    } catch (err) {
      // Permission denied or other errors, skip
    }
  }

  // Start search from root
  searchDir(rootDir, 0)

  if (!includeConfiguredServices) {
    return discovered
  }

  try {
    const config = loadConfig(rootDir)
    const configured = discoverConfiguredServices(config, rootDir)
    return mergeServices(discovered, configured)
  } catch {
    return discovered
  }
}

/**
 * Discover services declared in config.services.
 *
 * Monorepo setups often model services in config only, without nested .vaulter dirs.
 * This keeps discovery consistent for teams that use config-driven service lists.
 */
export function discoverConfiguredServices(
  config: VaulterConfig,
  rootDir: string = process.cwd()
): ServiceInfo[] {
  if (!config.services || config.services.length === 0) return []

  const services: ServiceInfo[] = []
  const normalizedRoot = path.resolve(rootDir)
  const fallbackConfigDir = findConfigDir(normalizedRoot) || path.join(normalizedRoot, '.vaulter')
  const monorepoServicesPattern = config.monorepo?.services_pattern || DEFAULT_SERVICES_PATTERN

  const resolveServicePath = (serviceName: string, explicitPath?: string): string => {
    if (explicitPath && explicitPath.trim()) {
      return path.resolve(normalizedRoot, explicitPath)
    }

    const trimmedPattern = monorepoServicesPattern.trim()
    if (!trimmedPattern) {
      return path.resolve(normalizedRoot, DEFAULT_SERVICES_PATTERN.replace('*', serviceName))
    }

    const normalizedPattern = trimmedPattern.includes('*')
      ? trimmedPattern.replace(/\*/g, serviceName)
      : path.join(trimmedPattern, serviceName)

    return path.resolve(normalizedRoot, normalizedPattern)
  }

  for (const entry of config.services) {
    const serviceName = (typeof entry === 'string' ? entry : entry.name).trim()
    if (!serviceName) continue

    const servicePath = resolveServicePath(serviceName, (entry as ServiceConfig).path)
    const configDir = path.join(servicePath, '.vaulter')
    const configPath = path.join(configDir, 'config.yaml')
    let serviceConfig: VaulterConfig | null = null

    if (fs.existsSync(configPath)) {
      try {
        serviceConfig = loadConfig(servicePath)
      } catch {
        serviceConfig = null
      }
    }

    services.push({
      name: serviceName,
      path: servicePath,
      configDir: serviceConfig ? configDir : fallbackConfigDir,
      config: serviceConfig || {
        ...config,
        service: serviceName
      }
    })
  }

  return services
}

/**
 * Directories to skip during service discovery
 */
function shouldSkipDir(name: string): boolean {
  const skipPatterns = [
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    'dist',
    'build',
    'coverage',
    '.cache',
    '.next',
    '.nuxt',
    '.output',
    '__pycache__',
    'venv',
    '.venv',
    'vendor',
    'target',
    '.terraform',
    '.terragrunt-cache'
  ]

  return skipPatterns.includes(name) || name.startsWith('.')
}

/**
 * Filter services by name pattern
 * Supports comma-separated list and glob patterns
 */
export function filterServices(
  services: ServiceInfo[],
  pattern: string
): ServiceInfo[] {
  // Split by comma for multiple services
  const patterns = pattern.split(',').map(p => p.trim()).filter(Boolean)

  if (patterns.length === 0) {
    return services
  }

  return services.filter(service => {
    return patterns.some(p => {
      // Exact match
      if (p === service.name) return true

      // Glob-like matching (simple * support)
      if (p.includes('*')) {
        const regex = new RegExp(
          '^' + p.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
        )
        return regex.test(service.name)
      }

      return false
    })
  })
}

/**
 * Get the root config directory of a monorepo
 */
export function findMonorepoRoot(startDir: string = process.cwd()): string | null {
  let currentDir = path.resolve(startDir)
  let rootConfigDir: string | null = null

  // Get home directory to exclude global config
  const homeDir = process.env.HOME || process.env.USERPROFILE || ''

  // Walk up to find the topmost .vaulter directory (but not in home dir)
  while (true) {
    // Skip home directory - it contains global config, not project config
    if (currentDir === homeDir) {
      break
    }

    const configDir = path.join(currentDir, CONFIG_DIR)
    const configFile = path.join(configDir, CONFIG_FILE)

    if (fs.existsSync(configFile)) {
      // Verify it's a project config (has project field), not just global config
      try {
        const config = loadConfig(currentDir)
        if (config && config.project) {
          rootConfigDir = currentDir
        }
      } catch {
        // Invalid config, skip
      }
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      break
    }

    currentDir = parentDir
  }

  return rootConfigDir
}

/**
 * Check if current directory is inside a monorepo
 */
export function isMonorepo(startDir: string = process.cwd()): boolean {
  const root = findMonorepoRoot(startDir)
  if (!root) return false

  const services = discoverServices(root)
  if (services.length > 0) return true

  try {
    const config = loadConfig(root)
    return isMonorepoFromConfig(config)
  } catch {
    return false
  }
}

/**
 * Merge service lists while de-duplicating by service name.
 */
export function mergeServices(...serviceGroups: ServiceInfo[][]): ServiceInfo[] {
  const result: ServiceInfo[] = []
  const seen = new Set<string>()

  for (const services of serviceGroups) {
    for (const service of services) {
      if (seen.has(service.name)) {
        continue
      }
      seen.add(service.name)
      result.push(service)
    }
  }

  return result
}

/**
 * Build services list from outputs definitions when explicit service discovery
 * is unavailable (fallback for legacy/legacy-generated monorepos).
 */
export function discoverServicesFromOutputs(
  config: VaulterConfig,
  rootDir: string = process.cwd()
): ServiceInfo[] {
  if (!config.outputs) {
    return []
  }

  const normalizedRoot = path.resolve(rootDir)
  const fallbackConfigDir = findConfigDir(normalizedRoot) || path.join(normalizedRoot, '.vaulter')

  const services = new Map<string, string>()

  for (const [name, output] of Object.entries(config.outputs)) {
    const outputConfig = typeof output === 'object' ? output : null
    const serviceName = outputConfig?.service || name

    if (!serviceName || serviceName === '__shared__') {
      continue
    }

    let servicePath = path.resolve(normalizedRoot, outputConfig?.path || name)
    if (typeof output === 'string') {
      servicePath = path.resolve(normalizedRoot, output)
    } else if (outputConfig?.path) {
      servicePath = path.resolve(normalizedRoot, outputConfig.path)
    }

    services.set(serviceName, servicePath)
  }

  return Array.from(services.entries()).map(([serviceName, servicePath]) => ({
    name: serviceName,
    path: servicePath,
    configDir: fallbackConfigDir,
    config: {
      ...config,
      service: serviceName
    }
  }))
}

/**
 * Discover services using filesystem + config outputs fallback.
 *
 * Keeps monorepo service discovery behavior deterministic by always preferring
 * discovered per-service configs and falling back to config.outputs when discovery
 * is incomplete (legacy/output-driven monorepos).
 */
export function discoverServicesWithFallback(
  config: VaulterConfig,
  rootDir: string = process.cwd()
): ServiceInfo[] {
  const discoveredServices = discoverServices(rootDir, { includeConfiguredServices: true })
  if (discoveredServices.length > 0) {
    return discoveredServices
  }

  return discoverServicesFromOutputs(config, rootDir)
}

/**
 * Infer monorepo mode from configuration hints when service discovery is not enough.
 */
export function isMonorepoFromConfig(config: VaulterConfig | null | undefined): boolean {
  if (!config) return false

  const hasServices = Boolean(config?.services && config.services.length > 0)
  const hasMonorepoConfig = Boolean(config?.monorepo?.services_pattern || config?.monorepo?.root)
  const hasMonorepoDeploy = Boolean(config?.deploy?.services?.configs || config?.deploy?.services?.secrets)
  const hasMultipleOutputs = Boolean(config?.outputs && Object.keys(config.outputs).length > 1)

  return hasServices || hasMonorepoConfig || hasMonorepoDeploy || hasMultipleOutputs
}

/**
 * Get service info for current directory
 */
export function getCurrentService(startDir: string = process.cwd()): ServiceInfo | null {
  const configDir = findConfigDir(startDir)
  if (!configDir) return null

  const servicePath = path.dirname(configDir)

  try {
    const config = loadConfig(servicePath)
    return {
      name: config.service || path.basename(servicePath),
      path: servicePath,
      configDir,
      config
    }
  } catch {
    return null
  }
}

/**
 * Print service list for user display
 */
export function formatServiceList(services: ServiceInfo[]): string {
  if (services.length === 0) {
    return 'No services found'
  }

  const lines = ['Services found:']

  for (const service of services) {
    const relativePath = path.relative(process.cwd(), service.path)
    lines.push(`  • ${service.name} (${relativePath || '.'})`)
  }

  return lines.join('\n')
}
