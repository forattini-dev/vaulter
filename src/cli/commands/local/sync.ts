/**
 * vaulter local sync
 *
 * Pull from backend to .vaulter/local/
 * This syncs the team's shared variables to your local environment.
 *
 * The opposite of `vaulter local push --all`.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { withClient } from '../../lib/create-client.js'
import { runLocalSync } from '../../../lib/local-ops.js'
import { c, colorEnv, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { LocalContext } from './index.js'

export async function runLocalSyncCommand(context: LocalContext): Promise<void> {
  const { args, config, dryRun, jsonOutput } = context

  if (!config) {
    print.error('Config required. Run "vaulter init" first.')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  const sourceEnv = args.env as string | undefined

  await withClient({ args, config, project: config.project, verbose: false }, async (client) => {
    const result = await runLocalSync({
      client,
      config,
      configDir,
      sourceEnvironment: sourceEnv,
      dryRun
    })

    if (jsonOutput) {
      ui.output(JSON.stringify({
        sourceEnvironment: result.sourceEnvironment,
        shared: result.shared,
        services: result.services,
        totalSynced: result.totalSynced,
        dryRun: result.dryRun
      }, null, 2))
      return
    }

    if (result.totalSynced === 0) {
      ui.log('No variables to sync from backend')
      return
    }

    if (dryRun) {
      ui.log(c.header(`[DRY RUN] Would sync ${result.totalSynced} var(s) from ${colorEnv(result.sourceEnvironment)}`))
    } else {
      ui.success(`Synced ${result.totalSynced} var(s) from ${colorEnv(result.sourceEnvironment)} to .vaulter/local/`)
    }

    ui.log('')
    ui.log(`  ${c.label('Shared:')} ${result.shared.configs} configs, ${result.shared.secrets} secrets`)

    for (const [svc, counts] of Object.entries(result.services)) {
      ui.log(`  ${c.service(svc)}: ${counts.configs} configs, ${counts.secrets} secrets`)
    }

    if (!dryRun) {
      ui.log('')
      ui.log(c.muted(`Run "${c.command('vaulter local pull --all')}" to generate .env files`))
    }
  })
}
