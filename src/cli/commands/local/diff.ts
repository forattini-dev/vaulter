/**
 * vaulter local diff
 *
 * Show overrides vs base environment.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import {
  loadOverrides,
  diffOverrides,
  resolveBaseEnvironment
} from '../../../lib/local.js'
import { createClientFromConfig } from '../../lib/create-client.js'
import { c, symbols, box, colorEnv, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { LocalContext } from './index.js'

export async function runLocalDiff(context: LocalContext): Promise<void> {
  const { args, config, project, service, verbose, jsonOutput } = context

  if (!config || !project) {
    print.error('Config and project required')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  const baseEnv = resolveBaseEnvironment(config)
  const overrides = loadOverrides(configDir, service)

  if (Object.keys(overrides).length === 0) {
    ui.log('No local overrides. Use `vaulter local set KEY=value` to add some.')
    return
  }

  // Fetch base vars
  const client = await createClientFromConfig({
    args,
    config,
    project,
    environment: baseEnv,
    verbose
  })

  try {
    await client.connect()
    const baseVars = await client.export(config.project, baseEnv, service)
    const diff = diffOverrides(baseVars, overrides)

    if (jsonOutput) {
      ui.output(JSON.stringify({
        baseEnvironment: baseEnv,
        added: diff.added,
        modified: diff.modified.map(k => ({
          key: k,
          base: baseVars[k],
          override: overrides[k]
        })),
        totalOverrides: Object.keys(overrides).length,
        totalBase: Object.keys(baseVars).length
      }, null, 2))
      return
    }

    const width = 55
    const line = box.horizontal.repeat(width)

    ui.log('')
    ui.log(c.muted(`${box.topLeft}${line}${box.topRight}`))
    ui.log(c.muted(box.vertical) + `  ${c.header('Local overrides')} vs base (${colorEnv(baseEnv)})`.padEnd(width + 8) + c.muted(box.vertical))
    ui.log(c.muted(`${box.teeRight}${line}${box.teeLeft}`))

    if (diff.added.length === 0 && diff.modified.length === 0) {
      ui.log(c.muted(box.vertical) + `  ${symbols.success} ${c.success('No overrides')}`.padEnd(width + 12) + c.muted(box.vertical))
    } else {
      for (const key of diff.added) {
        ui.log(c.muted(box.vertical) + `  ${symbols.plus} ${c.key(key)} ${c.added('(new)')} ${c.muted('= ' + overrides[key])}`.padEnd(width + 20) + c.muted(box.vertical))
      }
      for (const key of diff.modified) {
        ui.log(c.muted(box.vertical) + `  ${symbols.tilde} ${c.key(key)} ${c.modified('(override)')}`.padEnd(width + 16) + c.muted(box.vertical))
        ui.log(c.muted(box.vertical) + `      ${c.removed('base:     ' + baseVars[key])}`.padEnd(width + 12) + c.muted(box.vertical))
        ui.log(c.muted(box.vertical) + `      ${c.added('override: ' + overrides[key])}`.padEnd(width + 12) + c.muted(box.vertical))
      }
    }

    ui.log(c.muted(`${box.bottomLeft}${line}${box.bottomRight}`))
    ui.log('')
    ui.log(c.label('Summary:') + ` ${diff.added.length} new, ${diff.modified.length} modified, ${diff.baseOnly.length} base-only`)
  } finally {
    await client.disconnect()
  }
}
