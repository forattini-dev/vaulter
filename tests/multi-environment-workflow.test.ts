/**
 * Multi-Environment Workflow Tests
 *
 * Tests the complete multi-environment workflows:
 * - Copy between environments (export + sync)
 * - Plan/Apply across multiple environments
 * - Variable consistency patterns (same vs different per env)
 * - Environment isolation guarantees
 * - Cross-environment transfer (move workaround)
 *
 * Uses VaulterClient real with memory:// backend for integration confidence.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { VaulterClient } from '../src/client.js'
import { computePlan } from '../src/domain/plan.js'
import { executePlan } from '../src/domain/apply.js'
import { writeLocalVariable } from '../src/domain/state.js'
import { sharedScope, serviceScope } from '../src/domain/types.js'
import {
  setLocalShared,
  setOverride,
  loadOverrides
} from '../src/lib/local.js'
import { runLocalPull } from '../src/lib/local-ops.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SHARED = '__shared__'
const PASSPHRASE = 'test-key-32-chars-long-exactly!!'

// ==========================================================================
// SECTION 1: Copy Between Environments (export + sync)
// ==========================================================================
describe('Copy Between Environments', () => {
  let client: VaulterClient
  const project = 'multi-copy'

  beforeAll(async () => {
    client = new VaulterClient({
      connectionString: 'memory://multi-env-copy',
      passphrase: PASSPHRASE
    })
    await client.connect()

    // Setup dev environment with shared + service vars
    await client.set({ key: 'DATABASE_URL', value: 'postgres://dev@localhost/db', project, environment: 'dev', service: SHARED, sensitive: true })
    await client.set({ key: 'LOG_LEVEL', value: 'debug', project, environment: 'dev', service: SHARED, sensitive: false })
    await client.set({ key: 'API_KEY', value: 'dev-api-key-123', project, environment: 'dev', service: 'api', sensitive: true })
    await client.set({ key: 'PORT', value: '3000', project, environment: 'dev', service: 'api', sensitive: false })

    // Setup prd with pre-existing vars
    await client.set({ key: 'PRD_ONLY_VAR', value: 'prd-exclusive', project, environment: 'prd', service: SHARED, sensitive: false })
    await client.set({ key: 'LOG_LEVEL', value: 'error', project, environment: 'prd', service: SHARED, sensitive: false })
  }, 30000)

  afterAll(async () => {
    await client.disconnect()
  })

  it('copies vars from dev to prd via export+sync', async () => {
    // Export all shared vars from dev
    const devSharedExport = await client.export(project, 'dev', SHARED)

    // Sync to prd (without deleting missing)
    const syncResult = await client.sync(devSharedExport, project, 'prd', SHARED, { deleteMissing: false })

    expect(syncResult.added).toContain('DATABASE_URL')
    expect(syncResult.updated).toContain('LOG_LEVEL')
    // PRD_ONLY_VAR is not in devSharedExport but deleteMissing=false
    expect(syncResult.deleted).toHaveLength(0)

    // Verify prd now has dev values
    const prdDbUrl = await client.get('DATABASE_URL', project, 'prd', SHARED)
    expect(prdDbUrl!.value).toBe('postgres://dev@localhost/db')

    const prdLogLevel = await client.get('LOG_LEVEL', project, 'prd', SHARED)
    expect(prdLogLevel!.value).toBe('debug')
  })

  it('source environment (dev) is NOT modified after copy', async () => {
    const devDbUrl = await client.get('DATABASE_URL', project, 'dev', SHARED)
    expect(devDbUrl!.value).toBe('postgres://dev@localhost/db')

    const devLogLevel = await client.get('LOG_LEVEL', project, 'dev', SHARED)
    expect(devLogLevel!.value).toBe('debug')

    const devApiKey = await client.get('API_KEY', project, 'dev', 'api')
    expect(devApiKey!.value).toBe('dev-api-key-123')
  })

  it('pre-existing vars in target (prd) are preserved with deleteMissing=false', async () => {
    const prdOnly = await client.get('PRD_ONLY_VAR', project, 'prd', SHARED)
    expect(prdOnly!.value).toBe('prd-exclusive')
  })

  it('copies service-specific vars between environments', async () => {
    // Export api service vars from dev
    const devApiExport = await client.export(project, 'dev', 'api', { includeShared: false })

    // Sync to prd api service
    const syncResult = await client.sync(devApiExport, project, 'prd', 'api')

    expect(syncResult.added).toContain('API_KEY')
    expect(syncResult.added).toContain('PORT')

    // Verify prd api service has dev values
    const prdApiKey = await client.get('API_KEY', project, 'prd', 'api')
    expect(prdApiKey!.value).toBe('dev-api-key-123')

    const prdPort = await client.get('PORT', project, 'prd', 'api')
    expect(prdPort!.value).toBe('3000')
  })
})

// ==========================================================================
// SECTION 2: Plan/Apply Across Multiple Environments
// ==========================================================================
describe('Plan/Apply Across Multiple Environments', () => {
  let tempDir: string
  let configDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-multi-env-plan-'))
    configDir = path.join(tempDir, '.vaulter')
    fs.mkdirSync(path.join(configDir, 'local'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function createMockClient(remoteVars: Array<{
    key: string
    value: string
    service?: string
    sensitive?: boolean
  }> = []) {
    return {
      list: vi.fn().mockResolvedValue(
        remoteVars.map((v, i) => ({
          id: `id-${i}`,
          key: v.key,
          value: v.value,
          project: 'test',
          environment: 'dev',
          service: v.service,
          sensitive: v.sensitive ?? false,
          metadata: {}
        }))
      ),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined)
    } as any
  }

  it('plan for dev shows only dev diff', async () => {
    // Write local vars for dev
    writeLocalVariable(configDir, 'dev', {
      key: 'NEW_DEV_VAR',
      value: 'dev-value',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    const devClient = createMockClient([])
    const devPlan = await computePlan({
      client: devClient,
      config: null,
      configDir,
      project: 'test',
      environment: 'dev',
      stateSource: 'local'
    })

    expect(devPlan.environment).toBe('dev')
    expect(devPlan.summary.toAdd).toBe(1)
    expect(devPlan.changes[0].key).toBe('NEW_DEV_VAR')
    expect(devPlan.changes[0].localValue).toBe('dev-value')
  })

  it('plan for prd shows only prd diff (different remote state)', async () => {
    // Write same local var
    writeLocalVariable(configDir, 'prd', {
      key: 'NEW_DEV_VAR',
      value: 'dev-value',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    // prd already has this var with different value
    const prdClient = createMockClient([
      { key: 'NEW_DEV_VAR', value: 'old-prd-value' }
    ])

    const prdPlan = await computePlan({
      client: prdClient,
      config: null,
      configDir,
      project: 'test',
      environment: 'prd',
      stateSource: 'local'
    })

    expect(prdPlan.environment).toBe('prd')
    expect(prdPlan.summary.toUpdate).toBe(1)
    expect(prdPlan.changes[0].action).toBe('update')
    expect(prdPlan.changes[0].localValue).toBe('dev-value')
    expect(prdPlan.changes[0].remoteValue).toBe('old-prd-value')
  })

  it('apply in dev does not affect prd client', async () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'APPLIED_VAR',
      value: 'applied-to-dev',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    const devClient = createMockClient([])
    const prdClient = createMockClient([])

    const devPlan = await computePlan({
      client: devClient,
      config: null,
      configDir,
      project: 'test',
      environment: 'dev',
      stateSource: 'local'
    })

    const devResult = await executePlan({
      client: devClient,
      plan: devPlan,
      config: null,
      project: 'test'
    })

    expect(devResult.success).toBe(true)
    expect(devResult.applied).toBe(1)
    expect(devClient.set).toHaveBeenCalledTimes(1)
    expect(devClient.set).toHaveBeenCalledWith(expect.objectContaining({
      key: 'APPLIED_VAR',
      value: 'applied-to-dev',
      environment: 'dev'
    }))

    // prd client was never touched
    expect(prdClient.set).not.toHaveBeenCalled()
    expect(prdClient.delete).not.toHaveBeenCalled()
  })

  it('cross-verify: values of dev inaltered after apply in prd', async () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'CROSS_VAR',
      value: 'cross-value',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    const devClient = createMockClient([
      { key: 'CROSS_VAR', value: 'dev-original' }
    ])

    // Plan and apply to prd (with force since prd is a production env)
    const prdClient = createMockClient([])
    const prdPlan = await computePlan({
      client: prdClient,
      config: null,
      configDir,
      project: 'test',
      environment: 'prd',
      stateSource: 'local'
    })

    await executePlan({
      client: prdClient,
      plan: prdPlan,
      config: null,
      project: 'test',
      force: true
    })

    // Dev client state should not have been touched
    expect(devClient.set).not.toHaveBeenCalled()
    expect(devClient.delete).not.toHaveBeenCalled()
  })
})

// ==========================================================================
// SECTION 3: Variable Consistency Patterns (Real-World Scenarios)
// ==========================================================================
describe('Variable Consistency Patterns', () => {
  // ---- 3a: Vars EQUAL across all deployed environments ----
  describe('Same value across all environments', () => {
    let client: VaulterClient
    const project = 'consistency'
    const envs = ['dev', 'prd', 'sdx'] as const

    beforeAll(async () => {
      client = new VaulterClient({
        connectionString: 'memory://consistency-same',
        passphrase: PASSPHRASE
      })
      await client.connect()

      // Same value in all envs
      for (const env of envs) {
        await client.set({ key: 'NODE_ENV', value: 'production', project, environment: env, service: SHARED, sensitive: false })
        await client.set({ key: 'TZ', value: 'UTC', project, environment: env, service: SHARED, sensitive: false })
      }
    }, 30000)

    afterAll(async () => {
      await client.disconnect()
    })

    it('all environments return the same value', async () => {
      for (const env of envs) {
        const nodeEnv = await client.get('NODE_ENV', project, env, SHARED)
        expect(nodeEnv!.value).toBe('production')

        const tz = await client.get('TZ', project, env, SHARED)
        expect(tz!.value).toBe('UTC')
      }
    })

    it('export confirms no diff for standardized keys', async () => {
      const exports = await Promise.all(
        envs.map(env => client.export(project, env, SHARED))
      )

      // All exports should have identical values for these keys
      for (const exp of exports) {
        expect(exp.NODE_ENV).toBe('production')
        expect(exp.TZ).toBe('UTC')
      }
    })
  })

  // ---- 3b: Vars DIFFERENT per environment ----
  describe('Different values per environment', () => {
    let client: VaulterClient
    const project = 'consistency-diff'

    const envValues = {
      dev: { DATABASE_URL: 'postgres://dev@localhost/db', API_KEY: 'dev-key-123' },
      prd: { DATABASE_URL: 'postgres://prd@prod-host/db', API_KEY: 'prd-key-456' },
      sdx: { DATABASE_URL: 'postgres://sdx@sandbox-host/db', API_KEY: 'sdx-key-789' }
    } as const

    beforeAll(async () => {
      client = new VaulterClient({
        connectionString: 'memory://consistency-diff',
        passphrase: PASSPHRASE
      })
      await client.connect()

      for (const [env, vars] of Object.entries(envValues)) {
        await client.set({ key: 'DATABASE_URL', value: vars.DATABASE_URL, project, environment: env, service: SHARED, sensitive: true })
        await client.set({ key: 'API_KEY', value: vars.API_KEY, project, environment: env, service: 'api', sensitive: true })
      }
    }, 30000)

    afterAll(async () => {
      await client.disconnect()
    })

    it('each env returns its own value', async () => {
      for (const [env, expected] of Object.entries(envValues)) {
        const dbUrl = await client.get('DATABASE_URL', project, env, SHARED)
        expect(dbUrl!.value).toBe(expected.DATABASE_URL)

        const apiKey = await client.get('API_KEY', project, env, 'api')
        expect(apiKey!.value).toBe(expected.API_KEY)
      }
    })

    it('export shows differences across environments', async () => {
      const devExport = await client.export(project, 'dev', 'api', { includeShared: true })
      const prdExport = await client.export(project, 'prd', 'api', { includeShared: true })

      expect(devExport.DATABASE_URL).not.toBe(prdExport.DATABASE_URL)
      expect(devExport.API_KEY).not.toBe(prdExport.API_KEY)
      expect(devExport.DATABASE_URL).toContain('localhost')
      expect(prdExport.DATABASE_URL).toContain('prod-host')
    })
  })

  // ---- 3c: Vars different locally but standardized in deploy ----
  describe('Local vs deploy standardized values', () => {
    let tempDir: string
    let configDir: string

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-consistency-'))
      configDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(path.join(configDir, 'local'), { recursive: true })
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('runLocalPull generates different ports per service via local overrides', async () => {
      const config = {
        version: '1' as const,
        project: 'tetis-lair',
        outputs: {
          'svc-auth': { path: 'apps/svc-auth', filename: '.env', service: 'svc-auth' },
          'svc-projects': { path: 'apps/svc-projects', filename: '.env', service: 'svc-projects' }
        }
      }

      // Set different ports per service locally
      setOverride(configDir, 'PORT', '28000', 'svc-auth')
      setOverride(configDir, 'PORT', '28001', 'svc-projects')

      // Shared vars
      setLocalShared(configDir, 'NODE_ENV', 'local')

      const result = await runLocalPull({
        config,
        configDir,
        all: true
      })

      expect(result.files).toHaveLength(2)

      const authFile = result.files.find(f => f.output === 'svc-auth')
      const projectsFile = result.files.find(f => f.output === 'svc-projects')

      expect(authFile!.vars.PORT).toBe('28000')
      expect(projectsFile!.vars.PORT).toBe('28001')

      // Both inherit shared
      expect(authFile!.vars.NODE_ENV).toBe('local')
      expect(projectsFile!.vars.NODE_ENV).toBe('local')
    })

    it('backend has standardized port for all services', async () => {
      const client = new VaulterClient({
        connectionString: 'memory://consistency-deploy',
        passphrase: PASSPHRASE
      })
      await client.connect()

      const project = 'tetis-lair'
      const services = ['svc-auth', 'svc-projects', 'svc-billing']

      // Backend: all services use port 8080
      for (const svc of services) {
        for (const env of ['dev', 'prd', 'sdx']) {
          await client.set({ key: 'PORT', value: '8080', project, environment: env, service: svc, sensitive: false })
        }
      }

      // Verify all services in all envs have 8080
      for (const svc of services) {
        for (const env of ['dev', 'prd', 'sdx']) {
          const port = await client.get('PORT', project, env, svc)
          expect(port!.value).toBe('8080')
        }
      }

      await client.disconnect()
    })
  })
})

// ==========================================================================
// SECTION 4: Environment Isolation Guarantees
// ==========================================================================
describe('Environment Isolation Guarantees', () => {
  let client: VaulterClient
  const project = 'isolation'

  beforeAll(async () => {
    client = new VaulterClient({
      connectionString: 'memory://env-isolation-guarantees',
      passphrase: PASSPHRASE
    })
    await client.connect()
  }, 30000)

  afterAll(async () => {
    await client.disconnect()
  })

  it('set in dev does NOT affect prd', async () => {
    await client.set({ key: 'ISOLATED', value: 'dev-only', project, environment: 'dev', service: SHARED })

    const devVar = await client.get('ISOLATED', project, 'dev', SHARED)
    const prdVar = await client.get('ISOLATED', project, 'prd', SHARED)

    expect(devVar!.value).toBe('dev-only')
    expect(prdVar).toBeNull()
  })

  it('delete in prd does NOT affect dev', async () => {
    await client.set({ key: 'DEL_TEST', value: 'in-dev', project, environment: 'dev', service: SHARED })
    await client.set({ key: 'DEL_TEST', value: 'in-prd', project, environment: 'prd', service: SHARED })

    await client.delete('DEL_TEST', project, 'prd', SHARED)

    const devVar = await client.get('DEL_TEST', project, 'dev', SHARED)
    const prdVar = await client.get('DEL_TEST', project, 'prd', SHARED)

    expect(devVar!.value).toBe('in-dev')
    expect(prdVar).toBeNull()
  })

  it('list for dev returns ONLY vars of dev', async () => {
    await client.set({ key: 'LIST_A', value: 'a-dev', project, environment: 'dev', service: 'api' })
    await client.set({ key: 'LIST_B', value: 'b-dev', project, environment: 'dev', service: 'api' })
    await client.set({ key: 'LIST_C', value: 'c-prd', project, environment: 'prd', service: 'api' })

    const devVars = await client.list({ project, environment: 'dev', service: 'api' })
    const devKeys = devVars.map(v => v.key).sort()

    expect(devKeys).toContain('LIST_A')
    expect(devKeys).toContain('LIST_B')
    expect(devKeys).not.toContain('LIST_C')
  })

  it('bulk set in dev does not leak to prd', async () => {
    await client.set({ key: 'BULK_A', value: 'a', project, environment: 'dev', service: SHARED })
    await client.set({ key: 'BULK_B', value: 'b', project, environment: 'dev', service: SHARED })
    await client.set({ key: 'BULK_C', value: 'c', project, environment: 'dev', service: SHARED })

    const prdVars = await client.list({ project, environment: 'prd', service: SHARED })
    const prdKeys = prdVars.map(v => v.key)

    expect(prdKeys).not.toContain('BULK_A')
    expect(prdKeys).not.toContain('BULK_B')
    expect(prdKeys).not.toContain('BULK_C')

    const devVars = await client.list({ project, environment: 'dev', service: SHARED })
    const devKeys = devVars.map(v => v.key)

    expect(devKeys).toContain('BULK_A')
    expect(devKeys).toContain('BULK_B')
    expect(devKeys).toContain('BULK_C')
  })

  it('concurrent sets in different envs do not interfere', async () => {
    const envs = ['iso-a', 'iso-b', 'iso-c', 'iso-d', 'iso-e']

    await Promise.all(
      envs.map(env =>
        client.set({ key: 'CONCURRENT', value: `value-${env}`, project, environment: env, service: SHARED })
      )
    )

    const results = await Promise.all(
      envs.map(async env => {
        const v = await client.get('CONCURRENT', project, env, SHARED)
        return { env, value: v?.value }
      })
    )

    for (const r of results) {
      expect(r.value).toBe(`value-${r.env}`)
    }
  })
})

// ==========================================================================
// SECTION 5: Cross-Environment Transfer (Move Workaround)
// ==========================================================================
describe('Cross-Environment Transfer (Move Workaround)', () => {
  let client: VaulterClient
  const project = 'transfer'

  beforeAll(async () => {
    client = new VaulterClient({
      connectionString: 'memory://cross-env-transfer',
      passphrase: PASSPHRASE
    })
    await client.connect()
  }, 30000)

  afterAll(async () => {
    await client.disconnect()
  })

  it('move workaround: export(dev) → sync(prd) → deleteAll(dev) transfers vars', async () => {
    // Setup dev with vars
    await client.set({ key: 'MOVE_A', value: 'val-a', project, environment: 'dev', service: SHARED, sensitive: true })
    await client.set({ key: 'MOVE_B', value: 'val-b', project, environment: 'dev', service: SHARED, sensitive: false })
    await client.set({ key: 'MOVE_C', value: 'val-c', project, environment: 'dev', service: 'api', sensitive: true })

    // Step 1: Export all from dev (shared + api)
    const devSharedExport = await client.export(project, 'dev', SHARED)
    const devApiExport = await client.export(project, 'dev', 'api', { includeShared: false })

    // Step 2: Sync to prd
    await client.sync(devSharedExport, project, 'prd', SHARED)
    await client.sync(devApiExport, project, 'prd', 'api')

    // Verify prd has the vars
    const prdA = await client.get('MOVE_A', project, 'prd', SHARED)
    const prdB = await client.get('MOVE_B', project, 'prd', SHARED)
    const prdC = await client.get('MOVE_C', project, 'prd', 'api')

    expect(prdA!.value).toBe('val-a')
    expect(prdB!.value).toBe('val-b')
    expect(prdC!.value).toBe('val-c')

    // Step 3: Delete all from dev
    const deletedShared = await client.deleteAll(project, 'dev', SHARED)
    const deletedApi = await client.deleteAll(project, 'dev', 'api')

    expect(deletedShared).toBeGreaterThanOrEqual(2)
    expect(deletedApi).toBeGreaterThanOrEqual(1)

    // Verify dev is empty
    const devSharedVars = await client.list({ project, environment: 'dev', service: SHARED })
    const devApiVars = await client.list({ project, environment: 'dev', service: 'api' })

    // Filter to only our MOVE_ keys (other tests may have vars in dev)
    const devMoveShared = devSharedVars.filter(v => v.key.startsWith('MOVE_'))
    const devMoveApi = devApiVars.filter(v => v.key.startsWith('MOVE_'))

    expect(devMoveShared).toHaveLength(0)
    expect(devMoveApi).toHaveLength(0)

    // prd still has the vars
    const prdAfterA = await client.get('MOVE_A', project, 'prd', SHARED)
    const prdAfterC = await client.get('MOVE_C', project, 'prd', 'api')
    expect(prdAfterA!.value).toBe('val-a')
    expect(prdAfterC!.value).toBe('val-c')
  })

  it('selective transfer: export → sync only specific keys', async () => {
    // Setup source environment
    await client.set({ key: 'KEEP_IN_SRC', value: 'keep', project, environment: 'stg', service: SHARED })
    await client.set({ key: 'TRANSFER_ME', value: 'transfer', project, environment: 'stg', service: SHARED })
    await client.set({ key: 'ALSO_TRANSFER', value: 'also', project, environment: 'stg', service: SHARED })

    // Export all from stg
    const stgExport = await client.export(project, 'stg', SHARED)

    // Filter: only sync specific keys
    const filtered: Record<string, string> = {}
    for (const [key, value] of Object.entries(stgExport)) {
      if (key === 'TRANSFER_ME' || key === 'ALSO_TRANSFER') {
        filtered[key] = value
      }
    }

    // Sync filtered to sdx
    const syncResult = await client.sync(filtered, project, 'sdx', SHARED)

    expect(syncResult.added).toContain('TRANSFER_ME')
    expect(syncResult.added).toContain('ALSO_TRANSFER')

    // sdx should NOT have KEEP_IN_SRC
    const sdxKeep = await client.get('KEEP_IN_SRC', project, 'sdx', SHARED)
    expect(sdxKeep).toBeNull()

    // stg still has everything
    const stgKeep = await client.get('KEEP_IN_SRC', project, 'stg', SHARED)
    expect(stgKeep!.value).toBe('keep')
  })

  it('sync with deleteMissing=true removes extra vars in target', async () => {
    // Setup target env with extra vars
    await client.set({ key: 'SYNCED_VAR', value: 'original', project, environment: 'sync-target', service: SHARED })
    await client.set({ key: 'EXTRA_VAR', value: 'should-be-removed', project, environment: 'sync-target', service: SHARED })

    // Sync only SYNCED_VAR with deleteMissing=true
    const syncResult = await client.sync(
      { SYNCED_VAR: 'updated' },
      project,
      'sync-target',
      SHARED,
      { deleteMissing: true }
    )

    expect(syncResult.updated).toContain('SYNCED_VAR')
    expect(syncResult.deleted).toContain('EXTRA_VAR')

    // Verify
    const synced = await client.get('SYNCED_VAR', project, 'sync-target', SHARED)
    expect(synced!.value).toBe('updated')

    const extra = await client.get('EXTRA_VAR', project, 'sync-target', SHARED)
    expect(extra).toBeNull()
  })
})
