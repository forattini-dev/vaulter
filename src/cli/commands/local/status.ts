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
  ui.log(`  Overrides file:    ${status.overridesExist ? symbols.success : symbols.error} ${c.muted(status.overridesPath)}`)
  ui.log(`  Overrides count:   ${c.highlight(String(status.overridesCount))}`)
  ui.log(`  Snapshots:         ${c.highlight(String(status.snapshotsCount))}`)
  ui.log('')

  if (!status.overridesExist) {
    ui.log(`Run ${c.command('vaulter local init')} to get started`)
  } else if (status.overridesCount === 0) {
    ui.log(`Run ${c.command('vaulter local set KEY=value')} to add overrides`)
  } else {
    ui.log(`Run ${c.command('vaulter local diff')} to see overrides vs base`)
  }
}
