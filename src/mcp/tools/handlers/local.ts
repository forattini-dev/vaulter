/**
 * Vaulter MCP Tools - Local & Snapshot Handlers
 */

import type { VaulterClient } from '../../../client.js'
import type { VaulterConfig, Environment } from '../../../types.js'
import type { ToolResponse } from '../config.js'
import { findConfigDir } from '../../../lib/config-loader.js'
import {
  setOverride,
  deleteOverride,
  getLocalStatus,
  loadLocalShared,
  setLocalShared,
  deleteLocalShared
} from '../../../lib/local.js'
import { runLocalPull, runLocalDiff } from '../../../lib/local-ops.js'
import { snapshotCreate, snapshotList, snapshotRestore } from '../../../lib/snapshot-ops.js'

/**
 * Get configDir or return error response
 */
function getConfigDirOrError(): { configDir: string } | { error: ToolResponse } {
  const configDir = findConfigDir()
  if (!configDir) {
    return {
      error: {
        content: [{ type: 'text', text: 'Error: Could not find .vaulter/ directory. Run vaulter init first.' }]
      }
    }
  }
  return { configDir }
}

/**
 * vaulter_local_pull - Base env + local shared + service overrides → output targets
 */
export async function handleLocalPullCall(
  client: VaulterClient,
  config: VaulterConfig,
  _project: string,
  _environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  try {
    const { all, output } = {
      all: args.all === true,
      output: args.output as string | undefined
    }

    const { baseEnvironment, localSharedCount, overridesCount, result: pullResult } = await runLocalPull({
      client,
      config,
      configDir,
      service,
      all,
      output
    })

    const mergeSummary = `base: ${baseEnvironment} + ${localSharedCount} shared + ${overridesCount} overrides`
    const lines = [`✓ Pulled to ${pullResult.files.length} output(s) (${mergeSummary})`]
    for (const file of pullResult.files) {
      lines.push(`  ${file.output}: ${file.fullPath} (${file.varsCount} vars)`)
    }
    for (const warning of pullResult.warnings) {
      lines.push(`⚠️ ${warning}`)
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }] }
  }
}

/**
 * vaulter_local_set - Set a local override
 */
export async function handleLocalSetCall(
  _config: VaulterConfig,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  const key = args.key as string
  const value = args.value as string
  const service = args.service as string | undefined

  if (!key || value === undefined) {
    return { content: [{ type: 'text', text: 'Error: key and value are required' }] }
  }

  setOverride(configDir, key, value, service)
  return { content: [{ type: 'text', text: `✓ Set local override: ${key}` }] }
}

/**
 * vaulter_local_delete - Remove a local override
 */
export async function handleLocalDeleteCall(
  _config: VaulterConfig,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  const key = args.key as string
  const service = args.service as string | undefined

  if (!key) {
    return { content: [{ type: 'text', text: 'Error: key is required' }] }
  }

  const deleted = deleteOverride(configDir, key, service)
  if (deleted) {
    return { content: [{ type: 'text', text: `✓ Removed local override: ${key}` }] }
  }
  return { content: [{ type: 'text', text: `Override not found: ${key}` }] }
}

/**
 * vaulter_local_diff - Show overrides vs base
 */
export async function handleLocalDiffCall(
  client: VaulterClient,
  config: VaulterConfig,
  _project: string,
  _environment: Environment,
  service: string | undefined,
  _args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  const { baseEnvironment, overrides, diff } = await runLocalDiff({
    client,
    config,
    configDir,
    service
  })

  if (!diff) {
    return { content: [{ type: 'text', text: 'No local overrides. Use vaulter_local_set to add some.' }] }
  }

  const lines = [`Local overrides vs base (${baseEnvironment}):`]
  lines.push('')
  for (const key of diff.added) {
    lines.push(`  + ${key} = ${overrides[key]} (new)`)
  }
  for (const key of diff.modified) {
    lines.push(`  ~ ${key}`)
    lines.push(`    base:     ${diff.baseVars[key]}`)
    lines.push(`    override: ${overrides[key]}`)
  }
  lines.push('')
  lines.push(`Summary: ${diff.added.length} new, ${diff.modified.length} modified, ${diff.baseOnly.length} base-only`)

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * vaulter_local_status - Show local state
 */
export async function handleLocalStatusCall(
  config: VaulterConfig,
  _args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  const service = _args.service as string | undefined
  const status = getLocalStatus(configDir, config, service)

  const lines = [
    'Local Status:',
    `  Base environment:  ${status.baseEnvironment}`,
    '',
    '  Shared vars (all services):',
    `    File:   ${status.sharedExist ? '✓' : '○'} ${status.sharedPath}`,
    `    Count:  ${status.sharedCount}`,
    '',
    '  Overrides (service-specific):',
    `    File:   ${status.overridesExist ? '✓' : '○'} ${status.overridesPath}`,
    `    Count:  ${status.overridesCount}`,
    '',
    `  Snapshots:         ${status.snapshotsCount}`
  ]

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * vaulter_local_shared_set - Set a local shared var
 */
export async function handleLocalSharedSetCall(
  _config: VaulterConfig,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  const key = args.key as string
  const value = args.value as string

  if (!key || value === undefined) {
    return { content: [{ type: 'text', text: 'Error: key and value are required' }] }
  }

  setLocalShared(configDir, key, value)
  return { content: [{ type: 'text', text: `✓ Set local shared: ${key}` }] }
}

/**
 * vaulter_local_shared_delete - Remove a local shared var
 */
export async function handleLocalSharedDeleteCall(
  _config: VaulterConfig,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  const key = args.key as string

  if (!key) {
    return { content: [{ type: 'text', text: 'Error: key is required' }] }
  }

  const deleted = deleteLocalShared(configDir, key)
  if (deleted) {
    return { content: [{ type: 'text', text: `✓ Removed local shared: ${key}` }] }
  }
  return { content: [{ type: 'text', text: `Shared var not found: ${key}` }] }
}

/**
 * vaulter_local_shared_list - List all local shared vars
 */
export async function handleLocalSharedListCall(
  _config: VaulterConfig,
  _args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  const vars = loadLocalShared(configDir)
  const keys = Object.keys(vars)

  if (keys.length === 0) {
    return {
      content: [{
        type: 'text',
        text: 'No local shared vars. Use vaulter_local_shared_set to add some.\nShared vars apply to ALL services in the monorepo.'
      }]
    }
  }

  const lines = [`Local shared vars (${keys.length}):`, '']
  for (const key of keys.sort()) {
    lines.push(`  ${key}=${vars[key]}`)
  }
  lines.push('')
  lines.push('These vars apply to ALL services in the monorepo.')

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * vaulter_snapshot_create - Create a snapshot
 */
export async function handleSnapshotCreateCall(
  client: VaulterClient,
  config: VaulterConfig,
  _project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  const name = args.name as string | undefined
  const snapshot = await snapshotCreate({
    client,
    config,
    configDir,
    environment,
    service,
    name
  })

  return {
    content: [{
      type: 'text',
      text: `✓ Snapshot created: ${snapshot.id}\n  Environment: ${environment}\n  Variables: ${snapshot.varsCount}\n  Checksum: ${snapshot.checksum}\n  Path: ${snapshot.dirPath}`
    }]
  }
}

/**
 * vaulter_snapshot_list - List snapshots
 */
export async function handleSnapshotListCall(
  config: VaulterConfig,
  args: Record<string, unknown>,
  client?: VaulterClient
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  const environment = args.environment as string | undefined
  const snapshots = await snapshotList({
    config,
    configDir,
    environment,
    client
  })

  if (snapshots.length === 0) {
    return { content: [{ type: 'text', text: 'No snapshots found. Create one with vaulter_snapshot_create.' }] }
  }

  const lines = [`Snapshots${environment ? ` (${environment})` : ''}:`, '']
  for (const snap of snapshots) {
    lines.push(`  ${snap.id}`)
    lines.push(`    env: ${snap.environment}  vars: ${snap.varsCount}  ${snap.compression}  ${snap.timestamp}`)
    lines.push(`    checksum: ${snap.checksum}`)
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * vaulter_snapshot_restore - Restore a snapshot to the backend
 */
export async function handleSnapshotRestoreCall(
  client: VaulterClient,
  config: VaulterConfig,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  const id = args.id as string
  if (!id) {
    return { content: [{ type: 'text', text: 'Error: id is required' }] }
  }

  const resultRestore = await snapshotRestore({
    client,
    config,
    configDir,
    project,
    environment,
    service,
    idOrPartial: id
  })

  if (resultRestore.status === 'not_found') {
    return { content: [{ type: 'text', text: `Snapshot not found: ${id}` }] }
  }
  if (resultRestore.status === 'integrity_failed') {
    return {
      content: [{
        type: 'text',
        text: `Snapshot integrity check failed: ${resultRestore.snapshot.id}\n  Expected: ${resultRestore.expected}\n  Actual: ${resultRestore.actual}`
      }]
    }
  }
  if (resultRestore.status === 'load_failed') {
    return { content: [{ type: 'text', text: `Could not load snapshot: ${resultRestore.snapshot.id}` }] }
  }

  return {
    content: [{
      type: 'text',
      text: `✓ Restored ${resultRestore.restoredCount} vars from ${resultRestore.snapshot.id} to ${environment}`
    }]
  }
}
