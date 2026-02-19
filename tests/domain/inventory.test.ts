import { describe, it, expect, vi } from 'vitest'
import { buildInventory } from '../../src/domain/inventory.js'
import type { EnvVar } from '../../src/types.js'

// ============================================================================
// Helpers
// ============================================================================

function makeEnvVar(key: string, env: string, opts: {
  service?: string
  sensitive?: boolean
  value?: string
} = {}): EnvVar {
  return {
    id: `id-${key}-${env}-${opts.service || 'shared'}`,
    key,
    value: opts.value ?? 'val',
    project: 'test',
    environment: env,
    service: opts.service,
    sensitive: opts.sensitive ?? false,
    metadata: {}
  } as EnvVar
}

function createMockClient(varsByEnv: Record<string, EnvVar[]>) {
  return {
    list: vi.fn().mockImplementation(({ environment }: { environment: string }) => {
      return Promise.resolve(varsByEnv[environment] || [])
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined)
  } as any
}

// ============================================================================
// buildInventory
// ============================================================================

describe('buildInventory', () => {
  it('returns empty inventory for no vars', async () => {
    const client = createMockClient({ dev: [], stg: [] })
    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev', 'stg']
    })

    expect(inv.services).toEqual([])
    expect(inv.orphanedVars).toEqual([])
    expect(inv.missingVars).toEqual([])
    expect(inv.coverageMatrix).toEqual([])
  })

  // ---- Service inventory ----

  it('builds service inventory from vars', async () => {
    const client = createMockClient({
      dev: [
        makeEnvVar('LOG_LEVEL', 'dev'),
        makeEnvVar('PORT', 'dev', { service: 'api' }),
        makeEnvVar('WEB_URL', 'dev', { service: 'web' })
      ]
    })

    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev']
    })

    expect(inv.services).toHaveLength(3) // shared, api, web
    const shared = inv.services.find(s => s.name === 'shared')!
    expect(shared.varCount).toBe(1)
    const api = inv.services.find(s => s.name === 'api')!
    expect(api.varCount).toBe(1)
  })

  it('aggregates vars across environments', async () => {
    const client = createMockClient({
      dev: [makeEnvVar('LOG_LEVEL', 'dev')],
      prd: [makeEnvVar('LOG_LEVEL', 'prd'), makeEnvVar('API_KEY', 'prd')]
    })

    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev', 'prd']
    })

    const shared = inv.services.find(s => s.name === 'shared')!
    expect(shared.varCount).toBe(3) // 1 dev + 2 prd
    expect(shared.environments).toContain('dev')
    expect(shared.environments).toContain('prd')
  })

  it('includes known services with no vars', async () => {
    const client = createMockClient({
      dev: [makeEnvVar('PORT', 'dev', { service: 'api' })]
    })

    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev'],
      knownServices: ['api', 'worker']
    })

    const worker = inv.services.find(s => s.name === 'worker')!
    expect(worker).toBeTruthy()
    expect(worker.varCount).toBe(0)
    expect(worker.lifecycle).toBe('active')
  })

  // ---- Orphan detection ----

  it('detects orphaned variables (unknown services)', async () => {
    const client = createMockClient({
      dev: [
        makeEnvVar('PORT', 'dev', { service: 'api' }),
        makeEnvVar('OLD_VAR', 'dev', { service: 'removed-svc' })
      ]
    })

    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev'],
      knownServices: ['api', 'web']
    })

    expect(inv.orphanedVars).toHaveLength(1)
    expect(inv.orphanedVars[0].key).toBe('OLD_VAR')
    expect(inv.orphanedVars[0].scope).toEqual({ kind: 'service', name: 'removed-svc' })
    expect(inv.orphanedVars[0].reason).toBe('unknown_service')
  })

  it('does not detect orphans when knownServices is empty', async () => {
    const client = createMockClient({
      dev: [makeEnvVar('X', 'dev', { service: 'any-svc' })]
    })

    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev'],
      knownServices: []
    })

    expect(inv.orphanedVars).toEqual([])
  })

  it('does not flag shared vars as orphans', async () => {
    const client = createMockClient({
      dev: [
        makeEnvVar('LOG_LEVEL', 'dev'), // shared (no service)
        makeEnvVar('SHARED2', 'dev', { service: '__shared__' })
      ]
    })

    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev'],
      knownServices: ['api']
    })

    expect(inv.orphanedVars).toEqual([])
  })

  // ---- Missing variable detection ----

  it('detects variables missing from some environments', async () => {
    const client = createMockClient({
      dev: [makeEnvVar('DB_URL', 'dev'), makeEnvVar('API_KEY', 'dev')],
      stg: [makeEnvVar('DB_URL', 'stg')],
      prd: [makeEnvVar('DB_URL', 'prd')]
    })

    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev', 'stg', 'prd']
    })

    // API_KEY exists only in dev, missing from stg and prd
    const apiKeyMissing = inv.missingVars.find(m => m.key === 'API_KEY')!
    expect(apiKeyMissing).toBeTruthy()
    expect(apiKeyMissing.presentIn).toEqual(['dev'])
    expect(apiKeyMissing.missingFrom).toEqual(['prd', 'stg'])
  })

  it('does not flag vars that exist in all environments', async () => {
    const client = createMockClient({
      dev: [makeEnvVar('LOG_LEVEL', 'dev')],
      prd: [makeEnvVar('LOG_LEVEL', 'prd')]
    })

    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev', 'prd']
    })

    expect(inv.missingVars).toEqual([])
  })

  it('does not detect missing when only one environment', async () => {
    const client = createMockClient({
      dev: [makeEnvVar('X', 'dev')]
    })

    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev']
    })

    expect(inv.missingVars).toEqual([])
  })

  // ---- Coverage matrix ----

  it('builds coverage matrix', async () => {
    const client = createMockClient({
      dev: [makeEnvVar('DB_URL', 'dev'), makeEnvVar('LOG_LEVEL', 'dev')],
      prd: [makeEnvVar('DB_URL', 'prd')]
    })

    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev', 'prd']
    })

    expect(inv.coverageMatrix).toHaveLength(2) // DB_URL and LOG_LEVEL

    const dbUrl = inv.coverageMatrix.find(e => e.key === 'DB_URL')!
    expect(dbUrl.environments.dev).toBe(true)
    expect(dbUrl.environments.prd).toBe(true)

    const logLevel = inv.coverageMatrix.find(e => e.key === 'LOG_LEVEL')!
    expect(logLevel.environments.dev).toBe(true)
    expect(logLevel.environments.prd).toBe(false)
  })

  it('coverage matrix distinguishes by scope', async () => {
    const client = createMockClient({
      dev: [
        makeEnvVar('PORT', 'dev'), // shared
        makeEnvVar('PORT', 'dev', { service: 'api' }) // service-scoped
      ]
    })

    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev']
    })

    // Two entries for PORT: one shared, one api
    const portEntries = inv.coverageMatrix.filter(e => e.key === 'PORT')
    expect(portEntries).toHaveLength(2)
  })

  // ---- Integration ----

  it('handles full scenario with multiple environments and services', async () => {
    const client = createMockClient({
      dev: [
        makeEnvVar('LOG_LEVEL', 'dev'),
        makeEnvVar('DB_URL', 'dev'),
        makeEnvVar('PORT', 'dev', { service: 'api' }),
        makeEnvVar('PORT', 'dev', { service: 'web' }),
        makeEnvVar('LEGACY', 'dev', { service: 'old-svc' })
      ],
      prd: [
        makeEnvVar('LOG_LEVEL', 'prd'),
        makeEnvVar('DB_URL', 'prd'),
        makeEnvVar('PORT', 'prd', { service: 'api' })
      ]
    })

    const inv = await buildInventory({
      client,
      config: null,
      project: 'test',
      environments: ['dev', 'prd'],
      knownServices: ['api', 'web']
    })

    // Services: shared, api, old-svc (orphan), web
    expect(inv.services.length).toBeGreaterThanOrEqual(3)

    // old-svc is orphan
    const oldSvc = inv.services.find(s => s.name === 'old-svc')!
    expect(oldSvc.lifecycle).toBe('orphan')

    // LEGACY is orphaned
    expect(inv.orphanedVars.some(o => o.key === 'LEGACY')).toBe(true)

    // web PORT exists only in dev → missing from prd
    const webPortMissing = inv.missingVars.find(
      m => m.key === 'PORT' && m.scope.kind === 'service' && (m.scope as any).name === 'web'
    )
    expect(webPortMissing).toBeTruthy()
    expect(webPortMissing!.missingFrom).toContain('prd')
  })
})
