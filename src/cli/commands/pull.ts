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
import { serializeEnv } from '../../lib/env-parser.js'

interface PullContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

/**
 * Run the pull command
 */
export async function runPull(context: PullContext): Promise<void> {
  const { args, config, project, service, environment, verbose, dryRun, jsonOutput } = context

  if (!project) {
    console.error('Error: Project not specified and no config found')
    console.error('Run "vaulter init" or specify --project')
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
    console.error(`Pulling ${project}/${service || '(no service)'}/${environment}`)
    if (envFilePath) {
      console.error(`Output: ${envFilePath}`)
    } else {
      console.error('Output: stdout')
    }
  }

  if (!dryRun) {
    runHook(config?.hooks?.pre_pull, 'pre_pull', verbose)
  }

  const client = await createClientFromConfig({ args, config, verbose })

  try {
    await client.connect()

    const vars = await client.export(project, environment, service)
    const varCount = Object.keys(vars).length

    if (varCount === 0) {
      if (jsonOutput) {
        console.log(JSON.stringify({
          warning: 'no_variables',
          project,
          service,
          environment
        }))
      } else {
        console.error(`Warning: No variables found for ${project}/${environment}`)
      }
      return
    }

    // Serialize to .env format
    const envContent = serializeEnv(vars)

    if (dryRun) {
      if (jsonOutput) {
        console.log(JSON.stringify({
          dryRun: true,
          project,
          service,
          environment,
          variableCount: varCount,
          outputPath: envFilePath,
          variables: Object.keys(vars)
        }))
      } else {
        console.log(`Dry run - would pull ${varCount} variables:`)
        console.log(`  Variables: ${Object.keys(vars).join(', ')}`)
        if (envFilePath) {
          console.log(`  Output: ${envFilePath}`)
        } else {
          console.log('  Output: stdout')
        }
      }
      return
    }

    if (envFilePath) {
      // Check if file exists and warn about overwrite
      if (fs.existsSync(envFilePath) && !args.force) {
        console.error(`Warning: File exists: ${envFilePath}`)
        console.error('Use --force to overwrite')
        process.exit(1)
      }

      // Ensure directory exists
      const dir = path.dirname(envFilePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // Write file
      fs.writeFileSync(envFilePath, envContent + '\n')

      if (jsonOutput) {
        console.log(JSON.stringify({
          success: true,
          project,
          service,
          environment,
          variableCount: varCount,
          outputPath: envFilePath
        }))
      } else {
        console.log(`✓ Pulled ${varCount} variables to ${envFilePath}`)
      }

      runHook(config?.hooks?.post_pull, 'post_pull', verbose)
    } else {
      // Output to stdout
      if (jsonOutput) {
        console.log(JSON.stringify({
          success: true,
          project,
          service,
          environment,
          variables: vars
        }))
      } else {
        console.log(envContent)
      }

      runHook(config?.hooks?.post_pull, 'post_pull', verbose)
    }
  } finally {
    await client.disconnect()
  }
}
