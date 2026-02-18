/**
 * Variable scope policy helper
 *
 * Implements lightweight guardrails to prevent common shared/service scope mistakes.
 *
 * By default, it applies a sensible set of rules and emits warnings.
 * Set VAULTER_SCOPE_POLICY=off to disable or VAULTER_SCOPE_POLICY=strict for hard enforcement.
 */

import { SHARED_SERVICE } from './shared.js'

export type ScopePolicyMode = 'off' | 'warn' | 'strict'

type ScopeMode = 'shared' | 'service'

interface ScopePolicyRule {
  name: string
  pattern: RegExp
  expectedScope: ScopeMode
  expectedService?: string
  reason: string
}

export interface ParsedScope {
  mode: ScopeMode
  service?: string
}

export interface ScopePolicyIssue {
  key: string
  expectedScope: ScopeMode
  expectedService?: string
  actualScope: ScopeMode
  actualService?: string
  ruleName: string
  message: string
}

interface ScopePolicyCheckInput {
  key: string
  targetScope: ScopeMode
  targetService?: string
  policyMode?: ScopePolicyMode
}

interface ScopePolicyCheckResult {
  issues: ScopePolicyIssue[]
  policyMode: ScopePolicyMode
  strict: boolean
}

const DEFAULT_RULES: ScopePolicyRule[] = [
  {
    name: 'mailgun-service-owned',
    pattern: /^MAILGUN_/i,
    expectedScope: 'service',
    expectedService: 'svc-notifications',
    reason: 'MAILGUN_* variables must stay service-owned (svc-notifications)'
  },
  {
    name: 'github-service-owned',
    pattern: /^GITHUB_/i,
    expectedScope: 'service',
    expectedService: 'svc-repositories',
    reason: 'GITHUB_* variables should be service-owned (svc-repositories)'
  },
  {
    name: 'svc-url-shared-default',
    pattern: /^SVC_.*_URL$/i,
    expectedScope: 'shared',
    reason: 'SVC_*_URL defaults should start in shared scope unless explicitly overridden'
  }
]

/**
 * Parse scope specifiers from CLI/MCP inputs.
 *
 * Accepted forms:
 * - `shared` or `__shared__`
 * - `service:<name>`
 * - `<name>` (service shorthand)
 */
export function parseScopeSpec(raw: string | undefined): ParsedScope | null {
  if (!raw) return null

  const trimmed = raw.trim()
  if (!trimmed) return null

  const lowered = trimmed.toLowerCase()
  if (lowered === 'shared' || lowered === SHARED_SERVICE.toLowerCase()) {
    return { mode: 'shared' }
  }

  if (lowered.startsWith('service:')) {
    const service = trimmed.slice(8).trim()
    if (!service) return null
    return { mode: 'service', service }
  }

  if (trimmed.includes(':')) return null

  return { mode: 'service', service: trimmed }
}

export function getScopeLabelFromParsed(scope: ParsedScope): string {
  if (scope.mode === 'shared') return SHARED_SERVICE
  return scope.service || '(no service)'
}

function normalizeScopeLabel(scope: ScopeMode, service?: string): string {
  if (scope === 'shared') return SHARED_SERVICE
  return service || '(no service)'
}

export function getScopePolicyMode(rawMode?: string): ScopePolicyMode {
  if (!rawMode) {
    const envMode = process.env.VAULTER_SCOPE_POLICY
    if (envMode) rawMode = envMode
  }

  const normalized = (rawMode || 'warn').toLowerCase().trim()
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return 'off'
  if (normalized === 'strict' || normalized === 'error' || normalized === '1' || normalized === 'true') return 'strict'
  return 'warn'
}

function findRuleForKey(key: string): ScopePolicyRule | undefined {
  return DEFAULT_RULES.find(rule => rule.pattern.test(key))
}

function buildIssue(rule: ScopePolicyRule, key: string, actualScope: ScopeMode, actualService?: string): ScopePolicyIssue {
  return {
    key,
    expectedScope: rule.expectedScope,
    expectedService: rule.expectedService,
    actualScope,
    actualService,
    ruleName: rule.name,
    message: rule.reason
  }
}

export function resolveTargetScope(targetScope: ScopeMode | undefined, targetService?: string): ScopeMode {
  if (targetScope === 'shared') return 'shared'
  if (targetService && targetService !== SHARED_SERVICE) return 'service'
  return 'service'
}

export function checkScopePolicy(params: ScopePolicyCheckInput): ScopePolicyCheckResult {
  const policyMode = getScopePolicyMode(params.policyMode)
  const issues: ScopePolicyIssue[] = []

  if (policyMode === 'off') {
    return { issues, policyMode, strict: false }
  }

  const rule = findRuleForKey(params.key)
  if (!rule) {
    return { issues, policyMode, strict: false }
  }

  const actualScope = params.targetScope
  const targetService = params.targetService

  const expectedScope = rule.expectedScope
  const expectedService = rule.expectedService

  if (expectedScope === 'shared' && actualScope !== 'shared') {
    issues.push(buildIssue(rule, params.key, actualScope, targetService))
    return {
      issues,
      policyMode,
      strict: policyMode === 'strict'
    }
  }

  if (expectedScope === 'service') {
    if (actualScope === 'shared') {
      issues.push(buildIssue(rule, params.key, actualScope, targetService))
    } else if (!targetService) {
      issues.push({
        ...buildIssue(rule, params.key, actualScope, targetService),
        message: `${rule.reason}. Missing target service`
      })
    } else if (expectedService && expectedService !== targetService) {
      issues.push(buildIssue(rule, params.key, actualScope, targetService))
    }
  }

  return {
    issues,
    policyMode,
    strict: policyMode === 'strict'
  }
}

export function formatScopePolicyMessage(issue: ScopePolicyIssue): string {
  if (issue.expectedScope === 'shared') {
    return `${issue.key}: expected ${SHARED_SERVICE} (rule ${issue.ruleName}); currently targeting ${normalizeScopeLabel(issue.actualScope, issue.actualService)}. ${issue.message}`
  }

  if (issue.expectedService) {
    return `${issue.key}: expected service ${issue.expectedService} (${issue.ruleName}); currently targeting ${normalizeScopeLabel(issue.actualScope, issue.actualService)}. ${issue.message}`
  }

  return `${issue.key}: scope mismatch for ${issue.ruleName}. ${issue.message}`
}

export function formatScopePolicySummary(issues: ScopePolicyIssue[]): string {
  if (issues.length === 0) return ''
  return issues.map(formatScopePolicyMessage).join('\n')
}

export function collectScopePolicyIssues(
  keys: string[],
  options: {
    scope: ScopeMode
    service?: string
    policyMode?: string
  }
): ScopePolicyCheckResult[] {
  return keys.map(key => checkScopePolicy({
    key,
    targetScope: options.scope,
    targetService: options.service,
    policyMode: getScopePolicyMode(options.policyMode)
  }))
}

export function hasBlockingPolicyIssues(results: ScopePolicyCheckResult[]): boolean {
  return results.some(r => r.strict && r.issues.length > 0)
}
