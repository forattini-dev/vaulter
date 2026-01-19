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
  // New: prune and shared support
  prune?: boolean
  shared?: boolean
}

/**
 * Router for sync subcommands
 */
export async function runSyncGroup(context: SyncContext): Promise<void> {
  const { args } = context
  const subcommand = args._[1]

  switch (subcommand) {
    case 'merge': {
      // merge = current sync behavior (two-way)
      const { runSync } = await import('../sync.js')
      const shiftedArgs = {
        ...args,
        _: ['sync', ...args._.slice(2)]
      }
      await runSync({ ...context, args: shiftedArgs })
      break
    }

    case 'push': {
      const { runPush } = await import('../push.js')
      const shiftedArgs = {
        ...args,
        _: ['push', ...args._.slice(2)]
      }
      // Pass prune flag from args
      const prune = args.prune as boolean | undefined
      await runPush({ ...context, args: shiftedArgs, prune })
      break
    }

    case 'pull': {
      const { runPull } = await import('../pull.js')
      const shiftedArgs = {
        ...args,
        _: ['pull', ...args._.slice(2)]
      }
      // Pass prune flag from args
      const prune = args.prune as boolean | undefined
      await runPull({ ...context, args: shiftedArgs, prune })
      break
    }

    case 'diff': {
      await runDiff(context)
      break
    }

    default:
      // If no subcommand, default to 'merge' for backward compatibility
      if (!subcommand || subcommand.startsWith('-')) {
        const { runSync } = await import('../sync.js')
        await runSync(context)
      } else {
        print.error(`Unknown subcommand: ${c.command('sync')} ${c.subcommand(subcommand)}`)
        ui.log(`Run "${c.command('vaulter sync --help')}" for usage`)
        process.exit(1)
      }
  }
}

/**
 * Show diff between local and remote
 * New command for visualizing differences before sync
 */
async function runDiff(context: SyncContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

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
  const filePath = args.file || args.f
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
        localOnly,
        remoteOnly,
        different,
        identical
      }, null, 2))
    } else {
      // Visual output with colors
      const width = 47
      const line = box.horizontal.repeat(width)

      ui.log('')
      ui.log(c.muted(`${box.topLeft}${line}${box.topRight}`))
      ui.log(c.muted(box.vertical) + '  ' + c.header(`Comparing:`) + ' local ' + symbols.arrowBoth + ' remote (' + colorEnv(environment) + ')'.padEnd(15) + c.muted(box.vertical))
      ui.log(c.muted(`${box.teeRight}${line}${box.teeLeft}`))

      if (localOnly.length === 0 && remoteOnly.length === 0 && different.length === 0) {
        ui.log(c.muted(box.vertical) + '  ' + symbols.success + ' ' + c.success('All variables are in sync') + ' '.repeat(16) + c.muted(box.vertical))
      } else {
        for (const key of localOnly) {
          const content = `  ${symbols.plus} ${c.key(key)}`
          const label = c.added('(local only)')
          ui.log(c.muted(box.vertical) + content.padEnd(45) + label + c.muted(box.vertical))
        }
        for (const key of remoteOnly) {
          const content = `  ${symbols.minus} ${c.key(key)}`
          const label = c.removed('(remote only)')
          ui.log(c.muted(box.vertical) + content.padEnd(45) + label + c.muted(box.vertical))
        }
        for (const key of different) {
          const content = `  ${symbols.tilde} ${c.key(key)}`
          const label = c.modified('(different)')
          ui.log(c.muted(box.vertical) + content.padEnd(45) + label + c.muted(box.vertical))
        }
      }

      if (identical.length > 0) {
        ui.log(c.muted(box.vertical) + `  ${symbols.equal} ${c.unchanged(`${identical.length} variables identical`)}`.padEnd(52) + c.muted(box.vertical))
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
        ui.log(`  ${c.command('vaulter sync pull')}              ${c.muted('# Pull remote, keep local-only')}`)
        ui.log(`  ${c.command('vaulter sync pull')} ${c.highlight('--prune')}      ${c.muted('# Pull remote, DELETE local-only')}`)
      }
      if (localOnly.length > 0 || remoteOnly.length > 0) {
        ui.log(`  ${c.command('vaulter sync merge')}             ${c.muted('# Two-way merge')}`)
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
  ui.log(`  ${c.subcommand('merge')}            Two-way merge (local ${symbols.arrowBoth} remote)`)
  ui.log(`  ${c.subcommand('push')} [${c.highlight('--prune')}]   Push local to remote`)
  ui.log(`  ${c.subcommand('pull')} [${c.highlight('--prune')}]   Pull remote to local`)
  ui.log(`  ${c.subcommand('diff')}             Show differences without changes`)
  ui.log('')
  ui.log(c.header('Options:'))
  ui.log(`  ${c.highlight('-e')}, ${c.highlight('--env')}        Environment (${colorEnv('dev')}, ${colorEnv('stg')}, ${colorEnv('prd')})`)
  ui.log(`  ${c.highlight('-s')}, ${c.highlight('--service')}    Service name (for monorepos)`)
  ui.log(`  ${c.highlight('--prune')}          Delete variables that don't exist in source`)
  ui.log(`  ${c.highlight('--shared')}         Target shared variables (monorepo)`)
  ui.log(`  ${c.highlight('--dry-run')}        Preview without making changes`)
  ui.log(`  ${c.highlight('--json')}           Output in JSON format`)
  ui.log('')
  ui.log(c.header('Behavior:'))
  ui.log(`  ${c.subcommand('push')}             Uploads local vars, ${c.muted('keeps remote-only vars')}`)
  ui.log(`  ${c.subcommand('push')} ${c.highlight('--prune')}     Uploads local vars, ${c.removed('DELETES remote-only vars')}`)
  ui.log(`  ${c.subcommand('pull')}             Downloads remote vars, ${c.muted('keeps local-only vars')}`)
  ui.log(`  ${c.subcommand('pull')} ${c.highlight('--prune')}     Downloads remote vars, ${c.removed('DELETES local-only vars')}`)
  ui.log(`  ${c.subcommand('merge')}            Syncs both directions, ${c.muted('local wins by default')}`)
}
