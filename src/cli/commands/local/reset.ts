/**
 * vaulter local reset
 *
 * Clear all local overrides.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { resetOverrides, resetShared, getServiceDir, getSharedDir } from '../../../lib/local.js'
import { c, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { LocalContext } from './index.js'

export async function runLocalReset(context: LocalContext): Promise<void> {
  const { args, config, service } = context

  if (!config) {
    print.error('Config required')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  const isShared = args.shared as boolean | undefined
  const all = args.all as boolean | undefined

  if (all) {
    // Reset everything
    resetShared(configDir)
    resetOverrides(configDir, service)
    ui.success('All local overrides cleared (shared + service)')
    ui.log(c.muted(`Deleted: ${getSharedDir(configDir)}/*, ${getServiceDir(configDir, service)}/*`))
    return
  }

  if (isShared) {
    resetShared(configDir)
    ui.success('Local shared vars cleared')
    ui.log(c.muted(`Deleted: ${getSharedDir(configDir)}/configs.env, secrets.env`))
    return
  }

  // Default: reset service overrides only
  resetOverrides(configDir, service)
  ui.success('Local overrides cleared')
  if (service) {
    ui.log(c.muted(`Deleted: ${getServiceDir(configDir, service)}/configs.env, secrets.env`))
  } else {
    ui.log(c.muted(`Deleted: ${getServiceDir(configDir)}/configs.env, secrets.env`))
  }
}
