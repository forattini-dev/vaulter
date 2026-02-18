export type DoctorRiskLevel = 'low' | 'medium' | 'high'

export interface DoctorRisk {
  score: number
  level: DoctorRiskLevel
  reasons: string[]
}

interface DoctorCheckLike {
  name: string
  status: 'ok' | 'warn' | 'fail' | 'skip'
  details: string
  hint?: string
}

const CRITICAL_CHECKS = new Set([
  'connection',
  'permissions',
  'security',
  'encryption',
  'scope-policy',
  'sync-status',
  'perf-config'
])

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function riskWeight(check: DoctorCheckLike): number {
  const isCritical = CRITICAL_CHECKS.has(check.name)
  if (check.status === 'fail') return isCritical ? 24 : 12
  if (check.status === 'warn') return isCritical ? 10 : 4
  if (check.status === 'skip') return 2
  return 0
}

export function calculateDoctorRisk(checks: DoctorCheckLike[]): DoctorRisk {
  let score = 0
  const reasons: string[] = []

  for (const check of checks) {
    const weight = riskWeight(check)
    if (weight <= 0) continue
    score += weight
    reasons.push(`${check.name}=${check.status}: ${check.details}`)
  }

  score = clamp(score, 0, 100)

  const level: DoctorRiskLevel = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low'

  return {
    score,
    level,
    reasons: reasons.slice(0, 6)
  }
}
