/**
 * Vaulter CLI - Nuke Command
 *
 * DANGER: Permanently deletes ALL data from the remote storage.
 * This includes all environment variables, partitions, and metadata.
 *
 * Safety locks:
 * 1. --confirm=<project-name> required (must match exactly)
 * 2. Interactive mode: must type "DELETE" to confirm
 * 3. Non-interactive mode (CI): requires additional --force flag
 */

import type { CLIArgs, VaulterConfig } from '../../types.js'
import { withClient } from '../lib/create-client.js'
import { createConnectedAuditLogger, disconnectAuditLogger } from '../lib/audit-helper.js'
import { c, symbols, print } from '../lib/colors.js'
import * as ui from '../ui.js'
import * as readline from 'node:readline'

interface NukeContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

/**
 * Prompt user for interactive confirmation
 */
async function promptConfirmation(message: string, expectedInput: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr
    })

    rl.question(message, (answer) => {
      rl.close()
      resolve(answer.trim() === expectedInput)
    })
  })
}

/**
 * Run the nuke command
 */
export async function runNuke(context: NukeContext): Promise<void> {
  const { args, config, project, verbose, dryRun, jsonOutput } = context

  // Get --confirm value
  const confirmToken = args.confirm as string | undefined

  if (!confirmToken) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        error: 'missing_confirmation',
        message: 'The --confirm=<project-name> flag is required'
      }))
    } else {
      print.error('The --confirm=<project-name> flag is required')
      ui.log('')
      ui.log(`${c.warning('⚠️  DANGER:')} This command permanently deletes ALL data from the remote storage.`)
      ui.log('')
      ui.log(`${c.label('Usage:')}`)
      ui.log(`  ${c.command('vaulter nuke')} ${c.highlight('--confirm=<project-name>')}`)
      ui.log('')
      ui.log(`${c.label('Example:')}`)
      ui.log(`  ${c.command('vaulter nuke')} ${c.highlight('--confirm=my-project')}`)
      ui.log('')
      ui.log(`${c.muted('The project name must match exactly for safety.')}`)
    }
    process.exit(1)
  }

  await withClient({ args, config, project, verbose }, async (client) => {
    // Get preview of what will be deleted
    const preview = await client.nukePreview()

    if (preview.totalVars === 0) {
      if (jsonOutput) {
        ui.output(JSON.stringify({
          success: true,
          message: 'No data to delete',
          deletedCount: 0
        }))
      } else {
        ui.log(`${symbols.info} No data found in remote storage. Nothing to delete.`)
      }
      return
    }

    // Verify confirm token matches project
    if (confirmToken !== preview.project) {
      if (jsonOutput) {
        ui.output(JSON.stringify({
          error: 'confirmation_mismatch',
          message: `Confirmation token "${confirmToken}" does not match project "${preview.project}"`,
          expectedProject: preview.project
        }))
      } else {
        print.error(`Confirmation mismatch!`)
        ui.log('')
        ui.log(`  ${c.label('You provided:')} ${c.error(confirmToken)}`)
        ui.log(`  ${c.label('Expected:')}     ${c.success(preview.project!)}`)
        ui.log('')
        ui.log(`${c.muted('The --confirm value must exactly match the project name.')}`)
      }
      process.exit(1)
    }

    // Show what will be deleted
    if (!jsonOutput) {
      ui.log('')
      ui.log(`${c.error('┌────────────────────────────────────────────────────────────┐')}`)
      ui.log(`${c.error('│')}  ${c.error('⚠️  WARNING: DESTRUCTIVE OPERATION')}                         ${c.error('│')}`)
      ui.log(`${c.error('│')}                                                            ${c.error('│')}`)
      ui.log(`${c.error('│')}  This will permanently delete ALL data from:               ${c.error('│')}`)
      ui.log(`${c.error('│')}                                                            ${c.error('│')}`)
      ui.log(`${c.error('│')}    Project:      ${c.project(preview.project!.padEnd(37))}  ${c.error('│')}`)
      ui.log(`${c.error('│')}    Variables:    ${String(preview.totalVars).padEnd(37)}  ${c.error('│')}`)
      ui.log(`${c.error('│')}    Environments: ${preview.environments.join(', ').padEnd(37)}  ${c.error('│')}`)
      if (preview.services.length > 0) {
        ui.log(`${c.error('│')}    Services:     ${preview.services.join(', ').padEnd(37)}  ${c.error('│')}`)
      }
      ui.log(`${c.error('│')}                                                            ${c.error('│')}`)
      ui.log(`${c.error('│')}  ${c.muted('This action CANNOT be undone!')}                             ${c.error('│')}`)
      ui.log(`${c.error('└────────────────────────────────────────────────────────────┘')}`)
      ui.log('')

      // Sample variables
      if (preview.sampleVars.length > 0) {
        ui.log(`${c.label('Sample variables that will be deleted:')}`)
        for (const v of preview.sampleVars.slice(0, 5)) {
          const scope = v.service ? `${v.environment}/${v.service}` : v.environment
          ui.log(`  ${c.muted('•')} ${c.key(v.key)} ${c.muted(`(${scope})`)}`)
        }
        if (preview.totalVars > 5) {
          ui.log(`  ${c.muted(`... and ${preview.totalVars - 5} more`)}`)
        }
        ui.log('')
      }
    }

    // Dry run: show what would happen but don't delete
    if (dryRun) {
      if (jsonOutput) {
        ui.output(JSON.stringify({
          dryRun: true,
          wouldDelete: {
            project: preview.project,
            totalVars: preview.totalVars,
            environments: preview.environments,
            services: preview.services
          }
        }))
      } else {
        ui.log(`${c.muted('Dry run')} - would delete ${c.error(String(preview.totalVars))} variables`)
        ui.log(`${c.muted('No changes made.')}`)
      }
      return
    }

    // Check if running in interactive mode
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY

    if (isInteractive && !args.force) {
      // Interactive mode: require typing "DELETE"
      ui.log(`${c.label('To proceed, type')} ${c.error('DELETE')} ${c.label('and press Enter:')}`)
      const confirmed = await promptConfirmation('> ', 'DELETE')

      if (!confirmed) {
        if (jsonOutput) {
          ui.output(JSON.stringify({
            error: 'cancelled',
            message: 'Operation cancelled by user'
          }))
        } else {
          ui.log('')
          ui.log(`${symbols.info} Operation cancelled. No data was deleted.`)
        }
        process.exit(1)
      }
    } else if (!args.force) {
      // Non-interactive mode without --force
      if (jsonOutput) {
        ui.output(JSON.stringify({
          error: 'force_required',
          message: 'Non-interactive mode requires --force flag'
        }))
      } else {
        print.error('Non-interactive mode detected. Add --force to confirm deletion.')
        ui.log('')
        ui.log(`${c.label('Usage in CI/scripts:')}`)
        ui.log(`  ${c.command('vaulter nuke')} ${c.highlight(`--confirm=${preview.project}`)} ${c.highlight('--force')}`)
      }
      process.exit(1)
    }

    // Log to audit before deleting (use default env for key resolution)
    const defaultEnv = config?.default_environment || 'dev'
    const auditLogger = await createConnectedAuditLogger(config, project, defaultEnv, verbose)
    if (auditLogger) {
      try {
        await auditLogger.log({
          operation: 'deleteAll',
          key: '*',
          project: preview.project!,
          environment: '*',
          source: 'cli',
          metadata: {
            totalVars: preview.totalVars,
            environments: preview.environments,
            services: preview.services
          }
        })
      } catch {
        // Audit failure shouldn't block the operation
      }
    }

    // Execute the nuke
    const spinner = ui.createSpinner('Deleting all data...')
    spinner.start()

    try {
      const result = await client.nukeAllData(confirmToken)
      spinner.succeed(`Deleted ${result.deletedCount} objects from ${result.project}`)

      if (jsonOutput) {
        ui.output(JSON.stringify({
          success: true,
          deletedCount: result.deletedCount,
          project: result.project
        }))
      }
    } catch (err) {
      spinner.fail('Failed to delete data')
      throw err
    } finally {
      await disconnectAuditLogger(auditLogger)
    }
  })
}
