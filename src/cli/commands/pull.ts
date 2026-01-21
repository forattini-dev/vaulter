/**
 * Vaulter CLI - Pull Command
 *
 * Pull variables from backend to output targets
 *
 * Outputs mode: Pull to multiple output targets defined in config
 * - Use --all to pull to all outputs
 * - Use --output <name> to pull to a specific output
 */

import path from 'node:path'
import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import { runHook } from '../lib/hooks.js'
import { findConfigDir } from '../../lib/config-loader.js'
import { c, colorEnv, print } from '../lib/colors.js'
import { pullToOutputs, validateOutputsConfig } from '../../lib/outputs.js'
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
}

/**
 * Run the pull command
 */
export async function runPull(context: PullContext): Promise<void> {
  const { project } = context

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  if (!context.all && !context.target) {
    print.error('Outputs mode requires --all or --output <name>')
    ui.log('Examples:')
    ui.log(`  ${c.command('vaulter sync pull --all')}`)
    ui.log(`  ${c.command('vaulter sync pull --output web')}`)
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

  if (!dryRun) {
    runHook(config?.hooks?.pre_pull, 'pre_pull', verbose)
  }

  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()

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

    if (!dryRun) {
      runHook(config?.hooks?.post_pull, 'post_pull', verbose)
    }
  } finally {
    await client.disconnect()
  }
}
