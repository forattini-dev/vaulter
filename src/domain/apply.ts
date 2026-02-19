/**
 * Vaulter Plan Execution Engine
 *
 * Executes a Plan by pushing changes to the backend via VaulterClient.
 * Handles add, update, and delete actions with error tracking.
 */

import fs from 'node:fs'
import type { VaulterClient } from '../client.js'
import type { VaulterConfig } from '../types.js'
import type { Plan, PlanChange } from './types.js'
import { scopeToService } from './types.js'

// ============================================================================
// Types
// ============================================================================

export interface ExecutePlanOptions {
  client: VaulterClient
  plan: Plan
  config: VaulterConfig | null
  project: string
  /** Required for production environments */
  force?: boolean
  /** Show what would be applied without actually applying */
  dryRun?: boolean
}

export interface ApplyResult {
  success: boolean
  applied: number
  failed: number
  skipped: number
  errors: Array<{ key: string; error: string }>
  /** Updated plan with final status */
  updatedPlan: Plan
}

// ============================================================================
// Plan Execution
// ============================================================================

/**
 * Execute a plan: push changes to backend.
 *
 * Processes each change in the plan sequentially:
 * - 'add' → client.set (insert new variable)
 * - 'update' → client.set (update existing variable)
 * - 'delete' → client.delete (remove variable)
 *
 * Returns an ApplyResult with counts and any errors.
 */
export async function executePlan(options: ExecutePlanOptions): Promise<ApplyResult> {
  const { client, plan, project, force = false, dryRun = false } = options

  // Safety: require --force for production
  if (isProductionEnv(plan.environment) && !force) {
    return {
      success: false,
      applied: 0,
      failed: 0,
      skipped: plan.changes.length,
      errors: [{
        key: '*',
        error: `Production environment '${plan.environment}' requires --force flag`
      }],
      updatedPlan: { ...plan, status: 'failed' }
    }
  }

  // Skip if no changes
  if (plan.changes.length === 0) {
    return {
      success: true,
      applied: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      updatedPlan: { ...plan, status: 'applied', appliedAt: new Date().toISOString() }
    }
  }

  // Dry run — return without executing
  if (dryRun) {
    return {
      success: true,
      applied: 0,
      failed: 0,
      skipped: plan.changes.length,
      errors: [],
      updatedPlan: { ...plan, status: 'planned' }
    }
  }

  // Execute changes
  let applied = 0
  let failed = 0
  const errors: Array<{ key: string; error: string }> = []

  for (const change of plan.changes) {
    try {
      await applyChange(client, change, project, plan.environment)
      applied++
    } catch (err) {
      failed++
      errors.push({
        key: change.key,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const success = failed === 0
  const status = success ? 'applied' as const : 'failed' as const

  return {
    success,
    applied,
    failed,
    skipped: 0,
    errors,
    updatedPlan: {
      ...plan,
      status,
      appliedAt: new Date().toISOString()
    }
  }
}

// ============================================================================
// Individual Change Application
// ============================================================================

async function applyChange(
  client: VaulterClient,
  change: PlanChange,
  project: string,
  environment: string
): Promise<void> {
  const service = scopeToService(change.scope)
  // Map __shared__ back to undefined for the client API
  const clientService = service === '__shared__' ? undefined : service

  switch (change.action) {
    case 'add':
    case 'update': {
      if (!change.localValue) {
        throw new Error(`No local value for ${change.action} action on '${change.key}'`)
      }
      await client.set({
        key: change.key,
        value: change.localValue,
        project,
        environment,
        service: clientService,
        sensitive: change.sensitive,
        metadata: {
          source: 'sync'
        }
      })
      break
    }

    case 'delete': {
      await client.delete(change.key, project, environment, clientService)
      break
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

const PRODUCTION_ENVS = new Set(['prd', 'prod', 'production'])

function isProductionEnv(environment: string): boolean {
  return PRODUCTION_ENVS.has(environment.toLowerCase())
}

/**
 * Update a plan artifact on disk after apply.
 */
export function updatePlanArtifact(planPath: string, plan: Plan): void {
  if (!fs.existsSync(planPath)) return

  try {
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n')
  } catch {
    // Best effort — don't fail apply if artifact update fails
  }
}
