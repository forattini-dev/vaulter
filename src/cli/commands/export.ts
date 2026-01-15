/**
 * MiniEnv CLI - Export Command
 *
 * Export variables for shell evaluation or other formats
 */

import type { CLIArgs, MiniEnvConfig, Environment, ExportFormat } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import { serializeEnv } from '../../lib/env-parser.js'

interface ExportContext {
  args: CLIArgs
  config: MiniEnvConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  jsonOutput: boolean
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
 * Run the export command
 */
export async function runExport(context: ExportContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  if (!project) {
    console.error('Error: Project not specified and no config found')
    console.error('Run "minienv init" or specify --project')
    process.exit(1)
  }

  // Determine format
  let format: ExportFormat = 'shell'
  if (args.format) {
    const validFormats: ExportFormat[] = ['shell', 'json', 'yaml', 'env', 'tfvars']
    if (!validFormats.includes(args.format as ExportFormat)) {
      console.error(`Error: Invalid format "${args.format}"`)
      console.error(`Valid formats: ${validFormats.join(', ')}`)
      process.exit(1)
    }
    format = args.format as ExportFormat
  } else if (jsonOutput) {
    format = 'json'
  }

  if (verbose) {
    console.error(`Exporting ${project}/${service || '(no service)'}/${environment} as ${format}`)
  }

  const client = await createClientFromConfig({ args, config, verbose })

  try {
    await client.connect()

    const vars = await client.export(project, environment, service)

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
      default:
        output = formatShell(vars)
    }

    console.log(output)
  } finally {
    await client.disconnect()
  }
}
