/**
 * Vaulter Inventory + Orphan Detection
 *
 * Builds a full cross-environment variable inventory.
 * Detects orphaned variables, missing vars, and coverage gaps.
 *
 * Used by `vaulter status inventory` and `vaulter status drift`.
 */

import type { VaulterClient } from '../client.js'
import type { VaulterConfig, EnvVar } from '../types.js'
import type {
  Inventory,
  InventoryService,
  OrphanedVariable,
  MissingVariable,
  CoverageEntry,
  Scope,
  Lifecycle
} from './types.js'
import { serviceToScope, formatScope } from './types.js'

// ============================================================================
// Types
// ============================================================================

export interface BuildInventoryOptions {
  client: VaulterClient
  config: VaulterConfig | null
  project: string
  environments: string[]
  /** Known services (from config or monorepo detection) */
  knownServices?: string[]
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Build full inventory of variables across environments.
 *
 * Fetches all variables from each environment, then computes:
 * - Per-service summaries
 * - Orphaned variables (vars for unknown services)
 * - Missing variables (vars in env A but not env B)
 * - Coverage matrix (which vars exist in which envs)
 */
export async function buildInventory(options: BuildInventoryOptions): Promise<Inventory> {
  const { client, project, environments, knownServices = [] } = options

  // Fetch all vars across all environments
  const envVarMap = new Map<string, EnvVar[]>()
  for (const env of environments) {
    const vars = await client.list({ project, environment: env })
    envVarMap.set(env, vars)
  }

  const services = buildServiceInventory(envVarMap, environments, knownServices)
  const orphanedVars = detectOrphans(envVarMap, knownServices)
  const missingVars = detectMissing(envVarMap, environments)
  const coverageMatrix = buildCoverageMatrix(envVarMap, environments)

  return { services, orphanedVars, missingVars, coverageMatrix }
}

// ============================================================================
// Service Inventory
// ============================================================================

function buildServiceInventory(
  envVarMap: Map<string, EnvVar[]>,
  _environments: string[],
  knownServices: string[]
): InventoryService[] {
  const serviceMap = new Map<string, { envs: Set<string>; varCount: number }>()

  for (const [env, vars] of envVarMap) {
    for (const v of vars) {
      const svcName = v.service && v.service !== '__shared__' ? v.service : '__shared__'
      const entry = serviceMap.get(svcName) || { envs: new Set<string>(), varCount: 0 }
      entry.envs.add(env)
      entry.varCount++
      serviceMap.set(svcName, entry)
    }
  }

  // Include known services that have no vars
  for (const name of knownServices) {
    if (!serviceMap.has(name)) {
      serviceMap.set(name, { envs: new Set(), varCount: 0 })
    }
  }

  const knownSet = new Set(knownServices)

  return Array.from(serviceMap.entries())
    .map(([name, stats]) => {
      let lifecycle: Lifecycle = 'active'
      if (name !== '__shared__' && knownSet.size > 0 && !knownSet.has(name)) {
        lifecycle = 'orphan'
      }

      return {
        name: name === '__shared__' ? 'shared' : name,
        lifecycle,
        environments: Array.from(stats.envs).sort(),
        varCount: stats.varCount
      }
    })
    .sort((a, b) => {
      // shared first, then alphabetical
      if (a.name === 'shared') return -1
      if (b.name === 'shared') return 1
      return a.name.localeCompare(b.name)
    })
}

// ============================================================================
// Orphan Detection
// ============================================================================

/**
 * Detect variables that belong to unknown/removed services.
 */
function detectOrphans(
  envVarMap: Map<string, EnvVar[]>,
  knownServices: string[]
): OrphanedVariable[] {
  if (knownServices.length === 0) return []

  const knownSet = new Set(knownServices)
  const orphans: OrphanedVariable[] = []

  for (const [env, vars] of envVarMap) {
    for (const v of vars) {
      const svcName = v.service
      if (svcName && svcName !== '__shared__' && !knownSet.has(svcName)) {
        orphans.push({
          key: v.key,
          environment: env,
          scope: serviceToScope(svcName),
          reason: 'unknown_service',
          suggestion: 'investigate'
        })
      }
    }
  }

  return orphans
}

// ============================================================================
// Missing Variable Detection
// ============================================================================

/**
 * Find variables that exist in some environments but not others.
 *
 * Only considers variables that appear in at least 2 environments
 * but are missing from at least 1.
 */
function detectMissing(
  envVarMap: Map<string, EnvVar[]>,
  environments: string[]
): MissingVariable[] {
  if (environments.length < 2) return []

  // Build a map: varIdentity → set of environments
  const varEnvs = new Map<string, { scope: Scope; key: string; envs: Set<string> }>()

  for (const [env, vars] of envVarMap) {
    for (const v of vars) {
      const scope = serviceToScope(v.service)
      const identity = `${v.key}|${formatScope(scope)}`

      const entry = varEnvs.get(identity) || { scope, key: v.key, envs: new Set<string>() }
      entry.envs.add(env)
      varEnvs.set(identity, entry)
    }
  }

  const missing: MissingVariable[] = []
  for (const entry of varEnvs.values()) {
    if (entry.envs.size > 0 && entry.envs.size < environments.length) {
      const presentIn = Array.from(entry.envs).sort()
      const missingFrom = environments.filter(e => !entry.envs.has(e)).sort()

      if (missingFrom.length > 0) {
        missing.push({
          key: entry.key,
          scope: entry.scope,
          presentIn,
          missingFrom
        })
      }
    }
  }

  return missing.sort((a, b) => a.key.localeCompare(b.key))
}

// ============================================================================
// Coverage Matrix
// ============================================================================

/**
 * Build a matrix of which variables exist in which environments.
 */
function buildCoverageMatrix(
  envVarMap: Map<string, EnvVar[]>,
  environments: string[]
): CoverageEntry[] {
  const matrix = new Map<string, { key: string; scope: Scope; envs: Record<string, boolean> }>()

  for (const [env, vars] of envVarMap) {
    for (const v of vars) {
      const scope = serviceToScope(v.service)
      const identity = `${v.key}|${formatScope(scope)}`

      if (!matrix.has(identity)) {
        const envRecord: Record<string, boolean> = {}
        for (const e of environments) envRecord[e] = false
        matrix.set(identity, { key: v.key, scope, envs: envRecord })
      }

      matrix.get(identity)!.envs[env] = true
    }
  }

  return Array.from(matrix.values())
    .map(entry => ({
      key: entry.key,
      scope: entry.scope,
      environments: entry.envs
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
}
