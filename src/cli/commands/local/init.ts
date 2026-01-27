/**
 * vaulter local init
 *
 * Creates the overrides file and optionally pulls base env as a starting point.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import {
  getOverridesPath,
  saveOverrides,
  resolveBaseEnvironment
} from '../../../lib/local.js'
import { c, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import fs from 'node:fs'
import type { LocalContext } from './index.js'

export async function runLocalInit(context: LocalContext): Promise<void> {
  const { config, service } = context

  if (!config) {
    print.error('Config required. Run "vaulter init" first.')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  const overridesPath = getOverridesPath(configDir, service)

  if (fs.existsSync(overridesPath)) {
    print.warning(`Overrides file already exists: ${c.muted(overridesPath)}`)
    ui.log(`Use ${c.command('vaulter local set')} to add overrides`)
    return
  }

  // Create empty overrides file
  saveOverrides(configDir, {}, service)

  const baseEnv = resolveBaseEnvironment(config)
  ui.success(`Created overrides file: ${c.muted(overridesPath)}`)
  ui.log(`Base environment: ${c.highlight(baseEnv)}`)
  ui.log('')
  ui.log(c.header('Next steps:'))
  ui.log(`  ${c.command('vaulter local set PORT=3001')}     ${c.muted('# Add override')}`)
  ui.log(`  ${c.command('vaulter local pull --all')}        ${c.muted('# Generate .env files')}`)
  ui.log(`  ${c.command('vaulter local diff')}              ${c.muted('# See what\'s overridden')}`)
}
