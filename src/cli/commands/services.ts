/**
 * Vaulter CLI - Services Command
 *
 * List and manage services in a monorepo
 */

import path from 'node:path'
import type { CLIArgs, VaulterConfig } from '../../types.js'
import { discoverServices, findMonorepoRoot } from '../../lib/monorepo.js'

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
      console.error(`Unknown services subcommand: ${subcommand}`)
      console.error('Available subcommands: list')
      console.error('')
      console.error('Examples:')
      console.error('  vaulter services                  # List all services')
      console.error('  vaulter services list             # Same as above')
      console.error('  vaulter services list --json      # JSON output')
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
      console.log(JSON.stringify({
        error: 'not_in_monorepo',
        message: 'Not inside a vaulter project'
      }))
    } else {
      console.error('Not inside a vaulter project')
      console.error('Run "vaulter init" first')
    }
    process.exit(1)
  }

  // Discover services
  const services = discoverServices(root)

  if (jsonOutput) {
    console.log(JSON.stringify({
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
      console.log('No services found')
      console.log('')
      console.log('This might be a single-project setup (no nested .vaulter directories)')
    } else {
      console.log(`Found ${services.length} service(s) in monorepo:`)
      console.log('')

      for (const service of services) {
        const relativePath = path.relative(process.cwd(), service.path) || '.'
        console.log(`  ${service.name}`)
        console.log(`    Path: ${relativePath}`)
        console.log(`    Project: ${service.config.project}`)
        if (verbose) {
          console.log(`    Environments: ${(service.config.environments || ['dev', 'stg', 'prd']).join(', ')}`)
          console.log(`    Default: ${service.config.default_environment || 'dev'}`)
          if (service.config.backend?.url) {
            console.log(`    Backend: ${service.config.backend.url}`)
          }
        }
        console.log('')
      }
    }
  }
}
