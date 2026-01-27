/**
 * vaulter local delete
 *
 * Remove a local override.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { deleteOverride } from '../../../lib/local.js'
import { c, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { LocalContext } from './index.js'

export async function runLocalDelete(context: LocalContext): Promise<void> {
  const { args, config, service } = context

  if (!config) {
    print.error('Config required. Run "vaulter init" first.')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  const key = args._[2]
  if (!key) {
    print.error('Key required')
    ui.log(`Usage: ${c.command('vaulter local delete KEY')}`)
    process.exit(1)
  }

  const deleted = deleteOverride(configDir, key, service)
  if (deleted) {
    ui.success(`Removed override ${c.key(key)}`)
  } else {
    print.warning(`Override ${c.key(key)} not found`)
  }
}
