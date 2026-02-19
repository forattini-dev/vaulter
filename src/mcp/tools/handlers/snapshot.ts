/**
 * vaulter_snapshot handler — create | list | restore | delete
 *
 * Delegates to lib/snapshot.ts driver abstraction.
 */

import type { VaulterClient } from '../../../client.js'
import type { HandlerContext } from '../index.js'
import type { ToolResponse } from '../config.js'
import { textResponse, errorResponse } from '../config.js'
import { createSnapshotDriver } from '../../../lib/snapshot.js'
import type { Environment } from '../../../types.js'

function getDriver(ctx: HandlerContext, client: VaulterClient | null) {
  if (!ctx.configDir) throw new Error('No .vaulter/ directory found')
  const snapshotsConfig = ctx.config?.snapshots
  const db = snapshotsConfig?.driver === 's3db' && client
    ? (client as any).getDatabase?.()
    : undefined
  return createSnapshotDriver(ctx.configDir, snapshotsConfig, db)
}

export async function handleSnapshot(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const action = args.action as string

  switch (action) {
    case 'create':
      return handleCreate(ctx, client, args)
    case 'list':
      return handleList(ctx, args)
    case 'restore':
      return handleRestore(ctx, client, args)
    case 'delete':
      return handleDelete(ctx, args)
    default:
      return errorResponse(`Unknown action: ${action}. Valid: create, list, restore, delete`)
  }
}

async function handleCreate(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found. Run vaulter init first.')

  const environment = ctx.environment as Environment
  const source = (args.source as string) || 'cloud'
  const snapshotName = args.name as string | undefined

  let vars: Record<string, string>

  if (source === 'local') {
    // Snapshot from local files
    const { loadLocalShared, loadOverrides, mergeAllLocalVars } = await import('../../../lib/local.js')
    const shared = loadLocalShared(ctx.configDir)
    const overrides = loadOverrides(ctx.configDir, ctx.service)
    vars = mergeAllLocalVars({}, shared, overrides)
  } else if (source === 'merged') {
    // Snapshot from merged local + cloud
    const cloudVars = await client.export(ctx.project, environment, ctx.service)
    const { loadLocalShared, loadOverrides, mergeAllLocalVars } = await import('../../../lib/local.js')
    const shared = loadLocalShared(ctx.configDir)
    const overrides = loadOverrides(ctx.configDir, ctx.service)
    vars = mergeAllLocalVars(cloudVars, shared, overrides)
  } else {
    // Default: snapshot from cloud/backend
    vars = await client.export(ctx.project, environment, ctx.service)
  }

  if (Object.keys(vars).length === 0) {
    return textResponse(`No variables found for ${ctx.project}/${environment}. Nothing to snapshot.`)
  }

  const driver = getDriver(ctx, client)
  const info = await driver.create(environment, vars, {
    name: snapshotName,
    project: ctx.project,
    service: ctx.service
  })

  return textResponse([
    `✓ Snapshot created: ${info.id}`,
    `  Environment: ${info.environment}`,
    `  Variables: ${info.varsCount}`,
    `  Checksum: ${info.checksum}`,
    `  Source: ${source}`,
    info.name ? `  Name: ${info.name}` : null
  ].filter(Boolean).join('\n'))
}

async function handleList(
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found.')

  const environment = args.environment as string | undefined
  const driver = getDriver(ctx, null)
  const snapshots = await driver.list(environment)

  if (snapshots.length === 0) {
    return textResponse(environment
      ? `No snapshots found for environment: ${environment}`
      : 'No snapshots found')
  }

  const lines = [`Snapshots${environment ? ` (${environment})` : ''}:`, '']
  for (const s of snapshots) {
    const label = s.name ? ` "${s.name}"` : ''
    lines.push(`  ${s.id}${label}`)
    lines.push(`    env=${s.environment}  vars=${s.varsCount}  ${s.timestamp}`)
  }
  lines.push('', `Total: ${snapshots.length} snapshot(s)`)

  return textResponse(lines.join('\n'))
}

async function handleRestore(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found.')

  const id = args.id as string
  if (!id) return errorResponse('id is required for restore')

  const environment = ctx.environment as Environment
  const driver = getDriver(ctx, client)

  const snapshot = await driver.find(id)
  if (!snapshot) return errorResponse(`Snapshot not found: ${id}`)

  // Use driver's native restore if available (s3db)
  if (driver.restore) {
    const count = await driver.restore(id, ctx.project, environment, ctx.service)
    return textResponse(`✓ Restored snapshot ${snapshot.id} (${count} variables) to ${environment}`)
  }

  // Filesystem: load + setMany
  const vars = await driver.load(snapshot.id)
  if (!vars) return errorResponse(`Could not load snapshot data: ${snapshot.id}`)

  const entries = Object.entries(vars).map(([key, value]) => ({
    key,
    value,
    project: ctx.project,
    environment,
    service: ctx.service
  }))

  await client.setMany(entries)

  return textResponse(`✓ Restored snapshot ${snapshot.id} (${entries.length} variables) to ${environment}`)
}

async function handleDelete(
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found.')

  const id = args.id as string
  if (!id) return errorResponse('id is required for delete')

  const driver = getDriver(ctx, null)
  const snapshot = await driver.find(id)
  if (!snapshot) return errorResponse(`Snapshot not found: ${id}`)

  const deleted = await driver.delete(snapshot.id)
  return deleted
    ? textResponse(`✓ Deleted snapshot: ${snapshot.id}`)
    : errorResponse(`Failed to delete snapshot: ${snapshot.id}`)
}
