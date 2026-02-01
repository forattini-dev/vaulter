/**
 * Vaulter CLI - Services Command
 *
 * List and manage services in a monorepo
 */

import path from 'node:path'
import { DEFAULT_ENVIRONMENTS } from '../../types.js'
import type { CLIArgs, VaulterConfig } from '../../types.js'
import { discoverServices, findMonorepoRoot } from '../../lib/monorepo.js'
import { print } from '../lib/colors.js'
import * as ui from '../ui.js'

interface ServicesContext {
  args: CLIArgs
  config: VaulterConfig | null
  verbose: boolean
  jsonOutput: boolean
}

/**
 * Run the services command
 */
export async function runServices(context: ServicesContext): Promise<void> {
  const { args } = context

  const subcommand = args._[1]

  switch (subcommand) {
    case 'list':
    case 'ls':
    case undefined:
      await runServicesList(context)
      break

    default:
      print.error(`Unknown services subcommand: ${subcommand}`)
      ui.log('Available subcommands: list')
      ui.log('')
      ui.log('Examples:')
      ui.log('  vaulter services                  # List all services')
      ui.log('  vaulter services list             # Same as above')
      ui.log('  vaulter services list --json      # JSON output')
      process.exit(1)
  }
}

/**
 * List all services in the monorepo
 */
async function runServicesList(context: ServicesContext): Promise<void> {
  const { verbose, jsonOutput } = context

  // Find monorepo root
  const root = findMonorepoRoot()

  if (!root) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        error: 'not_in_monorepo',
        message: 'Not inside a vaulter project'
      }))
    } else {
      print.error('Not inside a vaulter project')
      ui.log('Run "vaulter init" first')
    }
    process.exit(1)
  }

  // Discover services
  const services = discoverServices(root)

  if (jsonOutput) {
    ui.output(JSON.stringify({
      root: root,
      count: services.length,
      services: services.map(s => ({
        name: s.name,
        path: path.relative(process.cwd(), s.path) || '.',
        project: s.config.project,
        environments: s.config.environments || ['dev', 'stg', 'prd', 'sbx', 'dr'],
        defaultEnvironment: s.config.default_environment || 'dev'
      }))
    }))
  } else {
    if (services.length === 0) {
      ui.log('No services found')
      ui.log('')
      ui.log('This might be a single-project setup (no nested .vaulter directories)')
    } else {
      ui.log(`Found ${services.length} service(s) in monorepo:`)
      ui.log('')

      for (const service of services) {
        const relativePath = path.relative(process.cwd(), service.path) || '.'
        ui.log(`  ${service.name}`)
        ui.log(`    Path: ${relativePath}`)
        ui.log(`    Project: ${service.config.project}`)
        if (verbose) {
          ui.log(`    Environments: ${(service.config.environments || DEFAULT_ENVIRONMENTS).join(', ')}`)
          ui.log(`    Default: ${service.config.default_environment || 'dev'}`)
          if (service.config.backend?.url) {
            ui.log(`    Backend: ${service.config.backend.url}`)
          }
        }
        ui.log('')
      }
    }
  }
}
