/**
 * `plan` Command
 *
 * Computes the diff between local state and backend, generates a plan artifact.
 *
 * Usage:
 *   vaulter plan -e prd                    Compute plan for all scopes
 *   vaulter plan -e dev --scope svc-auth   Compute plan for specific scope
 *   vaulter plan -e prd --json             JSON output for CI
 *   vaulter plan -e dev --prune            Include delete actions for remote-only vars
 */

import type { VarContext } from './change.js'
import type { VaulterConfig } from '../../types.js'
import { findConfigDir } from '../../lib/config-loader.js'
import { withClient } from '../lib/create-client.js'
import { computePlan, writePlanArtifact } from '../../domain/plan.js'
import { parseScope, formatScope } from '../../domain/types.js'
import type { Plan, PlanChange } from '../../domain/types.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import * as ui from '../ui.js'

// ============================================================================
// Plan Command
// ============================================================================

export async function runPlan(context: VarContext): Promise<void> {
  const { args, config, project, environment, service, verbose, jsonOutput } = context

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('No .vaulter directory found. Run "vaulter init" first.')
    process.exit(1)
  }
  const scopeRaw = args.scope as string | undefined
  const scope = scopeRaw ? parseScope(scopeRaw) : (service ? parseScope(service) : null)
  const prune = Boolean(args.prune)
  const preflight = Boolean(args.preflight)

  ui.log(`${symbols.info} Computing plan for ${colorEnv(environment)}...`)

  const plan = await withClient(
    { args, config, project, environment, verbose },
    async (client) => {
      return computePlan({
        client,
        config,
        configDir,
        project,
        environment,
        scope,
        service,
        prune
      })
    }
  )

  // JSON output for CI
  if (jsonOutput) {
    ui.output(JSON.stringify(plan, null, 2))
    return
  }

  if (!preflight) {
    // Write artifact for review/apply
    const artifactDir = resolveArtifactDir(config)
    const paths = writePlanArtifact(plan, artifactDir)

    ui.log('')
    ui.log(`${c.muted('Plan saved to:')}`)
    ui.log(`  ${c.muted('JSON:')} ${paths.json}`)
    ui.log(`  ${c.muted('Markdown:')} ${paths.markdown}`)
  }

  // Display plan
  displayPlan(plan, environment)

  // Guidance
  if (plan.changes.length > 0) {
    ui.log('')
    ui.log(`${symbols.info} Review the plan, then run:`)
    ui.log(`  ${c.command('vaulter apply')} -e ${environment}${plan.environment === 'prd' ? ' --force' : ''}`)
  }

  if (preflight) {
    ui.log('')
    ui.log(c.muted('Preflight mode: plan was computed without writing artifact files.'))
  }
}

// ============================================================================
// Display
// ============================================================================

function displayPlan(plan: Plan, environment: string): void {
  const { summary, changes, scorecard } = plan

  const totalChanges = summary.toAdd + summary.toUpdate + summary.toDelete

  if (totalChanges === 0 && summary.conflicts === 0) {
    ui.log(`${symbols.success} No changes detected — local and backend are in sync.`)
    return
  }

  // Summary header
  ui.log('')
  ui.log(c.header(`Plan: ${plan.project} / ${environment}`))
  if (plan.scope) {
    ui.log(`  ${c.muted('Scope:')} ${formatScope(plan.scope)}`)
  }
  ui.log('')

  // Summary counts
  if (summary.toAdd > 0) {
    ui.log(`  ${c.success(`+ ${summary.toAdd} to add`)}`)
  }
  if (summary.toUpdate > 0) {
    ui.log(`  ${c.warning(`~ ${summary.toUpdate} to update`)}`)
  }
  if (summary.toDelete > 0) {
    ui.log(`  ${c.error(`- ${summary.toDelete} to delete`)}`)
  }
  if (summary.unchanged > 0) {
    ui.log(`  ${c.muted(`  ${summary.unchanged} unchanged`)}`)
  }
  if (summary.conflicts > 0) {
    ui.log(`  ${c.warning(`  ${summary.conflicts} remote-only (not in local)`)}`)
  }
  ui.log('')

  // Change details
  if (changes.length > 0) {
    ui.log(c.header('Changes:'))
    for (const change of changes) {
      displayChange(change)
    }
    ui.log('')
  }

  // Scorecard issues
  if (scorecard.issues.length > 0) {
    ui.log(c.header('Issues:'))
    for (const issue of scorecard.issues) {
      const icon = issue.severity === 'error'
        ? c.error('!!')
        : issue.severity === 'warning'
          ? c.warning('!')
          : c.muted('i')
      ui.log(`  ${icon} ${issue.message}`)
      if (issue.suggestion) {
        ui.log(`    ${c.muted('→')} ${c.muted(issue.suggestion)}`)
      }
    }
    ui.log('')
  }

  // Health
  const healthIcon = scorecard.health === 'ok'
    ? c.success('OK')
    : scorecard.health === 'warning'
      ? c.warning('WARNING')
      : c.error('CRITICAL')
  ui.log(`  Health: ${healthIcon}`)
}

function displayChange(change: PlanChange): void {
  const scopeLabel = c.muted(`(${formatScope(change.scope)})`)
  const sensitiveLabel = change.sensitive ? c.muted(' [secret]') : ''

  switch (change.action) {
    case 'add':
      ui.log(`  ${c.success('+')} ${c.bold(change.key)} ${scopeLabel}${sensitiveLabel}`)
      break
    case 'update':
      ui.log(`  ${c.warning('~')} ${c.bold(change.key)} ${scopeLabel}${sensitiveLabel}`)
      break
    case 'delete':
      ui.log(`  ${c.error('-')} ${c.bold(change.key)} ${scopeLabel}${sensitiveLabel}`)
      break
  }
}

// ============================================================================
// Helpers
// ============================================================================

function resolveArtifactDir(config: VaulterConfig | null): string | undefined {
  return config?.artifacts_dir || undefined
}
