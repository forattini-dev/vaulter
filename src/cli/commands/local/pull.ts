/**
 * vaulter local pull
 *
 * OFFLINE-FIRST: Generates .env files from local files ONLY.
 * NO backend calls - reads from .vaulter/local/ directory.
 *
 * For each output:
 *   1. Loads shared vars: .vaulter/local/{configs,secrets}.env
 *   2. Loads service-specific: .vaulter/local/services/{service}/*.env
 *   3. Merges: shared + service-specific (service wins)
 *   4. Writes to output path
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { runLocalPull as runLocalPullCore } from '../../../lib/local-ops.js'
import { validateOutputsConfig } from '../../../lib/outputs.js'
import { c, colorEnv, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { LocalContext } from './index.js'

export async function runLocalPull(context: LocalContext): Promise<void> {
  const { args, config, service, verbose, dryRun, jsonOutput } = context

  if (!config) {
    print.error('Config required. Run "vaulter init" first.')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
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
    ui.log('')
    ui.log('Add outputs to .vaulter/config.yaml:')
    ui.log(`  ${c.muted('outputs:')}`)
    ui.log(`  ${c.muted('  app-admin:')}`)
    ui.log(`  ${c.muted('    path: apps/app-admin')}`)
    ui.log(`  ${c.muted('    service: app-admin')}`)
    process.exit(1)
  }

  const errors = validateOutputsConfig(config)
  if (errors.length > 0) {
    print.error('Invalid outputs config:')
    for (const err of errors) ui.log(`  ${c.removed(err)}`)
    process.exit(1)
  }

  // OFFLINE-FIRST: No client needed - reads from local files only
  const result = await runLocalPullCore({
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
    ui.verbose(`Base env: ${colorEnv(result.baseEnvironment)}`, true)
    ui.verbose(`Shared vars: ${result.localSharedCount}`, true)
    ui.verbose(`Service-specific vars: ${result.totalServiceVarsCount}`, true)
  }

  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: true,
      dryRun,
      baseEnvironment: result.baseEnvironment,
      localSharedCount: result.localSharedCount,
      totalServiceVarsCount: result.totalServiceVarsCount,
      sectionAware: result.sectionAware,
      files: result.files.map(f => ({
        output: f.output,
        path: f.fullPath,
        varsCount: f.varsCount,
        sharedCount: f.sharedCount,
        serviceCount: f.serviceCount,
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
      ui.success(`Pulled to ${result.files.length} output(s) [${mode}]:`)
    }

    for (const file of result.files) {
      const userCount = file.userVars ? Object.keys(file.userVars).length : 0
      const breakdown = `${file.sharedCount} shared + ${file.serviceCount} service`
      const varsInfo = result.sectionAware && userCount > 0
        ? `${file.varsCount} vars (${breakdown}) + ${userCount} user`
        : `${file.varsCount} vars (${breakdown})`
      ui.log(`  ${c.highlight(file.output)}: ${c.muted(file.fullPath)} (${varsInfo})`)
    }

    for (const warning of result.warnings) {
      print.warning(warning)
    }
  }
}
