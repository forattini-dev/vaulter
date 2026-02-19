/**
 * Vaulter Scorecard Computation
 *
 * Aggregates governance, drift, and inventory data into a single
 * actionable Scorecard. Used by both `plan` and `status` commands.
 */

import type { VaulterConfig } from '../types.js'
import type {
  Scorecard,
  ScorecardHealth,
  ScorecardIssue,
  ServiceStatus,
  DriftStatus,
  ResolvedVariable,
  PlanChange,
  GovernanceResult,
  Scope
} from './types.js'
import { formatScope } from './types.js'

// ============================================================================
// Main Scorecard Builder
// ============================================================================

export interface BuildScorecardOptions {
  /** Variables from local state */
  localVars: ResolvedVariable[]
  /** Variables from backend (normalized to key+scope+value+sensitive) */
  remoteVars: Array<{ key: string; value: string; scope: Scope; sensitive: boolean }>
  /** Plan changes (from diffLocalVsRemote) */
  changes: PlanChange[]
  /** Governance check result */
  governance: GovernanceResult
  /** Project config */
  config: VaulterConfig | null
  /** Current environment */
  environment: string
  /** Known services */
  knownServices?: string[]
}

/**
 * Build a comprehensive scorecard from all available data.
 */
export function buildScorecard(options: BuildScorecardOptions): Scorecard {
  const {
    localVars,
    remoteVars,
    changes,
    governance,
    knownServices = []
  } = options

  // Count totals from local vars
  const totalVars = localVars.length
  const secrets = localVars.filter(v => v.sensitive).length
  const configs = totalVars - secrets

  // Build service status
  const services = buildServiceStatuses(localVars, knownServices)

  // Compute drift
  const drift = computeDrift(changes, remoteVars, localVars)

  // Collect issues
  const issues = collectIssues(governance, drift, services)

  // Determine health
  const health = determineHealth(issues, governance)

  return {
    totalVars,
    secrets,
    configs,
    services,
    drift,
    policy: governance.policy,
    required: governance.required,
    rotation: governance.rotation,
    health,
    issues
  }
}

// ============================================================================
// Service Status
// ============================================================================

function buildServiceStatuses(
  localVars: ResolvedVariable[],
  knownServices: string[]
): ServiceStatus[] {
  const serviceMap = new Map<string, { varCount: number; sharedCount: number; serviceCount: number }>()

  // Track shared count
  let sharedCount = 0
  for (const v of localVars) {
    if (v.scope.kind === 'shared') {
      sharedCount++
      continue
    }

    const name = v.scope.name
    const entry = serviceMap.get(name) || { varCount: 0, sharedCount: 0, serviceCount: 0 }
    entry.serviceCount++
    entry.varCount++
    serviceMap.set(name, entry)
  }

  // Add shared count to each service
  for (const entry of serviceMap.values()) {
    entry.sharedCount = sharedCount
    entry.varCount += sharedCount
  }

  // Include known services that have no local vars
  for (const name of knownServices) {
    if (!serviceMap.has(name)) {
      serviceMap.set(name, { varCount: sharedCount, sharedCount, serviceCount: 0 })
    }
  }

  // If there are only shared vars and no services, add a "shared" entry
  if (serviceMap.size === 0 && sharedCount > 0) {
    return [{
      name: 'shared',
      lifecycle: 'active',
      varCount: sharedCount,
      sharedCount,
      serviceCount: 0
    }]
  }

  const knownSet = new Set(knownServices)

  return Array.from(serviceMap.entries())
    .map(([name, stats]) => ({
      name,
      lifecycle: knownSet.size > 0 && !knownSet.has(name) ? 'orphan' as const : 'active' as const,
      varCount: stats.varCount,
      sharedCount: stats.sharedCount,
      serviceCount: stats.serviceCount
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ============================================================================
// Drift Computation
// ============================================================================

function computeDrift(
  changes: PlanChange[],
  remoteVars: Array<{ key: string; scope: Scope }>,
  localVars: ResolvedVariable[]
): DriftStatus {
  let localOnly = 0
  let remoteOnly = 0
  let conflicts = 0

  for (const change of changes) {
    switch (change.action) {
      case 'add':
        localOnly++
        break
      case 'delete':
        remoteOnly++
        break
      case 'update':
        conflicts++
        break
    }
  }

  // Count remote-only vars not in changes (those counted in summary.conflicts)
  // This accounts for remote vars not pruned
  const localKeySet = new Set(localVars.map(v => `${v.key}|${formatScope(v.scope)}`))
  for (const rv of remoteVars) {
    const key = `${rv.key}|${formatScope(rv.scope)}`
    if (!localKeySet.has(key)) {
      // Only count if not already counted by prune changes
      const alreadyCounted = changes.some(
        c => c.key === rv.key && c.action === 'delete'
      )
      if (!alreadyCounted) {
        remoteOnly++
      }
    }
  }

  const synced = localOnly === 0 && remoteOnly === 0 && conflicts === 0

  return { localOnly, remoteOnly, conflicts, synced }
}

// ============================================================================
// Issue Collection
// ============================================================================

function collectIssues(
  governance: GovernanceResult,
  drift: DriftStatus,
  services: ServiceStatus[]
): ScorecardIssue[] {
  const issues: ScorecardIssue[] = []

  // Drift issues
  if (!drift.synced) {
    if (drift.localOnly > 0) {
      issues.push({
        severity: 'info',
        category: 'drift',
        message: `${drift.localOnly} variable(s) exist locally but not in backend`,
        suggestion: 'Run `vaulter apply` to push local changes to backend'
      })
    }
    if (drift.remoteOnly > 0) {
      issues.push({
        severity: 'warning',
        category: 'drift',
        message: `${drift.remoteOnly} variable(s) exist in backend but not locally`,
        suggestion: 'Run `vaulter plan pull` to sync from backend, or `vaulter apply --prune` to remove'
      })
    }
    if (drift.conflicts > 0) {
      issues.push({
        severity: 'warning',
        category: 'drift',
        message: `${drift.conflicts} variable(s) have different values locally vs backend`,
        suggestion: 'Run `vaulter plan` to review changes before applying'
      })
    }
  }

  // Policy issues
  for (const pi of governance.policy.issues) {
    issues.push({
      severity: governance.blocked ? 'error' : 'warning',
      category: 'policy',
      message: pi.message,
      key: pi.key
    })
  }

  // Required vars
  if (governance.required.missing.length > 0) {
    for (const key of governance.required.missing) {
      issues.push({
        severity: 'error',
        category: 'required',
        message: `Required variable '${key}' is missing`,
        key,
        suggestion: `Add with: vaulter change set ${key}=<value>`
      })
    }
  }

  // Rotation
  if (governance.rotation.overdue > 0) {
    for (const rk of governance.rotation.keys) {
      issues.push({
        severity: 'warning',
        category: 'rotation',
        message: `'${rk.key}' is overdue for rotation (last: ${rk.lastRotated}, max: ${rk.maxAgeDays}d)`,
        key: rk.key,
        suggestion: `Rotate with: vaulter change rotate ${rk.key}`
      })
    }
  }

  // Orphan services
  for (const svc of services) {
    if (svc.lifecycle === 'orphan') {
      issues.push({
        severity: 'warning',
        category: 'orphan',
        message: `Service '${svc.name}' has ${svc.serviceCount} variable(s) but is not in known services`,
        suggestion: `Review and move/delete variables, or add '${svc.name}' to config services`
      })
    }
  }

  return issues
}

// ============================================================================
// Health Determination
// ============================================================================

function determineHealth(
  issues: ScorecardIssue[],
  governance: GovernanceResult
): ScorecardHealth {
  if (governance.blocked) return 'critical'

  const hasErrors = issues.some(i => i.severity === 'error')
  if (hasErrors) return 'critical'

  const hasWarnings = issues.some(i => i.severity === 'warning')
  if (hasWarnings) return 'warning'

  return 'ok'
}
