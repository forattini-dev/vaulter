/**
 * vaulter local init
 *
 * Creates the overrides directory structure.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import {
  getServiceDir,
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

  const serviceDir = getServiceDir(configDir, service)

  if (fs.existsSync(serviceDir)) {
    print.warning(`Local overrides directory already exists: ${c.muted(serviceDir)}`)
    ui.log(`Use ${c.command('vaulter local set')} to add overrides`)
    return
  }

  // Create the directory structure
  fs.mkdirSync(serviceDir, { recursive: true })

  const baseEnv = resolveBaseEnvironment(config)
  ui.success(`Created local directory: ${c.muted(serviceDir)}`)
  ui.log(`Base environment: ${c.highlight(baseEnv)}`)
  ui.log('')
  ui.log(c.header('Next steps:'))
  ui.log(`  ${c.command('vaulter local set PORT::3001')}     ${c.muted('# Add config')}`)
  ui.log(`  ${c.command('vaulter local set API_KEY=xxx')}    ${c.muted('# Add secret')}`)
  ui.log(`  ${c.command('vaulter local pull --all')}         ${c.muted('# Generate .env files')}`)
  ui.log(`  ${c.command('vaulter local diff')}               ${c.muted('# See what\'s overridden')}`)
}
