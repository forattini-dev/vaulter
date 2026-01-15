/**
 * MiniEnv CLI - Delete Command
 *
 * Delete an environment variable
 */

import type { CLIArgs, MiniEnvConfig, Environment } from '../../types.js'
import { MiniEnvClient } from '../../client.js'
import { loadEncryptionKey } from '../../lib/config-loader.js'

interface DeleteContext {
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
 * Run the delete command
 */
export async function runDelete(context: DeleteContext): Promise<void> {
  const { args, config, project, service, environment, verbose, dryRun, jsonOutput } = context

  // Get key from positional args
  const key = args._[1]

  if (!key) {
    console.error('Error: Key name is required')
    console.error('Usage: minienv delete <key> [-e <env>]')
    process.exit(1)
  }

  if (!project) {
    console.error('Error: Project not specified and no config found')
    console.error('Run "minienv init" or specify --project')
    process.exit(1)
  }

  // Production confirmation
  if (isProdEnvironment(environment) && config?.security?.confirm_production && !args.force) {
    console.error(`Warning: You are deleting from ${environment} (production) environment`)
    console.error('Use --force to confirm this action')
    process.exit(1)
  }

  if (verbose) {
    console.error(`Deleting ${key} from ${project}/${service || '(no service)'}/${environment}`)
  }

  if (dryRun) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        action: 'delete',
        key,
        project,
        service,
        environment,
        dryRun: true
      }))
    } else {
      console.log(`Dry run - would delete ${key} from ${project}/${environment}`)
    }
    return
  }

  // Build connection string
  const connectionString = args.backend || args.b || config?.backend?.url
  const passphrase = config ? await loadEncryptionKey(config) : undefined

  const client = new MiniEnvClient({
    connectionString: connectionString || undefined,
    passphrase: passphrase || undefined
  })

  try {
    await client.connect()

    const deleted = await client.delete(key, project, environment, service)

    if (!deleted) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: 'not_found', key, project, environment }))
      } else {
        console.error(`Variable ${key} not found`)
      }
      process.exit(1)
    }

    if (jsonOutput) {
      console.log(JSON.stringify({
        success: true,
        deleted: key,
        project,
        service,
        environment
      }))
    } else {
      console.log(`✓ Deleted ${key} from ${project}/${environment}`)
    }
  } finally {
    await client.disconnect()
  }
}
