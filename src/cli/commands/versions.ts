/**
 * Vaulter CLI - Versions Command
 *
 * List version history for a variable
 */

import type { VarContext } from './var/index.js'
import { c, colorEnv, print } from '../lib/colors.js'
import * as ui from '../ui.js'
import { createClient } from '../../index.js'
import { loadKeyForEnv } from '../../lib/keys.js'

export async function runVersions(context: VarContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  // Get key from positional argument
  const key = args._[1] as string | undefined

  if (!key) {
    print.error('Missing variable name')
    ui.log(`${c.label('Usage:')} ${c.command('vaulter var versions')} ${c.muted('<key>')} ${c.muted('[options]')}`)
    process.exit(1)
  }

  if (!config?.backend?.url && !config?.backend?.urls) {
    print.error('No backend configured. Run "vaulter init" first')
    process.exit(1)
  }

  const showValues = args.values || false

  try {
    // Load encryption key for environment
    const keyResult = await loadKeyForEnv({
      project,
      environment,
      config: config || undefined
    })

    // Create client
    const client = createClient({
      connectionStrings: config.backend.urls || [config.backend.url!],
      passphrase: keyResult.key || '',
      config: config || undefined,
      verbose
    })

    await client.connect()

    // Get version history
    const versions = await client.listVersions(key, project, environment, service)

    await client.disconnect()

    if (versions.length === 0) {
      if (jsonOutput) {
        console.log(JSON.stringify({ key, versions: [] }))
      } else {
        ui.log('')
        ui.log(`${c.warning('⚠')} No version history found for ${c.key(key)}`)
        ui.log('')
        if (config.versioning?.enabled) {
          ui.log(c.muted('This variable may not have versioning enabled,'))
          ui.log(c.muted('or it may not exist in the current environment.'))
        } else {
          ui.log(c.muted('Versioning is not enabled in config.yaml'))
          ui.log(c.muted('Add versioning.enabled: true to enable version tracking'))
        }
      }
      return
    }

    if (jsonOutput) {
      // JSON output - mask values unless --values specified
      const output = versions.map(v => ({
        version: v.version,
        value: showValues ? v.value : maskValue(v.value),
        timestamp: v.timestamp,
        user: v.user,
        source: v.source,
        operation: v.operation,
        checksum: v.checksum
      }))
      console.log(JSON.stringify({ key, environment, versions: output }, null, 2))
    } else {
      // Pretty output
      ui.log('')
      ui.log(`${c.success('●')} Version History: ${c.key(key)} ${c.muted(`(${colorEnv(environment)})`)}`)
      ui.log('')

      for (const v of versions) {
        const isCurrent = v.version === versions[0].version
        const marker = isCurrent ? c.success('●') : c.muted('○')
        const verLabel = isCurrent ? c.highlight(`v${v.version} (current)`) : c.muted(`v${v.version}`)

        ui.log(`${marker} ${verLabel}`)
        ui.log(`  ${c.muted('└─')} ${formatDate(v.timestamp)} ${c.muted('─')} ${c.value(v.user)}`)
        ui.log(`     ${c.muted('Operation:')} ${formatOperation(v.operation)} ${c.muted('Source:')} ${v.source}`)

        if (showValues) {
          ui.log(`     ${c.muted('Value:')} ${c.value(v.value)}`)
        } else {
          ui.log(`     ${c.muted('Value:')} ${c.muted(maskValue(v.value))}`)
        }

        ui.log(`     ${c.muted('Checksum:')} ${c.muted(v.checksum.slice(0, 16))}...`)
        ui.log('')
      }

      ui.log(c.muted(`Total versions: ${versions.length}`))

      if (!showValues) {
        ui.log('')
        ui.log(c.muted(`Use ${c.highlight('--values')} to show decrypted values`))
      }
    }
  } catch (error: any) {
    print.error(`Failed to list versions: ${error.message}`)
    if (verbose) {
      console.error(error)
    }
    process.exit(1)
  }
}

function maskValue(value: string): string {
  if (value.length <= 8) return '***'
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

function formatDate(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffHours < 1) return c.muted('just now')
  if (diffHours < 24) return c.muted(`${diffHours}h ago`)
  if (diffDays < 7) return c.muted(`${diffDays}d ago`)

  return c.muted(date.toISOString().split('T')[0])
}

function formatOperation(op: string): string {
  const colors: Record<string, (s: string) => string> = {
    set: c.info,
    rotate: c.warning,
    rollback: c.highlight,
    copy: c.muted,
    rename: c.muted
  }
  return (colors[op] || c.muted)(op)
}
