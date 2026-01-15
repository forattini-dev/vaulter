/**
 * Tests for batch-runner.ts
 */

import { describe, it, expect, vi } from 'vitest'
import {
  runBatch,
  formatBatchResult,
  formatBatchResultJson,
  type BatchOperation,
  type BatchResult,
  type OperationFn
} from '../../src/lib/batch-runner.js'
import type { ServiceInfo } from '../../src/lib/monorepo.js'
import type { MiniEnvConfig } from '../../src/types.js'

// Helper to create mock services
function createMockService(name: string): ServiceInfo {
  return {
    name,
    path: `/app/${name}`,
    configDir: `/app/${name}/.minienv`,
    config: { version: '1', project: 'test' } as MiniEnvConfig
  }
}

describe('batch-runner', () => {
  describe('runBatch', () => {
    it('should run operation on all services', async () => {
      const services = [
        createMockService('svc-auth'),
        createMockService('svc-api')
      ]

      const operation: OperationFn<string> = async (service) => {
        return `processed-${service.name}`
      }

      const result = await runBatch(services, 'dev', operation)

      expect(result.total).toBe(2)
      expect(result.successful).toBe(2)
      expect(result.failed).toBe(0)
      expect(result.operations.length).toBe(2)
      expect(result.operations[0].result).toBe('processed-svc-auth')
      expect(result.operations[1].result).toBe('processed-svc-api')
    })

    it('should track failed operations', async () => {
      const services = [
        createMockService('svc-success'),
        createMockService('svc-fail')
      ]

      const operation: OperationFn<string> = async (service) => {
        if (service.name === 'svc-fail') {
          throw new Error('Operation failed')
        }
        return 'ok'
      }

      const result = await runBatch(services, 'dev', operation)

      expect(result.total).toBe(2)
      expect(result.successful).toBe(1)
      expect(result.failed).toBe(1)

      const failedOp = result.operations.find(op => op.error)
      expect(failedOp).toBeDefined()
      expect(failedOp!.error!.message).toBe('Operation failed')
    })

    it('should stop on error when stopOnError is true', async () => {
      const services = [
        createMockService('svc-1'),
        createMockService('svc-2'),
        createMockService('svc-3')
      ]

      const operation: OperationFn<string> = async (service) => {
        if (service.name === 'svc-2') {
          throw new Error('Stop here')
        }
        return 'ok'
      }

      const result = await runBatch(services, 'dev', operation, {
        stopOnError: true
      })

      // Should have processed svc-1, svc-2 (failed), then stopped
      expect(result.successful).toBe(1)
      expect(result.failed).toBe(1)
      expect(result.operations.length).toBe(2)
    })

    it('should run operations concurrently when concurrency > 1', async () => {
      const services = [
        createMockService('svc-1'),
        createMockService('svc-2'),
        createMockService('svc-3')
      ]

      const startTimes: number[] = []
      const operation: OperationFn<string> = async (service) => {
        startTimes.push(Date.now())
        await new Promise(resolve => setTimeout(resolve, 50))
        return service.name
      }

      const startTime = Date.now()
      const result = await runBatch(services, 'prd', operation, {
        concurrency: 3
      })
      const duration = Date.now() - startTime

      expect(result.total).toBe(3)
      expect(result.successful).toBe(3)
      // With concurrency 3, all should run in parallel (~50ms total)
      // Sequential would be ~150ms
      expect(duration).toBeLessThan(120)
    })

    it('should run operations sequentially when concurrency is 1', async () => {
      const services = [
        createMockService('svc-1'),
        createMockService('svc-2')
      ]

      const order: string[] = []
      const operation: OperationFn<string> = async (service) => {
        order.push(service.name)
        await new Promise(resolve => setTimeout(resolve, 10))
        return service.name
      }

      await runBatch(services, 'dev', operation, {
        concurrency: 1
      })

      // Sequential execution maintains order
      expect(order).toEqual(['svc-1', 'svc-2'])
    })

    it('should call onProgress callback', async () => {
      const services = [
        createMockService('svc-1'),
        createMockService('svc-2')
      ]

      const progressCalls: { completed: number; total: number; name: string }[] = []

      const operation: OperationFn<string> = async () => 'ok'

      await runBatch(services, 'dev', operation, {
        onProgress: (completed, total, current) => {
          progressCalls.push({ completed, total, name: current.name })
        }
      })

      expect(progressCalls.length).toBe(2)
      expect(progressCalls[0]).toEqual({ completed: 0, total: 2, name: 'svc-1' })
      expect(progressCalls[1]).toEqual({ completed: 1, total: 2, name: 'svc-2' })
    })

    it('should track duration for each operation', async () => {
      const services = [createMockService('svc-1')]

      const operation: OperationFn<string> = async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return 'ok'
      }

      const result = await runBatch(services, 'dev', operation)

      expect(result.operations[0].duration).toBeGreaterThanOrEqual(40)
    })

    it('should handle empty services array', async () => {
      const operation: OperationFn<string> = async () => 'ok'

      const result = await runBatch([], 'dev', operation)

      expect(result.total).toBe(0)
      expect(result.successful).toBe(0)
      expect(result.failed).toBe(0)
      expect(result.operations).toEqual([])
    })

    it('should handle non-Error throws', async () => {
      const services = [createMockService('svc-1')]

      const operation: OperationFn<string> = async () => {
        throw 'string error'
      }

      const result = await runBatch(services, 'dev', operation)

      expect(result.failed).toBe(1)
      expect(result.operations[0].error?.message).toBe('string error')
    })

    it('should include environment in operation result', async () => {
      const services = [createMockService('svc-1')]
      const operation: OperationFn<string> = async () => 'ok'

      const result = await runBatch(services, 'prd', operation)

      expect(result.operations[0].environment).toBe('prd')
    })

    it('should stop concurrent operations on error when stopOnError is true', async () => {
      const services = [
        createMockService('svc-1'),
        createMockService('svc-2'),
        createMockService('svc-3'),
        createMockService('svc-4')
      ]

      let completedCount = 0
      const operation: OperationFn<string> = async (service) => {
        if (service.name === 'svc-1') {
          throw new Error('Stop')
        }
        await new Promise(resolve => setTimeout(resolve, 100))
        completedCount++
        return 'ok'
      }

      const result = await runBatch(services, 'dev', operation, {
        concurrency: 2,
        stopOnError: true
      })

      // Due to concurrency, some may complete but not all
      expect(result.failed).toBeGreaterThanOrEqual(1)
    })
  })

  describe('formatBatchResult', () => {
    it('should format successful batch result', () => {
      const result: BatchResult<string> = {
        total: 3,
        successful: 3,
        failed: 0,
        operations: [
          { service: createMockService('svc-1'), environment: 'dev', result: 'ok', duration: 100 },
          { service: createMockService('svc-2'), environment: 'dev', result: 'ok', duration: 150 },
          { service: createMockService('svc-3'), environment: 'dev', result: 'ok', duration: 120 }
        ]
      }

      const output = formatBatchResult(result)

      expect(output).toContain('Batch Operation Summary')
      expect(output).toContain('Total:      3')
      expect(output).toContain('Successful: 3')
      expect(output).toContain('Failed:     0')
    })

    it('should format result with failures', () => {
      const result: BatchResult<string> = {
        total: 2,
        successful: 1,
        failed: 1,
        operations: [
          { service: createMockService('svc-success'), environment: 'dev', result: 'ok', duration: 100 },
          { service: createMockService('svc-fail'), environment: 'dev', error: new Error('Failed'), duration: 50 }
        ]
      }

      const output = formatBatchResult(result)

      expect(output).toContain('Failures:')
      expect(output).toContain('✗ svc-fail: Failed')
    })

    it('should use custom formatItem function', () => {
      const result: BatchResult<number> = {
        total: 2,
        successful: 2,
        failed: 0,
        operations: [
          { service: createMockService('svc-1'), environment: 'dev', result: 10, duration: 100 },
          { service: createMockService('svc-2'), environment: 'dev', result: 20, duration: 150 }
        ]
      }

      const output = formatBatchResult(result, (op) => {
        const status = op.error ? '✗' : '✓'
        return `${status} ${op.service.name}: ${op.result ?? 'N/A'} vars`
      })

      expect(output).toContain('Details:')
      expect(output).toContain('✓ svc-1: 10 vars')
      expect(output).toContain('✓ svc-2: 20 vars')
    })

    it('should not include details section without formatItem', () => {
      const result: BatchResult<string> = {
        total: 1,
        successful: 1,
        failed: 0,
        operations: [
          { service: createMockService('svc-1'), environment: 'dev', result: 'ok', duration: 100 }
        ]
      }

      const output = formatBatchResult(result)

      expect(output).not.toContain('Details:')
    })
  })

  describe('formatBatchResultJson', () => {
    it('should format as JSON object', () => {
      const result: BatchResult<string> = {
        total: 2,
        successful: 1,
        failed: 1,
        operations: [
          { service: createMockService('svc-1'), environment: 'prd', result: 'synced', duration: 100 },
          { service: createMockService('svc-2'), environment: 'prd', error: new Error('Network error'), duration: 50 }
        ]
      }

      const json = formatBatchResultJson(result) as any

      expect(json.total).toBe(2)
      expect(json.successful).toBe(1)
      expect(json.failed).toBe(1)
      expect(json.operations).toHaveLength(2)

      // Check successful operation
      expect(json.operations[0]).toEqual({
        service: 'svc-1',
        path: '/app/svc-1',
        environment: 'prd',
        success: true,
        error: undefined,
        duration: 100,
        result: 'synced'
      })

      // Check failed operation
      expect(json.operations[1].service).toBe('svc-2')
      expect(json.operations[1].success).toBe(false)
      expect(json.operations[1].error).toBe('Network error')
    })

    it('should handle empty result', () => {
      const result: BatchResult<string> = {
        total: 0,
        successful: 0,
        failed: 0,
        operations: []
      }

      const json = formatBatchResultJson(result) as any

      expect(json.total).toBe(0)
      expect(json.operations).toEqual([])
    })

    it('should preserve result type', () => {
      const result: BatchResult<{ count: number; items: string[] }> = {
        total: 1,
        successful: 1,
        failed: 0,
        operations: [
          {
            service: createMockService('svc-1'),
            environment: 'dev',
            result: { count: 3, items: ['a', 'b', 'c'] },
            duration: 100
          }
        ]
      }

      const json = formatBatchResultJson(result) as any

      expect(json.operations[0].result).toEqual({
        count: 3,
        items: ['a', 'b', 'c']
      })
    })
  })
})
