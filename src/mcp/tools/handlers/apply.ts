/**
 * vaulter_apply handler — execute plan, push changes to backend
 */

import type { VaulterClient } from '../../../client.js'
import type { HandlerContext } from '../index.js'
import type { ToolResponse } from '../config.js'
import { textResponse, errorResponse } from '../config.js'
import {
  computePlan,
  executePlan,
  writePlanArtifact,
  updatePlanArtifact,
  parseScope,
  serviceScope,
  formatScope
} from '../../../domain/index.js'

export async function handleApply(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  if (!ctx.configDir) {
    return errorResponse('No .vaulter/ directory found. Run vaulter init first.')
  }

  const scopeArg = args.scope as string | undefined
  const serviceArg = args.service as string | undefined
  const scope = scopeArg ? parseScope(scopeArg) : (serviceArg ? serviceScope(serviceArg) : null)
  const prune = args.prune === true
  const force = args.force === true
  const dryRun = args.dryRun === true

  // 1. Compute fresh plan
  const plan = await computePlan({
    client,
    config: ctx.config,
    configDir: ctx.configDir,
    project: ctx.project,
    environment: ctx.environment,
    scope,
    service: serviceArg || ctx.service,
    prune
  })

  if (plan.changes.length === 0) {
    return textResponse('Nothing to apply. Local state matches backend.')
  }

  // Write plan artifact for audit trail
  const paths = writePlanArtifact(plan)

  // 2. Execute plan
  const result = await executePlan({
    client,
    plan,
    config: ctx.config,
    project: ctx.project,
    force,
    dryRun
  })

  // Update artifact with final status
  updatePlanArtifact(paths.json, result.updatedPlan)

  // 3. Format output
  const lines: string[] = []

  if (dryRun) {
    lines.push('## Apply Preview (dry run)')
    lines.push('')
    lines.push(`Would apply ${plan.changes.length} change(s) to ${ctx.environment}:`)
    for (const c of plan.changes) {
      const icon = c.action === 'add' ? '+' : c.action === 'delete' ? '-' : '~'
      lines.push(`  ${icon} ${c.key} (${formatScope(c.scope)})`)
    }
    lines.push('')
    lines.push('Run without dryRun to apply.')
    return textResponse(lines.join('\n'))
  }

  if (!result.success) {
    lines.push(`## Apply Failed`)
    lines.push('')
    lines.push(`Applied: ${result.applied}  Failed: ${result.failed}  Skipped: ${result.skipped}`)
    for (const err of result.errors) {
      lines.push(`  ✗ ${err.key}: ${err.error}`)
    }
    return textResponse(lines.join('\n'))
  }

  lines.push(`✓ Applied ${result.applied} change(s) to ${ctx.environment}`)
  lines.push('')
  lines.push(`Plan: ${plan.id}`)
  lines.push(`Status: ${result.updatedPlan.status}`)

  return textResponse(lines.join('\n'))
}
