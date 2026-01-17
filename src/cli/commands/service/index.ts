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

    default:
      // If no subcommand, default to list
      if (!subcommand || subcommand.startsWith('-')) {
        const { runServices } = await import('../services.js')
        await runServices(context)
      } else {
        print.error(`Unknown subcommand: ${c.command('service')} ${c.subcommand(subcommand)}`)
        console.error(`Run "${c.command('vaulter service --help')}" for usage`)
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
    console.error(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  const { createClientFromConfig } = await import('../../lib/create-client.js')
  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()

    // Get all services from config
    const services = config?.services || []

    // Get shared variables (if supported by backend)
    let sharedVars: Record<string, string> = {}
    try {
      sharedVars = await client.export(project, environment, '__shared__')
    } catch {
      // Backend may not support shared vars yet
    }

    // Get service-specific variables
    const serviceVars: Record<string, { total: number; overrides: number }> = {}

    for (const svc of services) {
      const svcName = typeof svc === 'string' ? svc : svc.name
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
      console.log(JSON.stringify({
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
      console.log('')
      console.log(`${symbols.package} ${c.project(project)} (${colorEnv(environment)})`)
      console.log(c.muted(box.vertical))
      console.log(`${c.muted(box.teeRight + box.horizontal + box.horizontal)} ${symbols.globe} ${c.env('shared/')}`)
      console.log(`${c.muted(box.vertical)}   ${c.muted(box.bottomLeft + box.horizontal + box.horizontal)} ${c.value(String(Object.keys(sharedVars).length))} ${c.muted('variables')}`)

      if (Object.keys(sharedVars).length > 0 && verbose) {
        for (const key of Object.keys(sharedVars).slice(0, 5)) {
          console.log(`${c.muted(box.vertical)}       ${symbols.bullet} ${c.key(key)}`)
        }
        if (Object.keys(sharedVars).length > 5) {
          console.log(`${c.muted(box.vertical)}       ${c.muted(`... and ${Object.keys(sharedVars).length - 5} more`)}`)
        }
      }

      console.log(c.muted(box.vertical))

      const serviceNames = Object.keys(serviceVars)
      for (let i = 0; i < serviceNames.length; i++) {
        const svcName = serviceNames[i]
        const stats = serviceVars[svcName]
        const isLast = i === serviceNames.length - 1
        const prefix = isLast ? box.bottomLeft : box.teeRight
        const subPrefix = isLast ? '    ' : c.muted(box.vertical) + '   '

        console.log(`${c.muted(prefix + box.horizontal + box.horizontal)} ${symbols.folder} ${c.service(svcName)}/`)
        console.log(`${subPrefix}${c.muted(box.teeRight + box.horizontal + box.horizontal)} ${c.value(String(stats.total))} ${c.muted('service vars')}`)
        console.log(`${subPrefix}${c.muted(box.teeRight + box.horizontal + box.horizontal)} ${c.added(String(Object.keys(sharedVars).length - stats.overrides))} ${c.muted('inherited from shared')}`)
        if (stats.overrides > 0) {
          console.log(`${subPrefix}${c.muted(box.bottomLeft + box.horizontal + box.horizontal)} ${c.modified(String(stats.overrides))} ${c.warning('overrides')}`)
        } else {
          console.log(`${subPrefix}${c.muted(box.bottomLeft + box.horizontal + box.horizontal)} ${c.unchanged('0')} ${c.muted('overrides')}`)
        }
      }

      console.log('')
      console.log(c.header('Legend:'))
      console.log(`  ${c.added('inherited')} ${c.muted('= shared vars that apply to service')}`)
      console.log(`  ${c.warning('overrides')} ${c.muted('= service vars that override shared')}`)
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Print help for service command group
 */
export function printServiceHelp(): void {
  console.log(`${c.label('Usage:')} ${c.command('vaulter service')} ${c.subcommand('<command>')} [options]`)
  console.log('')
  console.log(c.header('Commands:'))
  console.log(`  ${c.subcommand('list')}             List services in monorepo`)
  console.log(`  ${c.subcommand('scan')} [path]      Scan for packages (auto-detect NX, Turborepo, Lerna)`)
  console.log(`  ${c.subcommand('tree')}             Show variable inheritance tree`)
  console.log('')
  console.log(c.header('Options:'))
  console.log(`  ${c.highlight('-e')}, ${c.highlight('--env')}        Environment (${colorEnv('dev')}, ${colorEnv('stg')}, ${colorEnv('prd')})`)
  console.log(`  ${c.highlight('--json')}           Output in JSON format`)
  console.log('')
  console.log(c.header('Examples:'))
  console.log(`  ${c.command('vaulter service list')}`)
  console.log(`  ${c.command('vaulter service scan')} ${c.muted('./packages')}`)
  console.log(`  ${c.command('vaulter service tree')} ${c.highlight('-e')} ${colorEnv('prd')}`)
}
