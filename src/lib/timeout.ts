/**
 * Timeout utilities for async operations
 *
 * Prevents operations from hanging indefinitely when backends are slow or unresponsive.
 */

/**
 * Retry an async operation with exponential backoff
 *
 * @param fn - Function to retry
 * @param options - Retry options
 * @returns Result of the function
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => client.connect(),
 *   { maxAttempts: 3, delayMs: 1000 }
 * )
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number
    delayMs?: number
    backoffMultiplier?: number
    onRetry?: (attempt: number, error: Error) => void
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    onRetry
  } = options

  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      if (attempt === maxAttempts) {
        break
      }

      if (onRetry) {
        onRetry(attempt, lastError)
      }

      // Exponential backoff: 1s, 2s, 4s, 8s, etc.
      const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError || new Error('withRetry failed with unknown error')
}

/**
 * Wrap a promise with a timeout
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operation - Operation name for error message
 * @returns Promise that rejects if timeout is reached
 *
 * @example
 * ```ts
 * const result = await withTimeout(
 *   client.list({ project, environment }),
 *   30000,
 *   'list variables'
 * )
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms: ${operation}`))
    }, timeoutMs)
  })

  try {
    const result = await Promise.race([promise, timeoutPromise])
    clearTimeout(timeoutHandle!)
    return result
  } catch (error) {
    clearTimeout(timeoutHandle!)
    throw error
  }
}

/**
 * Create a timeout wrapper for a client instance
 *
 * Returns a Proxy that wraps all async methods with timeout
 *
 * @param client - Client instance to wrap
 * @param timeoutMs - Default timeout in milliseconds
 * @returns Proxied client with timeout on all methods
 *
 * @example
 * ```ts
 * const client = new VaulterClient({ ... })
 * const timedClient = createTimeoutWrapper(client, 30000)
 * await timedClient.connect() // Has 30s timeout
 * await timedClient.get(...) // Has 30s timeout
 * ```
 */
export function createTimeoutWrapper<T extends object>(
  client: T,
  timeoutMs: number
): T {
  return new Proxy(client, {
    get(target: any, prop: string | symbol) {
      const value = target[prop]

      // Only wrap async methods (functions that return promises)
      if (typeof value === 'function') {
        return function (this: any, ...args: any[]) {
          const result = value.apply(this === client ? target : this, args)

          // Check if result is a Promise
          if (result && typeof result.then === 'function') {
            return withTimeout(result, timeoutMs, String(prop))
          }

          return result
        }
      }

      return value
    }
  })
}
