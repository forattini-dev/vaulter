/**
 * Vaulter CLI - Local Command Group
 *
 * Local overrides layer on top of a base environment.
 * They never touch the backend — purely local development convenience.
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../../types.js'
import { c, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'

export interface LocalContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
  secrets?: Record<string, string | number | boolean | null>
  configs?: Record<string, string | number | boolean | null>
}

/**
 * Router for local subcommands
 */
export async function runLocalGroup(context: LocalContext): Promise<void> {
  const { args } = context
  const subcommand = args._[1]

  switch (subcommand) {
    case 'init': {
      const { runLocalInit } = await import('./init.js')
      await runLocalInit(context)
      break
    }

    case 'pull': {
      const { runLocalPull } = await import('./pull.js')
      await runLocalPull(context)
      break
    }

    case 'push': {
      const { runLocalPushCommand } = await import('./push.js')
      await runLocalPushCommand(context)
      break
    }

    case 'sync': {
      const { runLocalSyncCommand } = await import('./sync.js')
      await runLocalSyncCommand(context)
      break
    }

    case 'set': {
      const { runLocalSet } = await import('./set.js')
      await runLocalSet(context)
      break
    }

    case 'delete':
    case 'rm': {
      const { runLocalDelete } = await import('./delete.js')
      await runLocalDelete(context)
      break
    }

    case 'diff': {
      const { runLocalDiff } = await import('./diff.js')
      await runLocalDiff(context)
      break
    }

    case 'status': {
      const { runLocalStatus } = await import('./status.js')
      await runLocalStatus(context)
      break
    }

    default:
      if (!subcommand || subcommand.startsWith('-')) {
        ui.log(`${c.label('Usage:')} ${c.command('vaulter local')} ${c.subcommand('<command>')} [options]`)
        ui.log('')
        ui.log(c.header('Commands:'))
        ui.log(`  ${c.subcommand('init')}      Create local overrides directory`)
        ui.log(`  ${c.subcommand('pull')}      Generate .env files from local files ${c.muted('(all outputs by default) [OFFLINE]')}`)
        ui.log(`  ${c.subcommand('push')}      Push local to backend ${c.muted('(--all for entire structure)')}`)
        ui.log(`  ${c.subcommand('sync')}      Pull from backend to .vaulter/local/`)
        ui.log(`  ${c.subcommand('set')}       Add local override (KEY=val KEY::val2)`)
        ui.log(`  ${c.subcommand('delete')}    Remove local override`)
        ui.log(`  ${c.subcommand('diff')}      Show overrides vs base`)
        ui.log(`  ${c.subcommand('status')}    Show local state summary`)
        ui.log('')
        ui.log(c.header('Workflow:'))
        ui.log(`  ${c.muted('1.')} Edit files in .vaulter/local/`)
        ui.log(`  ${c.muted('2.')} ${c.command('vaulter local pull')}  ${c.muted('Generate .env files')}`)
        ui.log(`  ${c.muted('3.')} ${c.command('vaulter local push --all')} ${c.muted('Share with team')}`)
        process.exit(1)
      } else {
        print.error(`Unknown subcommand: ${c.command('local')} ${c.subcommand(subcommand)}`)
        ui.log(`Run "${c.command('vaulter local --help')}" for usage`)
        process.exit(1)
      }
  }
}
