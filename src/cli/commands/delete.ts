/**
 * Vaulter CLI - Delete Command
 *
 * Delete an environment variable
 * Supports --shared flag for monorepo shared variables
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { withClient } from '../lib/create-client.js'
import { createConnectedAuditLogger, logDeleteOperation, disconnectAuditLogger } from '../lib/audit-helper.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import { SHARED_SERVICE } from '../../lib/shared.js'
import * as ui from '../ui.js'

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
    ui.log(`${c.label('Usage:')} ${c.command('vaulter var delete')} ${c.key('<key>')} ${c.highlight('-e')} ${colorEnv('<env>')}`)
    process.exit(1)
  }

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  // Determine effective service
  const effectiveService = isShared ? SHARED_SERVICE : service

  // Show environment banner (respects --quiet and --json)
  if (!jsonOutput && !dryRun) {
    ui.showEnvironmentBanner(environment, {
      project,
      service: isShared ? 'shared' : service,
      action: 'Deleting variable'
    })
  }

  // Production confirmation
  if (isProdEnvironment(environment) && config?.security?.confirm_production && !args.force) {
    print.warning(`You are deleting from ${colorEnv(environment)} (production) environment`)
    ui.log(`Use ${c.highlight('--force')} to confirm this action`)
    process.exit(1)
  }

  const scope = isShared ? c.env('shared') : c.service(service || '(no service)')
  ui.verbose(`${symbols.info} Deleting ${c.key(key)} from ${c.project(project)}/${scope}/${colorEnv(environment)}`, verbose)

  if (dryRun) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        action: 'delete',
        key,
        project,
        service: effectiveService,
        environment,
        shared: isShared,
        dryRun: true
      }))
    } else {
      const dryRunScope = isShared ? c.env('shared') : colorEnv(environment)
      ui.log(`${c.muted('Dry run')} - would delete ${c.key(key)} from ${c.project(project)}/${dryRunScope}`)
    }
    return
  }

  const auditLogger = await createConnectedAuditLogger(config, project, environment, verbose)

  try {
    await withClient({ args, config, project, verbose }, async (client) => {
      // Get existing value for audit log
      const existing = await client.get(key, project, environment, effectiveService)
      const previousValue = existing?.value

      const deleted = await client.delete(key, project, environment, effectiveService)

      if (!deleted) {
        if (jsonOutput) {
          ui.output(JSON.stringify({ error: 'not_found', key, project, environment }))
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
        ui.output(JSON.stringify({
          success: true,
          deleted: key,
          project,
          service: effectiveService,
          environment,
          shared: isShared
        }))
      } else {
        const successScope = isShared ? c.env('shared') : colorEnv(environment)
        ui.success(`Deleted ${c.key(key)} from ${c.project(project)}/${successScope}`)
      }
    })
  } finally {
    await disconnectAuditLogger(auditLogger)
  }
}
