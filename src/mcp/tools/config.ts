/**
 * Vaulter MCP Tools - Configuration & Shared Utilities
 *
 * MCP server options, config resolution, and helper functions
 */

import { VaulterClient } from '../../client.js'
import {
  loadConfig,
  loadEncryptionKeyForEnv,
  getEncryptionMode,
  findConfigDir,
  loadMcpConfig
} from '../../lib/config-loader.js'
import { loadKeyForEnv } from '../../lib/keys.js'
import type { VaulterConfig, AsymmetricAlgorithm, Environment, McpConfig } from '../../types.js'
import { resolveBackendUrls } from '../../index.js'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_CONFIG_CACHE_TTL_MS = 1000
const DEFAULT_KEY_CACHE_TTL_MS = 1000
const DEFAULT_SEARCH_CONCURRENCY = 4

type CacheEntry<T> = { ts: number; value: T }

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server Options (set by server.ts when CLI args are passed)
// ─────────────────────────────────────────────────────────────────────────────

export interface McpServerOptions {
  /** Backend URL override from CLI --backend flag */
  backend?: string
  /** Working directory (where to look for .vaulter/config.yaml) */
  cwd?: string
  /** Verbose mode */
  verbose?: boolean
  /** Warm-up connections on startup */
  warmup?: boolean
}

let mcpOptions: McpServerOptions = {}

let resolvedConfigCache: CacheEntry<ReturnType<typeof resolveConfigAndConnectionStrings>> & { key: string } | null = null
const keyCache = new Map<string, CacheEntry<{
  passphrase?: string | null
  publicKey?: string | null
  privateKey?: string | null
  algorithm?: string | null
}>>()

export interface McpRuntimeOptions {
  configTtlMs: number
  keyTtlMs: number
  searchConcurrency: number
  warmup: boolean
  cache?: { enabled?: boolean; ttl?: number; maxSize?: number } | boolean
}

let runtimeOptions: McpRuntimeOptions = {
  configTtlMs: Math.max(0, Number(process.env.VAULTER_MCP_CONFIG_TTL_MS || DEFAULT_CONFIG_CACHE_TTL_MS)),
  keyTtlMs: Math.max(0, Number(process.env.VAULTER_MCP_KEY_TTL_MS || DEFAULT_KEY_CACHE_TTL_MS)),
  searchConcurrency: Math.max(1, Number(process.env.VAULTER_MCP_SEARCH_CONCURRENCY || DEFAULT_SEARCH_CONCURRENCY)),
  warmup: ['1', 'true', 'yes'].includes((process.env.VAULTER_MCP_WARMUP || '').toLowerCase()),
  cache: undefined
}

function parseBool(value: string | undefined): boolean | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return undefined
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const num = Number(value)
  if (!Number.isFinite(num)) return undefined
  return num
}

function normalizeCacheConfig(
  value: McpConfig['s3db_cache'],
  envOverrides: { enabled?: boolean; ttl?: number; maxSize?: number }
): { enabled?: boolean; ttl?: number; maxSize?: number } | boolean | undefined {
  let cacheConfig: { enabled?: boolean; ttl?: number; maxSize?: number } | boolean | undefined
  if (value !== undefined) {
    if (typeof value === 'boolean') {
      cacheConfig = value
    } else {
      cacheConfig = {
        enabled: value.enabled ?? true,
        ttl: value.ttl_ms,
        maxSize: value.max_size
      }
    }
  }

  const hasEnvOverride = Object.values(envOverrides).some(v => v !== undefined)
  if (!hasEnvOverride) return cacheConfig

  if (cacheConfig === undefined) {
    cacheConfig = {}
  }
  if (typeof cacheConfig === 'boolean') {
    cacheConfig = { enabled: cacheConfig }
  }

  if (envOverrides.enabled !== undefined) cacheConfig.enabled = envOverrides.enabled
  if (envOverrides.ttl !== undefined) cacheConfig.ttl = envOverrides.ttl
  if (envOverrides.maxSize !== undefined) cacheConfig.maxSize = envOverrides.maxSize
  return cacheConfig
}

function resolveRuntimeOptions(
  config: VaulterConfig | null,
  mcpConfig: McpConfig | null
): McpRuntimeOptions {
  const projectMcp = config?.mcp

  const warmupFromEnv = parseBool(process.env.VAULTER_MCP_WARMUP)
  const warmup = mcpOptions.warmup
    ?? warmupFromEnv
    ?? projectMcp?.warmup
    ?? mcpConfig?.warmup
    ?? false

  const searchConcurrency = Math.max(
    1,
    parseNumber(process.env.VAULTER_MCP_SEARCH_CONCURRENCY)
      ?? projectMcp?.search_concurrency
      ?? mcpConfig?.search_concurrency
      ?? DEFAULT_SEARCH_CONCURRENCY
  )

  const configTtlMs = Math.max(
    0,
    parseNumber(process.env.VAULTER_MCP_CONFIG_TTL_MS)
      ?? projectMcp?.config_ttl_ms
      ?? mcpConfig?.config_ttl_ms
      ?? DEFAULT_CONFIG_CACHE_TTL_MS
  )

  const keyTtlMs = Math.max(
    0,
    parseNumber(process.env.VAULTER_MCP_KEY_TTL_MS)
      ?? projectMcp?.key_ttl_ms
      ?? mcpConfig?.key_ttl_ms
      ?? DEFAULT_KEY_CACHE_TTL_MS
  )

  const cacheOverrides = {
    enabled: parseBool(process.env.S3DB_CACHE_ENABLED),
    ttl: parseNumber(process.env.S3DB_CACHE_TTL) ?? parseNumber(process.env.S3DB_CACHE_TTL_MS),
    maxSize: parseNumber(process.env.S3DB_CACHE_MAX_SIZE)
  }

  const cache = normalizeCacheConfig(projectMcp?.s3db_cache ?? mcpConfig?.s3db_cache, cacheOverrides)

  return {
    warmup,
    searchConcurrency,
    configTtlMs,
    keyTtlMs,
    cache
  }
}

export function getMcpRuntimeOptions(): McpRuntimeOptions {
  return runtimeOptions
}

function getCacheEntry<T>(entry: CacheEntry<T> | null, ttlMs: number): T | null {
  if (!entry || ttlMs <= 0) return null
  if (Date.now() - entry.ts > ttlMs) return null
  return entry.value
}

function getKeyCacheEntry<T>(key: string): T | null {
  const ttlMs = runtimeOptions.keyTtlMs
  if (ttlMs <= 0) return null
  const entry = keyCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) {
    keyCache.delete(key)
    return null
  }
  return entry.value as T
}

function setKeyCacheEntry(key: string, value: CacheEntry<any>['value']): void {
  if (runtimeOptions.keyTtlMs <= 0) return
  keyCache.set(key, { ts: Date.now(), value })
}

/**
 * Set MCP server options (called by server.ts with CLI args)
 * If cwd is specified, changes the working directory so config can be found
 *
 * Priority for cwd:
 * 1. CLI --cwd flag
 * 2. VAULTER_CWD environment variable
 * 3. mcp.default_cwd from ~/.vaulter/config.yaml
 */
export function setMcpOptions(options: McpServerOptions): void {
  mcpOptions = options

  // Change working directory if specified (so loadConfig finds .vaulter/config.yaml)
  // Priority: CLI --cwd > VAULTER_CWD env var > global config default_cwd
  let cwd = options.cwd || process.env.VAULTER_CWD

  // If no cwd from CLI or env, try global config
  if (!cwd) {
    const globalMcpConfig = loadMcpConfig()
    if (globalMcpConfig?.default_cwd) {
      cwd = globalMcpConfig.default_cwd
    }
  }

  if (cwd) {
    try {
      process.chdir(cwd)
    } catch {
      // Ignore if directory doesn't exist - tools will handle missing config
    }
  }
}

/**
 * Get current MCP server options
 */
export function getMcpOptions(): McpServerOptions {
  return mcpOptions
}

/**
 * Effective defaults resolved from all config sources
 */
export interface McpDefaults {
  project: string
  environment: string
  key?: string
}

/**
 * Config source tracking - shows WHERE each setting came from
 */
export type ConfigSource = 'cli' | 'env' | 'project' | 'project.mcp' | 'global.mcp' | 'default'

export interface ResolvedMcpConfig {
  cwd: { value: string; source: ConfigSource }
  backend: { value: string; source: ConfigSource }
  project: { value: string; source: ConfigSource }
  environment: { value: string; source: ConfigSource }
  key: { value: string | null; source: ConfigSource }
  encryptionMode: { value: string; source: ConfigSource }
  configFiles: {
    project: string | null
    global: string | null
  }
}

/**
 * Resolve MCP configuration with full source tracking
 * Use this to understand WHERE each setting is coming from
 */
export function resolveMcpConfigWithSources(): ResolvedMcpConfig {
  // CLI overrides - compute early so we can use cwd for config loading
  const cliBackend = mcpOptions.backend
  const cliCwd = mcpOptions.cwd
  const envCwd = process.env.VAULTER_CWD

  // Load global MCP config (needed for default_cwd)
  const globalMcpConfig = loadMcpConfig()
  const globalConfigPath = path.join(os.homedir(), '.vaulter', 'config.yaml')
  const hasGlobalConfig = globalMcpConfig !== null

  // Effective cwd: CLI override > env var > global default_cwd > process.cwd()
  const cwd = cliCwd || envCwd || globalMcpConfig?.default_cwd || process.cwd()
  const cwdSource: ConfigSource = cliCwd
    ? 'cli'
    : envCwd
      ? 'env'
      : globalMcpConfig?.default_cwd
        ? 'global.mcp'
        : 'default'

  // Try to load project config from effective cwd
  let projectConfig: VaulterConfig | null = null
  let projectConfigPath: string | null = null
  try {
    projectConfig = loadConfig(cwd)
    const configDir = findConfigDir(cwd)
    if (configDir) {
      projectConfigPath = path.join(configDir, 'config.yaml')
    }
  } catch {
    // No project config
  }

  // Resolve backend with source tracking
  let backendValue: string
  let backendSource: ConfigSource
  if (cliBackend) {
    backendValue = cliBackend
    backendSource = 'cli'
  } else if (projectConfig?.backend?.url) {
    backendValue = projectConfig.backend.url
    backendSource = 'project'
  } else if (projectConfig?.backend?.urls?.[0]) {
    backendValue = projectConfig.backend.urls[0]
    backendSource = 'project'
  } else if (projectConfig?.mcp?.default_backend) {
    backendValue = projectConfig.mcp.default_backend
    backendSource = 'project.mcp'
  } else if (globalMcpConfig?.default_backend) {
    backendValue = globalMcpConfig.default_backend
    backendSource = 'global.mcp'
  } else {
    backendValue = `file://${os.homedir()}/.vaulter/store`
    backendSource = 'default'
  }

  // Resolve project with source tracking
  let projectValue: string
  let projectSource: ConfigSource
  if (projectConfig?.project) {
    projectValue = projectConfig.project
    projectSource = 'project'
  } else if (projectConfig?.mcp?.default_project) {
    projectValue = projectConfig.mcp.default_project
    projectSource = 'project.mcp'
  } else if (globalMcpConfig?.default_project) {
    projectValue = globalMcpConfig.default_project
    projectSource = 'global.mcp'
  } else {
    projectValue = ''
    projectSource = 'default'
  }

  // Resolve environment with source tracking
  let envValue: string
  let envSource: ConfigSource
  if (projectConfig?.default_environment) {
    envValue = projectConfig.default_environment
    envSource = 'project'
  } else if (projectConfig?.mcp?.default_environment) {
    envValue = projectConfig.mcp.default_environment
    envSource = 'project.mcp'
  } else if (globalMcpConfig?.default_environment) {
    envValue = globalMcpConfig.default_environment
    envSource = 'global.mcp'
  } else {
    envValue = 'dev'
    envSource = 'default'
  }

  // Resolve key with source tracking
  let keyValue: string | null
  let keySource: ConfigSource
  if (projectConfig?.mcp?.default_key) {
    keyValue = projectConfig.mcp.default_key
    keySource = 'project.mcp'
  } else if (globalMcpConfig?.default_key) {
    keyValue = globalMcpConfig.default_key
    keySource = 'global.mcp'
  } else {
    keyValue = null
    keySource = 'default'
  }

  // Resolve encryption mode
  let encModeValue: string
  let encModeSource: ConfigSource
  if (projectConfig?.encryption?.mode) {
    encModeValue = projectConfig.encryption.mode
    encModeSource = 'project'
  } else {
    encModeValue = 'symmetric'
    encModeSource = 'default'
  }

  return {
    cwd: {
      value: cwd,
      source: cwdSource
    },
    backend: { value: backendValue, source: backendSource },
    project: { value: projectValue, source: projectSource },
    environment: { value: envValue, source: envSource },
    key: { value: keyValue, source: keySource },
    encryptionMode: { value: encModeValue, source: encModeSource },
    configFiles: {
      project: projectConfigPath,
      global: hasGlobalConfig ? globalConfigPath : null
    }
  }
}

/**
 * Format resolved config for display (human-readable)
 */
export function formatResolvedConfig(config: ResolvedMcpConfig): string {
  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║           VAULTER MCP - CONFIGURATION SOURCES                ║',
    '╠══════════════════════════════════════════════════════════════╣'
  ]

  // Config files found
  lines.push('║ Config Files:                                                 ║')
  if (config.configFiles.project) {
    lines.push(`║   ✓ Project: ${config.configFiles.project.padEnd(45)}║`)
  } else {
    lines.push('║   ✗ Project: (not found)                                      ║')
  }
  if (config.configFiles.global) {
    lines.push(`║   ✓ Global:  ${config.configFiles.global.padEnd(45)}║`)
  } else {
    lines.push('║   ✗ Global:  (not found)                                      ║')
  }

  lines.push('╠══════════════════════════════════════════════════════════════╣')
  lines.push('║ Resolved Values:                         SOURCE              ║')
  lines.push('╠══════════════════════════════════════════════════════════════╣')

  const formatLine = (label: string, value: string, source: ConfigSource): string => {
    const truncValue = value.length > 30 ? value.substring(0, 27) + '...' : value
    const sourceTag = `[${source}]`
    return `║   ${label.padEnd(12)} ${truncValue.padEnd(30)} ${sourceTag.padEnd(14)}║`
  }

  lines.push(formatLine('cwd:', config.cwd.value, config.cwd.source))
  lines.push(formatLine('backend:', config.backend.value, config.backend.source))
  lines.push(formatLine('project:', config.project.value || '(empty)', config.project.source))
  lines.push(formatLine('environment:', config.environment.value, config.environment.source))
  lines.push(formatLine('key:', config.key.value || '(none)', config.key.source))
  lines.push(formatLine('encryption:', config.encryptionMode.value, config.encryptionMode.source))

  lines.push('╚══════════════════════════════════════════════════════════════╝')

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Config Resolution (DRY - used by multiple functions)
// ─────────────────────────────────────────────────────────────────────────────

function resolveConnectionStrings(
  config: VaulterConfig | null,
  mcpConfig: ReturnType<typeof loadMcpConfig>
): string[] {
  const backendOverride = mcpOptions.backend

  if (backendOverride) {
    return [backendOverride]
  }

  if (config?.backend) {
    return resolveBackendUrls(config)
  }

  if (config?.mcp?.default_backend) {
    return [config.mcp.default_backend]
  }

  if (mcpConfig?.default_backend) {
    return [mcpConfig.default_backend]
  }

  return []
}

/**
 * Internal: Resolve config, defaults, and connection strings
 * This is the single source of truth for config resolution - all other
 * functions should use this to avoid logic drift.
 *
 * Priority order for all settings:
 * 1. CLI flags / tool arguments
 * 2. Project config (.vaulter/config.yaml)
 * 3. Project MCP config (.vaulter/config.yaml → mcp.*)
 * 4. Global MCP config (~/.vaulter/config.yaml → mcp.*)
 * 5. Defaults
 */
function resolveConfigAndConnectionStrings(): {
  config: VaulterConfig | null
  mcpConfig: ReturnType<typeof loadMcpConfig>
  defaults: McpDefaults
  connectionStrings: string[]
} {
  const cacheKey = [
    mcpOptions.backend || '',
    mcpOptions.cwd || '',
    process.env.VAULTER_CWD || '',
    process.cwd()
  ].join('|')

  if (runtimeOptions.configTtlMs > 0 && resolvedConfigCache?.key === cacheKey) {
    const cached = getCacheEntry(resolvedConfigCache, runtimeOptions.configTtlMs)
    if (cached) return cached
  }

  // Load global MCP config as fallback
  const mcpConfig = loadMcpConfig()

  // Use effective cwd: CLI override > env var > global default_cwd > process.cwd()
  const cwd = mcpOptions.cwd || process.env.VAULTER_CWD || mcpConfig?.default_cwd || undefined

  let config: VaulterConfig | null = null
  try {
    config = loadConfig(cwd)
  } catch {
    // Config not found is OK
  }

  // Resolve effective defaults with priority chain:
  // project config > project mcp > global mcp > hardcoded default
  const defaults: McpDefaults = {
    project: config?.project
      || config?.mcp?.default_project
      || mcpConfig?.default_project
      || '',
    environment: config?.default_environment
      || config?.mcp?.default_environment
      || mcpConfig?.default_environment
      || 'dev',
    key: config?.mcp?.default_key
      || mcpConfig?.default_key
  }

  // Determine connection strings with priority:
  // 1. CLI --backend flag
  // 2. Project config backend (config.backend)
  // 3. Project MCP config (config.mcp.default_backend)
  // 4. Global MCP config (~/.vaulter/config.yaml → mcp.default_backend)
  // 5. Default (empty - VaulterClient uses filesystem fallback)
  const connectionStrings = resolveConnectionStrings(config, mcpConfig)

  runtimeOptions = resolveRuntimeOptions(config, mcpConfig)
  const result = { config, mcpConfig, defaults, connectionStrings }
  resolvedConfigCache = { key: cacheKey, ts: Date.now(), value: result }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-Environment Client Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cache of clients by environment/project
 * Key format: "{connectionString}:{project}:{environment}:{mode}:{keyHash}"
 * The keyHash ensures cache is invalidated when encryption keys change.
 */
const clientCache = new Map<string, VaulterClient>()

/**
 * Generate a short hash of key content for cache invalidation
 * Not cryptographic - just enough to detect key changes
 */
function hashKeyContent(content: string | null | undefined): string {
  if (!content) return 'none'
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 12)
}

/**
 * Get config and defaults without creating a client
 * Use this when you need to resolve environment before creating client
 */
export function getConfigAndDefaults(): {
  config: VaulterConfig | null
  defaults: McpDefaults
  connectionStrings: string[]
} {
  // Use shared resolution function to avoid logic drift
  const { config, defaults, connectionStrings } = resolveConfigAndConnectionStrings()
  return { config, defaults, connectionStrings }
}

/**
 * Get or create a client for a specific environment
 *
 * This is the CORRECT way to get a client - it loads the encryption key
 * specific to the environment, supporting per-environment keys.
 *
 * Clients are cached by environment to avoid recreating them on every request.
 *
 * @param environment - Target environment (e.g., 'dev', 'prd')
 * @param options - Optional overrides
 */
export async function getClientForEnvironment(
  environment: Environment,
  options?: {
    config?: VaulterConfig | null
    connectionStrings?: string[]
    forceNew?: boolean
    project?: string
    timeoutMs?: number
  }
): Promise<VaulterClient> {
  const {
    config: providedConfig,
    connectionStrings: providedConnStrings,
    forceNew,
    project: providedProject,
    timeoutMs: providedTimeout
  } = options || {}

  // Get config if not provided
  const fallback = providedConfig !== undefined ? null : getConfigAndDefaults()
  const config = providedConfig !== undefined ? providedConfig : fallback?.config || null

  const connectionStrings = providedConnStrings
    ?? (providedConfig !== undefined
      ? resolveConnectionStrings(config, loadMcpConfig())
      : (fallback?.connectionStrings || []))
  const project = providedProject || config?.project || ''

  // Determine encryption mode for this environment
  const envKeyConfig = config?.encryption?.keys?.[environment]
  const encryptionMode = envKeyConfig?.mode || (config ? getEncryptionMode(config) : 'symmetric')

  const connKey = connectionStrings.join(',') || 'default'
  const projectKey = project || 'default'
  const cacheConfig = runtimeOptions.cache
  const cacheConfigKey = cacheConfig === undefined
    ? 'nocache'
    : typeof cacheConfig === 'boolean'
      ? `cache:${cacheConfig}`
      : `cache:${cacheConfig.enabled ?? 'auto'}:${cacheConfig.ttl ?? 'none'}:${cacheConfig.maxSize ?? 'none'}`

  // Get timeout from config (project or global MCP config) or use provided override
  const mcpConfig = loadMcpConfig()
  const timeoutMs = providedTimeout ?? config?.mcp?.timeout_ms ?? mcpConfig?.timeout_ms ?? 30000

  let client: VaulterClient
  let keyHash: string

  if (encryptionMode === 'asymmetric' && config) {
    // Load asymmetric keys for this environment
    const keyCacheKey = `asym:${projectKey}:${environment}`
    const cached = getKeyCacheEntry<{
      publicKey?: string | null
      privateKey?: string | null
      algorithm?: string | null
    }>(keyCacheKey)

    const keyResult = cached
      ? {
        publicKey: cached.publicKey || null,
        key: cached.privateKey || null,
        algorithm: cached.algorithm || undefined
      }
      : await loadKeyForEnv({
        project: projectKey,
        environment,
        config,
        loadPublicKey: true,
        loadPrivateKey: true
      })

    if (!cached) {
      setKeyCacheEntry(keyCacheKey, {
        publicKey: keyResult.publicKey || null,
        privateKey: keyResult.key || null,
        algorithm: keyResult.algorithm || null
      })
    }

    // Hash both public and private keys for cache invalidation
    keyHash = hashKeyContent((keyResult.publicKey || '') + (keyResult.key || ''))

    // Create cache key including key hash and timeout
    const cacheKey = `${connKey}:${projectKey}:${environment}:${encryptionMode}:${keyHash}:${timeoutMs}:${cacheConfigKey}`

    // Return cached client if available (unless forceNew)
    if (!forceNew && clientCache.has(cacheKey)) {
      return clientCache.get(cacheKey)!
    }

    client = new VaulterClient({
      connectionStrings: connectionStrings.length > 0 ? connectionStrings : undefined,
      encryptionMode: 'asymmetric',
      publicKey: keyResult.publicKey || undefined,
      privateKey: keyResult.key || undefined,
      asymmetricAlgorithm: (keyResult.algorithm || 'rsa-4096') as AsymmetricAlgorithm,
      timeoutMs,
      cache: cacheConfig
    })

    // Cache the client
    clientCache.set(cacheKey, client)
  } else {
    // Symmetric mode - load key for specific environment
    const keyCacheKey = `sym:${projectKey}:${environment}`
    const cached = getKeyCacheEntry<{ passphrase?: string | null }>(keyCacheKey)
    const passphrase = cached?.passphrase ?? await loadEncryptionKeyForEnv(config, projectKey, environment)

    if (!cached) {
      setKeyCacheEntry(keyCacheKey, { passphrase })
    }

    // Hash the passphrase for cache invalidation
    keyHash = hashKeyContent(passphrase)

    // Create cache key including key hash and timeout
    const cacheKey = `${connKey}:${projectKey}:${environment}:${encryptionMode}:${keyHash}:${timeoutMs}:${cacheConfigKey}`

    // Return cached client if available (unless forceNew)
    if (!forceNew && clientCache.has(cacheKey)) {
      return clientCache.get(cacheKey)!
    }

    client = new VaulterClient({
      connectionStrings: connectionStrings.length > 0 ? connectionStrings : undefined,
      encryptionMode: 'symmetric',
      passphrase: passphrase || undefined,
      timeoutMs,
      cache: cacheConfig
    })

    // Cache the client
    clientCache.set(cacheKey, client)
  }

  return client
}

/**
 * Clear the client cache
 * Use this when encryption keys have changed (e.g., after key rotation)
 */
export function clearClientCache(): void {
  clientCache.clear()
  keyCache.clear()
  resolvedConfigCache = null
  runtimeOptions = resolveRuntimeOptions(null, null)
}

/**
 * Get a client for working with shared variables
 *
 * Shared vars strategy:
 * - If config has encryption.shared_key_environment, use that environment's key
 * - Otherwise, use the default environment's key
 * - This ensures shared vars are always encrypted with a consistent key
 */
export async function getClientForSharedVars(
  options?: {
    config?: VaulterConfig | null
    connectionStrings?: string[]
    project?: string
    timeoutMs?: number
  }
): Promise<{ client: VaulterClient; sharedKeyEnv: string }> {
  const { config: providedConfig, connectionStrings, project: providedProject, timeoutMs } = options || {}
  const { config, defaults } = providedConfig !== undefined
    ? { config: providedConfig, defaults: { environment: 'dev', project: '', key: undefined } }
    : getConfigAndDefaults()

  // Determine which environment's key to use for shared vars
  const sharedKeyEnv = config?.encryption?.shared_key_environment
    || config?.default_environment
    || defaults.environment
    || 'dev'

  const project = providedProject || config?.project || defaults.project || 'default'
  const client = await getClientForEnvironment(sharedKeyEnv, { config, connectionStrings, project, timeoutMs })

  return { client, sharedKeyEnv }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize name for Kubernetes
 */
export function sanitizeK8sName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Base64 encode
 */
export function base64Encode(value: string): string {
  return Buffer.from(value).toString('base64')
}

/**
 * Standard MCP tool response type
 */
export type ToolResponse = { content: Array<{ type: 'text'; text: string }> }

/**
 * Create a successful tool response
 */
export function textResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }] }
}

/**
 * Create an error tool response
 */
export function errorResponse(message: string): ToolResponse {
  return { content: [{ type: 'text', text: `Error: ${message}` }] }
}
