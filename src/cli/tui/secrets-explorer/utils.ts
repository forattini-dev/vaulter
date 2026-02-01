/**
 * Utility functions for Secrets Explorer
 */

import fs from 'node:fs'
import path from 'node:path'
import type { VaulterConfig } from '../../../types.js'
import type { DisplayVar } from './types.js'

// Import for internal use
import {
  getAllVarsFromEnvFile as _getAllVarsFromEnvFile
} from '../../../lib/env-parser.js'

// Re-export section-aware functions from shared library
export {
  parseEnvFileSections,
  writeEnvFileSections,
  syncVaulterSection,
  deleteFromEnvFile,
  setInEnvFile,
  getAllVarsFromEnvFile,
  getUserVarsFromEnvFile,
  VAULTER_SECTION_MARKER,
  VAULTER_SECTION_END,
  type EnvFileSections
} from '../../../lib/env-parser.js'

// ============================================================================
// Display Utilities
// ============================================================================

/**
 * Sort secrets by source priority (shared > override > service) then by key alphabetically
 */
export function sortSecrets(secrets: DisplayVar[]): DisplayVar[] {
  const sourcePriority: Record<string, number> = { shared: 0, override: 1, service: 2, local: 3 }
  return [...secrets].sort((a, b) => {
    const aPriority = sourcePriority[a.source] ?? 99
    const bPriority = sourcePriority[b.source] ?? 99
    if (aPriority !== bPriority) return aPriority - bPriority
    return a.key.localeCompare(b.key)
  })
}

/**
 * Semantic color type for badges
 */
export type BadgeColor = 'success' | 'warning' | 'error' | 'info' | 'accent' | 'primary'

/**
 * Environment color mapping - supports 10+ predefined environments
 * Production-like envs are red/error, dev-like are blue/info, etc.
 */
const ENV_COLOR_MAP: Record<string, BadgeColor> = {
  // Local development
  local: 'accent',

  // Development
  dev: 'info',
  development: 'info',

  // Staging/QA
  stg: 'warning',
  staging: 'warning',
  qa: 'warning',
  uat: 'warning',
  test: 'warning',
  testing: 'warning',

  // Sandbox/Preview
  sdx: 'primary',
  sbx: 'primary',
  sandbox: 'primary',
  preview: 'primary',
  demo: 'primary',

  // Pre-production
  preprod: 'success',
  'pre-prod': 'success',
  homolog: 'success',
  hml: 'success',

  // Production (danger!)
  prd: 'error',
  prod: 'error',
  production: 'error',
  live: 'error',

  // Disaster recovery
  dr: 'error',
  dry: 'error',
  'disaster-recovery': 'error',
}

/**
 * Fallback colors for unknown environments (cycled based on hash)
 */
const FALLBACK_COLORS: BadgeColor[] = ['info', 'primary', 'success', 'warning', 'accent']

/**
 * Simple string hash for consistent color assignment
 */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

/**
 * Get color for environment badge
 *
 * Supports 10+ predefined environments with semantic colors.
 * Unknown environments get a consistent color based on name hash.
 */
export function getEnvColor(env: string): BadgeColor {
  const normalized = env.toLowerCase()

  // Check predefined mapping
  if (normalized in ENV_COLOR_MAP) {
    return ENV_COLOR_MAP[normalized]
  }

  // Fallback: deterministic color based on hash (consistent per env name)
  const hash = hashString(normalized)
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}

/**
 * Get color for source badge
 */
export function getSourceColor(source: DisplayVar['source']): BadgeColor {
  switch (source) {
    case 'shared': return 'accent'
    case 'service': return 'info'
    case 'override': return 'warning'
    case 'local': return 'success'
    default: return 'info'
  }
}

/**
 * Mask a secret value for display
 * Shows start + mask + end for context
 */
export function maskValue(value: string, show: boolean): string {
  if (show) return value

  // For short values, just show asterisks
  if (value.length < 8) return '••••••'

  // Show first 6 chars + mask + last 4 chars
  const start = value.slice(0, 6)
  const end = value.slice(-4)
  const maskLen = Math.min(8, Math.max(4, value.length - 10))
  return `${start}${'•'.repeat(maskLen)}${end}`
}

/**
 * Format input display for modal (single line, fixed width)
 */
export function formatInput(val: string, maxLen: number, active: boolean): string {
  const display = val.length > maxLen ? val.substring(0, maxLen - 1) + '…' : val.padEnd(maxLen)
  const cursor = active ? '▌' : ''
  return display + cursor
}

// ============================================================================
// File Operations - Use shared library
// ============================================================================

// Section-aware functions are now imported from env-parser.ts at the top

/**
 * Find the .env file path for a service
 */
export function findEnvFilePath(config: VaulterConfig, serviceName: string | undefined, servicePath?: string): string | null {
  if (!serviceName) return null

  const envFiles = ['.env.local', '.env', '.env.development', '.env.dev']

  // Priority 1: Use servicePath directly (absolute path from discovery)
  if (servicePath && fs.existsSync(servicePath)) {
    for (const envFile of envFiles) {
      const fullPath = path.join(servicePath, envFile)
      if (fs.existsSync(fullPath)) return fullPath
    }
  }

  // Priority 2: Check outputs config
  const outputConfig = config.outputs?.[serviceName]
  if (outputConfig) {
    const outPath = typeof outputConfig === 'string' ? outputConfig : outputConfig.path
    const baseDir = path.join(process.cwd(), outPath)
    for (const envFile of envFiles) {
      const fullPath = path.join(baseDir, envFile)
      if (fs.existsSync(fullPath)) return fullPath
    }
  }

  // Priority 3: Try monorepo pattern
  if (config.monorepo?.services_pattern) {
    const baseDir = config.monorepo.services_pattern.replace('/*', '').replace('/**', '')
    for (const envFile of envFiles) {
      const fullPath = path.join(process.cwd(), baseDir, serviceName, envFile)
      if (fs.existsSync(fullPath)) return fullPath
    }
  }

  // Priority 4: Check fallback location (.vaulter/local/<service>.env)
  const fallbackPath = path.join(process.cwd(), '.vaulter', 'local', `${serviceName}.env`)
  if (fs.existsSync(fallbackPath)) return fallbackPath

  return null
}

/**
 * Get the .env file path for a given environment and service
 * For writes: creates a default path if file doesn't exist yet
 */
export function getEnvFilePathForAction(
  config: VaulterConfig,
  service: string | undefined,
  environment: string,
  servicePath?: string,
  createIfMissing = true
): string | null {
  if (environment !== 'local') return null

  if (!service || service === '[SHARED]') {
    // Unified structure: shared files at .vaulter/local/configs.env
    return path.join(process.cwd(), '.vaulter', 'local', 'configs.env')
  }

  // Try to find existing file first
  const existingPath = findEnvFilePath(config, service, servicePath)
  if (existingPath) return existingPath

  // If not found and createIfMissing, generate a default path
  if (createIfMissing) {
    // Priority 1: Use servicePath directly
    if (servicePath && fs.existsSync(servicePath)) {
      return path.join(servicePath, '.env.local')
    }

    // Priority 2: Check outputs config
    const outputConfig = config.outputs?.[service]
    if (outputConfig) {
      const outPath = typeof outputConfig === 'string' ? outputConfig : outputConfig.path
      return path.join(process.cwd(), outPath, '.env.local')
    }

    // Priority 3: Use monorepo pattern
    if (config.monorepo?.services_pattern) {
      const baseDir = config.monorepo.services_pattern.replace('/*', '').replace('/**', '')
      return path.join(process.cwd(), baseDir, service, '.env.local')
    }

    // Fallback: .vaulter/local/<service>.env
    return path.join(process.cwd(), '.vaulter', 'local', `${service}.env`)
  }

  return null
}

// ============================================================================
// Data Filtering
// ============================================================================

/**
 * Filter vars by service (local filtering, no network)
 */
export function filterVarsByService(allVars: DisplayVar[], serviceName: string | undefined): DisplayVar[] {
  const isShared = serviceName === '[SHARED]'

  if (isShared) {
    return allVars.filter(v => v.service === '__shared__' || !v.service)
  }

  // For specific service: merge shared + service-specific
  const sharedVars = allVars.filter(v => v.service === '__shared__' || !v.service)
  const serviceVars = allVars.filter(v => v.service === serviceName)

  // Merge: service-specific overrides shared
  const merged = new Map<string, DisplayVar>()

  for (const v of sharedVars) {
    merged.set(v.key, { ...v, source: 'shared' as const })
  }

  // Track which shared keys exist for override detection
  const sharedKeys = new Set(sharedVars.map(v => v.key))
  for (const v of serviceVars) {
    const source = sharedKeys.has(v.key) ? 'override' : 'service'
    merged.set(v.key, { ...v, source: source as DisplayVar['source'] })
  }

  return Array.from(merged.values())
}

/**
 * Convert Record<string, string> to DisplayVar array
 * This is the bridge between lib functions (which return plain objects)
 * and TUI display (which needs DisplayVar with source, sensitive, etc.)
 */
export function varsToDisplayVars(
  vars: Record<string, string>,
  source: DisplayVar['source'] = 'local'
): DisplayVar[] {
  const now = new Date()

  return Object.entries(vars).map(([key, value]) => ({
    id: `local:${key}`,
    key,
    value,
    project: 'local',
    environment: 'local',
    sensitive: false, // No inference - user must explicitly mark as sensitive
    createdAt: now,
    updatedAt: now,
    source,
  }))
}

/**
 * Parse a .env file and return DisplayVar array
 * Uses lib/env-parser.ts for actual parsing (lib first!)
 */
export function parseEnvFile(filePath: string, source: DisplayVar['source'] = 'local'): DisplayVar[] {
  // Use the lib function for parsing
  const vars = _getAllVarsFromEnvFile(filePath)
  // Convert to DisplayVar for TUI
  return varsToDisplayVars(vars, source)
}
