/**
 * Vaulter Domain State Layer
 *
 * Single interface for reading and writing local variable state.
 * All mutations go through here, enforcing governance and recording provenance.
 *
 * Builds on existing lib/local.ts path helpers and env-parser.ts.
 * This module NEVER touches the backend — it is purely filesystem-based.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  loadLocalSharedConfigs,
  loadLocalSharedSecrets,
  loadServiceConfigs,
  loadServiceSecrets,
  setLocalShared,
  deleteLocalShared,
  setOverride,
  deleteOverride,
  getLocalDir,
  getServiceDir
} from '../lib/local.js'
import { detectUser } from '../lib/audit.js'
import type {
  Scope,
  ResolvedVariable,
  ProvenanceSource,
  ProvenanceOperation,
  WriteResult,
  MoveResult,
  ProvenanceLogEntry
} from './types.js'
import {
  sharedScope,
  serviceScope,
  serializeScope,
  formatScope
} from './types.js'

// ============================================================================
// Read Operations
// ============================================================================

/**
 * Read all variables from .vaulter/local/ for an environment.
 *
 * Returns ResolvedVariable[] with explicit scope and sensitivity.
 * Environment is informational here (local files are not per-env;
 * the environment is resolved at plan/apply time).
 */
export function readLocalState(
  configDir: string,
  environment: string,
  options?: {
    /** Filter by specific service (returns shared + that service) */
    service?: string
    /** Include shared vars (default: true) */
    includeShared?: boolean
  }
): ResolvedVariable[] {
  const includeShared = options?.includeShared !== false
  const variables: ResolvedVariable[] = []

  // 1. Shared vars
  if (includeShared) {
    const sharedConfigs = loadLocalSharedConfigs(configDir)
    const sharedSecrets = loadLocalSharedSecrets(configDir)

    for (const [key, value] of Object.entries(sharedConfigs)) {
      variables.push({
        key,
        value,
        environment,
        scope: sharedScope(),
        sensitive: false,
        lifecycle: 'active'
      })
    }

    for (const [key, value] of Object.entries(sharedSecrets)) {
      variables.push({
        key,
        value,
        environment,
        scope: sharedScope(),
        sensitive: true,
        lifecycle: 'active'
      })
    }
  }

  // 2. Service-specific vars
  if (options?.service) {
    // Single service requested
    appendServiceVars(configDir, environment, options.service, variables)
  } else {
    // All services
    const servicesDir = path.join(getLocalDir(configDir), 'services')
    if (fs.existsSync(servicesDir)) {
      const serviceDirs = fs.readdirSync(servicesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)

      for (const service of serviceDirs) {
        appendServiceVars(configDir, environment, service, variables)
      }
    }
  }

  return variables
}

function appendServiceVars(
  configDir: string,
  environment: string,
  service: string,
  out: ResolvedVariable[]
): void {
  const configs = loadServiceConfigs(configDir, service)
  const secrets = loadServiceSecrets(configDir, service)

  for (const [key, value] of Object.entries(configs)) {
    out.push({
      key,
      value,
      environment,
      scope: serviceScope(service),
      sensitive: false,
      lifecycle: 'active'
    })
  }

  for (const [key, value] of Object.entries(secrets)) {
    out.push({
      key,
      value,
      environment,
      scope: serviceScope(service),
      sensitive: true,
      lifecycle: 'active'
    })
  }
}

/**
 * List all services that have local state
 */
export function listLocalServices(configDir: string): string[] {
  const servicesDir = path.join(getLocalDir(configDir), 'services')
  if (!fs.existsSync(servicesDir)) return []

  return fs.readdirSync(servicesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
}

/**
 * Check if local state has any vars for a scope
 */
export function hasLocalState(configDir: string, scope: Scope): boolean {
  if (scope.kind === 'shared') {
    const configs = loadLocalSharedConfigs(configDir)
    const secrets = loadLocalSharedSecrets(configDir)
    return Object.keys(configs).length > 0 || Object.keys(secrets).length > 0
  }

  const serviceDir = getServiceDir(configDir, scope.name)
  if (!fs.existsSync(serviceDir)) return false

  const configs = loadServiceConfigs(configDir, scope.name)
  const secrets = loadServiceSecrets(configDir, scope.name)
  return Object.keys(configs).length > 0 || Object.keys(secrets).length > 0
}

// ============================================================================
// Write Operations
// ============================================================================

export interface WriteLocalVariableInput {
  key: string
  value: string
  scope: Scope
  sensitive: boolean
}

/**
 * Write a variable to .vaulter/local/.
 *
 * Routes to the correct file based on scope and sensitivity:
 * - shared + sensitive=false → .vaulter/local/configs.env
 * - shared + sensitive=true  → .vaulter/local/secrets.env
 * - service + sensitive=false → .vaulter/local/services/<name>/configs.env
 * - service + sensitive=true  → .vaulter/local/services/<name>/secrets.env
 *
 * Records provenance.
 */
export function writeLocalVariable(
  configDir: string,
  environment: string,
  variable: WriteLocalVariableInput,
  provenance: { source: ProvenanceSource; actor?: string }
): WriteResult {
  const { key, value, scope, sensitive } = variable

  if (scope.kind === 'shared') {
    setLocalShared(configDir, key, value, sensitive)
  } else {
    setOverride(configDir, key, value, scope.name, sensitive)
  }

  // Record provenance
  appendProvenance(configDir, {
    key,
    scope: serializeScope(scope),
    op: 'set',
    actor: provenance.actor || detectUser(),
    source: provenance.source,
    ts: new Date().toISOString(),
    environment,
    sensitive
  })

  const resolved: ResolvedVariable = {
    key,
    value,
    environment,
    scope,
    sensitive,
    lifecycle: 'active',
    provenance: {
      source: provenance.source,
      actor: provenance.actor || detectUser(),
      timestamp: new Date().toISOString(),
      operation: 'set'
    }
  }

  return {
    success: true,
    variable: resolved,
    warnings: [],
    blocked: false
  }
}

/**
 * Delete a variable from .vaulter/local/.
 */
export function deleteLocalVariable(
  configDir: string,
  environment: string,
  key: string,
  scope: Scope,
  provenance: { source: ProvenanceSource; actor?: string }
): boolean {
  let deleted: boolean

  if (scope.kind === 'shared') {
    deleted = deleteLocalShared(configDir, key)
  } else {
    deleted = deleteOverride(configDir, key, scope.name)
  }

  if (deleted) {
    appendProvenance(configDir, {
      key,
      scope: serializeScope(scope),
      op: 'delete',
      actor: provenance.actor || detectUser(),
      source: provenance.source,
      ts: new Date().toISOString(),
      environment
    })
  }

  return deleted
}

/**
 * Move a variable between scopes in .vaulter/local/.
 *
 * Reads the value from the source scope, writes to the target scope,
 * then deletes from the source.
 */
export function moveLocalVariable(
  configDir: string,
  environment: string,
  key: string,
  from: Scope,
  to: Scope,
  provenance: { source: ProvenanceSource; actor?: string },
  options?: { overwrite?: boolean; deleteOriginal?: boolean }
): MoveResult {
  const overwrite = options?.overwrite ?? true
  const deleteOriginal = options?.deleteOriginal ?? true

  // 1. Read from source
  const value = readVariableValue(configDir, key, from)
  if (value === null) {
    return {
      success: false,
      key,
      from,
      to,
      warnings: [`Variable '${key}' not found in ${formatScope(from)}`]
    }
  }

  // 2. Check target exists
  const targetExists = readVariableValue(configDir, key, to) !== null
  if (targetExists && !overwrite) {
    return {
      success: false,
      key,
      from,
      to,
      warnings: [`Variable '${key}' already exists in ${formatScope(to)}. Use overwrite=true.`]
    }
  }

  // 3. Determine sensitivity from source file
  const sensitive = isVariableSensitive(configDir, key, from)

  // 4. Write to target (if this fails, no change to source)
  try {
    writeToScope(configDir, key, value, to, sensitive)
  } catch (error) {
    return {
      success: false,
      key,
      from,
      to,
      warnings: [
        `Failed to write '${key}' to ${formatScope(to)}: ${error instanceof Error ? error.message : String(error)}`
      ]
    }
  }

  // 5. Delete from source only if deleteOriginal=true
  //    Roll back target write if delete fails, so this op remains atomic from UX perspective.
  if (deleteOriginal) {
    const deletedSource = from.kind === 'shared'
      ? deleteLocalShared(configDir, key)
      : deleteOverride(configDir, key, from.name)

    if (!deletedSource) {
      // Roll back by removing the copy we just created
      const removed = deleteFromScope(configDir, key, to, sensitive)
      if (!removed) {
        return {
          success: false,
          key,
          from,
          to,
          warnings: [
            `Moved '${key}' to ${formatScope(to)}, but failed to delete source (${formatScope(from)}). ` +
            `Rollback from ${formatScope(to)} also failed. Manual cleanup required.`
          ]
        }
      }

      return {
        success: false,
        key,
        from,
        to,
        warnings: [
          `Move blocked for '${key}': source (${formatScope(from)}) disappeared before deletion after copy succeeded. ` +
          `Roll back completed from ${formatScope(to)}; please retry.`
        ]
      }
    }
  }

  // 6. Record provenance
  appendProvenance(configDir, {
    key,
    scope: serializeScope(to),
    op: 'move',
    actor: provenance.actor || detectUser(),
    source: provenance.source,
    ts: new Date().toISOString(),
    environment,
    sensitive,
    fromScope: serializeScope(from)
  })

  return {
    success: true,
    key,
    from,
    to,
    warnings: []
  }
}

// ============================================================================ 
// Internal scope helpers
// ============================================================================

function writeToScope(
  configDir: string,
  key: string,
  value: string,
  scope: Scope,
  sensitive: boolean
): void {
  if (scope.kind === 'shared') {
    setLocalShared(configDir, key, value, sensitive)
  } else {
    setOverride(configDir, key, value, scope.name, sensitive)
  }
}

function deleteFromScope(
  configDir: string,
  key: string,
  scope: Scope,
  sensitive?: boolean
): boolean {
  if (scope.kind === 'shared') {
    return deleteLocalShared(configDir, key)
  }
  if (sensitive !== undefined) {
    // keep compatibility with call sites that only know scope+key
    const current = readVariableValue(configDir, key, scope)
    if (current === null) return false
  }
  return deleteOverride(configDir, key, scope.name)
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Read a single variable's value from local state
 */
function readVariableValue(configDir: string, key: string, scope: Scope): string | null {
  if (scope.kind === 'shared') {
    const configs = loadLocalSharedConfigs(configDir)
    if (key in configs) return configs[key]
    const secrets = loadLocalSharedSecrets(configDir)
    if (key in secrets) return secrets[key]
    return null
  }

  const configs = loadServiceConfigs(configDir, scope.name)
  if (key in configs) return configs[key]
  const secrets = loadServiceSecrets(configDir, scope.name)
  if (key in secrets) return secrets[key]
  return null
}

/**
 * Determine if a variable is stored as sensitive (in secrets.env) or not (configs.env)
 */
function isVariableSensitive(configDir: string, key: string, scope: Scope): boolean {
  if (scope.kind === 'shared') {
    const secrets = loadLocalSharedSecrets(configDir)
    return key in secrets
  }
  const secrets = loadServiceSecrets(configDir, scope.name)
  return key in secrets
}

// ============================================================================
// Provenance Log
// ============================================================================

const PROVENANCE_FILE = 'provenance.jsonl'

/**
 * Get the provenance log file path
 */
function getProvenancePath(configDir: string): string {
  return path.join(getLocalDir(configDir), PROVENANCE_FILE)
}

/**
 * Append a provenance entry to the log file
 */
function appendProvenance(configDir: string, entry: ProvenanceLogEntry): void {
  const logPath = getProvenancePath(configDir)
  const dir = path.dirname(logPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const line = JSON.stringify(entry) + '\n'
  fs.appendFileSync(logPath, line, 'utf-8')
}

/**
 * Read all provenance entries, optionally filtered.
 */
export function readProvenance(
  configDir: string,
  filter?: {
    key?: string
    scope?: string
    operation?: ProvenanceOperation
    since?: string
    limit?: number
  }
): ProvenanceLogEntry[] {
  const logPath = getProvenancePath(configDir)
  if (!fs.existsSync(logPath)) return []

  const content = fs.readFileSync(logPath, 'utf-8')
  const lines = content.split('\n').filter(l => l.trim())

  const parsedEntries = lines
    .map((line, index) => {
      try {
        return { entry: JSON.parse(line) as ProvenanceLogEntry, index }
      } catch {
        return null
      }
    })
    .filter((item): item is { entry: ProvenanceLogEntry; index: number } => item !== null)

  let entries: Array<{ entry: ProvenanceLogEntry; index: number }> = [...parsedEntries]

  // Apply filters
  if (filter?.key) {
    entries = entries.filter(e => e.entry.key === filter.key)
  }
  if (filter?.scope) {
    entries = entries.filter(e => e.entry.scope === filter.scope)
  }
  if (filter?.operation) {
    entries = entries.filter(e => e.entry.op === filter.operation)
  }
  if (filter?.since) {
    entries = entries.filter(e => e.entry.ts >= filter.since!)
  }

  // Sort by timestamp descending (most recent first),
  // tie-break by file order so later lines win when timestamps are equal.
  entries.sort((a, b) => {
    const byTime = b.entry.ts.localeCompare(a.entry.ts)
    if (byTime !== 0) return byTime
    return b.index - a.index
  })

  if (filter?.limit && filter.limit > 0) {
    entries = entries.slice(0, filter.limit)
  }

  return entries.map(item => item.entry)
}

/**
 * Get the number of provenance entries
 */
export function getProvenanceCount(configDir: string): number {
  const logPath = getProvenancePath(configDir)
  if (!fs.existsSync(logPath)) return 0

  const content = fs.readFileSync(logPath, 'utf-8')
  return content.split('\n').filter(l => l.trim()).length
}
