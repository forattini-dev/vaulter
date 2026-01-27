/**
 * vaulter local set
 *
 * Add/update local overrides. Supports KEY=val and KEY::val syntax.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { setOverride, getOverridesPath } from '../../../lib/local.js'
import { c, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { LocalContext } from './index.js'

export async function runLocalSet(context: LocalContext): Promise<void> {
  const { args, config, service, secrets = {}, configs = {} } = context

  if (!config) {
    print.error('Config required. Run "vaulter init" first.')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  // Collect variables from separator buckets and positional args
  const vars: Array<{ key: string; value: string }> = []

  // From separator syntax: KEY=val (secrets) and KEY::val (configs)
  for (const [key, value] of Object.entries(secrets)) {
    vars.push({ key, value: String(value) })
  }
  for (const [key, value] of Object.entries(configs)) {
    vars.push({ key, value: String(value) })
  }

  // Fallback: positional args KEY=VALUE
  for (const arg of args._.slice(2)) {
    const eqIdx = arg.indexOf('=')
    if (eqIdx > 0) {
      vars.push({ key: arg.substring(0, eqIdx), value: arg.substring(eqIdx + 1) })
    }
  }

  if (vars.length === 0) {
    print.error('No variables specified')
    ui.log(`Usage: ${c.command('vaulter local set KEY=value KEY2::value2')}`)
    process.exit(1)
  }

  for (const { key, value } of vars) {
    setOverride(configDir, key, value, service)
    ui.success(`Set override ${c.key(key)}`)
  }

  if (vars.length > 1) {
    ui.log(`${c.muted(`${vars.length} overrides saved to ${getOverridesPath(configDir, service)}`)}`)
  }
}
