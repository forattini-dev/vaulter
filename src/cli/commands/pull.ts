/**
 * Vaulter CLI - Pull Command
 *
 * Two modes:
 * 1. Outputs mode (default): Pull to output targets defined in config
 *    - Use --all to pull to all outputs
 *    - Use --output <name> to pull to a specific output
 *
 * 2. Dir mode (--dir): Pull backend → .vaulter/{env}/ structure
 */

import path from 'node:path'
import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { withClient } from '../lib/create-client.js'
import { findConfigDir } from '../../lib/config-loader.js'
import { c, colorEnv, print } from '../lib/colors.js'
import { pullToOutputs, validateOutputsConfig } from '../../lib/outputs.js'
import { pullFromBackend } from '../../lib/backend-sync.js'
import * as ui from '../ui.js'

export interface PullContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
  /** Pull to all output targets (outputs mode) */
  all?: boolean
  /** Specific output target name (outputs mode) */
  target?: string
  /** Use directory mode: pull to .vaulter/{env}/ structure */
  dir?: boolean
}

/**
 * Run the pull command
 */
export async function runPull(context: PullContext): Promise<void> {
  const { project, args } = context

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  // Check for --dir flag
  const dirMode = args.dir || context.dir
  const configDir = findConfigDir()

  if (dirMode) {
    if (!configDir) {
      print.error('Could not find .vaulter/ directory')
      process.exit(1)
    }
    await runDirPull(context, configDir)
    return
  }

  // Auto-detect: if no --all or --output, suggest dir mode
  if (!context.all && !context.target) {
    print.error('Specify --all, --output <name>, or --dir')
    ui.log('Examples:')
    ui.log(`  ${c.command('vaulter sync pull --all')}        ${c.muted('# Pull to all output targets')}`)
    ui.log(`  ${c.command('vaulter sync pull --output web')} ${c.muted('# Pull to specific output')}`)
    ui.log(`  ${c.command('vaulter sync pull --dir')}        ${c.muted('# Pull to .vaulter/{env}/ structure')}`)
    process.exit(1)
  }

  await runPullOutputs(context)
}

/**
 * Run pull in outputs mode (--all or --output <name>)
 *
 * Pulls variables to multiple output targets defined in config.outputs
 */
async function runPullOutputs(context: PullContext): Promise<void> {
  const { args, config, project, environment, verbose, dryRun, jsonOutput, all, target } = context

  if (!config) {
    print.error('Config required for outputs mode')
    ui.log(`Run "${c.command('vaulter init')}" to create a config file`)
    process.exit(1)
  }

  if (!config.outputs || Object.keys(config.outputs).length === 0) {
    print.error('No outputs defined in config')
    ui.log('Add an "outputs" section to your config:')
    ui.log('')
    ui.log(c.muted('  outputs:'))
    ui.log(c.muted('    web:'))
    ui.log(c.muted('      path: apps/web'))
    ui.log(c.muted('      include: [NEXT_PUBLIC_*]'))
    ui.log(c.muted('    api: apps/api'))
    ui.log('')
    process.exit(1)
  }

  // Validate outputs config
  const errors = validateOutputsConfig(config)
  if (errors.length > 0) {
    print.error('Invalid outputs config:')
    for (const err of errors) {
      ui.log(`  ${c.removed(err)}`)
    }
    process.exit(1)
  }

  // Find project root (where .vaulter/ is located)
  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }
  const projectRoot = path.dirname(configDir)

  if (verbose) {
    const outputNames = Object.keys(config.outputs)
    const targetDesc = all ? `all outputs (${outputNames.join(', ')})` : `output "${target}"`
    ui.verbose(`Pulling ${c.project(project)}/${colorEnv(environment)} to ${targetDesc}`, true)
    ui.verbose(`Project root: ${c.muted(projectRoot)}`, true)
  }

  await withClient({ args, config, project, verbose }, async (client) => {
    const result = await pullToOutputs({
      client,
      config,
      environment,
      projectRoot,
      all,
      output: target,
      dryRun,
      verbose
    })

    // Output results
    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        dryRun,
        project,
        environment,
        files: result.files.map(f => ({
          output: f.output,
          path: f.fullPath,
          varsCount: f.varsCount,
          vars: dryRun ? f.vars : Object.keys(f.vars)
        })),
        warnings: result.warnings
      }, null, 2))
    } else {
      if (dryRun) {
        ui.log('Dry run - would write:')
      } else {
        ui.success(`Pulled to ${result.files.length} output(s):`)
      }

      for (const file of result.files) {
        const varsList = Object.keys(file.vars).slice(0, 5).join(', ')
        const more = Object.keys(file.vars).length > 5 ? '...' : ''
        ui.log(`  ${c.highlight(file.output)}: ${c.muted(file.fullPath)} (${file.varsCount} vars)`)
        if (verbose) {
          ui.log(`    ${c.muted(varsList + more)}`)
        }
      }

      for (const warning of result.warnings) {
        print.warning(warning)
      }
    }
  })
}

/**
 * Run pull in directory mode
 *
 * Pulls from backend to .vaulter/{env}/ structure:
 * - configs.env + secrets.env ← __shared__
 * - services/{svc}/configs.env + secrets.env ← {svc}
 */
async function runDirPull(context: PullContext, configDir: string): Promise<void> {
  const { args, config, project, environment, verbose, dryRun, jsonOutput } = context

  // Show environment banner
  if (!jsonOutput && !dryRun) {
    ui.showEnvironmentBanner(environment, {
      project,
      action: 'Pulling to directory structure'
    })
  }

  await withClient({ args, config, project, verbose }, async (client) => {
    const result = await pullFromBackend({
      client,
      vaulterDir: configDir,
      project,
      environment,
      dryRun
    })

    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        dryRun,
        project,
        environment,
        pulled: result.pulled,
        services: result.services,
        details: result.details
      }))
    } else if (dryRun) {
      ui.log(`${c.muted('Dry run')} - would pull:`)
      ui.log(`  Shared: ${result.details.shared.configs} configs, ${result.details.shared.secrets} secrets`)
      for (const [svc, counts] of Object.entries(result.details.services)) {
        ui.log(`  ${c.service(svc)}: ${counts.configs} configs, ${counts.secrets} secrets`)
      }
      ui.log(`  ${c.muted('Total:')} ${result.pulled} variables`)
    } else {
      ui.success(`Pulled ${result.pulled} variables to ${configDir}/${environment}/`)
      ui.log(`  Shared: ${result.details.shared.configs} configs, ${result.details.shared.secrets} secrets`)
      for (const [svc, counts] of Object.entries(result.details.services)) {
        ui.log(`  ${c.service(svc)}: ${counts.configs} configs, ${counts.secrets} secrets`)
      }
    }
  })
}
