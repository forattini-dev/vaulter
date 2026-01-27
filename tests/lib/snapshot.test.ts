import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import {
  getSnapshotsDir,
  createSnapshot,
  listSnapshots,
  loadSnapshot,
  deleteSnapshot,
  findSnapshot,
  verifySnapshot,
  getSnapshotCount,
  FilesystemSnapshotDriver,
  S3dbSnapshotDriver,
  createSnapshotDriver
} from '../../src/lib/snapshot.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-snap-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ============================================================================
// Standalone functions (backward compat)
// ============================================================================

describe('getSnapshotsDir', () => {
  it('returns configDir/snapshots', () => {
    expect(getSnapshotsDir('/foo/bar')).toBe(path.join('/foo/bar', 'snapshots'))
  })
})

describe('createSnapshot', () => {
  it('creates data.jsonl.gz and manifest.json', () => {
    const vars = { DB_URL: 'postgres://localhost', API_KEY: 'secret123' }
    const info = createSnapshot(tmpDir, 'dev', vars)

    expect(info.environment).toBe('dev')
    expect(info.varsCount).toBe(2)
    expect(info.compression).toBe('gzip')
    expect(info.checksum).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(info.name).toBeNull()
    expect(info.id).toMatch(/^dev_/)

    const dirPath = info.dirPath
    expect(fs.existsSync(path.join(dirPath, 'data.jsonl.gz'))).toBe(true)
    expect(fs.existsSync(path.join(dirPath, 'manifest.json'))).toBe(true)

    const manifest = JSON.parse(fs.readFileSync(path.join(dirPath, 'manifest.json'), 'utf-8'))
    expect(manifest.id).toBe(info.id)
    expect(manifest.environment).toBe('dev')
    expect(manifest.varsCount).toBe(2)
    expect(manifest.checksum).toBe(info.checksum)
    expect(manifest.compression).toBe('gzip')
    expect(manifest.project).toBeNull()
    expect(manifest.service).toBeNull()
    expect(manifest.name).toBeNull()
  })

  it('accepts name, project, service options', () => {
    const info = createSnapshot(tmpDir, 'prd', { A: '1' }, {
      name: 'pre-deploy',
      project: 'myapp',
      service: 'api'
    })

    expect(info.id).toContain('_pre-deploy')
    expect(info.name).toBe('pre-deploy')

    const manifest = JSON.parse(fs.readFileSync(path.join(info.dirPath, 'manifest.json'), 'utf-8'))
    expect(manifest.project).toBe('myapp')
    expect(manifest.service).toBe('api')
    expect(manifest.name).toBe('pre-deploy')
  })

  it('creates snapshot with empty vars', () => {
    const info = createSnapshot(tmpDir, 'dev', {})
    expect(info.varsCount).toBe(0)
  })
})

describe('listSnapshots', () => {
  it('returns empty array when no snapshots dir', () => {
    expect(listSnapshots(tmpDir)).toEqual([])
  })

  it('returns empty when dir exists but empty', () => {
    fs.mkdirSync(path.join(tmpDir, 'snapshots'), { recursive: true })
    expect(listSnapshots(tmpDir)).toEqual([])
  })

  it('lists all snapshots newest first', () => {
    createSnapshot(tmpDir, 'dev', { A: '1' })
    createSnapshot(tmpDir, 'prd', { B: '2' })

    const all = listSnapshots(tmpDir)
    expect(all.length).toBe(2)
    // newest first (prd was created second)
    expect(all[0].environment).toBe('prd')
    expect(all[1].environment).toBe('dev')
  })

  it('filters by environment', () => {
    createSnapshot(tmpDir, 'dev', { A: '1' })
    createSnapshot(tmpDir, 'prd', { B: '2' })

    expect(listSnapshots(tmpDir, 'dev').length).toBe(1)
    expect(listSnapshots(tmpDir, 'prd').length).toBe(1)
    expect(listSnapshots(tmpDir, 'stg').length).toBe(0)
  })

  it('skips dirs without manifest.json', () => {
    createSnapshot(tmpDir, 'dev', { A: '1' })
    // Create a rogue directory with no manifest
    fs.mkdirSync(path.join(tmpDir, 'snapshots', 'rogue_dir'), { recursive: true })

    expect(listSnapshots(tmpDir).length).toBe(1)
  })

  it('skips malformed manifest.json', () => {
    createSnapshot(tmpDir, 'dev', { A: '1' })
    // Create a dir with bad JSON manifest
    const badDir = path.join(tmpDir, 'snapshots', 'bad_snap')
    fs.mkdirSync(badDir, { recursive: true })
    fs.writeFileSync(path.join(badDir, 'manifest.json'), 'NOT JSON', 'utf-8')

    expect(listSnapshots(tmpDir).length).toBe(1)
  })
})

describe('loadSnapshot', () => {
  it('loads vars from a created snapshot', () => {
    const vars = { X: 'hello', Y: 'world' }
    const info = createSnapshot(tmpDir, 'dev', vars)

    const loaded = loadSnapshot(tmpDir, info.id)
    expect(loaded).toEqual(vars)
  })

  it('returns null for non-existent snapshot', () => {
    expect(loadSnapshot(tmpDir, 'does-not-exist')).toBeNull()
  })
})

describe('deleteSnapshot', () => {
  it('deletes an existing snapshot', () => {
    const info = createSnapshot(tmpDir, 'dev', { A: '1' })
    expect(deleteSnapshot(tmpDir, info.id)).toBe(true)
    expect(fs.existsSync(info.dirPath)).toBe(false)
  })

  it('returns false for non-existent snapshot', () => {
    expect(deleteSnapshot(tmpDir, 'nope')).toBe(false)
  })
})

describe('findSnapshot', () => {
  it('finds by exact id', () => {
    const info = createSnapshot(tmpDir, 'dev', { A: '1' })
    const found = findSnapshot(tmpDir, info.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(info.id)
  })

  it('finds by partial id (unique match)', () => {
    createSnapshot(tmpDir, 'dev', { A: '1' }, { name: 'unique-xyz' })
    const found = findSnapshot(tmpDir, 'unique-xyz')
    expect(found).not.toBeNull()
    expect(found!.name).toBe('unique-xyz')
  })

  it('returns null when no match', () => {
    expect(findSnapshot(tmpDir, 'nonexistent')).toBeNull()
  })

  it('returns null when multiple partial matches', () => {
    createSnapshot(tmpDir, 'dev', { A: '1' }, { name: 'alpha' })
    createSnapshot(tmpDir, 'dev', { B: '2' }, { name: 'beta' })
    // Both contain 'dev_' so partial match is ambiguous
    expect(findSnapshot(tmpDir, 'dev_')).toBeNull()
  })
})

describe('verifySnapshot', () => {
  it('returns valid=true for untampered snapshot', () => {
    const info = createSnapshot(tmpDir, 'dev', { K: 'V' })
    const result = verifySnapshot(tmpDir, info.id)
    expect(result).not.toBeNull()
    expect(result!.valid).toBe(true)
    expect(result!.expected).toBe(result!.actual)
  })

  it('returns valid=false for tampered data', () => {
    const info = createSnapshot(tmpDir, 'dev', { K: 'V' })
    // Tamper with the gzip file
    const dataPath = path.join(info.dirPath, 'data.jsonl.gz')
    const tampered = gzipSync(Buffer.from('{"key":"K","value":"TAMPERED"}\n'))
    fs.writeFileSync(dataPath, tampered)

    const result = verifySnapshot(tmpDir, info.id)
    expect(result).not.toBeNull()
    expect(result!.valid).toBe(false)
    expect(result!.expected).not.toBe(result!.actual)
  })

  it('returns null when manifest missing', () => {
    expect(verifySnapshot(tmpDir, 'nonexistent')).toBeNull()
  })

  it('returns null when data.jsonl.gz missing', () => {
    const info = createSnapshot(tmpDir, 'dev', { K: 'V' })
    fs.unlinkSync(path.join(info.dirPath, 'data.jsonl.gz'))
    expect(verifySnapshot(tmpDir, info.id)).toBeNull()
  })
})

describe('getSnapshotCount', () => {
  it('returns 0 when no snapshots dir', () => {
    expect(getSnapshotCount(tmpDir)).toBe(0)
  })

  it('counts only dirs with manifest.json', () => {
    createSnapshot(tmpDir, 'dev', { A: '1' })
    createSnapshot(tmpDir, 'prd', { B: '2' })
    // Rogue dir without manifest
    fs.mkdirSync(path.join(tmpDir, 'snapshots', 'rogue'), { recursive: true })

    expect(getSnapshotCount(tmpDir)).toBe(2)
  })
})

// ============================================================================
// FilesystemSnapshotDriver
// ============================================================================

describe('FilesystemSnapshotDriver', () => {
  it('implements all SnapshotDriver methods', async () => {
    const driver = new FilesystemSnapshotDriver(tmpDir)

    // create
    const snapshot = await driver.create('dev', { A: '1', B: '2' }, { name: 'test' })
    expect(snapshot.environment).toBe('dev')
    expect(snapshot.varsCount).toBe(2)
    expect(snapshot.name).toBe('test')

    // list
    const all = await driver.list()
    expect(all.length).toBe(1)
    expect(all[0].id).toBe(snapshot.id)

    // list with filter
    expect((await driver.list('dev')).length).toBe(1)
    expect((await driver.list('prd')).length).toBe(0)

    // find
    const found = await driver.find(snapshot.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(snapshot.id)

    // load
    const vars = await driver.load(snapshot.id)
    expect(vars).toEqual({ A: '1', B: '2' })

    // verify
    const verification = await driver.verify(snapshot.id)
    expect(verification).not.toBeNull()
    expect(verification!.valid).toBe(true)

    // count
    expect(await driver.count()).toBe(1)

    // delete
    expect(await driver.delete(snapshot.id)).toBe(true)
    expect(await driver.count()).toBe(0)
  })

  it('does not have restore method', () => {
    const driver = new FilesystemSnapshotDriver(tmpDir)
    expect(driver.restore).toBeUndefined()
  })
})

// ============================================================================
// S3dbSnapshotDriver (mocked)
// ============================================================================

describe('S3dbSnapshotDriver', () => {
  function createMockSetup() {
    const mockPlugin = {
      backup: vi.fn().mockResolvedValue({
        id: 'backup-001',
        timestamp: '2026-01-27T00:00:00.000Z',
        checksum: 'sha256:abc123'
      }),
      listBackups: vi.fn().mockResolvedValue([
        { id: 'backup-001', label: 'dev_test', timestamp: '2026-01-27T00:00:00.000Z', itemCount: 5, checksum: 'sha256:abc123' },
        { id: 'backup-002', label: 'prd', timestamp: '2026-01-26T00:00:00.000Z', itemCount: 3, checksum: 'sha256:def456' }
      ]),
      deleteBackup: vi.fn().mockResolvedValue(undefined),
      getBackupStatus: vi.fn().mockResolvedValue({ valid: true, checksum: 'sha256:abc123' }),
      restore: vi.fn().mockResolvedValue({ restoredCount: 5 })
    }

    const mockDb = {
      use: vi.fn().mockResolvedValue(undefined)
    }

    const pluginFactory = () => mockPlugin

    return { mockDb, mockPlugin, pluginFactory }
  }

  it('creates backup via plugin', async () => {
    const { mockDb, pluginFactory } = createMockSetup()
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    const snapshot = await driver.create('dev', { A: '1' }, { name: 'test' })

    expect(snapshot.id).toBe('backup-001')
    expect(snapshot.environment).toBe('dev')
    expect(snapshot.name).toBe('test')
  })

  it('lists backups from plugin', async () => {
    const { mockDb, pluginFactory } = createMockSetup()
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    const all = await driver.list()
    expect(all.length).toBe(2)
    expect(all[0].id).toBe('backup-001')
    expect(all[0].environment).toBe('dev')
    expect(all[0].name).toBe('test')
    expect(all[1].environment).toBe('prd')
    expect(all[1].name).toBeNull()
  })

  it('filters list by environment', async () => {
    const { mockDb, pluginFactory } = createMockSetup()
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    const devOnly = await driver.list('dev')
    expect(devOnly.length).toBe(1)
    expect(devOnly[0].environment).toBe('dev')

    const stgOnly = await driver.list('stg')
    expect(stgOnly.length).toBe(0)
  })

  it('load returns null (s3db requires restore)', async () => {
    const { mockDb, pluginFactory } = createMockSetup()
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    const result = await driver.load('backup-001')
    expect(result).toBeNull()
  })

  it('finds by exact id', async () => {
    const { mockDb, pluginFactory } = createMockSetup()
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    const found = await driver.find('backup-001')
    expect(found).not.toBeNull()
    expect(found!.id).toBe('backup-001')
  })

  it('finds by partial id', async () => {
    const { mockDb, pluginFactory } = createMockSetup()
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    const found = await driver.find('backup-002')
    expect(found).not.toBeNull()
    expect(found!.id).toBe('backup-002')
  })

  it('returns null when no match', async () => {
    const { mockDb, pluginFactory } = createMockSetup()
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    const found = await driver.find('nonexistent')
    expect(found).toBeNull()
  })

  it('verifies via plugin', async () => {
    const { mockDb, pluginFactory } = createMockSetup()
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    const result = await driver.verify('backup-001')
    expect(result).not.toBeNull()
    expect(result!.valid).toBe(true)
  })

  it('verify returns null on error', async () => {
    const { mockDb, mockPlugin, pluginFactory } = createMockSetup()
    mockPlugin.getBackupStatus.mockRejectedValueOnce(new Error('not found'))
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    const result = await driver.verify('nonexistent')
    expect(result).toBeNull()
  })

  it('deletes via plugin', async () => {
    const { mockDb, pluginFactory } = createMockSetup()
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    const deleted = await driver.delete('backup-001')
    expect(deleted).toBe(true)
  })

  it('delete returns false on error', async () => {
    const { mockDb, mockPlugin, pluginFactory } = createMockSetup()
    mockPlugin.deleteBackup.mockRejectedValueOnce(new Error('not found'))
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    const deleted = await driver.delete('nonexistent')
    expect(deleted).toBe(false)
  })

  it('counts via list', async () => {
    const { mockDb, pluginFactory } = createMockSetup()
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    expect(await driver.count()).toBe(2)
  })

  it('restores via plugin', async () => {
    const { mockDb, mockPlugin, pluginFactory } = createMockSetup()
    const driver = new S3dbSnapshotDriver(mockDb, 'vaulter-snapshots/', pluginFactory)

    const count = await driver.restore!('backup-001', 'myproject', 'dev')
    expect(count).toBe(5)
    expect(mockPlugin.restore).toHaveBeenCalledWith('backup-001', {
      resources: ['environment-variables'],
      mode: 'merge'
    })
  })
})

// ============================================================================
// createSnapshotDriver factory
// ============================================================================

describe('createSnapshotDriver', () => {
  it('returns FilesystemSnapshotDriver by default', () => {
    const driver = createSnapshotDriver(tmpDir)
    expect(driver).toBeInstanceOf(FilesystemSnapshotDriver)
  })

  it('returns FilesystemSnapshotDriver when driver is filesystem', () => {
    const driver = createSnapshotDriver(tmpDir, { driver: 'filesystem' })
    expect(driver).toBeInstanceOf(FilesystemSnapshotDriver)
  })

  it('returns S3dbSnapshotDriver when driver is s3db', () => {
    const mockDb = { use: vi.fn() }
    const driver = createSnapshotDriver(tmpDir, { driver: 's3db' }, mockDb)
    expect(driver).toBeInstanceOf(S3dbSnapshotDriver)
  })

  it('throws when s3db driver but no db provided', () => {
    expect(() => createSnapshotDriver(tmpDir, { driver: 's3db' }))
      .toThrow('S3db snapshot driver requires a connected database instance')
  })

  it('passes s3_path to S3dbSnapshotDriver', () => {
    const mockDb = { use: vi.fn() }
    const driver = createSnapshotDriver(tmpDir, { driver: 's3db', s3_path: 'custom-path/' }, mockDb)
    expect(driver).toBeInstanceOf(S3dbSnapshotDriver)
  })

  it('returns FilesystemSnapshotDriver when config is undefined', () => {
    const driver = createSnapshotDriver(tmpDir, undefined)
    expect(driver).toBeInstanceOf(FilesystemSnapshotDriver)
  })
})
