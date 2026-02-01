/**
 * vaulter snapshot restore
 *
 * Load a snapshot and push its variables to the backend.
 * When no ID is provided, shows an interactive TUI selector.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { getSnapshotDriver, snapshotDryRun, snapshotFind, snapshotList, snapshotRestore } from '../../../lib/snapshot-ops.js'
import type { SnapshotInfo } from '../../../lib/snapshot.js'
import { withClient } from '../../lib/create-client.js'
import { c, colorEnv, print } from '../../lib/colors.js'
import * as ui from '../../ui.js'
import type { SnapshotContext } from './index.js'

/**
 * Interactive snapshot picker using tuiuiu.js Select
 */
async function pickSnapshot(snapshots: SnapshotInfo[]): Promise<SnapshotInfo | null> {
  const { render, Box, Text, Select, useApp } = await import('tuiuiu.js')

  let resolved = false

  return new Promise<SnapshotInfo | null>((resolve) => {
    const items = snapshots.map(s => ({
      value: s.id,
      label: `${s.id}`,
      description: `${s.environment} | ${s.varsCount} vars | ${s.timestamp}`
    }))

    function Picker() {
      const app = useApp()

      // Handle Ctrl+C / early exit
      app.onExit(() => {
        if (!resolved) {
          resolved = true
          resolve(null)
        }
      })

      return Box(
        { flexDirection: 'column', gap: 1, padding: 1 },
        Text({ color: 'primary', bold: true }, 'Select a snapshot to restore:'),
        Box(
          { width: 80 },
          Select({
            items,
            maxVisible: 10,
            onChange: (val) => {
              if (!resolved) {
                resolved = true
                const selected = snapshots.find(s => s.id === val)
                app.exit()
                resolve(selected ?? null)
              }
            },
            cursorIndicator: '▸',
            colorActive: 'primary'
          })
        ),
        Text({ color: 'muted', dim: true }, 'Use ↑↓ to navigate, Enter to select, Ctrl+C to cancel')
      )
    }

    render(Picker)
  })
}

export async function runSnapshotRestore(context: SnapshotContext): Promise<void> {
  const { args, config, project, service, environment, verbose, dryRun, jsonOutput } = context

  if (!config || !project) {
    print.error('Config and project required')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }

  await withClient({ args, config, project, environment, verbose }, async (client) => {
    const driver = getSnapshotDriver({ configDir, config, client })

    let snapshot: SnapshotInfo | null = null
    const id = args._[2]

    if (!id) {
      // Interactive mode: show TUI selector
      const snapshots = await snapshotList({ config, configDir, environment, client, driver })
      if (snapshots.length === 0) {
        print.error('No snapshots found')
        ui.log(`Create one: ${c.command('vaulter snapshot create -e ' + environment)}`)
        process.exit(1)
      }

      snapshot = await pickSnapshot(snapshots)
      if (!snapshot) {
        ui.log('Cancelled.')
        return
      }
    } else {
      snapshot = await snapshotFind({ config, configDir, idOrPartial: id, client, driver })
      if (!snapshot) {
        print.error(`Snapshot not found: ${id}`)
        ui.log(`List snapshots: ${c.command('vaulter snapshot list')}`)
        process.exit(1)
      }
    }

    if (dryRun) {
      const result = await snapshotDryRun({ config, configDir, snapshot, client, driver })

      if (result.status === 'integrity_failed') {
        print.error(`Snapshot integrity check failed: ${snapshot.id}`)
        ui.log(`  Expected: ${result.expected}`)
        ui.log(`  Actual:   ${result.actual}`)
        process.exit(1)
      }

      ui.log(`Would restore ${result.count} vars from ${c.highlight(snapshot.id)} to ${colorEnv(environment)}`)
      if (jsonOutput) {
        ui.output(JSON.stringify({ snapshot: snapshot.id, environment, vars: result.vars ? Object.keys(result.vars) : [] }, null, 2))
      }
      return
    }

    const restoreResult = await snapshotRestore({
      client,
      config,
      configDir,
      project,
      environment,
      service,
      idOrPartial: snapshot.id,
      snapshot,
      driver
    })

    if (restoreResult.status === 'not_found') {
      print.error(`Snapshot not found: ${snapshot.id}`)
      process.exit(1)
    }
    if (restoreResult.status === 'integrity_failed') {
      print.error(`Snapshot integrity check failed: ${restoreResult.snapshot.id}`)
      ui.log(`  Expected: ${restoreResult.expected}`)
      ui.log(`  Actual:   ${restoreResult.actual}`)
      process.exit(1)
    }
    if (restoreResult.status === 'load_failed') {
      print.error(`Could not load snapshot: ${restoreResult.snapshot.id}`)
      process.exit(1)
    }

    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        snapshot: restoreResult.snapshot.id,
        environment,
        varsRestored: restoreResult.restoredCount
      }, null, 2))
    } else {
      ui.success(`Restored ${restoreResult.restoredCount} vars from ${c.highlight(restoreResult.snapshot.id)} to ${colorEnv(environment)}`)
    }
  })
}
