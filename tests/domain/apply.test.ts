import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { executePlan, updatePlanArtifact } from '../../src/domain/apply.js'
import { sharedScope, serviceScope } from '../../src/domain/types.js'
import type { Plan, PlanChange } from '../../src/domain/types.js'

// ============================================================================
// Helpers
// ============================================================================

function createMockClient(opts: { setFails?: boolean; deleteFails?: boolean } = {}) {
  return {
    set: opts.setFails
      ? vi.fn().mockRejectedValue(new Error('set failed'))
      : vi.fn().mockResolvedValue(undefined),
    delete: opts.deleteFails
      ? vi.fn().mockRejectedValue(new Error('delete failed'))
      : vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined)
  } as any
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'test-dev-2026-01-01T00-00-00Z',
    project: 'test',
    environment: 'dev',
    scope: null,
    status: 'planned',
    generatedAt: '2026-01-01T00:00:00Z',
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
    },
    ...overrides
  }
}

// ============================================================================
// executePlan
// ============================================================================

describe('executePlan', () => {
  it('returns success with zero counts for empty plan', async () => {
    const client = createMockClient()
    const plan = makePlan()

    const result = await executePlan({
      client,
      plan,
      config: null,
      project: 'test'
    })

    expect(result.success).toBe(true)
    expect(result.applied).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toEqual([])
    expect(result.updatedPlan.status).toBe('applied')
    expect(result.updatedPlan.appliedAt).toBeTruthy()
  })

  it('applies add changes via client.set', async () => {
    const client = createMockClient()
    const plan = makePlan({
      changes: [{
        key: 'NEW_VAR',
        scope: sharedScope(),
        action: 'add',
        sensitive: false,
        localValue: 'hello'
      }],
      summary: { toAdd: 1, toUpdate: 0, toDelete: 0, unchanged: 0, conflicts: 0 }
    })

    const result = await executePlan({
      client,
      plan,
      config: null,
      project: 'test'
    })

    expect(result.success).toBe(true)
    expect(result.applied).toBe(1)
    expect(client.set).toHaveBeenCalledTimes(1)
    expect(client.set).toHaveBeenCalledWith(expect.objectContaining({
      key: 'NEW_VAR',
      value: 'hello',
      project: 'test',
      environment: 'dev',
      sensitive: false
    }))
  })

  it('applies update changes via client.set', async () => {
    const client = createMockClient()
    const plan = makePlan({
      changes: [{
        key: 'EXISTING',
        scope: sharedScope(),
        action: 'update',
        sensitive: true,
        localValue: 'new-value',
        remoteValue: 'old-value'
      }]
    })

    const result = await executePlan({
      client,
      plan,
      config: null,
      project: 'test'
    })

    expect(result.success).toBe(true)
    expect(result.applied).toBe(1)
    expect(client.set).toHaveBeenCalledWith(expect.objectContaining({
      key: 'EXISTING',
      value: 'new-value',
      sensitive: true
    }))
  })

  it('applies delete changes via client.delete', async () => {
    const client = createMockClient()
    const plan = makePlan({
      changes: [{
        key: 'OLD_VAR',
        scope: sharedScope(),
        action: 'delete',
        sensitive: false,
        remoteValue: 'value'
      }]
    })

    const result = await executePlan({
      client,
      plan,
      config: null,
      project: 'test'
    })

    expect(result.success).toBe(true)
    expect(result.applied).toBe(1)
    expect(client.delete).toHaveBeenCalledTimes(1)
    // shared scope → service=undefined (not '__shared__')
    expect(client.delete).toHaveBeenCalledWith('OLD_VAR', 'test', 'dev', undefined)
  })

  it('passes service name for service-scoped changes', async () => {
    const client = createMockClient()
    const plan = makePlan({
      changes: [{
        key: 'SVC_VAR',
        scope: serviceScope('api'),
        action: 'add',
        sensitive: false,
        localValue: 'val'
      }]
    })

    const result = await executePlan({
      client,
      plan,
      config: null,
      project: 'test'
    })

    expect(result.success).toBe(true)
    expect(client.set).toHaveBeenCalledWith(expect.objectContaining({
      service: 'api'
    }))
  })

  it('handles mixed changes (add + update + delete)', async () => {
    const client = createMockClient()
    const plan = makePlan({
      changes: [
        { key: 'ADD', scope: sharedScope(), action: 'add', sensitive: false, localValue: 'a' },
        { key: 'UPD', scope: sharedScope(), action: 'update', sensitive: false, localValue: 'b', remoteValue: 'c' },
        { key: 'DEL', scope: sharedScope(), action: 'delete', sensitive: false, remoteValue: 'd' }
      ]
    })

    const result = await executePlan({
      client,
      plan,
      config: null,
      project: 'test'
    })

    expect(result.success).toBe(true)
    expect(result.applied).toBe(3)
    expect(client.set).toHaveBeenCalledTimes(2)
    expect(client.delete).toHaveBeenCalledTimes(1)
  })

  // ---- Error handling ----

  it('tracks errors without stopping execution', async () => {
    const client = createMockClient({ setFails: true })
    const plan = makePlan({
      changes: [
        { key: 'FAIL1', scope: sharedScope(), action: 'add', sensitive: false, localValue: 'a' },
        { key: 'FAIL2', scope: sharedScope(), action: 'add', sensitive: false, localValue: 'b' }
      ]
    })

    const result = await executePlan({
      client,
      plan,
      config: null,
      project: 'test'
    })

    expect(result.success).toBe(false)
    expect(result.failed).toBe(2)
    expect(result.applied).toBe(0)
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0].key).toBe('FAIL1')
    expect(result.errors[0].error).toContain('set failed')
    expect(result.updatedPlan.status).toBe('failed')
  })

  it('counts partial failures correctly', async () => {
    // First call succeeds, second fails
    const client = {
      set: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('second failed')),
      delete: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined)
    } as any

    const plan = makePlan({
      changes: [
        { key: 'OK', scope: sharedScope(), action: 'add', sensitive: false, localValue: 'a' },
        { key: 'FAIL', scope: sharedScope(), action: 'add', sensitive: false, localValue: 'b' }
      ]
    })

    const result = await executePlan({
      client,
      plan,
      config: null,
      project: 'test'
    })

    expect(result.success).toBe(false)
    expect(result.applied).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors[0].key).toBe('FAIL')
  })

  // ---- Production safety ----

  it('blocks production without --force (prd)', async () => {
    const client = createMockClient()
    const plan = makePlan({
      environment: 'prd',
      changes: [{ key: 'X', scope: sharedScope(), action: 'add', sensitive: false, localValue: 'v' }]
    })

    const result = await executePlan({
      client,
      plan,
      config: null,
      project: 'test',
      force: false
    })

    expect(result.success).toBe(false)
    expect(result.skipped).toBe(1)
    expect(result.applied).toBe(0)
    expect(result.errors[0].error).toContain('--force')
    expect(result.updatedPlan.status).toBe('failed')
    expect(client.set).not.toHaveBeenCalled()
  })

  it('blocks production without --force (prod)', async () => {
    const client = createMockClient()
    const plan = makePlan({ environment: 'prod', changes: [{ key: 'X', scope: sharedScope(), action: 'add', sensitive: false, localValue: 'v' }] })
    const result = await executePlan({ client, plan, config: null, project: 'test' })
    expect(result.success).toBe(false)
  })

  it('blocks production without --force (production)', async () => {
    const client = createMockClient()
    const plan = makePlan({ environment: 'production', changes: [{ key: 'X', scope: sharedScope(), action: 'add', sensitive: false, localValue: 'v' }] })
    const result = await executePlan({ client, plan, config: null, project: 'test' })
    expect(result.success).toBe(false)
  })

  it('allows production with --force', async () => {
    const client = createMockClient()
    const plan = makePlan({
      environment: 'prd',
      changes: [{ key: 'X', scope: sharedScope(), action: 'add', sensitive: false, localValue: 'v' }]
    })

    const result = await executePlan({
      client,
      plan,
      config: null,
      project: 'test',
      force: true
    })

    expect(result.success).toBe(true)
    expect(result.applied).toBe(1)
  })

  it('does not block non-production environments', async () => {
    const client = createMockClient()
    for (const env of ['dev', 'stg', 'staging', 'test', 'qa']) {
      const plan = makePlan({
        environment: env,
        changes: [{ key: 'X', scope: sharedScope(), action: 'add', sensitive: false, localValue: 'v' }]
      })

      const result = await executePlan({
        client,
        plan,
        config: null,
        project: 'test'
      })

      expect(result.success).toBe(true)
    }
  })

  // ---- Dry run ----

  it('does not execute changes in dry-run mode', async () => {
    const client = createMockClient()
    const plan = makePlan({
      changes: [
        { key: 'A', scope: sharedScope(), action: 'add', sensitive: false, localValue: 'v' },
        { key: 'B', scope: sharedScope(), action: 'delete', sensitive: false, remoteValue: 'x' }
      ]
    })

    const result = await executePlan({
      client,
      plan,
      config: null,
      project: 'test',
      dryRun: true
    })

    expect(result.success).toBe(true)
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(2)
    expect(result.updatedPlan.status).toBe('planned')
    expect(client.set).not.toHaveBeenCalled()
    expect(client.delete).not.toHaveBeenCalled()
  })
})

// ============================================================================
// updatePlanArtifact
// ============================================================================

describe('updatePlanArtifact', () => {
  it('updates existing plan artifact file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-apply-test-'))
    const planPath = path.join(tmpDir, 'plan.json')
    const plan = makePlan({ status: 'applied', appliedAt: '2026-01-02T00:00:00Z' })

    fs.writeFileSync(planPath, '{}')
    updatePlanArtifact(planPath, plan)

    const updated = JSON.parse(fs.readFileSync(planPath, 'utf-8'))
    expect(updated.status).toBe('applied')
    expect(updated.appliedAt).toBe('2026-01-02T00:00:00Z')

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('does nothing when file does not exist', () => {
    // Should not throw
    updatePlanArtifact('/nonexistent/path/plan.json', makePlan())
  })
})
