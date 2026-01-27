/**
 * vaulter snapshot delete
 *
 * Remove a snapshot file.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { createSnapshotDriver } from '../../../lib/snapshot.js'
import { createClientFromConfig } from '../../lib/create-client.js'
import { c, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { SnapshotContext } from './index.js'

export async function runSnapshotDelete(context: SnapshotContext): Promise<void> {
  const { args, config, project, environment, verbose } = context

  if (!config) {
    print.error('Config required')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  const id = args._[2]
  if (!id) {
    print.error('Snapshot ID required')
    ui.log(`Usage: ${c.command('vaulter snapshot delete <id>')}`)
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

  const snapshot = await driver.find(id)
  if (!snapshot) {
    print.error(`Snapshot not found: ${id}`)
    process.exit(1)
  }

  const deleted = await driver.delete(snapshot.id)
  if (deleted) {
    ui.success(`Deleted snapshot: ${c.highlight(snapshot.id)}`)
  } else {
    print.error(`Failed to delete snapshot: ${snapshot.id}`)
  }
}
