/**
 * Vaulter MCP Tools - Local & Snapshot Handlers
 */

import type { VaulterClient } from '../../../client.js'
import type { VaulterConfig, Environment } from '../../../types.js'
import type { ToolResponse } from '../config.js'
import { findConfigDir } from '../../../lib/config-loader.js'
import {
  loadOverrides,
  setOverride,
  deleteOverride,
  diffOverrides,
  mergeWithOverrides,
  getLocalStatus,
  resolveBaseEnvironment
} from '../../../lib/local.js'
import {
  createSnapshotDriver
} from '../../../lib/snapshot.js'
import { pullToOutputs, getSharedServiceVars } from '../../../lib/outputs.js'
import path from 'node:path'

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
 * vaulter_local_pull - Base env + overrides → output targets
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

  const baseEnv = resolveBaseEnvironment(config)
  const overrides = loadOverrides(configDir, service)
  const all = args.all === true
  const output = args.output as string | undefined

  if (!all && !output) {
    return { content: [{ type: 'text', text: 'Error: Requires all=true or output=<name>' }] }
  }

  if (!config.outputs || Object.keys(config.outputs).length === 0) {
    return { content: [{ type: 'text', text: 'Error: No outputs defined in config' }] }
  }

  const projectRoot = path.dirname(configDir)
  const baseVars = await client.export(config.project, baseEnv, service)
  const merged = mergeWithOverrides(baseVars, overrides)
  const sharedServiceVars = await getSharedServiceVars(client, config.project, baseEnv)

  const pullResult = await pullToOutputs({
    client,
    config,
    environment: baseEnv,
    projectRoot,
    all,
    output,
    varsOverride: merged,
    sharedVarsOverride: sharedServiceVars
  })

  const lines = [`✓ Pulled to ${pullResult.files.length} output(s) (base: ${baseEnv} + ${Object.keys(overrides).length} overrides)`]
  for (const file of pullResult.files) {
    lines.push(`  ${file.output}: ${file.fullPath} (${file.varsCount} vars)`)
  }
  for (const warning of pullResult.warnings) {
    lines.push(`⚠️ ${warning}`)
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
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

  const baseEnv = resolveBaseEnvironment(config)
  const overrides = loadOverrides(configDir, service)

  if (Object.keys(overrides).length === 0) {
    return { content: [{ type: 'text', text: 'No local overrides. Use vaulter_local_set to add some.' }] }
  }

  const baseVars = await client.export(config.project, baseEnv, service)
  const diff = diffOverrides(baseVars, overrides)

  const lines = [`Local overrides vs base (${baseEnv}):`]
  lines.push('')
  for (const key of diff.added) {
    lines.push(`  + ${key} = ${overrides[key]} (new)`)
  }
  for (const key of diff.modified) {
    lines.push(`  ~ ${key}`)
    lines.push(`    base:     ${baseVars[key]}`)
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
    `  Overrides file:    ${status.overridesExist ? '✓' : '✗'} ${status.overridesPath}`,
    `  Overrides count:   ${status.overridesCount}`,
    `  Snapshots:         ${status.snapshotsCount}`
  ]

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
  const vars = await client.export(config.project, environment, service)
  const driver = createSnapshotDriver(configDir, config.snapshots, client.getDatabase())
  const snapshot = await driver.create(environment, vars, { name, project: config.project, service })

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
  const driver = createSnapshotDriver(configDir, config.snapshots, client?.getDatabase())
  const snapshots = await driver.list(environment)

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

  const driver = createSnapshotDriver(configDir, config.snapshots, client.getDatabase())
  const snapshot = await driver.find(id)
  if (!snapshot) {
    return { content: [{ type: 'text', text: `Snapshot not found: ${id}` }] }
  }

  // Verify integrity
  const verification = await driver.verify(snapshot.id)
  if (verification && !verification.valid) {
    return { content: [{ type: 'text', text: `Snapshot integrity check failed: ${snapshot.id}\n  Expected: ${verification.expected}\n  Actual: ${verification.actual}` }] }
  }

  // If the driver supports direct restore (s3db), use it
  if (driver.restore) {
    const count = await driver.restore(snapshot.id, project, environment, service)
    return {
      content: [{
        type: 'text',
        text: `✓ Restored ${count} vars from ${snapshot.id} to ${environment}`
      }]
    }
  }

  // Filesystem driver: load + setMany
  const vars = await driver.load(snapshot.id)
  if (!vars) {
    return { content: [{ type: 'text', text: `Could not load snapshot: ${snapshot.id}` }] }
  }

  const inputs = Object.entries(vars).map(([key, value]) => ({
    key,
    value,
    project,
    environment,
    service
  }))

  await client.setMany(inputs)

  return {
    content: [{
      type: 'text',
      text: `✓ Restored ${inputs.length} vars from ${snapshot.id} to ${environment}`
    }]
  }
}
