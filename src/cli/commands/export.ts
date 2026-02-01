/**
 * Vaulter CLI - Export Command
 *
 * Export variables for shell evaluation or other formats
 */

import type { CLIArgs, VaulterConfig, Environment, ExportFormat } from '../../types.js'
import { withClient } from '../lib/create-client.js'
import { serializeEnv } from '../../lib/env-parser.js'
import { SHARED_SERVICE } from '../../lib/shared.js'
import { print } from '../lib/colors.js'
import * as ui from '../ui.js'

interface ExportContext {
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
 * Escape value for shell
 */
function shellEscape(value: string): string {
  // If value contains special chars, wrap in single quotes
  // and escape any single quotes within
  if (/[^a-zA-Z0-9_\-.:\/]/.test(value)) {
    return "'" + value.replace(/'/g, "'\"'\"'") + "'"
  }
  return value
}

/**
 * Format variables for shell export
 */
function formatShell(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `export ${key}=${shellEscape(value)}`)
    .join('\n')
}

/**
 * Format variables as JSON
 */
function formatJson(vars: Record<string, string>): string {
  return JSON.stringify(vars, null, 2)
}

/**
 * Format variables as YAML
 */
function formatYaml(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => {
      // Quote values that need it in YAML
      if (
        value.includes(':') ||
        value.includes('#') ||
        value.includes('\n') ||
        value.startsWith(' ') ||
        value.endsWith(' ') ||
        value === '' ||
        value === 'true' ||
        value === 'false' ||
        value === 'null' ||
        !isNaN(Number(value))
      ) {
        return `${key}: "${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
      }
      return `${key}: ${value}`
    })
    .join('\n')
}

/**
 * Format variables as Terraform tfvars
 */
function formatTfvars(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => {
      // Terraform variable names are lowercase with underscores
      const tfKey = key.toLowerCase()
      return `${tfKey} = "${value.replace(/"/g, '\\"')}"`
    })
    .join('\n')
}

/**
 * Format variables as Docker --env arguments
 * Output: -e "KEY1=value1" -e "KEY2=value2"
 *
 * Usage: docker run $(vaulter export --format=docker-args -e prd) myimage
 *
 * LIMITATION: Due to shell word-splitting, values with spaces or special
 * characters won't work correctly with $(...) command substitution.
 * For complex values, recommend using --env-file instead:
 *   vaulter export --format=env > .env && docker run --env-file .env myimage
 */
function formatDockerArgs(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => {
      // Escape double quotes and handle special shell characters
      const escapedValue = value.replace(/"/g, '\\"')
      return `-e "${key}=${escapedValue}"`
    })
    .join(' ')
}

/**
 * Run the export command
 */
export async function runExport(context: ExportContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  // Check for --shared flag
  const isShared = args.shared || context.shared
  const effectiveService = isShared ? SHARED_SERVICE : service

  // Check for --skip-shared flag (disable inheritance)
  const skipShared = args['skip-shared'] === true
  const includeShared = !skipShared

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log('Run "vaulter init" or specify --project')
    process.exit(1)
  }

  // Determine format
  let format: ExportFormat = 'shell'
  if (args.format) {
    const validFormats: ExportFormat[] = ['shell', 'json', 'yaml', 'env', 'tfvars', 'docker-args']
    if (!validFormats.includes(args.format as ExportFormat)) {
      print.error(`Invalid format "${args.format}"`)
      ui.log(`Valid formats: ${validFormats.join(', ')}`)
      process.exit(1)
    }
    format = args.format as ExportFormat
  } else if (jsonOutput) {
    format = 'json'
  }

  const scope = isShared ? '__shared__' : (effectiveService || '(no service)')
  ui.verbose(`Exporting ${project}/${scope}/${environment} as ${format}`, verbose)

  await withClient({ args, config, project, verbose }, async (client) => {
    const vars = await client.export(project, environment, effectiveService, { includeShared })

    // Format output
    let output: string
    switch (format) {
      case 'shell':
        output = formatShell(vars)
        break
      case 'json':
        output = formatJson(vars)
        break
      case 'yaml':
        output = formatYaml(vars)
        break
      case 'env':
        output = serializeEnv(vars)
        break
      case 'tfvars':
        output = formatTfvars(vars)
        break
      case 'docker-args':
        output = formatDockerArgs(vars)
        break
      default:
        output = formatShell(vars)
    }

    ui.output(output)
  })
}
