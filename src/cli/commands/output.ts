/**
 * vaulter output
 *
 * Generate .env files in apps from local .vaulter/{env}/ files.
 */

import { dirname } from 'node:path'
import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { findConfigDir } from '../../lib/config-loader.js'
import { generateOutputs, normalizeOutputTargets } from '../../lib/output.js'
import { c, symbols, print } from '../lib/colors.js'
import * as ui from '../ui.js'

export interface OutputContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

export async function runOutput(context: OutputContext): Promise<void> {
  const { args, config, environment, verbose, dryRun, jsonOutput } = context

  if (!config) {
    print.error('Config required. Run "vaulter init" first.')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  const vaulterDir = configDir
  const projectRoot = dirname(configDir)

  // Check if specific targets requested
  // Use args.output for --target (already exists in CLIArgs as --output)
  const targetArg = args.output
  const allFlag = args.all
  const targets = targetArg ? [targetArg] : undefined

  if (!allFlag && !targetArg) {
    print.error('Specify --all or --output <name>')
    ui.log('')
    ui.log(c.header('Usage:'))
    ui.log(`  ${c.command('vaulter output --all')}            ${c.muted('# Generate all outputs')}`)
    ui.log(`  ${c.command('vaulter output -o svc-auth')}      ${c.muted('# Generate specific output')}`)
    ui.log('')

    const availableTargets = normalizeOutputTargets(config)
    if (availableTargets.length > 0) {
      ui.log(c.header('Available targets:'))
      for (const t of availableTargets) {
        ui.log(`  ${c.highlight(t.name)} ${c.muted('→')} ${t.path}/${t.filename}`)
      }
    }
    process.exit(1)
  }

  // Show banner
  if (!jsonOutput) {
    ui.showEnvironmentBanner(environment, {
      project: config.project,
      action: dryRun ? 'Output (dry-run)' : 'Generating outputs'
    })
  }

  const result = generateOutputs({
    vaulterDir,
    projectRoot,
    config,
    env: environment,
    targets,
    dryRun
  })

  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: result.errors.length === 0,
      environment,
      dryRun,
      outputs: result.outputs.map(o => ({
        target: o.target,
        path: o.path,
        varsCount: o.varsCount
      })),
      errors: result.errors
    }, null, 2))
    return
  }

  // Visual output
  if (result.outputs.length === 0 && result.errors.length > 0) {
    for (const err of result.errors) {
      print.error(err)
    }
    process.exit(1)
  }

  if (dryRun) {
    ui.log(c.warning('DRY RUN') + ' - would generate:')
  } else {
    ui.success(`Generated ${result.outputs.length} output(s):`)
  }

  for (const output of result.outputs) {
    ui.log(`  ${symbols.success} ${c.highlight(output.target)} ${c.muted('→')} ${output.path} (${output.varsCount} vars)`)
  }

  for (const err of result.errors) {
    ui.log(`  ${symbols.error} ${c.removed(err)}`)
  }

  if (verbose && result.outputs.length > 0) {
    ui.log('')
    ui.log(c.muted('Variables per output:'))
    for (const output of result.outputs) {
      ui.log(`  ${c.highlight(output.target)}:`)
      const keys = Object.keys(output.vars).sort().slice(0, 5)
      for (const key of keys) {
        ui.log(`    ${c.key(key)}`)
      }
      if (Object.keys(output.vars).length > 5) {
        ui.log(`    ${c.muted(`... and ${Object.keys(output.vars).length - 5} more`)}`)
      }
    }
  }
}
