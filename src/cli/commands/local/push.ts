/**
 * vaulter local push
 *
 * Push local overrides to the remote backend.
 * This allows sharing local development configs with the team.
 *
 * Modes:
 * - --all: Push entire .vaulter/local/ structure (shared + all services)
 * - --shared: Push only shared vars
 * - -s <service>: Push only service-specific vars
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { withClient } from '../../lib/create-client.js'
import { runLocalPush, runLocalPushAll } from '../../../lib/local-ops.js'
import { maskValue } from '../../../lib/masking.js'
import { validateLocalServiceScope } from '../../../lib/local.js'
import { c, colorEnv, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { LocalContext } from './index.js'

export async function runLocalPushCommand(context: LocalContext): Promise<void> {
  const { args, config, service, dryRun, jsonOutput } = context

  if (!config) {
    print.error('Config required. Run "vaulter init" first.')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  const isAll = args.all as boolean | undefined
  const isShared = args.shared as boolean | undefined
  const targetEnv = args.env as string | undefined
  const isOverwrite = args.overwrite as boolean | undefined

  const scopeCheck = validateLocalServiceScope({
    config,
    service,
    shared: isAll || isShared,
    command: 'vaulter local push'
  })
  if (!scopeCheck.ok) {
    print.error(scopeCheck.error)
    ui.log(`Hint: ${scopeCheck.hint}`)
    process.exit(1)
  }

  // --all mode: push entire .vaulter/local/ structure
  if (isAll) {
    await runLocalPushAllMode(context, configDir, targetEnv, isOverwrite)
    return
  }

  await withClient({ args, config, project: config.project, verbose: false }, async (client) => {
    const result = await runLocalPush({
      client,
      config,
      configDir,
      service,
      shared: isShared,
      dryRun,
      targetEnvironment: targetEnv
    })

    if (jsonOutput) {
      console.log(JSON.stringify({
        sourceEnvironment: result.sourceEnvironment,
        targetEnvironment: result.targetEnvironment,
        added: result.added.map(v => ({ key: v.key, sensitive: v.sensitive })),
        updated: result.updated.map(v => ({ key: v.key, sensitive: v.sensitive })),
        unchanged: result.unchanged,
        pushedCount: result.pushedCount,
        dryRun: result.dryRun
      }, null, 2))
      return
    }

    const source = isShared ? 'shared' : service ? `service: ${service}` : 'local'

    if (result.pushedCount === 0) {
      ui.log(`No changes to push (${source})`)
      if (result.unchanged.length > 0) {
        ui.log(c.muted(`  ${result.unchanged.length} vars already in sync`))
      }
      return
    }

    if (dryRun) {
      ui.log(c.header(`[DRY RUN] Would push ${result.pushedCount} var(s) to ${colorEnv(result.targetEnvironment)}`))
    } else {
      ui.success(`Pushed ${result.pushedCount} var(s) to ${colorEnv(result.targetEnvironment)}`)
    }

    ui.log('')

    // Show added
    if (result.added.length > 0) {
      ui.log(c.label(`  Added (${result.added.length}):`))
      for (const v of result.added) {
        const type = v.sensitive ? c.secret('secret') : c.config('config')
        const maskedValue = v.sensitive ? maskValue(v.value) : v.value
        ui.log(`    ${c.success('+')} ${c.key(v.key)} = ${maskedValue} (${type})`)
      }
    }

    // Show updated
    if (result.updated.length > 0) {
      ui.log(c.label(`  Updated (${result.updated.length}):`))
      for (const v of result.updated) {
        const type = v.sensitive ? c.secret('secret') : c.config('config')
        const maskedOld = v.sensitive ? maskValue(v.oldValue) : v.oldValue
        const maskedNew = v.sensitive ? maskValue(v.newValue) : v.newValue
        ui.log(`    ${c.warning('~')} ${c.key(v.key)} (${type})`)
        ui.log(`      ${c.muted('was:')} ${maskedOld}`)
        ui.log(`      ${c.muted('now:')} ${maskedNew}`)
      }
    }

    // Show unchanged count
    if (result.unchanged.length > 0) {
      ui.log('')
      ui.log(c.muted(`  ${result.unchanged.length} var(s) unchanged`))
    }

    ui.log('')
    if (dryRun) {
      ui.log(`Run without ${c.command('--dry-run')} to apply changes`)
    } else {
      ui.log(c.muted(`Source: ${source} → Target: ${result.targetEnvironment}`))
    }
  })
}

/**
 * Push entire .vaulter/local/ structure to backend
 */
async function runLocalPushAllMode(
  context: LocalContext,
  configDir: string,
  targetEnv?: string,
  overwrite?: boolean
): Promise<void> {
  const { args, config, dryRun, jsonOutput } = context

  if (!config) {
    print.error('Config required')
    process.exit(1)
  }

  await withClient({ args, config, project: config.project, verbose: false }, async (client) => {
    const result = await runLocalPushAll({
      client,
      config,
      configDir,
      dryRun,
      targetEnvironment: targetEnv,
      overwrite
    })

    if (jsonOutput) {
      ui.output(JSON.stringify({
        targetEnvironment: result.targetEnvironment,
        shared: result.shared,
        services: result.services,
        totalPushed: result.totalPushed,
        totalDeleted: result.totalDeleted,
        deleted: result.deleted,
        dryRun: result.dryRun
      }, null, 2))
      return
    }

    if (result.totalPushed === 0 && result.totalDeleted === 0) {
      ui.log('No changes to make')
      return
    }

    if (dryRun) {
      const parts: string[] = []
      if (result.totalPushed > 0) parts.push(`push ${result.totalPushed}`)
      if (result.totalDeleted > 0) parts.push(`${c.removed(`delete ${result.totalDeleted}`)}`)
      ui.log(c.header(`[DRY RUN] Would ${parts.join(', ')} var(s) in ${colorEnv(result.targetEnvironment)}`))
    } else {
      const parts: string[] = []
      if (result.totalPushed > 0) parts.push(`pushed ${result.totalPushed}`)
      if (result.totalDeleted > 0) parts.push(`deleted ${result.totalDeleted}`)
      ui.success(`${parts.join(', ')} var(s) in ${colorEnv(result.targetEnvironment)}`)
    }

    ui.log('')
    ui.log(`  ${c.label('Shared:')} ${result.shared.configs} configs, ${result.shared.secrets} secrets`)

    for (const [svc, counts] of Object.entries(result.services)) {
      ui.log(`  ${c.service(svc)}: ${counts.configs} configs, ${counts.secrets} secrets`)
    }

    // Show deleted vars if any
    if (result.totalDeleted > 0) {
      ui.log('')
      ui.log(c.removed(`  Deleted from backend (${result.totalDeleted}):`))
      if (result.deleted.shared.length > 0) {
        ui.log(`    ${c.label('Shared:')} ${result.deleted.shared.join(', ')}`)
      }
      for (const [svc, keys] of Object.entries(result.deleted.services)) {
        if (keys.length > 0) {
          ui.log(`    ${c.service(svc)}: ${keys.join(', ')}`)
        }
      }
    }

    ui.log('')
    if (dryRun) {
      ui.log(`Run without ${c.command('--dry-run')} to apply changes`)
    }
  })
}
