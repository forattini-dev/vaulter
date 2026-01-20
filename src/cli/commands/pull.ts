/**
 * Vaulter CLI - Pull Command
 *
 * Pull variables from backend to local .env file
 *
 * Supports two modes:
 * 1. Legacy mode: Pull to a single .env file (default behavior)
 * 2. Outputs mode: Pull to multiple output targets defined in config
 *    - Use --all to pull to all outputs
 *    - Use --output <name> to pull to a specific output
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import { runHook } from '../lib/hooks.js'
import { findConfigDir, getEnvFilePathForConfig } from '../../lib/config-loader.js'
import { serializeEnv, parseEnvFile } from '../../lib/env-parser.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import { SHARED_SERVICE } from '../../lib/shared.js'
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
  /** Delete local variables that don't exist on remote */
  prune?: boolean
  /** Target shared variables scope (monorepo) */
  shared?: boolean
  /** Pull to all output targets (outputs mode) */
  all?: boolean
  /** Specific output target name (outputs mode) */
  target?: string
}

/**
 * Run the pull command
 */
export async function runPull(context: PullContext): Promise<void> {
  const { args, config, project, environment, verbose, dryRun, jsonOutput } = context

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  // Check if we should use outputs mode
  // - --all always triggers outputs mode
  // - --output <name> triggers outputs mode IF config has outputs section
  const hasOutputsConfig = config?.outputs && Object.keys(config.outputs).length > 0
  const useOutputsMode = context.all || (context.target && hasOutputsConfig)

  if (useOutputsMode) {
    await runPullOutputs(context)
    return
  }

  // Legacy mode: pull to single .env file
  // If --shared is set, target __shared__ service (monorepo)
  const effectiveService = context.shared ? SHARED_SERVICE : context.service

  // Determine output destination
  const outputPath = args.output || args.o || args.file || args.f
  let envFilePath: string | null = null

  if (outputPath) {
    envFilePath = path.resolve(outputPath)
  } else {
    // Default path depends on directories.mode:
    // - unified: .vaulter/environments/<env>.env
    // - split: deploy/secrets/<env>.env
    const configDir = findConfigDir()
    if (configDir && config) {
      envFilePath = getEnvFilePathForConfig(config, configDir, environment)
    }
  }

  if (verbose) {
    ui.verbose(`Pulling ${c.project(project)}/${context.shared ? c.env('shared') : c.service(effectiveService || '(no service)')}/${colorEnv(environment)}`, true)
    if (envFilePath) {
      ui.verbose(`Output: ${c.muted(envFilePath)}`, true)
    } else {
      ui.verbose('Output: stdout', true)
    }
  }

  // Show environment banner (respects --quiet and --json)
  if (!jsonOutput && !dryRun) {
    ui.showEnvironmentBanner(environment, {
      project,
      service: context.shared ? 'shared' : effectiveService,
      action: 'Pulling variables'
    })
  }

  if (!dryRun) {
    runHook(config?.hooks?.pre_pull, 'pre_pull', verbose)
  }

  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()

    const vars = await client.export(project, environment, effectiveService)
    const varCount = Object.keys(vars).length

    if (varCount === 0) {
      if (jsonOutput) {
        ui.output(JSON.stringify({
          warning: 'no_variables',
          project,
          service: effectiveService,
          environment,
          shared: context.shared || false
        }))
      } else {
        print.warning(`No variables found for ${project}/${environment}`)
      }
      return
    }

    // Serialize to .env format
    const envContent = serializeEnv(vars)

    if (dryRun) {
      // Calculate what would happen with merge/prune
      let localOnlyCount = 0
      const localOnlyKeys: string[] = []

      if (envFilePath && fs.existsSync(envFilePath)) {
        const localVars = parseEnvFile(envFilePath)
        const remoteKeys = new Set(Object.keys(vars))
        for (const key of Object.keys(localVars)) {
          if (!remoteKeys.has(key)) {
            localOnlyKeys.push(key)
            localOnlyCount++
          }
        }
      }

      if (jsonOutput) {
        ui.output(JSON.stringify({
          dryRun: true,
          project,
          service: effectiveService,
          environment,
          shared: context.shared || false,
          prune: context.prune || false,
          pull: varCount,
          localOnly: localOnlyCount,
          localOnlyAction: context.prune ? 'delete' : 'keep',
          localOnlyKeys,
          outputPath: envFilePath,
          variables: Object.keys(vars)
        }))
      } else {
        ui.log(`Dry run - would pull ${varCount} variables:`)
        ui.log(`  Variables: ${Object.keys(vars).join(', ')}`)
        if (envFilePath) {
          ui.log(`  Output: ${envFilePath}`)
        } else {
          ui.log('  Output: stdout')
        }
        if (localOnlyCount > 0) {
          if (context.prune) {
            ui.log(`  ${c.removed(`Would delete ${localOnlyCount} local-only: ${localOnlyKeys.join(', ')}`)}`)
          } else {
            ui.log(`  Would keep ${localOnlyCount} local-only: ${localOnlyKeys.join(', ')}`)
          }
        }
      }
      return
    }

    if (envFilePath) {
      // Ensure directory exists
      const dir = path.dirname(envFilePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // Merge with existing local vars (unless --prune is set)
      let finalVars = vars
      let localOnlyKept = 0

      if (fs.existsSync(envFilePath) && !context.prune) {
        const localVars = parseEnvFile(envFilePath)
        const remoteKeys = new Set(Object.keys(vars))

        // Merge: remote vars + local-only vars
        finalVars = { ...vars }
        for (const [key, value] of Object.entries(localVars)) {
          if (!remoteKeys.has(key)) {
            finalVars[key] = value
            localOnlyKept++
          }
        }
      }

      const finalContent = serializeEnv(finalVars)
      fs.writeFileSync(envFilePath, finalContent + '\n')

      if (jsonOutput) {
        ui.output(JSON.stringify({
          success: true,
          project,
          service: effectiveService,
          environment,
          shared: context.shared || false,
          pulled: varCount,
          localOnlyKept,
          total: Object.keys(finalVars).length,
          outputPath: envFilePath
        }))
      } else {
        ui.success(`Pulled ${varCount} variables to ${envFilePath}`)
        if (localOnlyKept > 0) {
          ui.log(`  Kept ${localOnlyKept} local-only variables`)
        }
      }

      runHook(config?.hooks?.post_pull, 'post_pull', verbose)
    } else {
      // Output to stdout
      if (jsonOutput) {
        ui.output(JSON.stringify({
          success: true,
          project,
          service: effectiveService,
          environment,
          shared: context.shared || false,
          variables: vars
        }))
      } else {
        ui.output(envContent)
      }

      runHook(config?.hooks?.post_pull, 'post_pull', verbose)
    }
  } finally {
    await client.disconnect()
  }
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
