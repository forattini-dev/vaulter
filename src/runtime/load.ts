/**
 * Vaulter Runtime Loader - Side Effect Import
 *
 * Import this module to automatically load environment variables
 * from the backend at application startup.
 *
 * @example
 * ```typescript
 * // At the very top of your entry file (before any other imports)
 * import 'vaulter/runtime/load'
 *
 * // Now process.env has all your secrets
 * import { app } from './app'
 * app.start()
 * ```
 *
 * Configuration is read from:
 * 1. Environment variables (VAULTER_BACKEND, VAULTER_KEY, etc.)
 * 2. .vaulter/config.yaml (searched from cwd upward)
 *
 * Environment-specific keys:
 * - VAULTER_KEY_PRD, VAULTER_KEY_DEV, etc. (per-environment)
 * - VAULTER_KEY (global fallback)
 *
 * Behavior:
 * - In production (prd/prod/production): Fails if secrets can't be loaded
 * - In other environments: Warns but continues
 *
 * @module vaulter/runtime/load
 */

import { loadRuntime } from './loader.js'

// Store the promise so it can be awaited if needed
let loadPromise: Promise<void> | null = null
let loadError: Error | null = null
let loaded = false

/**
 * Execute the runtime loader synchronously at import time
 *
 * Note: This uses top-level await which requires:
 * - Node.js 14.8+ with --experimental-top-level-await, or
 * - Node.js 16+ (stable), or
 * - ES modules (type: "module" in package.json or .mjs extension)
 */
async function initialize(): Promise<void> {
  if (loaded) return

  try {
    await loadRuntime({
      // Let loadRuntime auto-detect everything from config and env vars
      // Users can override via environment variables:
      // - VAULTER_BACKEND
      // - VAULTER_KEY or VAULTER_KEY_{ENV}
      // - VAULTER_PROJECT
      // - VAULTER_SERVICE
      // - NODE_ENV (for environment)
      // - VAULTER_VERBOSE=1 (for debug output)
      silent: process.env.VAULTER_SILENT === '1'
    })
    loaded = true
  } catch (err) {
    loadError = err instanceof Error ? err : new Error(String(err))
    throw loadError
  }
}

// Execute immediately using top-level await
loadPromise = initialize()

// Export for programmatic access
export { loadPromise, loadError, loaded }

// Re-throw if there was an error (this will crash the app in production)
await loadPromise
