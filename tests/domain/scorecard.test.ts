import { describe, it, expect } from 'vitest'
import { buildScorecard } from '../../src/domain/scorecard.js'
import { sharedScope, serviceScope, emptyGovernanceResult } from '../../src/domain/types.js'
import type {
  ResolvedVariable,
  PlanChange,
  GovernanceResult,
  Scope
} from '../../src/domain/types.js'

// ============================================================================
// Helpers
// ============================================================================

function makeVar(key: string, scope: Scope, opts: { sensitive?: boolean; value?: string } = {}): ResolvedVariable {
  return {
    key,
    value: opts.value ?? 'val',
    environment: 'dev',
    scope,
    sensitive: opts.sensitive ?? false,
    lifecycle: 'active'
  }
}

function makeRemote(key: string, scope: Scope, opts: { sensitive?: boolean; value?: string } = {}) {
  return {
    key,
    value: opts.value ?? 'val',
    scope,
    sensitive: opts.sensitive ?? false
  }
}

function makeChange(key: string, action: 'add' | 'update' | 'delete', scope: Scope = sharedScope()): PlanChange {
  return {
    key,
    scope,
    action,
    sensitive: false,
    localValue: action !== 'delete' ? 'val' : undefined,
    remoteValue: action !== 'add' ? 'old' : undefined
  }
}

const emptyGov = emptyGovernanceResult

// ============================================================================
// buildScorecard
// ============================================================================

describe('buildScorecard', () => {
  it('returns empty scorecard for no vars', () => {
    const sc = buildScorecard({
      localVars: [],
      remoteVars: [],
      changes: [],
      governance: emptyGov(),
      config: null,
      environment: 'dev'
    })

    expect(sc.totalVars).toBe(0)
    expect(sc.secrets).toBe(0)
    expect(sc.configs).toBe(0)
    expect(sc.services).toEqual([])
    expect(sc.drift.synced).toBe(true)
    expect(sc.health).toBe('ok')
    expect(sc.issues).toEqual([])
  })

  it('counts secrets and configs correctly', () => {
    const sc = buildScorecard({
      localVars: [
        makeVar('DB_URL', sharedScope(), { sensitive: true }),
        makeVar('API_KEY', sharedScope(), { sensitive: true }),
        makeVar('LOG_LEVEL', sharedScope(), { sensitive: false }),
        makeVar('NODE_ENV', sharedScope(), { sensitive: false }),
        makeVar('DEBUG', sharedScope(), { sensitive: false })
      ],
      remoteVars: [],
      changes: [],
      governance: emptyGov(),
      config: null,
      environment: 'dev'
    })

    expect(sc.totalVars).toBe(5)
    expect(sc.secrets).toBe(2)
    expect(sc.configs).toBe(3)
  })

  // ---- Service statuses ----

  it('computes service statuses with shared inheritance', () => {
    const sc = buildScorecard({
      localVars: [
        makeVar('SHARED1', sharedScope()),
        makeVar('SHARED2', sharedScope()),
        makeVar('API_PORT', serviceScope('api')),
        makeVar('WEB_PORT', serviceScope('web')),
        makeVar('WEB_URL', serviceScope('web'))
      ],
      remoteVars: [],
      changes: [],
      governance: emptyGov(),
      config: null,
      environment: 'dev'
    })

    expect(sc.services).toHaveLength(2)

    const api = sc.services.find(s => s.name === 'api')!
    expect(api.serviceCount).toBe(1)
    expect(api.sharedCount).toBe(2)
    expect(api.varCount).toBe(3) // 1 service + 2 shared

    const web = sc.services.find(s => s.name === 'web')!
    expect(web.serviceCount).toBe(2)
    expect(web.sharedCount).toBe(2)
    expect(web.varCount).toBe(4) // 2 service + 2 shared
  })

  it('shows shared-only entry when no services exist', () => {
    const sc = buildScorecard({
      localVars: [
        makeVar('VAR1', sharedScope()),
        makeVar('VAR2', sharedScope())
      ],
      remoteVars: [],
      changes: [],
      governance: emptyGov(),
      config: null,
      environment: 'dev'
    })

    expect(sc.services).toHaveLength(1)
    expect(sc.services[0].name).toBe('shared')
    expect(sc.services[0].varCount).toBe(2)
    expect(sc.services[0].sharedCount).toBe(2)
    expect(sc.services[0].serviceCount).toBe(0)
  })

  it('includes known services with no local vars', () => {
    const sc = buildScorecard({
      localVars: [
        makeVar('SHARED', sharedScope()),
        makeVar('API_VAR', serviceScope('api'))
      ],
      remoteVars: [],
      changes: [],
      governance: emptyGov(),
      config: null,
      environment: 'dev',
      knownServices: ['api', 'worker']
    })

    expect(sc.services).toHaveLength(2)
    const worker = sc.services.find(s => s.name === 'worker')!
    expect(worker.serviceCount).toBe(0)
    expect(worker.sharedCount).toBe(1) // inherits shared
    expect(worker.varCount).toBe(1)
    expect(worker.lifecycle).toBe('active')
  })

  it('marks unknown services as orphan', () => {
    const sc = buildScorecard({
      localVars: [
        makeVar('OLD_VAR', serviceScope('removed-svc'))
      ],
      remoteVars: [],
      changes: [],
      governance: emptyGov(),
      config: null,
      environment: 'dev',
      knownServices: ['api', 'web']
    })

    const orphan = sc.services.find(s => s.name === 'removed-svc')!
    expect(orphan.lifecycle).toBe('orphan')
  })

  // ---- Drift ----

  it('computes drift from changes (adds = localOnly)', () => {
    const sc = buildScorecard({
      localVars: [makeVar('NEW', sharedScope())],
      remoteVars: [],
      changes: [makeChange('NEW', 'add')],
      governance: emptyGov(),
      config: null,
      environment: 'dev'
    })

    expect(sc.drift.localOnly).toBe(1)
    expect(sc.drift.remoteOnly).toBe(0)
    expect(sc.drift.conflicts).toBe(0)
    expect(sc.drift.synced).toBe(false)
  })

  it('computes drift from changes (updates = conflicts)', () => {
    const sc = buildScorecard({
      localVars: [makeVar('UPD', sharedScope(), { value: 'new' })],
      remoteVars: [makeRemote('UPD', sharedScope(), { value: 'old' })],
      changes: [makeChange('UPD', 'update')],
      governance: emptyGov(),
      config: null,
      environment: 'dev'
    })

    expect(sc.drift.conflicts).toBe(1)
    expect(sc.drift.synced).toBe(false)
  })

  it('computes drift from changes (deletes = remoteOnly)', () => {
    const sc = buildScorecard({
      localVars: [],
      remoteVars: [makeRemote('DEL', sharedScope())],
      changes: [makeChange('DEL', 'delete')],
      governance: emptyGov(),
      config: null,
      environment: 'dev'
    })

    expect(sc.drift.remoteOnly).toBe(1)
    expect(sc.drift.synced).toBe(false)
  })

  it('counts unmatched remote vars as remoteOnly (not pruned)', () => {
    const sc = buildScorecard({
      localVars: [],
      remoteVars: [
        makeRemote('ORPHAN1', sharedScope()),
        makeRemote('ORPHAN2', sharedScope())
      ],
      changes: [], // no prune → no delete changes
      governance: emptyGov(),
      config: null,
      environment: 'dev'
    })

    expect(sc.drift.remoteOnly).toBe(2)
    expect(sc.drift.synced).toBe(false)
  })

  it('reports synced when everything matches', () => {
    const sc = buildScorecard({
      localVars: [makeVar('SAME', sharedScope(), { value: 'x' })],
      remoteVars: [makeRemote('SAME', sharedScope(), { value: 'x' })],
      changes: [], // no diff
      governance: emptyGov(),
      config: null,
      environment: 'dev'
    })

    expect(sc.drift.synced).toBe(true)
    expect(sc.drift.localOnly).toBe(0)
    expect(sc.drift.remoteOnly).toBe(0)
    expect(sc.drift.conflicts).toBe(0)
  })

  // ---- Health determination ----

  it('returns ok health when no issues', () => {
    const sc = buildScorecard({
      localVars: [],
      remoteVars: [],
      changes: [],
      governance: emptyGov(),
      config: null,
      environment: 'dev'
    })

    expect(sc.health).toBe('ok')
  })

  it('returns warning health when there are warnings', () => {
    const sc = buildScorecard({
      localVars: [makeVar('NEW', sharedScope())],
      remoteVars: [makeRemote('ORPHAN', sharedScope())],
      changes: [makeChange('NEW', 'add')],
      governance: emptyGov(),
      config: null,
      environment: 'dev'
    })

    // drift has remote-only → warning issue
    expect(sc.health).toBe('warning')
  })

  it('returns critical health when governance is blocked', () => {
    const blockedGov: GovernanceResult = {
      ...emptyGov(),
      blocked: true,
      policy: {
        warnings: 0,
        violations: 1,
        issues: [{ key: 'BAD', rule: 'test', message: 'violation' }]
      }
    }

    const sc = buildScorecard({
      localVars: [makeVar('BAD', sharedScope())],
      remoteVars: [],
      changes: [],
      governance: blockedGov,
      config: null,
      environment: 'dev'
    })

    expect(sc.health).toBe('critical')
  })

  it('returns critical health when there are error-severity issues', () => {
    const govWithMissing: GovernanceResult = {
      ...emptyGov(),
      required: { satisfied: 0, missing: ['REQUIRED_VAR'] }
    }

    const sc = buildScorecard({
      localVars: [],
      remoteVars: [],
      changes: [],
      governance: govWithMissing,
      config: null,
      environment: 'dev'
    })

    expect(sc.health).toBe('critical')
  })

  // ---- Issue collection ----

  it('collects drift issues', () => {
    const sc = buildScorecard({
      localVars: [makeVar('NEW', sharedScope())],
      remoteVars: [],
      changes: [makeChange('NEW', 'add')],
      governance: emptyGov(),
      config: null,
      environment: 'dev'
    })

    const driftIssues = sc.issues.filter(i => i.category === 'drift')
    expect(driftIssues.length).toBeGreaterThan(0)
    expect(driftIssues[0].message).toContain('locally but not in backend')
  })

  it('collects required variable issues', () => {
    const gov: GovernanceResult = {
      ...emptyGov(),
      required: { satisfied: 1, missing: ['API_KEY', 'DB_URL'] }
    }

    const sc = buildScorecard({
      localVars: [],
      remoteVars: [],
      changes: [],
      governance: gov,
      config: null,
      environment: 'dev'
    })

    const reqIssues = sc.issues.filter(i => i.category === 'required')
    expect(reqIssues).toHaveLength(2)
    expect(reqIssues[0].severity).toBe('error')
    expect(reqIssues[0].key).toBe('API_KEY')
  })

  it('collects rotation issues', () => {
    const gov: GovernanceResult = {
      ...emptyGov(),
      rotation: {
        overdue: 1,
        keys: [{ key: 'OLD_SECRET', lastRotated: '2025-01-01', maxAgeDays: 90 }]
      }
    }

    const sc = buildScorecard({
      localVars: [],
      remoteVars: [],
      changes: [],
      governance: gov,
      config: null,
      environment: 'dev'
    })

    const rotIssues = sc.issues.filter(i => i.category === 'rotation')
    expect(rotIssues).toHaveLength(1)
    expect(rotIssues[0].severity).toBe('warning')
    expect(rotIssues[0].message).toContain('OLD_SECRET')
  })

  it('collects orphan service issues', () => {
    const sc = buildScorecard({
      localVars: [makeVar('VAR', serviceScope('old-svc'))],
      remoteVars: [],
      changes: [],
      governance: emptyGov(),
      config: null,
      environment: 'dev',
      knownServices: ['api']
    })

    const orphanIssues = sc.issues.filter(i => i.category === 'orphan')
    expect(orphanIssues).toHaveLength(1)
    expect(orphanIssues[0].message).toContain('old-svc')
  })

  it('collects policy issues from governance', () => {
    const gov: GovernanceResult = {
      ...emptyGov(),
      policy: {
        warnings: 1,
        violations: 0,
        issues: [{ key: 'WEAK_KEY', rule: 'naming', message: 'bad naming' }]
      }
    }

    const sc = buildScorecard({
      localVars: [],
      remoteVars: [],
      changes: [],
      governance: gov,
      config: null,
      environment: 'dev'
    })

    const polIssues = sc.issues.filter(i => i.category === 'policy')
    expect(polIssues).toHaveLength(1)
    expect(polIssues[0].key).toBe('WEAK_KEY')
  })

  // ---- Passes through governance fields ----

  it('copies governance policy/required/rotation into scorecard', () => {
    const gov: GovernanceResult = {
      blocked: false,
      warnings: [],
      suggestions: [],
      policy: { warnings: 2, violations: 0, issues: [] },
      required: { satisfied: 5, missing: [] },
      rotation: { overdue: 0, keys: [] }
    }

    const sc = buildScorecard({
      localVars: [],
      remoteVars: [],
      changes: [],
      governance: gov,
      config: null,
      environment: 'dev'
    })

    expect(sc.policy.warnings).toBe(2)
    expect(sc.required.satisfied).toBe(5)
    expect(sc.rotation.overdue).toBe(0)
  })
})
