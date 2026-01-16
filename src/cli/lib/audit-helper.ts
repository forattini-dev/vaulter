/**
 * Vaulter CLI - Audit Helper
 *
 * Shared utilities for audit logging in CLI commands
 */

import type { VaulterConfig, AuditSource } from '../../types.js'
import { AuditLogger } from '../../lib/audit.js'
import { resolveBackendUrls, loadEncryptionKey } from '../../index.js'

/**
 * Create and connect an audit logger from config
 * Returns null if audit is disabled or config is missing
 */
export async function createConnectedAuditLogger(
  config: VaulterConfig | null,
  verbose: boolean = false
): Promise<AuditLogger | null> {
  // No config = no audit
  if (!config) return null

  // Check if audit is explicitly disabled
  if (config.audit?.enabled === false) return null

  // Get backend URLs
  const urls = resolveBackendUrls(config)
  if (urls.length === 0) return null

  try {
    const passphrase = await loadEncryptionKey(config) || undefined
    const logger = new AuditLogger(config.audit)
    await logger.connect(urls[0], passphrase)

    if (verbose) {
      console.error('[vaulter] Audit logger connected')
    }

    return logger
  } catch (err) {
    if (verbose) {
      console.error(`[vaulter] Audit logger failed to connect: ${(err as Error).message}`)
    }
    // Don't fail the operation if audit can't connect
    return null
  }
}

/**
 * Log a set operation
 */
export async function logSetOperation(
  logger: AuditLogger | null,
  input: {
    key: string
    previousValue?: string
    newValue: string
    project: string
    environment: string
    service?: string
    source?: AuditSource
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  if (!logger) return

  try {
    await logger.log({
      operation: 'set',
      key: input.key,
      project: input.project,
      environment: input.environment,
      service: input.service,
      previousValue: input.previousValue,
      newValue: input.newValue,
      source: input.source || 'cli',
      metadata: input.metadata
    })
  } catch {
    // Silently ignore audit failures
  }
}

/**
 * Log a delete operation
 */
export async function logDeleteOperation(
  logger: AuditLogger | null,
  input: {
    key: string
    previousValue?: string
    project: string
    environment: string
    service?: string
    source?: AuditSource
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  if (!logger) return

  try {
    await logger.log({
      operation: 'delete',
      key: input.key,
      project: input.project,
      environment: input.environment,
      service: input.service,
      previousValue: input.previousValue,
      source: input.source || 'cli',
      metadata: input.metadata
    })
  } catch {
    // Silently ignore audit failures
  }
}

/**
 * Log a sync operation (for bulk operations)
 */
export async function logSyncOperation(
  logger: AuditLogger | null,
  input: {
    project: string
    environment: string
    service?: string
    added: string[]
    updated: string[]
    deleted: string[]
    source?: AuditSource
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  if (!logger) return

  try {
    // Log a summary entry for sync
    await logger.log({
      operation: 'sync',
      key: '*', // Indicates bulk operation
      project: input.project,
      environment: input.environment,
      service: input.service,
      source: input.source || 'cli',
      metadata: {
        ...input.metadata,
        added: input.added.length,
        updated: input.updated.length,
        deleted: input.deleted.length,
        addedKeys: input.added,
        updatedKeys: input.updated,
        deletedKeys: input.deleted
      }
    })
  } catch {
    // Silently ignore audit failures
  }
}

/**
 * Log a push operation
 */
export async function logPushOperation(
  logger: AuditLogger | null,
  input: {
    project: string
    environment: string
    service?: string
    added: string[]
    updated: string[]
    deleted: string[]
    source?: AuditSource
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  if (!logger) return

  try {
    await logger.log({
      operation: 'push',
      key: '*',
      project: input.project,
      environment: input.environment,
      service: input.service,
      source: input.source || 'cli',
      metadata: {
        ...input.metadata,
        added: input.added.length,
        updated: input.updated.length,
        deleted: input.deleted.length,
        addedKeys: input.added,
        updatedKeys: input.updated,
        deletedKeys: input.deleted
      }
    })
  } catch {
    // Silently ignore audit failures
  }
}

/**
 * Log a deleteAll operation
 */
export async function logDeleteAllOperation(
  logger: AuditLogger | null,
  input: {
    project: string
    environment: string
    service?: string
    deletedKeys: string[]
    source?: AuditSource
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  if (!logger) return

  try {
    await logger.log({
      operation: 'deleteAll',
      key: '*',
      project: input.project,
      environment: input.environment,
      service: input.service,
      source: input.source || 'cli',
      metadata: {
        ...input.metadata,
        deleted: input.deletedKeys.length,
        deletedKeys: input.deletedKeys
      }
    })
  } catch {
    // Silently ignore audit failures
  }
}

/**
 * Disconnect audit logger safely
 */
export async function disconnectAuditLogger(logger: AuditLogger | null): Promise<void> {
  if (!logger) return

  try {
    await logger.disconnect()
  } catch {
    // Silently ignore disconnect failures
  }
}
