/**
 * Batch Runner
 *
 * Execute operations across multiple services in a monorepo
 */

import pLimit from 'p-limit'
import type { ServiceInfo } from './monorepo.js'
import type { Environment } from '../types.js'

export interface BatchOperation<T> {
  service: ServiceInfo
  environment: Environment
  result?: T
  error?: Error
  duration: number
}

export interface BatchResult<T> {
  total: number
  successful: number
  failed: number
  operations: BatchOperation<T>[]
}

export type OperationFn<T> = (
  service: ServiceInfo,
  environment: Environment
) => Promise<T>

/**
 * Run an operation across multiple services
 */
export async function runBatch<T>(
  services: ServiceInfo[],
  environment: Environment,
  operation: OperationFn<T>,
  options: {
    concurrency?: number
    stopOnError?: boolean
    onProgress?: (completed: number, total: number, current: ServiceInfo) => void
  } = {}
): Promise<BatchResult<T>> {
  const {
    concurrency = 1,
    stopOnError = false,
    onProgress
  } = options

  const operations: BatchOperation<T>[] = []
  let successful = 0
  let failed = 0

  const runOperation = async (service: ServiceInfo, index: number): Promise<void> => {
    if (onProgress) {
      onProgress(index, services.length, service)
    }

    const startTime = Date.now()

    try {
      const result = await operation(service, environment)
      const duration = Date.now() - startTime

      operations.push({
        service,
        environment,
        result,
        duration
      })

      successful++
    } catch (err) {
      const duration = Date.now() - startTime

      operations.push({
        service,
        environment,
        error: err instanceof Error ? err : new Error(String(err)),
        duration
      })

      failed++
    }
  }

  if (concurrency <= 1) {
    for (let i = 0; i < services.length; i++) {
      await runOperation(services[i], i)
      if (stopOnError && failed > 0) {
        break
      }
    }
  } else {
    const limit = pLimit(concurrency)
    let hasError = false

    await Promise.all(
      services.map((service, index) =>
        limit(async () => {
          if (stopOnError && hasError) {
            return
          }
          await runOperation(service, index)
          if (stopOnError && failed > 0) {
            hasError = true
          }
        })
      )
    )
  }

  return {
    total: services.length,
    successful,
    failed,
    operations
  }
}

/**
 * Format batch result for display
 */
export function formatBatchResult<T>(
  result: BatchResult<T>,
  formatItem?: (op: BatchOperation<T>) => string
): string {
  const lines: string[] = []

  lines.push('')
  lines.push(`Batch Operation Summary:`)
  lines.push(`  Total:      ${result.total}`)
  lines.push(`  Successful: ${result.successful}`)
  lines.push(`  Failed:     ${result.failed}`)
  lines.push('')

  if (result.failed > 0) {
    lines.push('Failures:')
    for (const op of result.operations) {
      if (op.error) {
        lines.push(`  ✗ ${op.service.name}: ${op.error.message}`)
      }
    }
    lines.push('')
  }

  if (formatItem) {
    lines.push('Details:')
    for (const op of result.operations) {
      lines.push(`  ${formatItem(op)}`)
    }
  }

  return lines.join('\n')
}

/**
 * Format batch result as JSON
 */
export function formatBatchResultJson<T>(result: BatchResult<T>): object {
  return {
    total: result.total,
    successful: result.successful,
    failed: result.failed,
    operations: result.operations.map(op => ({
      service: op.service.name,
      path: op.service.path,
      environment: op.environment,
      success: !op.error,
      error: op.error?.message,
      duration: op.duration,
      result: op.result
    }))
  }
}
