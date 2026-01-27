/**
 * vaulter snapshot restore
 *
 * Load a snapshot and push its variables to the backend.
 * When no ID is provided, shows an interactive TUI selector.
 */

import { findConfigDir } from '../../../lib/config-loader.js'
import { createSnapshotDriver } from '../../../lib/snapshot.js'
import type { SnapshotInfo } from '../../../lib/snapshot.js'
import { createClientFromConfig } from '../../lib/create-client.js'
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

  const client = await createClientFromConfig({
    args,
    config,
    project,
    environment,
    verbose
  })

  await client.connect()

  const driver = createSnapshotDriver(configDir, config.snapshots, client.getDatabase())

  try {
    let snapshot: SnapshotInfo | null = null
    const id = args._[2]

    if (!id) {
      // Interactive mode: show TUI selector
      const snapshots = await driver.list(environment)
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
      snapshot = await driver.find(id)
      if (!snapshot) {
        print.error(`Snapshot not found: ${id}`)
        ui.log(`List snapshots: ${c.command('vaulter snapshot list')}`)
        process.exit(1)
      }
    }

    // Verify integrity before restoring
    const verification = await driver.verify(snapshot.id)
    if (verification && !verification.valid) {
      print.error(`Snapshot integrity check failed: ${snapshot.id}`)
      ui.log(`  Expected: ${verification.expected}`)
      ui.log(`  Actual:   ${verification.actual}`)
      process.exit(1)
    }

    if (dryRun) {
      // For dry run with s3db driver, we can't know var count without loading
      const vars = await driver.load(snapshot.id)
      const count = vars ? Object.keys(vars).length : snapshot.varsCount
      ui.log(`Would restore ${count} vars from ${c.highlight(snapshot.id)} to ${colorEnv(environment)}`)
      if (jsonOutput) {
        ui.output(JSON.stringify({ snapshot: snapshot.id, environment, vars: vars ? Object.keys(vars) : [] }, null, 2))
      }
      return
    }

    // If the driver supports direct restore (s3db), use it
    if (driver.restore) {
      const count = await driver.restore(snapshot.id, project, environment, service)

      if (jsonOutput) {
        ui.output(JSON.stringify({
          success: true,
          snapshot: snapshot.id,
          environment,
          varsRestored: count
        }, null, 2))
      } else {
        ui.success(`Restored ${count} vars from ${c.highlight(snapshot.id)} to ${colorEnv(environment)}`)
      }
      return
    }

    // Filesystem driver: load + setMany
    const vars = await driver.load(snapshot.id)
    if (!vars) {
      print.error(`Could not load snapshot: ${snapshot.id}`)
      process.exit(1)
    }

    const inputs = Object.entries(vars).map(([key, value]) => ({
      key,
      value,
      project,
      environment,
      service
    }))

    await client.setMany(inputs)

    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        snapshot: snapshot.id,
        environment,
        varsRestored: inputs.length
      }, null, 2))
    } else {
      ui.success(`Restored ${inputs.length} vars from ${c.highlight(snapshot.id)} to ${colorEnv(environment)}`)
    }
  } finally {
    await client.disconnect()
  }
}
