/**
 * Vaulter CLI - Sync Command
 *
 * Merge local .env file with backend storage
 * Local changes are pushed to remote, remote-only keys are pulled to local
 * Conflict handling is configurable (local wins by default)
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, VaulterConfig, Environment, SyncResult } from '../../types.js'
import { withClient } from '../lib/create-client.js'
import { findConfigDir, getEnvFilePathForConfig } from '../../lib/config-loader.js'
import { parseEnvFile, hasStdinData, parseEnvFromStdin, serializeEnv } from '../../lib/env-parser.js'
import { compileGlobPatterns } from '../../lib/pattern-matcher.js'
import { isMonorepoFromConfig } from '../../lib/monorepo.js'
import {
  discoverServices,
  filterServices,
  findMonorepoRoot,
  formatServiceList,
  type ServiceInfo
} from '../../lib/monorepo.js'
import { runBatch, formatBatchResult, formatBatchResultJson } from '../../lib/batch-runner.js'
import { evaluateWriteGuard, formatWriteGuardLines } from '../../lib/write-guard.js'
import { checkValuesForEncoding } from '../../lib/encoding-detection.js'
import { createConnectedAuditLogger, logSyncOperation, disconnectAuditLogger } from '../lib/audit-helper.js'
import { normalizePlanSummary, writeSyncPlanArtifact } from '../../lib/sync-plan.js'
import * as ui from '../ui.js'
import { c, print } from '../lib/colors.js'

interface SyncContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
  /** Strategy override from CLI */
  strategy?: 'local' | 'remote' | 'error'
  /** Optional sync plan output path */
  planOutput?: string
}

/**
 * Check if this is a production environment
 */
function isProdEnvironment(env: Environment): boolean {
  return env === 'prd' || env === 'dr'
}

interface SyncGuardResult {
  warnings: string[]
  encodingWarnings: Array<{ key: string; message: string }>
  blocked: boolean
  blockedMessage?: string
}

function evaluateSyncGuards(params: {
  keys: string[]
  values: Record<string, string>
  targetService: string | undefined
  environment: Environment
  config: VaulterConfig | null
  remoteSensitivity: Map<string, boolean>
  hasMonorepo: boolean
}): SyncGuardResult {
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

  const blockedMessage = [
    'Sync blocked by validation rules.',
    ...warnings,
    '',
    'Set VAULTER_SCOPE_POLICY=warn or VAULTER_SCOPE_POLICY=off to continue.',
    'Set VAULTER_VALUE_GUARDRAILS=warn or VAULTER_VALUE_GUARDRAILS=off to continue.'
  ].join('\n')

  return {
    warnings,
    encodingWarnings,
    blocked: true,
    blockedMessage
  }
}

interface GuardedSyncResult extends SyncResult {
  guardWarnings: string[]
  encodingWarnings: Array<{ key: string; message: string }>
  localCount: number
  remoteCount: number
  sourcePath?: string
}

function getPlanOutputFromContext(context: SyncContext): string | undefined {
  const rawValue = context.planOutput || context.args['plan-output']
  if (typeof rawValue !== 'string') return undefined
  const normalized = rawValue.trim()
  return normalized.length > 0 ? normalized : undefined
}

async function emitMergePlanArtifact(
  context: SyncContext,
  result: GuardedSyncResult,
  strategy: 'local' | 'remote' | 'error',
  status: 'planned' | 'applied' | 'blocked' | 'failed' = context.dryRun ? 'planned' : 'applied'
): Promise<void> {
  const planOutput = getPlanOutputFromContext(context)
  if (!planOutput) return

  const summary = normalizePlanSummary({
    operation: 'merge',
    project: context.project,
    environment: context.environment,
    service: context.service,
    apply: !context.dryRun,
    dryRun: context.dryRun,
    status,
    strategy,
    source: {
      inputPath: result.sourcePath
    },
    counts: {
      local: result.localCount,
      remote: result.remoteCount,
      plannedChangeCount: result.added.length + result.updated.length + result.localAdded.length + result.localUpdated.length,
      unchangedCount: result.unchanged.length
    },
    changes: {
      added: result.added,
      updated: result.updated,
      deleted: [],
      unchanged: result.unchanged,
      localAdded: result.localAdded || [],
      localUpdated: result.localUpdated || [],
      localDeleted: result.localDeleted || [],
      conflicts: result.conflicts.map((item) => item.key)
    },
    notes: [
      result.sourcePath ? `input=${result.sourcePath}` : 'input=local-vars'
    ],
    missingRequired: [],
    guardWarnings: result.guardWarnings,
    encodingWarnings: result.encodingWarnings
  })

  try {
    writeSyncPlanArtifact(summary, {
      operation: 'merge',
      project: context.project,
      environment: context.environment,
      service: context.service,
      outputPath: planOutput
    })
  } catch (error) {
    ui.verbose(`Failed to write sync plan artifact: ${(error as Error).message}`, true)
  }
}

async function emitBatchMergePlanArtifact(
  context: SyncContext,
  batchResult: {
    total: number
    successful: number
    failed: number
    operations: Array<{
      service: { name: string }
      result?: GuardedSyncResult
      error?: Error
    }>
  },
  strategy: 'local' | 'remote' | 'error'
): Promise<void> {
  const planOutput = getPlanOutputFromContext(context)
  if (!planOutput) return

  let localCount = 0
  let remoteCount = 0
  let plannedChangeCount = 0
  let unchangedCount = 0
  let remoteOnlyCount = 0
  let localOnlyCount = 0
  const guardWarnings: string[] = []
  const encodingWarnings: Array<{ key: string; message: string }> = []

  const services = batchResult.operations.map((op) => {
    if (!op.result) {
      return {
        name: op.service.name,
        status: 'failed' as const,
        stats: {
          added: 0,
          updated: 0,
          unchanged: 0,
          conflicts: 0,
          localOnly: 0,
          remoteOnly: 0,
          error: op.error?.message
        }
      }
    }

    const result = op.result
    localCount += result.localCount
    remoteCount += result.remoteCount
    plannedChangeCount +=
      result.added.length +
      result.updated.length +
      result.localAdded.length +
      result.localUpdated.length
    unchangedCount += result.unchanged.length
    localOnlyCount += result.added.length + result.updated.length
    remoteOnlyCount += result.localAdded.length + result.localUpdated.length
    guardWarnings.push(...result.guardWarnings)
    encodingWarnings.push(...result.encodingWarnings)

    return {
      name: op.service.name,
      status: 'success' as const,
      stats: {
        added: result.added.length,
        updated: result.updated.length,
        unchanged: result.unchanged.length,
        conflicts: result.conflicts.length,
        localOnly: result.added.length + result.updated.length,
        remoteOnly: result.localAdded.length + result.localUpdated.length
      }
    }
  })

  const summary = normalizePlanSummary({
    operation: 'merge',
    project: context.project,
    environment: context.environment,
    apply: !context.dryRun,
    dryRun: context.dryRun,
    status: batchResult.failed > 0 ? 'failed' : context.dryRun ? 'planned' : 'applied',
    strategy,
    source: {
      outputPath: context.args.output
    },
    counts: {
      local: localCount,
      remote: remoteCount,
      plannedChangeCount,
      remoteOnlyCount,
      localOnlyCount,
      unchangedCount
    },
    changes: {
      added: [],
      updated: [],
      deleted: [],
      unchanged: [],
      localAdded: [],
      localUpdated: [],
      localDeleted: [],
      conflicts: []
    },
    notes: [
      `services=${batchResult.total}`,
      `successful=${batchResult.successful}`,
      `failed=${batchResult.failed}`
    ],
    missingRequired: [],
    guardWarnings,
    encodingWarnings,
    services
  })

  try {
    writeSyncPlanArtifact(summary, {
      operation: 'merge',
      project: context.project,
      environment: context.environment,
      outputPath: planOutput
    })
  } catch (error) {
    ui.verbose(`Failed to write batch sync plan artifact: ${(error as Error).message}`, true)
  }
}

/**
 * Run sync for a single service
 */
async function syncSingleService(
  context: SyncContext,
  serviceInfo?: ServiceInfo
): Promise<GuardedSyncResult> {
  const { args, config, project, service, environment, verbose, dryRun, strategy } = context

  // Use service info if provided (batch mode)
  const effectiveConfig = serviceInfo?.config || config
  const effectiveService = serviceInfo?.name || service
  const syncConfig = effectiveConfig?.sync
  // CLI --strategy overrides config
  const conflictMode = strategy || syncConfig?.conflict || 'local'
  const ignorePatterns = syncConfig?.ignore || []
  const requiredKeys = syncConfig?.required?.[environment] || []
  const isIgnored = compileGlobPatterns(ignorePatterns)
  const hasMonorepo = isMonorepoFromConfig(effectiveConfig)

  // Determine source of variables
  // Priority: explicit file (-f/--file) > stdin > default path
  let localVars: Record<string, string>
  let envFilePath: string | null = null

  const explicitFilePath = args.file

  if (explicitFilePath && !serviceInfo) {
    // Explicit file specified - always use it
    const resolvedPath = path.resolve(explicitFilePath)

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`)
    }

    ui.verbose(`Reading variables from ${resolvedPath}`, verbose)
    envFilePath = resolvedPath
    localVars = parseEnvFile(resolvedPath)
  } else if (hasStdinData() && !serviceInfo && !explicitFilePath) {
    // Read from stdin (only for single service mode, and only if no file specified)
    ui.verbose('Reading variables from stdin...', verbose)
    localVars = await parseEnvFromStdin()
  } else {
    // Default path depends on directories.mode:
    // - unified: .vaulter/environments/<env>.env
    // - split: deploy/secrets/<env>.env
    const configDir = findConfigDir()
    if (!configDir) {
      throw new Error('No config directory found and no file specified')
    }
    const resolvedPath = getEnvFilePathForConfig(effectiveConfig!, configDir, environment)

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`)
    }

    ui.verbose(`Reading variables from ${resolvedPath}`, verbose)

    envFilePath = resolvedPath
    localVars = parseEnvFile(resolvedPath)
  }

  ui.verbose(`Found ${Object.keys(localVars).length} local variables`, verbose)

  const auditLogger = await createConnectedAuditLogger(effectiveConfig, project, environment, verbose)

  try {
    return await withClient({ args, config: effectiveConfig, project, verbose }, async (client) => {
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

      const mergedVars = { ...localVars }
      const syncVars: Record<string, string> = {}
      const added: string[] = []
      const updated: string[] = []
      const unchanged: string[] = []
      const localAdded: string[] = []
      const localUpdated: string[] = []
      const conflicts: SyncResult['conflicts'] = []
      const canUpdateLocal = !!envFilePath

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

          if (conflictMode === 'local') {
            syncVars[key] = localValue
            updated.push(key)
            continue
          }

          if (conflictMode === 'remote') {
            if (!canUpdateLocal) {
              conflicts.push({ key, localValue, remoteValue })
              continue
            }
            mergedVars[key] = remoteValue
            localUpdated.push(key)
            syncVars[key] = remoteValue
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
          if (!canUpdateLocal) {
            syncVars[key] = remoteValue
            continue
          }

          mergedVars[key] = remoteValue
          localAdded.push(key)
          syncVars[key] = remoteValue
        }
      }

      // Check for blocking conflicts first (before required check)
      const isBlockingConflict = conflictMode === 'error' && conflicts.length > 0
      if (isBlockingConflict && !dryRun) {
        const conflictKeyNames = conflicts.map(c => c.key).join(', ')
        throw new Error(`Sync conflicts detected: ${conflictKeyNames}`)
      }

      // Now check for missing required keys
      // Exclude keys that are in conflicts (they exist but differ)
      const conflictKeySet = new Set(conflicts.map(c => c.key))
      const missingRequired = requiredKeys
        .filter(key => !isIgnored(key))
        .filter(key => !(key in syncVars) && !conflictKeySet.has(key))

      if (missingRequired.length > 0) {
        throw new Error(`Missing required keys for ${environment}: ${missingRequired.join(', ')}`)
      }

      const toSetKeys = [...added, ...updated]
      const guard = evaluateSyncGuards({
        keys: toSetKeys,
        values: syncVars,
        targetService: effectiveService,
        environment,
        config: effectiveConfig,
        remoteSensitivity,
        hasMonorepo
      })

      if (guard.blocked) {
        throw new Error(guard.blockedMessage || 'Sync blocked by validation.')
      }

      if (!dryRun) {
        if (canUpdateLocal && envFilePath && (localAdded.length > 0 || localUpdated.length > 0)) {
          const envContent = serializeEnv(mergedVars)
          fs.writeFileSync(envFilePath, envContent + '\n')
        }

        if (toSetKeys.length > 0) {
          const setInputs = toSetKeys.map((key) => ({
            key,
            value: syncVars[key],
            project,
            environment,
            service: effectiveService,
            sensitive: remoteSensitivity.get(key),
            metadata: {
              source: 'sync'
            }
          }))

          await client.setMany(setInputs, { preserveMetadata: true })
        }

        // Sync does not delete remote keys by design (unless caller uses --prune elsewhere)

        // Log to audit trail
        await logSyncOperation(auditLogger, {
          project,
          environment,
          service: effectiveService,
          added,
          updated,
          deleted: [],
          source: 'cli'
        })
      }

      return {
        added,
        updated,
        deleted: [],
        unchanged,
        conflicts,
        localAdded,
        localUpdated,
        localDeleted: [],
        localCount: Object.keys(localVars).length,
        remoteCount: Object.keys(remoteVars).length,
        sourcePath: envFilePath || undefined,
        guardWarnings: guard.warnings,
        encodingWarnings: guard.encodingWarnings
      }
    })
  } finally {
    await disconnectAuditLogger(auditLogger)
  }
}

/**
 * Run the sync command
 */
export async function runSync(context: SyncContext): Promise<void> {
  const { args, config, project, service, environment, dryRun, jsonOutput } = context

  const allServices = args.all
  const serviceFilter = args.service

  if (allServices || (serviceFilter && serviceFilter.includes(','))) {
    await runBatchSync(context)
    return
  }

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  // Production confirmation
  if (isProdEnvironment(environment) && config?.security?.confirm_production && !args.force) {
    print.error(`You are syncing to ${environment} (production) environment`)
    ui.log(`Use ${c.highlight('--force')} to confirm this action`)
    process.exit(1)
  }

  try {
    const result = await syncSingleService(context)
    const strategy = context.strategy || context.config?.sync?.conflict || 'local'
    await emitMergePlanArtifact(context, result, strategy)

    const warnLines = result.guardWarnings || []
    const encodingWarnings = result.encodingWarnings || []

    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: !warnLines.some(Boolean),
        dryRun,
        project,
        service,
        environment,
        added: result.added,
        updated: result.updated,
        deleted: result.deleted,
        unchanged: result.unchanged,
        conflicts: result.conflicts,
        localAdded: result.localAdded || [],
        localUpdated: result.localUpdated || [],
        localDeleted: result.localDeleted || [],
        guardWarnings: warnLines,
        encodingWarnings,
        block: false
      }))
    } else if (dryRun) {
      ui.log('Dry run - changes that would be made:')
      if (result.added.length > 0) {
        ui.log(`  Remote add (${result.added.length}): ${result.added.join(', ')}`)
      }
      if (result.updated.length > 0) {
        ui.log(`  Remote update (${result.updated.length}): ${result.updated.join(', ')}`)
      }
      if ((result.localAdded || []).length > 0) {
        ui.log(`  Local add (${result.localAdded?.length}): ${result.localAdded?.join(', ')}`)
      }
      if ((result.localUpdated || []).length > 0) {
        ui.log(`  Local update (${result.localUpdated?.length}): ${result.localUpdated?.join(', ')}`)
      }
      if (result.unchanged.length > 0) {
        ui.log(`  Unchanged: ${result.unchanged.length} variables`)
      }
      if (result.conflicts.length > 0) {
        ui.log(`  Conflicts (${result.conflicts.length}): ${result.conflicts.map((conf) => conf.key).join(', ')}`)
      }
      if (
        result.added.length === 0 &&
        result.updated.length === 0 &&
        (result.localAdded || []).length === 0 &&
        (result.localUpdated || []).length === 0
      ) {
        ui.log('  No changes needed')
      }

      if (warnLines.length > 0) {
        ui.log(c.warning('Validation warnings:'))
        for (const line of warnLines) {
          ui.log(`  ${line}`)
        }
        ui.log(c.muted('Set VAULTER_SCOPE_POLICY=warn/off and VAULTER_VALUE_GUARDRAILS=warn/off to continue.'))
      }

      if (encodingWarnings.length > 0) {
        ui.log(c.warning('Encoding warnings:'))
        for (const item of encodingWarnings) {
          ui.log(`  ${item.key}: ${item.message}`)
        }
      }
    } else {
      ui.success(`Synced ${c.project(project)}/${environment}`)
      if (result.added.length > 0) {
        ui.log(`  Remote added: ${result.added.length} (${result.added.join(', ')})`)
      }
      if (result.updated.length > 0) {
        ui.log(`  Remote updated: ${result.updated.length} (${result.updated.join(', ')})`)
      }
      if ((result.localAdded || []).length > 0) {
        ui.log(`  Local added: ${result.localAdded?.length} (${result.localAdded?.join(', ')})`)
      }
      if ((result.localUpdated || []).length > 0) {
        ui.log(`  Local updated: ${result.localUpdated?.length} (${result.localUpdated?.join(', ')})`)
      }
      if (result.unchanged.length > 0) {
        ui.log(`  Unchanged: ${result.unchanged.length}`)
      }
      if (result.conflicts.length > 0) {
        ui.log(`  Conflicts: ${result.conflicts.map((conf) => conf.key).join(', ')}`)
      }

      if (warnLines.length > 0) {
        ui.log(c.warning('Validation warnings:'))
        for (const line of warnLines) {
          ui.log(`  ${line}`)
        }
        ui.log(c.muted('Set VAULTER_SCOPE_POLICY=warn/off and VAULTER_VALUE_GUARDRAILS=warn/off to continue.'))
      }

      if (encodingWarnings.length > 0) {
        ui.log(c.warning('Encoding warnings:'))
        for (const item of encodingWarnings) {
          ui.log(`  ${item.key}: ${item.message}`)
        }
      }
    }
  } catch (err) {
    print.error((err as Error).message)
    process.exit(1)
  }
}

/**
 * Run batch sync across multiple services
 */
async function runBatchSync(context: SyncContext): Promise<void> {
  const { args, environment, verbose, jsonOutput } = context

  // Find monorepo root
  const root = findMonorepoRoot()
  if (!root) {
    print.error('Not inside a monorepo')
    ui.log('Run this command from a Vaulter monorepo (service configs in .vaulter/config.yaml or config.services)')
    process.exit(1)
  }

  // Discover services
  let services = discoverServices(root)

  if (services.length === 0) {
    print.error('No services found in monorepo')
    process.exit(1)
  }

  // Filter services if pattern specified
  const serviceFilter = args.service
  if (serviceFilter && !args.all) {
    services = filterServices(services, serviceFilter)
    if (services.length === 0) {
      print.error(`No services match pattern: ${serviceFilter}`)
      ui.log('')
      ui.log('Available services:')
      const allServices = discoverServices(root)
      for (const svc of allServices) {
        ui.log(`  • ${svc.name}`)
      }
      process.exit(1)
    }
  }

  ui.verbose(formatServiceList(services), verbose)
  ui.verbose('', verbose)

  // Production confirmation for batch
  if (isProdEnvironment(environment) && !args.force) {
    print.error(`You are syncing ${services.length} services to ${environment} (production)`) 
    ui.log(`Use ${c.highlight('--force')} to confirm this action`)
    process.exit(1)
  }

  // Run batch operation
  const batchResult = await runBatch<GuardedSyncResult>(
    services,
    environment,
    async (service) => {
      const result = await syncSingleService({ ...context, config: service.config }, service)
      return {
        ...result
      }
    },
    {
      onProgress: verbose ? (completed, total, current) => {
        ui.verbose(`[${completed + 1}/${total}] Syncing ${current.name}...`, true)
      } : undefined
    }
  )

  const strategy = context.strategy || context.config?.sync?.conflict || 'local'
  await emitBatchMergePlanArtifact(context, batchResult, strategy)

  // Output results
  if (jsonOutput) {
    ui.output(JSON.stringify(formatBatchResultJson(batchResult)))
  } else {
    ui.log(formatBatchResult(batchResult, (op) => {
      if (op.error) {
        return `✗ ${op.service.name}: ${op.error.message}`
      }

      const r = op.result!
      const remoteChanges = r.added.length + r.updated.length + r.deleted.length
      const localChanges = (r.localAdded?.length || 0) + (r.localUpdated?.length || 0) + (r.localDeleted?.length || 0)
      const parts: string[] = []
      if (remoteChanges > 0) {
        parts.push(`remote ${remoteChanges}`)
      }
      if (localChanges > 0) {
        parts.push(`local ${localChanges}`)
      }
      const summary = parts.length > 0 ? parts.join(', ') : 'no changes'
      const warningSuffix = (r.guardWarnings?.length || r.encodingWarnings?.length) ? ' ⚠ warnings' : ''
      return `✓ ${op.service.name}: ${summary} (${op.duration}ms)${warningSuffix}`
    }))
  }

  // Exit with error if any failed
  if (batchResult.failed > 0) {
    process.exit(1)
  }
}
