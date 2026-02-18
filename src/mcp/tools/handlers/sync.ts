/**
 * Vaulter MCP Tools - Sync Handlers
 *
 * Handlers for sync, pull, push operations
 */

import fs from 'node:fs'
import path from 'node:path'
import { VaulterClient } from '../../../client.js'
import {
  findConfigDir,
  getEnvFilePath,
  getEnvFilePathForConfig
} from '../../../lib/config-loader.js'
import { isMonorepoFromConfig } from '../../../lib/monorepo.js'
import { checkValuesForEncoding } from '../../../lib/encoding-detection.js'
import { parseEnvFile, serializeEnv } from '../../../lib/env-parser.js'
import { evaluateWriteGuard, formatWriteGuardLines } from '../../../lib/write-guard.js'
import { compileGlobPatterns } from '../../../lib/pattern-matcher.js'
import { SHARED_SERVICE } from '../../../lib/shared.js'
import { normalizePlanSummary, writeSyncPlanArtifact } from '../../../lib/sync-plan.js'
import type { VaulterConfig, Environment } from '../../../types.js'
import type { ToolResponse } from '../config.js'

interface EnvDiff {
  added: string[]
  updated: string[]
  deleted: string[]
  unchanged: string[]
}

function getPlanOutputFromArgs(args: Record<string, unknown>): string | undefined {
  const rawValue = (args['plan-output'] as string) || (args.planOutput as string)
  if (typeof rawValue !== 'string') return undefined
  const normalized = rawValue.trim()
  return normalized.length > 0 ? normalized : undefined
}

function getEnvDiff(before: Record<string, string>, after: Record<string, string>): EnvDiff {
  const keys = new Set<string>([
    ...Object.keys(before),
    ...Object.keys(after)
  ])

  const diff: EnvDiff = {
    added: [],
    updated: [],
    deleted: [],
    unchanged: []
  }

  for (const key of keys) {
    const beforeValue = before[key]
    const afterValue = after[key]

    if (beforeValue === undefined) {
      diff.added.push(key)
      continue
    }
    if (afterValue === undefined) {
      diff.deleted.push(key)
      continue
    }
    if (beforeValue === afterValue) {
      diff.unchanged.push(key)
      continue
    }
    diff.updated.push(key)
  }

  return diff
}

async function emitPullPlanArtifact(
  args: Record<string, unknown>,
  project: string,
  environment: Environment,
  service: string | undefined,
  payload: {
    status: 'planned' | 'applied' | 'blocked' | 'failed'
    localCount: number
    remoteCount: number
    sourcePath: string
    changes: EnvDiff
    notes?: string[]
    guardWarnings?: string[]
    encodingWarnings?: Array<{ key: string; message: string }>
  }
): Promise<void> {
  const planOutput = getPlanOutputFromArgs(args)
  if (!planOutput) return

  const summary = normalizePlanSummary({
    operation: 'pull',
    project,
    environment,
    service,
    apply: payload.status === 'applied',
    dryRun: payload.status === 'planned',
    status: payload.status,
    source: {
      inputPath: payload.sourcePath
    },
    counts: {
      local: payload.localCount,
      remote: payload.remoteCount,
      plannedChangeCount: payload.changes.added.length + payload.changes.updated.length + payload.changes.deleted.length,
      unchangedCount: payload.changes.unchanged.length
    },
    changes: {
      added: payload.changes.added,
      updated: payload.changes.updated,
      deleted: payload.changes.deleted,
      unchanged: payload.changes.unchanged,
      localAdded: [],
      localUpdated: [],
      localDeleted: [],
      conflicts: []
    },
    notes: payload.notes || [],
    missingRequired: [],
    guardWarnings: payload.guardWarnings || [],
    encodingWarnings: payload.encodingWarnings || []
  })

  try {
    writeSyncPlanArtifact(summary, {
      operation: 'pull',
      project,
      environment,
      service,
      outputPath: planOutput
    })
  } catch {}
}

async function emitPushPlanArtifact(
  args: Record<string, unknown>,
  project: string,
  environment: Environment,
  service: string | undefined,
  payload: {
    status: 'planned' | 'applied' | 'blocked' | 'failed'
    localCount: number
    remoteCount: number
    changes: EnvDiff
    sourcePath: string
    notes?: string[]
    guardWarnings?: string[]
    encodingWarnings?: Array<{ key: string; message: string }>
    prune?: boolean
  }
): Promise<void> {
  const planOutput = getPlanOutputFromArgs(args)
  if (!planOutput) return

  const summary = normalizePlanSummary({
    operation: 'push',
    project,
    environment,
    service,
    apply: payload.status === 'applied',
    dryRun: payload.status === 'planned',
    status: payload.status,
    prune: payload.prune || false,
    notes: payload.notes || [],
    source: {
      inputPath: payload.sourcePath
    },
    counts: {
      local: payload.localCount,
      remote: payload.remoteCount,
      plannedChangeCount: payload.changes.added.length + payload.changes.updated.length + payload.changes.deleted.length,
      unchangedCount: payload.changes.unchanged.length
    },
    changes: {
      added: payload.changes.added,
      updated: payload.changes.updated,
      deleted: payload.changes.deleted,
      unchanged: payload.changes.unchanged,
      localAdded: [],
      localUpdated: [],
      localDeleted: [],
      conflicts: []
    },
    missingRequired: [],
    guardWarnings: payload.guardWarnings || [],
    encodingWarnings: payload.encodingWarnings || []
  })

  try {
    writeSyncPlanArtifact(summary, {
      operation: 'push',
      project,
      environment,
      service,
      outputPath: planOutput
    })
  } catch {}
}

async function emitSyncPlanArtifact(
  args: Record<string, unknown>,
  project: string,
  environment: Environment,
  service: string | undefined,
  payload: {
    status: 'planned' | 'applied' | 'blocked' | 'failed'
    localCount: number
    remoteCount: number
    changes: {
      added: string[]
      updated: string[]
      deleted: string[]
      unchanged: string[]
      localAdded: string[]
      localUpdated: string[]
      localDeleted: string[]
      conflicts: string[]
    }
    sourcePath: string
    notes?: string[]
    guardWarnings?: string[]
    encodingWarnings?: Array<{ key: string; message: string }>
    strategy?: 'local' | 'remote' | 'error'
  }
): Promise<void> {
  const planOutput = getPlanOutputFromArgs(args)
  if (!planOutput) return

  const summary = normalizePlanSummary({
    operation: 'merge',
    project,
    environment,
    service,
    apply: payload.status === 'applied',
    dryRun: payload.status === 'planned',
    status: payload.status,
    strategy: payload.strategy,
    notes: payload.notes || [],
    source: {
      inputPath: payload.sourcePath
    },
    counts: {
      local: payload.localCount,
      remote: payload.remoteCount,
      plannedChangeCount: payload.changes.added.length + payload.changes.updated.length + payload.changes.localAdded.length + payload.changes.localUpdated.length,
      unchangedCount: payload.changes.unchanged.length
    },
    changes: payload.changes,
    missingRequired: [],
    guardWarnings: payload.guardWarnings || [],
    encodingWarnings: payload.encodingWarnings || []
  })

  try {
    writeSyncPlanArtifact(summary, {
      operation: 'merge',
      project,
      environment,
      service,
      outputPath: planOutput
    })
  } catch {}
}

export async function handlePullCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const configDir = findConfigDir()
  if (!configDir) {
    return { content: [{ type: 'text', text: 'Error: No .vaulter directory found' }] }
  }

  const outputPath = (args.output as string) || (config
    ? getEnvFilePathForConfig(config, configDir, environment)
    : getEnvFilePath(configDir, environment))

  const vars = await client.export(project, environment, service)
  const dryRun = args.dryRun === true
  const beforeVars = fs.existsSync(outputPath) ? parseEnvFile(outputPath) : {}

  if (dryRun) {
    const diff = getEnvDiff(beforeVars, vars)

    const lines = [
      `Dry run - pull plan for ${environment}`,
      `  Would write ${Object.keys(vars).length} variables to ${outputPath}`,
      `  Add: ${diff.added.length}`,
      `  Update: ${diff.updated.length}`,
      `  Remove: ${diff.deleted.length}`
    ]

    await emitPullPlanArtifact(args, project, environment, service, {
      status: 'planned',
      localCount: Object.keys(beforeVars).length,
      remoteCount: Object.keys(vars).length,
      sourcePath: outputPath,
      changes: diff,
      notes: ['mode=file']
    })

    return {
      content: [{
        type: 'text',
        text: lines.join('\n')
      }]
    }
  }

  const content = serializeEnv(vars)

  // Ensure directory exists
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, content + '\n')
  const diff = getEnvDiff(beforeVars, vars)

  await emitPullPlanArtifact(args, project, environment, service, {
    status: 'applied',
    localCount: Object.keys(vars).length,
    remoteCount: Object.keys(vars).length,
    sourcePath: outputPath,
    changes: diff,
    notes: ['mode=file', 'write=success']
  })

  return {
    content: [{
      type: 'text',
      text: `✓ Pulled ${Object.keys(vars).length} variables to ${outputPath}`
    }]
  }
}

function evaluateSyncPlanGuards(params: {
  keys: string[]
  values: Record<string, string>
  targetService: string | undefined
  environment: Environment
  config: VaulterConfig | null
  remoteSensitivity: Map<string, boolean>
  hasMonorepo: boolean
}): {
  warnings: string[]
  encodingWarnings: Array<{ key: string; message: string }>
  blocked: boolean
  blockedMessage?: string
} {
  const { keys, values, targetService, environment, config, remoteSensitivity, hasMonorepo } = params

  if (keys.length === 0) {
    return { warnings: [], encodingWarnings: [], blocked: false }
  }

  const writeInputs = keys.map((key) => ({
    key,
    value: values[key],
    sensitive: remoteSensitivity.get(key)
  }))

  const targetScope: 'shared' | 'service' = hasMonorepo && !targetService ? 'shared' : 'service'
  const guard = evaluateWriteGuard({
    variables: writeInputs,
    targetScope,
    targetService: targetScope === 'service' ? targetService : undefined,
    environment,
    config,
    policyMode: process.env.VAULTER_SCOPE_POLICY,
    guardrailMode: process.env.VAULTER_VALUE_GUARDRAILS
  })

  const warnings = formatWriteGuardLines(guard)
  const encodingWarnings = checkValuesForEncoding(writeInputs).map((item) => ({
    key: item.key,
    message: item.result.message
  }))

  if (!guard.blocked) {
    return { warnings, encodingWarnings, blocked: false }
  }

  return {
    warnings,
    encodingWarnings,
    blocked: true,
    blockedMessage: [
      'Sync blocked by validation rules.',
      ...warnings,
      '',
      'Set VAULTER_SCOPE_POLICY=warn or VAULTER_SCOPE_POLICY=off to continue.',
      'Set VAULTER_VALUE_GUARDRAILS=warn or VAULTER_VALUE_GUARDRAILS=off to continue.'
    ].join('\n')
  }
}

function buildMergedSyncPlan(
  localVars: Record<string, string>,
  remoteVars: Record<string, string>,
  strategy: 'local' | 'remote' | 'error',
  isIgnored: (key: string) => boolean
) {
  const syncVars: Record<string, string> = { ...localVars }
  const mergedVars: Record<string, string> = { ...localVars }
  const added: string[] = []
  const updated: string[] = []
  const unchanged: string[] = []
  const localAdded: string[] = []
  const localUpdated: string[] = []
  const conflicts: Array<{ key: string; localValue: string; remoteValue: string }> = []

  const allKeys = new Set<string>([
    ...Object.keys(localVars),
    ...Object.keys(remoteVars)
  ])

  for (const key of allKeys) {
    if (isIgnored(key)) {
      continue
    }

    const localValue = localVars[key]
    const remoteValue = remoteVars[key]

    if (localValue !== undefined && remoteValue !== undefined) {
      if (localValue === remoteValue) {
        syncVars[key] = localValue
        unchanged.push(key)
        continue
      }

      if (strategy === 'local') {
        syncVars[key] = localValue
        updated.push(key)
        continue
      }

      if (strategy === 'remote') {
        syncVars[key] = remoteValue
        mergedVars[key] = remoteValue
        localUpdated.push(key)
        continue
      }

      conflicts.push({ key, localValue, remoteValue })
      continue
    }

    if (localValue !== undefined) {
      syncVars[key] = localValue
      added.push(key)
      continue
    }

    if (remoteValue !== undefined) {
      mergedVars[key] = remoteValue
      localAdded.push(key)
      syncVars[key] = remoteValue
    }
  }

  const toSetKeys = [...added, ...updated]

  return {
    added,
    updated,
    unchanged,
    localAdded,
    localUpdated,
    conflicts,
    toSetKeys,
    mergedVars,
    syncVars
  }
}

export async function handleSyncPlanCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const actionRaw = (typeof args.action === 'string' ? args.action : undefined)?.toLowerCase()
  const action = actionRaw as 'merge' | 'push' | 'pull' | undefined

  if (action !== 'merge' && action !== 'push' && action !== 'pull') {
    return {
      content: [{
        type: 'text',
        text: 'Error: action is required and must be one of: merge, push, pull'
      }]
    }
  }

  const apply = args.apply === true
  const dryRun = args.dryRun === true || !apply
  const configuredStrategy = config?.sync?.conflict
  const requestedStrategy = typeof args.strategy === 'string'
    ? args.strategy.toLowerCase()
    : undefined
  const strategy = (
    requestedStrategy === 'local' ||
    requestedStrategy === 'remote' ||
    requestedStrategy === 'error'
      ? requestedStrategy
      : configuredStrategy || 'local'
  ) as 'local' | 'remote' | 'error'

  if (!['local', 'remote', 'error'].includes(strategy)) {
    return {
      content: [{
        type: 'text',
        text: 'Error: strategy must be one of: local, remote, error'
      }]
    }
  }

  if (action === 'pull') {
    const pullDryRunArgs = { ...args, dryRun }
    return handlePullCall(client, config, project, environment, service, pullDryRunArgs)
  }

  if (action === 'push') {
    const pushDryRunArgs = { ...args, dryRun }
    return handlePushCall(client, config, project, environment, service, pushDryRunArgs)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    return { content: [{ type: 'text', text: 'Error: No .vaulter directory found' }] }
  }

  const inputPath = (args.file as string) || (config
    ? getEnvFilePathForConfig(config, configDir, environment)
    : getEnvFilePath(configDir, environment))

  if (!fs.existsSync(inputPath)) {
    return { content: [{ type: 'text', text: `Error: File not found: ${inputPath}` }] }
  }

  const localVars = parseEnvFile(inputPath)
  const effectiveService = args.shared === true ? SHARED_SERVICE : service
  const remoteList = await client.list({ project, environment, service: effectiveService })
  const remoteVars: Record<string, string> = {}
  const remoteSensitivity = new Map<string, boolean>()
  for (const item of remoteList) {
    remoteVars[item.key] = item.value
    if (item.sensitive !== undefined) {
      remoteSensitivity.set(item.key, !!item.sensitive)
    }
  }

  const allKeys = new Set<string>([
    ...Object.keys(localVars),
    ...Object.keys(remoteVars)
  ])
  const syncConfig = config?.sync
  const ignorePatterns = syncConfig?.ignore || []
  const requiredKeys = syncConfig?.required?.[environment] || []
  const isIgnored = compileGlobPatterns(ignorePatterns)
  const hasMonorepo = isMonorepoFromConfig(config)

  const {
    added,
    updated,
    unchanged,
    localAdded,
    localUpdated,
    conflicts,
    toSetKeys,
    mergedVars,
    syncVars
  } = buildMergedSyncPlan(localVars, remoteVars, strategy, isIgnored)

  const guard = evaluateSyncPlanGuards({
    keys: toSetKeys,
    values: syncVars,
    targetService: effectiveService === SHARED_SERVICE ? undefined : effectiveService,
    environment,
    config,
    remoteSensitivity,
    hasMonorepo
  })

  const conflictNames = conflicts.map((c) => c.key)
  const conflictKeySet = new Set(conflictNames)
  const missingRequired = requiredKeys
    .filter((key) => !isIgnored(key))
    .filter((key) => !(key in syncVars) && !conflictKeySet.has(key))
  const output: string[] = []

  output.push(`Merge plan (${strategy}) for ${environment}`)
  if (Object.keys(remoteVars).length === 0 && Object.keys(localVars).length === 0) {
    output.push('  No variables found locally or remotely')
  } else {
    output.push(`  Add: ${added.length}`)
    output.push(`  Update: ${updated.length}`)
    output.push(`  Local add: ${localAdded.length}`)
    output.push(`  Local update: ${localUpdated.length}`)
    output.push(`  Unchanged: ${unchanged.length}`)
    output.push(`  Conflicts: ${conflicts.length}`)
    output.push(`  Remote keys: ${Object.keys(remoteVars).length}`)
    output.push(`  Local keys: ${Object.keys(localVars).length}`)
  }
  if (allKeys.size === 0) {
    output.push('  No change summary available')
  }

  if (strategy === 'error' && conflicts.length > 0) {
    await emitSyncPlanArtifact(args, project, environment, effectiveService, {
      status: 'blocked',
      localCount: Object.keys(localVars).length,
      remoteCount: Object.keys(remoteVars).length,
      sourcePath: inputPath,
      changes: {
        added,
        updated,
        deleted: [],
        unchanged,
        localAdded,
        localUpdated,
        localDeleted: [],
        conflicts: conflictNames
      },
      notes: [
        'strategy=error',
        `conflicts=${conflictNames.length}`
      ],
      guardWarnings: guard.warnings,
      encodingWarnings: guard.encodingWarnings
    })

    return {
      content: [{
        type: 'text',
        text: `Sync blocked: strategy=${strategy} and conflicts found -> ${conflictNames.join(', ')}`
      }]
    }
  }

  if (missingRequired.length > 0) {
    await emitSyncPlanArtifact(args, project, environment, effectiveService, {
      status: 'blocked',
      localCount: Object.keys(localVars).length,
      remoteCount: Object.keys(remoteVars).length,
      sourcePath: inputPath,
      changes: {
        added,
        updated,
        deleted: [],
        unchanged,
        localAdded,
        localUpdated,
        localDeleted: [],
        conflicts: []
      },
      notes: [
        `missing-required=${missingRequired.length}`,
        ...missingRequired
      ],
      guardWarnings: guard.warnings,
      encodingWarnings: guard.encodingWarnings
    })

    return {
      content: [{
        type: 'text',
        text: `Sync blocked: missing required keys for ${environment}: ${missingRequired.join(', ')}`
      }]
    }
  }

  if (guard.blocked) {
    await emitSyncPlanArtifact(args, project, environment, effectiveService, {
      status: 'blocked',
      localCount: Object.keys(localVars).length,
      remoteCount: Object.keys(remoteVars).length,
      sourcePath: inputPath,
      changes: {
        added,
        updated,
        deleted: [],
        unchanged,
        localAdded,
        localUpdated,
        localDeleted: [],
        conflicts: []
      },
      notes: ['scope-policy-blocked'],
      guardWarnings: guard.warnings,
      encodingWarnings: guard.encodingWarnings
    })

    return {
      content: [{
        type: 'text',
        text: guard.blockedMessage || 'Sync blocked by validation rules.'
      }]
    }
  }

  if (dryRun) {
    output.push(`  Preview: no changes applied to backend`)
    if (conflicts.length > 0) {
      output.push(`  Conflicts to resolve: ${conflictNames.join(', ')}`)
    }

    await emitSyncPlanArtifact(args, project, environment, effectiveService, {
      status: 'planned',
      localCount: Object.keys(localVars).length,
      remoteCount: Object.keys(remoteVars).length,
      sourcePath: inputPath,
      strategy,
      changes: {
        added,
        updated,
        deleted: localAdded.concat(localUpdated),
        unchanged,
        localAdded,
        localUpdated,
        localDeleted: [],
        conflicts: conflictNames
      },
      notes: [
        `mode=merge-${strategy}`,
        `input=${inputPath}`
      ],
      guardWarnings: guard.warnings,
      encodingWarnings: guard.encodingWarnings
    })

    return {
      content: [{
        type: 'text',
        text: output.join('\n')
      }]
    }
  }

  const toSet = toSetKeys.map((key) => ({
    key,
    value: syncVars[key],
    project,
    environment,
    service: effectiveService,
    sensitive: remoteSensitivity.get(key),
    metadata: { source: 'sync' }
  }))
  if (toSet.length > 0) {
    await client.setMany(toSet, { preserveMetadata: true })
  }

  const envContent = serializeEnv(mergedVars)
  fs.writeFileSync(inputPath, envContent + '\n')

  await emitSyncPlanArtifact(args, project, environment, effectiveService, {
    status: 'applied',
    localCount: Object.keys(localVars).length,
    remoteCount: Object.keys(remoteVars).length,
    sourcePath: inputPath,
    strategy,
    changes: {
      added,
      updated,
      deleted: localAdded.concat(localUpdated),
      unchanged,
      localAdded,
      localUpdated,
      localDeleted: [],
      conflicts: []
    },
    notes: [
      `mode=merge-${strategy}`,
      `input=${inputPath}`
    ],
    guardWarnings: guard.warnings,
    encodingWarnings: guard.encodingWarnings
  })

  return {
    content: [{
      type: 'text',
      text: output.join('\n').concat('\n  Applied: write completed')
    }]
  }
}

export async function handlePushCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const dryRun = args.dryRun as boolean || false
  const prune = args.prune === true

  const configDir = findConfigDir()
  if (!configDir) {
    return { content: [{ type: 'text', text: 'Error: No .vaulter directory found' }] }
  }

  const inputPath = (args.file as string) || (config
    ? getEnvFilePathForConfig(config, configDir, environment)
    : getEnvFilePath(configDir, environment))

  if (!fs.existsSync(inputPath)) {
    return { content: [{ type: 'text', text: `Error: File not found: ${inputPath}` }] }
  }

  const localVars = parseEnvFile(inputPath)
  const localKeys = Object.keys(localVars)
  const effectiveService = service
  const hasMonorepo = isMonorepoFromConfig(config)

  const remoteList = await client.list({
    project,
    environment,
    service: effectiveService
  })

  const remoteVars: Record<string, string> = {}
  const remoteSensitivity = new Map<string, boolean>()
  for (const item of remoteList) {
    remoteVars[item.key] = item.value
    if (item.sensitive !== undefined) {
      remoteSensitivity.set(item.key, !!item.sensitive)
    }
  }

  const writeInputs = localKeys.map((key) => ({
    key,
    value: localVars[key],
    sensitive: remoteSensitivity.get(key)
  }))

  const targetScope: 'shared' | 'service' = hasMonorepo && !effectiveService ? 'shared' : 'service'
  const scopeGuard = evaluateWriteGuard({
    variables: writeInputs,
    targetScope,
    targetService: targetScope === 'service' ? effectiveService : undefined,
    environment,
    config,
    policyMode: process.env.VAULTER_SCOPE_POLICY,
    guardrailMode: process.env.VAULTER_VALUE_GUARDRAILS
  })
  const guardWarnings = formatWriteGuardLines(scopeGuard)
  const encodingWarnings = checkValuesForEncoding(writeInputs).map((item) => ({
    key: item.key,
    message: item.result.message
  }))

  if (scopeGuard.blocked) {
    if (dryRun) {
      await emitPushPlanArtifact(args, project, environment, effectiveService, {
        status: 'blocked',
        localCount: localKeys.length,
        remoteCount: Object.keys(remoteVars).length,
        sourcePath: inputPath,
        changes: {
          added: [],
          updated: [],
          deleted: [],
          unchanged: []
        },
        notes: ['scope-policy-blocked'],
        guardWarnings,
        encodingWarnings
      })
    }

    return {
      content: [{
        type: 'text',
        text: [
          'Sync blocked by validation rules:',
          ...guardWarnings,
          '',
          'Set VAULTER_SCOPE_POLICY=warn or VAULTER_SCOPE_POLICY=off to continue.',
          'Set VAULTER_VALUE_GUARDRAILS=warn or VAULTER_VALUE_GUARDRAILS=off to continue.'
        ].join('\n')
      }]
    }
  }

  // Dry run mode - preview changes without applying
  if (dryRun) {
    const toAdd: string[] = []
    const toUpdate: string[] = []
    const unchanged: string[] = []
    const toDelete: string[] = []

    for (const [key, value] of Object.entries(localVars)) {
      if (!(key in remoteVars)) {
        toAdd.push(key)
      } else if (remoteVars[key] !== value) {
        toUpdate.push(key)
      } else {
        unchanged.push(key)
      }
    }

    if (prune) {
      const localKeySet = new Set(localKeys)
      for (const remoteKey of Object.keys(remoteVars)) {
        if (!localKeySet.has(remoteKey)) {
          toDelete.push(remoteKey)
        }
      }
    }

    await emitPushPlanArtifact(args, project, environment, effectiveService, {
      status: 'planned',
      localCount: localKeys.length,
      remoteCount: Object.keys(remoteVars).length,
      sourcePath: inputPath,
      changes: {
        added: toAdd,
        updated: toUpdate,
        deleted: toDelete,
        unchanged
      },
      notes: [`mode=file`, `prune=${prune ? 'true' : 'false'}`],
      guardWarnings,
      encodingWarnings
    })

    const lines = ['Dry run - changes that would be made:']
    if (toAdd.length > 0) lines.push(`  Add: ${toAdd.join(', ')}`)
    if (toUpdate.length > 0) lines.push(`  Update: ${toUpdate.join(', ')}`)
    if (toAdd.length === 0 && toUpdate.length === 0) {
      lines.push('  No changes needed')
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  const toSet = localKeys.map((key) => ({
    key,
    value: localVars[key],
    project,
    environment,
    service: effectiveService,
    sensitive: remoteSensitivity.get(key),
    metadata: { source: 'sync' }
  }))

  const addedKeys: string[] = []
  const updatedKeys: string[] = []
  const unchanged: string[] = []
  const toDelete: string[] = []
  const deletedKeys: string[] = []

  for (const [key, value] of Object.entries(localVars)) {
    if (!(key in remoteVars)) {
      addedKeys.push(key)
    } else if (remoteVars[key] !== value) {
      updatedKeys.push(key)
    } else {
      unchanged.push(key)
    }
  }

  if (prune) {
    const localKeySet = new Set(localKeys)
    for (const remoteKey of Object.keys(remoteVars)) {
      if (!localKeySet.has(remoteKey)) {
        toDelete.push(remoteKey)
      }
    }
  }

  await client.setMany(toSet, { preserveMetadata: true })

  if (toDelete.length > 0) {
    const deleteResult = await client.deleteManyByKeys(toDelete, project, environment, effectiveService)
    const appliedDeleted = new Set(deleteResult.deleted)
    if (appliedDeleted.size > 0) {
      deletedKeys.push(...toDelete.filter((key) => appliedDeleted.has(key)))
    }
  }

  const remoteCountAfter = Object.keys(remoteVars).length + addedKeys.length - deletedKeys.length

  await emitPushPlanArtifact(args, project, environment, effectiveService, {
    status: 'applied',
    localCount: localKeys.length,
    remoteCount: remoteCountAfter,
    sourcePath: inputPath,
    changes: {
      added: addedKeys,
      updated: updatedKeys,
      deleted: deletedKeys,
      unchanged
    },
    notes: [`mode=file`, `prune=${prune ? 'true' : 'false'}`],
    guardWarnings,
    encodingWarnings
  })

  return {
    content: [{
      type: 'text',
      text: [
        `✓ Synced ${localKeys.length} variables from ${inputPath}`,
        ...(guardWarnings.length > 0
          ? ['⚠ Validation warnings:', ...guardWarnings.map((line) => `- ${line}`)]
          : []),
        ...(encodingWarnings.length > 0
          ? ['⚠ Encoding warnings:', ...encodingWarnings.map((item) => `- ${item.key}: ${item.message}`)]
          : [])
      ].join('\n')
    }]
  }
}
