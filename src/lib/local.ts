/**
 * Vaulter - Local Overrides & Snapshots
 *
 * Local overrides are plaintext, gitignored files that layer on top of
 * a base environment (fetched from the backend). They never touch the backend.
 *
 * Snapshots are timestamped backups of an environment's variables.
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseEnvString } from './env-parser.js'
import { formatEnvFile } from './outputs.js'
import { getSnapshotCount } from './snapshot.js'
import type { VaulterConfig, Environment } from '../types.js'

// ============================================================================
// Constants
// ============================================================================

const OVERRIDES_FILE = 'overrides.env'

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
 * Get the overrides file path
 * - Single repo: .vaulter/local/overrides.env
 * - Monorepo: .vaulter/local/overrides.<service>.env
 */
export function getOverridesPath(configDir: string, service?: string): string {
  const localDir = getLocalDir(configDir)
  if (service) {
    return path.join(localDir, `overrides.${service}.env`)
  }
  return path.join(localDir, OVERRIDES_FILE)
}

// ============================================================================
// Overrides Operations
// ============================================================================

/**
 * Load overrides from the local file
 */
export function loadOverrides(configDir: string, service?: string): Record<string, string> {
  const filePath = getOverridesPath(configDir, service)
  if (!fs.existsSync(filePath)) {
    return {}
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  return parseEnvString(content, { expand: false })
}

/**
 * Save overrides to the local file
 */
export function saveOverrides(configDir: string, overrides: Record<string, string>, service?: string): void {
  const filePath = getOverridesPath(configDir, service)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const content = formatEnvFile(overrides)
  fs.writeFileSync(filePath, content, 'utf-8')
}

/**
 * Set a single override (adds or updates)
 */
export function setOverride(configDir: string, key: string, value: string, service?: string): void {
  const overrides = loadOverrides(configDir, service)
  overrides[key] = value
  saveOverrides(configDir, overrides, service)
}

/**
 * Delete a single override
 */
export function deleteOverride(configDir: string, key: string, service?: string): boolean {
  const overrides = loadOverrides(configDir, service)
  if (!(key in overrides)) {
    return false
  }
  delete overrides[key]
  saveOverrides(configDir, overrides, service)
  return true
}

/**
 * Reset (clear) all overrides
 */
export function resetOverrides(configDir: string, service?: string): void {
  const filePath = getOverridesPath(configDir, service)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
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
  overridesPath: string
  overridesExist: boolean
  overridesCount: number
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
  const overridesPath = getOverridesPath(configDir, service)
  const overridesExist = fs.existsSync(overridesPath)
  const overrides = overridesExist ? loadOverrides(configDir, service) : {}
  const baseEnvironment = resolveBaseEnvironment(config)
  const snapshotsCount = getSnapshotCount(configDir)

  return {
    overridesPath,
    overridesExist,
    overridesCount: Object.keys(overrides).length,
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

