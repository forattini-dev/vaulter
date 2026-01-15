/**
 * MiniEnv CLI - Sync Command
 *
 * Bidirectional sync between local .env file and backend
 * with conflict detection
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, MiniEnvConfig, Environment, SyncResult } from '../../types.js'
import { MiniEnvClient } from '../../client.js'
import { loadEncryptionKey, findConfigDir, getEnvFilePath } from '../../lib/config-loader.js'
import { parseEnvFile, parseEnvString, serializeEnv, hasStdinData, parseEnvFromStdin } from '../../lib/env-parser.js'
import { discoverServices, filterServices, findMonorepoRoot, formatServiceList, type ServiceInfo } from '../../lib/monorepo.js'
import { runBatch, formatBatchResult, formatBatchResultJson, type BatchResult } from '../../lib/batch-runner.js'

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
  const { args, config, project, service, environment, verbose, dryRun, jsonOutput } = context

  // Use service info if provided (batch mode)
  const effectiveConfig = serviceInfo?.config || config
  const effectiveProject = serviceInfo?.config.project || project
  const effectiveService = serviceInfo?.name || service

  // Determine source of variables
  let localVars: Record<string, string>

  if (hasStdinData() && !serviceInfo) {
    // Read from stdin (only for single service mode)
    if (verbose) {
      console.error('Reading variables from stdin...')
    }
    localVars = await parseEnvFromStdin()
  } else {
    // Read from file
    const filePath = args.file || args.f
    let envFilePath: string

    if (filePath && !serviceInfo) {
      envFilePath = path.resolve(filePath)
    } else {
      // Default to .minienv/environments/<env>.env
      const configDir = serviceInfo?.configDir || findConfigDir()
      if (!configDir) {
        throw new Error('No config directory found and no file specified')
      }
      envFilePath = getEnvFilePath(configDir, environment)
    }

    if (!fs.existsSync(envFilePath)) {
      throw new Error(`File not found: ${envFilePath}`)
    }

    if (verbose) {
      console.error(`Reading variables from ${envFilePath}`)
    }

    localVars = parseEnvFile(envFilePath)
  }

  if (verbose) {
    console.error(`Found ${Object.keys(localVars).length} local variables`)
  }

  // Build connection string
  const connectionString = args.backend || args.b || effectiveConfig?.backend?.url
  const passphrase = effectiveConfig ? await loadEncryptionKey(effectiveConfig) : undefined

  const client = new MiniEnvClient({
    connectionString: connectionString || undefined,
    passphrase: passphrase || undefined
  })

  try {
    await client.connect()

    if (dryRun) {
      // Get remote vars for comparison
      const remoteVars = await client.export(effectiveProject, environment, effectiveService)

      const toAdd: string[] = []
      const toUpdate: string[] = []
      const toDelete: string[] = []
      const unchanged: string[] = []

      // Compare local vs remote
      for (const [key, value] of Object.entries(localVars)) {
        if (!(key in remoteVars)) {
          toAdd.push(key)
        } else if (remoteVars[key] !== value) {
          toUpdate.push(key)
        } else {
          unchanged.push(key)
        }
      }

      // Find deleted (in remote but not in local)
      for (const key of Object.keys(remoteVars)) {
        if (!(key in localVars)) {
          toDelete.push(key)
        }
      }

      return {
        added: toAdd,
        updated: toUpdate,
        deleted: toDelete,
        unchanged: unchanged,
        conflicts: []
      }
    }

    // Perform actual sync
    return await client.sync(localVars, effectiveProject, environment, effectiveService, {
      source: 'sync'
    })
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
        conflicts: result.conflicts
      }))
    } else if (dryRun) {
      console.log('Dry run - changes that would be made:')
      if (result.added.length > 0) {
        console.log(`  Add (${result.added.length}): ${result.added.join(', ')}`)
      }
      if (result.updated.length > 0) {
        console.log(`  Update (${result.updated.length}): ${result.updated.join(', ')}`)
      }
      if (result.deleted.length > 0) {
        console.log(`  Delete (${result.deleted.length}): ${result.deleted.join(', ')}`)
      }
      if (result.unchanged.length > 0) {
        console.log(`  Unchanged: ${result.unchanged.length} variables`)
      }
      if (result.added.length === 0 && result.updated.length === 0 && result.deleted.length === 0) {
        console.log('  No changes needed')
      }
    } else {
      console.log(`✓ Synced ${project}/${environment}`)
      if (result.added.length > 0) {
        console.log(`  Added: ${result.added.length} (${result.added.join(', ')})`)
      }
      if (result.updated.length > 0) {
        console.log(`  Updated: ${result.updated.length} (${result.updated.join(', ')})`)
      }
      if (result.deleted.length > 0) {
        console.log(`  Deleted: ${result.deleted.length} (${result.deleted.join(', ')})`)
      }
      if (result.unchanged.length > 0) {
        console.log(`  Unchanged: ${result.unchanged.length}`)
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
      const changes = r.added.length + r.updated.length + r.deleted.length
      return `✓ ${op.service.name}: ${changes} changes (${op.duration}ms)`
    }))
  }

  // Exit with error if any failed
  if (batchResult.failed > 0) {
    process.exit(1)
  }
}
