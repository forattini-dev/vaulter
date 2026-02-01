/**
 * Vaulter - Snapshot Module
 *
 * Compressed (gzip) snapshots with SHA256 verification and manifest metadata.
 * Supports two drivers:
 * - filesystem (default): local .vaulter/snapshots/<id>/ with data.jsonl.gz + manifest.json
 * - s3db: uses s3db.js BackupPlugin for remote backups
 */

import fs from 'node:fs'
import path from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import type { Environment, SnapshotsConfig } from '../types.js'

// ============================================================================
// Types
// ============================================================================

export interface SnapshotManifest {
  id: string
  environment: string
  project: string | null
  service: string | null
  varsCount: number
  timestamp: string
  checksum: string
  compression: 'gzip'
  name: string | null
}

export interface SnapshotInfo {
  id: string
  environment: string
  timestamp: string
  dirPath: string
  varsCount: number
  checksum: string
  compression: 'gzip'
  name: string | null
}

export interface SnapshotCreateOptions {
  name?: string
  project?: string
  service?: string
}

/**
 * Driver interface for snapshot storage backends.
 */
export interface SnapshotDriver {
  create(environment: string, vars: Record<string, string>, options?: SnapshotCreateOptions): Promise<SnapshotInfo>
  list(environment?: string): Promise<SnapshotInfo[]>
  load(id: string): Promise<Record<string, string> | null>
  delete(id: string): Promise<boolean>
  find(idOrPartial: string): Promise<SnapshotInfo | null>
  verify(id: string): Promise<{ valid: boolean; expected: string; actual: string } | null>
  count(): Promise<number>
  /** For s3db driver: restore directly to the backend (bypasses load+setMany) */
  restore?(id: string, project: string, environment: string, service?: string): Promise<number>
}

// ============================================================================
// Filesystem Driver
// ============================================================================

/**
 * Get the snapshots directory (.vaulter/snapshots/)
 */
export function getSnapshotsDir(configDir: string): string {
  return path.join(configDir, 'snapshots')
}

/**
 * Filesystem-based snapshot driver.
 * Stores snapshots as gzip-compressed JSONL with SHA256 verification.
 */
export class FilesystemSnapshotDriver implements SnapshotDriver {
  constructor(private configDir: string) {}

  async create(
    environment: Environment,
    vars: Record<string, string>,
    options?: SnapshotCreateOptions
  ): Promise<SnapshotInfo> {
    return createSnapshot(this.configDir, environment, vars, options)
  }

  async list(environment?: string): Promise<SnapshotInfo[]> {
    return listSnapshots(this.configDir, environment)
  }

  async load(id: string): Promise<Record<string, string> | null> {
    return loadSnapshot(this.configDir, id)
  }

  async delete(id: string): Promise<boolean> {
    return deleteSnapshot(this.configDir, id)
  }

  async find(idOrPartial: string): Promise<SnapshotInfo | null> {
    return findSnapshot(this.configDir, idOrPartial)
  }

  async verify(id: string): Promise<{ valid: boolean; expected: string; actual: string } | null> {
    return verifySnapshot(this.configDir, id)
  }

  async count(): Promise<number> {
    return getSnapshotCount(this.configDir)
  }
}

// ============================================================================
// S3db Driver
// ============================================================================

/**
 * S3db-based snapshot driver using BackupPlugin.
 *
 * Requires a connected s3db instance (from VaulterClient.getDatabase()).
 */
export class S3dbSnapshotDriver implements SnapshotDriver {
  private backupPlugin: any = null
  private pluginFactory?: () => any

  constructor(private db: any, private s3Path: string = 'vaulter-snapshots/', pluginFactory?: () => any) {
    this.pluginFactory = pluginFactory
  }

  private async getPlugin(): Promise<any> {
    if (this.backupPlugin) return this.backupPlugin

    if (this.pluginFactory) {
      this.backupPlugin = this.pluginFactory()
    } else {
      // s3db.js BackupPlugin - dynamic import hidden from bundlers
      const moduleName = 's3db.js'
      const mod = await (new Function('m', 'return import(m)')(moduleName)) as {
        BackupPlugin?: new (options?: unknown) => unknown
        loadBackupPlugin?: () => Promise<new (options?: unknown) => unknown>
      }
      const BackupPlugin = mod.BackupPlugin || (mod.loadBackupPlugin ? await mod.loadBackupPlugin() : undefined)
      if (!BackupPlugin) {
        throw new Error('BackupPlugin not available in s3db.js export. Update s3db.js or disable s3db snapshots.')
      }
      this.backupPlugin = new BackupPlugin({
        path: this.s3Path,
        compression: 'gzip',
        checksums: true
      })
    }

    // Register plugin with the database
    await this.db.use(this.backupPlugin)
    return this.backupPlugin
  }

  async create(
    environment: Environment,
    vars: Record<string, string>,
    options?: SnapshotCreateOptions
  ): Promise<SnapshotInfo> {
    const plugin = await this.getPlugin()

    const label = options?.name
      ? `${environment}_${options.name}`
      : environment

    const backup = await plugin.backup('full', {
      resources: ['environment-variables'],
      label
    })

    return {
      id: backup.id,
      environment,
      timestamp: backup.timestamp || new Date().toISOString(),
      dirPath: `s3://${this.s3Path}${backup.id}`,
      varsCount: Object.keys(vars).length,
      checksum: backup.checksum || '',
      compression: 'gzip',
      name: options?.name ?? null
    }
  }

  async list(environment?: string): Promise<SnapshotInfo[]> {
    const plugin = await this.getPlugin()
    const backups = await plugin.listBackups()

    const snapshots: SnapshotInfo[] = backups.map((b: any) => ({
      id: b.id,
      environment: b.label?.split('_')[0] || 'unknown',
      timestamp: b.timestamp || b.createdAt || '',
      dirPath: `s3://${this.s3Path}${b.id}`,
      varsCount: b.itemCount || 0,
      checksum: b.checksum || '',
      compression: 'gzip' as const,
      name: b.label?.includes('_') ? b.label.split('_').slice(1).join('_') : null
    }))

    if (environment) {
      return snapshots.filter(s => s.environment === environment)
    }
    return snapshots
  }

  async load(_id: string): Promise<Record<string, string> | null> {
    // s3db BackupPlugin doesn't support reading backup data without restoring.
    // Return null — callers should use restore() directly.
    return null
  }

  async delete(id: string): Promise<boolean> {
    const plugin = await this.getPlugin()
    try {
      await plugin.deleteBackup(id)
      return true
    } catch {
      return false
    }
  }

  async find(idOrPartial: string): Promise<SnapshotInfo | null> {
    const all = await this.list()
    const exact = all.find(s => s.id === idOrPartial)
    if (exact) return exact
    const partial = all.filter(s => s.id.includes(idOrPartial))
    if (partial.length === 1) return partial[0]
    return null
  }

  async verify(id: string): Promise<{ valid: boolean; expected: string; actual: string } | null> {
    const plugin = await this.getPlugin()
    try {
      const status = await plugin.getBackupStatus(id)
      return {
        valid: status.valid ?? true,
        expected: status.checksum || '',
        actual: status.actualChecksum || status.checksum || ''
      }
    } catch {
      return null
    }
  }

  async count(): Promise<number> {
    const all = await this.list()
    return all.length
  }

  /**
   * Restore a backup directly to the s3db backend.
   * This writes data directly — no need for load + setMany.
   */
  async restore(id: string, _project: string, _environment: string, _service?: string): Promise<number> {
    const plugin = await this.getPlugin()
    const result = await plugin.restore(id, {
      resources: ['environment-variables'],
      mode: 'merge'
    })
    return result.restoredCount ?? 0
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a snapshot driver based on config.
 *
 * @param configDir - Path to .vaulter/ directory (required for filesystem driver)
 * @param snapshotsConfig - Snapshots configuration from config.yaml
 * @param db - s3db instance (required for s3db driver, from VaulterClient.getDatabase())
 */
export function createSnapshotDriver(
  configDir: string,
  snapshotsConfig?: SnapshotsConfig,
  db?: any
): SnapshotDriver {
  const driver = snapshotsConfig?.driver || 'filesystem'

  if (driver === 's3db') {
    if (!db) {
      throw new Error('S3db snapshot driver requires a connected database instance. Pass client.getDatabase().')
    }
    const s3Path = snapshotsConfig?.s3_path || 'vaulter-snapshots/'
    return new S3dbSnapshotDriver(db, s3Path)
  }

  return new FilesystemSnapshotDriver(configDir)
}

// ============================================================================
// Path Helpers
// ============================================================================

// (getSnapshotsDir is declared above)

// ============================================================================
// Core Operations (filesystem)
// ============================================================================

/**
 * Serialize vars to JSONL, gzip, compute SHA256, write manifest + data.
 */
export function createSnapshot(
  configDir: string,
  environment: Environment,
  vars: Record<string, string>,
  options?: { name?: string; project?: string; service?: string }
): SnapshotInfo {
  const snapshotsDir = getSnapshotsDir(configDir)

  const now = new Date()
  const timestamp = now.toISOString().replace(/[:.]/g, '-')
  const suffix = options?.name ? `_${options.name}` : ''
  const id = `${environment}_${timestamp}${suffix}`
  const snapshotDir = path.join(snapshotsDir, id)

  fs.mkdirSync(snapshotDir, { recursive: true })

  // Serialize to JSONL
  const jsonlLines = Object.entries(vars)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => JSON.stringify({ key, value }))
  const jsonlBuffer = Buffer.from(jsonlLines.join('\n') + '\n', 'utf-8')

  // Gzip
  const gzipped = gzipSync(jsonlBuffer)

  // SHA256 of the compressed data
  const checksum = 'sha256:' + createHash('sha256').update(gzipped).digest('hex')

  // Write data
  fs.writeFileSync(path.join(snapshotDir, 'data.jsonl.gz'), gzipped)

  // Write manifest
  const manifest: SnapshotManifest = {
    id,
    environment,
    project: options?.project ?? null,
    service: options?.service ?? null,
    varsCount: Object.keys(vars).length,
    timestamp: now.toISOString(),
    checksum,
    compression: 'gzip',
    name: options?.name ?? null
  }
  fs.writeFileSync(
    path.join(snapshotDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8'
  )

  return {
    id,
    environment,
    timestamp: now.toISOString(),
    dirPath: snapshotDir,
    varsCount: manifest.varsCount,
    checksum,
    compression: 'gzip',
    name: options?.name ?? null
  }
}

/**
 * List all snapshots by reading manifest.json from each subdirectory.
 */
export function listSnapshots(configDir: string, environment?: string): SnapshotInfo[] {
  const snapshotsDir = getSnapshotsDir(configDir)
  if (!fs.existsSync(snapshotsDir)) {
    return []
  }

  const entries = fs.readdirSync(snapshotsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
    .reverse() // newest first

  const snapshots: SnapshotInfo[] = []

  for (const dirName of entries) {
    const manifestPath = path.join(snapshotsDir, dirName, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue

    try {
      const manifest: SnapshotManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      if (environment && manifest.environment !== environment) continue

      snapshots.push({
        id: manifest.id,
        environment: manifest.environment,
        timestamp: manifest.timestamp,
        dirPath: path.join(snapshotsDir, dirName),
        varsCount: manifest.varsCount,
        checksum: manifest.checksum,
        compression: manifest.compression,
        name: manifest.name
      })
    } catch {
      // Skip malformed manifests
    }
  }

  return snapshots
}

/**
 * Load a snapshot's variables: gunzip → parse JSONL → Record<string,string>
 */
export function loadSnapshot(configDir: string, id: string): Record<string, string> | null {
  const snapshotDir = path.join(getSnapshotsDir(configDir), id)
  const dataPath = path.join(snapshotDir, 'data.jsonl.gz')
  if (!fs.existsSync(dataPath)) {
    return null
  }

  const gzipped = fs.readFileSync(dataPath)
  const jsonl = gunzipSync(gzipped).toString('utf-8')
  const vars: Record<string, string> = {}

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    const { key, value } = JSON.parse(line)
    vars[key] = value
  }

  return vars
}

/**
 * Delete a snapshot directory by ID.
 */
export function deleteSnapshot(configDir: string, id: string): boolean {
  const snapshotDir = path.join(getSnapshotsDir(configDir), id)
  if (!fs.existsSync(snapshotDir)) {
    return false
  }
  fs.rmSync(snapshotDir, { recursive: true, force: true })
  return true
}

/**
 * Find a snapshot by exact or partial ID match.
 */
export function findSnapshot(configDir: string, idOrPartial: string): SnapshotInfo | null {
  const all = listSnapshots(configDir)
  const exact = all.find(s => s.id === idOrPartial)
  if (exact) return exact
  const partial = all.filter(s => s.id.includes(idOrPartial))
  if (partial.length === 1) return partial[0]
  return null
}

/**
 * Verify a snapshot's integrity by recomputing SHA256 and comparing with manifest.
 */
export function verifySnapshot(configDir: string, id: string): { valid: boolean; expected: string; actual: string } | null {
  const snapshotDir = path.join(getSnapshotsDir(configDir), id)
  const manifestPath = path.join(snapshotDir, 'manifest.json')
  const dataPath = path.join(snapshotDir, 'data.jsonl.gz')

  if (!fs.existsSync(manifestPath) || !fs.existsSync(dataPath)) {
    return null
  }

  const manifest: SnapshotManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const gzipped = fs.readFileSync(dataPath)
  const actual = 'sha256:' + createHash('sha256').update(gzipped).digest('hex')

  return {
    valid: manifest.checksum === actual,
    expected: manifest.checksum,
    actual
  }
}

/**
 * Count snapshots (for local status).
 */
export function getSnapshotCount(configDir: string): number {
  const snapshotsDir = getSnapshotsDir(configDir)
  if (!fs.existsSync(snapshotsDir)) {
    return 0
  }
  return fs.readdirSync(snapshotsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(snapshotsDir, e.name, 'manifest.json')))
    .length
}
