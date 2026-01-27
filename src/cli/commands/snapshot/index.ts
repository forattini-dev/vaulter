/**
 * Vaulter CLI - Snapshot Command Group
 *
 * Backup/restore environment snapshots.
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../../types.js'
import { c, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'

export interface SnapshotContext {
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
 * Router for snapshot subcommands
 */
export async function runSnapshotGroup(context: SnapshotContext): Promise<void> {
  const { args } = context
  const subcommand = args._[1]

  switch (subcommand) {
    case 'create': {
      const { runSnapshotCreate } = await import('./create.js')
      await runSnapshotCreate(context)
      break
    }

    case 'list':
    case 'ls': {
      const { runSnapshotList } = await import('./list.js')
      await runSnapshotList(context)
      break
    }

    case 'restore': {
      const { runSnapshotRestore } = await import('./restore.js')
      await runSnapshotRestore(context)
      break
    }

    case 'delete':
    case 'rm': {
      const { runSnapshotDelete } = await import('./delete.js')
      await runSnapshotDelete(context)
      break
    }

    default:
      if (!subcommand || subcommand.startsWith('-')) {
        ui.log(`${c.label('Usage:')} ${c.command('vaulter snapshot')} ${c.subcommand('<command>')} [options]`)
        ui.log('')
        ui.log(c.header('Commands:'))
        ui.log(`  ${c.subcommand('create')}    Save snapshot of an environment`)
        ui.log(`  ${c.subcommand('list')}      List snapshots`)
        ui.log(`  ${c.subcommand('restore')}   Restore snapshot to backend`)
        ui.log(`  ${c.subcommand('delete')}    Remove a snapshot`)
        process.exit(1)
      } else {
        print.error(`Unknown subcommand: ${c.command('snapshot')} ${c.subcommand(subcommand)}`)
        ui.log(`Run "${c.command('vaulter snapshot --help')}" for usage`)
        process.exit(1)
      }
  }
}
