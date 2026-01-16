/**
 * Vaulter - Type Definitions
 */

// ============================================================================
// Environment Types
// ============================================================================

/**
 * Environment name - user-defined string
 *
 * Users can define any environment names they prefer:
 * - Short: 'dev', 'stg', 'prd', 'sbx', 'dr'
 * - Full: 'development', 'staging', 'production'
 * - Custom: 'homolog', 'qa', 'uat', 'preprod'
 */
export type Environment = string

/** Default environments used when initializing a new project */
export const DEFAULT_ENVIRONMENTS: string[] = ['dev', 'stg', 'prd']

/** Default environment when none specified */
export const DEFAULT_ENVIRONMENT = 'dev'

/**
 * Common environment name mappings (for display/documentation)
 * Users are not limited to these - any string is valid
 */
export const COMMON_ENVIRONMENT_NAMES: Record<string, string> = {
  dev: 'development',
  development: 'development',
  stg: 'staging',
  staging: 'staging',
  prd: 'production',
  prod: 'production',
  production: 'production',
  sbx: 'sandbox',
  sandbox: 'sandbox',
  dr: 'disaster-recovery',
  qa: 'quality assurance',
  uat: 'user acceptance testing',
  homolog: 'homologation',
  preprod: 'pre-production'
}

// Legacy exports for backward compatibility
/** @deprecated Use DEFAULT_ENVIRONMENTS instead */
export const ENVIRONMENTS = DEFAULT_ENVIRONMENTS

// ============================================================================
// Environment Variable Types
// ============================================================================

export interface EnvVarMetadata {
  description?: string
  owner?: string
  rotateAfter?: Date
  rotatedAt?: string
  source?: 'manual' | 'sync' | 'import' | 'rotation'
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

// ============================================================================
// Asymmetric Encryption Types
// ============================================================================

/**
 * Encryption mode
 * - symmetric: Single passphrase (AES-256-GCM) - default, uses s3db.js built-in
 * - asymmetric: RSA/EC key pair with hybrid encryption
 */
export type EncryptionMode = 'symmetric' | 'asymmetric'

/**
 * Asymmetric key algorithm
 * - rsa-4096: RSA 4096-bit (widely compatible)
 * - rsa-2048: RSA 2048-bit (faster, less secure)
 * - ec-p256: Elliptic Curve P-256 (modern, fast)
 * - ec-p384: Elliptic Curve P-384 (stronger EC)
 */
export type AsymmetricAlgorithm = 'rsa-4096' | 'rsa-2048' | 'ec-p256' | 'ec-p384'

/**
 * Key source for asymmetric keys
 */
export interface AsymmetricKeySourceEnv {
  env: string
}

export interface AsymmetricKeySourceFile {
  file: string
}

export interface AsymmetricKeySourceS3 {
  s3: string
}

export type AsymmetricKeySource = AsymmetricKeySourceEnv | AsymmetricKeySourceFile | AsymmetricKeySourceS3

/**
 * Asymmetric encryption configuration
 */
export interface AsymmetricEncryptionConfig {
  /** Key algorithm */
  algorithm?: AsymmetricAlgorithm
  /**
   * Key name for automatic resolution
   * - "master" → ~/.vaulter/projects/<project>/keys/master[.pub]
   * - "global:master" → ~/.vaulter/global/keys/master[.pub]
   */
  key_name?: string
  /** Public key source (required for encryption) - alternative to key_name */
  public_key?: AsymmetricKeySource[]
  /** Private key source (required for decryption) - alternative to key_name */
  private_key?: AsymmetricKeySource[]
}

/**
 * Hybrid-encrypted data format
 * Uses asymmetric encryption for key exchange, symmetric for data
 */
export interface HybridEncryptedData {
  /** Version for future compatibility */
  v: 1
  /** Algorithm used (e.g., 'rsa-4096+aes-256-gcm') */
  alg: string
  /** RSA/EC encrypted AES key (base64) */
  key: string
  /** AES-GCM initialization vector (base64) */
  iv: string
  /** AES-GCM encrypted data (base64) */
  data: string
  /** AES-GCM auth tag (base64) */
  tag: string
}

export interface EncryptionConfig {
  /** Encryption mode: symmetric (default) or asymmetric */
  mode?: EncryptionMode
  /** Symmetric key sources (passphrase) - used when mode is 'symmetric' */
  key_source?: KeySource[]
  /** Asymmetric encryption config - used when mode is 'asymmetric' */
  asymmetric?: AsymmetricEncryptionConfig
  /** @deprecated Use mode instead */
  algorithm?: 'aes-256-gcm'
  rotation?: {
    enabled: boolean
    interval_days: number
    /** Glob patterns for secrets that should be rotated (e.g., ["*_KEY", "*_SECRET"]) */
    patterns?: string[]
  }
}

export interface SyncConfig {
  conflict?: 'local' | 'remote' | 'error'
  ignore?: string[]
  /** Required variables per environment (keys are environment names) */
  required?: Record<string, string[]>
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
  /** User-defined environment names (e.g., ['dev', 'stg', 'prd'] or ['development', 'production']) */
  environments?: string[]
  /** Default environment when -e flag is not provided */
  default_environment?: string
  extends?: string
  sync?: SyncConfig
  integrations?: IntegrationsConfig
  hooks?: HooksConfig
  security?: SecurityConfig
  /** Directory structure configuration (unified or split mode) */
  directories?: DirectoriesConfig
  /** Audit logging configuration */
  audit?: AuditConfig
  /** MCP server configuration (defaults when running in this project) */
  mcp?: McpConfig
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
  // Key command flags
  asymmetric?: boolean
  asym?: boolean
  algorithm?: string
  alg?: string
  name?: string
  global?: boolean
  // List command flags
  'all-envs'?: boolean
  // Rotation command flags
  days?: number
  interval?: string
  clear?: boolean
  overdue?: boolean
  fail?: boolean
  // Audit command flags
  retention?: number
  pattern?: string  // Key pattern filter (renamed from --key to avoid global conflict)
  user?: string
  operation?: string
  since?: string
  until?: string
  limit?: number
  source?: string
}

export interface CommandContext {
  project: string
  service?: string
  environment: Environment
  config: VaulterConfig
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

// ============================================================================
// Client Types
// ============================================================================

export interface VaulterClientOptions {
  /** Single connection string */
  connectionString?: string
  /** Multiple connection strings with fallback (tries in order) */
  connectionStrings?: string[]
  /** Encryption passphrase (symmetric mode) */
  passphrase?: string
  /** Encryption mode: symmetric (default) or asymmetric */
  encryptionMode?: EncryptionMode
  /** Public key PEM string (asymmetric mode - for encryption) */
  publicKey?: string
  /** Private key PEM string (asymmetric mode - for decryption) */
  privateKey?: string
  /** Asymmetric algorithm (default: rsa-4096) */
  asymmetricAlgorithm?: AsymmetricAlgorithm
  /** Full config object */
  config?: VaulterConfig
  /** Enable verbose logging */
  verbose?: boolean
}

export interface ListOptions {
  project?: string
  service?: string
  environment?: string
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

export type ExportFormat = 'shell' | 'json' | 'yaml' | 'env' | 'tfvars' | 'docker-args'

export const EXPORT_FORMATS: ExportFormat[] = ['shell', 'json', 'yaml', 'env', 'tfvars', 'docker-args']

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

// ============================================================================
// Audit Logging Types
// ============================================================================

/**
 * Operations that can be audited
 */
export type AuditOperation = 'set' | 'delete' | 'sync' | 'push' | 'rotate' | 'deleteAll'

/**
 * Source of the audit event
 */
export type AuditSource = 'cli' | 'mcp' | 'api' | 'loader'

/**
 * Audit log entry
 */
export interface AuditEntry {
  /** Unique identifier */
  id: string
  /** When the operation occurred */
  timestamp: Date
  /** Who performed the operation */
  user: string
  /** What operation was performed */
  operation: AuditOperation
  /** Which variable key was affected */
  key: string
  /** Project name */
  project: string
  /** Environment name */
  environment: string
  /** Service name (optional, for monorepos) */
  service?: string
  /** Masked previous value (first/last 4 chars) */
  previousValue?: string
  /** Masked new value (first/last 4 chars) */
  newValue?: string
  /** Source of the operation */
  source: AuditSource
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Input for creating an audit entry
 */
export interface AuditEntryInput {
  operation: AuditOperation
  key: string
  project: string
  environment: string
  service?: string
  previousValue?: string
  newValue?: string
  source: AuditSource
  metadata?: Record<string, unknown>
}

/**
 * Query options for listing audit entries
 */
export interface AuditQueryOptions {
  /** Filter by project */
  project?: string
  /** Filter by environment */
  environment?: string
  /** Filter by service */
  service?: string
  /** Filter by user */
  user?: string
  /** Filter by operation type */
  operation?: AuditOperation
  /** Filter by key pattern */
  key?: string
  /** Filter by source */
  source?: AuditSource
  /** Filter entries after this date */
  since?: Date
  /** Filter entries before this date */
  until?: Date
  /** Maximum number of entries to return */
  limit?: number
  /** Number of entries to skip */
  offset?: number
}

/**
 * Audit configuration in config.yaml
 */
export interface AuditConfig {
  /** Enable audit logging (default: true) */
  enabled?: boolean
  /** Retention period in days (default: 90) */
  retention_days?: number
  /** How to detect user identity */
  user_source?: 'git' | 'env' | 'anonymous'
}

// ============================================================================
// MCP Server Configuration (for ~/.vaulter/config.yaml global config)
// ============================================================================

/**
 * MCP server configuration
 *
 * Used in ~/.vaulter/config.yaml as fallback when no project config is found.
 * Allows MCP to work without --cwd by providing global defaults.
 */
export interface McpConfig {
  /** Default backend URL when no project config is found */
  default_backend?: string
  /** Default project name for operations */
  default_project?: string
  /** Default environment */
  default_environment?: string
  /** Default encryption key source */
  default_key?: string
}

/**
 * Global vaulter configuration (~/.vaulter/config.yaml)
 *
 * This is separate from project config - it provides user-level defaults.
 */
export interface GlobalVaulterConfig {
  /** MCP server defaults */
  mcp?: McpConfig
}
