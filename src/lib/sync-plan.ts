import fs from 'node:fs'
import path from 'node:path'

export type SyncPlanAction = 'merge' | 'push' | 'pull'
export type SyncPlanStatus = 'planned' | 'applied' | 'blocked' | 'failed'

export interface SyncPlanChangeSet {
  added: string[]
  updated: string[]
  deleted: string[]
  unchanged: string[]
  localAdded: string[]
  localUpdated: string[]
  localDeleted: string[]
  conflicts: string[]
}

export interface SyncPlanSummary {
  operation: SyncPlanAction
  project: string
  environment: string
  service?: string
  shared?: boolean
  apply: boolean
  dryRun: boolean
  status: SyncPlanStatus
  strategy?: 'local' | 'remote' | 'error'
  prune?: boolean
  notes: string[]
  generatedAt: string
  source: {
    inputPath?: string
    outputPath?: string
    isDirMode?: boolean
  }
  changes: SyncPlanChangeSet
  counts: {
    local: number
    remote: number
    plannedChangeCount: number
    remoteOnlyCount?: number
    localOnlyCount?: number
    unchangedCount: number
  }
  missingRequired: string[]
  guardWarnings: string[]
  encodingWarnings: Array<{ key: string; message: string }>
  services?: Array<{
    name: string
    status: 'success' | 'failed'
    stats: {
      added: number
      updated: number
      unchanged: number
      conflicts: number
      localOnly: number
      remoteOnly: number
      error?: string
    }
  }>
}

export interface PlanArtifactOptions {
  operation: SyncPlanAction
  project: string
  environment: string
  service?: string
  shared?: boolean
  outputPath?: string
  timestamp?: Date
}

export interface PlanOutputPaths {
  json: string
  markdown: string
}

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toUtcFileTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\./g, '-')
}

function defaultOutputBase({
  operation,
  project,
  environment,
  service
}: {
  operation: SyncPlanAction
  project: string
  environment: string
  service?: string
}): string {
  const timestamp = toUtcFileTimestamp(new Date())
  const servicePart = service && service !== 'shared' ? `-${sanitizeSegment(service)}` : ''
  const projectPart = sanitizeSegment(project || 'vaulter')
  const envPart = sanitizeSegment(environment || 'dev')

  return `artifacts/vaulter-plans/${projectPart}-${envPart}${servicePart}-${operation}-${timestamp}`
}

export function resolvePlanOutputPaths(options: PlanArtifactOptions): PlanOutputPaths {
  const resolvedBase = path.resolve(
    options.outputPath || defaultOutputBase({
      operation: options.operation,
      project: options.project,
      environment: options.environment,
      service: options.service
    })
  )

  const requestedExt = path.extname(resolvedBase).toLowerCase()
  const jsonPath =
    requestedExt === '.json'
      ? resolvedBase
      : requestedExt === '.md'
        ? resolvedBase.replace(/\.md$/i, '.json')
        : `${resolvedBase}.json`

  const markdownPath =
    requestedExt === '.md'
      ? resolvedBase
      : requestedExt === '.json'
        ? resolvedBase.replace(/\.json$/i, '.md')
        : `${resolvedBase}.md`

  fs.mkdirSync(path.dirname(jsonPath), { recursive: true })

  return { json: jsonPath, markdown: markdownPath }
}

export function normalizePlanSummary(summary: Partial<SyncPlanSummary>): SyncPlanSummary {
  return {
    operation: summary.operation || 'merge',
    project: summary.project || 'unknown',
    environment: summary.environment || 'dev',
    service: summary.service,
    shared: summary.shared,
    apply: Boolean(summary.apply),
    dryRun: Boolean(summary.dryRun),
    status: summary.status || (summary.dryRun ? 'planned' : 'applied'),
    strategy: summary.strategy,
    prune: summary.prune,
    notes: summary.notes || [],
    generatedAt: summary.generatedAt || new Date().toISOString(),
    source: summary.source || {},
    changes: {
      added: summary.changes?.added || [],
      updated: summary.changes?.updated || [],
      deleted: summary.changes?.deleted || [],
      unchanged: summary.changes?.unchanged || [],
      localAdded: summary.changes?.localAdded || [],
      localUpdated: summary.changes?.localUpdated || [],
      localDeleted: summary.changes?.localDeleted || [],
      conflicts: summary.changes?.conflicts || []
    },
    counts: {
      local: summary.counts?.local || 0,
      remote: summary.counts?.remote || 0,
      plannedChangeCount: summary.counts?.plannedChangeCount || 0,
      remoteOnlyCount: summary.counts?.remoteOnlyCount,
      localOnlyCount: summary.counts?.localOnlyCount,
      unchangedCount: summary.counts?.unchangedCount || 0
    },
    missingRequired: summary.missingRequired || [],
    guardWarnings: summary.guardWarnings || [],
    encodingWarnings: summary.encodingWarnings || [],
    services: summary.services
  }
}

function formatSection(label: string, items: string[], limit = 40): string {
  if (items.length === 0) {
    return `- ${label}: none`
  }
  const preview = items.slice(0, limit)
  const suffix = items.length > limit ? ` (+${items.length - limit} more)` : ''
  return `- ${label}: ${preview.join(', ')}${suffix}`
}

function buildMarkdown(summary: SyncPlanSummary): string {
  const lines: string[] = []

  lines.push('# Sync Plan Artifact')
  lines.push('')
  lines.push(`- Operation: ${summary.operation}`)
  lines.push(`- Project: ${summary.project}`)
  lines.push(`- Environment: ${summary.environment}`)
  if (summary.service) lines.push(`- Service: ${summary.service}`)
  if (summary.shared) lines.push('- Scope: shared')
  lines.push(`- Apply: ${summary.apply ? 'yes' : 'no'}`)
  lines.push(`- Status: ${summary.status}`)
  lines.push(`- Generated at: ${summary.generatedAt}`)
  lines.push('')

  if (summary.source.inputPath) {
    lines.push(`- Input: ${summary.source.inputPath}`)
  }
  if (summary.source.outputPath) {
    lines.push(`- Output: ${summary.source.outputPath}`)
  }
  if (summary.source.isDirMode) {
    lines.push('- Mode: directory')
  }
  lines.push('')

  lines.push('## Summary')
  lines.push(`- Local vars: ${summary.counts.local}`)
  lines.push(`- Remote vars: ${summary.counts.remote}`)
  lines.push(`- Planned changes: ${summary.counts.plannedChangeCount}`)
  if (summary.counts.localOnlyCount !== undefined) {
    lines.push(`- Local-only keys: ${summary.counts.localOnlyCount}`)
  }
  if (summary.counts.remoteOnlyCount !== undefined) {
    lines.push(`- Remote-only keys: ${summary.counts.remoteOnlyCount}`)
  }
  lines.push('')

  lines.push('## Changes')
  lines.push(formatSection('Added', summary.changes.added))
  lines.push(formatSection('Updated', summary.changes.updated))
  lines.push(formatSection('Deleted', summary.changes.deleted))
  lines.push(formatSection('Unchanged', summary.changes.unchanged))
  if (summary.changes.localAdded.length > 0) {
    lines.push(formatSection('Local-added', summary.changes.localAdded))
  }
  if (summary.changes.localUpdated.length > 0) {
    lines.push(formatSection('Local-updated', summary.changes.localUpdated))
  }
  if (summary.changes.localDeleted.length > 0) {
    lines.push(formatSection('Local-deleted', summary.changes.localDeleted))
  }
  if (summary.changes.conflicts.length > 0) {
    lines.push(formatSection('Conflicts', summary.changes.conflicts))
  }
  lines.push('')

  if (summary.missingRequired.length > 0) {
    lines.push('## Validation')
    lines.push(`- Missing required keys: ${summary.missingRequired.join(', ')}`)
  }

  if (summary.guardWarnings.length > 0) {
    lines.push('## Scope/Guard Warnings')
    for (const warning of summary.guardWarnings) {
      lines.push(`- ${warning}`)
    }
    lines.push('')
  }

  if (summary.encodingWarnings.length > 0) {
    lines.push('## Encoding Warnings')
    for (const warning of summary.encodingWarnings) {
      lines.push(`- ${warning.key}: ${warning.message}`)
    }
    lines.push('')
  }

  if (summary.notes.length > 0) {
    lines.push('## Notes')
    for (const note of summary.notes) {
      lines.push(`- ${note}`)
    }
  }

  if (summary.services && summary.services.length > 0) {
    lines.push('')
    lines.push('## Services')
    for (const service of summary.services) {
      const status = service.status === 'success' ? '✓' : '✗'
      lines.push(
        `${status} ${service.name} (added=${service.stats.added}, updated=${service.stats.updated}, unchanged=${service.stats.unchanged}, conflicts=${service.stats.conflicts})`
      )
      if (service.stats.error) {
        lines.push(`  - error: ${service.stats.error}`)
      }
    }
  }

  return lines.join('\n')
}

export function writeSyncPlanArtifact(
  summaryInput: Partial<SyncPlanSummary>,
  options: PlanArtifactOptions
): PlanOutputPaths {
  const summary = normalizePlanSummary({
    ...summaryInput,
    operation: summaryInput.operation || options.operation,
    project: summaryInput.project || options.project,
    environment: summaryInput.environment || options.environment,
    service: summaryInput.service || options.service,
    dryRun: summaryInput.dryRun || false
  })

  const paths = resolvePlanOutputPaths({
    operation: options.operation,
    project: options.project,
    environment: options.environment,
    service: options.service,
    shared: options.shared,
    outputPath: options.outputPath
  })

  const jsonPayload = JSON.stringify(summary, null, 2)
  const markdownPayload = buildMarkdown(summary)

  fs.writeFileSync(paths.json, jsonPayload + '\n')
  fs.writeFileSync(paths.markdown, markdownPayload + '\n')

  return paths
}
