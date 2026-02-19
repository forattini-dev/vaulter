/**
 * Vaulter Governance Module
 *
 * Unified governance checks consolidating:
 * - Scope policy (from lib/scope-policy.ts)
 * - Write guard (from lib/write-guard.ts)
 * - Variable validation (from lib/variable-validation.ts)
 * - Required vars (new)
 * - Rotation age (new)
 *
 * This module delegates to existing implementations — it does NOT rewrite them.
 * It adds RequiredStatus and RotationStatus as new first-class checks.
 */

import type { VaulterConfig } from '../types.js'
import type {
  ResolvedVariable,
  GovernanceResult,
  PolicyStatus,
  RequiredStatus,
  RotationStatus,
  ValueGuardrailStatus,
  ValueGuardrailIssue,
  Scope
} from './types.js'
import { emptyGuardrailStatus } from './types.js'
import {
  resolveScopePolicy,
  checkScopePolicy,
  formatScopePolicyMessage,
  type ResolvedScopePolicy,
  type ScopePolicyMode
} from '../lib/scope-policy.js'
import {
  validateVariableValues,
  isSensitiveKeyName,
  type ValueValidationIssue
} from '../lib/variable-validation.js'

// ============================================================================
// Main Governance Check
// ============================================================================

/**
 * Run all governance checks on a set of variables.
 *
 * This is the single entry point for validating variables before
 * mutations (change set/delete/move) or during plan computation.
 */
export function checkGovernance(options: {
  variables: ResolvedVariable[]
  config: VaulterConfig | null
  environment: string
  /** Known services from config or discovery */
  knownServices?: string[]
}): GovernanceResult {
  const { variables, config, environment, knownServices } = options

  // 1. Scope policy
  const policy = checkScopePolicyForVars(variables, config)

  // 2. Value validation (encoding, URL, naming)
  const valueWarnings = checkValueValidation(variables, environment)

  // 3. Required vars
  const required = checkRequiredVars(variables, config, environment)

  // 4. Rotation age
  const rotation = checkRotationAge(variables, config)

  // 5. Orphan detection (if services are known)
  const orphanWarnings = knownServices
    ? checkOrphans(variables, knownServices)
    : []

  // 6. Value guardrails (placeholder, localhost-in-prd, empty/whitespace, url-no-scheme)
  const guardrailMode = getGuardrailMode(config)
  const guardrails = guardrailMode !== 'off'
    ? checkValueGuardrails(variables, environment, guardrailMode)
    : emptyGuardrailStatus()

  // Aggregate
  const guardrailWarnings = guardrails.issues
    .filter(i => i.severity === 'warning')
    .map(i => `${i.key}: ${i.message}`)

  const allWarnings = [
    ...policy.issues.map(i => i.message),
    ...valueWarnings,
    ...orphanWarnings,
    ...guardrailWarnings
  ]

  const suggestions: string[] = []

  if (required.missing.length > 0) {
    suggestions.push(
      `Missing required vars in ${environment}: ${required.missing.join(', ')}. ` +
      `Use 'vaulter change set' to add them.`
    )
  }

  if (rotation.overdue > 0) {
    suggestions.push(
      `${rotation.overdue} variable(s) overdue for rotation. ` +
      `Use 'vaulter change rotate' to update them.`
    )
  }

  if (orphanWarnings.length > 0) {
    suggestions.push(
      `Found ${orphanWarnings.length} variable(s) for unknown services. ` +
      `Use 'vaulter status inventory --orphans' to review.`
    )
  }

  const blocked = policy.violations > 0 || guardrails.blocked

  return {
    policy,
    required,
    rotation,
    guardrails,
    blocked,
    warnings: allWarnings,
    suggestions
  }
}

// ============================================================================
// Scope Policy Check
// ============================================================================

function checkScopePolicyForVars(
  variables: ResolvedVariable[],
  config: VaulterConfig | null
): PolicyStatus {
  const resolved: ResolvedScopePolicy = resolveScopePolicy(config?.scope_policy)
  const policyMode: ScopePolicyMode = resolved.policyMode

  if (policyMode === 'off') {
    return { warnings: 0, violations: 0, issues: [] }
  }

  const issues: PolicyStatus['issues'] = []
  let warnings = 0
  let violations = 0

  for (const variable of variables) {
    const targetScope = variable.scope.kind
    const targetService = variable.scope.kind === 'service'
      ? (variable.scope as { kind: 'service'; name: string }).name
      : undefined

    const result = checkScopePolicy({
      key: variable.key,
      targetScope,
      targetService,
      policyMode,
      rules: resolved.rules
    })

    for (const issue of result.issues) {
      const message = formatScopePolicyMessage(issue)
      issues.push({
        key: variable.key,
        rule: issue.ruleName,
        message
      })

      if (result.strict) {
        violations++
      } else {
        warnings++
      }
    }
  }

  return { warnings, violations, issues }
}

// ============================================================================
// Value Validation
// ============================================================================

function checkValueValidation(
  variables: ResolvedVariable[],
  environment: string
): string[] {
  const inputs = variables.map(v => ({
    key: v.key,
    value: v.value,
    sensitive: v.sensitive
  }))

  const result = validateVariableValues(inputs, { environment })
  return result.issues.map(formatValueIssue)
}

function formatValueIssue(issue: ValueValidationIssue): string {
  const details = issue.details ? ` (${issue.details})` : ''
  return `${issue.key}: ${issue.message}${details}`
}

// ============================================================================
// Required Vars Check
// ============================================================================

/**
 * Check if all required variables are present for an environment.
 *
 * Reads from:
 * - config.sync.required.<environment> (existing)
 * - config.governance.required_vars.<environment> (current format)
 */
function checkRequiredVars(
  variables: ResolvedVariable[],
  config: VaulterConfig | null,
  environment: string
): RequiredStatus {
  if (!config) {
    return { satisfied: 0, missing: [] }
  }

  const requiredKeys = getRequiredKeys(config, environment)
  if (requiredKeys.length === 0) {
    return { satisfied: 0, missing: [] }
  }

  const presentKeys = new Set(variables.map(v => v.key))
  const missing: string[] = []
  let satisfied = 0

  for (const key of requiredKeys) {
    if (presentKeys.has(key)) {
      satisfied++
    } else {
      missing.push(key)
    }
  }

  return { satisfied, missing }
}

/**
 * Extract required keys from config
 */
function getRequiredKeys(config: VaulterConfig, environment: string): string[] {
  const keys: string[] = []

  // config.sync.required
  if (config.sync?.required) {
    const envRequired = config.sync.required[environment]
    if (Array.isArray(envRequired)) {
      keys.push(...envRequired)
    }
  }

  // Current location: config.governance.required_vars
  // This will be read from the config once the governance section is added.
  // For now, we support the existing sync.required path.
  const governance = (config as unknown as Record<string, unknown>).governance as
    { required_vars?: Record<string, string[]> } | undefined
  if (governance?.required_vars) {
    const envRequired = governance.required_vars[environment]
    if (Array.isArray(envRequired)) {
      keys.push(...envRequired)
    }
  }

  // Deduplicate
  return [...new Set(keys)]
}

// ============================================================================
// Rotation Age Check
// ============================================================================

/**
 * Check if any variables are overdue for rotation based on their metadata.
 */
function checkRotationAge(
  variables: ResolvedVariable[],
  config: VaulterConfig | null
): RotationStatus {
  if (!config) {
    return { overdue: 0, keys: [] }
  }

  const rotationConfig = getRotationConfig(config)
  if (!rotationConfig) {
    return { overdue: 0, keys: [] }
  }

  const { maxAgeDays, patterns } = rotationConfig
  const now = Date.now()
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
  const overdueKeys: RotationStatus['keys'] = []

  for (const variable of variables) {
    // Only check variables that match rotation patterns
    if (!matchesRotationPatterns(variable.key, patterns)) continue

    // Check if provenance has a timestamp we can use
    if (!variable.provenance?.timestamp) continue

    const lastModified = new Date(variable.provenance.timestamp).getTime()
    if (isNaN(lastModified)) continue

    if (now - lastModified > maxAgeMs) {
      overdueKeys.push({
        key: variable.key,
        lastRotated: variable.provenance.timestamp,
        maxAgeDays
      })
    }
  }

  return { overdue: overdueKeys.length, keys: overdueKeys }
}

interface RotationConfig {
  maxAgeDays: number
  patterns: string[]
}

function getRotationConfig(config: VaulterConfig): RotationConfig | null {
  // Check encryption.rotation (existing)
  if (config.encryption?.rotation?.enabled) {
    return {
      maxAgeDays: config.encryption.rotation.interval_days || 90,
      patterns: config.encryption.rotation.patterns || ['*_SECRET', '*_KEY', '*_TOKEN']
    }
  }

  // Check governance.rotation
  const governance = (config as unknown as Record<string, unknown>).governance as
    { rotation?: { max_age_days?: number; patterns?: string[] } } | undefined
  if (governance?.rotation) {
    return {
      maxAgeDays: governance.rotation.max_age_days || 90,
      patterns: governance.rotation.patterns || ['*_SECRET', '*_KEY', '*_TOKEN']
    }
  }

  return null
}

function matchesRotationPatterns(key: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Simple glob matching: * at start/end
    if (pattern.startsWith('*')) {
      if (key.endsWith(pattern.slice(1))) return true
    } else if (pattern.endsWith('*')) {
      if (key.startsWith(pattern.slice(0, -1))) return true
    } else if (key === pattern) {
      return true
    }
  }
  return false
}

// ============================================================================
// Orphan Detection
// ============================================================================

/**
 * Check for variables that belong to services that don't exist in the config
 */
function checkOrphans(
  variables: ResolvedVariable[],
  knownServices: string[]
): string[] {
  const knownSet = new Set(knownServices)
  const warnings: string[] = []
  const reportedServices = new Set<string>()

  for (const variable of variables) {
    if (variable.scope.kind !== 'service') continue
    const serviceName = variable.scope.name

    if (!knownSet.has(serviceName) && !reportedServices.has(serviceName)) {
      reportedServices.add(serviceName)
      warnings.push(
        `Service '${serviceName}' is not in the known services list. ` +
        `Variables in this scope may be orphaned.`
      )
    }
  }

  return warnings
}

// ============================================================================
// Value Guardrails (check #6)
// ============================================================================

/** Placeholder patterns that suggest the value hasn't been properly set */
const PLACEHOLDER_PATTERNS = [
  /^TODO$/i,
  /^CHANGEME$/i,
  /^PLACEHOLDER$/i,
  /^FIXME$/i,
  /^xxx+$/i,
  /^your[-_].*[-_]here$/i,
  /^<[A-Z_]+>$/,       // <FILL>, <YOUR_KEY>
  /^\$\{[^}]+\}$/,     // ${VAR_NAME}
  /^\{\{[^}]+\}\}$/,   // {{VAR_NAME}}
]

/** RFC1918 + loopback patterns for production environment detection */
const LOCALHOST_PATTERNS = [
  /localhost/i,
  /127\.0\.0\.1/,
  /0\.0\.0\.0/,
  /\[?::1\]?/,
  /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
  /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
]

/** Environment names considered production */
const PRD_ENVIRONMENTS = new Set(['prd', 'prod', 'production'])

type GuardrailMode = 'off' | 'warn' | 'strict'

function getGuardrailMode(config: VaulterConfig | null): GuardrailMode {
  if (!config) return 'warn'
  const governance = (config as unknown as Record<string, unknown>).governance as
    { value_guardrails?: string } | undefined
  if (!governance?.value_guardrails) return 'warn'
  const mode = governance.value_guardrails
  if (mode === 'off' || mode === 'warn' || mode === 'strict') return mode
  return 'warn'
}

function isPrdEnvironment(env: string): boolean {
  return PRD_ENVIRONMENTS.has(env.toLowerCase())
}

/**
 * Check for dangerous or problematic values.
 *
 * - empty/whitespace values → always block (severity: error)
 * - placeholders (TODO, CHANGEME) → warning (or block in strict)
 * - localhost/private IPs in prd → warning (or block in strict)
 * - URL keys without scheme → warning (or block in strict)
 */
function checkValueGuardrails(
  variables: ResolvedVariable[],
  environment: string,
  mode: 'warn' | 'strict'
): ValueGuardrailStatus {
  const issues: ValueGuardrailIssue[] = []
  const isPrd = isPrdEnvironment(environment)

  for (const v of variables) {
    // Empty value — always blocks regardless of mode
    if (v.value === '') {
      issues.push({
        key: v.key,
        code: 'empty-value',
        severity: 'error',
        message: 'Value is empty.',
        suggestion: "Use 'vaulter change delete' to remove a variable, or provide a value."
      })
      continue
    }

    // Whitespace-only — always blocks
    if (v.value.trim() === '') {
      issues.push({
        key: v.key,
        code: 'whitespace-value',
        severity: 'error',
        message: 'Value is whitespace-only.',
        suggestion: 'Provide a meaningful value or delete the variable.'
      })
      continue
    }

    // Placeholder detection — warning in warn mode, error in strict
    const isPlaceholder = PLACEHOLDER_PATTERNS.some(p => p.test(v.value))
    if (isPlaceholder) {
      issues.push({
        key: v.key,
        code: 'placeholder',
        severity: mode === 'strict' ? 'error' : 'warning',
        message: `Value "${v.value}" looks like a placeholder.`,
        suggestion: 'Replace with the actual value before deploying.'
      })
    }

    // Localhost/private IP in production — warning in warn, error in strict
    // Silent in non-prd environments
    if (isPrd) {
      const hasLocalhost = LOCALHOST_PATTERNS.some(p => p.test(v.value))
      if (hasLocalhost) {
        issues.push({
          key: v.key,
          code: 'localhost-in-prd',
          severity: mode === 'strict' ? 'error' : 'warning',
          message: 'Value contains localhost or private IP in a production environment.',
          suggestion: 'Use the production hostname or IP instead.'
        })
      }
    }

    // URL without scheme for *_URL keys
    if (/_URL$/i.test(v.key)) {
      const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v.value)
      const looksLikeUrl = /^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(v.value)
      if (!hasScheme && looksLikeUrl) {
        issues.push({
          key: v.key,
          code: 'url-no-scheme',
          severity: mode === 'strict' ? 'error' : 'warning',
          message: 'URL value is missing a scheme (e.g. https://).',
          suggestion: `Did you mean "https://${v.value}"?`
        })
      }
    }
  }

  const blocked = issues.some(i => i.severity === 'error')

  return { issues, blocked }
}

// ============================================================================
// Single Variable Check (for write-time validation)
// ============================================================================

/**
 * Check governance for a single variable before writing.
 *
 * Returns warnings/blocked status without modifying anything.
 * Used by state.writeLocalVariable() to validate before persisting.
 */
export function checkSingleVariable(options: {
  key: string
  value: string
  scope: Scope
  sensitive: boolean
  environment: string
  config: VaulterConfig | null
}): {
  warnings: string[]
  blocked: boolean
  blockReason?: string
  suggestions: string[]
  sensitiveAutoCorrect: boolean
  effectiveSensitive: boolean
} {
  const { key, value, scope, environment, config } = options

  // Auto-correct: if key looks like a secret but sensitive=false, flip it
  const sensitiveAutoCorrect = !options.sensitive && isSensitiveKeyName(key)
  const sensitive = sensitiveAutoCorrect ? true : options.sensitive

  const variable: ResolvedVariable = {
    key,
    value,
    environment,
    scope,
    sensitive,
    lifecycle: 'active'
  }

  const result = checkGovernance({
    variables: [variable],
    config,
    environment
  })

  // When auto-corrected, remove the "set sensitive=true" warning (we already fixed it)
  const warnings = sensitiveAutoCorrect
    ? result.warnings.filter(w => !w.includes('sensitive'))
    : result.warnings

  // Build block reason from whichever check triggered the block
  let blockReason: string | undefined
  if (result.blocked) {
    if (result.guardrails.blocked) {
      const errors = result.guardrails.issues.filter(i => i.severity === 'error')
      blockReason = errors.map(i => `${i.key}: ${i.message}`).join('; ')
    } else if (result.policy.violations > 0) {
      blockReason = `Scope policy violation (strict mode): ${result.policy.issues.map(i => i.message).join('; ')}`
    }
  }

  return {
    warnings,
    blocked: result.blocked,
    blockReason,
    suggestions: result.suggestions,
    sensitiveAutoCorrect,
    effectiveSensitive: sensitive
  }
}
