/**
 * Vaulter MCP Tools - Utility Handlers
 *
 * Handlers for copy, rename, promote_shared, demote_shared operations
 * These tools enable full agent autonomy without manual workarounds
 */

import { VaulterClient } from '../../../client.js'
import { SHARED_SERVICE } from '../../../lib/shared.js'
import {
  collectScopePolicyIssues,
  formatScopePolicySummary,
  getScopeLabelFromParsed,
  hasBlockingPolicyIssues,
  parseScopeSpec,
  resolveScopePolicy
} from '../../../lib/scope-policy.js'
import { handleDeleteCall, handleSetCall } from './core.js'
import { compileGlobPatterns } from '../../../lib/pattern-matcher.js'
import type { Environment, EnvVar, VaulterConfig } from '../../../types.js'
import type { ToolResponse } from '../config.js'

interface VariableSnapshot {
  existed: boolean
  value: string
  tags?: string[]
  sensitive?: boolean
  metadata?: EnvVar['metadata']
}

function snapshotVariable(variable: EnvVar | null): VariableSnapshot | undefined {
  if (!variable) return undefined

  return {
    existed: true,
    value: variable.value,
    tags: variable.tags ? [...variable.tags] : undefined,
    sensitive: variable.sensitive,
    metadata: variable.metadata ? { ...variable.metadata } : undefined
  }
}

async function restoreVariable(
  client: VaulterClient,
  key: string,
  project: string,
  environment: Environment,
  service: string,
  snapshot: VariableSnapshot | undefined
): Promise<void> {
  if (!snapshot || !snapshot.existed) {
    await client.delete(key, project, environment, service)
    return
  }

  await client.set({
    key,
    value: snapshot.value,
    project,
    environment,
    service,
    tags: snapshot.tags,
    sensitive: snapshot.sensitive,
    metadata: snapshot.metadata
  })
}

/**
 * Copy variables from one environment to another
 */
export async function handleCopyCall(
  client: VaulterClient,
  project: string,
  _environment: Environment, // Not used - we use source/target
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const source = args.source as Environment
  const target = args.target as Environment
  const keys = args.keys as string[] | undefined
  const pattern = args.pattern as string | undefined
  const overwrite = args.overwrite === true
  const dryRun = args.dryRun === true

  // Get all vars from source
  const sourceVars = await client.list({ project, environment: source, service })

  // Filter by keys or pattern
  let varsToProcess = sourceVars
  if (keys && keys.length > 0) {
    const keySet = new Set(keys)
    varsToProcess = sourceVars.filter(v => keySet.has(v.key))
  } else if (pattern) {
    const matcher = compileGlobPatterns([pattern])
    varsToProcess = sourceVars.filter(v => matcher(v.key))
  }

  if (varsToProcess.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No variables found to copy from ${source} to ${target}`
      }]
    }
  }

  // Check for existing vars in target (if not overwriting)
  const targetVars = await client.list({ project, environment: target, service })
  const targetKeys = new Set(targetVars.map(v => v.key))

  const toCopy: Array<{ key: string; value: string; tags?: string[] }> = []
  const skipped: string[] = []

  for (const v of varsToProcess) {
    if (targetKeys.has(v.key) && !overwrite) {
      skipped.push(v.key)
    } else {
      toCopy.push({ key: v.key, value: v.value, tags: v.tags })
    }
  }

  if (dryRun) {
    const lines = [
      `Dry run: Would copy ${toCopy.length} variables from ${source} to ${target}`,
      '',
      'Would copy:',
      ...toCopy.map(v => `  - ${v.key}`),
    ]
    if (skipped.length > 0) {
      lines.push('', 'Would skip (already exist, use overwrite=true):')
      lines.push(...skipped.map(k => `  - ${k}`))
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  // Perform the copy
  let copied = 0
  for (const v of toCopy) {
    await client.set({
      key: v.key,
      value: v.value,
      project,
      environment: target,
      service,
      tags: v.tags,
      metadata: { source: 'copy', copiedFrom: source }
    })
    copied++
  }

  const lines = [
    `✓ Copied ${copied} variables from ${source} to ${target}`,
  ]
  if (skipped.length > 0) {
    lines.push(`  Skipped ${skipped.length} existing vars (use overwrite=true to replace)`)
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Rename a variable (atomic: get + set new + delete old)
 */
export async function handleRenameCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const oldKey = args.oldKey as string
  const newKey = args.newKey as string

  // Get the existing variable
  const existing = await client.get(oldKey, project, environment, service)
  if (!existing) {
    return {
      content: [{
        type: 'text',
        text: `Variable ${oldKey} not found in ${project}/${environment}`
      }]
    }
  }

  // Check if new key already exists
  const newExists = await client.get(newKey, project, environment, service)
  if (newExists) {
    return {
      content: [{
        type: 'text',
        text: `Cannot rename: ${newKey} already exists. Delete it first or choose a different name.`
      }]
    }
  }

  const sourceState = snapshotVariable(existing)
  const targetState = snapshotVariable(newExists)

  try {
    // Set the new key with same value and metadata
    await client.set({
      key: newKey,
      value: existing.value,
      project,
      environment,
      service: service || SHARED_SERVICE,
      tags: existing.tags,
      metadata: {
        ...existing.metadata,
        source: 'rename',
        renamedFrom: oldKey
      }
    })

    // Delete the old key
    await client.delete(oldKey, project, environment, service || SHARED_SERVICE)
  } catch (error) {
    const rollbackErrors: string[] = []

    try {
      await restoreVariable(client, newKey, project, environment, service || SHARED_SERVICE, targetState)
    } catch (rollbackError) {
      rollbackErrors.push(`Destination rollback failed: ${(rollbackError as Error).message}`)
    }

    try {
      await restoreVariable(client, oldKey, project, environment, service || SHARED_SERVICE, sourceState)
    } catch (rollbackError) {
      rollbackErrors.push(`Source rollback failed: ${(rollbackError as Error).message}`)
    }

    return {
      content: [{
        type: 'text',
        text: rollbackErrors.length === 0
          ? `Rename failed for ${oldKey}. Rolled back successfully.`
          : `Rename failed for ${oldKey}. Rollback issues: ${rollbackErrors.join(' | ')}`
      }]
    }
  }

  return {
    content: [{
      type: 'text',
      text: `✓ Renamed ${oldKey} → ${newKey} in ${project}/${environment}`
    }]
  }
}

/**
 * Promote a service variable to shared scope
 */
export async function handlePromoteSharedCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  _service: string | undefined, // Not used - we use fromService
  config: VaulterConfig | null,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const key = args.key as string
  const fromService = args.fromService as string
  const deleteOriginal = args.deleteOriginal !== false // Default true

  // Get the variable from service scope
  const existing = await client.get(key, project, environment, fromService)
  if (!existing) {
    return {
      content: [{
        type: 'text',
        text: `Variable ${key} not found in service ${fromService}`
      }]
    }
  }

  // Check if already exists in shared
  const sharedExists = await client.get(key, project, environment, SHARED_SERVICE)
  if (sharedExists) {
    return {
      content: [{
        type: 'text',
        text: `Variable ${key} already exists in shared scope. Delete it first or use a different approach.`
      }]
    }
  }

  const policy = resolveScopePolicy(config?.scope_policy)
  const policyChecks = collectScopePolicyIssues([key], {
    scope: 'shared',
    service: undefined,
    policyMode: policy.policyMode,
    rules: policy.rules
  })
  const policyIssues = policyChecks.flatMap((check) => check.issues)

  if (policyIssues.length > 0) {
    const policyBlocked = hasBlockingPolicyIssues(policyChecks)
    const lines = ['⚠️ Scope policy check:']
    lines.push(formatScopePolicySummary(policyIssues))
    for (const warning of policy.warnings) {
      lines.push(`⚠️ ${warning}`)
    }

    if (policyBlocked) {
      lines.push('')
      lines.push('Scope policy blocked this change.')
      lines.push('Set VAULTER_SCOPE_POLICY=warn or VAULTER_SCOPE_POLICY=off to continue.')

      return {
        content: [{
          type: 'text',
          text: lines.join('\n')
        }]
      }
    }
  }

  const sourceState = snapshotVariable(existing)
  const targetState = snapshotVariable(sharedExists)

  try {
    // Set in shared scope
    await client.set({
      key,
      value: existing.value,
      project,
      environment,
      service: SHARED_SERVICE,
      tags: existing.tags,
      sensitive: existing.sensitive,
      metadata: {
        ...existing.metadata,
        source: 'promote',
        promotedFrom: fromService
      }
    })

    // Delete from service scope if requested
    if (deleteOriginal) {
      await client.delete(key, project, environment, fromService)
    }
  } catch (error) {
    const rollbackErrors: string[] = []

    try {
      await restoreVariable(client, key, project, environment, SHARED_SERVICE, targetState)
    } catch (rollbackError) {
      rollbackErrors.push(`Shared rollback failed: ${(rollbackError as Error).message}`)
    }

    if (deleteOriginal) {
      try {
        await restoreVariable(client, key, project, environment, fromService, sourceState)
      } catch (rollbackError) {
        rollbackErrors.push(`Service rollback failed: ${(rollbackError as Error).message}`)
      }
    }

    return {
      content: [{
        type: 'text',
        text: rollbackErrors.length === 0
          ? `Promote failed for ${key}. Rolled back successfully.`
          : `Promote failed for ${key}. Rollback issues: ${rollbackErrors.join(' | ')}`
      }]
    }
  }

  const action = deleteOriginal ? 'Promoted (moved)' : 'Promoted (copied)'
  return {
    content: [{
      type: 'text',
      text: `✓ ${action} ${key} from ${fromService} → shared`
    }]
  }
}

/**
 * Demote a shared variable to a specific service
 */
export async function handleDemoteSharedCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  _service: string | undefined, // Not used - we use toService
  config: VaulterConfig | null,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const key = args.key as string
  const toService = args.toService as string
  const deleteShared = args.deleteShared !== false // Default true

  // Get the variable from shared scope
  const existing = await client.get(key, project, environment, SHARED_SERVICE)
  if (!existing) {
    return {
      content: [{
        type: 'text',
        text: `Variable ${key} not found in shared scope`
      }]
    }
  }

  // Check if already exists in target service
  const serviceExists = await client.get(key, project, environment, toService)
  if (serviceExists) {
    return {
      content: [{
        type: 'text',
        text: `Variable ${key} already exists in service ${toService}. Delete it first or use a different approach.`
      }]
    }
  }

  const policy = resolveScopePolicy(config?.scope_policy)
  const policyChecks = collectScopePolicyIssues([key], {
    scope: 'service',
    service: toService,
    policyMode: policy.policyMode,
    rules: policy.rules
  })
  const policyIssues = policyChecks.flatMap((check) => check.issues)

  if (policyIssues.length > 0) {
    const policyBlocked = hasBlockingPolicyIssues(policyChecks)
    const lines = ['⚠️ Scope policy check:']
    lines.push(formatScopePolicySummary(policyIssues))
    for (const warning of policy.warnings) {
      lines.push(`⚠️ ${warning}`)
    }

    if (policyBlocked) {
      lines.push('')
      lines.push('Scope policy blocked this change.')
      lines.push('Set VAULTER_SCOPE_POLICY=warn or VAULTER_SCOPE_POLICY=off to continue.')

      return {
        content: [{
          type: 'text',
          text: lines.join('\n')
        }]
      }
    }
  }

  const sourceState = snapshotVariable(existing)
  const targetState = snapshotVariable(serviceExists)

  try {
    // Set in service scope
    await client.set({
      key,
      value: existing.value,
      project,
      environment,
      service: toService,
      tags: existing.tags,
      sensitive: existing.sensitive,
      metadata: {
        ...existing.metadata,
        source: 'demote',
        demotedTo: toService
      }
    })

    // Delete from shared scope if requested
    if (deleteShared) {
      await client.delete(key, project, environment, SHARED_SERVICE)
    }
  } catch (error) {
    const rollbackErrors: string[] = []

    try {
      await restoreVariable(client, key, project, environment, toService, targetState)
    } catch (rollbackError) {
      rollbackErrors.push(`Service rollback failed: ${(rollbackError as Error).message}`)
    }

    if (deleteShared) {
      try {
        await restoreVariable(client, key, project, environment, SHARED_SERVICE, sourceState)
      } catch (rollbackError) {
        rollbackErrors.push(`Shared rollback failed: ${(rollbackError as Error).message}`)
      }
    }

    return {
      content: [{
        type: 'text',
        text: rollbackErrors.length === 0
          ? `Demote failed for ${key}. Rolled back successfully.`
          : `Demote failed for ${key}. Rollback issues: ${rollbackErrors.join(' | ')}`
      }]
    }
  }

  const action = deleteShared ? 'Demoted (moved)' : 'Demoted (copied)'
  return {
    content: [{
      type: 'text',
      text: `✓ ${action} ${key} from shared → ${toService}`
    }]
  }
}

/**
 * Move a variable between scopes in one command
 */
export async function handleMoveCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  _service: string | undefined, // Not used - source is explicit via --from
  config: VaulterConfig | null,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const key = args.key as string
  const fromRaw = args.from as string | undefined
  const toRaw = args.to as string | undefined
  const overwrite = args.overwrite === true
  const deleteOriginal = args.deleteOriginal !== false
  const dryRun = args.dryRun === true

  if (!key) {
    return {
      content: [{
        type: 'text',
        text: 'Error: key is required'
      }]
    }
  }

  if (!fromRaw || !toRaw) {
    return {
      content: [{
        type: 'text',
        text: 'Error: both `from` and `to` are required (e.g., from="shared", to="service:api")'
      }]
    }
  }

  const fromScope = parseScopeSpec(fromRaw)
  const toScope = parseScopeSpec(toRaw)

  if (!fromScope) {
    return {
      content: [{
        type: 'text',
        text: `Error: invalid --from value "${fromRaw}". Use "shared", "service:<name>", or "<service>"`
      }]
    }
  }

  if (!toScope) {
    return {
      content: [{
        type: 'text',
        text: `Error: invalid --to value "${toRaw}". Use "shared", "service:<name>", or "<service>"`
      }]
    }
  }

  if (fromScope.mode === toScope.mode) {
    if (fromScope.mode === 'shared' || fromScope.service === toScope.service) {
      return {
        content: [{
          type: 'text',
          text: 'Error: source and destination are the same scope'
        }]
      }
    }
  }

  const sourceService = fromScope.mode === 'shared' ? SHARED_SERVICE : fromScope.service
  const targetService = toScope.mode === 'shared' ? SHARED_SERVICE : toScope.service
  const sourceLabel = getScopeLabelFromParsed(fromScope)
  const targetLabel = getScopeLabelFromParsed(toScope)
  const policy = resolveScopePolicy(config?.scope_policy)

  // Validate destination scope policy before mutating
  const policyChecks = collectScopePolicyIssues([key], {
    scope: toScope.mode,
    service: toScope.service,
    policyMode: policy.policyMode,
    rules: policy.rules
  })
  const policyIssues = policyChecks.flatMap((check) => check.issues)
  if (policyIssues.length > 0) {
    const policyBlocked = hasBlockingPolicyIssues(policyChecks)
    const lines = [
      `⚠️ Scope policy check for ${key}:`,
      formatScopePolicySummary(policyIssues)
    ]
    for (const warning of policy.warnings) {
      lines.push(`⚠️ ${warning}`)
    }

    if (policyBlocked) {
      lines.push('')
      lines.push('Scope policy blocked this change.')
      lines.push('Set VAULTER_SCOPE_POLICY=warn or VAULTER_SCOPE_POLICY=off to continue.')

      return {
        content: [{
          type: 'text',
          text: lines.join('\n')
        }]
      }
    }
  }

  const sourceVar = await client.get(key, project, environment, sourceService)
  if (!sourceVar) {
    return {
      content: [{
        type: 'text',
        text: `Error: variable ${key} not found in ${sourceLabel}`
      }]
    }
  }

  const existingTarget = await client.get(key, project, environment, targetService)
  if (existingTarget && !overwrite) {
    return {
      content: [{
        type: 'text',
        text: `Error: destination already has ${key} in ${targetLabel}. Use overwrite=true to replace it.`
      }]
    }
  }

  if (dryRun) {
    const action = deleteOriginal ? 'move' : 'copy'
    const overwriteHint = overwrite ? ' (overwrite allowed)' : ' (overwrite disabled)'
    return {
      content: [{
        type: 'text',
        text: `Dry run: would ${action} ${key} from ${sourceLabel} to ${targetLabel} in ${project}/${environment}${overwriteHint}`
      }]
    }
  }

  const policyHint = deleteOriginal ? 'Moved' : 'Copied'
  const sourceState = snapshotVariable(sourceVar)
  const targetState = snapshotVariable(existingTarget)
  const now = new Date().toISOString()

  try {
    await client.set({
      key,
      value: sourceVar.value,
      project,
      environment,
      service: targetService,
      tags: sourceVar.tags,
      sensitive: sourceVar.sensitive,
      metadata: {
        ...(sourceVar.metadata || {}),
        source: 'mcp',
        movedFrom: sourceLabel,
        movedTo: targetLabel,
        movedAt: now
      }
    })

    if (deleteOriginal) {
      await client.delete(key, project, environment, sourceService)
    }
  } catch (error) {
    const rollbackErrors: string[] = []

    try {
      await restoreVariable(client, key, project, environment, targetService, targetState)
    } catch (rollbackError) {
      rollbackErrors.push(`Destination rollback failed: ${(rollbackError as Error).message}`)
    }

    try {
      await restoreVariable(client, key, project, environment, sourceService, sourceState)
    } catch (rollbackError) {
      rollbackErrors.push(`Source restore failed: ${(rollbackError as Error).message}`)
    }

    const message = rollbackErrors.length > 0
      ? `Move failed for ${key}: ${(error as Error).message}. Rollback issues: ${rollbackErrors.join(' | ')}`
      : `Move failed for ${key}: ${(error as Error).message}`

    return {
      content: [{
        type: 'text',
        text: message
      }]
    }
  }

  return {
    content: [{
      type: 'text',
      text: `✓ ${policyHint} ${key} from ${sourceLabel} to ${targetLabel} in ${project}/${environment}`
    }]
  }
}

export async function handleChangeCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  config: VaulterConfig | null,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const action = (args.action as string | undefined)?.toLowerCase()
  const key = args.key as string | undefined

  if (!action) {
    return {
      content: [{ type: 'text', text: 'Error: action is required (set, delete, move)' }]
    }
  }

  if (!key) {
    return {
      content: [{ type: 'text', text: 'Error: key is required' }]
    }
  }

  if (action === 'set') {
    const value = args.value
    if (typeof value !== 'string') {
      return {
        content: [{
          type: 'text',
          text: 'Error: value must be a string for set action'
        }]
      }
    }

    return handleSetCall(client, project, environment, service, config, {
      key,
      value,
      tags: args.tags,
      shared: args.shared,
      sensitive: args.sensitive,
      dryRun: args.dryRun
    })
  }

  if (action === 'delete') {
    const deleteScopeService = args.shared === true ? SHARED_SERVICE : service
    return handleDeleteCall(
      client,
      project,
      environment,
      deleteScopeService,
      { key, dryRun: args.dryRun }
    )
  }

  if (action === 'move') {
    const fromRaw = args.from as string | undefined
    const toRaw = args.to as string | undefined
    if (!fromRaw || !toRaw) {
      return {
        content: [{ type: 'text', text: 'Error: from and to are required for move action' }]
      }
    }

    return handleMoveCall(client, project, environment, service, config, {
      key,
      from: fromRaw,
      to: toRaw,
      overwrite: args.overwrite,
      deleteOriginal: args.deleteOriginal ?? true,
      dryRun: args.dryRun
    })
  }

  return {
    content: [{
      type: 'text',
      text: `Error: unsupported action "${action}". Supported: set, delete, move`
    }]
  }
}
