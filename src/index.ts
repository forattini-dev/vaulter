/**
 * Vaulter - Multi-backend environment variable and secrets manager
 *
 * Main library exports for programmatic usage
 */

// Client
export { VaulterClient, createClient, generateVarId, parseVarId } from './client.js'
export type { VaulterClientOptions, ListOptions, SyncResult, BatchResult, BatchOptions } from './types.js'

// Types
export type {
  Environment,
  EnvVar,
  EnvVarInput,
  EnvVarMetadata,
  VaulterConfig,
  ExportFormat,
  // Output targets
  OutputTarget,
  OutputTargetInput,
  NormalizedOutputTarget,
  SharedVarsConfig,
  // Per-environment keys
  EnvironmentKeyConfig,
  EncryptionMode,
  AsymmetricAlgorithm
} from './types.js'

export {
  DEFAULT_ENVIRONMENTS,
  DEFAULT_ENVIRONMENT,
  COMMON_ENVIRONMENT_NAMES,
  EXPORT_FORMATS,
  DEFAULT_SECRET_PATTERNS
} from './types.js'

// Config utilities
export {
  loadConfig,
  findConfigDir,
  getProjectName,
  configExists,
  loadEncryptionKeyForEnv,
  createDefaultConfig,
  getValidEnvironments,
  isValidEnvironment,
  getDefaultEnvironment,
  getProjectKeysDir,
  getGlobalKeysDir,
  resolveBackendUrls
} from './lib/config-loader.js'

// Key management (per-environment keys)
export {
  generateKey,
  loadKeyForEnv,
  listKeys,
  keyExistsForEnv,
  getKeyPathForEnv,
  deleteKey
} from './lib/keys.js'

export type {
  GenerateKeyOptions,
  GenerateKeyResult,
  LoadKeyForEnvOptions,
  LoadKeyForEnvResult,
  ListKeysOptions,
  KeyInfo
} from './lib/keys.js'

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

// Smart config (auto-detects environment)
export {
  config,
  detectEnvironment,
  isKubernetes,
  isCI,
  shouldLoadEnvFiles,
  getEnvironmentInfo,
  getDeployEnvironment
} from './config.js'
export type {
  ConfigMode,
  ConfigOptions,
  ConfigResult,
  DetectedEnvironment
} from './config.js'

// Audit logging
export {
  AuditLogger,
  createAuditLogger,
  maskValue,
  detectUser
} from './lib/audit.js'

export type {
  AuditEntry,
  AuditEntryInput,
  AuditQueryOptions,
  AuditConfig,
  AuditOperation,
  AuditSource
} from './types.js'

// Output targets (framework-agnostic .env generation)
export {
  normalizeOutputTarget,
  normalizeOutputTargets,
  filterVarsByPatterns,
  getSharedVars,
  formatEnvFile,
  pullToOutputs,
  validateOutputsConfig
} from './lib/outputs.js'

export type {
  PullToOutputsOptions,
  PullToOutputsResult
} from './lib/outputs.js'

// Runtime loader (load secrets from backend at startup)
export {
  loadRuntime,
  isRuntimeAvailable,
  getRuntimeInfo
} from './runtime/index.js'

export type {
  RuntimeLoaderOptions,
  RuntimeLoaderResult
} from './runtime/index.js'
