import { describe, it, expect } from 'vitest'
import {
  sharedScope,
  serviceScope,
  parseScope,
  scopeToService,
  serviceToScope,
  formatScope,
  scopesEqual,
  serializeScope,
  deserializeScope,
  emptyScorecard,
  emptyPlanSummary,
  emptyGovernanceResult
} from '../../src/domain/types.js'

describe('Scope', () => {
  describe('sharedScope', () => {
    it('creates a shared scope', () => {
      const scope = sharedScope()
      expect(scope).toEqual({ kind: 'shared' })
    })
  })

  describe('serviceScope', () => {
    it('creates a service scope', () => {
      const scope = serviceScope('svc-auth')
      expect(scope).toEqual({ kind: 'service', name: 'svc-auth' })
    })
  })

  describe('parseScope', () => {
    it('parses "shared"', () => {
      expect(parseScope('shared')).toEqual({ kind: 'shared' })
    })

    it('parses "SHARED" (case insensitive)', () => {
      expect(parseScope('SHARED')).toEqual({ kind: 'shared' })
    })

    it('parses "__shared__"', () => {
      expect(parseScope('__shared__')).toEqual({ kind: 'shared' })
    })

    it('parses "service:svc-auth"', () => {
      expect(parseScope('service:svc-auth')).toEqual({ kind: 'service', name: 'svc-auth' })
    })

    it('parses bare service name', () => {
      expect(parseScope('svc-auth')).toEqual({ kind: 'service', name: 'svc-auth' })
    })

    it('returns null for empty string', () => {
      expect(parseScope('')).toBeNull()
    })

    it('returns null for undefined', () => {
      expect(parseScope(undefined)).toBeNull()
    })

    it('returns null for whitespace', () => {
      expect(parseScope('   ')).toBeNull()
    })

    it('returns null for "service:" with no name', () => {
      expect(parseScope('service:')).toBeNull()
    })

    it('trims whitespace', () => {
      expect(parseScope('  shared  ')).toEqual({ kind: 'shared' })
    })

    it('returns null for unknown colon prefix', () => {
      expect(parseScope('unknown:something')).toBeNull()
    })
  })

  describe('scopeToService', () => {
    it('converts shared to __shared__', () => {
      expect(scopeToService(sharedScope())).toBe('__shared__')
    })

    it('converts service to name', () => {
      expect(scopeToService(serviceScope('svc-auth'))).toBe('svc-auth')
    })
  })

  describe('serviceToScope', () => {
    it('converts __shared__ to shared scope', () => {
      expect(serviceToScope('__shared__')).toEqual({ kind: 'shared' })
    })

    it('converts undefined to shared scope', () => {
      expect(serviceToScope(undefined)).toEqual({ kind: 'shared' })
    })

    it('converts service name to service scope', () => {
      expect(serviceToScope('svc-auth')).toEqual({ kind: 'service', name: 'svc-auth' })
    })
  })

  describe('formatScope', () => {
    it('formats shared scope', () => {
      expect(formatScope(sharedScope())).toBe('shared')
    })

    it('formats service scope', () => {
      expect(formatScope(serviceScope('svc-auth'))).toBe('svc-auth')
    })
  })

  describe('scopesEqual', () => {
    it('shared equals shared', () => {
      expect(scopesEqual(sharedScope(), sharedScope())).toBe(true)
    })

    it('same service equals same service', () => {
      expect(scopesEqual(serviceScope('a'), serviceScope('a'))).toBe(true)
    })

    it('different services are not equal', () => {
      expect(scopesEqual(serviceScope('a'), serviceScope('b'))).toBe(false)
    })

    it('shared does not equal service', () => {
      expect(scopesEqual(sharedScope(), serviceScope('a'))).toBe(false)
    })
  })

  describe('serializeScope / deserializeScope', () => {
    it('round-trips shared', () => {
      const scope = sharedScope()
      expect(deserializeScope(serializeScope(scope))).toEqual(scope)
    })

    it('round-trips service', () => {
      const scope = serviceScope('svc-auth')
      expect(deserializeScope(serializeScope(scope))).toEqual(scope)
    })

    it('serializes shared to "shared"', () => {
      expect(serializeScope(sharedScope())).toBe('shared')
    })

    it('serializes service to "service:name"', () => {
      expect(serializeScope(serviceScope('api'))).toBe('service:api')
    })

    it('deserializes unknown format as service', () => {
      expect(deserializeScope('api')).toEqual({ kind: 'service', name: 'api' })
    })
  })
})

describe('Empty Factories', () => {
  describe('emptyScorecard', () => {
    it('returns a valid empty scorecard', () => {
      const s = emptyScorecard()
      expect(s.totalVars).toBe(0)
      expect(s.secrets).toBe(0)
      expect(s.configs).toBe(0)
      expect(s.services).toEqual([])
      expect(s.drift.synced).toBe(true)
      expect(s.policy.warnings).toBe(0)
      expect(s.required.missing).toEqual([])
      expect(s.rotation.overdue).toBe(0)
      expect(s.health).toBe('ok')
      expect(s.issues).toEqual([])
    })
  })

  describe('emptyPlanSummary', () => {
    it('returns zeroed counts', () => {
      const s = emptyPlanSummary()
      expect(s.toAdd).toBe(0)
      expect(s.toUpdate).toBe(0)
      expect(s.toDelete).toBe(0)
      expect(s.unchanged).toBe(0)
      expect(s.conflicts).toBe(0)
    })
  })

  describe('emptyGovernanceResult', () => {
    it('returns non-blocking result', () => {
      const r = emptyGovernanceResult()
      expect(r.blocked).toBe(false)
      expect(r.warnings).toEqual([])
      expect(r.suggestions).toEqual([])
      expect(r.policy.violations).toBe(0)
      expect(r.required.missing).toEqual([])
      expect(r.rotation.overdue).toBe(0)
    })
  })
})
