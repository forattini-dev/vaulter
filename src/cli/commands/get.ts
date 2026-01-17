/**
 * Vaulter CLI - Get Command
 *
 * Get a single environment variable
 * Supports --shared flag for monorepo shared variables
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import { SHARED_SERVICE, formatSource } from '../../lib/shared.js'

interface GetContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  jsonOutput: boolean
  /** Target shared variables scope */
  shared?: boolean
}

/**
 * Run the get command
 */
export async function runGet(context: GetContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  // Check for --shared flag
  const isShared = args.shared || context.shared

  // Get key from positional args
  const key = args._[1]

  if (!key) {
    print.error('Key name is required')
    console.error(`${c.label('Usage:')} ${c.command('vaulter var get')} ${c.key('<key>')} ${c.highlight('-e')} ${colorEnv('<env>')}`)
    process.exit(1)
  }

  if (!project) {
    print.error('Project not specified and no config found')
    console.error(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  // Determine effective service
  const effectiveService = isShared ? SHARED_SERVICE : service

  if (verbose) {
    const scope = isShared ? c.env('shared') : c.service(service || '(no service)')
    console.error(`${symbols.info} Getting ${c.key(key)} for ${c.project(project)}/${scope}/${colorEnv(environment)}`)
  }

  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()

    // If we have a service and want resolved value (with inheritance), check both
    let envVar = await client.get(key, project, environment, effectiveService)
    let source: 'shared' | 'service' | 'override' = 'service'

    // If not found in service scope and we have a service, try shared
    if (!envVar && service && !isShared) {
      const sharedVar = await client.get(key, project, environment, SHARED_SERVICE)
      if (sharedVar) {
        envVar = sharedVar
        source = 'shared'
      }
    } else if (envVar && service && !isShared) {
      // Check if this overrides a shared var
      const sharedVar = await client.get(key, project, environment, SHARED_SERVICE)
      if (sharedVar) {
        source = 'override'
      }
    }

    if (!envVar) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: 'not_found', key, project, environment }))
      } else {
        print.error(`Variable ${c.key(key)} not found`)
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
        source: formatSource(source),
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
