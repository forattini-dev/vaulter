/**
 * vaulter_diff handler — quick diff local vs backend without artifacts
 */

import type { VaulterClient } from '../../../client.js'
import type { HandlerContext } from '../index.js'
import type { ToolResponse } from '../config.js'
import { textResponse, errorResponse } from '../config.js'
import {
  computePlan,
  parseScope,
  serviceScope,
  formatScope
} from '../../../domain/index.js'
import { maskValue } from '../../../lib/masking.js'

export async function handleDiff(
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
  const showValues = args.showValues === true

  const plan = await computePlan({
    client,
    config: ctx.config,
    configDir: ctx.configDir,
    project: ctx.project,
    environment: ctx.environment,
    scope,
    service: serviceArg || ctx.service
  })

  if (plan.changes.length === 0) {
    return textResponse(`No differences. Local state matches backend for ${ctx.environment}.`)
  }

  const lines: string[] = [
    `Diff: local vs ${ctx.environment} backend`,
    ''
  ]

  const adds = plan.changes.filter(c => c.action === 'add')
  const updates = plan.changes.filter(c => c.action === 'update')
  const deletes = plan.changes.filter(c => c.action === 'delete')

  if (adds.length > 0) {
    lines.push(`New (${adds.length}):`)
    for (const c of adds) {
      const val = showValues && c.localValue
        ? ` = ${c.sensitive ? maskValue(c.localValue) : c.localValue}`
        : ''
      lines.push(`  + ${c.key} (${formatScope(c.scope)})${val}`)
    }
    lines.push('')
  }

  if (updates.length > 0) {
    lines.push(`Changed (${updates.length}):`)
    for (const c of updates) {
      lines.push(`  ~ ${c.key} (${formatScope(c.scope)})`)
      if (showValues) {
        const local = c.sensitive ? maskValue(c.localValue || '') : c.localValue
        const remote = c.sensitive ? maskValue(c.remoteValue || '') : c.remoteValue
        lines.push(`    local:  ${local}`)
        lines.push(`    remote: ${remote}`)
      }
    }
    lines.push('')
  }

  if (deletes.length > 0) {
    lines.push(`Removed (${deletes.length}):`)
    for (const c of deletes) {
      lines.push(`  - ${c.key} (${formatScope(c.scope)})`)
    }
    lines.push('')
  }

  lines.push(`Total: +${adds.length} ~${updates.length} -${deletes.length}`)

  return textResponse(lines.join('\n'))
}
