/**
 * vaulter snapshot list
 *
 * List all snapshots, optionally filtered by environment.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { createSnapshotDriver } from '../../../lib/snapshot.js'
import { createClientFromConfig } from '../../lib/create-client.js'
import { c, colorEnv, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { SnapshotContext } from './index.js'

export async function runSnapshotList(context: SnapshotContext): Promise<void> {
  const { args, config, project, environment, verbose, jsonOutput } = context

  if (!config) {
    print.error('Config required')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  const isS3db = config.snapshots?.driver === 's3db'
  let driver

  if (isS3db) {
    const client = await createClientFromConfig({ args, config, project: project || config.project, environment, verbose })
    try {
      await client.connect()
      driver = createSnapshotDriver(configDir, config.snapshots, client.getDatabase())
    } catch (err) {
      print.error(`Failed to connect: ${(err as Error).message}`)
      process.exit(1)
    }
  } else {
    driver = createSnapshotDriver(configDir, config.snapshots)
  }

  // Use -e flag to filter, otherwise show all
  const filterEnv = args.env ? environment : undefined
  const snapshots = await driver.list(filterEnv)

  if (jsonOutput) {
    ui.output(JSON.stringify(snapshots, null, 2))
    return
  }

  if (snapshots.length === 0) {
    ui.log('No snapshots found.')
    ui.log(`Create one: ${c.command('vaulter snapshot create -e dev')}`)
    return
  }

  ui.log('')
  ui.log(c.header(`Snapshots${filterEnv ? ` (${colorEnv(filterEnv)})` : ''}:`))
  ui.log('')

  for (const snap of snapshots) {
    ui.log(`  ${c.highlight(snap.id)}`)
    ui.log(`    env: ${colorEnv(snap.environment)}  vars: ${snap.varsCount}  ${snap.compression}  ${c.muted(snap.timestamp)}`)
    ui.log(`    checksum: ${c.muted(snap.checksum)}`)
  }

  ui.log('')
  ui.log(`Restore: ${c.command('vaulter snapshot restore <id> -e <env>')}`)
}
