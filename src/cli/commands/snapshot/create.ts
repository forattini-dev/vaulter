/**
 * vaulter snapshot create
 *
 * Export current env vars to a timestamped snapshot file.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { snapshotCreate } from '../../../lib/snapshot-ops.js'
import { createClientFromConfig } from '../../lib/create-client.js'
import { c, colorEnv, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { SnapshotContext } from './index.js'

export async function runSnapshotCreate(context: SnapshotContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  if (!config || !project) {
    print.error('Config and project required')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  const name = args.name as string | undefined

  const client = await createClientFromConfig({
    args,
    config,
    project,
    environment,
    verbose
  })

  try {
    await client.connect()
    const snapshot = await snapshotCreate({
      client,
      config,
      configDir,
      environment,
      service,
      name
    })

    if (jsonOutput) {
      ui.output(JSON.stringify(snapshot, null, 2))
    } else {
      ui.success(`Snapshot created: ${c.highlight(snapshot.id)}`)
      ui.log(`  Environment: ${colorEnv(environment)}`)
      ui.log(`  Variables:   ${snapshot.varsCount}`)
      ui.log(`  Checksum:    ${c.muted(snapshot.checksum)}`)
      ui.log(`  Path:        ${c.muted(snapshot.dirPath)}`)
    }
  } finally {
    await client.disconnect()
  }
}
