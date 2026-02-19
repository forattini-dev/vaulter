/**
 * vaulter_plan handler — compute diff local vs backend
 */

import type { VaulterClient } from '../../../client.js'
import type { HandlerContext } from '../index.js'
import type { ToolResponse } from '../config.js'
import { textResponse, errorResponse } from '../config.js'
import {
  computePlan,
  writePlanArtifact,
  parseScope,
  serviceScope,
  formatScope
} from '../../../domain/index.js'

export async function handlePlan(
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

  // Write plan artifacts
  const paths = writePlanArtifact(plan)

  // Format output
  const lines: string[] = [
    `## Plan: ${plan.id}`,
    '',
    `**Project:** ${plan.project}`,
    `**Environment:** ${plan.environment}`,
    plan.scope ? `**Scope:** ${formatScope(plan.scope)}` : null,
    `**Health:** ${plan.scorecard.health}`,
    '',
    '### Summary',
    `| Metric | Count |`,
    `|--------|-------|`,
    `| To add | ${plan.summary.toAdd} |`,
    `| To update | ${plan.summary.toUpdate} |`,
    `| To delete | ${plan.summary.toDelete} |`,
    `| Unchanged | ${plan.summary.unchanged} |`,
    plan.summary.conflicts > 0 ? `| Remote-only (drift) | ${plan.summary.conflicts} |` : null,
    ''
  ].filter(Boolean) as string[]

  if (plan.changes.length > 0) {
    lines.push('### Changes')
    for (const c of plan.changes) {
      const icon = c.action === 'add' ? '+' : c.action === 'delete' ? '-' : '~'
      lines.push(`  ${icon} **${c.key}** (${formatScope(c.scope)}) [${c.action}]`)
    }
    lines.push('')
  } else {
    lines.push('No changes detected. Local state matches backend.')
    lines.push('')
  }

  if (plan.scorecard.issues.length > 0) {
    lines.push('### Issues')
    for (const issue of plan.scorecard.issues) {
      const icon = issue.severity === 'error' ? '!!' : issue.severity === 'warning' ? '!' : 'i'
      const keyHint = issue.key ? ` [${issue.key}]` : ''
      lines.push(`  [${icon}]${keyHint} ${issue.message}`)
      if (issue.suggestion) lines.push(`    → ${issue.suggestion}`)
    }
    lines.push('')
  }

  lines.push(`Plan saved: ${paths.json}`)
  if (plan.changes.length > 0) {
    lines.push('')
    lines.push('Run **vaulter_apply** to push these changes to backend.')
  }

  return textResponse(lines.join('\n'))
}
