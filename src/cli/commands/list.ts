/**
 * Vaulter CLI - List Command
 *
 * List all environment variables
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import * as ui from '../ui.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import { SHARED_SERVICE, resolveVariables, formatSource, type ResolvedVar } from '../../lib/shared.js'

interface ListContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  jsonOutput: boolean
  /** Target shared variables scope */
  shared?: boolean
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
 * Format source with colors
 */
function colorSource(source: 'shared' | 'service' | 'override'): string {
  switch (source) {
    case 'shared':
      return c.env('inherited')  // shared vars show as "inherited"
    case 'override':
      return c.warning('override')  // service overriding shared
    case 'service':
      return c.muted('local')  // service-only var
  }
}

/**
 * Run the list command
 */
export async function runList(context: ListContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  // Check for --shared flag
  const isShared = args.shared || context.shared

  // Determine effective service
  const effectiveService = isShared ? SHARED_SERVICE : service

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  const scope = isShared ? c.env('shared') : c.service(service || '(no service)')
  ui.verbose(`Listing variables for ${c.project(project)}/${scope}/${colorEnv(environment)}`, verbose)

  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await ui.withSpinner('Connecting...', () => client.connect(), {
      successText: 'Connected'
    })

    // --all-envs lists across all environments (different from --all which is for monorepo services)
    const allEnvs = args['all-envs']

    // If we have a service (not --shared), show inheritance info
    const showInheritance = service && !isShared

    let resolvedVars: Map<string, ResolvedVar> | null = null

    if (showInheritance) {
      // Fetch both shared and service vars for inheritance display
      const [sharedVars, serviceVars] = await Promise.all([
        client.list({ project, service: SHARED_SERVICE, environment: allEnvs ? undefined : environment }),
        client.list({ project, service, environment: allEnvs ? undefined : environment })
      ])

      // Convert to Records for resolveVariables
      const sharedRecord: Record<string, string> = {}
      const serviceRecord: Record<string, string> = {}

      for (const v of sharedVars) sharedRecord[v.key] = v.value
      for (const v of serviceVars) serviceRecord[v.key] = v.value

      resolvedVars = resolveVariables(sharedRecord, serviceRecord)
    }

    // Fetch vars (just service/shared scope if not showing inheritance)
    const vars = await client.list({
      project,
      service: effectiveService,
      environment: allEnvs ? undefined : environment
    })

    if (jsonOutput) {
      // JSON output goes to stdout (for pipes)
      if (showInheritance && resolvedVars) {
        // Include inheritance info in JSON
        const resolvedArray = Array.from(resolvedVars.values())
        ui.output(JSON.stringify({
          project,
          service,
          environment: allEnvs ? 'all' : environment,
          shared: isShared,
          count: resolvedArray.length,
          variables: resolvedArray.map(v => ({
            key: v.key,
            value: v.value,
            source: formatSource(v.source)
          }))
        }))
      } else {
        ui.output(JSON.stringify({
          project,
          service: effectiveService,
          environment: allEnvs ? 'all' : environment,
          shared: isShared,
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
      }
    } else {
      // Check if we have any vars to display
      const displayVars = showInheritance && resolvedVars ? resolvedVars : null
      const varCount = displayVars ? displayVars.size : vars.length

      if (varCount === 0) {
        ui.log(`${symbols.info} ${c.muted('No variables found')}`)
        return
      }

      // Table format using tuiuiu.js
      const showValues = args.verbose || args.v || false

      if (showInheritance && resolvedVars) {
        // Show with inheritance source column
        const tableData = Array.from(resolvedVars.values()).map(v => ({
          key: c.key(v.key),
          value: maskValue(v.value, showValues),
          source: colorSource(v.source),
          env: colorEnv(environment)
        }))

        const table = ui.formatTable(
          [
            { key: 'key', header: 'KEY' },
            { key: 'value', header: 'VALUE' },
            { key: 'source', header: 'SOURCE' },
            { key: 'env', header: 'ENV' }
          ],
          tableData
        )

        ui.output(table)

        // Show inheritance legend
        const inherited = Array.from(resolvedVars.values()).filter(v => v.source === 'shared').length
        const overrides = Array.from(resolvedVars.values()).filter(v => v.source === 'override').length
        const local = Array.from(resolvedVars.values()).filter(v => v.source === 'service').length

        ui.log(`\n${c.muted('Source:')} ${c.env('inherited')}=${inherited} ${c.warning('override')}=${overrides} ${c.muted('local')}=${local}`)
      } else {
        // Simple listing (shared vars or no service)
        const tableData = vars.map(v => ({
          key: c.key(v.key),
          value: maskValue(v.value, showValues),
          env: colorEnv(v.environment)
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
      }

      if (!showValues) {
        ui.log(`\n${c.muted(`(use ${c.highlight('-v')} to show full values)`)}`)
      }
    }
  } finally {
    await client.disconnect()
  }
}
