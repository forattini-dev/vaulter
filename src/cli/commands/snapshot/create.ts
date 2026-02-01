/**
 * vaulter snapshot create
 *
 * Export env vars to a timestamped snapshot file.
 *
 * Sources:
 * - cloud (default): Backup from remote backend
 * - local: Backup from local overrides only
 * - merged: Backup of merged state (cloud + local shared + service overrides)
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { snapshotCreate, type SnapshotSource } from '../../../lib/snapshot-ops.js'
import { withClient } from '../../lib/create-client.js'
import { c, colorEnv, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { SnapshotContext } from './index.js'

const VALID_SOURCES: SnapshotSource[] = ['cloud', 'local', 'merged']

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
  const sourceArg = (args.source as string | undefined) || 'cloud'

  if (!VALID_SOURCES.includes(sourceArg as SnapshotSource)) {
    print.error(`Invalid source: ${sourceArg}. Valid sources: ${VALID_SOURCES.join(', ')}`)
    process.exit(1)
  }

  const source = sourceArg as SnapshotSource

  await withClient({ args, config, project, environment, verbose }, async (client) => {
    const snapshot = await snapshotCreate({
      client,
      config,
      configDir,
      environment,
      service,
      name,
      source
    })

    if (jsonOutput) {
      ui.output(JSON.stringify(snapshot, null, 2))
    } else {
      ui.success(`Snapshot created: ${c.highlight(snapshot.id)}`)
      ui.log(`  Source:      ${c.highlight(source)}`)
      ui.log(`  Environment: ${colorEnv(environment)}`)
      ui.log(`  Variables:   ${snapshot.varsCount}`)
      ui.log(`  Checksum:    ${c.muted(snapshot.checksum)}`)
      ui.log(`  Path:        ${c.muted(snapshot.dirPath)}`)
    }
  })
}
