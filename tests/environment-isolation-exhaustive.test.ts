/**
 * Exhaustive Environment Isolation Tests
 *
 * Tests all interactions between:
 * - Shared vars (configs & secrets) across environments (dev, stg, prd)
 * - Service-specific overrides of shared vars
 * - Local overrides layered on top
 * - Sensitive flag (secret vs config) isolation
 *
 * These tests ensure NO leakage between environments, services, or sensitivity levels.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { VaulterClient } from '../src/client.js'
import {
  loadOverrides,
  saveOverrides,
  mergeWithOverrides,
  diffOverrides,
  resetOverrides
} from '../src/lib/local.js'
import { resolveVariables } from '../src/lib/shared.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SHARED = '__shared__'

// Helper to generate unique test IDs to avoid state conflicts
let testIdCounter = 0
const uniqueId = () => `t${++testIdCounter}`

// ==========================================================================
// SECTION 1: Shared Vars Environment Isolation
// ==========================================================================
describe('Shared Vars Environment Isolation', () => {
  let client: VaulterClient
  const project = 'iso-shared'
  const prefix = 'se'

  beforeAll(async () => {
    client = new VaulterClient({
      connectionString: 'memory://shared-env-isolation',
      passphrase: 'test-key-32-chars-long-exactly!!'
    })
    await client.connect()

    // Setup: same key names, different values per environment
    // Using sequential sets to avoid concurrency issues
    await client.set({ key: 'LOG_LEVEL', value: 'debug', project, environment: `${prefix}-dev`, service: SHARED, sensitive: false })
    await client.set({ key: 'LOG_LEVEL', value: 'info', project, environment: `${prefix}-stg`, service: SHARED, sensitive: false })
    await client.set({ key: 'LOG_LEVEL', value: 'error', project, environment: `${prefix}-prd`, service: SHARED, sensitive: false })

    await client.set({ key: 'DB_PASSWORD', value: 'dev-pass-123', project, environment: `${prefix}-dev`, service: SHARED, sensitive: true })
    await client.set({ key: 'DB_PASSWORD', value: 'stg-pass-456', project, environment: `${prefix}-stg`, service: SHARED, sensitive: true })
    await client.set({ key: 'DB_PASSWORD', value: 'prd-pass-789', project, environment: `${prefix}-prd`, service: SHARED, sensitive: true })

    await client.set({ key: 'DEV_ONLY_VAR', value: 'dev-exclusive', project, environment: `${prefix}-dev`, service: SHARED, sensitive: false })
    await client.set({ key: 'PRD_ONLY_SECRET', value: 'prd-exclusive-secret', project, environment: `${prefix}-prd`, service: SHARED, sensitive: true })
  }, 30000)

  afterAll(async () => {
    await client.disconnect()
  })

  it('shared CONFIG is isolated by environment', async () => {
    const devVar = await client.get('LOG_LEVEL', project, `${prefix}-dev`, SHARED)
    const stgVar = await client.get('LOG_LEVEL', project, `${prefix}-stg`, SHARED)
    const prdVar = await client.get('LOG_LEVEL', project, `${prefix}-prd`, SHARED)

    expect(devVar!.value).toBe('debug')
    expect(stgVar!.value).toBe('info')
    expect(prdVar!.value).toBe('error')

    expect(devVar!.sensitive).toBe(false)
    expect(stgVar!.sensitive).toBe(false)
    expect(prdVar!.sensitive).toBe(false)
  })

  it('shared SECRET is isolated by environment', async () => {
    const devVar = await client.get('DB_PASSWORD', project, `${prefix}-dev`, SHARED)
    const stgVar = await client.get('DB_PASSWORD', project, `${prefix}-stg`, SHARED)
    const prdVar = await client.get('DB_PASSWORD', project, `${prefix}-prd`, SHARED)

    expect(devVar!.value).toBe('dev-pass-123')
    expect(stgVar!.value).toBe('stg-pass-456')
    expect(prdVar!.value).toBe('prd-pass-789')

    expect(devVar!.sensitive).toBe(true)
    expect(stgVar!.sensitive).toBe(true)
    expect(prdVar!.sensitive).toBe(true)
  })

  it('environment-exclusive vars do not leak to other environments', async () => {
    const devOnly_dev = await client.get('DEV_ONLY_VAR', project, `${prefix}-dev`, SHARED)
    const devOnly_stg = await client.get('DEV_ONLY_VAR', project, `${prefix}-stg`, SHARED)
    const devOnly_prd = await client.get('DEV_ONLY_VAR', project, `${prefix}-prd`, SHARED)

    expect(devOnly_dev!.value).toBe('dev-exclusive')
    expect(devOnly_stg).toBeNull()
    expect(devOnly_prd).toBeNull()

    const prdOnly_dev = await client.get('PRD_ONLY_SECRET', project, `${prefix}-dev`, SHARED)
    const prdOnly_stg = await client.get('PRD_ONLY_SECRET', project, `${prefix}-stg`, SHARED)
    const prdOnly_prd = await client.get('PRD_ONLY_SECRET', project, `${prefix}-prd`, SHARED)

    expect(prdOnly_dev).toBeNull()
    expect(prdOnly_stg).toBeNull()
    expect(prdOnly_prd!.value).toBe('prd-exclusive-secret')
    expect(prdOnly_prd!.sensitive).toBe(true)
  })

  it('list() returns only vars for requested environment', async () => {
    const devVars = await client.list({ project, environment: `${prefix}-dev`, service: SHARED })
    const stgVars = await client.list({ project, environment: `${prefix}-stg`, service: SHARED })
    const prdVars = await client.list({ project, environment: `${prefix}-prd`, service: SHARED })

    expect(devVars.length).toBe(3)
    expect(devVars.map(v => v.key).sort()).toEqual(['DB_PASSWORD', 'DEV_ONLY_VAR', 'LOG_LEVEL'])

    expect(stgVars.length).toBe(2)
    expect(stgVars.map(v => v.key).sort()).toEqual(['DB_PASSWORD', 'LOG_LEVEL'])

    expect(prdVars.length).toBe(3)
    expect(prdVars.map(v => v.key).sort()).toEqual(['DB_PASSWORD', 'LOG_LEVEL', 'PRD_ONLY_SECRET'])
  })

  it('export() for service includes only shared vars from THAT environment', async () => {
    await client.set({ key: 'SVC_VAR', value: 'api-dev', project, environment: `${prefix}-dev`, service: 'api' })

    const devExport = await client.export(project, `${prefix}-dev`, 'api', { includeShared: true })
    const prdExport = await client.export(project, `${prefix}-prd`, 'api', { includeShared: true })

    expect(devExport.LOG_LEVEL).toBe('debug')
    expect(devExport.DB_PASSWORD).toBe('dev-pass-123')
    expect(devExport.DEV_ONLY_VAR).toBe('dev-exclusive')
    expect(devExport.SVC_VAR).toBe('api-dev')

    expect(prdExport.LOG_LEVEL).toBe('error')
    expect(prdExport.DB_PASSWORD).toBe('prd-pass-789')
    expect(prdExport.PRD_ONLY_SECRET).toBe('prd-exclusive-secret')
    expect(prdExport.DEV_ONLY_VAR).toBeUndefined()
    expect(prdExport.SVC_VAR).toBeUndefined()
  })
})

// ==========================================================================
// SECTION 2: Service Override of Shared Vars
// ==========================================================================
describe('Service Override of Shared Vars', () => {
  let client: VaulterClient
  const project = 'iso-svc'
  const env = 'svc'

  beforeAll(async () => {
    client = new VaulterClient({
      connectionString: 'memory://service-override-isolation',
      passphrase: 'test-key-32-chars-long-exactly!!'
    })
    await client.connect()

    // Shared baseline
    await client.set({ key: 'REDIS_URL', value: 'redis://shared:6379', project, environment: env, service: SHARED, sensitive: true })
    await client.set({ key: 'CACHE_TTL', value: '3600', project, environment: env, service: SHARED, sensitive: false })
    await client.set({ key: 'FEATURE_FLAG', value: 'shared-default', project, environment: env, service: SHARED, sensitive: false })

    // Service-specific overrides
    await client.set({ key: 'REDIS_URL', value: 'redis://api-custom:6379', project, environment: env, service: 'api', sensitive: true })
    await client.set({ key: 'CACHE_TTL', value: '1800', project, environment: env, service: 'worker', sensitive: false })

    // Service-exclusive vars
    await client.set({ key: 'API_PORT', value: '3000', project, environment: env, service: 'api', sensitive: false })
    await client.set({ key: 'WORKER_CONCURRENCY', value: '10', project, environment: env, service: 'worker', sensitive: false })
    await client.set({ key: 'WEB_SSR', value: 'true', project, environment: env, service: 'web', sensitive: false })
  }, 30000)

  afterAll(async () => {
    await client.disconnect()
  })

  it('service inherits shared vars when no override exists', async () => {
    const webExport = await client.export(project, env, 'web', { includeShared: true })

    expect(webExport.REDIS_URL).toBe('redis://shared:6379')
    expect(webExport.CACHE_TTL).toBe('3600')
    expect(webExport.FEATURE_FLAG).toBe('shared-default')
    expect(webExport.WEB_SSR).toBe('true')
  })

  it('service override takes precedence over shared', async () => {
    const apiExport = await client.export(project, env, 'api', { includeShared: true })

    expect(apiExport.REDIS_URL).toBe('redis://api-custom:6379')
    expect(apiExport.CACHE_TTL).toBe('3600')
    expect(apiExport.FEATURE_FLAG).toBe('shared-default')
    expect(apiExport.API_PORT).toBe('3000')
  })

  it('different services have different overrides', async () => {
    const apiExport = await client.export(project, env, 'api', { includeShared: true })
    const workerExport = await client.export(project, env, 'worker', { includeShared: true })
    const webExport = await client.export(project, env, 'web', { includeShared: true })

    expect(apiExport.REDIS_URL).toBe('redis://api-custom:6379')
    expect(workerExport.REDIS_URL).toBe('redis://shared:6379')
    expect(webExport.REDIS_URL).toBe('redis://shared:6379')

    expect(apiExport.CACHE_TTL).toBe('3600')
    expect(workerExport.CACHE_TTL).toBe('1800')
    expect(webExport.CACHE_TTL).toBe('3600')

    expect(apiExport.API_PORT).toBe('3000')
    expect(apiExport.WORKER_CONCURRENCY).toBeUndefined()
    expect(apiExport.WEB_SSR).toBeUndefined()

    expect(workerExport.API_PORT).toBeUndefined()
    expect(workerExport.WORKER_CONCURRENCY).toBe('10')
    expect(workerExport.WEB_SSR).toBeUndefined()

    expect(webExport.API_PORT).toBeUndefined()
    expect(webExport.WORKER_CONCURRENCY).toBeUndefined()
    expect(webExport.WEB_SSR).toBe('true')
  })

  it('export with includeShared=false returns only service vars', async () => {
    const apiExport = await client.export(project, env, 'api', { includeShared: false })

    expect(apiExport.REDIS_URL).toBe('redis://api-custom:6379')
    expect(apiExport.API_PORT).toBe('3000')
    expect(apiExport.CACHE_TTL).toBeUndefined()
    expect(apiExport.FEATURE_FLAG).toBeUndefined()
  })
})

// ==========================================================================
// SECTION 3: Sensitive Flag (Secret vs Config) Separation
// ==========================================================================
describe('Sensitive Flag Separation', () => {
  let client: VaulterClient
  const project = 'iso-sens'

  beforeAll(async () => {
    client = new VaulterClient({
      connectionString: 'memory://sensitive-flag-isolation',
      passphrase: 'test-key-32-chars-long-exactly!!'
    })
    await client.connect()
  })

  afterAll(async () => {
    await client.disconnect()
  })

  it('list() returns correct sensitive flag for each var', async () => {
    const env = 'sens-list'

    await client.set({ key: 'API_KEY', value: 'sk-secret-key', project, environment: env, service: 'api', sensitive: true })
    await client.set({ key: 'API_URL', value: 'https://api.example.com', project, environment: env, service: 'api', sensitive: false })
    await client.set({ key: 'DB_CONN', value: 'postgres://secret@db', project, environment: env, service: 'api', sensitive: true })
    await client.set({ key: 'DB_POOL', value: '10', project, environment: env, service: 'api', sensitive: false })
    await client.set({ key: 'JWT_SECRET', value: 'super-secret-jwt', project, environment: env, service: 'api', sensitive: true })
    await client.set({ key: 'LOG_FORMAT', value: 'json', project, environment: env, service: 'api', sensitive: false })

    const vars = await client.list({ project, environment: env, service: 'api' })

    const secrets = vars.filter(v => v.sensitive === true)
    const configs = vars.filter(v => v.sensitive === false)

    expect(secrets.map(v => v.key).sort()).toEqual(['API_KEY', 'DB_CONN', 'JWT_SECRET'])
    expect(configs.map(v => v.key).sort()).toEqual(['API_URL', 'DB_POOL', 'LOG_FORMAT'])
  })

  it('can filter secrets only for K8s Secret export', async () => {
    const env = 'sens-k8s-secret'

    await client.set({ key: 'SEC1', value: 'v1', project, environment: env, service: 'api', sensitive: true })
    await client.set({ key: 'SEC2', value: 'v2', project, environment: env, service: 'api', sensitive: true })
    await client.set({ key: 'SEC3', value: 'v3', project, environment: env, service: 'api', sensitive: true })
    await client.set({ key: 'CFG1', value: 'c1', project, environment: env, service: 'api', sensitive: false })
    await client.set({ key: 'CFG2', value: 'c2', project, environment: env, service: 'api', sensitive: false })

    const vars = await client.list({ project, environment: env, service: 'api' })
    const secretsOnly = vars.filter(v => v.sensitive === true)

    expect(secretsOnly.length).toBe(3)
    expect(secretsOnly.every(v => v.sensitive === true)).toBe(true)
  })

  it('can filter configs only for K8s ConfigMap export', async () => {
    const env = 'sens-k8s-configmap'

    await client.set({ key: 'SEC1', value: 'v1', project, environment: env, service: 'api', sensitive: true })
    await client.set({ key: 'CFG1', value: 'c1', project, environment: env, service: 'api', sensitive: false })
    await client.set({ key: 'CFG2', value: 'c2', project, environment: env, service: 'api', sensitive: false })
    await client.set({ key: 'CFG3', value: 'c3', project, environment: env, service: 'api', sensitive: false })

    const vars = await client.list({ project, environment: env, service: 'api' })
    const configsOnly = vars.filter(v => v.sensitive === false)

    expect(configsOnly.length).toBe(3)
    expect(configsOnly.every(v => v.sensitive === false)).toBe(true)
  })

  it('sensitive flag survives update without explicit flag', async () => {
    const env = 'sens-update'

    await client.set({ key: 'UPD_KEY', value: 'v1', project, environment: env, service: 'api', sensitive: true })
    await client.set({ key: 'UPD_KEY', value: 'v2', project, environment: env, service: 'api' })

    const updated = await client.get('UPD_KEY', project, env, 'api')
    expect(updated!.value).toBe('v2')
    expect(updated!.sensitive).toBe(true)
  })

  it('can explicitly change sensitive flag', async () => {
    const env = 'sens-toggle'

    await client.set({ key: 'TOGGLE', value: 'v1', project, environment: env, service: 'api', sensitive: false })
    let v = await client.get('TOGGLE', project, env, 'api')
    expect(v!.sensitive).toBe(false)

    await client.set({ key: 'TOGGLE', value: 'v2', project, environment: env, service: 'api', sensitive: true })
    v = await client.get('TOGGLE', project, env, 'api')
    expect(v!.sensitive).toBe(true)

    await client.set({ key: 'TOGGLE', value: 'v3', project, environment: env, service: 'api', sensitive: false })
    v = await client.get('TOGGLE', project, env, 'api')
    expect(v!.sensitive).toBe(false)
  })
})

// ==========================================================================
// SECTION 4: Local Overrides
// ==========================================================================
describe('Local Overrides', () => {
  let tempDir: string
  let configDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-local-test-'))
    configDir = path.join(tempDir, '.vaulter')
    fs.mkdirSync(configDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('local override takes precedence over base vars', () => {
    const baseVars = { DB_URL: 'postgres://prod@db', LOG_LEVEL: 'error', PORT: '8080' }
    const overrides = { DB_URL: 'postgres://localhost/dev', DEBUG: 'true' }

    const merged = mergeWithOverrides(baseVars, overrides)

    expect(merged.DB_URL).toBe('postgres://localhost/dev')
    expect(merged.LOG_LEVEL).toBe('error')
    expect(merged.PORT).toBe('8080')
    expect(merged.DEBUG).toBe('true')
  })

  it('diffOverrides correctly identifies changes', () => {
    const baseVars = { A: 'base-a', B: 'base-b', C: 'base-c' }
    const overrides = { A: 'override-a', D: 'new-d' }

    const diff = diffOverrides(baseVars, overrides)

    expect(diff.added).toEqual(['D'])
    expect(diff.modified).toEqual(['A'])
    expect(diff.baseOnly.sort()).toEqual(['B', 'C'])
  })

  it('saves and loads overrides correctly', () => {
    const overrides = { LOCAL_VAR: 'local-value', ANOTHER: 'another-value' }

    saveOverrides(configDir, overrides)
    const loaded = loadOverrides(configDir)

    expect(loaded).toEqual(overrides)
  })

  it('service-specific overrides are isolated', () => {
    const apiOverrides = { PORT: '3000', API_KEY: 'api-local' }
    const workerOverrides = { PORT: '4000', CONCURRENCY: '5' }

    saveOverrides(configDir, apiOverrides, 'api')
    saveOverrides(configDir, workerOverrides, 'worker')

    const loadedApi = loadOverrides(configDir, 'api')
    const loadedWorker = loadOverrides(configDir, 'worker')

    expect(loadedApi).toEqual(apiOverrides)
    expect(loadedWorker).toEqual(workerOverrides)
    expect(loadedApi.CONCURRENCY).toBeUndefined()
    expect(loadedWorker.API_KEY).toBeUndefined()
  })

  it('resetOverrides clears only specified service', () => {
    saveOverrides(configDir, { A: '1' }, 'api')
    saveOverrides(configDir, { B: '2' }, 'worker')

    resetOverrides(configDir, 'api')

    expect(loadOverrides(configDir, 'api')).toEqual({})
    expect(loadOverrides(configDir, 'worker')).toEqual({ B: '2' })
  })
})

// ==========================================================================
// SECTION 5: Complex Multi-Layer Scenarios
// ==========================================================================
describe('Complex Multi-Layer Scenarios', () => {
  let tempDir: string
  let configDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-complex-test-'))
    configDir = path.join(tempDir, '.vaulter')
    fs.mkdirSync(configDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('full stack: shared → service override → local override', async () => {
    const client = new VaulterClient({
      connectionString: 'memory://complex-full-stack',
      passphrase: 'test-key-32-chars-long-exactly!!'
    })
    await client.connect()

    const project = 'complex'
    const env = 'full'

    // Layer 1: Shared vars
    await client.set({ key: 'DB_URL', value: 'postgres://shared', project, environment: env, service: SHARED, sensitive: true })
    await client.set({ key: 'LOG_LEVEL', value: 'info', project, environment: env, service: SHARED, sensitive: false })
    await client.set({ key: 'TIMEOUT', value: '30000', project, environment: env, service: SHARED, sensitive: false })

    // Layer 2: Service override
    await client.set({ key: 'DB_URL', value: 'postgres://api-specific', project, environment: env, service: 'api', sensitive: true })
    await client.set({ key: 'API_KEY', value: 'api-secret', project, environment: env, service: 'api', sensitive: true })

    const backendExport = await client.export(project, env, 'api', { includeShared: true })

    expect(backendExport.DB_URL).toBe('postgres://api-specific')
    expect(backendExport.LOG_LEVEL).toBe('info')
    expect(backendExport.TIMEOUT).toBe('30000')
    expect(backendExport.API_KEY).toBe('api-secret')

    // Layer 3: Local override
    const localOverrides = {
      DB_URL: 'postgres://localhost/dev',
      LOG_LEVEL: 'debug',
      DEBUG: 'true'
    }

    const finalVars = mergeWithOverrides(backendExport, localOverrides)

    expect(finalVars.DB_URL).toBe('postgres://localhost/dev')
    expect(finalVars.LOG_LEVEL).toBe('debug')
    expect(finalVars.TIMEOUT).toBe('30000')
    expect(finalVars.API_KEY).toBe('api-secret')
    expect(finalVars.DEBUG).toBe('true')

    await client.disconnect()
  })

  it('environments are completely isolated even with same service structure', async () => {
    const client = new VaulterClient({
      connectionString: 'memory://complex-env-struct',
      passphrase: 'test-key-32-chars-long-exactly!!'
    })
    await client.connect()

    const project = 'struct'

    const setupEnv = async (env: string, suffix: string) => {
      await client.set({ key: 'SHARED_VAR', value: `shared-${suffix}`, project, environment: env, service: SHARED, sensitive: false })
      await client.set({ key: 'SHARED_SECRET', value: `secret-${suffix}`, project, environment: env, service: SHARED, sensitive: true })
      await client.set({ key: 'API_VAR', value: `api-${suffix}`, project, environment: env, service: 'api', sensitive: false })
      await client.set({ key: 'WORKER_VAR', value: `worker-${suffix}`, project, environment: env, service: 'worker', sensitive: false })
    }

    await setupEnv('dev', 'dev')
    await setupEnv('stg', 'stg')
    await setupEnv('prd', 'prd')

    const devApi = await client.export(project, 'dev', 'api', { includeShared: true })
    const stgApi = await client.export(project, 'stg', 'api', { includeShared: true })
    const prdApi = await client.export(project, 'prd', 'api', { includeShared: true })

    expect(devApi.SHARED_VAR).toBe('shared-dev')
    expect(devApi.SHARED_SECRET).toBe('secret-dev')
    expect(devApi.API_VAR).toBe('api-dev')
    expect(devApi.WORKER_VAR).toBeUndefined()

    expect(stgApi.SHARED_VAR).toBe('shared-stg')
    expect(stgApi.SHARED_SECRET).toBe('secret-stg')
    expect(stgApi.API_VAR).toBe('api-stg')

    expect(prdApi.SHARED_VAR).toBe('shared-prd')
    expect(prdApi.SHARED_SECRET).toBe('secret-prd')
    expect(prdApi.API_VAR).toBe('api-prd')

    const devWorker = await client.export(project, 'dev', 'worker', { includeShared: true })
    expect(devWorker.WORKER_VAR).toBe('worker-dev')
    expect(devWorker.API_VAR).toBeUndefined()
    expect(devWorker.SHARED_VAR).toBe('shared-dev')

    await client.disconnect()
  })

  it('deletion only affects exact scope', async () => {
    const client = new VaulterClient({
      connectionString: 'memory://complex-deletion',
      passphrase: 'test-key-32-chars-long-exactly!!'
    })
    await client.connect()

    const project = 'del'
    const env = 'scope'

    await client.set({ key: 'MULTI', value: 'shared-del', project, environment: env, service: SHARED })
    await client.set({ key: 'MULTI', value: 'api-del', project, environment: env, service: 'api' })
    await client.set({ key: 'MULTI', value: 'worker-del', project, environment: env, service: 'worker' })
    await client.set({ key: 'MULTI', value: 'other-env', project, environment: `${env}-other`, service: SHARED })

    await client.delete('MULTI', project, env, 'api')

    const shared = await client.get('MULTI', project, env, SHARED)
    const api = await client.get('MULTI', project, env, 'api')
    const worker = await client.get('MULTI', project, env, 'worker')
    const otherEnv = await client.get('MULTI', project, `${env}-other`, SHARED)

    expect(shared!.value).toBe('shared-del')
    expect(api).toBeNull()
    expect(worker!.value).toBe('worker-del')
    expect(otherEnv!.value).toBe('other-env')

    await client.disconnect()
  })

  it('batch operations respect isolation', async () => {
    const client = new VaulterClient({
      connectionString: 'memory://complex-batch',
      passphrase: 'test-key-32-chars-long-exactly!!'
    })
    await client.connect()

    const project = 'batch'

    // Sequential sets to ensure all complete
    await client.set({ key: 'BATCH', value: 'batch-dev-shared', project, environment: 'dev', service: SHARED })
    await client.set({ key: 'BATCH', value: 'batch-prd-shared', project, environment: 'prd', service: SHARED })
    await client.set({ key: 'BATCH', value: 'batch-dev-api', project, environment: 'dev', service: 'api' })
    await client.set({ key: 'BATCH', value: 'batch-prd-api', project, environment: 'prd', service: 'api' })

    expect((await client.get('BATCH', project, 'dev', SHARED))!.value).toBe('batch-dev-shared')
    expect((await client.get('BATCH', project, 'prd', SHARED))!.value).toBe('batch-prd-shared')
    expect((await client.get('BATCH', project, 'dev', 'api'))!.value).toBe('batch-dev-api')
    expect((await client.get('BATCH', project, 'prd', 'api'))!.value).toBe('batch-prd-api')

    await client.disconnect()
  })

  it('resolveVariables helper correctly merges shared + service with source tracking', () => {
    const sharedVars: Record<string, string> = { A: 'shared-a', B: 'shared-b', C: 'shared-c' }
    const serviceVars: Record<string, string> = { B: 'service-b', D: 'service-d' }

    const resolved = resolveVariables(sharedVars, serviceVars)

    expect(resolved.get('A')?.value).toBe('shared-a')
    expect(resolved.get('A')?.source).toBe('shared')

    expect(resolved.get('B')?.value).toBe('service-b')
    expect(resolved.get('B')?.source).toBe('override')

    expect(resolved.get('C')?.value).toBe('shared-c')
    expect(resolved.get('C')?.source).toBe('shared')

    expect(resolved.get('D')?.value).toBe('service-d')
    expect(resolved.get('D')?.source).toBe('service')
  })
})

// ==========================================================================
// SECTION 6: Edge Cases & Regression Protection
// ==========================================================================
describe('Edge Cases & Regression Protection', () => {
  let client: VaulterClient
  const project = 'iso-edge'

  beforeAll(async () => {
    client = new VaulterClient({
      connectionString: 'memory://edge-cases',
      passphrase: 'test-key-32-chars-long-exactly!!'
    })
    await client.connect()
  })

  afterAll(async () => {
    await client.disconnect()
  })

  it('special characters in values do not cause cross-contamination', async () => {
    const id = uniqueId()
    await client.set({ key: 'SPECIAL', value: 'dev|env|service|key', project, environment: `spec-${id}-dev`, service: 'api' })
    await client.set({ key: 'SPECIAL', value: 'prd|env|service|key', project, environment: `spec-${id}-prd`, service: 'api' })

    const dev = await client.get('SPECIAL', project, `spec-${id}-dev`, 'api')
    const prd = await client.get('SPECIAL', project, `spec-${id}-prd`, 'api')

    expect(dev!.value).toBe('dev|env|service|key')
    expect(prd!.value).toBe('prd|env|service|key')
  })

  it('unicode in key names maintains isolation', async () => {
    const id = uniqueId()
    await client.set({ key: 'EMOJI_🔥', value: 'dev-fire', project, environment: `uni-${id}-dev`, service: 'api' })
    await client.set({ key: 'EMOJI_🔥', value: 'prd-fire', project, environment: `uni-${id}-prd`, service: 'api' })

    const dev = await client.get('EMOJI_🔥', project, `uni-${id}-dev`, 'api')
    const prd = await client.get('EMOJI_🔥', project, `uni-${id}-prd`, 'api')

    expect(dev!.value).toBe('dev-fire')
    expect(prd!.value).toBe('prd-fire')
  })

  it('moderately long values are stored and isolated correctly', async () => {
    const id = uniqueId()
    const value = 'x'.repeat(100)

    await client.set({ key: 'LONG', value: value + '-dev', project, environment: `long-${id}-dev`, service: 'api' })
    await client.set({ key: 'LONG', value: value + '-prd', project, environment: `long-${id}-prd`, service: 'api' })

    const dev = await client.get('LONG', project, `long-${id}-dev`, 'api')
    const prd = await client.get('LONG', project, `long-${id}-prd`, 'api')

    expect(dev!.value).toBe(value + '-dev')
    expect(prd!.value).toBe(value + '-prd')
  })

  it('concurrent sets to same key different environments do not race', async () => {
    const id = uniqueId()
    const envs = ['race-a', 'race-b', 'race-c', 'race-d', 'race-e'].map(e => `${e}-${id}`)

    await Promise.all(
      envs.map(env =>
        client.set({ key: 'RACE', value: `value-${env}`, project, environment: env, service: 'api' })
      )
    )

    const results = await Promise.all(
      envs.map(async env => {
        const v = await client.get('RACE', project, env, 'api')
        return { env, value: v?.value }
      })
    )

    for (const r of results) {
      expect(r.value).toBe(`value-${r.env}`)
    }
  })
})

// ==========================================================================
// SECTION 7: Cross-Project Isolation
// ==========================================================================
describe('Cross-Project Isolation', () => {
  let client: VaulterClient

  beforeAll(async () => {
    client = new VaulterClient({
      connectionString: 'memory://cross-project',
      passphrase: 'test-key-32-chars-long-exactly!!'
    })
    await client.connect()
  })

  afterAll(async () => {
    await client.disconnect()
  })

  it('same key in different projects are isolated', async () => {
    const env = `proj-iso-${uniqueId()}`

    await client.set({ key: 'SAME_KEY', value: 'value-a', project: 'project-a', environment: env, service: 'api' })
    await client.set({ key: 'SAME_KEY', value: 'value-b', project: 'project-b', environment: env, service: 'api' })

    const varA = await client.get('SAME_KEY', 'project-a', env, 'api')
    const varB = await client.get('SAME_KEY', 'project-b', env, 'api')

    expect(varA!.value).toBe('value-a')
    expect(varB!.value).toBe('value-b')
  })

  it('list() respects project boundary', async () => {
    const env = `proj-list-${uniqueId()}`

    await client.set({ key: 'A1', value: 'a1', project: 'list-proj-a', environment: env, service: 'api' })
    await client.set({ key: 'A2', value: 'a2', project: 'list-proj-a', environment: env, service: 'api' })
    await client.set({ key: 'B1', value: 'b1', project: 'list-proj-b', environment: env, service: 'api' })

    const listA = await client.list({ project: 'list-proj-a', environment: env, service: 'api' })
    const listB = await client.list({ project: 'list-proj-b', environment: env, service: 'api' })

    expect(listA.map(v => v.key).sort()).toEqual(['A1', 'A2'])
    expect(listB.map(v => v.key)).toEqual(['B1'])
  })
})

// ==========================================================================
// SECTION 8: Real-World Monorepo Deploy Simulation
// ==========================================================================
describe('Real-World Monorepo Deploy Simulation', () => {
  /**
   * This test simulates a realistic monorepo deployment scenario:
   *
   * Project: "tetis-lair" (monorepo)
   * Environments: dev, stg, prd
   * Services: api, worker, web, scheduler
   *
   * Each environment has:
   * - Shared SECRETS: DATABASE_URL, REDIS_URL, JWT_SECRET
   * - Shared CONFIGS: LOG_LEVEL, NODE_ENV, SENTRY_DSN
   *
   * Each service has:
   * - Service-specific SECRETS: API_KEY (api), QUEUE_SECRET (worker), etc.
   * - Service-specific CONFIGS: PORT, CONCURRENCY, SSR_ENABLED, etc.
   *
   * Test validates that when deploying each service to each environment,
   * it receives ONLY the correct vars (shared + service-specific) for THAT env.
   */

  let client: VaulterClient
  const project = 'tetis-lair'
  const environments = ['dev', 'stg', 'prd'] as const
  const services = ['api', 'worker', 'web', 'scheduler'] as const

  // Expected values per environment
  const envConfig = {
    dev: {
      // Shared secrets
      DATABASE_URL: 'postgres://dev:dev@localhost:5432/tetis_dev',
      REDIS_URL: 'redis://localhost:6379/0',
      JWT_SECRET: 'dev-jwt-secret-not-secure',
      // Shared configs
      LOG_LEVEL: 'debug',
      NODE_ENV: 'development',
      SENTRY_DSN: '',  // Empty in dev
    },
    stg: {
      DATABASE_URL: 'postgres://stg:stg@stg-db.internal:5432/tetis_stg',
      REDIS_URL: 'redis://stg-redis.internal:6379/0',
      JWT_SECRET: 'stg-jwt-secret-medium-secure',
      LOG_LEVEL: 'info',
      NODE_ENV: 'staging',
      SENTRY_DSN: 'https://abc@sentry.io/stg',
    },
    prd: {
      DATABASE_URL: 'postgres://prd:SUPER_SECRET@prd-db.internal:5432/tetis_prd',
      REDIS_URL: 'redis://prd-redis.internal:6379/0',
      JWT_SECRET: 'prd-jwt-secret-SUPER-SECURE-256bit',
      LOG_LEVEL: 'error',
      NODE_ENV: 'production',
      SENTRY_DSN: 'https://xyz@sentry.io/prd',
    },
  }

  // Service-specific vars (same for all envs, but could differ)
  const serviceConfig = {
    api: {
      secrets: { API_STRIPE_KEY: 'sk_test_xxx', API_SENDGRID_KEY: 'SG.xxx' },
      configs: { PORT: '3000', API_RATE_LIMIT: '1000', CORS_ORIGIN: '*' },
    },
    worker: {
      secrets: { WORKER_QUEUE_SECRET: 'queue-secret-xxx' },
      configs: { CONCURRENCY: '10', QUEUE_NAME: 'default', RETRY_ATTEMPTS: '3' },
    },
    web: {
      secrets: { WEB_SESSION_SECRET: 'session-secret-xxx' },
      configs: { SSR_ENABLED: 'true', CACHE_TTL: '3600', PORT: '8080' },
    },
    scheduler: {
      secrets: { SCHEDULER_API_KEY: 'scheduler-api-key-xxx' },
      configs: { CRON_TIMEZONE: 'UTC', MAX_JOBS: '100' },
    },
  }

  beforeAll(async () => {
    client = new VaulterClient({
      connectionString: 'memory://monorepo-deploy-simulation',
      passphrase: 'test-key-32-chars-long-exactly!!'
    })
    await client.connect()

    // Setup all shared vars for all environments
    for (const env of environments) {
      const cfg = envConfig[env]
      // Shared secrets (sensitive=true)
      await client.set({ key: 'DATABASE_URL', value: cfg.DATABASE_URL, project, environment: env, service: SHARED, sensitive: true })
      await client.set({ key: 'REDIS_URL', value: cfg.REDIS_URL, project, environment: env, service: SHARED, sensitive: true })
      await client.set({ key: 'JWT_SECRET', value: cfg.JWT_SECRET, project, environment: env, service: SHARED, sensitive: true })
      // Shared configs (sensitive=false)
      await client.set({ key: 'LOG_LEVEL', value: cfg.LOG_LEVEL, project, environment: env, service: SHARED, sensitive: false })
      await client.set({ key: 'NODE_ENV', value: cfg.NODE_ENV, project, environment: env, service: SHARED, sensitive: false })
      await client.set({ key: 'SENTRY_DSN', value: cfg.SENTRY_DSN, project, environment: env, service: SHARED, sensitive: false })
    }

    // Setup all service-specific vars for all environments
    for (const env of environments) {
      for (const svc of services) {
        const svcCfg = serviceConfig[svc]
        // Service secrets
        for (const [key, value] of Object.entries(svcCfg.secrets)) {
          await client.set({ key, value: `${value}-${env}`, project, environment: env, service: svc, sensitive: true })
        }
        // Service configs
        for (const [key, value] of Object.entries(svcCfg.configs)) {
          await client.set({ key, value, project, environment: env, service: svc, sensitive: false })
        }
      }
    }
  }, 60000)

  afterAll(async () => {
    await client.disconnect()
  })

  // Test each service in each environment
  for (const env of environments) {
    for (const svc of services) {
      it(`deploy ${svc} to ${env}: receives correct shared + service vars`, async () => {
        // Simulate deploy: export all vars for this service in this environment
        const deployVars = await client.export(project, env, svc, { includeShared: true })

        // Verify shared vars come from THIS environment
        const expectedShared = envConfig[env]
        expect(deployVars.DATABASE_URL).toBe(expectedShared.DATABASE_URL)
        expect(deployVars.REDIS_URL).toBe(expectedShared.REDIS_URL)
        expect(deployVars.JWT_SECRET).toBe(expectedShared.JWT_SECRET)
        expect(deployVars.LOG_LEVEL).toBe(expectedShared.LOG_LEVEL)
        expect(deployVars.NODE_ENV).toBe(expectedShared.NODE_ENV)
        expect(deployVars.SENTRY_DSN).toBe(expectedShared.SENTRY_DSN)

        // Verify service-specific vars
        const expectedService = serviceConfig[svc]
        for (const [key, value] of Object.entries(expectedService.secrets)) {
          expect(deployVars[key]).toBe(`${value}-${env}`)
        }
        for (const [key, value] of Object.entries(expectedService.configs)) {
          expect(deployVars[key]).toBe(value)
        }

        // Verify NO vars from OTHER services leaked
        for (const otherSvc of services) {
          if (otherSvc === svc) continue
          const otherConfig = serviceConfig[otherSvc]
          for (const key of Object.keys(otherConfig.secrets)) {
            expect(deployVars[key]).toBeUndefined()
          }
          // Note: some config keys might overlap (like PORT), which is expected
        }
      })
    }
  }

  it('K8s Secret export: only sensitive vars for api in prd', async () => {
    const vars = await client.list({ project, environment: 'prd', service: 'api' })
    const sharedVars = await client.list({ project, environment: 'prd', service: SHARED })

    const allVars = [...sharedVars, ...vars]
    const secrets = allVars.filter(v => v.sensitive === true)
    const secretKeys = secrets.map(v => v.key).sort()

    // Should have: DATABASE_URL, REDIS_URL, JWT_SECRET (shared) + API_STRIPE_KEY, API_SENDGRID_KEY (api)
    expect(secretKeys).toEqual([
      'API_SENDGRID_KEY',
      'API_STRIPE_KEY',
      'DATABASE_URL',
      'JWT_SECRET',
      'REDIS_URL',
    ])

    // Verify values are from prd
    const dbUrl = secrets.find(v => v.key === 'DATABASE_URL')
    expect(dbUrl!.value).toContain('prd-db.internal')
  })

  it('K8s ConfigMap export: only non-sensitive vars for web in stg', async () => {
    const vars = await client.list({ project, environment: 'stg', service: 'web' })
    const sharedVars = await client.list({ project, environment: 'stg', service: SHARED })

    const allVars = [...sharedVars, ...vars]
    const configs = allVars.filter(v => v.sensitive === false)
    const configKeys = configs.map(v => v.key).sort()

    // Should have: LOG_LEVEL, NODE_ENV, SENTRY_DSN (shared) + SSR_ENABLED, CACHE_TTL, PORT (web)
    expect(configKeys).toEqual([
      'CACHE_TTL',
      'LOG_LEVEL',
      'NODE_ENV',
      'PORT',
      'SENTRY_DSN',
      'SSR_ENABLED',
    ])

    // Verify values are from stg
    const nodeEnv = configs.find(v => v.key === 'NODE_ENV')
    expect(nodeEnv!.value).toBe('staging')
  })

  it('cross-environment check: prd DATABASE_URL never leaks to dev', async () => {
    const devExport = await client.export(project, 'dev', 'api', { includeShared: true })
    const prdExport = await client.export(project, 'prd', 'api', { includeShared: true })

    // Dev should have localhost
    expect(devExport.DATABASE_URL).toContain('localhost')
    expect(devExport.DATABASE_URL).not.toContain('prd-db')

    // Prd should have production DB
    expect(prdExport.DATABASE_URL).toContain('prd-db.internal')
    expect(prdExport.DATABASE_URL).not.toContain('localhost')

    // JWT secrets should be different
    expect(devExport.JWT_SECRET).not.toBe(prdExport.JWT_SECRET)
    expect(prdExport.JWT_SECRET).toContain('SUPER-SECURE')
  })

  it('service isolation check: worker secrets never appear in api export', async () => {
    const apiExport = await client.export(project, 'prd', 'api', { includeShared: true })
    const workerExport = await client.export(project, 'prd', 'worker', { includeShared: true })

    // Api should NOT have worker secrets
    expect(apiExport.WORKER_QUEUE_SECRET).toBeUndefined()
    expect(apiExport.CONCURRENCY).toBeUndefined()

    // Worker should NOT have api secrets
    expect(workerExport.API_STRIPE_KEY).toBeUndefined()
    expect(workerExport.API_SENDGRID_KEY).toBeUndefined()

    // Both should have shared vars
    expect(apiExport.DATABASE_URL).toBe(workerExport.DATABASE_URL)
    expect(apiExport.JWT_SECRET).toBe(workerExport.JWT_SECRET)
  })

  it('full deploy simulation: all services in prd get correct total var count', async () => {
    const results: Record<string, { total: number, secrets: number, configs: number }> = {}

    for (const svc of services) {
      const svcVars = await client.list({ project, environment: 'prd', service: svc })
      const sharedVars = await client.list({ project, environment: 'prd', service: SHARED })

      const all = [...sharedVars, ...svcVars]
      results[svc] = {
        total: all.length,
        secrets: all.filter(v => v.sensitive === true).length,
        configs: all.filter(v => v.sensitive === false).length,
      }
    }

    // All services should have 6 shared vars (3 secrets + 3 configs)
    // Plus their service-specific vars

    // api: 6 shared + 2 secrets + 3 configs = 11
    expect(results.api.total).toBe(11)
    expect(results.api.secrets).toBe(5)  // 3 shared + 2 api
    expect(results.api.configs).toBe(6)  // 3 shared + 3 api

    // worker: 6 shared + 1 secret + 3 configs = 10
    expect(results.worker.total).toBe(10)
    expect(results.worker.secrets).toBe(4)  // 3 shared + 1 worker
    expect(results.worker.configs).toBe(6)  // 3 shared + 3 worker

    // web: 6 shared + 1 secret + 3 configs = 10
    expect(results.web.total).toBe(10)
    expect(results.web.secrets).toBe(4)  // 3 shared + 1 web
    expect(results.web.configs).toBe(6)  // 3 shared + 3 web

    // scheduler: 6 shared + 1 secret + 2 configs = 9
    expect(results.scheduler.total).toBe(9)
    expect(results.scheduler.secrets).toBe(4)  // 3 shared + 1 scheduler
    expect(results.scheduler.configs).toBe(5)  // 3 shared + 2 scheduler
  })
})
