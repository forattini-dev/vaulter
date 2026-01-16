/**
 * Vaulter Audit Logger
 *
 * Tracks all changes to environment variables for compliance and debugging.
 * Uses s3db.js for storage with automatic retention management.
 */

import { S3db } from 's3db.js/lite'
import { execFileSync } from 'node:child_process'
import type {
  AuditEntry,
  AuditEntryInput,
  AuditQueryOptions,
  AuditConfig
} from '../types.js'

// Default configuration
const DEFAULT_RETENTION_DAYS = 90
const DEFAULT_USER_SOURCE = 'git'

/**
 * Mask sensitive values for audit logs
 * Shows first and last 4 characters with asterisks in between
 *
 * @example
 * maskValue('supersecretpassword') // 'supe****word'
 * maskValue('abc') // '***' (too short)
 * maskValue('') // ''
 */
export function maskValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (value === '') return ''
  if (value.length <= 8) return '*'.repeat(value.length)
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

/**
 * Detect the current user based on configuration
 */
function getUserFromEnv(): string {
  return process.env.USER ||
         process.env.USERNAME ||
         process.env.VAULTER_USER ||
         'anonymous'
}

export function detectUser(source: 'git' | 'env' | 'anonymous' = 'git'): string {
  switch (source) {
    case 'git': {
      try {
        // Use execFileSync to avoid shell injection (safer than execSync)
        const gitUser = execFileSync('git', ['config', 'user.name'], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim()

        if (gitUser) return gitUser

        // Fallback to git email if name not set
        const gitEmail = execFileSync('git', ['config', 'user.email'], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim()

        if (gitEmail) return gitEmail
      } catch {
        // Git not available or not configured
      }
      // Fallback to environment variables when git fails
      return getUserFromEnv()
    }

    case 'env':
      return getUserFromEnv()

    case 'anonymous':
    default:
      return 'anonymous'
  }
}

/**
 * Generate a unique ID for audit entries
 */
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `audit_${timestamp}_${random}`
}

/**
 * AuditLogger - Records all environment variable operations
 *
 * Features:
 * - Automatic user detection (git, env, or anonymous)
 * - Value masking for security
 * - Configurable retention period
 * - Query by project, environment, user, operation, time range
 */
export class AuditLogger {
  private db: S3db | null = null
  private resource: any = null
  private initialized = false
  private config: AuditConfig

  constructor(config: AuditConfig = {}) {
    this.config = {
      enabled: config.enabled !== false, // Default: enabled
      retention_days: config.retention_days || DEFAULT_RETENTION_DAYS,
      user_source: config.user_source || DEFAULT_USER_SOURCE
    }
  }

  /**
   * Initialize the audit logger with a connection string
   * Note: Connection is allowed even when audit.enabled is false
   * (only writing is disabled, reading/cleanup still work)
   */
  async connect(connectionString: string, passphrase?: string): Promise<void> {
    if (this.initialized) return

    this.db = new S3db({
      connectionString,
      passphrase: passphrase || 'vaulter-audit-key'
    })

    await this.db.connect()

    // Create the audit-log resource
    this.resource = await this.db.createResource({
      name: 'audit-log',

      attributes: {
        timestamp: 'date|required',
        user: 'string|required',
        operation: { type: 'string', enum: ['set', 'delete', 'sync', 'push', 'rotate', 'deleteAll'], required: true },
        key: 'string|required',
        project: 'string|required',
        environment: 'string|required',
        service: 'string|optional',
        previousValue: 'string|optional', // Masked
        newValue: 'string|optional',       // Masked
        source: { type: 'string', enum: ['cli', 'mcp', 'api', 'loader'], required: true },
        metadata: 'json|optional'
      },

      // Partitions for efficient querying
      partitions: {
        byProject: {
          fields: { project: 'string' }
        },
        byProjectEnv: {
          fields: { project: 'string', environment: 'string' }
        },
        byUser: {
          fields: { user: 'string' }
        },
        byOperation: {
          fields: { operation: 'string' }
        }
      },

      behavior: 'body-overflow',
      timestamps: true,
      asyncPartitions: true
    })

    this.initialized = true
  }

  /**
   * Log an audit entry
   */
  async log(input: AuditEntryInput): Promise<AuditEntry | null> {
    if (!this.config.enabled) return null
    if (!this.initialized || !this.resource) {
      throw new Error('AuditLogger not initialized. Call connect() first.')
    }

    const id = generateId()
    const user = detectUser(this.config.user_source)
    const timestamp = new Date()

    const entry: AuditEntry = {
      id,
      timestamp,
      user,
      operation: input.operation,
      key: input.key,
      project: input.project,
      environment: input.environment,
      service: input.service,
      previousValue: maskValue(input.previousValue),
      newValue: maskValue(input.newValue),
      source: input.source,
      metadata: input.metadata
    }

    await this.resource.insert(entry)

    return entry
  }

  /**
   * Query audit entries with filters
   * Note: Works even when audit.enabled is false (only writing is disabled)
   */
  async query(options: AuditQueryOptions = {}): Promise<AuditEntry[]> {
    if (!this.initialized || !this.resource) {
      throw new Error('AuditLogger not initialized. Call connect() first.')
    }

    // Determine best partition for query
    let partition: string | undefined
    let partitionValues: Record<string, string> | undefined

    if (options.project && options.environment) {
      partition = 'byProjectEnv'
      partitionValues = { project: options.project, environment: options.environment }
    } else if (options.project) {
      partition = 'byProject'
      partitionValues = { project: options.project }
    } else if (options.user) {
      partition = 'byUser'
      partitionValues = { user: options.user }
    } else if (options.operation) {
      partition = 'byOperation'
      partitionValues = { operation: options.operation }
    }

    const listOptions: any = {}
    if (partition && partitionValues) {
      listOptions.partition = partition
      listOptions.partitionValues = partitionValues
    }
    if (options.limit) listOptions.limit = options.limit
    if (options.offset) listOptions.offset = options.offset

    let results = await this.resource.list(listOptions)

    // Apply additional filters that couldn't be handled by partitions
    if (options.service) {
      results = results.filter((e: AuditEntry) => e.service === options.service)
    }
    if (options.key) {
      // Support glob-style patterns (* and ?)
      // First escape regex metacharacters, then convert glob wildcards
      const escaped = options.key
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
        .replace(/\*/g, '.*')                    // Convert * to .*
        .replace(/\?/g, '.')                     // Convert ? to .
      const keyPattern = new RegExp('^' + escaped + '$')
      results = results.filter((e: AuditEntry) => keyPattern.test(e.key))
    }
    if (options.source) {
      results = results.filter((e: AuditEntry) => e.source === options.source)
    }
    if (options.since) {
      results = results.filter((e: AuditEntry) =>
        new Date(e.timestamp) >= options.since!
      )
    }
    if (options.until) {
      results = results.filter((e: AuditEntry) =>
        new Date(e.timestamp) <= options.until!
      )
    }

    // Sort by timestamp descending (most recent first)
    results.sort((a: AuditEntry, b: AuditEntry) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    return results
  }

  /**
   * Get a single audit entry by ID
   * Note: Works even when audit.enabled is false (only writing is disabled)
   */
  async get(id: string): Promise<AuditEntry | null> {
    if (!this.initialized || !this.resource) {
      throw new Error('AuditLogger not initialized. Call connect() first.')
    }

    try {
      return await this.resource.get(id)
    } catch {
      return null
    }
  }

  /**
   * Cleanup old audit entries based on retention policy
   * Returns the number of entries deleted
   * Note: Works even when audit.enabled is false (only writing is disabled)
   */
  async cleanup(): Promise<number> {
    if (!this.initialized || !this.resource) {
      throw new Error('AuditLogger not initialized. Call connect() first.')
    }

    const retentionDays = this.config.retention_days || DEFAULT_RETENTION_DAYS
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

    // Get all entries (this could be optimized with a date-based partition in future)
    const allEntries = await this.resource.list({})

    let deleted = 0
    for (const entry of allEntries) {
      const entryDate = new Date(entry.timestamp)
      if (entryDate < cutoffDate) {
        await this.resource.delete(entry.id)
        deleted++
      }
    }

    return deleted
  }

  /**
   * Get audit statistics for a project
   */
  async stats(project: string, environment?: string): Promise<{
    totalEntries: number
    byOperation: Record<string, number>
    byUser: Record<string, number>
    bySource: Record<string, number>
    oldestEntry?: Date
    newestEntry?: Date
  }> {
    const entries = await this.query({ project, environment })

    const byOperation: Record<string, number> = {}
    const byUser: Record<string, number> = {}
    const bySource: Record<string, number> = {}

    let oldest: Date | undefined
    let newest: Date | undefined

    for (const entry of entries) {
      // Count by operation
      byOperation[entry.operation] = (byOperation[entry.operation] || 0) + 1

      // Count by user
      byUser[entry.user] = (byUser[entry.user] || 0) + 1

      // Count by source
      bySource[entry.source] = (bySource[entry.source] || 0) + 1

      // Track date range
      const ts = new Date(entry.timestamp)
      if (!oldest || ts < oldest) oldest = ts
      if (!newest || ts > newest) newest = ts
    }

    return {
      totalEntries: entries.length,
      byOperation,
      byUser,
      bySource,
      oldestEntry: oldest,
      newestEntry: newest
    }
  }

  /**
   * Check if audit logging is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled !== false
  }

  /**
   * Check if logger is connected
   */
  isConnected(): boolean {
    return this.initialized
  }

  /**
   * Close the connection
   */
  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.disconnect()
      this.db = null
      this.resource = null
      this.initialized = false
    }
  }
}

/**
 * Create an AuditLogger instance
 */
export function createAuditLogger(config?: AuditConfig): AuditLogger {
  return new AuditLogger(config)
}

export default AuditLogger
