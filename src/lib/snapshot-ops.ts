/**
 * Vaulter - Snapshot Ops
 *
 * Shared core logic for snapshot commands (CLI & MCP).
 */

import type { VaulterClient } from '../client.js'
import type { Environment, VaulterConfig } from '../types.js'
import {
  createSnapshotDriver,
  type SnapshotInfo,
  type SnapshotDriver
} from './snapshot.js'

export interface SnapshotDriverOptions {
  configDir: string
  config: VaulterConfig
  client?: VaulterClient
}

export function getSnapshotDriver(options: SnapshotDriverOptions): SnapshotDriver {
  const { configDir, config, client } = options
  return createSnapshotDriver(configDir, config.snapshots, client?.getDatabase())
}

export interface SnapshotCreateOptions {
  client: VaulterClient
  config: VaulterConfig
  configDir: string
  environment: Environment
  service?: string
  name?: string
  driver?: SnapshotDriver
}

export async function snapshotCreate(options: SnapshotCreateOptions): Promise<SnapshotInfo> {
  const { client, config, configDir, environment, service, name } = options
  const vars = await client.export(config.project, environment, service)
  const driver = options.driver ?? getSnapshotDriver({ configDir, config, client })
  return driver.create(environment, vars, { name, project: config.project, service })
}

export interface SnapshotListOptions {
  config: VaulterConfig
  configDir: string
  environment?: Environment
  client?: VaulterClient
  driver?: SnapshotDriver
}

export async function snapshotList(options: SnapshotListOptions): Promise<SnapshotInfo[]> {
  const { config, configDir, environment, client } = options
  const driver = options.driver ?? getSnapshotDriver({ configDir, config, client })
  return driver.list(environment)
}

export interface SnapshotFindOptions {
  config: VaulterConfig
  configDir: string
  idOrPartial: string
  client?: VaulterClient
  driver?: SnapshotDriver
}

export async function snapshotFind(options: SnapshotFindOptions): Promise<SnapshotInfo | null> {
  const { config, configDir, idOrPartial, client } = options
  const driver = options.driver ?? getSnapshotDriver({ configDir, config, client })
  return driver.find(idOrPartial)
}

export interface SnapshotDeleteOptions {
  config: VaulterConfig
  configDir: string
  idOrPartial: string
  client?: VaulterClient
  driver?: SnapshotDriver
}

export interface SnapshotDeleteResult {
  snapshot: SnapshotInfo | null
  deleted: boolean
}

export async function snapshotDelete(options: SnapshotDeleteOptions): Promise<SnapshotDeleteResult> {
  const { config, configDir, idOrPartial, client } = options
  const driver = options.driver ?? getSnapshotDriver({ configDir, config, client })
  const snapshot = await driver.find(idOrPartial)
  if (!snapshot) {
    return { snapshot: null, deleted: false }
  }
  const deleted = await driver.delete(snapshot.id)
  return { snapshot, deleted }
}

export interface SnapshotRestoreOptions {
  client: VaulterClient
  config: VaulterConfig
  configDir: string
  project: string
  environment: Environment
  service?: string
  idOrPartial: string
  /** Pre-resolved snapshot to skip redundant find() */
  snapshot?: SnapshotInfo
  driver?: SnapshotDriver
}

export type SnapshotRestoreResult =
  | {
      status: 'not_found'
    }
  | {
      status: 'integrity_failed'
      snapshot: SnapshotInfo
      expected: string
      actual: string
    }
  | {
      status: 'load_failed'
      snapshot: SnapshotInfo
    }
  | {
      status: 'restored'
      snapshot: SnapshotInfo
      restoredCount: number
    }

export async function snapshotRestore(options: SnapshotRestoreOptions): Promise<SnapshotRestoreResult> {
  const { client, config, configDir, project, environment, service, idOrPartial } = options
  const driver = options.driver ?? getSnapshotDriver({ configDir, config, client })

  const snapshot = options.snapshot ?? await driver.find(idOrPartial)
  if (!snapshot) {
    return { status: 'not_found' }
  }

  const verification = await driver.verify(snapshot.id)
  if (verification && !verification.valid) {
    return {
      status: 'integrity_failed',
      snapshot,
      expected: verification.expected,
      actual: verification.actual
    }
  }

  if (driver.restore) {
    const restoredCount = await driver.restore(snapshot.id, project, environment, service)
    return { status: 'restored', snapshot, restoredCount }
  }

  const vars = await driver.load(snapshot.id)
  if (!vars) {
    return { status: 'load_failed', snapshot }
  }

  const inputs = Object.entries(vars).map(([key, value]) => ({
    key,
    value,
    project,
    environment,
    service
  }))

  await client.setMany(inputs)

  return { status: 'restored', snapshot, restoredCount: inputs.length }
}

/** Dry-run: verify + load without restoring */
export interface SnapshotDryRunOptions {
  config: VaulterConfig
  configDir: string
  snapshot: SnapshotInfo
  client?: VaulterClient
  driver?: SnapshotDriver
}

export type SnapshotDryRunResult =
  | { status: 'integrity_failed'; expected: string; actual: string }
  | { status: 'ok'; vars: Record<string, string> | null; count: number }

export async function snapshotDryRun(options: SnapshotDryRunOptions): Promise<SnapshotDryRunResult> {
  const { config, configDir, snapshot, client } = options
  const driver = options.driver ?? getSnapshotDriver({ configDir, config, client })

  const verification = await driver.verify(snapshot.id)
  if (verification && !verification.valid) {
    return { status: 'integrity_failed', expected: verification.expected, actual: verification.actual }
  }

  const vars = await driver.load(snapshot.id)
  const count = vars ? Object.keys(vars).length : snapshot.varsCount

  return { status: 'ok', vars, count }
}
