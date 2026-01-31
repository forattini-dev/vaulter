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
import type { VaulterConfig } from '../types.js'

// ============================================================================
// Constants
// ============================================================================

const OVERRIDES_FILE = 'overrides.env'
const SHARED_FILE = 'shared.env'

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
 * Get the shared.env file path
 * Contains local variables shared across ALL services in monorepo
 */
export function getSharedPath(configDir: string): string {
  return path.join(getLocalDir(configDir), SHARED_FILE)
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
// Local Shared Vars Operations
// ============================================================================

/**
 * Load local shared vars from .vaulter/local/shared.env
 * These are LOCAL variables shared across all services (not from backend)
 */
export function loadLocalShared(configDir: string): Record<string, string> {
  const filePath = getSharedPath(configDir)
  if (!fs.existsSync(filePath)) {
    return {}
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  return parseEnvString(content, { expand: false })
}

/**
 * Save local shared vars to .vaulter/local/shared.env
 */
export function saveLocalShared(configDir: string, vars: Record<string, string>): void {
  const filePath = getSharedPath(configDir)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const content = formatEnvFile(vars)
  fs.writeFileSync(filePath, content, 'utf-8')
}

/**
 * Set a local shared var
 */
export function setLocalShared(configDir: string, key: string, value: string): void {
  const vars = loadLocalShared(configDir)
  vars[key] = value
  saveLocalShared(configDir, vars)
}

/**
 * Delete a local shared var
 */
export function deleteLocalShared(configDir: string, key: string): boolean {
  const vars = loadLocalShared(configDir)
  if (!(key in vars)) {
    return false
  }
  delete vars[key]
  saveLocalShared(configDir, vars)
  return true
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

/**
 * Full merge for local pull:
 * 1. Backend vars (base)
 * 2. Local shared vars (from .vaulter/local/shared.env)
 * 3. Service-specific overrides (from .vaulter/local/overrides.<service>.env)
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
  /** Path to shared.env */
  sharedPath: string
  sharedExist: boolean
  sharedCount: number
  /** Path to overrides file */
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
  const sharedPath = getSharedPath(configDir)
  const sharedExist = fs.existsSync(sharedPath)
  const localShared = sharedExist ? loadLocalShared(configDir) : {}

  const overridesPath = getOverridesPath(configDir, service)
  const overridesExist = fs.existsSync(overridesPath)
  const overrides = overridesExist ? loadOverrides(configDir, service) : {}
  const baseEnvironment = resolveBaseEnvironment(config)
  const snapshotsCount = getSnapshotCount(configDir)

  return {
    sharedPath,
    sharedExist,
    sharedCount: Object.keys(localShared).length,
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
