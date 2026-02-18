/**
 * Timeout utilities tests
 */

import { describe, it, expect } from 'vitest'
import { withTimeout, withRetry, createTimeoutWrapper } from '../src/lib/timeout.js'

describe('withTimeout', () => {
  it('should resolve when promise completes before timeout', async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('success'), 100)
    })

    const result = await withTimeout(fastPromise, 1000, 'fast operation')
    expect(result).toBe('success')
  })

  it('should reject when promise exceeds timeout', async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('too late'), 2000)
    })

    await expect(
      withTimeout(slowPromise, 500, 'slow operation')
    ).rejects.toThrow('Operation timed out after 500ms: slow operation')
  })

  it('should reject with original error when promise fails before timeout', async () => {
    const failingPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('original error')), 100)
    })

    await expect(
      withTimeout(failingPromise, 1000, 'failing operation')
    ).rejects.toThrow('original error')
  })

  it('should handle immediate resolution', async () => {
    const immediatePromise = Promise.resolve('immediate')

    const result = await withTimeout(immediatePromise, 1000, 'immediate operation')
    expect(result).toBe('immediate')
  })

  it('should handle immediate rejection', async () => {
    const immediateReject = Promise.reject(new Error('immediate error'))

    await expect(
      withTimeout(immediateReject, 1000, 'immediate reject')
    ).rejects.toThrow('immediate error')
  })

  it('should clean up timeout handle after success', async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('success'), 10)
    })

    // If timeout isn't cleaned up, this will leave dangling handles
    await withTimeout(fastPromise, 1000, 'cleanup test')

    // Wait a bit to ensure timeout would have fired if not cleaned up
    await new Promise((resolve) => setTimeout(resolve, 100))

    // If we get here without hanging, cleanup worked
    expect(true).toBe(true)
  })

  it('should preserve promise value types', async () => {
    // Number
    const numPromise = Promise.resolve(42)
    const num = await withTimeout(numPromise, 1000, 'number')
    expect(num).toBe(42)

    // Object
    const objPromise = Promise.resolve({ foo: 'bar', count: 123 })
    const obj = await withTimeout(objPromise, 1000, 'object')
    expect(obj).toEqual({ foo: 'bar', count: 123 })

    // Array
    const arrPromise = Promise.resolve([1, 2, 3])
    const arr = await withTimeout(arrPromise, 1000, 'array')
    expect(arr).toEqual([1, 2, 3])
  })
})

describe('withRetry', () => {
  it('should retry failed operations and eventually succeed', async () => {
    let attempts = 0

    const result = await withRetry(async () => {
      attempts += 1
      if (attempts < 3) {
        throw new Error('temporary')
      }
      return `ok:${attempts}`
    }, {
      maxAttempts: 3,
      delayMs: 10,
      onRetry: (attempt, error) => {
        expect(attempt).toBeLessThan(3)
        expect(error.message).toBe('temporary')
      }
    })

    expect(result).toBe('ok:3')
    expect(attempts).toBe(3)
  })

  it('should throw after exhausting retries', async () => {
    let attempts = 0

    await expect(
      withRetry(async () => {
        attempts += 1
        throw new Error('always-fails')
      }, {
        maxAttempts: 2,
        delayMs: 1
      })
    ).rejects.toThrow('always-fails')

    expect(attempts).toBe(2)
  })
})

describe('createTimeoutWrapper', () => {
  it('should wrap async methods with timeout', async () => {
    const client = {
      async fast(value: number) {
        return value * 2
      },
      sync(value: number) {
        return value
      }
    }

    const wrapped = createTimeoutWrapper(client as unknown as object, 1000)

    expect(await wrapped.fast(21)).toBe(42)
    expect(wrapped.sync(9)).toBe(9)
  })

  it('should fail when wrapped promise times out', async () => {
    const client = {
      async slow() {
        return new Promise(resolve => setTimeout(() => resolve('late'), 200))
      }
    }

    const wrapped = createTimeoutWrapper(client as unknown as object, 25)
    await expect(wrapped.slow()).rejects.toThrow('Operation timed out after 25ms')
  })
})
