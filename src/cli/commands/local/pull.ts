/**
 * vaulter local pull
 *
 * Fetches base env from backend, merges with local overrides,
 * then writes to output targets.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { runLocalPull as runLocalPullCore } from '../../../lib/local-ops.js'
import { resolveBaseEnvironment } from '../../../lib/local.js'
import { validateOutputsConfig } from '../../../lib/outputs.js'
import { createClientFromConfig } from '../../lib/create-client.js'
import { c, colorEnv, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { LocalContext } from './index.js'

export async function runLocalPull(context: LocalContext): Promise<void> {
  const { args, config, project, service, verbose, dryRun, jsonOutput } = context

  if (!config) {
    print.error('Config required. Run "vaulter init" first.')
    process.exit(1)
  }

  if (!project) {
    print.error('Project not specified')
    process.exit(1)
  }

  const all = args.all as boolean | undefined
  const target = args.output as string | undefined

  if (!all && !target) {
    print.error('Requires --all or --output <name>')
    ui.log('Examples:')
    ui.log(`  ${c.command('vaulter local pull --all')}`)
    ui.log(`  ${c.command('vaulter local pull --output web')}`)
    process.exit(1)
  }

  if (!config.outputs || Object.keys(config.outputs).length === 0) {
    print.error('No outputs defined in config')
    process.exit(1)
  }

  const errors = validateOutputsConfig(config)
  if (errors.length > 0) {
    print.error('Invalid outputs config:')
    for (const err of errors) ui.log(`  ${c.removed(err)}`)
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  const baseEnv = resolveBaseEnvironment(config)

  // Fetch base vars from backend
  const client = await createClientFromConfig({
    args,
    config,
    project,
    environment: baseEnv,
    verbose
  })

  try {
    await client.connect()

    const {
      baseEnvironment,
      overridesCount,
      result
    } = await runLocalPullCore({
      client,
      config,
      configDir,
      service,
      all,
      output: target,
      dryRun,
      verbose
    })

    if (verbose) {
      ui.verbose(`Base env: ${colorEnv(baseEnvironment)}, overrides: ${overridesCount}`, true)
    }

    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        dryRun,
        project,
        baseEnvironment,
        overridesCount,
        files: result.files.map(f => ({
          output: f.output,
          path: f.fullPath,
          varsCount: f.varsCount
        })),
        warnings: result.warnings
      }, null, 2))
    } else {
      if (dryRun) {
        ui.log('Dry run - would write:')
      } else {
        ui.success(`Pulled to ${result.files.length} output(s) (base: ${baseEnvironment} + ${overridesCount} overrides):`)
      }

      for (const file of result.files) {
        ui.log(`  ${c.highlight(file.output)}: ${c.muted(file.fullPath)} (${file.varsCount} vars)`)
      }

      for (const warning of result.warnings) {
        print.warning(warning)
      }
    }
  } finally {
    await client.disconnect()
  }
}
