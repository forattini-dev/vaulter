/**
 * Vaulter Run Command
 *
 * Executes a command with environment variables loaded automatically.
 * Auto-detects environment (local, CI, K8s) and loads appropriate files.
 *
 * @example
 * npx vaulter run -- pnpm build
 * npx vaulter run -e prd -- pnpm build
 * npx vaulter run --service svc-auth -- pnpm start
 */

import { spawn } from 'node:child_process'
import { config, type ConfigResult } from '../../config.js'
import { c, print, dim } from '../lib/colors.js'
import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import * as ui from '../ui.js'

interface RunContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  quiet: boolean
  dryRun: boolean
  jsonOutput: boolean
}

/**
 * Run command handler
 */
export async function runRun(context: RunContext): Promise<void> {
  const { args, verbose, quiet, dryRun, service, environment } = context

  // Get command to execute (everything after --)
  // The CLI parser puts rest args (after --) in args._
  const commandIndex = process.argv.indexOf('--')
  if (commandIndex === -1 || commandIndex === process.argv.length - 1) {
    print.error('No command specified')
    ui.log(`Usage: ${c.command('vaulter run -- <command>')}`)
    ui.log(`Example: ${c.command('vaulter run -- pnpm build')}`)
    process.exit(1)
  }

  const commandArgs = process.argv.slice(commandIndex + 1)
  const [command, ...cmdArgs] = commandArgs

  if (!command) {
    print.error('No command specified after --')
    process.exit(1)
  }

  // Load env vars using smart config
  const result = config({
    mode: 'auto',
    environment,
    service,
    verbose,
  })

  // Print info (unless quiet)
  if (!quiet) {
    printLoadInfo(result, verbose)
  }

  // Dry run - just show what would happen
  if (dryRun) {
    ui.log('')
    ui.log(c.label('Would execute:'))
    ui.log(`  ${c.command(commandArgs.join(' '))}`)
    ui.log('')
    ui.log(c.label('With env vars from:'))
    for (const file of result.loadedFiles) {
      ui.log(`  ${c.success('✓')} ${file}`)
    }
    return
  }

  // Execute command with inherited env (process.env is already populated by config())
  if (verbose) {
    ui.log('')
    ui.log(c.label(`Executing: ${c.command(commandArgs.join(' '))}`))
    ui.log('')
  }

  const child = spawn(command, cmdArgs, {
    stdio: 'inherit',
    env: process.env,
    shell: true
  })

  // Handle exit
  child.on('close', (code) => {
    process.exit(code ?? 0)
  })

  child.on('error', (err) => {
    print.error(`Failed to execute command: ${err.message}`)
    process.exit(1)
  })
}

/**
 * Print load information
 */
function printLoadInfo(result: ConfigResult, verbose: boolean): void {
  if (result.skipped) {
    ui.log(dim(`[vaulter] ${result.skipReason}`))
    return
  }

  if (result.loadedFiles.length === 0) {
    ui.log(c.warning('[vaulter] No env files found'))
    return
  }

  // Compact output by default
  if (!verbose) {
    ui.log(dim(`[vaulter] Loaded ${result.varsLoaded} vars (${result.detectedEnv} mode)`))
    return
  }

  // Verbose output
  ui.log(c.label('[vaulter] Environment Detection'))
  ui.log(`  Mode: ${c.value(result.mode)}`)
  ui.log(`  Detected: ${c.value(result.detectedEnv)}`)
  ui.log('')

  if (result.loadedFiles.length > 0) {
    ui.log(c.label('[vaulter] Loaded Files'))
    for (const file of result.loadedFiles) {
      ui.log(`  ${c.success('✓')} ${file}`)
    }
  }

  if (result.skippedFiles.length > 0) {
    ui.log(c.label('[vaulter] Skipped (not found)'))
    for (const file of result.skippedFiles) {
      ui.log(`  ${dim('○')} ${dim(file)}`)
    }
  }

  ui.log('')
  ui.log(dim(`Total: ${result.varsLoaded} variables loaded`))
}
