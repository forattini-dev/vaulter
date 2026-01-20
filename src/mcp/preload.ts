/**
 * MCP Preload module - runs before any other imports
 * - Prevents MaxListenersExceededWarning from s3db.js dependencies
 * - Suppresses ExperimentalWarning for SQLite
 */

process.setMaxListeners(50)

// Suppress ExperimentalWarning for SQLite (from s3db.js)
const originalEmit = process.emit.bind(process)
process.emit = function (event: string, ...args: unknown[]) {
  if (event === 'warning' && args[0] && typeof args[0] === 'object' && 'name' in args[0]) {
    const warning = args[0] as { name: string; message?: string }
    if (warning.name === 'ExperimentalWarning' && warning.message?.includes('SQLite')) {
      return false
    }
  }
  return originalEmit(event, ...args)
} as typeof process.emit
