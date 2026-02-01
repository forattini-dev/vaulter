/**
 * Vaulter CLI - Var Command Group
 *
 * Variable management commands: get, set, delete, list
 * Supports --shared flag for monorepo shared variables
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../../types.js'
import { c, colorEnv, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'

// Re-export individual commands from parent directory
export { runGet } from '../get.js'
export { runSet } from '../set.js'
export { runDelete } from '../delete.js'
export { runList } from '../list.js'

export interface VarContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
  // New: shared variables support
  shared?: boolean
  override?: boolean
  // Separator buckets for set command
  secrets?: Record<string, string | number | boolean | null>
  configs?: Record<string, string | number | boolean | null>
  meta?: Record<string, string | number | boolean | null>
}

/**
 * Router for var subcommands
 */
export async function runVar(context: VarContext): Promise<void> {
  const { args } = context
  const subcommand = args._[1]

  // Dynamic import to avoid circular dependencies
  switch (subcommand) {
    case 'get': {
      const { runGet } = await import('../get.js')
      // Shift args to match expected format (var get KEY -> get KEY)
      const shiftedArgs = {
        ...args,
        _: ['get', ...args._.slice(2)]
      }
      await runGet({ ...context, args: shiftedArgs })
      break
    }

    case 'set': {
      const { runSet } = await import('../set.js')
      const shiftedArgs = {
        ...args,
        _: ['set', ...args._.slice(2)]
      }
      // Ensure separator buckets are defined (required by SetContext)
      await runSet({
        ...context,
        args: shiftedArgs,
        secrets: context.secrets ?? {},
        configs: context.configs ?? {},
        meta: context.meta ?? {}
      })
      break
    }

    case 'delete':
    case 'rm':
    case 'remove': {
      const { runDelete } = await import('../delete.js')
      const shiftedArgs = {
        ...args,
        _: ['delete', ...args._.slice(2)]
      }
      await runDelete({ ...context, args: shiftedArgs })
      break
    }

    case 'list':
    case 'ls': {
      const { runList } = await import('../list.js')
      const shiftedArgs = {
        ...args,
        _: ['list', ...args._.slice(2)]
      }
      await runList({ ...context, args: shiftedArgs })
      break
    }

    case 'versions':
    case 'history': {
      const { runVersions } = await import('../versions.js')
      const shiftedArgs = {
        ...args,
        _: ['versions', ...args._.slice(2)]
      }
      await runVersions({ ...context, args: shiftedArgs })
      break
    }

    case 'rollback': {
      const { runRollback } = await import('../rollback.js')
      const shiftedArgs = {
        ...args,
        _: ['rollback', ...args._.slice(2)]
      }
      await runRollback({ ...context, args: shiftedArgs })
      break
    }

    default:
      if (!subcommand) {
        ui.log(`${c.label('Usage:')} ${c.command('vaulter var')} ${c.subcommand('<command>')} [options]`)
        ui.log('')
        ui.log(c.header('Commands:'))
        ui.log(`  ${c.subcommand('get')} ${c.muted('<key>')}             Get a single variable`)
        ui.log(`  ${c.subcommand('set')} ${c.muted('<vars>')}            Set variables (see syntax below)`)
        ui.log(`  ${c.subcommand('delete')} ${c.muted('<key>')}          Delete a variable`)
        ui.log(`  ${c.subcommand('list')}                  List all variables`)
        ui.log(`  ${c.subcommand('versions')} ${c.muted('<key>')}        List version history`)
        ui.log(`  ${c.subcommand('rollback')} ${c.muted('<key> <ver>')}  Rollback to version`)
        ui.log('')
        ui.log(c.header('Set Syntax:'))
        ui.log(`  ${c.key('KEY')}${c.secret('=')}${c.value('value')}        ${c.secretType('secret')} ${c.muted('(encrypted, synced to backend)')}`)
        ui.log(`  ${c.key('KEY')}${c.config('::')}${c.value('value')}       ${c.configType('config')} ${c.muted('(plain text, file only in split mode)')}`)
        ui.log(`  ${c.key('KEY')}${c.muted(':=')}${c.value('123')}          ${c.secretType('secret')} ${c.muted('typed (number/boolean)')}`)
        ui.log('')
        ui.log(c.header('Options:'))
        ui.log(`  ${c.highlight('-e')}, ${c.highlight('--env')}      Environment (${colorEnv('dev')}, ${colorEnv('stg')}, ${colorEnv('prd')})`)
        ui.log(`  ${c.highlight('-s')}, ${c.highlight('--service')}  Service name (for monorepos)`)
        ui.log(`  ${c.highlight('--shared')}       Target shared variables (monorepo)`)
        ui.log(`  ${c.highlight('--json')}         Output in JSON format`)
        process.exit(1)
      } else {
        print.error(`Unknown subcommand: ${c.command('var')} ${c.subcommand(subcommand)}`)
        ui.log(`Run "${c.command('vaulter var --help')}" for usage`)
        process.exit(1)
      }
  }
}
