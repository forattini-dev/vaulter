/**
 * Vaulter CLI - Sync Command Group
 *
 * Synchronization commands with clear semantics:
 * - merge: Two-way merge (default, current 'sync' behavior)
 * - push: Local → Remote (with optional --prune)
 * - pull: Remote → Local (with optional --prune)
 * - diff: Show differences without making changes
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../../types.js'
import { c, symbols, box, colorEnv, print } from '../../lib/colors.js'
import { maskValue } from '../../../lib/masking.js'
import * as ui from '../../ui.js'

export interface SyncContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
  apply?: boolean
  // New: prune and shared support
  prune?: boolean
  shared?: boolean
  // Strategy for merge conflicts
  strategy?: 'local' | 'remote' | 'error'
  // Show values in diff
  showValues?: boolean
  // Optional sync plan artifact path
  planOutput?: string
}

/**
 * Router for sync subcommands
 */
export async function runSyncGroup(context: SyncContext): Promise<void> {
  const { args } = context
  const subcommand = args._[1]
  const apply = args.apply === true
  const planOutput = typeof args['plan-output'] === 'string' && args['plan-output'].trim().length > 0
    ? args['plan-output'].trim()
    : undefined

  // Extract common flags
  const strategy = args.strategy as 'local' | 'remote' | 'error' | undefined
  const showValues = args.values as boolean | undefined

  switch (subcommand) {
    case 'merge': {
      // merge = current sync behavior (two-way)
      const { runSync } = await import('../sync.js')
      const shiftedArgs = {
        ...args,
        _: ['sync', ...args._.slice(2)]
      }
      // Pass strategy to override config
      await runSync({ ...context, args: shiftedArgs, strategy, planOutput })
      break
    }

    case 'push': {
      const { runPush } = await import('../push.js')
      const shiftedArgs = {
        ...args,
        _: ['push', ...args._.slice(2)]
      }
      // Pass prune and dir flags from args
      const prune = args.prune as boolean | undefined
      const dir = args.dir as boolean | undefined
      await runPush({ ...context, args: shiftedArgs, prune, dir, planOutput })
      break
    }

    case 'pull': {
      const { runPull } = await import('../pull.js')
      const shiftedArgs = {
        ...args,
        _: ['pull', ...args._.slice(2)]
      }
      // Pass outputs and dir flags from args
      const all = args.all as boolean | undefined
      const target = args.output as string | undefined
      const dir = args.dir as boolean | undefined
      await runPull({ ...context, args: shiftedArgs, all, target, dir, planOutput })
      break
    }

    case 'diff': {
      await runDiff({ ...context, showValues })
      break
    }

    case 'plan': {
      const action = resolveSyncPlanAction(args)
      if (!action) {
        print.error('Plan requires action: vaulter sync plan <merge|push|pull> [options]')
        ui.log('You can also use --action to pass it explicitly.')
        process.exit(1)
      }

      const shouldDryRun = !apply
      const planContext: SyncContext = {
        ...context,
        dryRun: shouldDryRun
      }

      if (action === 'merge') {
        const { runSync } = await import('../sync.js')
        const shiftedArgs = {
          ...args,
          _: ['merge', ...args._.slice(3)]
        }
        await runSync({ ...planContext, args: shiftedArgs, strategy, planOutput })
      } else if (action === 'push') {
        const { runPush } = await import('../push.js')
        const shiftedArgs = {
          ...args,
          _: ['push', ...args._.slice(3)]
        }
        const prune = args.prune as boolean | undefined
        const dir = args.dir as boolean | undefined
        const shared = args.shared as boolean | undefined
        await runPush({ ...planContext, args: shiftedArgs, prune, dir, shared, planOutput })
      } else if (action === 'pull') {
        const { runPull } = await import('../pull.js')
        const shiftedArgs = {
          ...args,
          _: ['pull', ...args._.slice(3)]
        }
        const all = args.all as boolean | undefined
        const target = args.output as string | undefined
        const dir = args.dir as boolean | undefined
        await runPull({ ...planContext, args: shiftedArgs, all, target, dir, planOutput })
      } else {
        print.error(`Unknown plan action: ${action}`)
        process.exit(1)
      }
      break
    }

    default:
      if (!subcommand || subcommand.startsWith('-')) {
        print.error('Sync subcommand required: merge, push, pull, diff, plan')
        ui.log(`Run "${c.command('vaulter sync --help')}" for usage`)
        process.exit(1)
      }

      print.error(`Unknown subcommand: ${c.command('sync')} ${c.subcommand(subcommand)}`)
      ui.log(`Run "${c.command('vaulter sync --help')}" for usage`)
      process.exit(1)
  }
}

function resolveSyncPlanAction(args: CLIArgs): 'merge' | 'push' | 'pull' | undefined {
  const positional = (args._[2] || '').toString().trim().toLowerCase()
  const explicit = (typeof args.action === 'string' ? args.action : '').trim().toLowerCase()
  const action = explicit || positional

  if (action === 'merge' || action === 'push' || action === 'pull') {
    return action
  }

  return undefined
}

/**
 * Show diff between local and remote
 * New command for visualizing differences before sync
 */
async function runDiff(context: SyncContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput, showValues } = context

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  // Import dependencies
  const { createClientFromConfig } = await import('../../lib/create-client.js')
  const { findConfigDir, getEnvFilePathForConfig } = await import('../../../lib/config-loader.js')
  const { parseEnvFile } = await import('../../../lib/env-parser.js')
  const fs = await import('node:fs')
  const path = await import('node:path')

  // Find local file
  const filePath = args.file
  let resolvedPath: string

  if (filePath) {
    resolvedPath = path.resolve(filePath as string)
  } else {
    const configDir = findConfigDir()
    if (!configDir || !config) {
      print.error('No config directory found and no file specified')
      process.exit(1)
    }
    resolvedPath = getEnvFilePathForConfig(config, configDir, environment)
  }

  // Parse local vars
  let localVars: Record<string, string> = {}
  if (fs.existsSync(resolvedPath)) {
    localVars = parseEnvFile(resolvedPath)
  }

  ui.verbose(`${symbols.info} Comparing: ${c.muted(resolvedPath)} ${symbols.arrowBoth} remote (${colorEnv(environment)})`, verbose)

  // Show environment banner (respects --quiet and --json)
  if (!jsonOutput) {
    ui.showEnvironmentBanner(environment, {
      project,
      service,
      action: 'Comparing'
    })
  }

  // Get remote vars
  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()
    const remoteVars = await client.export(project, environment, service)

    // Calculate diff
    const allKeys = new Set([...Object.keys(localVars), ...Object.keys(remoteVars)])
    const localOnly: string[] = []
    const remoteOnly: string[] = []
    const different: string[] = []
    const identical: string[] = []

    for (const key of allKeys) {
      const local = localVars[key]
      const remote = remoteVars[key]

      if (local !== undefined && remote === undefined) {
        localOnly.push(key)
      } else if (local === undefined && remote !== undefined) {
        remoteOnly.push(key)
      } else if (local !== remote) {
        different.push(key)
      } else {
        identical.push(key)
      }
    }

    // Build diff details for values display
    const diffDetails: Record<string, { local?: string; remote?: string }> = {}
    for (const key of different) {
      diffDetails[key] = {
        local: localVars[key],
        remote: remoteVars[key]
      }
    }

    // Output
    if (jsonOutput) {
      ui.output(JSON.stringify({
        project,
        service,
        environment,
        localFile: resolvedPath,
        summary: {
          localOnly: localOnly.length,
          remoteOnly: remoteOnly.length,
          different: different.length,
          identical: identical.length,
          total: allKeys.size
        },
        localOnly: showValues ? localOnly.map(k => ({ key: k, value: maskValue(localVars[k]) })) : localOnly,
        remoteOnly: showValues ? remoteOnly.map(k => ({ key: k, value: maskValue(remoteVars[k]) })) : remoteOnly,
        different: showValues ? different.map(k => ({
          key: k,
          local: maskValue(localVars[k]),
          remote: maskValue(remoteVars[k])
        })) : different,
        identical
      }, null, 2))
    } else {
      // Visual output with colors
      const width = showValues ? 70 : 47
      const line = box.horizontal.repeat(width)

      ui.log('')
      ui.log(c.muted(`${box.topLeft}${line}${box.topRight}`))
      ui.log(c.muted(box.vertical) + '  ' + c.header(`Comparing:`) + ' local ' + symbols.arrowBoth + ' remote (' + colorEnv(environment) + ')'.padEnd(showValues ? 38 : 15) + c.muted(box.vertical))
      ui.log(c.muted(`${box.teeRight}${line}${box.teeLeft}`))

      if (localOnly.length === 0 && remoteOnly.length === 0 && different.length === 0) {
        ui.log(c.muted(box.vertical) + '  ' + symbols.success + ' ' + c.success('All variables are in sync') + ' '.repeat(showValues ? 39 : 16) + c.muted(box.vertical))
      } else {
        for (const key of localOnly) {
          let content = `  ${symbols.plus} ${c.key(key)}`
          if (showValues) {
            content += c.muted(` = ${maskValue(localVars[key])}`)
          }
          const label = c.added('(local only)')
          ui.log(c.muted(box.vertical) + content.padEnd(showValues ? 68 : 45) + label + c.muted(box.vertical))
        }
        for (const key of remoteOnly) {
          let content = `  ${symbols.minus} ${c.key(key)}`
          if (showValues) {
            content += c.muted(` = ${maskValue(remoteVars[key])}`)
          }
          const label = c.removed('(remote only)')
          ui.log(c.muted(box.vertical) + content.padEnd(showValues ? 68 : 45) + label + c.muted(box.vertical))
        }
        for (const key of different) {
          let content = `  ${symbols.tilde} ${c.key(key)}`
          const label = c.modified('(different)')
          ui.log(c.muted(box.vertical) + content.padEnd(showValues ? 68 : 45) + label + c.muted(box.vertical))
          if (showValues) {
            const localVal = maskValue(localVars[key])
            const remoteVal = maskValue(remoteVars[key])
            ui.log(c.muted(box.vertical) + `      ${c.removed('- ' + remoteVal)}`.padEnd(showValues ? 75 : 52) + c.muted(box.vertical))
            ui.log(c.muted(box.vertical) + `      ${c.added('+ ' + localVal)}`.padEnd(showValues ? 75 : 52) + c.muted(box.vertical))
          }
        }
      }

      if (identical.length > 0) {
        ui.log(c.muted(box.vertical) + `  ${symbols.equal} ${c.unchanged(`${identical.length} variables identical`)}`.padEnd(showValues ? 75 : 52) + c.muted(box.vertical))
      }

      ui.log(c.muted(`${box.bottomLeft}${line}${box.bottomRight}`))
      ui.log('')

      // Summary with colors
      ui.log(c.label('Summary:') + ` ${c.added(String(localOnly.length))} to push, ${c.removed(String(remoteOnly.length))} remote-only, ${c.modified(String(different.length))} conflicts`)
      ui.log('')

      // Suggested actions
      if (localOnly.length > 0 || different.length > 0 || remoteOnly.length > 0) {
        ui.log(c.header('Actions:'))
      }
      if (localOnly.length > 0 || different.length > 0) {
        ui.log(`  ${c.command('vaulter sync push')}              ${c.muted('# Push local, keep remote-only')}`)
        ui.log(`  ${c.command('vaulter sync push')} ${c.highlight('--prune')}      ${c.muted('# Push local, DELETE remote-only')}`)
      }
      if (remoteOnly.length > 0 || different.length > 0) {
        ui.log(`  ${c.command('vaulter sync pull')}              ${c.muted('# Pull remote to outputs')}`)
      }
      if (localOnly.length > 0 || remoteOnly.length > 0) {
        ui.log(`  ${c.command('vaulter sync merge')}             ${c.muted('# Two-way merge (--strategy local|remote)')}`)
      }
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Print help for sync command group
 */
export function printSyncHelp(): void {
  ui.log(`${c.label('Usage:')} ${c.command('vaulter sync')} ${c.subcommand('<command>')} [options]`)
  ui.log('')
  ui.log(c.header('Commands:'))
  ui.log(`  ${c.subcommand('diff')}             Show differences (add ${c.highlight('--values')} to see masked values)`)
  ui.log(`  ${c.subcommand('push')} [${c.highlight('--prune')}]   Push local to remote`)
  ui.log(`  ${c.subcommand('pull')}             Pull remote to outputs`)
  ui.log(`  ${c.subcommand('merge')}            Two-way merge (local ${symbols.arrowBoth} remote)`)
  ui.log(`  ${c.subcommand('plan')} <action>      Plan/apply sync operation`)
  ui.log('')
  ui.log(c.header('Options:'))
  ui.log(`  ${c.highlight('-e')}, ${c.highlight('--env')}        Environment (${colorEnv('dev')}, ${colorEnv('stg')}, ${colorEnv('prd')})`)
  ui.log(`  ${c.highlight('-s')}, ${c.highlight('--service')}    Service name (for monorepos)`)
  ui.log(`  ${c.highlight('--strategy')}       Conflict strategy: ${c.highlight('local')} (default), ${c.highlight('remote')}, ${c.highlight('error')}`)
  ui.log(`  ${c.highlight('--values')}         Show masked values in diff output`)
  ui.log(`  ${c.highlight('--prune')}          Delete variables not in source (push/pull)`)
  ui.log(`  ${c.highlight('--shared')}         Target shared variables (monorepo)`)
  ui.log(`  ${c.highlight('--dry-run')}        Preview without making changes`)
  ui.log(`  ${c.highlight('--apply')}          Apply changes after plan`)
  ui.log(`  ${c.highlight('--json')}           Output in JSON format`)
  ui.log('')
  ui.log(c.header('Examples:'))
  ui.log(`  ${c.command('vaulter sync diff -e prd')}                 ${c.muted('# See what\'s different')}`)
  ui.log(`  ${c.command('vaulter sync diff -e prd --values')}        ${c.muted('# See values (masked)')}`)
  ui.log(`  ${c.command('vaulter sync push -e prd')}                 ${c.muted('# Push local, keep remote-only')}`)
  ui.log(`  ${c.command('vaulter sync push -e prd --prune')}         ${c.muted('# Push local, DELETE remote-only')}`)
  ui.log(`  ${c.command('vaulter sync merge -e dev --strategy remote')} ${c.muted('# Remote wins on conflict')}`)
  ui.log(`  ${c.command('vaulter sync plan push -e dev')}               ${c.muted('# Plan push without applying')}`)
  ui.log(`  ${c.command('vaulter sync plan push -e dev --apply')}        ${c.muted('# Apply push')}`)
  ui.log(`  ${c.command('vaulter sync plan merge -e dev --apply')}       ${c.muted('# Apply merge')}`)
}
