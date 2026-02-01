/**
 * Vaulter CLI - Init Command
 *
 * Initialize a new .vaulter configuration in the current directory
 * Uses the shared init-generator module.
 */

import type { CLIArgs, VaulterConfig } from '../../types.js'
import { DEFAULT_ENVIRONMENTS } from '../../types.js'
import { configExists, findConfigDir } from '../../lib/config-loader.js'
import {
  generateVaulterStructure,
  detectMonorepo,
  getDefaultProjectName,
  type InitOptions
} from '../../lib/init-generator.js'
import { c, print, cyan, yellow, dim } from '../lib/colors.js'
import * as ui from '../ui.js'

interface InitContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

function parseEnvironments(raw?: string): string[] | null {
  if (!raw) return null
  const list = raw
    .split(',')
    .map(env => env.trim())
    .filter(env => env.length > 0)
  const unique = Array.from(new Set(list))

  if (unique.length === 0) {
    print.error('Invalid environments list')
    ui.log('Use --environments with a comma-separated list (e.g., dev,stg,prd)')
    process.exit(1)
  }

  return unique
}

/**
 * Run the init command
 */
export async function runInit(context: InitContext): Promise<void> {
  const { args, verbose, dryRun, jsonOutput } = context

  // Check if already initialized
  if (configExists() && !args.force) {
    const existingDir = findConfigDir()
    if (jsonOutput) {
      ui.output(JSON.stringify({ error: 'already_initialized', path: existingDir }))
    } else {
      print.error(`Vaulter already initialized at ${existingDir}`)
      ui.log(`Use ${c.highlight('--force')} to reinitialize`)
    }
    process.exit(1)
  }

  // Determine project name
  const projectName = args.project || getDefaultProjectName()
  const environments = parseEnvironments(args.environments) || DEFAULT_ENVIRONMENTS

  // Detect or force monorepo mode
  const monorepoDetection = detectMonorepo()
  const isMonorepo = args.monorepo || monorepoDetection.isMonorepo
  const servicesPattern = monorepoDetection.servicesPattern

  ui.verbose(`Project: ${projectName}`, verbose)
  ui.verbose(`Mode: ${isMonorepo ? 'monorepo' : 'single-repo'}`, verbose)
  if (monorepoDetection.tool) {
    ui.verbose(`Detected: ${monorepoDetection.tool}`, verbose)
  }

  // Build options
  const options: InitOptions = {
    projectName,
    isMonorepo,
    environments,
    backend: args.backend,
    servicesPattern,
    force: args.force || false,
    dryRun
  }

  // Generate structure
  const result = generateVaulterStructure(process.cwd(), options)

  // Output
  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: result.success,
      project: result.projectName,
      mode: result.mode,
      detected: monorepoDetection.tool || null,
      files: result.createdFiles,
      dryRun
    }))
    return
  }

  if (dryRun) {
    print.info('Dry run - would create:')
    for (const file of result.createdFiles) {
      ui.log(`  ${cyan(file)}`)
    }
    return
  }

  // Success output
  ui.log('')
  print.success(`Initialized vaulter for project: ${c.project(result.projectName)}`)
  ui.log('')

  if (isMonorepo) {
    if (monorepoDetection.tool) {
      ui.log(`  ${dim('Detected:')} ${c.value(monorepoDetection.tool)} monorepo`)
    }
    ui.log(`  ${dim('Mode:')} monorepo (with services/)`)
  } else {
    ui.log(`  ${dim('Mode:')} single-repo`)
  }

  ui.log('')
  ui.log(`${dim('Created files:')}`)
  for (const file of result.createdFiles.slice(0, 8)) {
    ui.log(`  ${cyan(file)}`)
  }
  if (result.createdFiles.length > 8) {
    ui.log(`  ${dim(`... and ${result.createdFiles.length - 8} more`)}`)
  }

  ui.log('')
  ui.log(`${c.header('Next steps:')}`)
  ui.log('')

  if (isMonorepo) {
    ui.log(`  ${yellow('1.')} Edit local secrets in:`)
    ui.log(`     ${cyan('.vaulter/local/shared/secrets.env')}`)
    ui.log('')
    ui.log(`  ${yellow('2.')} Configure backend in ${cyan('.vaulter/config.yaml')}`)
    ui.log('')
    ui.log(`  ${yellow('3.')} Generate encryption key:`)
    ui.log(`     ${c.command('vaulter key generate --name master')}`)
    ui.log('')
    ui.log(`  ${yellow('4.')} Run with env vars loaded:`)
    ui.log(`     ${c.command('vaulter run -s api -- pnpm dev')}`)
  } else {
    ui.log(`  ${yellow('1.')} Edit local secrets in:`)
    ui.log(`     ${cyan('.vaulter/local/secrets.env')}`)
    ui.log('')
    ui.log(`  ${yellow('2.')} Configure backend in ${cyan('.vaulter/config.yaml')}`)
    ui.log('')
    ui.log(`  ${yellow('3.')} Generate encryption key:`)
    ui.log(`     ${c.command('vaulter key generate --name master')}`)
    ui.log('')
    ui.log(`  ${yellow('4.')} Run with env vars loaded:`)
    ui.log(`     ${c.command('vaulter run -- pnpm dev')}`)
  }

  ui.log('')
}
