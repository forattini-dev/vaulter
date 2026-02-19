/**
 * Tests for local-ops.ts (offline/online local override workflows)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  runLocalPull,
  runLocalPush,
  runLocalPushAll,
  runLocalSync,
  runLocalDiff,
  type LocalPullResult,
  type LocalPushResult,
  type LocalPushAllResult,
  type LocalSyncResult
} from '../../src/lib/local-ops.js'
import {
  getLocalDir,
  setLocalShared,
  setOverride,
  loadLocalSharedConfigs,
  loadLocalSharedSecrets,
  deleteLocalShared,
  loadServiceConfigs,
  loadServiceSecrets,
  loadOverrides,
  getServiceDir
} from '../../src/lib/local.js'

const SHARED_SERVICE = '__shared__'

type MockClient = {
  connect?: () => Promise<void>
  disconnect?: () => Promise<void>
  export: (project: string, environment: string, service?: string) => Promise<Record<string, string>>
  list: (opts: {
    project: string
    environment: string
    service?: string
  }) => Promise<Array<{ key: string; value: string; service?: string; sensitive?: boolean }>>
  set: (input: {
    key: string
    value: string
    project: string
    environment: string
    service?: string
    sensitive?: boolean
  }) => Promise<void>
  setMany: (
    input: Array<{
      key: string
      value: string
      project: string
      environment: string
      service?: string
      sensitive?: boolean
    }>
  ) => Promise<void>
  delete: (key: string, project: string, environment: string, service?: string) => Promise<void>
  deleteManyByKeys: (keys: string[], project: string, environment: string, service?: string) => Promise<{ deleted: string[]; notFound: string[] }>
}

const createConfig = (project: string, outputs?: Record<string, any>) => ({
  version: '1' as const,
  project,
  outputs
})

describe('local-ops', () => {
  let tempDir: string
  let configDir: string
  let oldEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    oldEnv = { ...process.env }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-local-ops-'))
    configDir = path.join(tempDir, '.vaulter')
    fs.mkdirSync(configDir, { recursive: true })
    process.env.VAULTER_KEY = 'test-key'
  })

  afterEach(() => {
    process.env = oldEnv
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('runLocalPull', () => {
    it('validates output/all requirement', async () => {
      const config = createConfig('pull-tests', {
        web: { path: 'apps/web' }
      })

      await expect(
        runLocalPull({ config, configDir, all: false, output: undefined })
      ).rejects.toThrow('Missing output selection: pass output=<name> or all=true')
    })

    it('throws when no outputs are defined', async () => {
      const config = createConfig('pull-tests')

      await expect(
        runLocalPull({ config, configDir, all: true })
      ).rejects.toThrow('No outputs defined in config')
    })

    it('throws when selected output is missing', async () => {
      const config = createConfig('pull-tests', {
        web: { path: 'apps/web' }
      })

      await expect(
        runLocalPull({ config, configDir, output: 'api', all: false })
      ).rejects.toThrow('Output "api" not found.')
    })

    it('generates section-aware files with inherit/service filters and user-vars merge', async () => {
      const config = createConfig('pull-tests', {
        web: { path: 'apps/web', filename: '.env', service: 'api', include: ['APP_*', 'API_*'] },
        job: { path: 'apps/job', filename: '.env', service: 'job', inherit: false }
      })

      setLocalShared(configDir, 'APP_NAME', 'shared')
      setLocalShared(configDir, 'SHARED_SECRET', 'ignore-me', true)

      setOverride(configDir, 'API_TOKEN', 'token', 'api')
      setOverride(configDir, 'APP_NAME', 'api-service', 'api')
      setOverride(configDir, 'JOB_URL', 'https://jobs', 'job')
      setOverride(configDir, 'JOB_SECRET', 'should-hide', 'job')

      const targetPath = path.join(tempDir, 'apps', 'web', '.env')
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.writeFileSync(targetPath, 'USER_ONLY=present\nAPI_TOKEN=legacy\n')

      const result: LocalPullResult = await runLocalPull({
        config,
        configDir,
        all: true
      })

      expect(result.sectionAware).toBe(true)
      expect(result.localSharedCount).toBe(2)
      expect(result.totalServiceVarsCount).toBe(4)
      expect(result.files).toHaveLength(2)

      const webFile = result.files.find(f => f.output === 'web')
      const jobFile = result.files.find(f => f.output === 'job')

      expect(webFile).not.toBeUndefined()
      expect(jobFile).not.toBeUndefined()
      expect(webFile!.vars).toEqual({
        APP_NAME: 'api-service',
        API_TOKEN: 'token'
      })
      expect(jobFile!.vars).toEqual({
        JOB_URL: 'https://jobs',
        JOB_SECRET: 'should-hide'
      })

      expect(webFile!.userVars).toEqual({
        USER_ONLY: 'present',
        API_TOKEN: 'legacy'
      })
      expect(webFile!.totalVarsCount).toBe(webFile!.varsCount + 2)
      expect(webFile!.sharedCount).toBe(2)
      expect(webFile!.serviceCount).toBe(2)
      expect(jobFile!.sharedCount).toBe(0)
      expect(jobFile!.serviceCount).toBe(2)

      const finalText = fs.readFileSync(targetPath, 'utf-8')
      expect(finalText).toContain('USER_ONLY=present')
      expect(finalText).toContain('API_TOKEN=legacy')
      expect(finalText).toContain('APP_NAME=api-service')
    })

    it('respects include/exclude and dry-run mode', async () => {
      const config = createConfig('pull-tests', {
        web: {
          path: 'apps/web',
          filename: '.env',
          service: 'api',
          include: ['*_API'],
          exclude: ['*SECRET*']
        }
      })

      setOverride(configDir, 'API_URL', 'from-service', 'api')
      setOverride(configDir, 'API_SECRET', 'should-filter', 'api')
      setLocalShared(configDir, 'GLOBAL_API', 'shared', false)

      const result: LocalPullResult = await runLocalPull({
        config,
        configDir,
        output: 'web',
        dryRun: true
      })

      const webPath = path.join(tempDir, 'apps', 'web', '.env')
      expect(result.files[0].vars).toEqual({ GLOBAL_API: 'shared' })
      expect(fs.existsSync(webPath)).toBe(false)
    })
  })

  describe('runLocalDiff', () => {
    it('returns no diff when there are no local overrides', async () => {
      const config = createConfig('diff-tests', {
        web: { path: 'apps/web', service: 'api' }
      })
      const client = {
        export: vi.fn(),
        list: vi.fn(),
        set: vi.fn(),
        setMany: vi.fn(),
        delete: vi.fn()
      } as unknown as MockClient

      const result = await runLocalDiff({ client, config, configDir, service: 'api' })

      expect(result.diff).toBeNull()
      expect(result.overrides).toEqual({})
      expect(client.export).not.toHaveBeenCalled()
    })

    it('diffs local overrides against base environment', async () => {
      const config = createConfig('diff-tests', {
        web: { path: 'apps/web', service: 'api' }
      })

      setOverride(configDir, 'API_URL', 'from-local')
      setOverride(configDir, 'NEW', '1')

      const client = {
        export: vi.fn(async () => ({
          API_URL: 'from-remote',
          OTHER: 'value'
        })),
        list: vi.fn(),
        set: vi.fn(),
        setMany: vi.fn(),
        delete: vi.fn()
      } as unknown as MockClient

      const result = await runLocalDiff({ client, config, configDir, service: undefined })

      expect(result.overrides).toMatchObject({
        API_URL: 'from-local',
        NEW: '1'
      })
      expect(result.diff).toMatchObject({
        added: ['NEW'],
        modified: ['API_URL'],
        baseOnly: ['OTHER']
      })
    })
  })

  describe('runLocalPush', () => {
    it('computes added, updated and unchanged correctly', async () => {
      const config = createConfig('push-tests', {
        web: { path: 'apps/web', service: 'api' }
      })

      setOverride(configDir, 'API_URL', 'next', 'api')
      setOverride(configDir, 'API_SECRET', 'sec', 'api', true)

      const client = {
        export: vi.fn(async () => ({
          API_URL: 'old',
          OTHER: 'value'
        })),
        list: vi.fn(async () => [
          { key: 'API_URL', value: 'old', sensitive: true }
        ]),
        setMany: vi.fn(async () => {}),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {})
      } as unknown as MockClient

      const result: LocalPushResult = await runLocalPush({
        client,
        config,
        configDir,
        service: 'api'
      })

      expect(result.sourceEnvironment).toBe('dev')
      expect(result.targetEnvironment).toBe('dev')
      expect(result.added).toEqual([
        { key: 'API_SECRET', value: 'sec', sensitive: true }
      ])
      expect(result.updated).toEqual([
        { key: 'API_URL', oldValue: 'old', newValue: 'next', sensitive: true }
      ])
      expect(result.unchanged).toEqual([])
      expect(result.pushedCount).toBe(2)
      expect(client.setMany).toHaveBeenCalledTimes(1)
    })

    it('supports dry-run without executing mutations', async () => {
      const config = createConfig('push-tests', {
        web: { path: 'apps/web' }
      })

      setOverride(configDir, 'APP', 'value')

      const client = {
        export: vi.fn(async () => ({})),
        list: vi.fn(async () => []),
        setMany: vi.fn(async () => {}),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {})
      } as unknown as MockClient

      const result: LocalPushResult = await runLocalPush({
        client,
        config,
        configDir,
        dryRun: true
      })

      expect(result.dryRun).toBe(true)
      expect(result.added).toEqual([{ key: 'APP', value: 'value', sensitive: false }])
      expect(client.setMany).not.toHaveBeenCalled()
    })

    it('returns no-op when there are no local vars', async () => {
      const config = createConfig('push-tests', {
        web: { path: 'apps/web' }
      })

      const client = {
        export: vi.fn(async () => ({})),
        list: vi.fn(async () => []),
        setMany: vi.fn(async () => {}),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {})
      } as unknown as MockClient

      const result = await runLocalPush({
        client,
        config,
        configDir
      })

      expect(result).toEqual({
        sourceEnvironment: 'dev',
        targetEnvironment: 'dev',
        added: [],
        updated: [],
        unchanged: [],
        pushedCount: 0,
        dryRun: false
      })
      expect(client.export).not.toHaveBeenCalled()
    })

    it('pushes shared vars when shared=true', async () => {
      const config = createConfig('push-tests', {
        web: { path: 'apps/web' }
      })

      setLocalShared(configDir, 'SHARED', 'value')

      const client = {
        export: vi.fn(async () => ({})),
        list: vi.fn(async () => [{ key: 'SHARED', value: 'value', sensitive: true }]),
        setMany: vi.fn(async () => {}),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {})
      } as unknown as MockClient

      const result = await runLocalPush({
        client,
        config,
        configDir,
        shared: true
      })

      expect(result.added).toEqual([
        { key: 'SHARED', value: 'value', sensitive: false }
      ])
      expect(client.setMany).toHaveBeenCalledWith([
        expect.objectContaining({
          key: 'SHARED',
          value: 'value',
          service: SHARED_SERVICE,
          sensitive: false
        })
      ])
    })
  })

  describe('runLocalPushAll', () => {
    it('pushes shared and service overrides with counts', async () => {
      const config = createConfig('push-all-tests', {
        web: { path: 'apps/web' }
      })

      setLocalShared(configDir, 'SHARED', 'value')
      setLocalShared(configDir, 'SHARED_SECRET', 'shared-secret', true)
      setOverride(configDir, 'API_URL', 'api', 'api')
      setOverride(configDir, 'API_SECRET', 'secret', 'api', true)

      const client = {
        export: vi.fn(),
        list: vi.fn(async () => []),
        set: vi.fn(async () => {}),
        setMany: vi.fn(async () => {}),
        delete: vi.fn(async () => {})
      } as unknown as MockClient

      const result: LocalPushAllResult = await runLocalPushAll({
        client,
        config,
        configDir
      })

      expect(result.targetEnvironment).toBe('dev')
      expect(result.shared).toEqual({ configs: 1, secrets: 1 })
      expect(result.services.api).toEqual({ configs: 1, secrets: 1 })
      expect(result.totalPushed).toBe(4)
      // setMany is called once for shared (2 vars) and once for service 'api' (2 vars)
      expect(client.setMany).toHaveBeenCalledTimes(2)
    })

    it('deletes obsolete vars with overwrite mode', async () => {
      const config = createConfig('push-all-tests', {
        web: { path: 'apps/web' }
      })

      setLocalShared(configDir, 'KEEP_SHARED', 'value')
      setOverride(configDir, 'KEEP_API', 'api', 'api')

      const backendVars = [
        { key: 'KEEP_SHARED', value: 'value', service: SHARED_SERVICE },
        { key: 'DUMP', value: 'stale', service: SHARED_SERVICE },
        { key: 'KEEP_API', value: 'api', service: 'api' },
        { key: 'OLD_API', value: 'stale', service: 'api' },
        { key: 'ORPHAN_SERVICE_VAR', value: 'stale', service: 'worker' }
      ]

      const client = {
        export: vi.fn(),
        list: vi.fn(async () => backendVars),
        set: vi.fn(async () => {}),
        setMany: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        deleteManyByKeys: vi.fn(async (keys: string[]) => ({ deleted: [...keys], notFound: [] }))
      } as unknown as MockClient

      const result: LocalPushAllResult = await runLocalPushAll({
        client,
        config,
        configDir,
        overwrite: true
      })

      expect(result.totalDeleted).toBe(3)
      expect(result.deleted.shared).toEqual(['DUMP'])
      expect(result.deleted.services.api).toEqual(['OLD_API'])
      expect(result.deleted.services.worker).toEqual(['ORPHAN_SERVICE_VAR'])
      // deleteManyByKeys called once per scope: shared, api, worker
      expect(client.deleteManyByKeys).toHaveBeenCalledTimes(3)
    })
  })

  describe('runLocalSync', () => {
    it('syncs vars from backend into local files', async () => {
      const config = createConfig('sync-tests', {
        web: { path: 'apps/web' }
      })

      const client = {
        export: vi.fn(),
        list: vi.fn(async ({ service }) => {
          if (service === SHARED_SERVICE) {
            return [
              { key: 'SHARED', value: 'from-shared', sensitive: false },
              { key: 'SHARED_SECRET', value: 'from-secret', sensitive: true }
            ]
          }

          if (!service) {
            return [
              { key: 'SHARED', value: 'from-shared', service: SHARED_SERVICE, sensitive: false },
              { key: 'SHARED_SECRET', value: 'from-secret', service: SHARED_SERVICE, sensitive: true },
              { key: 'API_URL', value: 'api-url', service: 'api', sensitive: false },
              { key: 'API_SECRET', value: 'api-secret', service: 'api', sensitive: true }
            ]
          }

          if (service === 'api') {
            return [
              { key: 'API_URL', value: 'api-url', sensitive: false },
              { key: 'API_SECRET', value: 'api-secret', sensitive: true }
            ]
          }

          return []
        }),
        set: vi.fn(async () => {}),
        setMany: vi.fn(async () => {}),
        delete: vi.fn(async () => {})
      } as unknown as MockClient

      const result: LocalSyncResult = await runLocalSync({
        client,
        config,
        configDir
      })

      expect(result.sourceEnvironment).toBe('dev')
      expect(result.shared).toEqual({ configs: 1, secrets: 1 })
      expect(result.services.api).toEqual({ configs: 1, secrets: 1 })
      expect(result.totalSynced).toBe(4)

      expect(loadLocalSharedConfigs(configDir)).toEqual({ SHARED: 'from-shared' })
      expect(loadLocalSharedSecrets(configDir)).toEqual({ SHARED_SECRET: 'from-secret' })
      expect(loadServiceConfigs(configDir, 'api')).toEqual({ API_URL: 'api-url' })
      expect(loadServiceSecrets(configDir, 'api')).toEqual({ API_SECRET: 'api-secret' })
    })

    it('supports dry-run mode and source env override', async () => {
      const config = createConfig('sync-tests', {
        web: { path: 'apps/web' },
        default_environment: 'stg'
      } as any)

      const client = {
        export: vi.fn(),
        list: vi.fn(async () => []),
        set: vi.fn(async () => {}),
        setMany: vi.fn(async () => {}),
        delete: vi.fn(async () => {})
      } as unknown as MockClient

      const result = await runLocalSync({
        client,
        config,
        configDir,
        sourceEnvironment: 'prd',
        dryRun: true
      })

      expect(result.sourceEnvironment).toBe('prd')
      expect(result.totalSynced).toBe(0)
      expect(loadLocalSharedConfigs(configDir)).toEqual({})
      expect(client.list).toHaveBeenCalledTimes(2)
      expect(client.set).not.toHaveBeenCalled()
    }
    )
  })

  describe('local helpers (cleanup)', () => {
    it('reads local/shared paths and deletes specific keys', () => {
      setLocalShared(configDir, 'SHARED', 'value')
      setLocalShared(configDir, 'SHARED_SECRET', 'secret', true)
      setOverride(configDir, 'SERVICE', 'value', 'api')
      setOverride(configDir, 'SERVICE_SECRET', 'secret', 'api', true)

      const localDir = getLocalDir(configDir)
      const serviceDir = getServiceDir(configDir, 'api')
      expect(fs.existsSync(localDir)).toBe(true)
      expect(fs.existsSync(serviceDir)).toBe(true)

      expect(loadLocalSharedConfigs(configDir)).toEqual({ SHARED: 'value' })
      expect(loadLocalSharedSecrets(configDir)).toEqual({ SHARED_SECRET: 'secret' })
      expect(loadServiceConfigs(configDir, 'api')).toEqual({ SERVICE: 'value' })
      expect(loadServiceSecrets(configDir, 'api')).toEqual({ SERVICE_SECRET: 'secret' })
      expect(loadOverrides(configDir, 'api')).toEqual({ SERVICE: 'value', SERVICE_SECRET: 'secret' })

      expect(deleteLocalShared(configDir, 'SHARED')).toBe(true)
      expect(loadLocalSharedConfigs(configDir)).toEqual({})
      expect(deleteLocalShared(configDir, 'NOPE')).toBe(false)
    })
  })
})
