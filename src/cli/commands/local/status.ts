/**
 * vaulter local status
 *
 * Show local overrides state summary.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { getLocalStatus } from '../../../lib/local.js'
import { c, colorEnv, symbols, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { LocalContext } from './index.js'

export async function runLocalStatus(context: LocalContext): Promise<void> {
  const { config, service, jsonOutput } = context

  if (!config) {
    print.error('Config required')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  const status = getLocalStatus(configDir, config, service)

  if (jsonOutput) {
    ui.output(JSON.stringify(status, null, 2))
    return
  }

  ui.log('')
  ui.log(c.header('Local Status'))
  ui.log('')
  ui.log(`  Base environment:  ${colorEnv(status.baseEnvironment)}`)
  ui.log('')
  ui.log(c.label('  Shared vars (all services):'))
  ui.log(`    File:   ${status.sharedExist ? symbols.success : c.muted('○')} ${c.muted(status.sharedPath)}`)
  ui.log(`    Count:  ${c.highlight(String(status.sharedCount))}`)
  ui.log('')
  ui.log(c.label('  Overrides (service-specific):'))
  ui.log(`    File:   ${status.overridesExist ? symbols.success : c.muted('○')} ${c.muted(status.overridesPath)}`)
  ui.log(`    Count:  ${c.highlight(String(status.overridesCount))}`)
  ui.log('')
  ui.log(`  Snapshots:         ${c.highlight(String(status.snapshotsCount))}`)
  ui.log('')

  if (status.sharedCount === 0 && status.overridesCount === 0) {
    ui.log(c.header('Quick start:'))
    ui.log(`  ${c.command('vaulter local set --shared DEBUG=true')}  ${c.muted('# shared across all services')}`)
    ui.log(`  ${c.command('vaulter local set PORT=3001')}            ${c.muted('# service-specific override')}`)
    ui.log(`  ${c.command('vaulter local pull --all')}               ${c.muted('# generate .env files')}`)
  } else {
    ui.log(`Run ${c.command('vaulter local diff')} to see overrides vs base`)
  }
}
