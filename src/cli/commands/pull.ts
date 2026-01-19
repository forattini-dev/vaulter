/**
 * Vaulter CLI - Pull Command
 *
 * Pull variables from backend to local .env file
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
}

/**
 * Run the pull command
 */
export async function runPull(context: PullContext): Promise<void> {
  const { args, config, project, environment, verbose, dryRun, jsonOutput } = context

  // If --shared is set, target __shared__ service (monorepo)
  const effectiveService = context.shared ? SHARED_SERVICE : context.service

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

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
