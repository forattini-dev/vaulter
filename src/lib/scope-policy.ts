/**
 * Variable scope policy helper
 *
 * Implements lightweight guardrails to prevent common shared/service scope mistakes.
 *
 * By default, it applies a sensible set of rules and emits warnings.
 * Set VAULTER_SCOPE_POLICY=off to disable or VAULTER_SCOPE_POLICY=strict for hard enforcement.
 */

import { SHARED_SERVICE } from './shared.js'
import type { ScopePolicyConfig } from '../types.js'

export type ScopePolicyMode = 'off' | 'warn' | 'strict'

type ScopeMode = 'shared' | 'service'

interface ScopePolicyRule {
  name: string
  pattern: RegExp
  expectedScope: ScopeMode
  expectedService?: string
  reason: string
  source: 'default' | 'custom'
}

interface ScopePolicyRuleInput {
  name?: string
  pattern: string
  expectedScope: ScopeMode
  expectedService?: string
  reason?: string
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
  source?: 'default' | 'custom'
}

interface ScopePolicyCheckInput {
  key: string
  targetScope: ScopeMode
  targetService?: string
  policyMode?: ScopePolicyMode
  rules?: ScopePolicyRule[]
}

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

function buildRule(
  raw: { name?: string; pattern: string; expectedScope: ScopeMode; expectedService?: string; reason?: string },
  source: 'default' | 'custom'
): ScopePolicyRule | null {
  const expectedScope = toMode(raw.expectedScope)
  if (!expectedScope) return null

  try {
    return {
      name: raw.name || `custom-${raw.pattern}`,
      pattern: new RegExp(raw.pattern, 'i'),
      expectedScope,
      expectedService: raw.expectedService,
      reason: raw.reason || `Expected ${expectedScope} scope`,
      source
    }
  } catch {
    return null
  }
}

function toMode(value: ScopeMode | string | undefined | null): ScopeMode | null {
  if (!value) return null
  const normalized = String(value).toLowerCase().trim()
  if (normalized === 'shared' || normalized === 'service') return normalized as ScopeMode
  return null
}

interface ScopePolicyCheckResult {
  issues: ScopePolicyIssue[]
  policyMode: ScopePolicyMode
  strict: boolean
}

interface RawScopePolicyConfig extends ScopePolicyConfig {
  rules?: Array<{
    name?: string
    pattern?: string
    expected_scope?: ScopeMode
    expected_service?: string
    reason?: string
    // camelCase compatibility
    expectedScope?: ScopeMode
    expectedService?: string
  }>
}

export interface ResolvedScopePolicy {
  policyMode: ScopePolicyMode
  rules: ScopePolicyRule[]
  warnings: string[]
}

const DEFAULT_RULES: ScopePolicyRuleInput[] = [
  {
    name: 'mailgun-service-owned',
    pattern: '^MAILGUN_',
    expectedScope: 'service',
    expectedService: 'svc-notifications',
    reason: 'MAILGUN_* variables must stay service-owned (svc-notifications)'
  },
  {
    name: 'github-service-owned',
    pattern: '^GITHUB_',
    expectedScope: 'service',
    expectedService: 'svc-repositories',
    reason: 'GITHUB_* variables should be service-owned (svc-repositories)'
  },
  {
    name: 'svc-url-shared-default',
    pattern: '^SVC_.*_URL$',
    expectedScope: 'shared',
    reason: 'SVC_*_URL defaults should start in shared scope unless explicitly overridden'
  }
]

function normalizeMode(rawMode?: string): ScopePolicyMode {
  const normalized = (rawMode || 'warn').toLowerCase().trim()
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return 'off'
  if (normalized === 'strict' || normalized === 'error' || normalized === '1' || normalized === 'true') return 'strict'
  return 'warn'
}

function parseScopePolicyConfigRules(config?: RawScopePolicyConfig): { rules: ScopePolicyRule[]; warnings: string[] } {
  const warnings: string[] = []
  const customRules: ScopePolicyRule[] = []

  const rawRules = config?.rules
  if (!Array.isArray(rawRules)) return { rules: [], warnings }

  rawRules.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      warnings.push(`Ignoring invalid scope_policy rule at index ${index + 1}`)
      return
    }

    const pattern = String((entry as Record<string, unknown>).pattern || '').trim()
    if (!pattern) {
      warnings.push(`Ignoring scope_policy rule at index ${index + 1}: missing pattern`)
      return
    }

    const expectedScope = toMode(
      (entry as Record<string, unknown>).expected_scope ??
      (entry as Record<string, unknown>).expectedScope
    )
    if (!expectedScope) {
      warnings.push(`Ignoring scope_policy rule "${pattern}": expected_scope must be shared|service`)
      return
    }

    const ruleInput = {
      name: String((entry as Record<string, unknown>).name || `custom-${pattern}`),
      pattern,
      expectedScope,
      expectedService: String((entry as Record<string, unknown>).expected_service || (entry as Record<string, unknown>).expectedService || ''),
      reason: String((entry as Record<string, unknown>).reason || '')
    }

    const rule = buildRule(ruleInput, 'custom')
    if (!rule) {
      warnings.push(`Ignoring invalid regex in scope_policy rule "${pattern}"`)
      return
    }
    if (rule.expectedScope === 'service' && !rule.expectedService) {
      warnings.push(`Scope_policy rule "${rule.name}" has expected_scope=service without expected_service`)
      return
    }

    customRules.push(rule)
  })

  return { rules: customRules, warnings }
}

function getDefaultRules(): ScopePolicyRule[] {
  return DEFAULT_RULES
    .map((raw) => buildRule(raw, 'default'))
    .filter((rule): rule is ScopePolicyRule => rule !== null)
}

function isRuleMatch(rule: ScopePolicyRule, key: string): boolean {
  return rule.pattern.test(key)
}

function findRuleForKey(key: string, rules: ScopePolicyRule[]): ScopePolicyRule | undefined {
  return rules.find(rule => isRuleMatch(rule, key))
}

function buildIssue(rule: ScopePolicyRule, key: string, actualScope: ScopeMode, actualService?: string): ScopePolicyIssue {
  return {
    key,
    expectedScope: rule.expectedScope,
    expectedService: rule.expectedService,
    actualScope,
    actualService,
    ruleName: rule.name,
    message: rule.reason,
    source: rule.source
  }
}

/**
 * Parse scope policy mode from explicit value or environment fallback.
 */
export function getScopePolicyMode(rawMode?: string): ScopePolicyMode {
  const envMode = process.env.VAULTER_SCOPE_POLICY
  return normalizeMode(rawMode ?? envMode ?? 'warn')
}

export function resolveScopePolicy(
  config: ScopePolicyConfig | undefined = {},
  overrideMode?: string
): ResolvedScopePolicy {
  const configWithDefaults = config as RawScopePolicyConfig | undefined
  const policyMode = getScopePolicyMode(overrideMode ?? configWithDefaults?.mode)
  const inheritDefaults = configWithDefaults?.inherit_defaults !== false
  const defaultRules = inheritDefaults ? getDefaultRules() : []
  const { rules: customRules, warnings } = parseScopePolicyConfigRules(configWithDefaults)
  return {
    policyMode,
    rules: [...defaultRules, ...customRules],
    warnings
  }
}

/**
 * Resolve scope label for CLI and outputs.
 */
export function getScopeLabelFromParsed(scope: ParsedScope): string {
  if (scope.mode === 'shared') return SHARED_SERVICE
  return scope.service || '(no service)'
}

function normalizeScopeLabel(scope: ScopeMode, service?: string): string {
  if (scope === 'shared') return SHARED_SERVICE
  return service || '(no service)'
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

  const availableRules = params.rules ?? getDefaultRules()
  const rule = findRuleForKey(params.key, availableRules)
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
  const sourceTag = issue.source ? ` [${issue.source}]` : ''
  if (issue.expectedScope === 'shared') {
    return `${issue.key}: expected ${SHARED_SERVICE} (rule ${issue.ruleName})${sourceTag}; currently targeting ${normalizeScopeLabel(issue.actualScope, issue.actualService)}. ${issue.message}`
  }

  if (issue.expectedService) {
    return `${issue.key}: expected service ${issue.expectedService} (rule ${issue.ruleName})${sourceTag}; currently targeting ${normalizeScopeLabel(issue.actualScope, issue.actualService)}. ${issue.message}`
  }

  return `${issue.key}: scope mismatch for ${issue.ruleName}${sourceTag}. ${issue.message}`
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
    rules?: ScopePolicyRule[]
  }
): ScopePolicyCheckResult[] {
  const rules = options.rules ?? getDefaultRules()
  return keys.map(key => checkScopePolicy({
    key,
    targetScope: options.scope,
    targetService: options.service,
    policyMode: getScopePolicyMode(options.policyMode),
    rules
  }))
}

export function hasBlockingPolicyIssues(results: ScopePolicyCheckResult[]): boolean {
  return results.some(r => r.strict && r.issues.length > 0)
}
