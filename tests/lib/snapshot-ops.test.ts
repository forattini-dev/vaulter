/**
 * Tests for snapshot-ops.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getSnapshotDriver,
  snapshotCreate,
  snapshotList,
  snapshotFind,
  snapshotDelete,
  snapshotRestore,
  snapshotDryRun
} from '../../src/lib/snapshot-ops.js'
import { createSnapshotDriver } from '../../src/lib/snapshot.js'
import type { SnapshotInfo } from '../../src/lib/snapshot.js'

const defaultSnapshot: SnapshotInfo = {
  id: 'snap-1',
  environment: 'dev',
  timestamp: '2026-02-17T00:00:00.000Z',
  dirPath: 'memory://snap-1',
  varsCount: 1,
  checksum: 'abc',
  compression: 'gzip',
  name: null
}

vi.mock('../../src/lib/snapshot.js', async () => {
  const actual = await vi.importActual('../../src/lib/snapshot.js')
  return {
    ...actual,
    createSnapshotDriver: vi.fn()
  }
})

describe('snapshot-ops', () => {
  let root = ''

  beforeEach(() => {
    root = join(tmpdir(), `vaulter-snapshot-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('should get driver with configured config', () => {
    const create = vi.mocked(createSnapshotDriver)
    const client = {
      getDatabase: vi.fn().mockReturnValue({ db: true })
    }

    getSnapshotDriver({
      configDir: root,
      config: { version: '1', project: 'p', snapshots: { enabled: true } as const },
      client
    })

    expect(create).toHaveBeenCalledWith(root, { enabled: true }, { db: true })
  })

  it('should create local and merged snapshots', async () => {
    const create = vi.fn(async () => ({ ...defaultSnapshot, id: 'snap-local' }))
    const driver = {
      create: create as any,
      list: vi.fn(async () => [] as SnapshotInfo[]),
      find: vi.fn(async () => null),
      verify: vi.fn(async () => null),
      load: vi.fn(async () => null),
      delete: vi.fn(async () => false),
      restore: vi.fn(async () => 0),
      count: vi.fn(async () => 0)
    }
    vi.mocked(createSnapshotDriver).mockReturnValue(driver as any)

    mkdirSync(join(root, 'local'), { recursive: true })
    writeFileSync(join(root, 'local', 'configs.env'), 'A=shared\n')
    writeFileSync(join(root, 'local', 'secrets.env'), 'B=secret\n')
    mkdirSync(join(root, 'local', 'services', 'svc-api'), { recursive: true })
    writeFileSync(join(root, 'local', 'services', 'svc-api', 'configs.env'), 'C=service\n')

    const localResult = await snapshotCreate({
      client: { export: vi.fn(async () => ({ C: 'ignored' })) } as any,
      config: { version: '1', project: 'p', snapshots: {} as any },
      configDir: root,
      environment: 'dev',
      source: 'local',
      name: 'local-1'
    })

    expect(localResult.id).toBe('snap-local')
    expect(localResult.source).toBe('local')
    expect(create).toHaveBeenCalledTimes(1)
    const localVars = create.mock.calls[0]?.[1]
    expect(localVars).toEqual({ A: 'shared', B: 'secret' })

    const mergedResult = await snapshotCreate({
      client: {
        export: vi.fn(async () => ({ CLOUD: 'value' }))
      } as any,
      config: { version: '1', project: 'p', snapshots: {} as any },
      configDir: root,
      environment: 'dev',
      source: 'merged',
      name: 'merged-1',
      service: 'svc-api'
    })

    expect(mergedResult.source).toBe('merged')
    expect(create).toHaveBeenCalledTimes(2)
    const createCalls = create.mock.calls
    const mergedVars = createCalls[1]?.[1] ?? {}
    expect(mergedVars).toMatchObject({
      CLOUD: 'value',
      A: 'shared',
      B: 'secret',
      C: 'service'
    })
    const createPayload = createCalls[1]?.[2]
    expect(createPayload).toMatchObject({
      project: 'p',
      service: 'svc-api',
      name: 'merged-1'
    })
  })

  it('should list, find and delete snapshots', async () => {
    const all = [
      { ...defaultSnapshot, id: 'snap-1', name: 'first', varsCount: 1 },
      { ...defaultSnapshot, id: 'snap-2', name: 'second', varsCount: 2 }
    ]

    const driver = {
      create: vi.fn(async () => defaultSnapshot),
      list: vi.fn(async () => all),
      find: vi.fn(async (id: string) => all.find(item => item.id === id) || null),
      verify: vi.fn(async () => null),
      load: vi.fn(async () => ({ X: '1' })),
      delete: vi.fn(async () => true),
      restore: vi.fn(async () => 1),
      count: vi.fn(async () => 2)
    }
    vi.mocked(createSnapshotDriver).mockReturnValue(driver as any)

    const listed = await snapshotList({
      config: { version: '1', project: 'p' },
      configDir: root,
      client: {} as any
    })
    expect(listed).toEqual(all)

    const found = await snapshotFind({
      config: { version: '1', project: 'p' },
      configDir: root,
      idOrPartial: 'snap-2',
      client: {} as any
    })
    expect(found?.id).toBe('snap-2')

    const deleted = await snapshotDelete({
      config: { version: '1', project: 'p' },
      configDir: root,
      idOrPartial: 'snap-1',
      client: {} as any
    })
    expect(deleted.deleted).toBe(true)
    expect(deleted.snapshot?.id).toBe('snap-1')
  })

  it('should create a cloud snapshot by default', async () => {
    const create = vi.fn(async () => ({ ...defaultSnapshot, id: 'snap-cloud' }))
    const client = {
      export: vi.fn(async () => ({ CLOUD: 'value' }))
    }
    const driver = {
      create: create as any,
      list: vi.fn(async () => [] as SnapshotInfo[]),
      find: vi.fn(async () => null),
      verify: vi.fn(async () => null),
      load: vi.fn(async () => null),
      delete: vi.fn(async () => false),
      restore: vi.fn(async () => 0),
      count: vi.fn(async () => 0)
    }
    vi.mocked(createSnapshotDriver).mockReturnValue(driver as any)

    const result = await snapshotCreate({
      client: client as any,
      config: { version: '1', project: 'p', snapshots: {} as any },
      configDir: root,
      environment: 'dev',
      name: 'cloud-default'
    })

    expect(result.source).toBe('cloud')
    expect(create).toHaveBeenCalledWith(
      'dev',
      { CLOUD: 'value' },
      { name: 'cloud-default', project: 'p', service: undefined }
    )
    expect(result.id).toBe('snap-cloud')
  })

  it('should restore using fallback setMany when restore is not supported', async () => {
    const snapshot: SnapshotInfo = { ...defaultSnapshot, id: 'snap-legacy', varsCount: 2 }
    const setMany = vi.fn(async () => undefined)

    const driver = {
      create: vi.fn(async () => snapshot),
      list: vi.fn(async () => [] as SnapshotInfo[]),
      find: vi.fn(async () => snapshot),
      verify: vi.fn(async () => ({ valid: true, expected: 'ok', actual: 'ok' })),
      load: vi.fn(async () => ({ KEY_1: '1', KEY_2: '2' })),
      delete: vi.fn(async () => false),
      count: vi.fn(async () => 0)
    } as any
    vi.mocked(createSnapshotDriver).mockReturnValue(driver)

    const restored = await snapshotRestore({
      client: { setMany } as any,
      config: { version: '1', project: 'p' },
      configDir: root,
      project: 'p',
      environment: 'dev',
      idOrPartial: 'snap-legacy'
    })

    expect(restored.status).toBe('restored')
    expect(setMany).toHaveBeenCalledWith([
      { key: 'KEY_1', value: '1', project: 'p', environment: 'dev', service: undefined },
      { key: 'KEY_2', value: '2', project: 'p', environment: 'dev', service: undefined }
    ])
  })

  it('should restore based on integrity and restore result', async () => {
    const info: SnapshotInfo = { ...defaultSnapshot, id: 'snap-int', varsCount: 3 }
    const verifying = {
      create: vi.fn(async () => info),
      list: vi.fn(async () => [] as SnapshotInfo[]),
      find: vi.fn(async () => info),
      verify: vi.fn(async () => ({ valid: false, expected: 'ok', actual: 'bad' })),
      load: vi.fn(async () => ({ A: '1' })),
      delete: vi.fn(async () => false),
      restore: vi.fn(async () => 0),
      count: vi.fn(async () => 1)
    }
    vi.mocked(createSnapshotDriver).mockReturnValue(verifying as any)

    const failed = await snapshotRestore({
      client: { setMany: vi.fn(async () => undefined) } as any,
      config: { version: '1', project: 'p' },
      configDir: root,
      project: 'p',
      environment: 'dev',
      idOrPartial: 'snap-int'
    })

    expect(failed.status).toBe('integrity_failed')

    const restoring = {
      ...verifying,
      verify: vi.fn(async () => ({ valid: true, expected: 'ok', actual: 'ok' })) as any,
      restore: vi.fn(async () => 3) as any
    } as typeof verifying
    vi.mocked(createSnapshotDriver).mockReturnValue(restoring as any)

    const restored = await snapshotRestore({
      client: { setMany: vi.fn(async () => undefined) } as any,
      config: { version: '1', project: 'p' },
      configDir: root,
      project: 'p',
      environment: 'dev',
      idOrPartial: 'snap-int'
    })

    expect(restored.status).toBe('restored')
    if (restored.status === 'restored') {
      expect(restored.restoredCount).toBe(3)
    }
  })

  it('should fail with error for unknown snapshot source', async () => {
    const create = vi.fn(async () => ({ ...defaultSnapshot, id: 'snap' }))
    const driver = {
      create,
      list: vi.fn(async () => [] as SnapshotInfo[]),
      find: vi.fn(async () => null),
      verify: vi.fn(async () => null),
      load: vi.fn(async () => ({ A: '1' })),
      delete: vi.fn(async () => false),
      count: vi.fn(async () => 0)
    } as any
    vi.mocked(createSnapshotDriver).mockReturnValue(driver)

    await expect(snapshotCreate({
      client: { export: vi.fn(async () => ({ A: '1' })) } as any,
      config: { version: '1', project: 'p', snapshots: {} as any },
      configDir: root,
      environment: 'dev',
      source: 'unknown' as any
    })).rejects.toThrow(/Unknown snapshot source/)
  })

  it('should dry-run and validate snapshot integrity', async () => {
    const snapshot: SnapshotInfo = { ...defaultSnapshot, id: 'snap-dry', varsCount: 2 }

    const driver = {
      create: vi.fn(async () => snapshot),
      list: vi.fn(async () => [] as SnapshotInfo[]),
      find: vi.fn(async () => snapshot),
      verify: vi.fn(async () => ({ valid: false, expected: 'good', actual: 'bad' })),
      load: vi.fn(async () => ({ A: '1', B: '2' })),
      delete: vi.fn(async () => false),
      restore: vi.fn(async () => 0),
      count: vi.fn(async () => 0)
    }
    vi.mocked(createSnapshotDriver).mockReturnValue(driver as any)

    const bad = await snapshotDryRun({
      config: { version: '1', project: 'p' },
      configDir: root,
      snapshot,
      client: {} as any
    })

    expect(bad.status).toBe('integrity_failed')

    const okDriver = {
      ...driver,
      verify: vi.fn(async () => ({ valid: true, expected: 'good', actual: 'good' }))
    }
    vi.mocked(createSnapshotDriver).mockReturnValue(okDriver as any)

    const ok = await snapshotDryRun({
      config: { version: '1', project: 'p' },
      configDir: root,
      snapshot,
      client: {} as any
    })

    expect(ok.status).toBe('ok')
    if (ok.status === 'ok') {
      expect(ok.count).toBe(2)
    }
  })

  it('should fallback snapshotDryRun count to snapshot metadata when vars are missing', async () => {
    const snapshot: SnapshotInfo = { ...defaultSnapshot, id: 'snap-missing', varsCount: 4 }
    const driver = {
      create: vi.fn(async () => snapshot),
      list: vi.fn(async () => [] as SnapshotInfo[]),
      find: vi.fn(async () => snapshot),
      verify: vi.fn(async () => ({ valid: true, expected: 'ok', actual: 'ok' })),
      load: vi.fn(async () => null),
      delete: vi.fn(async () => false),
      restore: vi.fn(async () => 0),
      count: vi.fn(async () => 0)
    }
    vi.mocked(createSnapshotDriver).mockReturnValue(driver as any)

    const result = await snapshotDryRun({
      config: { version: '1', project: 'p' },
      configDir: root,
      snapshot,
      client: {} as any
    })

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.count).toBe(4)
      expect(result.vars).toBeNull()
    }
  })
})
