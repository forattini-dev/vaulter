import { describe, it, expect } from 'vitest'
import { checkGovernance, checkSingleVariable } from '../../src/domain/governance.js'
import { sharedScope, serviceScope } from '../../src/domain/types.js'
import type { ResolvedVariable } from '../../src/domain/types.js'
import type { VaulterConfig } from '../../src/types.js'

function makeVar(overrides: Partial<ResolvedVariable> = {}): ResolvedVariable {
  return {
    key: 'TEST_VAR',
    value: 'test-value',
    environment: 'dev',
    scope: sharedScope(),
    sensitive: false,
    lifecycle: 'active',
    ...overrides
  }
}

function makeConfig(overrides: Partial<VaulterConfig> = {}): VaulterConfig {
  return {
    version: '1',
    project: 'test-project',
    ...overrides
  }
}

describe('checkGovernance', () => {
  it('returns empty result for no variables', () => {
    const result = checkGovernance({
      variables: [],
      config: makeConfig(),
      environment: 'dev'
    })

    expect(result.blocked).toBe(false)
    expect(result.warnings).toEqual([])
    expect(result.suggestions).toEqual([])
    expect(result.policy.violations).toBe(0)
    expect(result.required.missing).toEqual([])
    expect(result.rotation.overdue).toBe(0)
  })

  it('returns clean result for well-scoped variables', () => {
    const vars = [
      makeVar({ key: 'LOG_LEVEL', scope: sharedScope() }),
      makeVar({ key: 'PORT', scope: serviceScope('svc-auth') })
    ]

    const result = checkGovernance({
      variables: vars,
      config: makeConfig(),
      environment: 'dev'
    })

    expect(result.blocked).toBe(false)
    expect(result.policy.violations).toBe(0)
  })

  describe('scope policy', () => {
    it('warns when MAILGUN_* is in shared scope (default rules)', () => {
      const vars = [
        makeVar({ key: 'MAILGUN_API_KEY', scope: sharedScope() })
      ]

      const result = checkGovernance({
        variables: vars,
        config: makeConfig(),
        environment: 'dev'
      })

      expect(result.policy.warnings).toBeGreaterThan(0)
      expect(result.policy.issues).toHaveLength(1)
      expect(result.policy.issues[0].key).toBe('MAILGUN_API_KEY')
    })

    it('does not warn when MAILGUN_* is in svc-notifications', () => {
      const vars = [
        makeVar({ key: 'MAILGUN_API_KEY', scope: serviceScope('svc-notifications') })
      ]

      const result = checkGovernance({
        variables: vars,
        config: makeConfig(),
        environment: 'dev'
      })

      expect(result.policy.issues).toHaveLength(0)
    })

    it('respects scope_policy off mode', () => {
      const vars = [
        makeVar({ key: 'MAILGUN_API_KEY', scope: sharedScope() })
      ]

      const result = checkGovernance({
        variables: vars,
        config: makeConfig({
          scope_policy: { mode: 'off' }
        }),
        environment: 'dev'
      })

      expect(result.policy.warnings).toBe(0)
      expect(result.policy.violations).toBe(0)
    })

    it('blocks in strict mode', () => {
      const vars = [
        makeVar({ key: 'MAILGUN_API_KEY', scope: sharedScope() })
      ]

      const result = checkGovernance({
        variables: vars,
        config: makeConfig({
          scope_policy: { mode: 'strict' }
        }),
        environment: 'dev'
      })

      expect(result.blocked).toBe(true)
      expect(result.policy.violations).toBeGreaterThan(0)
    })
  })

  describe('required vars', () => {
    it('reports missing required vars from sync.required', () => {
      const vars = [
        makeVar({ key: 'LOG_LEVEL' })
      ]

      const result = checkGovernance({
        variables: vars,
        config: makeConfig({
          sync: {
            required: {
              prd: ['DATABASE_URL', 'JWT_SECRET']
            }
          }
        }),
        environment: 'prd'
      })

      expect(result.required.missing).toEqual(['DATABASE_URL', 'JWT_SECRET'])
      expect(result.required.satisfied).toBe(0)
      expect(result.suggestions.length).toBeGreaterThan(0)
    })

    it('reports satisfied when all required are present', () => {
      const vars = [
        makeVar({ key: 'DATABASE_URL' }),
        makeVar({ key: 'JWT_SECRET' })
      ]

      const result = checkGovernance({
        variables: vars,
        config: makeConfig({
          sync: {
            required: {
              prd: ['DATABASE_URL', 'JWT_SECRET']
            }
          }
        }),
        environment: 'prd'
      })

      expect(result.required.missing).toEqual([])
      expect(result.required.satisfied).toBe(2)
    })

    it('ignores required for different environment', () => {
      const vars: ResolvedVariable[] = []

      const result = checkGovernance({
        variables: vars,
        config: makeConfig({
          sync: {
            required: {
              prd: ['DATABASE_URL']
            }
          }
        }),
        environment: 'dev'
      })

      expect(result.required.missing).toEqual([])
    })
  })

  describe('orphan detection', () => {
    it('warns about unknown services', () => {
      const vars = [
        makeVar({ key: 'PORT', scope: serviceScope('svc-old-api') })
      ]

      const result = checkGovernance({
        variables: vars,
        config: makeConfig(),
        environment: 'dev',
        knownServices: ['svc-auth', 'svc-api']
      })

      expect(result.warnings.some(w => w.includes('svc-old-api'))).toBe(true)
      expect(result.suggestions.some(s => s.includes('orphan'))).toBe(true)
    })

    it('does not warn for known services', () => {
      const vars = [
        makeVar({ key: 'PORT', scope: serviceScope('svc-auth') })
      ]

      const result = checkGovernance({
        variables: vars,
        config: makeConfig(),
        environment: 'dev',
        knownServices: ['svc-auth', 'svc-api']
      })

      expect(result.warnings.filter(w => w.includes('orphan'))).toHaveLength(0)
    })

    it('skips orphan check when knownServices not provided', () => {
      const vars = [
        makeVar({ key: 'PORT', scope: serviceScope('svc-unknown') })
      ]

      const result = checkGovernance({
        variables: vars,
        config: makeConfig(),
        environment: 'dev'
      })

      // No orphan warnings because knownServices was not provided
      expect(result.warnings.filter(w => w.includes('orphan'))).toHaveLength(0)
    })
  })
})

describe('checkSingleVariable', () => {
  it('returns clean for well-scoped variable', () => {
    const result = checkSingleVariable({
      key: 'LOG_LEVEL',
      value: 'debug',
      scope: sharedScope(),
      sensitive: false,
      environment: 'dev',
      config: makeConfig()
    })

    expect(result.blocked).toBe(false)
    expect(result.warnings).toEqual([])
  })

  it('returns warning for scope violation', () => {
    const result = checkSingleVariable({
      key: 'MAILGUN_API_KEY',
      value: 'xxx',
      scope: sharedScope(),
      sensitive: true,
      environment: 'dev',
      config: makeConfig()
    })

    expect(result.blocked).toBe(false)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('blocks in strict mode', () => {
    const result = checkSingleVariable({
      key: 'MAILGUN_API_KEY',
      value: 'xxx',
      scope: sharedScope(),
      sensitive: true,
      environment: 'dev',
      config: makeConfig({ scope_policy: { mode: 'strict' } })
    })

    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBeTruthy()
  })

  it('works with null config', () => {
    const result = checkSingleVariable({
      key: 'ANYTHING',
      value: 'value',
      scope: sharedScope(),
      sensitive: false,
      environment: 'dev',
      config: null
    })

    expect(result.blocked).toBe(false)
  })

  describe('sensitive auto-correct', () => {
    it('auto-corrects sensitive for key with _SECRET suffix', () => {
      const result = checkSingleVariable({
        key: 'JWT_SECRET', value: 'xxx', scope: sharedScope(),
        sensitive: false, environment: 'dev', config: makeConfig()
      })
      expect(result.sensitiveAutoCorrect).toBe(true)
      expect(result.effectiveSensitive).toBe(true)
      // Warning for sensitive-key-pattern should be removed (auto-fixed)
      expect(result.warnings.some(w => w.includes('sensitive'))).toBe(false)
    })

    it('auto-corrects for _TOKEN suffix', () => {
      const result = checkSingleVariable({
        key: 'ACCESS_TOKEN', value: 'xxx', scope: sharedScope(),
        sensitive: false, environment: 'dev', config: makeConfig()
      })
      expect(result.sensitiveAutoCorrect).toBe(true)
      expect(result.effectiveSensitive).toBe(true)
    })

    it('does not auto-correct when sensitive already true', () => {
      const result = checkSingleVariable({
        key: 'JWT_SECRET', value: 'xxx', scope: sharedScope(),
        sensitive: true, environment: 'dev', config: makeConfig()
      })
      expect(result.sensitiveAutoCorrect).toBe(false)
      expect(result.effectiveSensitive).toBe(true)
    })

    it('does not auto-correct for non-secret key names', () => {
      const result = checkSingleVariable({
        key: 'LOG_LEVEL', value: 'debug', scope: sharedScope(),
        sensitive: false, environment: 'dev', config: makeConfig()
      })
      expect(result.sensitiveAutoCorrect).toBe(false)
      expect(result.effectiveSensitive).toBe(false)
    })
  })

  describe('suggestions surfacing', () => {
    it('returns suggestions from governance result', () => {
      const result = checkSingleVariable({
        key: 'LOG_LEVEL', value: 'debug', scope: sharedScope(),
        sensitive: false, environment: 'prd',
        config: makeConfig({
          sync: { required: { prd: ['DATABASE_URL'] } }
        })
      })
      expect(result.suggestions.length).toBeGreaterThan(0)
      expect(result.suggestions.some(s => s.includes('DATABASE_URL'))).toBe(true)
    })

    it('returns empty suggestions when no issues', () => {
      const result = checkSingleVariable({
        key: 'LOG_LEVEL', value: 'debug', scope: sharedScope(),
        sensitive: false, environment: 'dev', config: makeConfig()
      })
      expect(result.suggestions).toEqual([])
    })
  })
})

// ============================================================================
// Value Guardrails (check #6)
// ============================================================================

describe('value guardrails', () => {
  describe('empty/whitespace blocking', () => {
    it('blocks empty value', () => {
      const result = checkGovernance({
        variables: [makeVar({ key: 'DB_URL', value: '' })],
        config: makeConfig(),
        environment: 'dev'
      })
      expect(result.blocked).toBe(true)
      expect(result.guardrails.blocked).toBe(true)
      expect(result.guardrails.issues).toEqual([
        expect.objectContaining({ code: 'empty-value', severity: 'error' })
      ])
    })

    it('blocks whitespace-only value', () => {
      const result = checkGovernance({
        variables: [makeVar({ key: 'DB_URL', value: '   ' })],
        config: makeConfig(),
        environment: 'dev'
      })
      expect(result.blocked).toBe(true)
      expect(result.guardrails.issues).toEqual([
        expect.objectContaining({ code: 'whitespace-value', severity: 'error' })
      ])
    })

    it('does not block value "0"', () => {
      const result = checkGovernance({
        variables: [makeVar({ value: '0' })],
        config: makeConfig(),
        environment: 'dev'
      })
      expect(result.guardrails.blocked).toBe(false)
    })

    it('does not block value "false"', () => {
      const result = checkGovernance({
        variables: [makeVar({ value: 'false' })],
        config: makeConfig(),
        environment: 'dev'
      })
      expect(result.guardrails.blocked).toBe(false)
    })
  })

  describe('placeholder detection', () => {
    for (const placeholder of ['TODO', 'CHANGEME', 'PLACEHOLDER', 'FIXME', 'xxx', 'your-key-here']) {
      it(`detects "${placeholder}" as placeholder`, () => {
        const result = checkGovernance({
          variables: [makeVar({ key: 'API_KEY', value: placeholder })],
          config: makeConfig(),
          environment: 'prd'
        })
        expect(result.guardrails.issues).toEqual([
          expect.objectContaining({ code: 'placeholder', severity: 'warning' })
        ])
        expect(result.guardrails.blocked).toBe(false)
      })
    }

    it('detects template syntax ${VAR} as placeholder', () => {
      const result = checkGovernance({
        variables: [makeVar({ key: 'API_KEY', value: '${API_KEY}' })],
        config: makeConfig(),
        environment: 'dev'
      })
      expect(result.guardrails.issues).toEqual([
        expect.objectContaining({ code: 'placeholder' })
      ])
    })

    it('does not flag normal values as placeholder', () => {
      const result = checkGovernance({
        variables: [makeVar({ key: 'API_KEY', value: 'sk-abc123' })],
        config: makeConfig(),
        environment: 'prd'
      })
      expect(result.guardrails.issues.filter(i => i.code === 'placeholder')).toEqual([])
    })
  })

  describe('localhost-in-prd', () => {
    it('warns about localhost in prd', () => {
      const result = checkGovernance({
        variables: [makeVar({ key: 'SVC_AUTH_URL', value: 'http://localhost:3000' })],
        config: makeConfig(),
        environment: 'prd'
      })
      expect(result.guardrails.issues).toEqual([
        expect.objectContaining({ code: 'localhost-in-prd', severity: 'warning' })
      ])
    })

    it('warns about 127.0.0.1 in prd', () => {
      const result = checkGovernance({
        variables: [makeVar({ key: 'SVC_AUTH_URL', value: 'http://127.0.0.1:3000' })],
        config: makeConfig(),
        environment: 'prd'
      })
      expect(result.guardrails.issues).toEqual([
        expect.objectContaining({ code: 'localhost-in-prd' })
      ])
    })

    it('warns about private IP 192.168.x.x in prd', () => {
      const result = checkGovernance({
        variables: [makeVar({ key: 'SVC_AUTH_URL', value: 'http://192.168.1.100:8080' })],
        config: makeConfig(),
        environment: 'prd'
      })
      expect(result.guardrails.issues).toEqual([
        expect.objectContaining({ code: 'localhost-in-prd' })
      ])
    })

    it('is silent about localhost in dev', () => {
      const result = checkGovernance({
        variables: [makeVar({ key: 'SVC_AUTH_URL', value: 'http://localhost:3000' })],
        config: makeConfig(),
        environment: 'dev'
      })
      expect(result.guardrails.issues.filter(i => i.code === 'localhost-in-prd')).toEqual([])
    })

    it('is silent about localhost in stg', () => {
      const result = checkGovernance({
        variables: [makeVar({ key: 'SVC_AUTH_URL', value: 'http://localhost:3000' })],
        config: makeConfig(),
        environment: 'stg'
      })
      expect(result.guardrails.issues.filter(i => i.code === 'localhost-in-prd')).toEqual([])
    })
  })

  describe('url-no-scheme', () => {
    it('warns about URL without scheme for *_URL key', () => {
      const result = checkGovernance({
        variables: [makeVar({ key: 'DATABASE_URL', value: 'db.example.com:5432/mydb' })],
        config: makeConfig(),
        environment: 'dev'
      })
      expect(result.guardrails.issues).toEqual([
        expect.objectContaining({
          code: 'url-no-scheme',
          severity: 'warning',
          suggestion: expect.stringContaining('https://')
        })
      ])
    })

    it('does not warn about URL with scheme', () => {
      const result = checkGovernance({
        variables: [makeVar({ key: 'DATABASE_URL', value: 'postgres://db.example.com:5432/mydb' })],
        config: makeConfig(),
        environment: 'dev'
      })
      expect(result.guardrails.issues.filter(i => i.code === 'url-no-scheme')).toEqual([])
    })

    it('does not check non-URL keys', () => {
      const result = checkGovernance({
        variables: [makeVar({ key: 'LOG_LEVEL', value: 'db.example.com' })],
        config: makeConfig(),
        environment: 'dev'
      })
      expect(result.guardrails.issues.filter(i => i.code === 'url-no-scheme')).toEqual([])
    })
  })

  describe('guardrail mode config', () => {
    it('respects mode=off (no guardrail checks)', () => {
      const config = makeConfig() as any
      config.governance = { value_guardrails: 'off' }
      const result = checkGovernance({
        variables: [makeVar({ key: 'KEY', value: '' })],
        config,
        environment: 'dev'
      })
      expect(result.guardrails.issues).toEqual([])
      expect(result.guardrails.blocked).toBe(false)
    })

    it('blocks placeholders in strict mode', () => {
      const config = makeConfig() as any
      config.governance = { value_guardrails: 'strict' }
      const result = checkGovernance({
        variables: [makeVar({ key: 'API_KEY', value: 'TODO' })],
        config,
        environment: 'dev'
      })
      expect(result.guardrails.issues[0].severity).toBe('error')
      expect(result.guardrails.blocked).toBe(true)
    })

    it('blocks localhost in prd in strict mode', () => {
      const config = makeConfig() as any
      config.governance = { value_guardrails: 'strict' }
      const result = checkGovernance({
        variables: [makeVar({ key: 'SVC_URL', value: 'http://localhost:3000' })],
        config,
        environment: 'prd'
      })
      expect(result.guardrails.issues[0].severity).toBe('error')
      expect(result.blocked).toBe(true)
    })
  })

  describe('checkSingleVariable with guardrails', () => {
    it('blocks empty value and provides reason', () => {
      const result = checkSingleVariable({
        key: 'DB_URL', value: '', scope: sharedScope(),
        sensitive: false, environment: 'dev', config: makeConfig()
      })
      expect(result.blocked).toBe(true)
      expect(result.blockReason).toContain('empty')
    })

    it('includes guardrail warnings in warnings array', () => {
      const result = checkSingleVariable({
        key: 'API_KEY', value: 'TODO', scope: sharedScope(),
        sensitive: false, environment: 'prd', config: makeConfig()
      })
      expect(result.blocked).toBe(false)
      expect(result.warnings.some(w => w.includes('placeholder'))).toBe(true)
    })
  })
})
