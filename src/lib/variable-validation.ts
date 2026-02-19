/**
 * Variable value guardrails
 *
 * Lightweight defensive checks to avoid common value mistakes and unsafe naming patterns.
 */

import { detectEncoding } from './encoding-detection.js'

export type ValueGuardrailMode = 'off' | 'warn' | 'strict'

interface VariableValueInput {
  key: string
  value: string
  sensitive?: boolean
}

export interface ValueValidationIssue {
  key: string
  code: string
  level: 'warning' | 'error'
  message: string
  details?: string
}

export interface ValueValidationResult {
  issues: ValueValidationIssue[]
  mode: ValueGuardrailMode
  blocked: boolean
}

interface ValidateValueOptions {
  environment?: string
  mode?: string
}

const SENSITIVE_NAME_PATTERNS: Array<{
  code: string
  message: string
  test: (key: string) => boolean
  level: ValueValidationIssue['level']
}> = [
  {
    code: 'sensitive-key-pattern',
    message: 'Variable name suggests secret material; set sensitive=true for this variable',
    level: 'warning',
    test: (key: string) => /(_KEY|_TOKEN|_SECRET|_PASSWORD|_PASS|_PRIVATE_KEY|_CLIENT_SECRET|_API_SECRET|_ACCESS_TOKEN)$/i.test(key)
  }
]

/** Check if a key name suggests secret material (e.g. _SECRET, _TOKEN, _PASSWORD) */
export function isSensitiveKeyName(key: string): boolean {
  return SENSITIVE_NAME_PATTERNS.some(p => p.test(key))
}

const URL_PATTERNS = [
  {
    code: 'svc-url-required',
    namePattern: /^SVC_.*_URL$/i,
    message: 'SVC_*_URL must be a valid URL',
    requireHttps: false
  },
  {
    code: 'app-url-required',
    namePattern: /^APP_.*_URL$/i,
    message: 'APP_*_URL must be a valid URL',
    requireHttps: true
  }
]

const PLACEHOLDER_PATTERNS = [
  /\$\{[^}]+\}/,
  /\{\{[^}]+\}\}/
]

function parseGuardrailMode(rawMode?: string): ValueGuardrailMode {
  const normalized = String(rawMode ?? process.env.VAULTER_VALUE_GUARDRAILS ?? 'warn').toLowerCase().trim()

  if (normalized === 'off' || normalized === 'false' || normalized === '0') return 'off'
  if (normalized === 'strict' || normalized === 'error' || normalized === '1' || normalized === 'true') return 'strict'

  return 'warn'
}

function isProductionLikeEnvironment(environment?: string): boolean {
  const env = String(environment || 'dev').trim().toLowerCase()
  return ['prd', 'prod', 'production', 'production-like', 'release', 'live', 'dr'].includes(env)
}

function isUrl(value: string): boolean {
  if (value.length < 8) return false

  try {
    const parsed = new URL(value)
    return Boolean(parsed.protocol && parsed.hostname)
  } catch {
    return false
  }
}

function validateSingle({ key, value, sensitive }: VariableValueInput, environment?: string): ValueValidationIssue[] {
  const issues: ValueValidationIssue[] = []

  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value))) {
    issues.push({
      key,
      code: 'template-placeholder',
      level: 'warning',
      message: 'Value looks like a template placeholder; verify it is intentionally unresolved',
      details: `${key} contains ${value.includes('${') ? '${...}' : '{{...}}'}-style interpolation`
    })
  }

  const isProdLike = isProductionLikeEnvironment(environment)
  const isSecureRequired = isProdLike || key.toUpperCase().startsWith('APP_')

  for (const pattern of URL_PATTERNS) {
    if (!pattern.namePattern.test(key)) continue

    if (!isUrl(value)) {
      issues.push({
        key,
        code: pattern.code,
        level: 'error',
        message: pattern.message
      })
      continue
    }

    if (pattern.requireHttps || isSecureRequired) {
      if (!/^https:$/i.test(new URL(value).protocol)) {
        issues.push({
          key,
          code: pattern.requireHttps ? 'url-https-required' : 'url-https-required-env',
          level: isProdLike ? 'error' : 'warning',
          message: 'APP_*_URL and production-like environments should use https URLs'
        })
      }
    }
  }

  for (const rule of SENSITIVE_NAME_PATTERNS) {
    if (!sensitive && rule.test(key)) {
      issues.push({
        key,
        code: rule.code,
        level: rule.level,
        message: rule.message
      })
    }
  }

  const encoding = detectEncoding(value)
  if (encoding.detected && encoding.confidence !== 'low') {
    issues.push({
      key,
      code: 'encoding-like-value',
      level: encoding.confidence === 'high' ? 'warning' : 'warning',
      message: encoding.message || 'Value looks encoded/hashed. Vaulter will encrypt this value as text and the encoding can hide accidental mistakes.'
    })
  }

  return issues
}

export function validateVariableValues(
  variables: VariableValueInput[],
  options: ValidateValueOptions = {}
): ValueValidationResult {
  const mode = parseGuardrailMode(options.mode)
  if (mode === 'off') {
    return { mode, issues: [], blocked: false }
  }

  const issues = variables.flatMap((entry) => validateSingle(entry, options.environment))

  const blocked = mode === 'strict'
    ? issues.some((issue) => issue.level === 'error')
    : false

  return { mode, issues, blocked }
}

export function formatValueValidationSummary(issues: ValueValidationIssue[]): string {
  if (issues.length === 0) return ''

  const lines = issues.map((issue) => {
    const details = issue.details ? ` (${issue.details})` : ''
    return `${issue.code}: ${issue.key} - ${issue.message}${details}`
  })

  return lines.join('\n')
}
