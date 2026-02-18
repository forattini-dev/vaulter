/**
 * Vaulter CLI - High-level mutation commands
 *
 * change set/delete/move - opinionated entrypoint for mutating variables
 * with lower cognitive load than remembering `var` subcommands directly.
 */

import type { VarContext } from './var/index.js'
import { c, print } from '../lib/colors.js'
import * as ui from '../ui.js'

/**
 * Router for change subcommands
 */
export async function runChange(context: VarContext): Promise<void> {
  const { args } = context
  const subcommand = args._[1]

  switch (subcommand) {
    case 'set': {
      const { runSet } = await import('./set.js')
      const shiftedArgs = {
        ...args,
        _: ['set', ...args._.slice(2)]
      }
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
      const { runDelete } = await import('./delete.js')
      const shiftedArgs = {
        ...args,
        _: ['delete', ...args._.slice(2)]
      }
      await runDelete({ ...context, args: shiftedArgs })
      break
    }

    case 'move': {
      const { runMove } = await import('./move.js')
      const shiftedArgs = {
        ...args,
        _: ['move', ...args._.slice(2)]
      }
      await runMove({
        ...context,
        args: shiftedArgs
      })
      break
    }

    default: {
      if (!subcommand || subcommand.startsWith('-')) {
        ui.log(`${c.label('Usage:')} ${c.command('vaulter change')} ${c.subcommand('<command>')} [options]`)
        ui.log('')
        ui.log(c.header('Commands:'))
        ui.log(`  ${c.subcommand('set')} ${c.muted('<vars>')}            Set variables`)
        ui.log(`  ${c.subcommand('delete')} ${c.muted('<key>')}          Delete a variable`)
        ui.log(`  ${c.subcommand('move')} ${c.muted('<key>')}           Move/copy between scopes`)
        ui.log('')
        ui.log(c.header('Set Syntax:'))
        ui.log(`  ${c.key('KEY')}${c.secret('=')}${c.value('value')}        ${c.secretType('secret')} ${c.muted('(encrypted)')}`)
        ui.log(`  ${c.key('KEY')}${c.config('::')}${c.value('value')}       ${c.configType('config')} ${c.muted('(plain text)')}`)
        ui.log(`  ${c.key('KEY')}${c.muted(':=')}${c.value('123')}          ${c.secretType('secret')} ${c.muted('(typed)')}`)
        process.exit(1)
      } else {
        print.error(`Unknown subcommand: ${c.command('change')} ${c.subcommand(subcommand)}`)
        ui.log(`Run "${c.command('vaulter change --help')}" for usage`)
        process.exit(1)
      }
    }
  }
}
