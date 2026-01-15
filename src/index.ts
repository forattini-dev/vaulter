/**
 * Vaulter - Multi-backend environment variable and secrets manager
 *
 * Main library exports for programmatic usage
 */

// Client
export { VaulterClient, createClient } from './client.js'
export type { VaulterClientOptions, ListOptions, SyncResult } from './types.js'

// Types
export type {
  Environment,
  EnvVar,
  EnvVarInput,
  EnvVarMetadata,
  VaulterConfig,
  ExportFormat
} from './types.js'

export { ENVIRONMENTS, ENVIRONMENT_NAMES, EXPORT_FORMATS, DEFAULT_SECRET_PATTERNS } from './types.js'

// Config utilities
export {
  loadConfig,
  findConfigDir,
  getProjectName,
  configExists,
  loadEncryptionKey,
  createDefaultConfig
} from './lib/config-loader.js'

// Backend URL resolver
import type { VaulterConfig } from './types.js'

/**
 * Resolve backend URLs from config
 * Supports both single `url` and multiple `urls` with fallback
 */
export function resolveBackendUrls(config: VaulterConfig): string[] {
  if (!config.backend) {
    return []
  }

  // If urls array is provided, use it
  if (config.backend.urls && config.backend.urls.length > 0) {
    return config.backend.urls.filter(url => url && url.trim() !== '')
  }

  // Otherwise use single url
  if (config.backend.url && config.backend.url.trim() !== '') {
    return [config.backend.url]
  }

  return []
}

// Env parser
export {
  parseEnvFile,
  parseEnvString,
  serializeEnv,
  hasStdinData,
  parseEnvFromStdin
} from './lib/env-parser.js'

// Loader (dotenv integration)
export { loader, parse } from './loader.js'
export type { LoaderOptions } from './loader.js'
