/**
 * Vaulter CLI - Var Command Group
 *
 * Variable management commands: get, set, delete, list
 * Supports --shared flag for monorepo shared variables
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../../types.js'
import { c, colorEnv, print } from '../../lib/colors.js'

// Re-export individual commands from parent directory
// This allows gradual migration without moving files
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

    default:
      if (!subcommand) {
        console.error(`${c.label('Usage:')} ${c.command('vaulter var')} ${c.subcommand('<command>')} [options]`)
        console.error('')
        console.error(c.header('Commands:'))
        console.error(`  ${c.subcommand('get')} ${c.muted('<key>')}      Get a single variable`)
        console.error(`  ${c.subcommand('set')} ${c.muted('<vars>')}     Set variables (see syntax below)`)
        console.error(`  ${c.subcommand('delete')} ${c.muted('<key>')}   Delete a variable`)
        console.error(`  ${c.subcommand('list')}           List all variables`)
        console.error('')
        console.error(c.header('Set Syntax:'))
        console.error(`  ${c.key('KEY')}${c.secret('=')}${c.value('value')}        ${c.secretType('secret')} ${c.muted('(encrypted, synced to backend)')}`)
        console.error(`  ${c.key('KEY')}${c.config('::')}${c.value('value')}       ${c.configType('config')} ${c.muted('(plain text, file only in split mode)')}`)
        console.error(`  ${c.key('KEY')}${c.muted(':=')}${c.value('123')}          ${c.secretType('secret')} ${c.muted('typed (number/boolean)')}`)
        console.error('')
        console.error(c.header('Options:'))
        console.error(`  ${c.highlight('-e')}, ${c.highlight('--env')}      Environment (${colorEnv('dev')}, ${colorEnv('stg')}, ${colorEnv('prd')})`)
        console.error(`  ${c.highlight('-s')}, ${c.highlight('--service')}  Service name (for monorepos)`)
        console.error(`  ${c.highlight('--shared')}       Target shared variables (monorepo)`)
        console.error(`  ${c.highlight('--json')}         Output in JSON format`)
        process.exit(1)
      } else {
        print.error(`Unknown subcommand: ${c.command('var')} ${c.subcommand(subcommand)}`)
        console.error(`Run "${c.command('vaulter var --help')}" for usage`)
        process.exit(1)
      }
  }
}
