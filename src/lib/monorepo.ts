/**
 * Monorepo Support
 *
 * Discovers services in monorepos and supports batch operations
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, findConfigDir } from './config-loader.js'
import type { VaulterConfig } from '../types.js'

const CONFIG_DIR = '.vaulter'
const CONFIG_FILE = 'config.yaml'
const MAX_DEPTH = 5

export interface ServiceInfo {
  name: string
  path: string
  configDir: string
  config: VaulterConfig
}

/**
 * Find all services in a monorepo
 * Searches for .vaulter directories in subdirectories
 */
export function discoverServices(rootDir: string = process.cwd()): ServiceInfo[] {
  const services: ServiceInfo[] = []
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

            services.push({
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
  return services.length > 1
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
