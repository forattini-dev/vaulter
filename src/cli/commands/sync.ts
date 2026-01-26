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
import { createClientFromConfig } from '../lib/create-client.js'
import { runHook } from '../lib/hooks.js'
import { findConfigDir, getEnvFilePathForConfig } from '../../lib/config-loader.js'
import { parseEnvFile, hasStdinData, parseEnvFromStdin, serializeEnv } from '../../lib/env-parser.js'
import { compileGlobPatterns } from '../../lib/pattern-matcher.js'
import { discoverServices, filterServices, findMonorepoRoot, formatServiceList, type ServiceInfo } from '../../lib/monorepo.js'
import { runBatch, formatBatchResult, formatBatchResultJson } from '../../lib/batch-runner.js'
import { createConnectedAuditLogger, logSyncOperation, disconnectAuditLogger } from '../lib/audit-helper.js'
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
}

/**
 * Check if this is a production environment
 */
function isProdEnvironment(env: Environment): boolean {
  return env === 'prd' || env === 'dr'
}

/**
 * Run sync for a single service
 */
async function syncSingleService(
  context: SyncContext,
  serviceInfo?: ServiceInfo
): Promise<SyncResult> {
  const { args, config, project, service, environment, verbose, dryRun, strategy } = context

  // Use service info if provided (batch mode)
  const effectiveConfig = serviceInfo?.config || config
  const effectiveProject = serviceInfo?.config.project || project
  const effectiveService = serviceInfo?.name || service
  const syncConfig = effectiveConfig?.sync
  // CLI --strategy overrides config
  const conflictMode = strategy || syncConfig?.conflict || 'local'
  const ignorePatterns = syncConfig?.ignore || []
  const requiredKeys = syncConfig?.required?.[environment] || []
  const isIgnored = compileGlobPatterns(ignorePatterns)

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
    const configDir = serviceInfo?.configDir || findConfigDir()
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

  if (!dryRun) {
    runHook(effectiveConfig?.hooks?.pre_sync, 'pre_sync', verbose)
  }

  const client = await createClientFromConfig({ args, config: effectiveConfig, project: effectiveProject, verbose })
  const auditLogger = await createConnectedAuditLogger(effectiveConfig, effectiveProject, environment, verbose)

  try {
    await client.connect()

    const remoteVars = await client.export(effectiveProject, environment, effectiveService)

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
    // This prevents "missing required" errors for keys that are actually in conflict
    const isBlockingConflict = conflictMode === 'error' && conflicts.length > 0

    if (isBlockingConflict && !dryRun) {
      const conflictKeyNames = conflicts.map(c => c.key).join(', ')
      throw new Error(`Sync conflicts detected: ${conflictKeyNames}`)
    }

    // Now check for missing required keys
    // Exclude keys that are in conflicts (they exist but have value mismatches)
    const conflictKeySet = new Set(conflicts.map(c => c.key))
    const missingRequired = requiredKeys
      .filter(key => !isIgnored(key))
      .filter(key => !(key in syncVars) && !conflictKeySet.has(key))

    if (missingRequired.length > 0) {
      throw new Error(`Missing required keys for ${environment}: ${missingRequired.join(', ')}`)
    }

    if (!dryRun) {
      if (canUpdateLocal && envFilePath && (localAdded.length > 0 || localUpdated.length > 0)) {
        const envContent = serializeEnv(mergedVars)
        fs.writeFileSync(envFilePath, envContent + '\n')
      }

      for (const key of [...added, ...updated]) {
        await client.set({
          key,
          value: syncVars[key],
          project: effectiveProject,
          environment,
          service: effectiveService,
          metadata: {
            source: 'sync'
          }
        })
      }

      runHook(effectiveConfig?.hooks?.post_sync, 'post_sync', verbose)

      // Log to audit trail
      await logSyncOperation(auditLogger, {
        project: effectiveProject,
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
      localUpdated
    }
  } finally {
    await client.disconnect()
    await disconnectAuditLogger(auditLogger)
  }
}

/**
 * Run the sync command
 */
export async function runSync(context: SyncContext): Promise<void> {
  const { args, config, project, service, environment, dryRun, jsonOutput } = context

  // Check for batch mode (--all or multiple services with -s)
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

    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
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
        localDeleted: result.localDeleted || []
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
        ui.log(`  Conflicts (${result.conflicts.length}): ${result.conflicts.map(conf => conf.key).join(', ')}`)
      }
      if (
        result.added.length === 0 &&
        result.updated.length === 0 &&
        (result.localAdded || []).length === 0 &&
        (result.localUpdated || []).length === 0
      ) {
        ui.log('  No changes needed')
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
        ui.log(`  Conflicts: ${result.conflicts.map(conf => conf.key).join(', ')}`)
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
    ui.log('Run this command from within a project that has nested .vaulter directories')
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
  const batchResult = await runBatch<SyncResult>(
    services,
    environment,
    async (service) => {
      return syncSingleService({ ...context, config: service.config }, service)
    },
    {
      onProgress: verbose ? (completed, total, current) => {
        ui.verbose(`[${completed + 1}/${total}] Syncing ${current.name}...`, true)
      } : undefined
    }
  )

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
      return `✓ ${op.service.name}: ${summary} (${op.duration}ms)`
    }))
  }

  // Exit with error if any failed
  if (batchResult.failed > 0) {
    process.exit(1)
  }
}
