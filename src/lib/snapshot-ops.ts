/**
 * Vaulter - Snapshot Ops
 *
 * Shared core logic for snapshot commands (CLI & MCP).
 *
 * Supports three snapshot sources:
 * - cloud: Backup from remote backend (default)
 * - local: Backup from local overrides only
 * - merged: Backup of merged state (cloud + local shared + service overrides)
 */

import type { VaulterClient } from '../client.js'
import type { Environment, VaulterConfig } from '../types.js'
import {
  createSnapshotDriver,
  type SnapshotInfo,
  type SnapshotDriver
} from './snapshot.js'
import {
  loadLocalShared,
  loadOverrides,
  mergeAllLocalVars,
  resolveBaseEnvironment
} from './local.js'
import { findConfigDir } from './config-loader.js'

/** Source for snapshot data */
export type SnapshotSource = 'cloud' | 'local' | 'merged'

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
  /** Source for snapshot: cloud (remote backend), local (local overrides), merged (cloud + local) */
  source?: SnapshotSource
}

export interface SnapshotCreateResult extends SnapshotInfo {
  /** Source used for this snapshot */
  source: SnapshotSource
}

export async function snapshotCreate(options: SnapshotCreateOptions): Promise<SnapshotCreateResult> {
  const { client, config, configDir, environment, service, name, source = 'cloud' } = options
  const driver = options.driver ?? getSnapshotDriver({ configDir, config, client })

  let vars: Record<string, string>
  let snapshotName = name

  switch (source) {
    case 'cloud':
      // Backup from remote backend only
      vars = await client.export(config.project, environment, service)
      snapshotName = snapshotName || `cloud-${environment}`
      break

    case 'local': {
      // Backup from local overrides only
      const localConfigDir = configDir || findConfigDir()
      if (!localConfigDir) {
        throw new Error('Could not find .vaulter/ directory for local snapshot')
      }
      const localShared = loadLocalShared(localConfigDir)
      const serviceOverrides = loadOverrides(localConfigDir, service)
      vars = { ...localShared, ...serviceOverrides }
      snapshotName = snapshotName || `local-${service || 'default'}`
      break
    }

    case 'merged': {
      // Backup merged state: cloud + local shared + service overrides
      const mergedConfigDir = configDir || findConfigDir()
      if (!mergedConfigDir) {
        throw new Error('Could not find .vaulter/ directory for merged snapshot')
      }
      const baseEnv = resolveBaseEnvironment(config)
      const cloudVars = await client.export(config.project, baseEnv, service)
      const localShared = loadLocalShared(mergedConfigDir)
      const serviceOverrides = loadOverrides(mergedConfigDir, service)
      vars = mergeAllLocalVars(cloudVars, localShared, serviceOverrides)
      snapshotName = snapshotName || `merged-${baseEnv}`
      break
    }

    default:
      throw new Error(`Unknown snapshot source: ${source}`)
  }

  const snapshot = await driver.create(environment, vars, {
    name: snapshotName,
    project: config.project,
    service
  })

  return { ...snapshot, source }
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
