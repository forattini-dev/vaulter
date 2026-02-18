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
  deleteLocalShared,
  getSharedConfigPath,
  getSharedSecretsPath,
  getServiceConfigPath,
  getServiceSecretsPath,
  validateLocalServiceScope
} from '../../../lib/local.js'
import { runLocalPull, runLocalDiff, runLocalPush, runLocalPushAll, runLocalSync } from '../../../lib/local-ops.js'
import { maskValue } from '../../../lib/masking.js'
import { snapshotCreate, snapshotList, snapshotRestore, type SnapshotSource } from '../../../lib/snapshot-ops.js'

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
 * vaulter_local_pull - OFFLINE-FIRST local pull
 *
 * Generates .env files from local files ONLY - NO backend calls.
 * For each output: shared vars + service-specific vars → .env file
 */
export async function handleLocalPullCall(
  _client: VaulterClient,
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
    const output = args.output as string | undefined
    const all = output
      ? args.all === true
      : true

    const pullResult = await runLocalPull({
      config,
      configDir,
      service,
      all,
      output
    })

    const lines = [`✓ Pulled to ${pullResult.files.length} output(s) [OFFLINE]`]
    lines.push(`  Shared: ${pullResult.localSharedCount} vars`)
    lines.push(`  Service-specific: ${pullResult.totalServiceVarsCount} vars total`)
    lines.push('')

    for (const file of pullResult.files) {
      const breakdown = `${file.sharedCount} shared + ${file.serviceCount} service`
      lines.push(`  ${file.output}: ${file.fullPath} (${file.varsCount} vars = ${breakdown})`)
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
 * vaulter_local_push - Push local overrides to remote backend
 *
 * This allows sharing local development configs with the team.
 */
export async function handleLocalPushCall(
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
    const shared = args.shared === true
    const dryRun = args.dryRun === true || args.dry_run === true
    const targetEnv = args.targetEnvironment as string | undefined
    const scopeCheck = validateLocalServiceScope({
      config,
      service,
      shared,
      command: 'vaulter_local_push'
    })
    if (!scopeCheck.ok) {
      return { content: [{ type: 'text', text: `Error: ${scopeCheck.error}\nHint: ${scopeCheck.hint}` }] }
    }

    const pushResult = await runLocalPush({
      client,
      config,
      configDir,
      service,
      shared,
      dryRun,
      targetEnvironment: targetEnv
    })

    if (pushResult.pushedCount === 0) {
      const source = shared ? 'shared' : service ? `service: ${service}` : 'local'
      return {
        content: [{
          type: 'text',
          text: `No changes to push (${source})${pushResult.unchanged.length > 0 ? `\n${pushResult.unchanged.length} vars already in sync` : ''}`
        }]
      }
    }

    const lines: string[] = []
    const prefix = dryRun ? '[DRY RUN] Would push' : '✓ Pushed'
    lines.push(`${prefix} ${pushResult.pushedCount} var(s) to ${pushResult.targetEnvironment}`)
    lines.push('')

    if (pushResult.added.length > 0) {
      lines.push(`Added (${pushResult.added.length}):`)
      for (const v of pushResult.added) {
        const type = v.sensitive ? 'secret' : 'config'
        const value = v.sensitive ? maskValue(v.value) : v.value
        lines.push(`  + ${v.key} = ${value} (${type})`)
      }
    }

    if (pushResult.updated.length > 0) {
      lines.push(`Updated (${pushResult.updated.length}):`)
      for (const v of pushResult.updated) {
        const type = v.sensitive ? 'secret' : 'config'
        lines.push(`  ~ ${v.key} (${type})`)
      }
    }

    if (pushResult.unchanged.length > 0) {
      lines.push('')
      lines.push(`${pushResult.unchanged.length} var(s) unchanged`)
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }] }
  }
}

/**
 * vaulter_local_set - Set a local override
 *
 * Routes to configs.env or secrets.env based on sensitive flag:
 * - sensitive=true  → secrets.env
 * - sensitive=false → configs.env (default)
 */
export async function handleLocalSetCall(
  config: VaulterConfig,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  const key = args.key as string
  const value = args.value as string
  const service = args.service as string | undefined
  const sensitive = args.sensitive === true

  const scopeCheck = validateLocalServiceScope({
    config,
    service,
    shared: false,
    command: 'vaulter_local_set'
  })
  if (!scopeCheck.ok) {
    return { content: [{ type: 'text', text: `Error: ${scopeCheck.error}\nHint: ${scopeCheck.hint}` }] }
  }

  if (!key || value === undefined) {
    return { content: [{ type: 'text', text: 'Error: key and value are required' }] }
  }

  setOverride(configDir, key, value, service, sensitive)

  const targetFile = sensitive
    ? getServiceSecretsPath(configDir, service)
    : getServiceConfigPath(configDir, service)
  const type = sensitive ? 'secret' : 'config'

  return { content: [{ type: 'text', text: `✓ Set local ${type}: ${key}\n  → ${targetFile}` }] }
}

/**
 * vaulter_local_delete - Remove a local override
 */
export async function handleLocalDeleteCall(
  config: VaulterConfig,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  const key = args.key as string
  const service = args.service as string | undefined

  const scopeCheck = validateLocalServiceScope({
    config,
    service,
    shared: false,
    command: 'vaulter_local_delete'
  })
  if (!scopeCheck.ok) {
    return { content: [{ type: 'text', text: `Error: ${scopeCheck.error}\nHint: ${scopeCheck.hint}` }] }
  }

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

  const scopeCheck = validateLocalServiceScope({
    config,
    service,
    shared: false,
    command: 'vaulter_local_diff'
  })
  if (!scopeCheck.ok) {
    return { content: [{ type: 'text', text: `Error: ${scopeCheck.error}\nHint: ${scopeCheck.hint}` }] }
  }

  const { baseEnvironment, overrides, diff } = await runLocalDiff({
    client,
    config,
    configDir,
    service
  })

  if (!diff) {
    return { content: [{ type: 'text', text: 'No local overrides. Use vaulter_local_set to add some.' }] }
  }

  const lines = [`Local overrides vs base (${baseEnvironment}):`, '']
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

  const lines = ['Local Status:']
  lines.push(`  Base environment:  ${status.baseEnvironment}`)
  lines.push('')
  lines.push('  Shared vars (all services):')
  lines.push(`    Path:    ${status.sharedExist ? '✓' : '○'} ${status.sharedPath}`)
  lines.push(`    Config:  ${status.sharedConfigCount} vars`)
  lines.push(`    Secrets: ${status.sharedSecretsCount} vars`)
  lines.push('')
  lines.push(`  Overrides${service ? ` (service: ${service})` : ' (default)'}:`)
  lines.push(`    Path:    ${status.overridesExist ? '✓' : '○'} ${status.overridesPath}`)
  lines.push(`    Config:  ${status.overridesConfigCount} vars`)
  lines.push(`    Secrets: ${status.overridesSecretsCount} vars`)
  lines.push('')
  lines.push(`  Snapshots:         ${status.snapshotsCount}`)

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * vaulter_local_shared_set - Set a local shared var
 *
 * Routes to configs.env or secrets.env based on sensitive flag:
 * - sensitive=true  → shared/secrets.env
 * - sensitive=false → shared/configs.env (default)
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
  const sensitive = args.sensitive === true

  if (!key || value === undefined) {
    return { content: [{ type: 'text', text: 'Error: key and value are required' }] }
  }

  setLocalShared(configDir, key, value, sensitive)

  const targetFile = sensitive
    ? getSharedSecretsPath(configDir)
    : getSharedConfigPath(configDir)
  const type = sensitive ? 'secret' : 'config'

  return { content: [{ type: 'text', text: `✓ Set local shared ${type}: ${key}\n  → ${targetFile}` }] }
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
 * vaulter_local_push_all - Push entire .vaulter/local/ structure to backend
 *
 * This pushes:
 * - .vaulter/local/configs.env + secrets.env → backend __shared__
 * - .vaulter/local/services/{svc}/configs.env + secrets.env → backend {svc}
 *
 * With overwrite=true, also DELETES backend vars that don't exist locally.
 */
export async function handleLocalPushAllCall(
  client: VaulterClient,
  config: VaulterConfig,
  _project: string,
  _environment: Environment,
  _service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  try {
    const dryRun = args.dryRun === true || args.dry_run === true
    const targetEnv = args.targetEnvironment as string | undefined
    const overwrite = args.overwrite === true

    const pushResult = await runLocalPushAll({
      client,
      config,
      configDir,
      dryRun,
      targetEnvironment: targetEnv,
      overwrite
    })

    if (pushResult.totalPushed === 0 && pushResult.totalDeleted === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No changes to make. Add vars to .vaulter/local/ or use overwrite=true to sync.'
        }]
      }
    }

    const lines: string[] = []

    // Summary line
    const parts: string[] = []
    if (pushResult.totalPushed > 0) parts.push(`pushed ${pushResult.totalPushed}`)
    if (pushResult.totalDeleted > 0) parts.push(`deleted ${pushResult.totalDeleted}`)
    const prefix = dryRun ? '[DRY RUN] Would' : '✓'
    lines.push(`${prefix} ${parts.join(', ')} var(s) in ${pushResult.targetEnvironment}`)
    lines.push('')

    // Pushed breakdown
    lines.push(`Shared: ${pushResult.shared.configs} configs, ${pushResult.shared.secrets} secrets`)
    for (const [svc, counts] of Object.entries(pushResult.services)) {
      lines.push(`${svc}: ${counts.configs} configs, ${counts.secrets} secrets`)
    }

    // Deleted breakdown
    if (pushResult.totalDeleted > 0) {
      lines.push('')
      lines.push(`Deleted from backend (${pushResult.totalDeleted}):`)
      if (pushResult.deleted.shared.length > 0) {
        lines.push(`  Shared: ${pushResult.deleted.shared.join(', ')}`)
      }
      for (const [svc, keys] of Object.entries(pushResult.deleted.services)) {
        if (keys.length > 0) {
          lines.push(`  ${svc}: ${keys.join(', ')}`)
        }
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }] }
  }
}

/**
 * vaulter_local_sync - Pull from backend to .vaulter/local/
 *
 * This syncs the team's shared variables to your local environment.
 * The opposite of vaulter_local_push_all.
 */
export async function handleLocalSyncCall(
  client: VaulterClient,
  config: VaulterConfig,
  _project: string,
  _environment: Environment,
  _service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const result = getConfigDirOrError()
  if ('error' in result) return result.error
  const { configDir } = result

  try {
    const dryRun = args.dryRun === true || args.dry_run === true
    const sourceEnv = args.sourceEnvironment as string | undefined

    const syncResult = await runLocalSync({
      client,
      config,
      configDir,
      sourceEnvironment: sourceEnv,
      dryRun
    })

    if (syncResult.totalSynced === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No variables to sync from backend.'
        }]
      }
    }

    const prefix = dryRun ? '[DRY RUN] Would sync' : '✓ Synced'
    const lines = [`${prefix} ${syncResult.totalSynced} var(s) from ${syncResult.sourceEnvironment} to .vaulter/local/`]
    lines.push('')
    lines.push(`Shared: ${syncResult.shared.configs} configs, ${syncResult.shared.secrets} secrets`)

    for (const [svc, counts] of Object.entries(syncResult.services)) {
      lines.push(`${svc}: ${counts.configs} configs, ${counts.secrets} secrets`)
    }

    if (!dryRun) {
      lines.push('')
      lines.push('Run vaulter_local_pull to generate .env files')
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }] }
  }
}

/**
 * vaulter_snapshot_create - Create a snapshot
 *
 * Sources:
 * - cloud: Backup from remote backend (default)
 * - local: Backup from local overrides only
 * - merged: Backup of merged state (cloud + local)
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
  const sourceArg = (args.source as string | undefined) || 'cloud'

  const validSources: SnapshotSource[] = ['cloud', 'local', 'merged']
  if (!validSources.includes(sourceArg as SnapshotSource)) {
    return {
      content: [{
        type: 'text',
        text: `Error: Invalid source '${sourceArg}'. Valid sources: ${validSources.join(', ')}`
      }]
    }
  }

  const source = sourceArg as SnapshotSource

  const snapshot = await snapshotCreate({
    client,
    config,
    configDir,
    environment,
    service,
    name,
    source
  })

  return {
    content: [{
      type: 'text',
      text: `✓ Snapshot created: ${snapshot.id}\n  Source: ${source}\n  Environment: ${environment}\n  Variables: ${snapshot.varsCount}\n  Checksum: ${snapshot.checksum}\n  Path: ${snapshot.dirPath}`
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
