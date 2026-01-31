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
  const overwrite = args.overwrite as boolean | undefined

  if (!all && !target) {
    print.error('Requires --all or --output <name>')
    ui.log('Examples:')
    ui.log(`  ${c.command('vaulter local pull --all')}`)
    ui.log(`  ${c.command('vaulter local pull --output web')}`)
    ui.log('')
    ui.log('Options:')
    ui.log(`  ${c.muted('--overwrite')}  Overwrite entire .env file (default: preserve user vars)`)
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
      localSharedCount,
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
      verbose,
      overwrite
    })

    if (verbose) {
      const parts = [`Base env: ${colorEnv(baseEnvironment)}`]
      if (localSharedCount > 0) parts.push(`shared: ${localSharedCount}`)
      if (overridesCount > 0) parts.push(`overrides: ${overridesCount}`)
      ui.verbose(parts.join(', '), true)
    }

    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        dryRun,
        project,
        baseEnvironment,
        localSharedCount,
        overridesCount,
        sectionAware: result.sectionAware,
        files: result.files.map(f => ({
          output: f.output,
          path: f.fullPath,
          varsCount: f.varsCount,
          userVarsCount: f.userVars ? Object.keys(f.userVars).length : 0,
          totalVarsCount: f.totalVarsCount
        })),
        warnings: result.warnings
      }, null, 2))
    } else {
      if (dryRun) {
        ui.log('Dry run - would write:')
      } else {
        const mode = result.sectionAware ? 'section-aware' : 'overwrite'
        const extras: string[] = []
        if (localSharedCount > 0) extras.push(`${localSharedCount} shared`)
        if (overridesCount > 0) extras.push(`${overridesCount} overrides`)
        const extrasStr = extras.length > 0 ? ` + ${extras.join(' + ')}` : ''
        ui.success(`Pulled to ${result.files.length} output(s) [${mode}] (base: ${baseEnvironment}${extrasStr}):`)
      }

      for (const file of result.files) {
        const userCount = file.userVars ? Object.keys(file.userVars).length : 0
        const varsInfo = result.sectionAware && userCount > 0
          ? `${file.varsCount} vaulter + ${userCount} user vars`
          : `${file.varsCount} vars`
        ui.log(`  ${c.highlight(file.output)}: ${c.muted(file.fullPath)} (${varsInfo})`)
      }

      for (const warning of result.warnings) {
        print.warning(warning)
      }
    }
  } finally {
    await client.disconnect()
  }
}
