/**
 * Vaulter CLI - Release Command Group
 *
 * High-level deploy workflow on top of sync:
 * - plan: always preview (merge/push/pull)
 * - apply: execute plan after preview
 * - pull / push / merge / diff: direct passthrough
 *
 * This keeps the deploy path simple for day-to-day ops and AI decisions.
 */

import { c, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { CLIArgs, VaulterConfig, Environment } from '../../../types.js'
import { runDoctor } from '../doctor.js'
import { runSyncGroup } from '../sync/index.js'

export interface ReleaseContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

type ReleaseSyncAction = 'merge' | 'push' | 'pull'

function isReleaseAction(value: string | undefined): value is ReleaseSyncAction {
  return value === 'merge' || value === 'push' || value === 'pull'
}

function resolveAction(args: CLIArgs, fallback: ReleaseSyncAction): ReleaseSyncAction | undefined {
  const explicit = typeof args._[2] === 'string' ? args._[2].toLowerCase() : undefined
  if (explicit && isReleaseAction(explicit)) {
    return explicit
  }

  const cliFlag = typeof args.action === 'string' ? args.action.toLowerCase() : ''
  if (isReleaseAction(cliFlag)) {
    return cliFlag
  }

  if (explicit) {
    return undefined
  }

  return fallback
}

function normalizeReleasePlanArgs(
  context: ReleaseContext,
  action: ReleaseSyncAction,
  apply: boolean
): CLIArgs {
  const sourceArgs = context.args
  const hasExplicitAction = sourceArgs._[2] && isReleaseAction(typeof sourceArgs._[2] === 'string' ? sourceArgs._[2].toLowerCase() : '')
  const shiftedArgs = sourceArgs._.slice(hasExplicitAction ? 3 : 2)
  return {
    ...sourceArgs,
    apply,
    _: ['sync', 'plan', action, ...shiftedArgs]
  }
}

function printReleaseHelp(): void {
  ui.log(`${c.label('Usage:')} ${c.command('vaulter release')} ${c.subcommand('<command>')} [options]`)
  ui.log('')
  ui.log(c.header('Commands:'))
  ui.log(`  ${c.subcommand('plan')} [action]      Preview release plan (default: merge)`)
  ui.log(`  ${c.subcommand('apply')} [action]     Run release plan`)
  ui.log(`  ${c.subcommand('push')}             Push local -> remote`)
  ui.log(`  ${c.subcommand('pull')}             Pull remote -> outputs/local`)
  ui.log(`  ${c.subcommand('merge')}            Full merge sync`)
  ui.log(`  ${c.subcommand('diff')}             Show local vs remote diff`)
  ui.log(`  ${c.subcommand('status')}           Run release health check`)
  ui.log('')
  ui.log(c.header('Common flow:'))
  ui.log(`  ${c.command('vaulter release plan -e dev')}          ${c.muted('# preview changes')}`)
  ui.log(`  ${c.command('vaulter release plan pull -e dev')}      ${c.muted('# writes artifacts automatically to artifacts/vaulter-plans/<project>-<env>-pull-<timestamp>.*')}`)
  ui.log(`  ${c.command('vaulter release apply -e dev --force')} ${c.muted('# apply after preview')}`)
  ui.log('')
  ui.log(c.header('Tips:'))
  ui.log(`  - action: ${c.highlight('merge')} (default), ${c.highlight('push')}, ${c.highlight('pull')}`)
  ui.log(`  - for apply, use ${c.highlight('--force')} if your environment blocks safety guards`)
  ui.log(`  - for observability: ${c.command('vaulter sync diff -e <env>')}`)
}

/**
 * Router for release subcommands
 */
export async function runReleaseGroup(context: ReleaseContext): Promise<void> {
  const { args } = context
  const subcommand = args._[1]

  if (!subcommand || subcommand.startsWith('-')) {
    print.error('Release subcommand required: plan, apply, pull, push, merge, diff, status')
    printReleaseHelp()
    process.exit(1)
  }

  switch (subcommand) {
    case 'plan': {
      const action = resolveAction(args, 'merge')
      if (!action) {
        print.error('Unknown release action. Use merge, push, or pull')
        ui.log(`Examples: ${c.command('vaulter release plan merge')} | ${c.command('vaulter release apply push')}`)
        process.exit(1)
      }
      await runSyncGroup({
        ...context,
        args: normalizeReleasePlanArgs(context, action, false)
      })
      break
    }

    case 'apply': {
      const action = resolveAction(args, 'merge')
      if (!action) {
        print.error('Unknown release action. Use merge, push, or pull')
        ui.log(`Examples: ${c.command('vaulter release apply merge')} | ${c.command('vaulter release apply push')}`)
        process.exit(1)
      }
      await runSyncGroup({
        ...context,
        args: normalizeReleasePlanArgs(context, action, true)
      })
      break
    }

    case 'push':
    case 'pull':
    case 'merge':
    case 'diff': {
      const shiftedArgs = {
        ...args,
        _: ['sync', ...args._.slice(1)]
      }
      await runSyncGroup({
        ...context,
        args: shiftedArgs
      })
      break
    }

    case 'status': {
      await runDoctor(context)
      break
    }

    default: {
      print.error(`Unknown subcommand: ${c.command('release')} ${c.subcommand(subcommand)}`)
      printReleaseHelp()
      process.exit(1)
    }
  }
}
