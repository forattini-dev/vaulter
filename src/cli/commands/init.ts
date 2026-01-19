/**
 * Vaulter CLI - Init Command
 *
 * Initialize a new .vaulter configuration in the current directory
 * Uses the shared init-generator module.
 */

import path from 'node:path'
import type { CLIArgs, VaulterConfig } from '../../types.js'
import { configExists, findConfigDir } from '../../lib/config-loader.js'
import {
  generateVaulterStructure,
  detectMonorepo,
  getDefaultProjectName,
  DEFAULT_ENVIRONMENTS,
  type InitOptions
} from '../../lib/init-generator.js'
import { c, print, cyan, yellow, dim } from '../lib/colors.js'

interface InitContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
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
      console.log(JSON.stringify({ error: 'already_initialized', path: existingDir }))
    } else {
      print.error(`Vaulter already initialized at ${existingDir}`)
      console.error(`Use ${c.highlight('--force')} to reinitialize`)
    }
    process.exit(1)
  }

  // Determine project name
  const projectName = args.project || args.p || getDefaultProjectName()

  // Detect or force monorepo mode
  const monorepoDetection = detectMonorepo()
  const isMonorepo = args.monorepo || monorepoDetection.isMonorepo
  const servicesPattern = monorepoDetection.servicesPattern

  if (verbose) {
    console.log(`Project: ${projectName}`)
    console.log(`Mode: ${isMonorepo ? 'monorepo' : 'single-repo'}`)
    if (monorepoDetection.tool) {
      console.log(`Detected: ${monorepoDetection.tool}`)
    }
  }

  // Build options
  const options: InitOptions = {
    projectName,
    isMonorepo,
    environments: DEFAULT_ENVIRONMENTS,
    backend: args.backend || args.b,
    servicesPattern,
    force: args.force || false,
    dryRun
  }

  // Generate structure
  const result = generateVaulterStructure(process.cwd(), options)

  // Output
  if (jsonOutput) {
    console.log(JSON.stringify({
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
      console.log(`  ${cyan(file)}`)
    }
    return
  }

  // Success output
  console.log('')
  print.success(`Initialized vaulter for project: ${c.project(result.projectName)}`)
  console.log('')

  if (isMonorepo) {
    if (monorepoDetection.tool) {
      console.log(`  ${dim('Detected:')} ${c.value(monorepoDetection.tool)} monorepo`)
    }
    console.log(`  ${dim('Mode:')} monorepo (with services/)`)
  } else {
    console.log(`  ${dim('Mode:')} single-repo`)
  }

  console.log('')
  console.log(`${dim('Created files:')}`)
  for (const file of result.createdFiles.slice(0, 8)) {
    console.log(`  ${cyan(file)}`)
  }
  if (result.createdFiles.length > 8) {
    console.log(`  ${dim(`... and ${result.createdFiles.length - 8} more`)}`)
  }

  console.log('')
  console.log(`${c.header('Next steps:')}`)
  console.log('')

  if (isMonorepo) {
    console.log(`  ${yellow('1.')} Copy and fill local secrets:`)
    console.log(`     ${c.command('cp .vaulter/local/shared.env.example .vaulter/local/shared.env')}`)
    console.log('')
    console.log(`  ${yellow('2.')} Configure backend in ${cyan('.vaulter/config.yaml')}`)
    console.log('')
    console.log(`  ${yellow('3.')} Generate encryption key:`)
    console.log(`     ${c.command('vaulter key generate --name master')}`)
    console.log('')
    console.log(`  ${yellow('4.')} Run with env vars loaded:`)
    console.log(`     ${c.command('vaulter run -s api -- pnpm dev')}`)
  } else {
    console.log(`  ${yellow('1.')} Copy and fill local secrets:`)
    console.log(`     ${c.command('cp .vaulter/local/.env.example .vaulter/local/.env')}`)
    console.log('')
    console.log(`  ${yellow('2.')} Configure backend in ${cyan('.vaulter/config.yaml')}`)
    console.log('')
    console.log(`  ${yellow('3.')} Generate encryption key:`)
    console.log(`     ${c.command('vaulter key generate --name master')}`)
    console.log('')
    console.log(`  ${yellow('4.')} Run with env vars loaded:`)
    console.log(`     ${c.command('vaulter run -- pnpm dev')}`)
  }

  console.log('')
}
