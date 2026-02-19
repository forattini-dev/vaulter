/**
 * vaulter_versions handler — list | get | rollback
 *
 * Interfaces with the client versioning API (EnvVar.metadata.versions).
 */

import type { VaulterClient } from '../../../client.js'
import type { HandlerContext } from '../index.js'
import type { ToolResponse } from '../config.js'
import { textResponse, errorResponse } from '../config.js'
import type { Environment } from '../../../types.js'
import { maskValue } from '../../../lib/masking.js'

export async function handleVersions(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const action = args.action as string

  switch (action) {
    case 'list':
      return handleListVersions(ctx, client, args)
    case 'get':
      return handleGetVersion(ctx, client, args)
    case 'rollback':
      return handleRollback(ctx, client, args)
    default:
      return errorResponse(`Unknown action: ${action}. Valid: list, get, rollback`)
  }
}

async function handleListVersions(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const key = args.key as string
  if (!key) return errorResponse('key is required')

  const showValues = args.showValues === true
  const environment = ctx.environment as Environment

  const envVar = await client.get(key, ctx.project, environment, ctx.service)
  if (!envVar) return errorResponse(`Variable ${key} not found in ${ctx.project}/${environment}`)

  const versions = envVar.metadata?.versions
  if (!versions || versions.length === 0) {
    return textResponse(`No version history for ${key} in ${environment}`)
  }

  const currentVersion = envVar.metadata?.currentVersion ?? versions.length
  const lines = [`Version history: ${key} (${environment})`, '']

  for (let i = versions.length - 1; i >= 0; i--) {
    const v = versions[i]
    const isCurrent = v.version === currentVersion
    const marker = isCurrent ? '●' : '○'
    const label = isCurrent ? ' (current)' : ''

    lines.push(`${marker} v${v.version}${label}`)

    const timestamp = v.timestamp ? new Date(v.timestamp).toLocaleString() : 'unknown'
    const user = v.user || 'unknown'
    lines.push(`  └─ ${timestamp} - ${user}`)

    if (v.operation || v.source) {
      const parts: string[] = []
      if (v.operation) parts.push(`Operation: ${v.operation}`)
      if (v.source) parts.push(`Source: ${v.source}`)
      lines.push(`     ${parts.join(' ')}`)
    }

    if (showValues && v.value) {
      lines.push(`     Value: ${envVar.sensitive ? maskValue(v.value) : v.value}`)
    }
  }

  lines.push('', `Total: ${versions.length} version(s)`)

  return textResponse(lines.join('\n'))
}

async function handleGetVersion(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const key = args.key as string
  const version = args.version as number | undefined
  if (!key) return errorResponse('key is required')
  if (version === undefined) return errorResponse('version is required')

  const environment = ctx.environment as Environment

  const envVar = await client.get(key, ctx.project, environment, ctx.service)
  if (!envVar) return errorResponse(`Variable ${key} not found in ${ctx.project}/${environment}`)

  const versions = envVar.metadata?.versions
  if (!versions || versions.length === 0) {
    return errorResponse(`No version history for ${key}`)
  }

  const entry = versions.find(v => v.version === version)
  if (!entry) return errorResponse(`Version ${version} not found for ${key}. Available: ${versions.map(v => v.version).join(', ')}`)

  const currentVersion = envVar.metadata?.currentVersion ?? versions.length
  const lines = [
    `${key} v${entry.version}${entry.version === currentVersion ? ' (current)' : ''}`,
    `  Timestamp: ${entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'unknown'}`,
    `  User: ${entry.user || 'unknown'}`,
    `  Operation: ${entry.operation || 'unknown'}`,
    `  Source: ${entry.source || 'unknown'}`,
    `  Value: ${envVar.sensitive ? maskValue(entry.value) : entry.value}`
  ]

  if (entry.checksum) lines.push(`  Checksum: ${entry.checksum}`)

  return textResponse(lines.join('\n'))
}

async function handleRollback(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const key = args.key as string
  const version = args.version as number | undefined
  const dryRun = args.dryRun === true
  if (!key) return errorResponse('key is required')
  if (version === undefined) return errorResponse('version is required')

  const environment = ctx.environment as Environment

  const envVar = await client.get(key, ctx.project, environment, ctx.service)
  if (!envVar) return errorResponse(`Variable ${key} not found in ${ctx.project}/${environment}`)

  const versions = envVar.metadata?.versions
  if (!versions || versions.length === 0) {
    return errorResponse(`No version history for ${key}`)
  }

  const entry = versions.find(v => v.version === version)
  if (!entry) return errorResponse(`Version ${version} not found for ${key}`)

  const currentVersion = envVar.metadata?.currentVersion ?? versions.length

  if (dryRun) {
    return textResponse([
      `Rollback preview: ${key}`,
      `  From: v${currentVersion} → ${envVar.sensitive ? maskValue(envVar.value) : envVar.value}`,
      `  To:   v${version} → ${envVar.sensitive ? maskValue(entry.value) : entry.value}`,
      '',
      'Use dryRun=false to execute.'
    ].join('\n'))
  }

  // Execute rollback: set value and add new version entry
  await client.set({
    key,
    value: entry.value,
    project: ctx.project,
    environment,
    service: ctx.service,
    sensitive: envVar.sensitive,
    metadata: {
      source: 'manual' as const
    } as import('../../../types.js').EnvVarMetadata
  })

  return textResponse([
    `✓ Rolled back ${key}`,
    `  From: v${currentVersion}`,
    `  To:   v${version}`,
    `  New:  v${(versions.length + 1)} (rollback operation)`
  ].join('\n'))
}
