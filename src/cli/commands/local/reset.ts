/**
 * vaulter local reset
 *
 * Clear all local overrides.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { resetOverrides, getOverridesPath } from '../../../lib/local.js'
import { c, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { LocalContext } from './index.js'

export async function runLocalReset(context: LocalContext): Promise<void> {
  const { config, service } = context

  if (!config) {
    print.error('Config required')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  resetOverrides(configDir, service)
  ui.success('Local overrides cleared')
  ui.log(c.muted(`Deleted: ${getOverridesPath(configDir, service)}`))
}
