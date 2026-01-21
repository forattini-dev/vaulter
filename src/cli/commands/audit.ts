/**
 * Vaulter CLI - Audit Commands
 *
 * View and manage audit logs
 */

import type { CLIArgs, VaulterConfig, Environment, AuditEntry } from '../../types.js'
import { AuditLogger } from '../../lib/audit.js'
import { resolveBackendUrls, loadEncryptionKeyForEnv } from '../../index.js'
import * as ui from '../ui.js'

interface AuditContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

/**
 * Create audit logger from config
 */
async function createAuditLogger(context: AuditContext): Promise<AuditLogger> {
  const { config, project, environment, verbose } = context

  if (!config) {
    throw new Error('No configuration found. Run "vaulter init" first.')
  }

  const urls = resolveBackendUrls(config)
  if (urls.length === 0) {
    throw new Error('No backend URL configured')
  }

  // Use per-environment key resolution
  const passphrase = await loadEncryptionKeyForEnv(config, project, environment) || undefined
  const logger = new AuditLogger(config.audit)

  ui.verbose(`Connecting to audit backend: ${urls[0].replace(/:([^:@/]+)@/, ':***@')}`, verbose)
  await logger.connect(urls[0], passphrase, verbose)

  return logger
}

/**
 * Format timestamp for display
 */
function formatTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toISOString().replace('T', ' ').substring(0, 19)
}

/**
 * Format audit entry for table display
 */
function formatEntryForTable(entry: AuditEntry): Record<string, string> {
  return {
    time: formatTimestamp(entry.timestamp),
    user: entry.user.substring(0, 15),
    op: entry.operation,
    key: entry.key.substring(0, 25),
    env: entry.environment,
    src: entry.source
  }
}

/**
 * Run audit list command
 *
 * vaulter audit list [--user USER] [--operation OP] [--since DATE] [--until DATE] [--limit N]
 */
export async function runAuditList(context: AuditContext): Promise<void> {
  const { args, project, service, environment, verbose, jsonOutput } = context

  if (!project) {
    ui.error('Project not specified and no config found')
    ui.log('Run "vaulter init" or specify --project')
    process.exit(1)
  }

  const logger = await createAuditLogger(context)

  try {
    // Build query options from typed args
    const queryOptions: Record<string, unknown> = {
      project,
      environment: args['all-envs'] ? undefined : environment,
      service,
      user: args.user,
      operation: args.operation,
      key: args.pattern,  // --pattern maps to key filter in query
      source: args.source,
      since: args.since ? new Date(args.since) : undefined,
      until: args.until ? new Date(args.until) : undefined,
      limit: args.limit || 50
    }

    ui.verbose(`Querying audit log for ${project}/${service || '*'}/${environment}`, verbose)

    const entries = await ui.withSpinner(
      'Fetching audit entries...',
      () => logger.query(queryOptions as any),
      { successText: 'Fetched' }
    )

    if (jsonOutput) {
      ui.output(JSON.stringify({
        project,
        service,
        environment: args['all-envs'] ? 'all' : environment,
        count: entries.length,
        entries: entries.map(e => ({
          ...e,
          timestamp: e.timestamp instanceof Date ? e.timestamp.toISOString() : e.timestamp
        }))
      }, null, 2))
    } else {
      if (entries.length === 0) {
        ui.log('No audit entries found')
        return
      }

      const tableData = entries.map(formatEntryForTable)
      const table = ui.formatTable(
        [
          { key: 'time', header: 'TIMESTAMP' },
          { key: 'user', header: 'USER' },
          { key: 'op', header: 'OP' },
          { key: 'key', header: 'KEY' },
          { key: 'env', header: 'ENV' },
          { key: 'src', header: 'SRC' }
        ],
        tableData
      )

      ui.output(table)
      ui.log(`\nShowing ${entries.length} entries`)
    }
  } finally {
    await logger.disconnect()
  }
}

/**
 * Run audit show command - show details of a single entry
 *
 * vaulter audit show <id>
 */
export async function runAuditShow(context: AuditContext): Promise<void> {
  const { args, jsonOutput } = context
  const restArgs = args._ || []
  const id = restArgs[2] // audit show <id>

  if (!id) {
    ui.error('Usage: vaulter audit show <id>')
    process.exit(1)
  }

  const logger = await createAuditLogger(context)

  try {
    const entry = await logger.get(id)

    if (!entry) {
      ui.error(`Audit entry not found: ${id}`)
      process.exit(1)
    }

    if (jsonOutput) {
      ui.output(JSON.stringify({
        ...entry,
        timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp
      }, null, 2))
    } else {
      ui.log(`\n  ID:         ${entry.id}`)
      ui.log(`  Timestamp:  ${formatTimestamp(entry.timestamp)}`)
      ui.log(`  User:       ${entry.user}`)
      ui.log(`  Operation:  ${entry.operation}`)
      ui.log(`  Key:        ${entry.key}`)
      ui.log(`  Project:    ${entry.project}`)
      ui.log(`  Environment: ${entry.environment}`)
      if (entry.service) {
        ui.log(`  Service:    ${entry.service}`)
      }
      ui.log(`  Source:     ${entry.source}`)
      if (entry.previousValue) {
        ui.log(`  Previous:   ${entry.previousValue}`)
      }
      if (entry.newValue) {
        ui.log(`  New:        ${entry.newValue}`)
      }
      if (entry.metadata && Object.keys(entry.metadata).length > 0) {
        ui.log(`  Metadata:   ${JSON.stringify(entry.metadata)}`)
      }
      ui.log('')
    }
  } finally {
    await logger.disconnect()
  }
}

/**
 * Run audit stats command - show statistics
 *
 * vaulter audit stats
 */
export async function runAuditStats(context: AuditContext): Promise<void> {
  const { project, service, environment, jsonOutput } = context

  if (!project) {
    ui.error('Project not specified and no config found')
    process.exit(1)
  }

  const logger = await createAuditLogger(context)

  try {
    const stats = await ui.withSpinner(
      'Calculating statistics...',
      () => logger.stats(project, environment),
      { successText: 'Done' }
    )

    if (jsonOutput) {
      ui.output(JSON.stringify({
        project,
        environment,
        service,
        ...stats,
        oldestEntry: stats.oldestEntry?.toISOString(),
        newestEntry: stats.newestEntry?.toISOString()
      }, null, 2))
    } else {
      ui.log(`\nAudit Statistics for ${project}/${environment}`)
      ui.log('═'.repeat(40))
      ui.log(`Total entries: ${stats.totalEntries}`)

      if (stats.oldestEntry && stats.newestEntry) {
        ui.log(`Date range:    ${formatTimestamp(stats.oldestEntry)} to ${formatTimestamp(stats.newestEntry)}`)
      }

      ui.log('\nBy Operation:')
      for (const [op, count] of Object.entries(stats.byOperation)) {
        ui.log(`  ${op.padEnd(12)} ${count}`)
      }

      ui.log('\nBy User:')
      for (const [user, count] of Object.entries(stats.byUser)) {
        ui.log(`  ${user.padEnd(20)} ${count}`)
      }

      ui.log('\nBy Source:')
      for (const [src, count] of Object.entries(stats.bySource)) {
        ui.log(`  ${src.padEnd(10)} ${count}`)
      }
      ui.log('')
    }
  } finally {
    await logger.disconnect()
  }
}

/**
 * Run audit cleanup command - delete old entries
 *
 * vaulter audit cleanup [--retention DAYS] [--dry-run]
 */
export async function runAuditCleanup(context: AuditContext): Promise<void> {
  const { args, config, verbose, dryRun, jsonOutput } = context

  // Get retention days from typed args or config
  const retentionDays = args.retention || config?.audit?.retention_days || 90

  const logger = await createAuditLogger(context)

  try {
    ui.verbose(`Cleaning up entries older than ${retentionDays} days`, verbose)

    // Calculate cutoff date
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

    if (dryRun) {
      // Dry run: count entries that would be deleted
      const stats = await logger.stats(context.project)
      const oldestDate = stats.oldestEntry ? new Date(stats.oldestEntry) : null

      // Estimate entries to delete based on date range
      let estimatedDelete = 0
      if (oldestDate && oldestDate < cutoffDate) {
        // Simple estimate: assume even distribution
        const totalDays = stats.newestEntry
          ? Math.ceil((new Date(stats.newestEntry).getTime() - oldestDate.getTime()) / (24 * 60 * 60 * 1000))
          : 1
        const deleteDays = Math.ceil((cutoffDate.getTime() - oldestDate.getTime()) / (24 * 60 * 60 * 1000))
        estimatedDelete = Math.floor((deleteDays / totalDays) * stats.totalEntries)
      }

      if (jsonOutput) {
        ui.output(JSON.stringify({
          dryRun: true,
          retentionDays,
          cutoffDate: cutoffDate.toISOString(),
          estimatedDelete,
          totalEntries: stats.totalEntries
        }))
      } else {
        ui.log(`Dry run - would delete entries older than ${cutoffDate.toISOString().split('T')[0]}`)
        ui.log(`  Retention: ${retentionDays} days`)
        ui.log(`  Estimated entries to delete: ~${estimatedDelete}`)
        ui.log(`  Total entries: ${stats.totalEntries}`)
        ui.log('')
        ui.log('Run without --dry-run to actually delete entries.')
      }
      return
    }

    const deleted = await ui.withSpinner(
      `Cleaning up entries older than ${retentionDays} days...`,
      () => logger.cleanup(retentionDays),
      { successText: 'Done' }
    )

    if (jsonOutput) {
      ui.output(JSON.stringify({
        deleted,
        retentionDays
      }))
    } else {
      ui.log(`Deleted ${deleted} old audit entries`)
    }
  } finally {
    await logger.disconnect()
  }
}

/**
 * Main audit command handler
 */
export async function runAudit(context: AuditContext): Promise<void> {
  const subcommand = context.args._[1] || 'list'

  switch (subcommand) {
    case 'list':
    case 'ls':
      await runAuditList(context)
      break

    case 'show':
      await runAuditShow(context)
      break

    case 'stats':
      await runAuditStats(context)
      break

    case 'cleanup':
      await runAuditCleanup(context)
      break

    default:
      ui.error(`Unknown audit subcommand: ${subcommand}`)
      ui.log('\nAvailable subcommands:')
      ui.log('  list     List audit entries')
      ui.log('  show     Show details of an entry')
      ui.log('  stats    Show audit statistics')
      ui.log('  cleanup  Delete old entries')
      process.exit(1)
  }
}
