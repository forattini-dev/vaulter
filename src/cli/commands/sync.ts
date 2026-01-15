/**
 * MiniEnv CLI - Sync Command
 *
 * Bidirectional sync between local .env file and backend
 * with conflict detection
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, MiniEnvConfig, Environment, SyncResult } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import { runHook } from '../lib/hooks.js'
import { findConfigDir, getEnvFilePath } from '../../lib/config-loader.js'
import { parseEnvFile, hasStdinData, parseEnvFromStdin, serializeEnv } from '../../lib/env-parser.js'
import { compileGlobPatterns } from '../../lib/pattern-matcher.js'
import { discoverServices, filterServices, findMonorepoRoot, formatServiceList, type ServiceInfo } from '../../lib/monorepo.js'
import { runBatch, formatBatchResult, formatBatchResultJson } from '../../lib/batch-runner.js'

interface SyncContext {
  args: CLIArgs
  config: MiniEnvConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
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
  const { args, config, project, service, environment, verbose, dryRun } = context

  // Use service info if provided (batch mode)
  const effectiveConfig = serviceInfo?.config || config
  const effectiveProject = serviceInfo?.config.project || project
  const effectiveService = serviceInfo?.name || service
  const syncConfig = effectiveConfig?.sync
  const conflictMode = syncConfig?.conflict || 'local'
  const ignorePatterns = syncConfig?.ignore || []
  const requiredKeys = syncConfig?.required?.[environment] || []
  const isIgnored = compileGlobPatterns(ignorePatterns)

  // Determine source of variables
  let localVars: Record<string, string>
  let envFilePath: string | null = null

  if (hasStdinData() && !serviceInfo) {
    // Read from stdin (only for single service mode)
    if (verbose) {
      console.error('Reading variables from stdin...')
    }
    localVars = await parseEnvFromStdin()
  } else {
    // Read from file
    const filePath = args.file || args.f
    let resolvedPath: string

    if (filePath && !serviceInfo) {
      resolvedPath = path.resolve(filePath)
    } else {
      // Default to .minienv/environments/<env>.env
      const configDir = serviceInfo?.configDir || findConfigDir()
      if (!configDir) {
        throw new Error('No config directory found and no file specified')
      }
      resolvedPath = getEnvFilePath(configDir, environment)
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`)
    }

    if (verbose) {
      console.error(`Reading variables from ${resolvedPath}`)
    }

    envFilePath = resolvedPath
    localVars = parseEnvFile(resolvedPath)
  }

  if (verbose) {
    console.error(`Found ${Object.keys(localVars).length} local variables`)
  }

  if (!dryRun) {
    runHook(effectiveConfig?.hooks?.pre_sync, 'pre_sync', verbose)
  }

  const client = await createClientFromConfig({ args, config: effectiveConfig, verbose })

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
          if (conflictMode === 'remote' || conflictMode === 'prompt' || conflictMode === 'error') {
            conflicts.push({ key, localValue: '', remoteValue })
          }
          syncVars[key] = remoteValue
          continue
        }
        mergedVars[key] = remoteValue
        localAdded.push(key)
        syncVars[key] = remoteValue
      }
    }

    const missingRequired = requiredKeys
      .filter(key => !isIgnored(key))
      .filter(key => !(key in syncVars))

    if (missingRequired.length > 0) {
      throw new Error(`Missing required keys for ${environment}: ${missingRequired.join(', ')}`)
    }

    const isBlockingConflict = (conflictMode === 'prompt' || conflictMode === 'error') &&
      conflicts.length > 0

    if (isBlockingConflict && !dryRun) {
      const conflictKeys = conflicts.map(c => c.key).join(', ')
      throw new Error(`Sync conflicts detected: ${conflictKeys}`)
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
  }
}

/**
 * Run the sync command
 */
export async function runSync(context: SyncContext): Promise<void> {
  const { args, config, project, service, environment, verbose, dryRun, jsonOutput } = context

  // Check for batch mode (--all or multiple services with -s)
  const allServices = args.all
  const serviceFilter = args.service || args.s

  if (allServices || (serviceFilter && serviceFilter.includes(','))) {
    await runBatchSync(context)
    return
  }

  if (!project) {
    console.error('Error: Project not specified and no config found')
    console.error('Run "minienv init" or specify --project')
    process.exit(1)
  }

  // Production confirmation
  if (isProdEnvironment(environment) && config?.security?.confirm_production && !args.force) {
    console.error(`Warning: You are syncing to ${environment} (production) environment`)
    console.error('Use --force to confirm this action')
    process.exit(1)
  }

  try {
    const result = await syncSingleService(context)

    if (jsonOutput) {
      console.log(JSON.stringify({
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
      console.log('Dry run - changes that would be made:')
      if (result.added.length > 0) {
        console.log(`  Remote add (${result.added.length}): ${result.added.join(', ')}`)
      }
      if (result.updated.length > 0) {
        console.log(`  Remote update (${result.updated.length}): ${result.updated.join(', ')}`)
      }
      if ((result.localAdded || []).length > 0) {
        console.log(`  Local add (${result.localAdded?.length}): ${result.localAdded?.join(', ')}`)
      }
      if ((result.localUpdated || []).length > 0) {
        console.log(`  Local update (${result.localUpdated?.length}): ${result.localUpdated?.join(', ')}`)
      }
      if (result.unchanged.length > 0) {
        console.log(`  Unchanged: ${result.unchanged.length} variables`)
      }
      if (result.conflicts.length > 0) {
        console.log(`  Conflicts (${result.conflicts.length}): ${result.conflicts.map(c => c.key).join(', ')}`)
      }
      if (
        result.added.length === 0 &&
        result.updated.length === 0 &&
        (result.localAdded || []).length === 0 &&
        (result.localUpdated || []).length === 0
      ) {
        console.log('  No changes needed')
      }
    } else {
      console.log(`✓ Synced ${project}/${environment}`)
      if (result.added.length > 0) {
        console.log(`  Remote added: ${result.added.length} (${result.added.join(', ')})`)
      }
      if (result.updated.length > 0) {
        console.log(`  Remote updated: ${result.updated.length} (${result.updated.join(', ')})`)
      }
      if ((result.localAdded || []).length > 0) {
        console.log(`  Local added: ${result.localAdded?.length} (${result.localAdded?.join(', ')})`)
      }
      if ((result.localUpdated || []).length > 0) {
        console.log(`  Local updated: ${result.localUpdated?.length} (${result.localUpdated?.join(', ')})`)
      }
      if (result.unchanged.length > 0) {
        console.log(`  Unchanged: ${result.unchanged.length}`)
      }
      if (result.conflicts.length > 0) {
        console.log(`  Conflicts: ${result.conflicts.map(c => c.key).join(', ')}`)
      }
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`)
    process.exit(1)
  }
}

/**
 * Run batch sync across multiple services
 */
async function runBatchSync(context: SyncContext): Promise<void> {
  const { args, environment, verbose, dryRun, jsonOutput } = context

  // Find monorepo root
  const root = findMonorepoRoot()
  if (!root) {
    console.error('Error: Not inside a monorepo')
    console.error('Run this command from within a project that has nested .minienv directories')
    process.exit(1)
  }

  // Discover services
  let services = discoverServices(root)

  if (services.length === 0) {
    console.error('Error: No services found in monorepo')
    process.exit(1)
  }

  // Filter services if pattern specified
  const serviceFilter = args.service || args.s
  if (serviceFilter && !args.all) {
    services = filterServices(services, serviceFilter)
    if (services.length === 0) {
      console.error(`Error: No services match pattern: ${serviceFilter}`)
      console.error('')
      console.error('Available services:')
      const allServices = discoverServices(root)
      for (const svc of allServices) {
        console.error(`  • ${svc.name}`)
      }
      process.exit(1)
    }
  }

  if (verbose) {
    console.error(formatServiceList(services))
    console.error('')
  }

  // Production confirmation for batch
  if (isProdEnvironment(environment) && !args.force) {
    console.error(`Warning: You are syncing ${services.length} services to ${environment} (production)`)
    console.error('Use --force to confirm this action')
    process.exit(1)
  }

  // Run batch operation
  const batchResult = await runBatch<SyncResult>(
    services,
    environment,
    async (service, env) => {
      return syncSingleService({ ...context, config: service.config }, service)
    },
    {
      verbose,
      onProgress: verbose ? (completed, total, current) => {
        console.error(`[${completed + 1}/${total}] Syncing ${current.name}...`)
      } : undefined
    }
  )

  // Output results
  if (jsonOutput) {
    console.log(JSON.stringify(formatBatchResultJson(batchResult)))
  } else {
    console.log(formatBatchResult(batchResult, (op) => {
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
