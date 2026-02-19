/**
 * Vaulter `diff` Command
 *
 * Quick diff: shows local vs backend differences without writing an artifact.
 * Lighter than `plan` — no artifact, no scorecard.
 *
 * Usage:
 *   vaulter diff -e dev                    Show diff for all scopes
 *   vaulter diff -e dev --scope svc-auth   Diff specific scope
 *   vaulter diff -e dev --values           Show actual values
 *   vaulter diff -e dev --json             JSON output
 */

import type { VarContext } from './change.js'
import { findConfigDir } from '../../lib/config-loader.js'
import { withClient } from '../lib/create-client.js'
import { computePlan } from '../../domain/plan.js'
import { parseScope, formatScope } from '../../domain/types.js'
import type { PlanChange } from '../../domain/types.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import * as ui from '../ui.js'

// ============================================================================
// Diff Command
// ============================================================================

export async function runDiff(context: VarContext): Promise<void> {
  const { args, config, project, environment, service, verbose, jsonOutput } = context

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('No .vaulter directory found. Run "vaulter init" first.')
    process.exit(1)
  }
  const scopeRaw = args.scope as string | undefined
  const scope = scopeRaw ? parseScope(scopeRaw) : (service ? parseScope(service) : null)
  const showValues = Boolean(args.values || args['show-values'])
  const prune = Boolean(args.prune)

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

  // JSON output
  if (jsonOutput) {
    ui.output(JSON.stringify({
      environment,
      scope: scope ? formatScope(scope) : 'all',
      summary: plan.summary,
      changes: plan.changes.map(ch => ({
        ...ch,
        localValue: ch.sensitive && !showValues ? '***' : ch.localValue,
        remoteValue: ch.sensitive && !showValues ? '***' : ch.remoteValue,
        scope: formatScope(ch.scope)
      }))
    }, null, 2))
    return
  }

  // No changes
  const total = plan.summary.toAdd + plan.summary.toUpdate + plan.summary.toDelete
  if (total === 0 && plan.summary.conflicts === 0) {
    ui.log(`${symbols.success} No differences — local and backend are in sync for ${colorEnv(environment)}.`)
    return
  }

  // Display diff
  ui.log(`${c.header(`Diff: ${project} / ${environment}`)}`)
  if (scope) {
    ui.log(`  ${c.muted('Scope:')} ${formatScope(scope)}`)
  }
  ui.log('')

  // Changes
  for (const change of plan.changes) {
    displayDiffChange(change, showValues)
  }

  // Remote-only count
  if (plan.summary.conflicts > 0) {
    ui.log('')
    ui.log(`  ${c.muted(`${plan.summary.conflicts} variable(s) exist only in backend (use --prune to include deletions)`)}`)
  }

  // Summary line
  ui.log('')
  const parts: string[] = []
  if (plan.summary.toAdd > 0) parts.push(c.success(`+${plan.summary.toAdd}`))
  if (plan.summary.toUpdate > 0) parts.push(c.warning(`~${plan.summary.toUpdate}`))
  if (plan.summary.toDelete > 0) parts.push(c.error(`-${plan.summary.toDelete}`))
  if (plan.summary.unchanged > 0) parts.push(c.muted(`=${plan.summary.unchanged}`))
  ui.log(`  ${parts.join('  ')}`)
}

// ============================================================================
// Display
// ============================================================================

function displayDiffChange(change: PlanChange, showValues: boolean): void {
  const scopeLabel = c.muted(`(${formatScope(change.scope)})`)

  switch (change.action) {
    case 'add': {
      const value = showValues && !change.sensitive && change.localValue
        ? ` = ${change.localValue}`
        : ''
      ui.log(`  ${c.success('+')} ${change.key} ${scopeLabel}${value}`)
      break
    }
    case 'update': {
      ui.log(`  ${c.warning('~')} ${change.key} ${scopeLabel}`)
      if (showValues) {
        const local = change.sensitive ? '***' : (change.localValue || '')
        const remote = change.sensitive ? '***' : (change.remoteValue || '')
        ui.log(`    ${c.error(`- ${remote}`)}`)
        ui.log(`    ${c.success(`+ ${local}`)}`)
      }
      break
    }
    case 'delete': {
      ui.log(`  ${c.error('-')} ${change.key} ${scopeLabel}`)
      break
    }
  }
}
