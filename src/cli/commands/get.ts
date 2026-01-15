/**
 * MiniEnv CLI - Get Command
 *
 * Get a single environment variable
 */

import type { CLIArgs, MiniEnvConfig, Environment } from '../../types.js'
import { MiniEnvClient } from '../../client.js'
import { loadEncryptionKey } from '../../lib/config-loader.js'

interface GetContext {
  args: CLIArgs
  config: MiniEnvConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  jsonOutput: boolean
}

/**
 * Run the get command
 */
export async function runGet(context: GetContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  // Get key from positional args
  const key = args._[1]

  if (!key) {
    console.error('Error: Key name is required')
    console.error('Usage: minienv get <key> [-e <env>]')
    process.exit(1)
  }

  if (!project) {
    console.error('Error: Project not specified and no config found')
    console.error('Run "minienv init" or specify --project')
    process.exit(1)
  }

  if (verbose) {
    console.error(`Getting ${key} for ${project}/${service || '(no service)'}/${environment}`)
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

    const envVar = await client.get(key, project, environment, service)

    if (!envVar) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: 'not_found', key, project, environment }))
      } else {
        console.error(`Variable ${key} not found`)
      }
      process.exit(1)
    }

    if (jsonOutput) {
      console.log(JSON.stringify({
        key: envVar.key,
        value: envVar.value,
        project: envVar.project,
        service: envVar.service,
        environment: envVar.environment,
        tags: envVar.tags,
        metadata: envVar.metadata,
        createdAt: envVar.createdAt,
        updatedAt: envVar.updatedAt
      }))
    } else {
      // Output just the value for easy piping
      console.log(envVar.value)
    }
  } finally {
    await client.disconnect()
  }
}
