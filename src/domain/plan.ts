/**
 * Vaulter Plan Computation Engine
 *
 * Computes the diff between local state (.vaulter/local/) and backend state (s3db.js).
 * Generates Plan artifacts (JSON + Markdown) for review and apply.
 *
 * This is the core of the change → plan → apply workflow.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { VaulterClient } from '../client.js'
import type { VaulterConfig, EnvVar } from '../types.js'
import type {
  Plan,
  PlanChange,
  PlanSummary,
  Scope,
  ResolvedVariable
} from './types.js'
import {
  serviceScope,
  serviceToScope,
  scopeToService,
  scopesEqual,
  formatScope,
  emptyPlanSummary
} from './types.js'
import { readLocalState, listLocalServices } from './state.js'
import { checkGovernance } from './governance.js'
import { buildScorecard } from './scorecard.js'

// ============================================================================
// Plan Computation
// ============================================================================

export interface ComputePlanOptions {
  client: VaulterClient
  config: VaulterConfig | null
  configDir: string
  project: string
  environment: string
  /** Filter by scope (null = all scopes) */
  scope?: Scope | null
  /** Filter by service name (convenience — resolves to scope) */
  service?: string
  /** Whether to include delete actions for remote-only vars */
  prune?: boolean
}

/**
 * Compute a plan: diff local state vs backend state.
 *
 * Algorithm:
 * 1. Read local state from .vaulter/local/
 * 2. List backend vars for project+environment
 * 3. For each local var: find matching backend var by key+scope
 *    - Not found → action: 'add'
 *    - Found, values differ → action: 'update'
 *    - Found, values same → unchanged
 * 4. For each backend var not in local:
 *    - If prune → action: 'delete'
 *    - Otherwise → tracked in drift status (remote-only)
 */
export async function computePlan(options: ComputePlanOptions): Promise<Plan> {
  const {
    client,
    config,
    configDir,
    project,
    environment,
    scope: filterScope = null,
    service: filterService,
    prune = false
  } = options

  // Resolve scope filter
  const effectiveScope = filterScope ?? (filterService ? serviceScope(filterService) : null)

  // 1. Read local state
  const localVars = readLocalState(configDir, environment, {
    service: filterService,
    includeShared: effectiveScope ? effectiveScope.kind === 'shared' : true
  })

  // Filter by scope if specified and not already handled by readLocalState
  const filteredLocalVars = effectiveScope
    ? localVars.filter(v => scopesEqual(v.scope, effectiveScope))
    : localVars

  // 2. List backend vars
  const remoteVars = await listBackendVars(client, project, environment, effectiveScope)

  // 3. Compute changes
  const { changes, summary } = diffLocalVsRemote(filteredLocalVars, remoteVars, prune)

  // 4. Run governance checks
  const knownServices = listLocalServices(configDir)
  const governance = checkGovernance({
    variables: filteredLocalVars,
    config,
    environment,
    knownServices
  })

  // 5. Build scorecard
  const scorecard = buildScorecard({
    localVars: filteredLocalVars,
    remoteVars,
    changes,
    governance,
    config,
    environment,
    knownServices
  })

  // 6. Generate plan
  const now = new Date()
  const id = generatePlanId(project, environment, now)

  return {
    id,
    project,
    environment,
    scope: effectiveScope,
    status: 'planned',
    generatedAt: now.toISOString(),
    changes,
    summary,
    scorecard
  }
}

// ============================================================================
// Plan Artifact I/O
// ============================================================================

export interface PlanArtifactPaths {
  json: string
  markdown: string
}

/**
 * Write plan artifact to filesystem (JSON + Markdown).
 *
 * Sensitive values are masked in the persisted artifact.
 */
export function writePlanArtifact(
  plan: Plan,
  outputDir?: string
): PlanArtifactPaths {
  const dir = outputDir || path.resolve('artifacts', 'vaulter-plans')
  fs.mkdirSync(dir, { recursive: true })

  const safeId = plan.id.replace(/[^a-zA-Z0-9._-]/g, '-')
  const jsonPath = path.join(dir, `${safeId}.json`)
  const mdPath = path.join(dir, `${safeId}.md`)

  // Mask sensitive values before persisting
  const maskedPlan = maskPlanValues(plan)

  fs.writeFileSync(jsonPath, JSON.stringify(maskedPlan, null, 2) + '\n')
  fs.writeFileSync(mdPath, buildPlanMarkdown(maskedPlan) + '\n')

  return { json: jsonPath, markdown: mdPath }
}

/**
 * Read the most recent plan for an environment.
 */
export function readLatestPlan(
  environment: string,
  project: string,
  artifactDir?: string
): Plan | null {
  const dir = artifactDir || path.resolve('artifacts', 'vaulter-plans')
  if (!fs.existsSync(dir)) return null

  const prefix = `${sanitize(project)}-${sanitize(environment)}-`
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .reverse()

  if (files.length === 0) return null

  try {
    const content = fs.readFileSync(path.join(dir, files[0]), 'utf-8')
    return JSON.parse(content) as Plan
  } catch {
    return null
  }
}

/**
 * Resolve the artifact path for a specific plan id.
 */
export function getPlanArtifactPath(
  planId: string,
  artifactDir?: string
): string {
  const dir = artifactDir || path.resolve('artifacts', 'vaulter-plans')
  return path.join(dir, `${planId}.json`)
}

/**
 * Check if a plan is stale (local state changed since plan was generated).
 *
 * Compares the provenance.jsonl modification time against the plan generation time.
 * If provenance was updated after the plan, the plan is stale.
 */
export function isPlanStale(plan: Plan, configDir: string): boolean {
  const baseDir = configDir.endsWith(path.sep + '.vaulter')
    ? configDir
    : path.join(configDir, '.vaulter')
  const provenancePath = path.join(baseDir, 'local', 'provenance.jsonl')

  if (!fs.existsSync(provenancePath)) {
    // No provenance → no local changes → plan is not stale
    return false
  }

  const stat = fs.statSync(provenancePath)
  const planTime = new Date(plan.generatedAt).getTime()
  const provenanceTime = stat.mtimeMs

  return provenanceTime > planTime
}

// ============================================================================
// Diff Algorithm
// ============================================================================

interface DiffResult {
  changes: PlanChange[]
  summary: PlanSummary
}

/**
 * Diff local vars against remote vars.
 *
 * Key+scope is the unique identifier for matching.
 */
function diffLocalVsRemote(
  localVars: ResolvedVariable[],
  remoteVars: BackendVar[],
  prune: boolean
): DiffResult {
  const changes: PlanChange[] = []
  const summary: PlanSummary = emptyPlanSummary()

  // Build remote lookup: `key|scope` → BackendVar
  const remoteMap = new Map<string, BackendVar>()
  for (const rv of remoteVars) {
    remoteMap.set(varKey(rv.key, rv.scope), rv)
  }

  // Track which remote vars are matched
  const matchedRemoteKeys = new Set<string>()

  // Compare local → remote
  for (const local of localVars) {
    const lookupKey = varKey(local.key, local.scope)
    const remote = remoteMap.get(lookupKey)

    if (!remote) {
      // New variable — add to backend
      changes.push({
        key: local.key,
        scope: local.scope,
        action: 'add',
        sensitive: local.sensitive,
        localValue: local.value
      })
      summary.toAdd++
    } else {
      matchedRemoteKeys.add(lookupKey)

      if (local.value !== remote.value) {
        // Value differs — update
        changes.push({
          key: local.key,
          scope: local.scope,
          action: 'update',
          sensitive: local.sensitive,
          localValue: local.value,
          remoteValue: remote.value
        })
        summary.toUpdate++
      } else {
        // Same value — unchanged
        summary.unchanged++
      }
    }
  }

  // Check remote vars not in local
  for (const rv of remoteVars) {
    const lookupKey = varKey(rv.key, rv.scope)
    if (!matchedRemoteKeys.has(lookupKey)) {
      if (prune) {
        changes.push({
          key: rv.key,
          scope: rv.scope,
          action: 'delete',
          sensitive: rv.sensitive,
          remoteValue: rv.value
        })
        summary.toDelete++
      } else {
        // Remote-only — count in conflicts (drift)
        summary.conflicts++
      }
    }
  }

  return { changes, summary }
}

// ============================================================================
// Backend Var Abstraction
// ============================================================================

interface BackendVar {
  key: string
  value: string
  scope: Scope
  sensitive: boolean
}

/**
 * List backend vars, converting EnvVar to our normalized BackendVar.
 */
async function listBackendVars(
  client: VaulterClient,
  project: string,
  environment: string,
  scope: Scope | null
): Promise<BackendVar[]> {
  const service = scope ? scopeToService(scope) : undefined

  // If no scope filter, we need to list ALL vars for this project+environment
  // including shared and all services
  let envVars: EnvVar[]
  if (service !== undefined) {
    envVars = await client.list({ project, environment, service })
  } else {
    envVars = await client.list({ project, environment })
  }

  return envVars.map(ev => ({
    key: ev.key,
    value: ev.value,
    scope: serviceToScope(ev.service),
    sensitive: ev.sensitive ?? false
  }))
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a unique key for variable lookup: "key|shared" or "key|service:name"
 */
function varKey(key: string, scope: Scope): string {
  if (scope.kind === 'shared') return `${key}|shared`
  return `${key}|service:${scope.name}`
}

/**
 * Generate a deterministic plan ID: project-env-timestamp
 */
function generatePlanId(project: string, environment: string, date: Date): string {
  const ts = date.toISOString().replace(/[:.]/g, '-')
  return `${sanitize(project)}-${sanitize(environment)}-${ts}`
}

function sanitize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Mask sensitive values in a plan for artifact persistence.
 */
function maskPlanValues(plan: Plan): Plan {
  return {
    ...plan,
    changes: plan.changes.map(c => ({
      ...c,
      localValue: c.sensitive ? maskValue(c.localValue) : c.localValue,
      remoteValue: c.sensitive ? maskValue(c.remoteValue) : c.remoteValue
    }))
  }
}

function maskValue(value: string | undefined): string | undefined {
  if (!value) return value
  if (value.length <= 4) return '****'
  return value.slice(0, 2) + '****' + value.slice(-2)
}

/**
 * Build markdown representation of a plan.
 */
function buildPlanMarkdown(plan: Plan): string {
  const lines: string[] = []

  lines.push('# Vaulter Plan')
  lines.push('')
  lines.push(`- **ID:** ${plan.id}`)
  lines.push(`- **Project:** ${plan.project}`)
  lines.push(`- **Environment:** ${plan.environment}`)
  if (plan.scope) {
    lines.push(`- **Scope:** ${formatScope(plan.scope)}`)
  }
  lines.push(`- **Status:** ${plan.status}`)
  lines.push(`- **Generated:** ${plan.generatedAt}`)
  lines.push('')

  // Summary
  lines.push('## Summary')
  lines.push('')
  lines.push(`| Metric | Count |`)
  lines.push(`|--------|-------|`)
  lines.push(`| To add | ${plan.summary.toAdd} |`)
  lines.push(`| To update | ${plan.summary.toUpdate} |`)
  lines.push(`| To delete | ${plan.summary.toDelete} |`)
  lines.push(`| Unchanged | ${plan.summary.unchanged} |`)
  if (plan.summary.conflicts > 0) {
    lines.push(`| Remote-only (drift) | ${plan.summary.conflicts} |`)
  }
  lines.push('')

  // Changes
  if (plan.changes.length > 0) {
    lines.push('## Changes')
    lines.push('')
    for (const change of plan.changes) {
      const scopeLabel = formatScope(change.scope)
      const icon = change.action === 'add' ? '+' : change.action === 'delete' ? '-' : '~'
      const valuePart = change.action === 'delete'
        ? ''
        : change.localValue
          ? ` = ${change.localValue}`
          : ''
      lines.push(`- \`${icon}\` **${change.key}** (${scopeLabel})${valuePart}`)
    }
    lines.push('')
  }

  // Scorecard
  if (plan.scorecard.issues.length > 0) {
    lines.push('## Issues')
    lines.push('')
    for (const issue of plan.scorecard.issues) {
      const icon = issue.severity === 'error' ? '!!' : issue.severity === 'warning' ? '!' : 'i'
      lines.push(`- [${icon}] ${issue.message}`)
      if (issue.suggestion) {
        lines.push(`  → ${issue.suggestion}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}
