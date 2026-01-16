/**
 * Vaulter CLI - List Command
 *
 * List all environment variables
 */

import type { CLIArgs, VaulterConfig, Environment, EnvVar } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import * as ui from '../ui.js'

interface ListContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  jsonOutput: boolean
}

/**
 * Mask sensitive values for display
 */
function maskValue(value: string, showFull: boolean = false): string {
  if (showFull) return value
  if (value.length <= 8) return '****'
  return value.substring(0, 4) + '****' + value.substring(value.length - 4)
}

/**
 * Run the list command
 */
export async function runList(context: ListContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  if (!project) {
    ui.error('Project not specified and no config found')
    ui.log('Run "vaulter init" or specify --project')
    process.exit(1)
  }

  ui.verbose(`Listing variables for ${project}/${service || '(no service)'}/${environment}`, verbose)

  const client = await createClientFromConfig({ args, config, verbose })

  try {
    await ui.withSpinner('Connecting...', () => client.connect(), {
      successText: 'Connected'
    })

    const vars = await client.list({
      project,
      service,
      environment: args.all ? undefined : environment
    })

    if (jsonOutput) {
      // JSON output goes to stdout (for pipes)
      ui.output(JSON.stringify({
        project,
        service,
        environment: args.all ? 'all' : environment,
        count: vars.length,
        variables: vars.map(v => ({
          key: v.key,
          value: v.value,
          environment: v.environment,
          tags: v.tags,
          metadata: v.metadata,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt
        }))
      }))
    } else {
      if (vars.length === 0) {
        ui.log('No variables found')
        return
      }

      // Table format using tuiuiu.js
      const showValues = args.verbose || args.v || false
      const tableData = vars.map(v => ({
        key: v.key,
        value: maskValue(v.value, showValues),
        env: v.environment
      }))

      const table = ui.formatTable(
        [
          { key: 'key', header: 'KEY' },
          { key: 'value', header: 'VALUE' },
          { key: 'env', header: 'ENV' }
        ],
        tableData
      )

      ui.output(table)

      if (!showValues) {
        ui.log('\n(use -v to show full values)')
      }
    }
  } finally {
    await client.disconnect()
  }
}
