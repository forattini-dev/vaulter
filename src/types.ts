/**
 * Vaulter - Type Definitions
 */

// ============================================================================
// Environment Types
// ============================================================================

export type Environment = 'dev' | 'stg' | 'prd' | 'sbx' | 'dr'

export const ENVIRONMENTS: Environment[] = ['dev', 'stg', 'prd', 'sbx', 'dr']

export const ENVIRONMENT_NAMES: Record<Environment, string> = {
  dev: 'development',
  stg: 'staging',
  prd: 'production',
  sbx: 'sandbox',
  dr: 'disaster-recovery'
}

// ============================================================================
// Environment Variable Types
// ============================================================================

export interface EnvVarMetadata {
  description?: string
  owner?: string
  rotateAfter?: Date
  source?: 'manual' | 'sync' | 'import'
}

export interface EnvVar {
  id: string
  key: string
  value: string
  project: string
  service?: string
  environment: Environment
  tags?: string[]
  metadata?: EnvVarMetadata
  createdAt: Date
  updatedAt: Date
}

export interface EnvVarInput {
  key: string
  value: string
  project: string
  service?: string
  environment: Environment
  tags?: string[]
  metadata?: EnvVarMetadata
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface BackendConfig {
  /** Single backend URL */
  url?: string
  /** Multiple backend URLs with fallback (tries in order) */
  urls?: string[]
}

export interface KeySourceEnv {
  env: string
}

export interface KeySourceFile {
  file: string
}

export interface KeySourceS3 {
  s3: string
}

export type KeySource = KeySourceEnv | KeySourceFile | KeySourceS3

export interface EncryptionConfig {
  key_source?: KeySource[]
  algorithm?: 'aes-256-gcm'
  rotation?: {
    enabled: boolean
    interval_days: number
  }
}

export interface SyncConfig {
  conflict?: 'local' | 'remote' | 'error'
  ignore?: string[]
  required?: Record<Environment, string[]>
}

export interface KubernetesIntegrationConfig {
  namespace?: string
  secret_name?: string
  configmap_name?: string
}

export interface TerraformIntegrationConfig {
  var_file?: string
}

export interface HelmIntegrationConfig {
  values_file?: string
}

export interface IntegrationsConfig {
  kubernetes?: KubernetesIntegrationConfig
  terraform?: TerraformIntegrationConfig
  helm?: HelmIntegrationConfig
}

export interface HooksConfig {
  pre_sync?: string | null
  post_sync?: string | null
  pre_pull?: string | null
  post_pull?: string | null
}

export interface SecurityConfig {
  paranoid?: boolean
  confirm_production?: boolean
  auto_encrypt?: {
    patterns?: string[]
  }
}

/**
 * Directory structure configuration
 *
 * Supports two modes:
 * - unified (default): All env files in .vaulter/environments/<env>.env
 * - split: Separate directories for configs and secrets (apps-lair pattern)
 *
 * Split mode example:
 *   deploy/configs/dev.env  → Non-sensitive (committable)
 *   deploy/secrets/dev.env  → Sensitive (gitignored)
 */
export interface DirectoriesConfig {
  /** Directory structure mode */
  mode?: 'unified' | 'split'
  /** Path to configs directory (non-sensitive, committable) - used in split mode */
  configs?: string
  /** Path to secrets directory (sensitive, gitignored) - used in split mode */
  secrets?: string
  /** Path to unified environments directory - used in unified mode */
  path?: string
}

export interface VaulterConfig {
  version: '1'
  project: string
  service?: string
  backend?: BackendConfig
  encryption?: EncryptionConfig
  environments?: Environment[]
  default_environment?: Environment
  extends?: string
  sync?: SyncConfig
  integrations?: IntegrationsConfig
  hooks?: HooksConfig
  security?: SecurityConfig
  /** Directory structure configuration (unified or split mode) */
  directories?: DirectoriesConfig
}

// ============================================================================
// CLI Types
// ============================================================================

export interface CLIArgs {
  _: string[]
  // Global flags
  project?: string
  p?: string
  service?: string
  s?: string
  env?: string
  e?: string
  backend?: string
  b?: string
  key?: string
  k?: string
  verbose?: boolean
  v?: boolean
  'dry-run'?: boolean
  json?: boolean
  'no-color'?: boolean
  help?: boolean
  h?: boolean
  version?: boolean
  // Command-specific flags
  file?: string
  f?: string
  output?: string
  o?: string
  force?: boolean
  all?: boolean
  namespace?: string
  n?: string
  format?: string
  // Init command flags
  split?: boolean
}

export interface CommandContext {
  project: string
  service?: string
  environment: Environment
  config: VaulterConfig
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
  noColor: boolean
}

// ============================================================================
// Client Types
// ============================================================================

export interface VaulterClientOptions {
  /** Single connection string */
  connectionString?: string
  /** Multiple connection strings with fallback (tries in order) */
  connectionStrings?: string[]
  /** Encryption passphrase */
  passphrase?: string
  /** Full config object */
  config?: VaulterConfig
  /** Enable verbose logging */
  verbose?: boolean
}

export interface ListOptions {
  project?: string
  service?: string
  environment?: Environment
  limit?: number
  offset?: number
}

export interface SyncResult {
  added: string[]
  updated: string[]
  deleted: string[]
  unchanged: string[]
  conflicts: Array<{
    key: string
    localValue: string
    remoteValue: string
  }>
  localAdded?: string[]
  localUpdated?: string[]
  localDeleted?: string[]
}

// ============================================================================
// Output Formats
// ============================================================================

export type ExportFormat = 'shell' | 'json' | 'yaml' | 'env' | 'tfvars'

export const EXPORT_FORMATS: ExportFormat[] = ['shell', 'json', 'yaml', 'env', 'tfvars']

// ============================================================================
// Secret Detection Patterns
// ============================================================================

export const DEFAULT_SECRET_PATTERNS = [
  '*_KEY',
  '*_SECRET',
  '*_TOKEN',
  '*_PASSWORD',
  '*_CREDENTIAL',
  '*_PASS',
  '*_PWD',
  '*_PRIVATE',
  '*_CERT',
  '*_SSL',
  '*_TLS',
  '*_ENCRYPT',
  '*_HASH',
  '*_SALT',
  'DATABASE_URL',
  'REDIS_URL',
  'MONGODB_URL',
  'API_KEY',
  'AUTH_*'
]
