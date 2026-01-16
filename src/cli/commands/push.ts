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

interface PushContext {
  args: CLIArgs
  config: VaulterConfig | null
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
 * Run the push command
 */
export async function runPush(context: PushContext): Promise<void> {
  const { args, config, project, service, environment, verbose, dryRun, jsonOutput } = context

  if (!project) {
    console.error('Error: Project not specified and no config found')
    console.error('Run "vaulter init" or specify --project')
    process.exit(1)
  }

  // Production confirmation
  if (isProdEnvironment(environment) && config?.security?.confirm_production && !args.force) {
    console.error(`Warning: You are pushing to ${environment} (production) environment`)
    console.error('Use --force to confirm this action')
    process.exit(1)
  }

  // Determine source of variables
  let localVars: Record<string, string>

  if (hasStdinData()) {
    // Read from stdin
    if (verbose) {
      console.error('Reading variables from stdin...')
    }
    localVars = await parseEnvFromStdin()
  } else {
    // Read from file
    const filePath = args.file || args.f
    let envFilePath: string

    if (filePath) {
      envFilePath = path.resolve(filePath)
    } else {
      // Default path depends on directories.mode:
      // - unified: .vaulter/environments/<env>.env
      // - split: deploy/secrets/<env>.env
      const configDir = findConfigDir()
      if (!configDir || !config) {
        console.error('Error: No config directory found and no file specified')
        console.error('Use -f <file> to specify the .env file')
        process.exit(1)
      }
      envFilePath = getEnvFilePathForConfig(config, configDir, environment)
    }

    if (!fs.existsSync(envFilePath)) {
      console.error(`Error: File not found: ${envFilePath}`)
      process.exit(1)
    }

    if (verbose) {
      console.error(`Reading variables from ${envFilePath}`)
    }

    localVars = parseEnvFile(envFilePath)
  }

  const varCount = Object.keys(localVars).length

  if (varCount === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        warning: 'no_variables',
        message: 'No variables found in source'
      }))
    } else {
      console.error('Warning: No variables found in source')
    }
    return
  }

  if (verbose) {
    console.error(`Found ${varCount} variables to push`)
  }

  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()

    if (dryRun) {
      // Get remote vars for comparison
      const remoteVars = await client.export(project, environment, service)

      const toAdd: string[] = []
      const toUpdate: string[] = []
      const unchanged: string[] = []

      for (const [key, value] of Object.entries(localVars)) {
        if (!(key in remoteVars)) {
          toAdd.push(key)
        } else if (remoteVars[key] !== value) {
          toUpdate.push(key)
        } else {
          unchanged.push(key)
        }
      }

      if (jsonOutput) {
        console.log(JSON.stringify({
          dryRun: true,
          project,
          service,
          environment,
          changes: {
            add: toAdd,
            update: toUpdate,
            unchanged: unchanged
          }
        }))
      } else {
        console.log('Dry run - changes that would be made:')
        if (toAdd.length > 0) {
          console.log(`  Add (${toAdd.length}): ${toAdd.join(', ')}`)
        }
        if (toUpdate.length > 0) {
          console.log(`  Update (${toUpdate.length}): ${toUpdate.join(', ')}`)
        }
        if (unchanged.length > 0) {
          console.log(`  Unchanged: ${unchanged.length} variables`)
        }
        if (toAdd.length === 0 && toUpdate.length === 0) {
          console.log('  No changes needed')
        }
      }
      return
    }

    // Push all variables (insert/update only, no delete)
    let added = 0
    let updated = 0

    for (const [key, value] of Object.entries(localVars)) {
      const existing = await client.get(key, project, environment, service)

      await client.set({
        key,
        value,
        project,
        service,
        environment,
        metadata: {
          source: 'sync'
        }
      })

      if (existing) {
        updated++
      } else {
        added++
      }
    }

    if (jsonOutput) {
      console.log(JSON.stringify({
        success: true,
        project,
        service,
        environment,
        added,
        updated,
        total: varCount
      }))
    } else {
      console.log(`✓ Pushed ${varCount} variables to ${project}/${environment}`)
      if (added > 0) {
        console.log(`  Added: ${added}`)
      }
      if (updated > 0) {
        console.log(`  Updated: ${updated}`)
      }
    }
  } finally {
    await client.disconnect()
  }
}
