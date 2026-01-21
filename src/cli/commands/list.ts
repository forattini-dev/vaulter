/**
 * Vaulter CLI - List Command
 *
 * List all environment variables
 */

import type { CLIArgs, VaulterConfig, Environment, EnvVar } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import * as ui from '../ui.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import { SHARED_SERVICE, resolveVariables, formatSource, type ResolvedVar } from '../../lib/shared.js'
import { getSecretPatterns } from '../../lib/secret-patterns.js'
import { compileGlobPatterns } from '../../lib/pattern-matcher.js'

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
 * Environment priority for sorting (lower = first)
 */
const ENV_PRIORITY: Record<string, number> = {
  dev: 0,
  development: 0,
  stg: 1,
  staging: 1,
  prd: 2,
  prod: 2,
  production: 2
}

/**
 * Sort variables by: env > service > type (config before secret) > name
 */
function sortVars(
  vars: EnvVar[],
  isSecretFn: (key: string) => boolean
): EnvVar[] {
  return [...vars].sort((a, b) => {
    // 1. Environment priority
    const envPriorityA = ENV_PRIORITY[a.environment] ?? 99
    const envPriorityB = ENV_PRIORITY[b.environment] ?? 99
    if (envPriorityA !== envPriorityB) return envPriorityA - envPriorityB

    // 2. Service (alphabetical, shared first)
    const serviceA = a.service || ''
    const serviceB = b.service || ''
    if (serviceA !== serviceB) {
      // Shared (empty) comes first
      if (!serviceA) return -1
      if (!serviceB) return 1
      return serviceA.localeCompare(serviceB)
    }

    // 3. Type: config (not secret) before secret
    const isSecretA = isSecretFn(a.key) ? 1 : 0
    const isSecretB = isSecretFn(b.key) ? 1 : 0
    if (isSecretA !== isSecretB) return isSecretA - isSecretB

    // 4. Name (alphabetical)
    return a.key.localeCompare(b.key)
  })
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
 * Format variable type (config vs secret) with colors
 */
function colorType(isSecret: boolean): string {
  return isSecret ? c.secretType('secret') : c.configType('config')
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

  // Show environment banner (respects --quiet and --json)
  if (!jsonOutput) {
    ui.showEnvironmentBanner(environment, {
      project,
      service: isShared ? 'shared' : service,
      action: 'Listing variables'
    })
  }

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
    const rawVars = await client.list({
      project,
      service: effectiveService,
      environment: allEnvs ? undefined : environment
    })

    // Create secret detection function for sorting
    const secretPatterns = getSecretPatterns(config)
    const isSecret = compileGlobPatterns(secretPatterns)

    // Sort vars by: env > service > type (config before secret) > name
    const vars = sortVars(rawVars, isSecret)

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
      const showValues = args.verbose || false

      if (showInheritance && resolvedVars) {
        // Show with inheritance source column
        // Sort resolved vars by type then name
        const sortedResolved = Array.from(resolvedVars.values()).sort((a, b) => {
          // Type: config before secret
          const isSecretA = isSecret(a.key) ? 1 : 0
          const isSecretB = isSecret(b.key) ? 1 : 0
          if (isSecretA !== isSecretB) return isSecretA - isSecretB
          // Name
          return a.key.localeCompare(b.key)
        })

        const tableData = sortedResolved.map(v => ({
          env: colorEnv(environment),
          source: colorSource(v.source),
          type: colorType(isSecret(v.key)),
          key: c.key(v.key),
          value: maskValue(v.value, showValues)
        }))

        const table = ui.formatTable(
          [
            { key: 'env', header: 'ENV' },
            { key: 'source', header: 'SOURCE' },
            { key: 'type', header: 'TYPE' },
            { key: 'key', header: 'KEY' },
            { key: 'value', header: 'VALUE' }
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
        // Detect if we have multiple services (monorepo listing all)
        const hasMultipleServices = new Set(vars.map(v => v.service || '')).size > 1 ||
          (!effectiveService && vars.some(v => v.service))

        if (hasMultipleServices) {
          // Monorepo: show service and type columns
          const tableData = vars.map(v => ({
            env: colorEnv(v.environment),
            service: v.service ? c.service(v.service) : c.muted('shared'),
            type: colorType(isSecret(v.key)),
            key: c.key(v.key),
            value: maskValue(v.value, showValues)
          }))

          const table = ui.formatTable(
            [
              { key: 'env', header: 'ENV' },
              { key: 'service', header: 'SERVICE' },
              { key: 'type', header: 'TYPE' },
              { key: 'key', header: 'KEY' },
              { key: 'value', header: 'VALUE' }
            ],
            tableData
          )

          ui.output(table)
        } else {
          // Single service or shared vars
          const tableData = vars.map(v => ({
            env: colorEnv(v.environment),
            type: colorType(isSecret(v.key)),
            key: c.key(v.key),
            value: maskValue(v.value, showValues)
          }))

          const table = ui.formatTable(
            [
              { key: 'env', header: 'ENV' },
              { key: 'type', header: 'TYPE' },
              { key: 'key', header: 'KEY' },
              { key: 'value', header: 'VALUE' }
            ],
            tableData
          )

          ui.output(table)
        }
      }

      if (!showValues) {
        ui.log(`\n${c.muted(`(use ${c.highlight('-v')} to show full values)`)}`)
      }
    }
  } finally {
    await client.disconnect()
  }
}
