import type { Environment, VaulterConfig } from '../types.js'
import { formatValueValidationSummary, validateVariableValues } from './variable-validation.js'
import {
  collectScopePolicyIssues,
  formatScopePolicySummary,
  hasBlockingPolicyIssues,
  resolveScopePolicy
} from './scope-policy.js'

export interface WriteVariable {
  key: string
  value: string
  sensitive?: boolean
}

export interface WriteGuardInput {
  variables: WriteVariable[]
  targetScope: 'shared' | 'service'
  targetService?: string
  environment?: Environment
  config?: VaulterConfig | null
  policyMode?: string
  guardrailMode?: string
}

export interface WriteGuardResult {
  hasIssues: boolean
  blocked: boolean
  scopeIssueSummary: string
  valueIssueSummary: string
  policyWarnings: string[]
}

export function evaluateWriteGuard(input: WriteGuardInput): WriteGuardResult {
  const keys = input.variables.map((item) => item.key).filter(Boolean)
  if (keys.length === 0) {
    return {
      hasIssues: false,
      blocked: false,
      scopeIssueSummary: '',
      valueIssueSummary: '',
      policyWarnings: []
    }
  }

  const policy = resolveScopePolicy(input.config?.scope_policy, input.policyMode)
  const policyChecks = collectScopePolicyIssues(keys, {
    scope: input.targetScope,
    service: input.targetService,
    policyMode: policy.policyMode,
    rules: policy.rules
  })

  const policyIssues = policyChecks.flatMap(check => check.issues)
  const scopeIssueSummary = policyIssues.length > 0
    ? formatScopePolicySummary(policyIssues)
    : ''

  const valueValidation = validateVariableValues(
    input.variables.map((item) => ({
      key: item.key,
      value: item.value,
      sensitive: item.sensitive
    })),
    {
      environment: input.environment,
      mode: input.guardrailMode ?? process.env.VAULTER_VALUE_GUARDRAILS
    }
  )
  const valueIssueSummary = valueValidation.issues.length > 0
    ? formatValueValidationSummary(valueValidation.issues)
    : ''

  return {
    hasIssues: scopeIssueSummary.length > 0 || valueIssueSummary.length > 0,
    blocked: hasBlockingPolicyIssues(policyChecks) || valueValidation.blocked,
    scopeIssueSummary,
    valueIssueSummary,
    policyWarnings: policy.warnings
  }
}

export function formatWriteGuardLines(result: WriteGuardResult): string[] {
  const lines: string[] = []

  if (result.scopeIssueSummary) {
    lines.push('Scope policy check:')
    lines.push(result.scopeIssueSummary)
    for (const warning of result.policyWarnings) {
      lines.push(`- ${warning}`)
    }
  }

  if (result.valueIssueSummary) {
    lines.push('Value guardrails:')
    lines.push(result.valueIssueSummary)
  }

  return lines
}
