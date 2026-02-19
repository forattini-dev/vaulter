/**
 * Vaulter `apply` Command
 *
 * Executes the last plan, pushing changes to the backend.
 * If no plan exists or plan is stale, auto-plans first.
 *
 * Usage:
 *   vaulter apply -e dev                  Apply latest plan (auto-plan if needed)
 *   vaulter apply -e prd --force          Apply to production (requires --force)
 *   vaulter apply -e dev --dry-run        Show what would be applied
 *   vaulter apply -e dev --prune          Include remote-only deletions
 */

import path from 'node:path'
import type { VarContext } from './change.js'
import { findConfigDir } from '../../lib/config-loader.js'
import { withClient } from '../lib/create-client.js'
import { computePlan, readLatestPlan, isPlanStale, writePlanArtifact } from '../../domain/plan.js'
import { executePlan, updatePlanArtifact } from '../../domain/apply.js'
import type { Plan, ApplyResult } from '../../domain/index.js'
import { parseScope, formatScope } from '../../domain/types.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import * as ui from '../ui.js'

// ============================================================================
// Apply Command
// ============================================================================

export async function runApply(context: VarContext): Promise<void> {
  const { args, config, project, environment, service, verbose, jsonOutput, dryRun } = context

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('No .vaulter directory found. Run "vaulter init" first.')
    process.exit(1)
  }
  const force = Boolean(args.force)
  const prune = Boolean(args.prune)
  const scopeRaw = args.scope as string | undefined
  const scope = scopeRaw ? parseScope(scopeRaw) : (service ? parseScope(service) : null)

  await withClient(
    { args, config, project, environment, verbose },
    async (client) => {
      // 1. Try to read existing plan
      const artifactDir = resolveArtifactDir(config)
      let plan = readLatestPlan(environment, project, artifactDir)

      // 2. Auto-plan if needed
      if (!plan || isPlanStale(plan, configDir)) {
        const reason = !plan ? 'No existing plan found' : 'Plan is stale (local changes detected)'
        ui.log(`${symbols.info} ${reason} — computing plan...`)

        plan = await computePlan({
          client,
          config,
          configDir,
          project,
          environment,
          scope,
          service,
          prune
        })

        // Write artifact
        if (artifactDir) {
          writePlanArtifact(plan, artifactDir)
        }
      }

      // 3. Show summary
      const total = plan.changes.length
      if (total === 0) {
        ui.log(`${symbols.success} Nothing to apply — local and backend are in sync.`)
        if (jsonOutput) {
          ui.output(JSON.stringify({ success: true, applied: 0, failed: 0, skipped: 0, errors: [] }))
        }
        return
      }

      ui.log(`${symbols.info} Plan: ${c.success(`+${plan.summary.toAdd}`)} ${c.warning(`~${plan.summary.toUpdate}`)} ${c.error(`-${plan.summary.toDelete}`)} (${total} change${total !== 1 ? 's' : ''})`)

      if (dryRun) {
        ui.log(`${c.muted('[dry-run]')} Would apply ${total} change(s) to ${colorEnv(environment)}`)
        displayChangeSummary(plan)
        if (jsonOutput) {
          ui.output(JSON.stringify({ success: true, applied: 0, failed: 0, skipped: total, errors: [], dryRun: true }))
        }
        return
      }

      // 4. Execute
      ui.log(`${symbols.info} Applying to ${colorEnv(environment)}...`)

      const result = await executePlan({
        client,
        plan,
        config,
        project,
        force,
        dryRun: false
      })

      // 5. Update artifact on disk
      if (artifactDir) {
        const planJsonPath = path.join(
          artifactDir,
          `${result.updatedPlan.id.replace(/[^a-zA-Z0-9._-]/g, '-')}.json`
        )
        updatePlanArtifact(planJsonPath, result.updatedPlan)
      }

      // 6. Display result
      if (jsonOutput) {
        ui.output(JSON.stringify({
          success: result.success,
          applied: result.applied,
          failed: result.failed,
          skipped: result.skipped,
          errors: result.errors
        }))
        return
      }

      displayResult(result, environment)
    }
  )
}

// ============================================================================
// Display
// ============================================================================

function displayChangeSummary(plan: Plan): void {
  for (const change of plan.changes) {
    const scopeLabel = c.muted(`(${formatScope(change.scope)})`)
    const action = change.action === 'add'
      ? c.success('+')
      : change.action === 'update'
        ? c.warning('~')
        : c.error('-')
    ui.log(`  ${action} ${change.key} ${scopeLabel}`)
  }
}

function displayResult(result: ApplyResult, environment: string): void {
  if (result.success) {
    ui.log(`${symbols.success} Applied ${result.applied} change(s) to ${colorEnv(environment)}`)
  } else {
    ui.log(`${symbols.error} Apply failed: ${result.applied} applied, ${result.failed} failed`)
    for (const err of result.errors) {
      ui.log(`  ${c.error('!')} ${err.key}: ${err.error}`)
    }
    process.exitCode = 1
  }
}

// ============================================================================
// Helpers
// ============================================================================

function resolveArtifactDir(config: import('../../types.js').VaulterConfig | null): string | undefined {
  return config?.artifacts_dir || undefined
}
