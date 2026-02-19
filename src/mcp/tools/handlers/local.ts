/**
 * vaulter_local handler — offline-first local overrides management
 *
 * Actions:
 *   pull, push, push-all, sync,
 *   set, delete, diff, status,
 *   shared-set, shared-delete, shared-list
 *
 * Delegates to lib/local.ts and lib/outputs.ts.
 */

import type { VaulterClient } from '../../../client.js'
import type { HandlerContext } from '../index.js'
import type { ToolResponse } from '../config.js'
import { textResponse, errorResponse } from '../config.js'
import {
  setLocalShared,
  deleteLocalShared,
  loadLocalShared,
  setOverride,
  deleteOverride,
  loadOverrides,
  diffOverrides,
  getLocalStatus,
  mergeAllLocalVars
} from '../../../lib/local.js'
import { pullToOutputs } from '../../../lib/outputs.js'
import { SHARED_SERVICE } from '../../../lib/shared.js'
import type { Environment } from '../../../types.js'

export async function handleLocal(
  ctx: HandlerContext,
  client: VaulterClient | null,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const action = args.action as string

  switch (action) {
    // ─── Offline actions (no client needed) ──────────────────────────
    case 'set':
      return handleSet(ctx, args)
    case 'delete':
      return handleDelete(ctx, args)
    case 'status':
      return handleStatus(ctx)
    case 'shared-set':
      return handleSharedSet(ctx, args)
    case 'shared-delete':
      return handleSharedDelete(ctx, args)
    case 'shared-list':
      return handleSharedList(ctx)
    case 'pull':
      return handlePull(ctx, client, args)

    // ─── Online actions (client required) ────────────────────────────
    case 'push':
      if (!client) return errorResponse('Backend client required for push')
      return handlePush(ctx, client, args)
    case 'push-all':
      if (!client) return errorResponse('Backend client required for push-all')
      return handlePushAll(ctx, client, args)
    case 'sync':
      if (!client) return errorResponse('Backend client required for sync')
      return handleSync(ctx, client, args)
    case 'diff':
      return handleDiff(ctx, client, args)

    default:
      return errorResponse(
        `Unknown action: ${action}. Valid: pull, push, push-all, sync, set, delete, diff, status, shared-set, shared-delete, shared-list`
      )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline: set / delete / status
// ─────────────────────────────────────────────────────────────────────────────

function handleSet(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found.')
  const key = args.key as string
  const value = args.value as string
  if (!key) return errorResponse('key is required')
  if (value === undefined) return errorResponse('value is required')

  const sensitive = args.sensitive === true
  const service = (args.service as string) || ctx.service

  setOverride(ctx.configDir, key, value, service, sensitive)

  const typeLabel = sensitive ? 'secret' : 'config'
  const scopeLabel = service ? ` (service: ${service})` : ''
  return textResponse(`✓ Set local ${typeLabel} ${key}${scopeLabel}`)
}

function handleDelete(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found.')
  const key = args.key as string
  if (!key) return errorResponse('key is required')

  const service = (args.service as string) || ctx.service
  const deleted = deleteOverride(ctx.configDir, key, service)

  return deleted
    ? textResponse(`✓ Deleted local override: ${key}`)
    : textResponse(`Variable ${key} not found in local overrides`)
}

function handleStatus(ctx: HandlerContext): ToolResponse {
  if (!ctx.configDir || !ctx.config) {
    return errorResponse('No .vaulter/ directory found.')
  }

  const status = getLocalStatus(ctx.configDir, ctx.config, ctx.service)

  const lines = [
    'Local Status',
    '',
    `Shared vars: ${status.sharedCount} (${status.sharedConfigCount} config, ${status.sharedSecretsCount} secret)`,
    `  Path: ${status.sharedPath}`,
    ''
  ]

  if (ctx.service) {
    lines.push(
      `Service overrides (${ctx.service}): ${status.overridesCount} (${status.overridesConfigCount} config, ${status.overridesSecretsCount} secret)`,
      `  Path: ${status.overridesPath}`,
      ''
    )
  }

  lines.push(
    `Base environment: ${status.baseEnvironment}`,
    `Snapshots: ${status.snapshotsCount}`
  )

  return textResponse(lines.join('\n'))
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline: shared-set / shared-delete / shared-list
// ─────────────────────────────────────────────────────────────────────────────

function handleSharedSet(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found.')
  const key = args.key as string
  const value = args.value as string
  if (!key) return errorResponse('key is required')
  if (value === undefined) return errorResponse('value is required')

  const sensitive = args.sensitive === true
  setLocalShared(ctx.configDir, key, value, sensitive)

  const typeLabel = sensitive ? 'secret' : 'config'
  return textResponse(`✓ Set shared ${typeLabel}: ${key}`)
}

function handleSharedDelete(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found.')
  const key = args.key as string
  if (!key) return errorResponse('key is required')

  const deleted = deleteLocalShared(ctx.configDir, key)
  return deleted
    ? textResponse(`✓ Deleted shared var: ${key}`)
    : textResponse(`Shared variable ${key} not found`)
}

function handleSharedList(ctx: HandlerContext): ToolResponse {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found.')

  const shared = loadLocalShared(ctx.configDir)
  const keys = Object.keys(shared)

  if (keys.length === 0) {
    return textResponse('No shared variables defined locally.')
  }

  const lines = ['Local shared variables:', '']
  for (const [key, value] of Object.entries(shared).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${key}=${value}`)
  }
  lines.push('', `Total: ${keys.length} variable(s)`)

  return textResponse(lines.join('\n'))
}

// ─────────────────────────────────────────────────────────────────────────────
// Pull (offline if no client, online for backend merge)
// ─────────────────────────────────────────────────────────────────────────────

async function handlePull(
  ctx: HandlerContext,
  client: VaulterClient | null,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  if (!ctx.configDir || !ctx.config) {
    return errorResponse('No .vaulter/ directory found.')
  }

  const all = args.all !== false
  const output = args.output as string | undefined
  const dryRun = args.dryRun === true

  // If no client available, pull from local files only
  if (!client) {
    // Offline pull: generate .env files from .vaulter/local/ only
    const shared = loadLocalShared(ctx.configDir)
    const overrides = loadOverrides(ctx.configDir, ctx.service)
    const vars = mergeAllLocalVars({}, shared, overrides)

    if (Object.keys(vars).length === 0) {
      return textResponse('No local variables found. Add with vaulter_local set or shared-set.')
    }

    // Use pullToOutputs with varsOverride
    try {
      const result = await pullToOutputs({
        client: null as any, // Not used when varsOverride is provided
        config: ctx.config,
        environment: ctx.environment as Environment,
        projectRoot: process.cwd(),
        all,
        output,
        dryRun,
        varsOverride: vars,
        sharedVarsOverride: shared,
        localOverridesLoader: (service) => loadOverrides(ctx.configDir!, service)
      })

      return formatPullResult(result, dryRun)
    } catch (err) {
      return errorResponse((err as Error).message)
    }
  }

  // Online pull: fetch from backend + merge with local
  try {
    const result = await pullToOutputs({
      client,
      config: ctx.config,
      environment: ctx.environment as Environment,
      projectRoot: process.cwd(),
      all,
      output,
      dryRun,
      localOverridesLoader: (service) => loadOverrides(ctx.configDir!, service)
    })

    return formatPullResult(result, dryRun)
  } catch (err) {
    return errorResponse((err as Error).message)
  }
}

function formatPullResult(
  result: import('../../../lib/outputs.js').PullToOutputsResult,
  dryRun: boolean
): ToolResponse {
  if (result.files.length === 0) {
    return textResponse('No output targets configured. Add an "outputs" section to config.')
  }

  const lines = [dryRun ? 'Pull preview:' : '✓ Pull complete:', '']

  for (const file of result.files) {
    const userInfo = file.userVars && Object.keys(file.userVars).length > 0
      ? ` (+${Object.keys(file.userVars).length} user vars preserved)`
      : ''
    lines.push(`  ${file.output}: ${file.varsCount} vars → ${file.fullPath}${userInfo}`)
  }

  if (result.warnings.length > 0) {
    lines.push('')
    for (const w of result.warnings) {
      lines.push(`  ⚠ ${w}`)
    }
  }

  return textResponse(lines.join('\n'))
}

// ─────────────────────────────────────────────────────────────────────────────
// Push / Push-All / Sync (online — requires client)
// ─────────────────────────────────────────────────────────────────────────────

async function handlePush(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found.')

  const shared = args.shared === true
  const dryRun = args.dryRun === true
  const environment = (args.targetEnvironment as string) || ctx.environment

  let vars: Record<string, string>
  let label: string

  if (shared) {
    vars = loadLocalShared(ctx.configDir)
    label = 'shared'
  } else {
    const service = (args.service as string) || ctx.service
    vars = loadOverrides(ctx.configDir, service)
    label = service ? `service:${service}` : 'default'
  }

  if (Object.keys(vars).length === 0) {
    return textResponse(`No local ${label} variables to push.`)
  }

  if (dryRun) {
    return textResponse([
      `Push preview (${label} → ${environment}):`,
      '',
      ...Object.keys(vars).map(k => `  ${k}`),
      '',
      `Total: ${Object.keys(vars).length} variable(s)`
    ].join('\n'))
  }

  const service = shared ? SHARED_SERVICE : ((args.service as string) || ctx.service)
  const entries = Object.entries(vars).map(([key, value]) => ({
    key,
    value,
    project: ctx.project,
    environment,
    service
  }))

  await client.setMany(entries)

  return textResponse(`✓ Pushed ${entries.length} ${label} variable(s) to ${environment}`)
}

async function handlePushAll(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found.')

  const dryRun = args.dryRun === true
  const overwrite = args.overwrite === true
  const environment = (args.targetEnvironment as string) || ctx.environment

  // Collect all local vars: shared + service overrides
  const shared = loadLocalShared(ctx.configDir)
  const overrides = loadOverrides(ctx.configDir, ctx.service)
  const allLocal = mergeAllLocalVars({}, shared, overrides)

  if (Object.keys(allLocal).length === 0) {
    return textResponse('No local variables to push.')
  }

  if (dryRun) {
    return textResponse([
      `Push-all preview → ${environment}${overwrite ? ' (overwrite mode)' : ''}:`,
      '',
      `  Shared: ${Object.keys(shared).length} variable(s)`,
      `  Overrides: ${Object.keys(overrides).length} variable(s)`,
      `  Total: ${Object.keys(allLocal).length} variable(s)`,
      '',
      overwrite ? '⚠ Backend vars not in local will be DELETED.' : 'Existing backend vars will be preserved (merge mode).'
    ].join('\n'))
  }

  // Push shared vars
  if (Object.keys(shared).length > 0) {
    const sharedEntries = Object.entries(shared).map(([key, value]) => ({
      key, value, project: ctx.project, environment, service: SHARED_SERVICE
    }))
    await client.setMany(sharedEntries)
  }

  // Push service overrides
  if (Object.keys(overrides).length > 0) {
    const overrideEntries = Object.entries(overrides).map(([key, value]) => ({
      key, value, project: ctx.project, environment, service: ctx.service
    }))
    await client.setMany(overrideEntries)
  }

  // If overwrite mode, delete backend vars that aren't in local
  let deletedCount = 0
  if (overwrite) {
    const existingVars = await client.export(ctx.project, environment as Environment, ctx.service)
    const localKeys = new Set(Object.keys(allLocal))
    const toDelete = Object.keys(existingVars).filter(k => !localKeys.has(k))

    if (toDelete.length > 0) {
      await client.deleteManyByKeys(toDelete, ctx.project, environment as Environment, ctx.service)
      deletedCount = toDelete.length
    }
  }

  const lines = [
    `✓ Push-all complete → ${environment}`,
    `  Shared: ${Object.keys(shared).length}`,
    `  Overrides: ${Object.keys(overrides).length}`
  ]
  if (deletedCount > 0) lines.push(`  Deleted from backend: ${deletedCount}`)

  return textResponse(lines.join('\n'))
}

async function handleSync(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found.')

  const environment = (args.sourceEnvironment as string) || ctx.environment
  const dryRun = args.dryRun === true

  // Use client.list() instead of export() to preserve sensitive metadata
  const backendVars = await client.list({ project: ctx.project, environment: environment as Environment, service: ctx.service })
  const sharedVars = await client.list({ project: ctx.project, environment: environment as Environment, service: SHARED_SERVICE })

  if (backendVars.length === 0 && sharedVars.length === 0) {
    return textResponse(`No variables found in backend for ${environment}.`)
  }

  if (dryRun) {
    return textResponse([
      `Sync preview (${environment} → local):`,
      '',
      `  Backend vars: ${backendVars.length}`,
      `  Shared vars: ${sharedVars.length}`,
      '',
      'Would overwrite .vaulter/local/ files.'
    ].join('\n'))
  }

  // Write shared vars preserving sensitive classification
  for (const v of sharedVars) {
    setLocalShared(ctx.configDir, v.key, v.value, v.sensitive ?? false)
  }

  // Write service vars preserving sensitive classification
  for (const v of backendVars) {
    setOverride(ctx.configDir, v.key, v.value, ctx.service, v.sensitive ?? false)
  }

  return textResponse([
    `✓ Synced ${environment} → local`,
    `  Shared: ${sharedVars.length} variable(s)`,
    `  Service: ${backendVars.length} variable(s)`
  ].join('\n'))
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff (can be offline or online)
// ─────────────────────────────────────────────────────────────────────────────

async function handleDiff(
  ctx: HandlerContext,
  client: VaulterClient | null,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  if (!ctx.configDir) return errorResponse('No .vaulter/ directory found.')

  const service = (args.service as string) || ctx.service
  const overrides = loadOverrides(ctx.configDir, service)

  if (Object.keys(overrides).length === 0) {
    return textResponse('No local overrides to diff.')
  }

  // If client available, diff against backend; otherwise diff against empty
  let baseVars: Record<string, string> = {}
  if (client) {
    try {
      baseVars = await client.export(ctx.project, ctx.environment as Environment, service)
    } catch {
      // Backend unavailable, diff against empty
    }
  }

  const result = diffOverrides(baseVars, overrides)

  const lines = ['Local overrides diff:', '']

  if (result.added.length > 0) {
    lines.push(`New (${result.added.length}):`)
    for (const key of result.added) lines.push(`  + ${key}`)
    lines.push('')
  }

  if (result.modified.length > 0) {
    lines.push(`Changed (${result.modified.length}):`)
    for (const key of result.modified) lines.push(`  ~ ${key}`)
    lines.push('')
  }

  if (result.baseOnly.length > 0) {
    lines.push(`Base only (${result.baseOnly.length}):`)
    for (const key of result.baseOnly) lines.push(`  - ${key}`)
    lines.push('')
  }

  lines.push(`Summary: +${result.added.length} ~${result.modified.length} base-only=${result.baseOnly.length}`)

  return textResponse(lines.join('\n'))
}
