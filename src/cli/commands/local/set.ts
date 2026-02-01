/**
 * vaulter local set
 *
 * Add/update local overrides. Supports KEY=val and KEY::val syntax.
 * - KEY=val  → secrets.env (sensitive=true)
 * - KEY::val → configs.env  (sensitive=false)
 *
 * Use --shared to set vars in .vaulter/local/shared/ (shared across all services)
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import {
  setOverride,
  setLocalShared,
  getServiceConfigPath,
  getServiceSecretsPath,
  getSharedConfigPath,
  getSharedSecretsPath
} from '../../../lib/local.js'
import { c, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { LocalContext } from './index.js'

interface VarToSet {
  key: string
  value: string
  sensitive: boolean
}

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

  const isShared = args.shared as boolean | undefined

  // Collect variables from separator buckets and positional args
  const vars: VarToSet[] = []

  // From separator syntax: KEY=val (secrets) and KEY::val (configs)
  for (const [key, value] of Object.entries(secrets)) {
    vars.push({ key, value: String(value), sensitive: true })
  }
  for (const [key, value] of Object.entries(configs)) {
    vars.push({ key, value: String(value), sensitive: false })
  }

  // Fallback: positional args KEY=VALUE (treated as secrets by default, like CLI)
  for (const arg of args._.slice(2)) {
    const argStr = String(arg)

    // Check for :: separator first (config)
    const colonIdx = argStr.indexOf('::')
    if (colonIdx > 0) {
      vars.push({
        key: argStr.substring(0, colonIdx),
        value: argStr.substring(colonIdx + 2),
        sensitive: false
      })
      continue
    }

    // Check for = separator (secret)
    const eqIdx = argStr.indexOf('=')
    if (eqIdx > 0) {
      vars.push({
        key: argStr.substring(0, eqIdx),
        value: argStr.substring(eqIdx + 1),
        sensitive: true
      })
    }
  }

  if (vars.length === 0) {
    print.error('No variables specified')
    ui.log('')
    ui.log(`${c.label('Usage:')}`)
    ui.log(`  ${c.command('vaulter local set KEY=value')}        ${c.muted('# → secrets.env (sensitive)')}`)
    ui.log(`  ${c.command('vaulter local set KEY::value')}       ${c.muted('# → configs.env (not sensitive)')}`)
    ui.log('')
    ui.log(`  ${c.command('vaulter local set --shared DEBUG::true')}  ${c.muted('# shared config')}`)
    ui.log(`  ${c.command('vaulter local set --shared TOKEN=xxx')}    ${c.muted('# shared secret')}`)
    ui.log('')
    ui.log(`  ${c.command('vaulter local set -s web PORT::3000')}     ${c.muted('# service-specific config')}`)
    process.exit(1)
  }

  // Track files written to for summary
  const filesWritten = new Map<string, { count: number; type: 'config' | 'secrets' }>()

  for (const { key, value, sensitive } of vars) {
    if (isShared) {
      setLocalShared(configDir, key, value, sensitive)
      const targetPath = sensitive
        ? getSharedSecretsPath(configDir)
        : getSharedConfigPath(configDir)
      const type = sensitive ? 'secrets' : 'config'
      ui.success(`Set shared ${type} ${c.key(key)}`)

      const existing = filesWritten.get(targetPath) || { count: 0, type }
      filesWritten.set(targetPath, { count: existing.count + 1, type })
    } else {
      setOverride(configDir, key, value, service, sensitive)
      const targetPath = sensitive
        ? getServiceSecretsPath(configDir, service)
        : getServiceConfigPath(configDir, service)
      const type = sensitive ? 'secrets' : 'config'
      ui.success(`Set ${type} ${c.key(key)}`)

      const existing = filesWritten.get(targetPath) || { count: 0, type }
      filesWritten.set(targetPath, { count: existing.count + 1, type })
    }
  }

  // Summary
  if (vars.length > 1 || filesWritten.size > 1) {
    ui.log('')
    ui.log(c.muted('Files updated:'))
    for (const [filePath, info] of filesWritten) {
      ui.log(`  ${c.muted(filePath)} (${info.count} ${info.type})`)
    }
  }
}
