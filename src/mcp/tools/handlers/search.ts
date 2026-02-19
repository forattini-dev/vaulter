/**
 * vaulter_search handler — search + compare
 *
 * If source + target present → compare environments
 * Otherwise → search by pattern across environments
 */

import type { VaulterClient } from '../../../client.js'
import type { HandlerContext } from '../index.js'
import type { ToolResponse } from '../config.js'
import { textResponse, errorResponse, getMcpRuntimeOptions } from '../config.js'
import { getValidEnvironments } from '../../../lib/config-loader.js'
import { DEFAULT_ENVIRONMENTS } from '../../../types.js'
import type { Environment } from '../../../types.js'
import pLimit from 'p-limit'

export async function handleSearch(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const source = args.source as string | undefined
  const target = args.target as string | undefined

  if (source && target) {
    return handleCompare(ctx, client, args)
  }

  return handlePatternSearch(ctx, client, args)
}

async function handleCompare(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const source = args.source as Environment
  const target = args.target as Environment
  const showValues = args.showValues === true

  const [sourceVars, targetVars] = await Promise.all([
    client.export(ctx.project, source, ctx.service),
    client.export(ctx.project, target, ctx.service)
  ])

  const sourceKeys = new Set(Object.keys(sourceVars))
  const targetKeys = new Set(Object.keys(targetVars))

  const onlyInSource: string[] = []
  const onlyInTarget: string[] = []
  const different: string[] = []
  const same: string[] = []

  for (const key of sourceKeys) {
    if (!targetKeys.has(key)) {
      onlyInSource.push(key)
    } else if (sourceVars[key] !== targetVars[key]) {
      different.push(key)
    } else {
      same.push(key)
    }
  }

  for (const key of targetKeys) {
    if (!sourceKeys.has(key)) {
      onlyInTarget.push(key)
    }
  }

  const lines = [`Comparing ${ctx.project}: ${source} → ${target}\n`]

  if (onlyInSource.length > 0) {
    lines.push(`Only in ${source} (${onlyInSource.length}):`)
    for (const key of onlyInSource) {
      lines.push(showValues ? `  - ${key}=${sourceVars[key]}` : `  - ${key}`)
    }
    lines.push('')
  }

  if (onlyInTarget.length > 0) {
    lines.push(`Only in ${target} (${onlyInTarget.length}):`)
    for (const key of onlyInTarget) {
      lines.push(showValues ? `  + ${key}=${targetVars[key]}` : `  + ${key}`)
    }
    lines.push('')
  }

  if (different.length > 0) {
    lines.push(`Different values (${different.length}):`)
    for (const key of different) {
      if (showValues) {
        lines.push(`  ~ ${key}:`)
        lines.push(`      ${source}: ${sourceVars[key]}`)
        lines.push(`      ${target}: ${targetVars[key]}`)
      } else {
        lines.push(`  ~ ${key}`)
      }
    }
    lines.push('')
  }

  lines.push(`Summary: ${same.length} identical, ${different.length} different, ${onlyInSource.length} only in ${source}, ${onlyInTarget.length} only in ${target}`)

  return textResponse(lines.join('\n'))
}

async function handlePatternSearch(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const pattern = args.pattern as string
  if (!pattern) {
    return errorResponse('pattern is required for search (or use source + target for compare)')
  }

  const environments = (args.environments as string[])
    || (ctx.config ? getValidEnvironments(ctx.config) : DEFAULT_ENVIRONMENTS)

  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i')
  const results: Array<{ env: string; key: string }> = []
  const limit = pLimit(getMcpRuntimeOptions().searchConcurrency)

  await Promise.all(environments.map(env => limit(async () => {
    try {
      const vars = await client.list({
        project: ctx.project,
        environment: env as Environment,
        service: ctx.service
      })
      for (const v of vars) {
        if (regex.test(v.key)) {
          results.push({ env, key: v.key })
        }
      }
    } catch {
      // Environment might not exist
    }
  })))

  if (results.length === 0) {
    return textResponse(`No variables matching "${pattern}" found in any environment`)
  }

  const byKey = new Map<string, string[]>()
  for (const r of results) {
    const envs = byKey.get(r.key) || []
    envs.push(r.env)
    byKey.set(r.key, envs)
  }

  const lines = [`Search results for "${pattern}":\n`]
  for (const [key, envs] of byKey) {
    lines.push(`  ${key}: [${envs.join(', ')}]`)
  }
  lines.push(`\nFound ${byKey.size} unique variable(s) across ${environments.length} environment(s)`)

  return textResponse(lines.join('\n'))
}
