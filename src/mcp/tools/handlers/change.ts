/**
 * vaulter_change handler — set | delete | move | import
 *
 * Writes to .vaulter/local/ via domain/state. Does NOT touch backend.
 */

import type { HandlerContext } from '../index.js'
import type { ToolResponse } from '../config.js'
import { textResponse, errorResponse } from '../config.js'
import {
  writeLocalVariable,
  deleteLocalVariable,
  moveLocalVariable,
  checkSingleVariable,
  parseScope,
  sharedScope,
  serviceScope,
  formatScope
} from '../../../domain/index.js'
import type { Scope } from '../../../domain/index.js'

export function handleChange(
  ctx: HandlerContext,
  args: Record<string, unknown>
): ToolResponse {
  const action = args.action as string

  if (!ctx.configDir) {
    return errorResponse('No .vaulter/ directory found. Run vaulter init first.')
  }

  switch (action) {
    case 'set':
      return handleSet(ctx, args)
    case 'delete':
      return handleDelete(ctx, args)
    case 'move':
      return handleMove(ctx, args)
    case 'import':
      return handleImport(ctx, args)
    default:
      return errorResponse(`Unknown action: ${action}. Valid: set, delete, move, import`)
  }
}

interface McpScopeResolution {
  scope: Scope
  implicit: boolean
}

function resolveScope(args: Record<string, unknown>, ctxService: string | undefined): McpScopeResolution {
  const scopeArg = args.scope as string | undefined
  if (scopeArg) {
    const parsed = parseScope(scopeArg)
    if (parsed) return { scope: parsed, implicit: false }
  }
  if (ctxService) return { scope: serviceScope(ctxService), implicit: false }
  return { scope: sharedScope(), implicit: true }
}

function handleSet(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  const key = args.key as string
  const value = args.value as string
  if (!key || value === undefined) {
    return errorResponse('key and value are required for set action')
  }

  const sensitive = args.sensitive === true
  const { scope, implicit } = resolveScope(args, ctx.service)

  // Governance pre-check
  const check = checkSingleVariable({
    key,
    value,
    scope,
    sensitive,
    environment: ctx.environment,
    config: ctx.config
  })
  if (check.blocked) {
    return errorResponse(`Blocked: ${check.blockReason}`)
  }

  const result = writeLocalVariable(ctx.configDir!, ctx.environment, {
    key,
    value,
    scope,
    sensitive: check.effectiveSensitive
  }, { source: 'mcp' })

  const typeLabel = check.effectiveSensitive ? 'secret' : 'config'
  const allWarnings = [...check.warnings, ...result.warnings]
  const lines = [`✓ Set ${key} (${typeLabel}) in local state [${formatScope(scope)}]`]
  if (implicit) {
    lines.push(`ℹ️  No scope specified — defaulted to shared. Use scope parameter to be explicit.`)
  }
  if (check.sensitiveAutoCorrect) {
    lines.push(`ℹ️  Auto-set sensitive=true for ${key} (name suggests secret material)`)
  }
  for (const w of allWarnings) {
    lines.push(`⚠️ ${w}`)
  }
  if (check.suggestions.length > 0) {
    lines.push('')
    lines.push('Suggestions:')
    for (const s of check.suggestions) {
      lines.push(`  → ${s}`)
    }
  }
  lines.push('')
  lines.push('Run vaulter_plan to see what would change in backend.')

  return textResponse(lines.join('\n'))
}

function handleDelete(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  const key = args.key as string
  if (!key) {
    return errorResponse('key is required for delete action')
  }

  const { scope, implicit } = resolveScope(args, ctx.service)
  const deleted = deleteLocalVariable(ctx.configDir!, ctx.environment, key, scope, { source: 'mcp' })

  if (deleted) {
    const note = implicit ? '\nℹ️  No scope specified — defaulted to shared. Use scope parameter to be explicit.' : ''
    return textResponse(`✓ Deleted ${key} from local state [${formatScope(scope)}]${note}\n\nRun vaulter_plan to see what would change in backend.`)
  }
  return textResponse(`Variable ${key} not found in local state [${formatScope(scope)}]`)
}

function handleMove(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  const key = args.key as string
  const fromArg = args.from as string
  const toArg = args.to as string

  if (!key || !fromArg || !toArg) {
    return errorResponse('key, from, and to are required for move action')
  }

  const from = parseScope(fromArg)
  const to = parseScope(toArg)
  if (!from || !to) {
    return errorResponse('Invalid scope format. Use "shared" or a service name.')
  }

  const overwrite = args.overwrite === true  // default false
  const deleteOriginal = args.deleteOriginal !== false  // default true

  const result = moveLocalVariable(
    ctx.configDir!, ctx.environment, key, from, to,
    { source: 'mcp' },
    { overwrite, deleteOriginal }
  )

  if (!result.success) {
    return errorResponse(result.warnings.join('\n'))
  }

  const action = deleteOriginal ? 'Moved' : 'Copied'
  return textResponse(`✓ ${action} ${key}: ${formatScope(from)} → ${formatScope(to)}\n\nRun vaulter_plan to see what would change in backend.`)
}

function handleImport(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  const vars = args.vars as Record<string, string> | undefined
  if (!vars || Object.keys(vars).length === 0) {
    return errorResponse('vars object is required for import action (key-value pairs)')
  }

  const sensitive = args.sensitive === true
  const { scope, implicit } = resolveScope(args, ctx.service)
  const results: string[] = []
  let count = 0
  let blocked = 0

  for (const [key, value] of Object.entries(vars)) {
    // Governance pre-check per key
    const govCheck = checkSingleVariable({
      key,
      value,
      scope,
      sensitive,
      environment: ctx.environment,
      config: ctx.config
    })
    if (govCheck.blocked) {
      blocked++
      results.push(`✗ ${key}: ${govCheck.blockReason}`)
      continue
    }
    if (govCheck.sensitiveAutoCorrect) {
      results.push(`ℹ️  ${key}: auto-set sensitive=true (name suggests secret material)`)
    }
    for (const w of govCheck.warnings) {
      results.push(`⚠️ ${key}: ${w}`)
    }

    const result = writeLocalVariable(ctx.configDir!, ctx.environment, {
      key,
      value,
      scope,
      sensitive: govCheck.effectiveSensitive
    }, { source: 'mcp', actor: 'import' })

    if (result.success) count++
    for (const w of result.warnings) {
      results.push(`⚠️ ${key}: ${w}`)
    }
  }

  const lines = [`✓ Imported ${count} variable(s) to local state [${formatScope(scope)}]`]
  if (implicit) {
    lines.push(`ℹ️  No scope specified — defaulted to shared. Use scope parameter to be explicit.`)
  }
  if (blocked > 0) {
    lines.push(`✗ ${blocked} variable(s) blocked by governance policy`)
  }
  lines.push(...results)
  lines.push('')
  lines.push('Run vaulter_plan to see what would change in backend.')

  return textResponse(lines.join('\n'))
}
