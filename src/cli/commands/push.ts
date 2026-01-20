/**
 * Vaulter CLI - Push Command
 *
 * Push local .env file to backend (one-way sync, local wins)
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import { findConfigDir, getEnvFilePathForConfig } from '../../lib/config-loader.js'
import { parseEnvFile, hasStdinData, parseEnvFromStdin } from '../../lib/env-parser.js'
import { createConnectedAuditLogger, logPushOperation, disconnectAuditLogger } from '../lib/audit-helper.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import { SHARED_SERVICE } from '../../lib/shared.js'
import * as ui from '../ui.js'

export interface PushContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
  /** Delete remote variables that don't exist locally */
  prune?: boolean
  /** Target shared variables scope (monorepo) */
  shared?: boolean
}

/**
 * Check if this is a production environment
 */
function isProdEnvironment(env: Environment): boolean {
  return env === 'prd' || env === 'dr'
}

/**
 * Run the push command
 */
export async function runPush(context: PushContext): Promise<void> {
  const { args, config, project, environment, verbose, dryRun, jsonOutput } = context

  // If --shared is set, target __shared__ service (monorepo)
  const effectiveService = context.shared ? SHARED_SERVICE : context.service

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  // Show environment banner (respects --quiet and --json)
  if (!jsonOutput && !dryRun) {
    ui.showEnvironmentBanner(environment, {
      project,
      service: context.shared ? 'shared' : effectiveService,
      action: 'Pushing variables'
    })
  }

  // Production confirmation
  if (isProdEnvironment(environment) && config?.security?.confirm_production && !args.force) {
    print.warning(`You are pushing to ${colorEnv(environment)} (production) environment`)
    ui.log(`Use ${c.highlight('--force')} to confirm this action`)
    process.exit(1)
  }

  // Determine source of variables
  // Priority: explicit file (-f/--file) > stdin > default path
  let localVars: Record<string, string>

  const explicitFilePath = args.file || args.f

  if (explicitFilePath) {
    // Explicit file specified - always use it
    const envFilePath = path.resolve(explicitFilePath)

    if (!fs.existsSync(envFilePath)) {
      print.error(`File not found: ${c.muted(envFilePath)}`)
      process.exit(1)
    }

    ui.verbose(`Reading variables from ${c.muted(envFilePath)}`, verbose)
    localVars = parseEnvFile(envFilePath)
  } else if (hasStdinData()) {
    // Read from stdin (only if no file specified)
    ui.verbose('Reading variables from stdin...', verbose)
    localVars = await parseEnvFromStdin()
  } else {
    // Default path depends on directories.mode:
    // - unified: .vaulter/environments/<env>.env
    // - split: deploy/secrets/<env>.env
    const configDir = findConfigDir()
    if (!configDir || !config) {
      print.error('No config directory found and no file specified')
      ui.log(`Use ${c.highlight('-f <file>')} to specify the .env file`)
      process.exit(1)
    }
    const envFilePath = getEnvFilePathForConfig(config, configDir, environment)

    if (!fs.existsSync(envFilePath)) {
      print.error(`File not found: ${c.muted(envFilePath)}`)
      process.exit(1)
    }

    ui.verbose(`Reading variables from ${c.muted(envFilePath)}`, verbose)
    localVars = parseEnvFile(envFilePath)
  }

  const varCount = Object.keys(localVars).length

  if (varCount === 0) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        warning: 'no_variables',
        message: 'No variables found in source'
      }))
    } else {
      print.warning('No variables found in source')
    }
    return
  }

  ui.verbose(`Found ${c.value(String(varCount))} variables to push`, verbose)

  const client = await createClientFromConfig({ args, config, project, verbose })
  const auditLogger = await createConnectedAuditLogger(config, verbose)

  try {
    await client.connect()

    if (dryRun) {
      // Get remote vars for comparison
      const remoteVars = await client.export(project, environment, effectiveService)

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

      // Calculate what would be deleted with --prune
      if (context.prune) {
        const localKeys = new Set(Object.keys(localVars))
        for (const remoteKey of Object.keys(remoteVars)) {
          if (!localKeys.has(remoteKey)) {
            toDelete.push(remoteKey)
          }
        }
      }

      if (jsonOutput) {
        ui.output(JSON.stringify({
          dryRun: true,
          project,
          service: effectiveService,
          environment,
          shared: context.shared || false,
          prune: context.prune || false,
          changes: {
            add: toAdd,
            update: toUpdate,
            delete: toDelete,
            unchanged: unchanged
          }
        }))
      } else {
        ui.log('Dry run - changes that would be made:')
        if (toAdd.length > 0) {
          ui.log(`  Add (${toAdd.length}): ${toAdd.join(', ')}`)
        }
        if (toUpdate.length > 0) {
          ui.log(`  Update (${toUpdate.length}): ${toUpdate.join(', ')}`)
        }
        if (toDelete.length > 0) {
          ui.log(`  ${c.removed(`Delete (${toDelete.length}): ${toDelete.join(', ')}`)}`)
        }
        if (unchanged.length > 0) {
          ui.log(`  Unchanged: ${unchanged.length} variables`)
        }
        if (toAdd.length === 0 && toUpdate.length === 0 && toDelete.length === 0) {
          ui.log('  No changes needed')
        }
      }
      return
    }

    // Push all variables (insert/update)
    const addedKeys: string[] = []
    const updatedKeys: string[] = []
    const deletedKeys: string[] = []

    // Get remote vars to track what exists
    const remoteVars = await client.export(project, environment, effectiveService)

    for (const [key, value] of Object.entries(localVars)) {
      const existing = key in remoteVars

      await client.set({
        key,
        value,
        project,
        service: effectiveService,
        environment,
        metadata: {
          source: 'sync'
        }
      })

      if (existing) {
        updatedKeys.push(key)
      } else {
        addedKeys.push(key)
      }
    }

    // If --prune is set, delete remote-only vars
    if (context.prune) {
      const localKeys = new Set(Object.keys(localVars))
      for (const remoteKey of Object.keys(remoteVars)) {
        if (!localKeys.has(remoteKey)) {
          await client.delete(remoteKey, project, environment, effectiveService)
          deletedKeys.push(remoteKey)
        }
      }
    }

    // Log to audit trail
    await logPushOperation(auditLogger, {
      project,
      environment,
      service: effectiveService,
      added: addedKeys,
      updated: updatedKeys,
      deleted: deletedKeys,
      source: 'cli'
    })

    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        project,
        service: effectiveService,
        environment,
        shared: context.shared || false,
        added: addedKeys.length,
        updated: updatedKeys.length,
        deleted: deletedKeys.length,
        total: varCount
      }))
    } else {
      ui.success(`Pushed ${varCount} variables to ${project}/${environment}`)
      if (addedKeys.length > 0) {
        ui.log(`  Added: ${addedKeys.length}`)
      }
      if (updatedKeys.length > 0) {
        ui.log(`  Updated: ${updatedKeys.length}`)
      }
      if (deletedKeys.length > 0) {
        ui.log(`  ${c.removed(`Deleted: ${deletedKeys.length}`)}`)
      }
    }
  } finally {
    await client.disconnect()
    await disconnectAuditLogger(auditLogger)
  }
}
