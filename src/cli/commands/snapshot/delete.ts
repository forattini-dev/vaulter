/**
 * vaulter snapshot delete
 *
 * Remove a snapshot file.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { getSnapshotDriver, snapshotDelete } from '../../../lib/snapshot-ops.js'
import { createClientFromConfig } from '../../lib/create-client.js'
import type { VaulterClient } from '../../../client.js'
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
  let client: VaulterClient | null = null

  if (isS3db) {
    client = await createClientFromConfig({ args, config, project: project || config.project, environment, verbose })
    try {
      await client.connect()
    } catch (err) {
      print.error(`Failed to connect: ${(err as Error).message}`)
      process.exit(1)
    }
  }

  try {
    const driver = getSnapshotDriver({ configDir, config, client: client ?? undefined })
    const result = await snapshotDelete({
      config,
      configDir,
      idOrPartial: id,
      client: client ?? undefined,
      driver
    })

    if (!result.snapshot) {
      print.error(`Snapshot not found: ${id}`)
      process.exit(1)
    }

    if (result.deleted) {
      ui.success(`Deleted snapshot: ${c.highlight(result.snapshot.id)}`)
    } else {
      print.error(`Failed to delete snapshot: ${result.snapshot.id}`)
    }
  } finally {
    if (client) {
      await client.disconnect()
    }
  }
}
