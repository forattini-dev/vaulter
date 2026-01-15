/**
 * MiniEnv CLI - List Command
 *
 * List all environment variables
 */

import type { CLIArgs, MiniEnvConfig, Environment, EnvVar } from '../../types.js'
import { MiniEnvClient } from '../../client.js'
import { loadEncryptionKey } from '../../lib/config-loader.js'

interface ListContext {
  args: CLIArgs
  config: MiniEnvConfig | null
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
 * Format table output
 */
function formatTable(vars: EnvVar[], showValues: boolean): string {
  if (vars.length === 0) {
    return 'No variables found'
  }

  // Calculate column widths
  const keyWidth = Math.max(4, ...vars.map(v => v.key.length))
  const valueWidth = showValues ? Math.max(5, ...vars.map(v => maskValue(v.value, showValues).length)) : 12
  const envWidth = 3

  // Header
  const lines: string[] = []
  lines.push(
    'KEY'.padEnd(keyWidth) + '  ' +
    'VALUE'.padEnd(valueWidth) + '  ' +
    'ENV'
  )
  lines.push('-'.repeat(keyWidth + valueWidth + envWidth + 4))

  // Rows
  for (const v of vars) {
    lines.push(
      v.key.padEnd(keyWidth) + '  ' +
      maskValue(v.value, showValues).padEnd(valueWidth) + '  ' +
      v.environment
    )
  }

  return lines.join('\n')
}

/**
 * Run the list command
 */
export async function runList(context: ListContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  if (!project) {
    console.error('Error: Project not specified and no config found')
    console.error('Run "minienv init" or specify --project')
    process.exit(1)
  }

  if (verbose) {
    console.error(`Listing variables for ${project}/${service || '(no service)'}/${environment}`)
  }

  // Build connection string
  const connectionString = args.backend || args.b || config?.backend?.url
  const passphrase = config ? await loadEncryptionKey(config) : undefined

  const client = new MiniEnvClient({
    connectionString: connectionString || undefined,
    passphrase: passphrase || undefined
  })

  try {
    await client.connect()

    const vars = await client.list({
      project,
      service,
      environment: args.all ? undefined : environment
    })

    if (jsonOutput) {
      console.log(JSON.stringify({
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
      // Table format
      const showValues = args.verbose || args.v || false
      console.log(formatTable(vars, showValues))

      if (!showValues && vars.length > 0) {
        console.log('')
        console.log('(use -v to show full values)')
      }
    }
  } finally {
    await client.disconnect()
  }
}
