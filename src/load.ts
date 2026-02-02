/**
 * Vaulter Dynamic Loader - Side Effect Import
 *
 * Import this module to automatically load environment variables
 * from the backend at application startup, similar to dotenv/config.
 *
 * @example
 * ```typescript
 * // At the very top of your entry file (before any other imports)
 * import 'vaulter/load'
 *
 * // Now process.env has all your secrets from the backend
 * import { app } from './app'
 * app.start()
 * ```
 *
 * This is equivalent to:
 * ```typescript
 * import { loadRuntime } from 'vaulter/runtime'
 * await loadRuntime()
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
 * For local .env file loading (like dotenv), use:
 * ```typescript
 * import { config } from 'vaulter'
 * config()
 * ```
 *
 * @module vaulter/load
 */

// Re-export for programmatic access
export { loadPromise, loadError, loaded } from './runtime/load.js'

// The actual loading happens via top-level await in runtime/load.js
// Just importing this file triggers the load
import './runtime/load.js'
