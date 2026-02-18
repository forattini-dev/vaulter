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
export const DEFAULT_ENVIRONMENTS: string[] = ['dev', 'stg', 'sdx', 'prd']

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
  sdx: 'sandbox',
  sbx: 'sandbox',
  sandbox: 'sandbox',
  prd: 'production',
  prod: 'production',
  production: 'production',
  dr: 'disaster-recovery',
  dry: 'disaster-recovery',
  qa: 'quality assurance',
  uat: 'user acceptance testing',
  homolog: 'homologation',
  preprod: 'pre-production'
}

// ============================================================================
// Environment Variable Types
// ============================================================================

/**
 * Individual version entry in version history
 */
export interface VersionEntry {
  /** Version number (1-indexed) */
  version: number
  /** Encrypted value for this version */
  value: string
  /** When this version was created */
  timestamp: string
  /** Who created this version */
  user: string
  /** Source of the operation that created this version */
  source: AuditSource
  /** Operation that created this version */
  operation: 'set' | 'rotate' | 'copy' | 'rename' | 'rollback'
  /** SHA256 checksum of plaintext value (for integrity verification) */
  checksum: string
  /** Optional metadata for this version */
  metadata?: Record<string, unknown>
}

export interface EnvVarMetadata {
  description?: string
  owner?: string
  rotateAfter?: Date
  rotatedAt?: string
  source?: 'manual' | 'sync' | 'import' | 'rotation' | 'copy' | 'rename' | 'promote' | 'demote'
  // Tracking properties for utility operations
  copiedFrom?: string    // Source environment for copy operations
  renamedFrom?: string   // Original key name for rename operations
  promotedFrom?: string  // Source service for promote_shared operations
  demotedTo?: string     // Target service for demote_shared operations
  // Versioning
  currentVersion?: number  // Current version number (starts at 1)
  versions?: VersionEntry[]  // Version history (sorted desc by version)
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
  /** Whether this variable is sensitive (secret) or not (config). Default: false (config) */
  sensitive?: boolean
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
  /** Whether this variable is sensitive (secret) or not (config). Default: false (config) */
  sensitive?: boolean
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

/**
 * Inline key source - key value directly in config
 * Useful for shared dev keys that can be committed
 * WARNING: Only use for development environments!
 */
export interface KeySourceInline {
  inline: string
}

export type KeySource = KeySourceEnv | KeySourceFile | KeySourceS3 | KeySourceInline

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

/**
 * Per-environment key configuration
 *
 * Allows different encryption keys for different environments.
 * Useful for security isolation (prd key different from dev).
 */
export interface EnvironmentKeyConfig {
  /** Key sources for this environment (tried in order) */
  source?: KeySource[]
  /** Key name to use (default: environment name) */
  key_name?: string
  /** Override encryption mode for this environment */
  mode?: EncryptionMode
  /** Override asymmetric config for this environment */
  asymmetric?: AsymmetricEncryptionConfig
}

export interface EncryptionConfig {
  /** Encryption mode: symmetric (default) or asymmetric */
  mode?: EncryptionMode
  /** Symmetric key sources (passphrase) - used when mode is 'symmetric' */
  key_source?: KeySource[]
  /** Asymmetric encryption config - used when mode is 'asymmetric' */
  asymmetric?: AsymmetricEncryptionConfig
  /**
   * Per-environment key configuration
   *
   * @example
   * ```yaml
   * encryption:
   *   keys:
   *     dev:
   *       source:
   *         - env: VAULTER_KEY_DEV
   *     prd:
   *       source:
   *         - env: VAULTER_KEY_PRD
   *         - s3: s3://secure-bucket/keys/prd.key
   * ```
   */
  keys?: Record<string, EnvironmentKeyConfig>
  /**
   * Environment name used to encrypt shared variables
   * (defaults to default_environment when omitted)
   */
  shared_key_environment?: string
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

/**
 * Service configuration for monorepos
 */
export interface ServiceConfig {
  /** Service name */
  name: string
  /** Optional service-specific directory */
  path?: string
}

// ============================================================================
// Local & Deploy Configuration (new structure)
// ============================================================================

/**
 * Local development configuration
 *
 * For developers running services on their local machine.
 * These files are typically gitignored.
 *
 * Structure (unified for single repo and monorepo):
 *   .vaulter/local/configs.env     # Shared configs (sensitive=false)
 *   .vaulter/local/secrets.env     # Shared secrets (sensitive=true)
 *   .vaulter/local/services/<svc>/configs.env   # Service-specific (monorepo)
 *   .vaulter/local/services/<svc>/secrets.env   # Service-specific (monorepo)
 */
export interface LocalConfig {
  /** Single-repo local env file (alias for shared) */
  file?: string
  /** Single-repo local env example (alias for shared_example) */
  example?: string
  /** Path to shared env file for all local services */
  shared?: string
  /** Path to example/template file (committed to git) */
  shared_example?: string
  /** Path pattern for per-service overrides. Use {service} placeholder */
  service?: string
}

/**
 * Shared configs/secrets paths for deploy
 */
export interface DeploySharedConfig {
  /** Path to configs (non-sensitive, committed). Use {env} placeholder */
  configs?: string
  /** Path to secrets (sensitive, gitignored). Use {env} placeholder */
  secrets?: string
}

/**
 * Per-service configs/secrets paths for deploy
 */
export interface DeployServicesConfig {
  /** Path to service configs. Use {service} and {env} placeholders */
  configs?: string
  /** Path to service secrets. Use {service} and {env} placeholders */
  secrets?: string
}

/**
 * Deploy configuration
 *
 * For CI/CD pipelines deploying to Kubernetes or other environments.
 * Configs are committed, secrets are generated at deploy time.
 *
 * @example
 * deploy:
 *   shared:
 *     configs: .vaulter/deploy/shared/configs/{env}.env   # Committed
 *     secrets: .vaulter/deploy/shared/secrets/{env}.env   # CI/CD generates
 *   services:
 *     configs: .vaulter/deploy/services/{service}/configs/{env}.env
 *     secrets: .vaulter/deploy/services/{service}/secrets/{env}.env
 */
export interface DeployConfig {
  /** Single-repo configs path (alias for shared.configs) */
  configs?: string
  /** Single-repo secrets path (alias for shared.secrets) */
  secrets?: string
  /** Shared configs/secrets for all services */
  shared?: DeploySharedConfig
  /** Per-service configs/secrets */
  services?: DeployServicesConfig
}

/**
 * Monorepo configuration
 */
export interface MonorepoConfig {
  /** Root directory of the monorepo */
  root?: string
  /** Glob pattern for discovering services (e.g., "apps/*") */
  services_pattern?: string
}

// ============================================================================
// Output Targets (Framework-agnostic env file generation)
// ============================================================================

/**
 * Output target configuration for generating .env files
 *
 * Each output target defines where and how to generate environment files
 * for a specific service/app in a monorepo or single-repo setup.
 *
 * @example
 * ```yaml
 * outputs:
 *   web:
 *     path: apps/web
 *     filename: .env.local
 *     include: [NEXT_PUBLIC_*, API_URL]
 *     exclude: [DATABASE_*]
 *     inherit: true
 * ```
 */
export interface OutputTarget {
  /** Directory path where .env will be generated (relative to project root) */
  path: string

  /**
   * Filename to generate (default: '.env')
   * Supports {env} placeholder: '.env.{env}' → '.env.dev'
   */
  filename?: string

  /**
   * Service name for monorepo (optional)
   * When set, this output will use vars from this specific service in the backend.
   * If not set, uses the global service context or all vars.
   *
   * @example 'api' or 'web'
   */
  service?: string

  /**
   * Glob patterns for vars to include.
   * If omitted, includes all vars.
   * Patterns use minimatch syntax: '*', '?', '**', etc.
   *
   * @example ['NEXT_PUBLIC_*', 'API_URL', 'LOG_*']
   */
  include?: string[]

  /**
   * Glob patterns for vars to exclude.
   * Applied after include filters.
   *
   * @example ['DATABASE_*', '*_SECRET']
   */
  exclude?: string[]

  /**
   * Inherit shared vars? (default: true)
   * When true, shared vars are merged with service-specific vars.
   */
  inherit?: boolean
}

/**
 * Shorthand: string = just the path with defaults
 *
 * @example
 * outputs:
 *   worker: apps/worker  # Equivalent to { path: 'apps/worker' }
 */
export type OutputTargetInput = string | OutputTarget

/**
 * Shared vars configuration
 *
 * Shared vars are inherited by all outputs (unless inherit: false).
 * Useful for common vars like LOG_LEVEL, NODE_ENV, etc.
 */
export interface SharedVarsConfig {
  /**
   * Glob patterns for shared vars.
   * These vars will be included in all outputs that have inherit: true
   *
   * @example ['LOG_LEVEL', 'NODE_ENV', 'SENTRY_*']
   */
  include?: string[]
}

/**
 * Normalized output target (after processing shorthand)
 */
export interface NormalizedOutputTarget {
  /** Output name (key from outputs config) */
  name: string
  /** Directory path */
  path: string
  /** Filename (with {env} placeholder resolved) */
  filename: string
  /** Service name for monorepo (if specified) */
  service?: string
  /** Include patterns */
  include: string[]
  /** Exclude patterns */
  exclude: string[]
  /** Whether to inherit shared vars */
  inherit: boolean
}

// ============================================================================
// Snapshot Configuration
// ============================================================================

export interface SnapshotsConfig {
  /** Snapshot storage driver: 'filesystem' (default) or 's3db' */
  driver?: 'filesystem' | 's3db'
  /** Filesystem driver: directory path (default: '.vaulter/snapshots') */
  path?: string
  /** S3db driver: path prefix in S3 (default: 'vaulter-snapshots/') */
  s3_path?: string
}

// ============================================================================
// Versioning Configuration
// ============================================================================

/**
 * Retention mode for version history
 * - count: Keep N most recent versions
 * - days: Keep versions from last N days
 * - both: Keep N versions AND versions from last N days (union)
 */
export type VersionRetentionMode = 'count' | 'days' | 'both'

/**
 * Versioning configuration
 */
export interface VersioningConfig {
  /** Enable versioning (default: false) */
  enabled?: boolean
  /** Retention mode (default: 'count') */
  retention_mode?: VersionRetentionMode
  /** Maximum number of versions to keep (default: 10) */
  max_versions?: number
  /** Number of days to keep versions (only used when retention_mode is 'days' or 'both') */
  retention_days?: number
  /** Glob patterns for keys that should be versioned (default: all keys) */
  include?: string[]
  /** Glob patterns for keys that should NOT be versioned */
  exclude?: string[]
}

/**
 * Version information (for CLI/MCP responses)
 */
export interface VersionInfo {
  /** Version number */
  version: number
  /** Decrypted value */
  value: string
  /** When this version was created */
  timestamp: string
  /** Who created this version */
  user: string
  /** Source of the operation */
  source: AuditSource
  /** Operation that created this version */
  operation: 'set' | 'rotate' | 'copy' | 'rename' | 'rollback'
  /** SHA256 checksum (for integrity) */
  checksum: string
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

export interface VaulterConfig {
  version: '1'
  project: string
  service?: string
  backend?: BackendConfig
  /**
   * Scope policy used by scope-policy validation (shared vs service ownership)
   *
   * Can be configured in config.yaml to enforce stricter defaults than environment mode.
   * Set `mode: strict` to fail on violations, `mode: off` to disable.
   */
  scope_policy?: ScopePolicyConfig
  encryption?: EncryptionConfig
  /** User-defined environment names (e.g., ['dev', 'stg', 'prd'] or ['development', 'production']) */
  environments?: string[]
  /** Default environment when -e flag is not provided */
  default_environment?: string
  extends?: string
  sync?: SyncConfig
  integrations?: IntegrationsConfig
  security?: SecurityConfig
  /** Directory structure configuration (unified or split mode) */
  directories?: DirectoriesConfig
  /** Audit logging configuration */
  audit?: AuditConfig
  /** MCP server configuration (defaults when running in this project) */
  mcp?: McpConfig
  /** Snapshot configuration */
  snapshots?: SnapshotsConfig
  /** Versioning configuration */
  versioning?: VersioningConfig
  /** Monorepo services list */
  services?: Array<string | ServiceConfig>

  /** Monorepo configuration */
  monorepo?: MonorepoConfig
  /** Local development configuration */
  local?: LocalConfig
  /** Deploy configuration (CI/CD → K8s) */
  deploy?: DeployConfig

  // ============================================================================
  // Output Targets (framework-agnostic env file generation)
  // ============================================================================

  /**
   * Output targets for generating .env files
   *
   * Each key is an output name (e.g., 'web', 'api'), and the value
   * defines where and how to generate the .env file.
   *
   * @example
   * ```yaml
   * outputs:
   *   web:
   *     path: apps/web
   *     filename: .env.local
   *     include: [NEXT_PUBLIC_*]
   *   api: apps/api  # Shorthand
   * ```
   */
  outputs?: Record<string, OutputTargetInput>

  /**
   * Shared vars configuration
   *
   * Vars matching these patterns are inherited by all outputs
   * (unless the output has inherit: false).
   *
   * @example
   * ```yaml
   * shared:
   *   include: [LOG_LEVEL, NODE_ENV, SENTRY_*]
   * ```
   */
  shared?: SharedVarsConfig
}

// ============================================================================
// CLI Types
// ============================================================================

export interface CLIArgs {
  _: string[]
  // Global flags
  project?: string
  service?: string
  env?: string
  backend?: string
  key?: string
  verbose?: boolean
  'timeout-ms'?: number
  offline?: boolean
  'dry-run'?: boolean
  json?: boolean
  help?: boolean
  version?: boolean
  fix?: boolean
  // Command-specific flags
  file?: string
  output?: string
  force?: boolean
  all?: boolean
  namespace?: string
  format?: string
  // Init command flags
  monorepo?: boolean
  environments?: string
  // Key command flags
  asymmetric?: boolean
  algorithm?: string
  name?: string
  global?: boolean
  scope?: string
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
  // Export options
  repo?: string
  // Sync options
  prune?: boolean
  shared?: boolean
  strategy?: 'local' | 'remote' | 'error'
  values?: boolean
  action?: 'merge' | 'push' | 'pull'
  apply?: boolean
  'plan-output'?: string
  // Local pull options
  overwrite?: boolean
  // Export options (inheritance control)
  'skip-shared'?: boolean
  // Nuke command
  confirm?: string
  // Push/Pull dir mode
  dir?: boolean
  // Move/copy semantics
  deleteOriginal?: boolean
  // Service discovery path override
  path?: string
  // Move operation scope routing
  from?: string
  to?: string
}

export interface CommandContext {
  project: string
  service?: string
  environment: Environment
  config: VaulterConfig
  verbose: boolean
  quiet: boolean
  dryRun: boolean
  jsonOutput: boolean
}

export interface ScopePolicyRuleConfig {
  /** Friendly rule name */
  name?: string
  /** Regex pattern used to match variable keys */
  pattern: string
  /** Target scope for matched keys */
  expected_scope: 'shared' | 'service'
  /** Required target service when expected_scope = service */
  expected_service?: string
  /** Human-readable reason displayed in policy reports */
  reason?: string
}

export interface ScopePolicyConfig {
  /** Policy mode override for this project (`warn`, `strict`, `off`) */
  mode?: 'off' | 'warn' | 'strict'
  /** Keep built-in default rules and append custom ones */
  inherit_defaults?: boolean
  /** Custom rules for scope ownership */
  rules?: ScopePolicyRuleConfig[]
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
  /** Timeout for operations in milliseconds (default: 30000ms = 30s) */
  timeoutMs?: number
  /** Cache settings passed to s3db.js (memory cache) */
  cache?: { enabled?: boolean; ttl?: number; maxSize?: number } | boolean
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

/**
 * Result of batch operations (setManyChunked, stream writes)
 */
export interface BatchResult {
  /** Successfully processed keys */
  success: string[]
  /** Failed operations with error details */
  failed: Array<{
    key: string
    error: string
  }>
  /** Total items processed */
  total: number
  /** Processing time in milliseconds */
  durationMs: number
}

/**
 * Options for batch operations
 */
export interface BatchOptions {
  /** Number of concurrent operations (default: 5) */
  concurrency?: number
  /** Continue on error or abort (default: true - continue) */
  continueOnError?: boolean
  /** If true, uses slower get+update to preserve existing metadata (default: false) */
  preserveMetadata?: boolean
  /** Progress callback called after each chunk */
  onProgress?: (progress: {
    completed: number
    total: number
    percentage: number
    currentChunk: number
    totalChunks: number
  }) => void
}

// ============================================================================
// Output Formats
// ============================================================================

export type ExportFormat = 'shell' | 'json' | 'yaml' | 'env' | 'tfvars' | 'docker-args'

export const EXPORT_FORMATS: ExportFormat[] = ['shell', 'json', 'yaml', 'env', 'tfvars', 'docker-args']

// ============================================================================

// ============================================================================
// Audit Logging Types
// ============================================================================

/**
 * Operations that can be audited
 */
export type AuditOperation = 'set' | 'delete' | 'sync' | 'push' | 'rotate' | 'deleteAll' | 'rollback'

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
  /** Default working directory (where to look for .vaulter/config.yaml) */
  default_cwd?: string
  /** Default timeout for backend operations in milliseconds (default: 30000ms = 30s) */
  timeout_ms?: number
  /** Warm-up connections on MCP startup */
  warmup?: boolean
  /** Concurrency for multi-env search operations */
  search_concurrency?: number
  /** Cache TTL for MCP config resolution */
  config_ttl_ms?: number
  /** Cache TTL for encryption key resolution */
  key_ttl_ms?: number
  /** s3db cache configuration for MCP clients */
  s3db_cache?: { enabled?: boolean; ttl_ms?: number; max_size?: number } | boolean
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
