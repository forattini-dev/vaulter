/**
 * Tests for scope policy
 */

import { describe, it, expect } from 'vitest'
import {
  parseScopeSpec,
  getScopeLabelFromParsed,
  getScopePolicyMode,
  resolveScopePolicy,
  resolveTargetScope,
  checkScopePolicy,
  formatScopePolicyMessage,
  formatScopePolicySummary,
  collectScopePolicyIssues,
  hasBlockingPolicyIssues
} from '../../src/lib/scope-policy.js'

describe('scope-policy', () => {
  it('should parse shared scope specs', () => {
    expect(parseScopeSpec('shared')).toEqual({ mode: 'shared' })
    expect(parseScopeSpec('__shared__')).toEqual({ mode: 'shared' })
  })

  it('should parse service scope specs', () => {
    expect(parseScopeSpec('svc-api')).toEqual({ mode: 'service', service: 'svc-api' })
    expect(parseScopeSpec('service:svc-auth')).toEqual({ mode: 'service', service: 'svc-auth' })
  })

  it('should return null for invalid scope', () => {
    expect(parseScopeSpec('')).toBeNull()
    expect(parseScopeSpec(undefined)).toBeNull()
    expect(parseScopeSpec('service:')).toBeNull()
    expect(parseScopeSpec('svc:bad:one')).toBeNull()
  })

  it('should get labels for parsed scopes', () => {
    expect(getScopeLabelFromParsed({ mode: 'shared' })).toBe('__shared__')
    expect(getScopeLabelFromParsed({ mode: 'service', service: 'svc-x' })).toBe('svc-x')
  })

  it('should resolve target scope from inputs', () => {
    expect(resolveTargetScope('shared')).toBe('shared')
    expect(resolveTargetScope('service', undefined)).toBe('service')
    expect(resolveTargetScope(undefined, 'svc')).toBe('service')
  })

  it('should parse policy mode from env values', () => {
    expect(getScopePolicyMode('off')).toBe('off')
    expect(getScopePolicyMode('strict')).toBe('strict')
    expect(getScopePolicyMode('1')).toBe('strict')
    expect(getScopePolicyMode('false')).toBe('off')
    expect(getScopePolicyMode(undefined)).toBe('warn')
  })

  it('should resolve default and custom scope policy rules', () => {
    const policy = resolveScopePolicy({
      mode: 'warn',
      inherit_defaults: true,
      rules: [
        {
          pattern: '^CUSTOM_SECRET_',
          expected_scope: 'service',
          expected_service: 'svc-secret-manager',
          reason: 'custom secret policy'
        }
      ]
    })

    expect(policy.policyMode).toBe('warn')
    expect(policy.rules).toHaveLength(4)
    expect(policy.rules.map((rule) => rule.name)).toEqual(
      expect.arrayContaining(['mailgun-service-owned', 'github-service-owned', 'svc-url-shared-default', 'custom-^CUSTOM_SECRET_'])
    )
  })

  it('should invalidate bad custom policy rules and report warnings', () => {
    const policy = resolveScopePolicy({
      mode: 'warn',
      inherit_defaults: false,
      rules: [
        {
          pattern: '(',
          expected_scope: 'service',
          expected_service: 'svc-x'
        },
        {
          pattern: '^BROKEN_',
          expected_scope: 'service',
          // expected_service intentionally omitted on purpose to validate warning path
        } as unknown as { pattern: string; expected_scope: string }
      ]
    })

    expect(policy.warnings).toHaveLength(2)
    expect(policy.rules).toHaveLength(0)
  })

  it('should detect off mode with no warnings', () => {
    expect(checkScopePolicy({ key: 'MAILGUN_API_KEY', targetScope: 'shared', targetService: 'svc-notifications', policyMode: 'off' })).toEqual({
      issues: [],
      policyMode: 'off',
      strict: false
    })
  })

  it('should return issue for service-scoped policy in shared target', () => {
    const result = checkScopePolicy({
      key: 'MAILGUN_KEY',
      targetScope: 'shared',
      policyMode: 'warn'
    })

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({
      key: 'MAILGUN_KEY',
      expectedScope: 'service',
      actualScope: 'shared'
    })
    expect(formatScopePolicyMessage(result.issues[0])).toContain('expected service svc-notifications')
  })

  it('should return issue for wrong shared-scoped key', () => {
    const result = checkScopePolicy({
      key: 'SVC_PAYMENT_URL',
      targetScope: 'service',
      targetService: 'svc-payment',
      policyMode: 'warn'
    })

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({
      key: 'SVC_PAYMENT_URL',
      expectedScope: 'shared',
      actualScope: 'service',
      expectedService: undefined
    })
    expect(result.issues[0].message).toContain('defaults should start in shared scope')
  })

  it('should collect and summarize issues', () => {
    const checks = collectScopePolicyIssues(['MAILGUN_KEY', 'GITHUB_TOKEN'], {
      scope: 'shared',
      service: undefined,
      policyMode: 'warn'
    })

    expect(checks.length).toBe(2)
    expect(hasBlockingPolicyIssues(checks)).toBe(false)

    const summary = formatScopePolicySummary(checks.flatMap(item => item.issues))
    expect(summary).toContain('MAILGUN_KEY')
    expect(summary).toContain('expected service svc-notifications')
    expect(summary).toContain('GITHUB_TOKEN')
  })

  it('should mark blocking in strict mode', () => {
    const checks = collectScopePolicyIssues(['MAILGUN_KEY'], {
      scope: 'shared',
      policyMode: 'strict'
    })

    expect(hasBlockingPolicyIssues(checks)).toBe(true)
  })
})
