/**
 * Vaulter CLI - Delete Command
 *
 * Delete an environment variable
 * Supports --shared flag for monorepo shared variables
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import { createConnectedAuditLogger, logDeleteOperation, disconnectAuditLogger } from '../lib/audit-helper.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import { SHARED_SERVICE } from '../../lib/shared.js'

interface DeleteContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
  /** Target shared variables scope */
  shared?: boolean
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

  // Check for --shared flag
  const isShared = args.shared || context.shared

  // Get key from positional args
  const key = args._[1]

  if (!key) {
    print.error('Key name is required')
    console.error(`${c.label('Usage:')} ${c.command('vaulter var delete')} ${c.key('<key>')} ${c.highlight('-e')} ${colorEnv('<env>')}`)
    process.exit(1)
  }

  if (!project) {
    print.error('Project not specified and no config found')
    console.error(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  // Determine effective service
  const effectiveService = isShared ? SHARED_SERVICE : service

  // Production confirmation
  if (isProdEnvironment(environment) && config?.security?.confirm_production && !args.force) {
    print.warning(`You are deleting from ${colorEnv(environment)} (production) environment`)
    console.error(`Use ${c.highlight('--force')} to confirm this action`)
    process.exit(1)
  }

  if (verbose) {
    const scope = isShared ? c.env('shared') : c.service(service || '(no service)')
    console.error(`${symbols.info} Deleting ${c.key(key)} from ${c.project(project)}/${scope}/${colorEnv(environment)}`)
  }

  if (dryRun) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        action: 'delete',
        key,
        project,
        service: effectiveService,
        environment,
        shared: isShared,
        dryRun: true
      }))
    } else {
      const scope = isShared ? c.env('shared') : colorEnv(environment)
      console.log(`${c.muted('Dry run')} - would delete ${c.key(key)} from ${c.project(project)}/${scope}`)
    }
    return
  }

  const client = await createClientFromConfig({ args, config, project, verbose })
  const auditLogger = await createConnectedAuditLogger(config, verbose)

  try {
    await client.connect()

    // Get existing value for audit log
    const existing = await client.get(key, project, environment, effectiveService)
    const previousValue = existing?.value

    const deleted = await client.delete(key, project, environment, effectiveService)

    if (!deleted) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: 'not_found', key, project, environment }))
      } else {
        print.error(`Variable ${c.key(key)} not found`)
      }
      process.exit(1)
    }

    // Log to audit trail
    await logDeleteOperation(auditLogger, {
      key,
      previousValue,
      project,
      environment,
      service: effectiveService,
      source: 'cli'
    })

    if (jsonOutput) {
      console.log(JSON.stringify({
        success: true,
        deleted: key,
        project,
        service: effectiveService,
        environment,
        shared: isShared
      }))
    } else {
      const scope = isShared ? c.env('shared') : colorEnv(environment)
      console.log(`${symbols.success} Deleted ${c.key(key)} from ${c.project(project)}/${scope}`)
    }
  } finally {
    await client.disconnect()
    await disconnectAuditLogger(auditLogger)
  }
}
