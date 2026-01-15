/**
 * MiniEnv - Multi-backend environment variable and secrets manager
 *
 * Main library exports for programmatic usage
 */

// Client
export { MiniEnvClient, createClient } from './client.js'
export type { MiniEnvClientOptions, ListOptions, SyncResult } from './types.js'

// Types
export type {
  Environment,
  EnvVar,
  EnvVarInput,
  EnvVarMetadata,
  MiniEnvConfig,
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

// Env parser
export {
  parseEnvFile,
  parseEnvString,
  serializeEnv,
  hasStdinData,
  parseEnvFromStdin
} from './lib/env-parser.js'
