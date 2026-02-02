/**
 * Vaulter CLI - Service Command Group
 *
 * Monorepo service management commands:
 * - list: List services in monorepo
 * - scan: Scan for packages (NX, Turborepo, Lerna, pnpm)
 * - tree: Show inheritance tree with shared variables
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../../types.js'
import { c, symbols, box, colorEnv, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'

export interface ServiceContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  jsonOutput: boolean
}

/**
 * Router for service subcommands
 */
export async function runServiceGroup(context: ServiceContext): Promise<void> {
  const { args } = context
  const subcommand = args._[1]

  switch (subcommand) {
    case 'list':
    case 'ls': {
      const { runServices } = await import('../services.js')
      const shiftedArgs = {
        ...args,
        _: ['services', ...args._.slice(2)]
      }
      await runServices({ ...context, args: shiftedArgs })
      break
    }

    case 'scan': {
      const { runScan } = await import('../scan.js')
      const shiftedArgs = {
        ...args,
        _: ['scan', ...args._.slice(2)]
      }
      await runScan({ ...context, args: shiftedArgs })
      break
    }

    case 'tree': {
      await runTree(context)
      break
    }

    case 'dedupe': {
      const { runDedupe } = await import('./dedupe.js')
      await runDedupe({ ...context, dryRun: args['dry-run'] as boolean || false })
      break
    }

    default:
      // If no subcommand, default to list
      if (!subcommand || subcommand.startsWith('-')) {
        const { runServices } = await import('../services.js')
        await runServices(context)
      } else {
        print.error(`Unknown subcommand: ${c.command('service')} ${c.subcommand(subcommand)}`)
        ui.log(`Run "${c.command('vaulter service --help')}" for usage`)
        process.exit(1)
      }
  }
}

/**
 * Show inheritance tree for monorepo services
 * Visualizes shared vs service-specific variables
 */
async function runTree(context: ServiceContext): Promise<void> {
  const { args, config, project, environment, verbose, jsonOutput } = context

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  const { createClientFromConfig } = await import('../../lib/create-client.js')
  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()

    // Get all services from config outputs
    let services: string[] = []
    if (config?.outputs) {
      services = Object.values(config.outputs)
        .map(o => typeof o === 'object' ? o.service : undefined)
        .filter((s): s is string => !!s && s !== '__shared__')
      services = [...new Set(services)]  // dedupe
    }

    // Get shared variables (if supported by backend)
    let sharedVars: Record<string, string> = {}
    try {
      sharedVars = await client.export(project, environment, '__shared__')
    } catch {
      // Backend may not support shared vars yet
    }

    // Get service-specific variables
    const serviceVars: Record<string, { total: number; overrides: number }> = {}

    for (const svcName of services) {
      try {
        const vars = await client.export(project, environment, svcName)
        const overrideCount = Object.keys(vars).filter(k => sharedVars[k] !== undefined).length
        serviceVars[svcName] = {
          total: Object.keys(vars).length,
          overrides: overrideCount
        }
      } catch {
        serviceVars[svcName] = { total: 0, overrides: 0 }
      }
    }

    if (jsonOutput) {
      ui.output(JSON.stringify({
        project,
        environment,
        shared: {
          count: Object.keys(sharedVars).length,
          keys: Object.keys(sharedVars)
        },
        services: Object.entries(serviceVars).map(([name, stats]) => ({
          name,
          ...stats,
          inherited: Object.keys(sharedVars).length - stats.overrides
        }))
      }, null, 2))
    } else {
      // Visual tree output with colors
      ui.log('')
      ui.log(`${symbols.package} ${c.project(project)} (${colorEnv(environment)})`)
      ui.log(c.muted(box.vertical))
      ui.log(`${c.muted(box.teeRight + box.horizontal + box.horizontal)} ${symbols.globe} ${c.env('shared/')}`)
      ui.log(`${c.muted(box.vertical)}   ${c.muted(box.bottomLeft + box.horizontal + box.horizontal)} ${c.value(String(Object.keys(sharedVars).length))} ${c.muted('variables')}`)

      if (Object.keys(sharedVars).length > 0 && verbose) {
        for (const key of Object.keys(sharedVars).slice(0, 5)) {
          ui.log(`${c.muted(box.vertical)}       ${symbols.bullet} ${c.key(key)}`)
        }
        if (Object.keys(sharedVars).length > 5) {
          ui.log(`${c.muted(box.vertical)}       ${c.muted(`... and ${Object.keys(sharedVars).length - 5} more`)}`)
        }
      }

      ui.log(c.muted(box.vertical))

      const serviceNames = Object.keys(serviceVars)
      for (let i = 0; i < serviceNames.length; i++) {
        const svcName = serviceNames[i]
        const stats = serviceVars[svcName]
        const isLast = i === serviceNames.length - 1
        const prefix = isLast ? box.bottomLeft : box.teeRight
        const subPrefix = isLast ? '    ' : c.muted(box.vertical) + '   '

        ui.log(`${c.muted(prefix + box.horizontal + box.horizontal)} ${symbols.folder} ${c.service(svcName)}/`)
        ui.log(`${subPrefix}${c.muted(box.teeRight + box.horizontal + box.horizontal)} ${c.value(String(stats.total))} ${c.muted('service vars')}`)
        ui.log(`${subPrefix}${c.muted(box.teeRight + box.horizontal + box.horizontal)} ${c.added(String(Object.keys(sharedVars).length - stats.overrides))} ${c.muted('inherited from shared')}`)
        if (stats.overrides > 0) {
          ui.log(`${subPrefix}${c.muted(box.bottomLeft + box.horizontal + box.horizontal)} ${c.modified(String(stats.overrides))} ${c.warning('overrides')}`)
        } else {
          ui.log(`${subPrefix}${c.muted(box.bottomLeft + box.horizontal + box.horizontal)} ${c.unchanged('0')} ${c.muted('overrides')}`)
        }
      }

      ui.log('')
      ui.log(c.header('Legend:'))
      ui.log(`  ${c.added('inherited')} ${c.muted('= shared vars that apply to service')}`)
      ui.log(`  ${c.warning('overrides')} ${c.muted('= service vars that override shared')}`)
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Print help for service command group
 */
export function printServiceHelp(): void {
  ui.log(`${c.label('Usage:')} ${c.command('vaulter service')} ${c.subcommand('<command>')} [options]`)
  ui.log('')
  ui.log(c.header('Commands:'))
  ui.log(`  ${c.subcommand('list')}             List services in monorepo`)
  ui.log(`  ${c.subcommand('scan')} [path]      Scan for packages (auto-detect NX, Turborepo, Lerna)`)
  ui.log(`  ${c.subcommand('tree')}             Show variable inheritance tree`)
  ui.log(`  ${c.subcommand('dedupe')}           Find and clean duplicate vars between services and __shared__`)
  ui.log('')
  ui.log(c.header('Options:'))
  ui.log(`  ${c.highlight('-e')}, ${c.highlight('--env')}        Environment (${colorEnv('dev')}, ${colorEnv('stg')}, ${colorEnv('prd')})`)
  ui.log(`  ${c.highlight('--json')}           Output in JSON format`)
  ui.log('')
  ui.log(c.header('Examples:'))
  ui.log(`  ${c.command('vaulter service list')}`)
  ui.log(`  ${c.command('vaulter service scan')} ${c.muted('./packages')}`)
  ui.log(`  ${c.command('vaulter service tree')} ${c.highlight('-e')} ${colorEnv('prd')}`)
  ui.log(`  ${c.command('vaulter service dedupe preview -e dev')}  ${c.muted('# Find duplicates')}`)
  ui.log(`  ${c.command('vaulter service dedupe clean -e dev')}    ${c.muted('# Delete from services')}`)
}
