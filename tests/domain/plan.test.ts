import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  computePlan,
  writePlanArtifact,
  readLatestPlan,
  isPlanStale
} from '../../src/domain/plan.js'
import { writeLocalVariable } from '../../src/domain/state.js'
import { sharedScope, serviceScope } from '../../src/domain/types.js'
import type { Plan, PlanChange } from '../../src/domain/types.js'

let tmpDir: string
let configDir: string
let artifactDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-plan-test-'))
  configDir = path.join(tmpDir, '.vaulter')
  artifactDir = path.join(tmpDir, 'artifacts')
  fs.mkdirSync(path.join(configDir, 'local'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ============================================================================
// Mock VaulterClient
// ============================================================================

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
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined)
  } as any
}

// ============================================================================
// computePlan
// ============================================================================

describe('computePlan', () => {
  it('returns empty plan when no local and no remote vars', async () => {
    const client = createMockClient([])
    const plan = await computePlan({
      client,
      config: null,
      configDir,
      project: 'test',
      environment: 'dev'
    })

    expect(plan.changes).toEqual([])
    expect(plan.summary.toAdd).toBe(0)
    expect(plan.summary.toUpdate).toBe(0)
    expect(plan.summary.toDelete).toBe(0)
    expect(plan.summary.unchanged).toBe(0)
    expect(plan.status).toBe('planned')
  })

  it('detects new local vars as "add" actions', async () => {
    // Write local vars
    writeLocalVariable(configDir, 'dev', {
      key: 'NEW_VAR',
      value: 'hello',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    const client = createMockClient([])
    const plan = await computePlan({
      client,
      config: null,
      configDir,
      project: 'test',
      environment: 'dev'
    })

    expect(plan.summary.toAdd).toBe(1)
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0]).toMatchObject({
      key: 'NEW_VAR',
      action: 'add',
      scope: { kind: 'shared' },
      localValue: 'hello'
    })
  })

  it('detects value differences as "update" actions', async () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'EXISTING',
      value: 'new-value',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    const client = createMockClient([
      { key: 'EXISTING', value: 'old-value' }
    ])

    const plan = await computePlan({
      client,
      config: null,
      configDir,
      project: 'test',
      environment: 'dev'
    })

    expect(plan.summary.toUpdate).toBe(1)
    expect(plan.changes[0]).toMatchObject({
      key: 'EXISTING',
      action: 'update',
      localValue: 'new-value',
      remoteValue: 'old-value'
    })
  })

  it('counts identical vars as unchanged', async () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'SAME',
      value: 'identical',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    const client = createMockClient([
      { key: 'SAME', value: 'identical' }
    ])

    const plan = await computePlan({
      client,
      config: null,
      configDir,
      project: 'test',
      environment: 'dev'
    })

    expect(plan.summary.unchanged).toBe(1)
    expect(plan.changes).toHaveLength(0)
  })

  it('counts remote-only vars as conflicts when prune=false', async () => {
    const client = createMockClient([
      { key: 'REMOTE_ONLY', value: 'val' }
    ])

    const plan = await computePlan({
      client,
      config: null,
      configDir,
      project: 'test',
      environment: 'dev',
      prune: false
    })

    expect(plan.summary.conflicts).toBe(1)
    expect(plan.changes).toHaveLength(0)
  })

  it('creates "delete" actions for remote-only vars when prune=true', async () => {
    const client = createMockClient([
      { key: 'REMOTE_ONLY', value: 'val' }
    ])

    const plan = await computePlan({
      client,
      config: null,
      configDir,
      project: 'test',
      environment: 'dev',
      prune: true
    })

    expect(plan.summary.toDelete).toBe(1)
    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0]).toMatchObject({
      key: 'REMOTE_ONLY',
      action: 'delete'
    })
  })

  it('handles mixed scenario: add + update + unchanged + remote-only', async () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'NEW',
      value: 'fresh',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    writeLocalVariable(configDir, 'dev', {
      key: 'UPDATED',
      value: 'v2',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    writeLocalVariable(configDir, 'dev', {
      key: 'SAME',
      value: 'same',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    const client = createMockClient([
      { key: 'UPDATED', value: 'v1' },
      { key: 'SAME', value: 'same' },
      { key: 'ORPHAN', value: 'old' }
    ])

    const plan = await computePlan({
      client,
      config: null,
      configDir,
      project: 'test',
      environment: 'dev'
    })

    expect(plan.summary.toAdd).toBe(1)
    expect(plan.summary.toUpdate).toBe(1)
    expect(plan.summary.unchanged).toBe(1)
    expect(plan.summary.conflicts).toBe(1) // ORPHAN is remote-only
    expect(plan.changes).toHaveLength(2)
  })

  it('respects scope filtering', async () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'SHARED_VAR',
      value: 'shared',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    writeLocalVariable(configDir, 'dev', {
      key: 'SVC_VAR',
      value: 'svc',
      scope: serviceScope('api'),
      sensitive: false
    }, { source: 'cli' })

    const client = createMockClient([])

    // Filter to shared only
    const plan = await computePlan({
      client,
      config: null,
      configDir,
      project: 'test',
      environment: 'dev',
      scope: sharedScope()
    })

    expect(plan.changes).toHaveLength(1)
    expect(plan.changes[0].key).toBe('SHARED_VAR')
  })

  it('generates plan with correct metadata', async () => {
    const client = createMockClient([])
    const plan = await computePlan({
      client,
      config: null,
      configDir,
      project: 'myproject',
      environment: 'prd'
    })

    expect(plan.project).toBe('myproject')
    expect(plan.environment).toBe('prd')
    expect(plan.status).toBe('planned')
    expect(plan.id).toMatch(/^myproject-prd-/)
    expect(plan.generatedAt).toBeTruthy()
  })

  it('matches local and remote vars by key AND scope', async () => {
    // Same key in different scopes
    writeLocalVariable(configDir, 'dev', {
      key: 'PORT',
      value: '3000',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    writeLocalVariable(configDir, 'dev', {
      key: 'PORT',
      value: '4000',
      scope: serviceScope('api'),
      sensitive: false
    }, { source: 'cli' })

    // Remote has PORT in shared with different value
    const client = createMockClient([
      { key: 'PORT', value: '2000' }, // shared (service=undefined → __shared__)
      { key: 'PORT', value: '4000', service: 'api' } // same as local
    ])

    const plan = await computePlan({
      client,
      config: null,
      configDir,
      project: 'test',
      environment: 'dev'
    })

    // Shared PORT is updated (3000 vs 2000), api PORT is unchanged
    expect(plan.summary.toUpdate).toBe(1)
    expect(plan.summary.unchanged).toBe(1)
    const updatedChange = plan.changes.find(c => c.action === 'update')
    expect(updatedChange?.key).toBe('PORT')
    expect(updatedChange?.scope).toEqual({ kind: 'shared' })
  })
})

// ============================================================================
// writePlanArtifact / readLatestPlan
// ============================================================================

describe('writePlanArtifact', () => {
  it('writes JSON and markdown files', () => {
    const plan: Plan = {
      id: 'test-dev-2026-01-01T00-00-00Z',
      project: 'test',
      environment: 'dev',
      scope: null,
      status: 'planned',
      generatedAt: '2026-01-01T00:00:00Z',
      changes: [{
        key: 'NEW_VAR',
        scope: sharedScope(),
        action: 'add',
        sensitive: false,
        localValue: 'hello'
      }],
      summary: { toAdd: 1, toUpdate: 0, toDelete: 0, unchanged: 0, conflicts: 0 },
      scorecard: {
        totalVars: 1, secrets: 0, configs: 1, services: [],
        drift: { localOnly: 1, remoteOnly: 0, conflicts: 0, synced: false },
        policy: { warnings: 0, violations: 0, issues: [] },
        required: { satisfied: 0, missing: [] },
        rotation: { overdue: 0, keys: [] },
        health: 'ok',
        issues: []
      }
    }

    const paths = writePlanArtifact(plan, artifactDir)

    expect(fs.existsSync(paths.json)).toBe(true)
    expect(fs.existsSync(paths.markdown)).toBe(true)

    const json = JSON.parse(fs.readFileSync(paths.json, 'utf-8'))
    expect(json.project).toBe('test')
    expect(json.changes).toHaveLength(1)

    const md = fs.readFileSync(paths.markdown, 'utf-8')
    expect(md).toContain('# Vaulter Plan')
    expect(md).toContain('NEW_VAR')
  })

  it('masks sensitive values in artifact', () => {
    const plan: Plan = {
      id: 'test-dev-2026-01-01T00-00-00Z',
      project: 'test',
      environment: 'dev',
      scope: null,
      status: 'planned',
      generatedAt: '2026-01-01T00:00:00Z',
      changes: [{
        key: 'API_KEY',
        scope: sharedScope(),
        action: 'add',
        sensitive: true,
        localValue: 'sk-1234567890abcdef'
      }],
      summary: { toAdd: 1, toUpdate: 0, toDelete: 0, unchanged: 0, conflicts: 0 },
      scorecard: {
        totalVars: 1, secrets: 1, configs: 0, services: [],
        drift: { localOnly: 1, remoteOnly: 0, conflicts: 0, synced: false },
        policy: { warnings: 0, violations: 0, issues: [] },
        required: { satisfied: 0, missing: [] },
        rotation: { overdue: 0, keys: [] },
        health: 'ok',
        issues: []
      }
    }

    const paths = writePlanArtifact(plan, artifactDir)
    const json = JSON.parse(fs.readFileSync(paths.json, 'utf-8'))

    // Sensitive value should be masked
    expect(json.changes[0].localValue).not.toBe('sk-1234567890abcdef')
    expect(json.changes[0].localValue).toContain('****')
  })
})

describe('readLatestPlan', () => {
  it('returns null when no plans exist', () => {
    const plan = readLatestPlan('dev', 'test', artifactDir)
    expect(plan).toBeNull()
  })

  it('reads the most recent plan', () => {
    // Create artifact dir
    fs.mkdirSync(artifactDir, { recursive: true })

    // Write two plans
    const plan1: Plan = {
      id: 'test-dev-2026-01-01T00-00-00-000Z',
      project: 'test',
      environment: 'dev',
      scope: null,
      status: 'planned',
      generatedAt: '2026-01-01T00:00:00.000Z',
      changes: [],
      summary: { toAdd: 0, toUpdate: 0, toDelete: 0, unchanged: 0, conflicts: 0 },
      scorecard: {
        totalVars: 0, secrets: 0, configs: 0, services: [],
        drift: { localOnly: 0, remoteOnly: 0, conflicts: 0, synced: true },
        policy: { warnings: 0, violations: 0, issues: [] },
        required: { satisfied: 0, missing: [] },
        rotation: { overdue: 0, keys: [] },
        health: 'ok',
        issues: []
      }
    }
    const plan2 = { ...plan1, id: 'test-dev-2026-02-01T00-00-00-000Z', generatedAt: '2026-02-01T00:00:00.000Z' }

    fs.writeFileSync(path.join(artifactDir, `${plan1.id}.json`), JSON.stringify(plan1))
    fs.writeFileSync(path.join(artifactDir, `${plan2.id}.json`), JSON.stringify(plan2))

    const result = readLatestPlan('dev', 'test', artifactDir)
    expect(result?.generatedAt).toBe('2026-02-01T00:00:00.000Z')
  })
})

// ============================================================================
// isPlanStale
// ============================================================================

describe('isPlanStale', () => {
  it('returns false when no provenance file exists', () => {
    const plan: Plan = {
      id: 'test',
      project: 'test',
      environment: 'dev',
      scope: null,
      status: 'planned',
      generatedAt: new Date().toISOString(),
      changes: [],
      summary: { toAdd: 0, toUpdate: 0, toDelete: 0, unchanged: 0, conflicts: 0 },
      scorecard: {
        totalVars: 0, secrets: 0, configs: 0, services: [],
        drift: { localOnly: 0, remoteOnly: 0, conflicts: 0, synced: true },
        policy: { warnings: 0, violations: 0, issues: [] },
        required: { satisfied: 0, missing: [] },
        rotation: { overdue: 0, keys: [] },
        health: 'ok',
        issues: []
      }
    }

    // isPlanStale expects the project root — it adds .vaulter internally
    expect(isPlanStale(plan, tmpDir)).toBe(false)
  })

  it('returns true when provenance was updated after plan generation', async () => {
    // Create a plan with timestamp in the past
    const plan: Plan = {
      id: 'test',
      project: 'test',
      environment: 'dev',
      scope: null,
      status: 'planned',
      generatedAt: '2020-01-01T00:00:00Z', // very old
      changes: [],
      summary: { toAdd: 0, toUpdate: 0, toDelete: 0, unchanged: 0, conflicts: 0 },
      scorecard: {
        totalVars: 0, secrets: 0, configs: 0, services: [],
        drift: { localOnly: 0, remoteOnly: 0, conflicts: 0, synced: true },
        policy: { warnings: 0, violations: 0, issues: [] },
        required: { satisfied: 0, missing: [] },
        rotation: { overdue: 0, keys: [] },
        health: 'ok',
        issues: []
      }
    }

    // Write a provenance entry (which updates the file mtime to now)
    writeLocalVariable(configDir, 'dev', {
      key: 'TEST',
      value: 'val',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    // isPlanStale expects the project root — it adds .vaulter internally
    expect(isPlanStale(plan, tmpDir)).toBe(true)
  })
})
