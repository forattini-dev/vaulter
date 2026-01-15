/**
 * Vaulter CLI - Set Command
 *
 * Set an environment variable (create or update)
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'

interface SetContext {
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
 * Check if this is a production environment and confirm if needed
 */
function isProdEnvironment(env: Environment): boolean {
  return env === 'prd' || env === 'dr'
}

/**
 * Run the set command
 */
export async function runSet(context: SetContext): Promise<void> {
  const { args, config, project, service, environment, verbose, dryRun, jsonOutput } = context

  // Get key and value from positional args
  const key = args._[1]
  const value = args._[2]

  if (!key) {
    console.error('Error: Key name is required')
    console.error('Usage: vaulter set <key> <value> [-e <env>]')
    process.exit(1)
  }

  if (value === undefined) {
    console.error('Error: Value is required')
    console.error('Usage: vaulter set <key> <value> [-e <env>]')
    process.exit(1)
  }

  if (!project) {
    console.error('Error: Project not specified and no config found')
    console.error('Run "vaulter init" or specify --project')
    process.exit(1)
  }

  // Production confirmation
  if (isProdEnvironment(environment) && config?.security?.confirm_production && !args.force) {
    console.error(`Warning: You are modifying ${environment} (production) environment`)
    console.error('Use --force to confirm this action')
    process.exit(1)
  }

  if (verbose) {
    console.error(`Setting ${key} for ${project}/${service || '(no service)'}/${environment}`)
  }

  if (dryRun) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        action: 'set',
        key,
        project,
        service,
        environment,
        dryRun: true
      }))
    } else {
      console.log(`Dry run - would set ${key} in ${project}/${environment}`)
    }
    return
  }

  const client = await createClientFromConfig({ args, config, verbose })

  try {
    await client.connect()

    const envVar = await client.set({
      key,
      value,
      project,
      service,
      environment,
      metadata: {
        source: 'manual'
      }
    })

    if (jsonOutput) {
      console.log(JSON.stringify({
        success: true,
        key: envVar.key,
        project: envVar.project,
        service: envVar.service,
        environment: envVar.environment,
        createdAt: envVar.createdAt,
        updatedAt: envVar.updatedAt
      }))
    } else {
      console.log(`✓ Set ${key} in ${project}/${environment}`)
    }
  } finally {
    await client.disconnect()
  }
}
