/**
 * Vaulter CLI - Rollback Command
 *
 * Rollback a variable to a previous version
 */

import type { VarContext } from './var/index.js'
import { c, colorEnv, print } from '../lib/colors.js'
import * as ui from '../ui.js'
import { createClient } from '../../index.js'
import { loadKeyForEnv } from '../../lib/keys.js'

export async function runRollback(context: VarContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput, dryRun } = context

  // Get key and version from positional arguments
  const key = args._[1] as string | undefined
  const versionStr = args._[2] as string | undefined

  if (!key || !versionStr) {
    print.error('Missing variable name or version number')
    ui.log(`${c.label('Usage:')} ${c.command('vaulter var rollback')} ${c.muted('<key> <version>')} ${c.muted('[options]')}`)
    ui.log('')
    ui.log(c.header('Example:'))
    ui.log(`  ${c.command('vaulter var rollback')} ${c.key('API_KEY')} ${c.value('2')} ${c.highlight('-e dev')}`)
    process.exit(1)
  }

  const targetVersion = parseInt(versionStr, 10)
  if (isNaN(targetVersion) || targetVersion < 1) {
    print.error(`Invalid version number: ${versionStr}`)
    ui.log(c.muted('Version must be a positive integer'))
    process.exit(1)
  }

  if (!config?.backend?.url && !config?.backend?.urls) {
    print.error('No backend configured. Run "vaulter init" first')
    process.exit(1)
  }

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

    // Get target version to show user what they're rolling back to
    const versionInfo = await client.getVersion(key, project, environment, targetVersion, service)

    if (!versionInfo) {
      await client.disconnect()
      print.error(`Version ${targetVersion} not found for key ${c.key(key)}`)
      ui.log('')
      ui.log(c.muted(`Run "${c.command(`vaulter var versions ${key} -e ${environment}`)}" to see available versions`))
      process.exit(1)
    }

    // Get current version for comparison
    const current = await client.get(key, project, environment, service)
    const currentVersion = current?.metadata?.currentVersion || 0

    if (dryRun) {
      ui.log('')
      ui.log(`${c.warning('⚠')} DRY RUN - No changes will be made`)
      ui.log('')
      ui.log(`Would rollback ${c.key(key)} ${c.muted(`(${colorEnv(environment)})`)}:`)
      ui.log(`  ${c.muted('From:')} v${currentVersion} → ${c.muted(maskValue(current?.value || ''))}`)
      ui.log(`  ${c.muted('To:')}   v${targetVersion} → ${c.muted(maskValue(versionInfo.value))}`)
      ui.log(`  ${c.muted('User:')} ${versionInfo.user}`)
      ui.log(`  ${c.muted('Date:')} ${formatDate(versionInfo.timestamp)}`)
      await client.disconnect()
      return
    }

    // Perform rollback
    const result = await client.rollback(key, project, environment, targetVersion, service, 'cli')

    await client.disconnect()

    if (jsonOutput) {
      console.log(JSON.stringify({
        key,
        environment,
        rolledBack: true,
        fromVersion: currentVersion,
        toVersion: targetVersion,
        newVersion: result.metadata?.currentVersion
      }))
    } else {
      ui.log('')
      ui.log(`${c.success('✓')} Rolled back ${c.key(key)} ${c.muted(`(${colorEnv(environment)})`)}`)
      ui.log('')
      ui.log(`  ${c.muted('From:')} v${currentVersion}`)
      ui.log(`  ${c.muted('To:')}   v${targetVersion}`)
      ui.log(`  ${c.muted('New:')}  v${result.metadata?.currentVersion} ${c.muted('(rollback operation)')}`)
      ui.log('')
      ui.log(c.muted(`Run "${c.command(`vaulter var versions ${key} -e ${environment}`)}" to see updated history`))
    }
  } catch (error: any) {
    print.error(`Failed to rollback: ${error.message}`)
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
  return date.toISOString().replace('T', ' ').split('.')[0]
}
