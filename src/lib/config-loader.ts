/**
 * Vaulter Config Loader
 *
 * Loads and merges configuration from .vaulter/config.yaml files
 * with support for inheritance via "extends" field.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { VaulterConfig, GlobalVaulterConfig, McpConfig } from '../types.js'
import { DEFAULT_ENVIRONMENTS, DEFAULT_ENVIRONMENT } from '../types.js'
import { loadKeyFromS3 } from './s3-key-loader.js'

const CONFIG_DIR = '.vaulter'
const CONFIG_FILE = 'config.yaml'
const CONFIG_LOCAL_FILE = 'config.local.yaml'
const MAX_SEARCH_DEPTH = 5
const MAX_EXTENDS_DEPTH = 10

// ============================================================================
// ~/.vaulter Home Directory Structure
// ============================================================================

/**
 * Get the vaulter home directory (~/.vaulter)
 */
export function getVaulterHome(): string {
  return path.join(os.homedir(), '.vaulter')
}

/**
 * Get the keys directory for a specific project
 * ~/.vaulter/projects/<project>/keys/
 */
export function getProjectKeysDir(projectName: string): string {
  return path.join(getVaulterHome(), 'projects', projectName, 'keys')
}

/**
 * Get the store directory for a specific project (filesystem backend)
 * ~/.vaulter/projects/<project>/store/
 */
export function getProjectStoreDir(projectName: string): string {
  return path.join(getVaulterHome(), 'projects', projectName, 'store')
}

/**
 * Get the global keys directory
 * ~/.vaulter/global/keys/
 */
export function getGlobalKeysDir(): string {
  return path.join(getVaulterHome(), 'global', 'keys')
}

/**
 * Get the global config file path
 * ~/.vaulter/config.yaml
 */
export function getGlobalConfigPath(): string {
  return path.join(getVaulterHome(), CONFIG_FILE)
}

/**
 * Load global vaulter configuration from ~/.vaulter/config.yaml
 *
 * This provides user-level defaults for MCP and other features.
 * Returns null if the file doesn't exist.
 */
export function loadGlobalConfig(): GlobalVaulterConfig | null {
  const configPath = getGlobalConfigPath()

  if (!fs.existsSync(configPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    return parseYaml(content) as GlobalVaulterConfig
  } catch {
    return null
  }
}

/**
 * Load MCP configuration from global config
 *
 * Returns the mcp section of ~/.vaulter/config.yaml or null if not found.
 */
export function loadMcpConfig(): McpConfig | null {
  const globalConfig = loadGlobalConfig()
  return globalConfig?.mcp || null
}

/**
 * Parse a key name to determine scope and actual name
 * - "master" → { scope: 'project', name: 'master' }
 * - "global:master" → { scope: 'global', name: 'master' }
 */
export function parseKeyName(keyName: string): { scope: 'project' | 'global'; name: string } {
  if (!keyName || typeof keyName !== 'string') {
    throw new Error(`Invalid key name: expected string, got ${typeof keyName}`)
  }
  if (keyName.startsWith('global:')) {
    return { scope: 'global', name: keyName.slice(7) }
  }
  // Also support explicit project: prefix
  if (keyName.startsWith('project:')) {
    return { scope: 'project', name: keyName.slice(8) }
  }
  return { scope: 'project', name: keyName }
}

/**
 * Resolve a key name to its file path
 * - "master" with project "myapp" → ~/.vaulter/projects/myapp/keys/master
 * - "global:master" → ~/.vaulter/global/keys/master
 *
 * @param keyName - Key name (e.g., "master", "global:master")
 * @param projectName - Project name for project-scoped keys
 * @param isPublic - If true, adds .pub extension
 * @returns Full path to the key file
 */
export function resolveKeyPath(
  keyName: string,
  projectName: string,
  isPublic: boolean = false
): string {
  const { scope, name } = parseKeyName(keyName)
  const ext = isPublic ? '.pub' : ''

  if (scope === 'global') {
    return path.join(getGlobalKeysDir(), name + ext)
  }
  return path.join(getProjectKeysDir(projectName), name + ext)
}

/**
 * Get both public and private key paths for a key name
 */
export function resolveKeyPaths(
  keyName: string,
  projectName: string
): { publicKey: string; privateKey: string } {
  return {
    publicKey: resolveKeyPath(keyName, projectName, true),
    privateKey: resolveKeyPath(keyName, projectName, false)
  }
}

/**
 * Check if a key exists (both public and private)
 */
export function keyExists(keyName: string, projectName: string): {
  exists: boolean
  publicKey: boolean
  privateKey: boolean
} {
  const paths = resolveKeyPaths(keyName, projectName)
  const pubExists = fs.existsSync(paths.publicKey)
  const privExists = fs.existsSync(paths.privateKey)
  return {
    exists: pubExists || privExists,
    publicKey: pubExists,
    privateKey: privExists
  }
}

/**
 * Expand environment variables in a string
 * Supports: ${VAR}, ${VAR:-default}, $VAR
 */
function expandEnvVars(str: string): string {
  if (typeof str !== 'string') return str

  // Handle ${VAR:-default} syntax
  str = str.replace(/\$\{([^}:]+):-([^}]*)\}/g, (_, varName, defaultValue) => {
    return process.env[varName] || defaultValue
  })

  // Handle ${VAR} syntax
  str = str.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || ''
  })

  // Handle $VAR syntax (word boundary)
  str = str.replace(/\$([A-Z_][A-Z0-9_]*)/gi, (_, varName) => {
    return process.env[varName] || ''
  })

  return str
}

/**
 * Recursively expand env vars in an object
 */
function expandEnvVarsInObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj

  if (typeof obj === 'string') {
    return expandEnvVars(obj) as T
  }

  if (Array.isArray(obj)) {
    return obj.map(item => expandEnvVarsInObject(item)) as T
  }

  if (typeof obj === 'object') {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVarsInObject(value)
    }
    return result as T
  }

  return obj
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: VaulterConfig = {
  version: '1',
  project: '',
  environments: DEFAULT_ENVIRONMENTS,
  default_environment: DEFAULT_ENVIRONMENT,
  sync: {
    conflict: 'local'
  },
  security: {
    paranoid: false,
    confirm_production: true,
    auto_encrypt: {
      patterns: [
        '*_KEY',
        '*_SECRET',
        '*_TOKEN',
        '*_PASSWORD',
        '*_CREDENTIAL',
        'DATABASE_URL',
        'REDIS_URL'
      ]
    }
  }
}

/**
 * Get the list of valid environments from config
 */
export function getValidEnvironments(config: VaulterConfig): string[] {
  return config.environments || DEFAULT_ENVIRONMENTS
}

/**
 * Validate that an environment is valid for the given config
 */
export function isValidEnvironment(config: VaulterConfig, environment: string): boolean {
  const validEnvs = getValidEnvironments(config)
  return validEnvs.includes(environment)
}

/**
 * Get the default environment from config
 */
export function getDefaultEnvironment(config: VaulterConfig): string {
  return config.default_environment || DEFAULT_ENVIRONMENT
}

/**
 * Find the .vaulter directory by searching up from the current directory
 */
export function findConfigDir(startDir: string = process.cwd()): string | null {
  let currentDir = path.resolve(startDir)
  let depth = 0

  while (depth < MAX_SEARCH_DEPTH) {
    const configDir = path.join(currentDir, CONFIG_DIR)
    const configFile = path.join(configDir, CONFIG_FILE)

    if (fs.existsSync(configFile)) {
      return configDir
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      // Reached root
      break
    }

    currentDir = parentDir
    depth++
  }

  return null
}

/**
 * Load a single config file
 */
function loadConfigFile(configPath: string, required: boolean = true): Partial<VaulterConfig> {
  if (!fs.existsSync(configPath)) {
    if (required) {
      throw new Error(`Config file not found: ${configPath}`)
    }
    return {}
  }

  const content = fs.readFileSync(configPath, 'utf-8')
  const parsed = parseYaml(content) as Partial<VaulterConfig>

  // Expand environment variables in all string values
  return expandEnvVarsInObject(parsed || {})
}

/**
 * Deep merge two config objects
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key of Object.keys(source)) {
    const sourceValue = source[key as keyof T]
    const targetValue = result[key as keyof T]

    if (
      sourceValue !== null &&
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      targetValue !== undefined &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      // Deep merge objects
      result[key as keyof T] = deepMerge(targetValue, sourceValue)
    } else if (sourceValue !== undefined) {
      // Override with source value
      result[key as keyof T] = sourceValue as T[keyof T]
    }
  }

  return result
}

/**
 * Load config with inheritance support
 */
function loadConfigWithExtends(
  configPath: string,
  visited: Set<string> = new Set(),
  depth: number = 0
): VaulterConfig {
  if (depth > MAX_EXTENDS_DEPTH) {
    throw new Error(`Config inheritance depth exceeded (max ${MAX_EXTENDS_DEPTH})`)
  }

  const absolutePath = path.resolve(configPath)

  if (visited.has(absolutePath)) {
    throw new Error(`Circular config inheritance detected: ${absolutePath}`)
  }

  visited.add(absolutePath)

  const config = loadConfigFile(absolutePath)

  // Handle extends
  if (config.extends) {
    const extendsPath = path.resolve(path.dirname(absolutePath), config.extends)
    const parentConfig = loadConfigWithExtends(extendsPath, visited, depth + 1)

    // Remove extends from config before merging
    const { extends: _, ...configWithoutExtends } = config

    // Merge: parent <- current
    return deepMerge(parentConfig, configWithoutExtends as Partial<VaulterConfig>)
  }

  // No extends, merge with defaults
  return deepMerge(DEFAULT_CONFIG, config as Partial<VaulterConfig>)
}

/**
 * Load configuration from the nearest .vaulter/config.yaml
 * Also merges config.local.yaml if it exists (for secrets/overrides)
 */
export function loadConfig(startDir?: string): VaulterConfig {
  const configDir = findConfigDir(startDir)

  if (!configDir) {
    // No config found, return defaults with empty project
    return { ...DEFAULT_CONFIG }
  }

  const configPath = path.join(configDir, CONFIG_FILE)
  let config = loadConfigWithExtends(configPath)

  // Load and merge local config (for secrets that shouldn't be committed)
  const localConfigPath = path.join(configDir, CONFIG_LOCAL_FILE)
  const localConfig = loadConfigFile(localConfigPath, false)

  if (Object.keys(localConfig).length > 0) {
    config = deepMerge(config, localConfig as Partial<VaulterConfig>)
  }

  return config
}

/**
 * Get the project name from config or directory name
 */
export function getProjectName(config: VaulterConfig, startDir?: string): string {
  if (config.project) {
    return config.project
  }

  // Fallback to directory name
  const dir = startDir || process.cwd()
  return path.basename(dir)
}

/**
 * Get the environments directory path
 */
export function getEnvironmentsDir(configDir: string): string {
  return path.join(configDir, 'environments')
}

/**
 * Get the path to an environment file (unified mode)
 */
export function getEnvFilePath(configDir: string, environment: string): string {
  return path.join(getEnvironmentsDir(configDir), `${environment}.env`)
}

/**
 * Check if config uses split mode (separate configs/secrets directories)
 */
export function isSplitMode(config: VaulterConfig): boolean {
  return config.directories?.mode === 'split'
}

/**
 * Get the base directory for resolving relative paths
 * In split mode, paths are relative to the config directory's parent
 */
export function getBaseDir(configDir: string): string {
  return path.dirname(configDir)
}

/**
 * Get the path to secrets file (split mode)
 * Secrets are sensitive and should be gitignored
 *
 * @param config - Vaulter configuration
 * @param configDir - Path to .vaulter directory
 * @param environment - Target environment
 */
export function getSecretsFilePath(
  config: VaulterConfig,
  configDir: string,
  environment: string
): string {
  const baseDir = getBaseDir(configDir)
  const secretsDir = config.directories?.secrets || 'deploy/secrets'
  return path.join(baseDir, secretsDir, `${environment}.env`)
}

/**
 * Get the path to configs file (split mode)
 * Configs are non-sensitive and can be committed to git
 *
 * @param config - Vaulter configuration
 * @param configDir - Path to .vaulter directory
 * @param environment - Target environment
 */
export function getConfigsFilePath(
  config: VaulterConfig,
  configDir: string,
  environment: string
): string {
  const baseDir = getBaseDir(configDir)
  const configsDir = config.directories?.configs || 'deploy/configs'
  return path.join(baseDir, configsDir, `${environment}.env`)
}

/**
 * Get the appropriate env file path based on config mode
 *
 * - unified mode: .vaulter/environments/<env>.env
 * - split mode: deploy/secrets/<env>.env (for secrets/sync operations)
 *
 * @param config - Vaulter configuration
 * @param configDir - Path to .vaulter directory
 * @param environment - Target environment
 */
export function getEnvFilePathForConfig(
  config: VaulterConfig,
  configDir: string,
  environment: string
): string {
  if (isSplitMode(config)) {
    // In split mode, sync/pull/push work with secrets directory
    return getSecretsFilePath(config, configDir, environment)
  }

  // Unified mode: check for custom path or use default
  if (config.directories?.path) {
    const baseDir = getBaseDir(configDir)
    return path.join(baseDir, config.directories.path, `${environment}.env`)
  }

  return getEnvFilePath(configDir, environment)
}

/**
 * Check if a config directory exists
 */
export function configExists(startDir?: string): boolean {
  return findConfigDir(startDir) !== null
}

/**
 * Resolve backend URLs from config
 *
 * Supports both single url and urls array formats:
 * - backend.url: "s3://bucket/path" -> ["s3://bucket/path"]
 * - backend.urls: ["s3://...", "http://..."] -> ["s3://...", "http://..."]
 *
 * @param config - Vaulter configuration
 * @returns Array of backend URLs (empty if none configured)
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

/**
 * Load encryption key for a specific environment
 *
 * Resolution order:
 * 1. VAULTER_KEY_{ENV} env var (e.g., VAULTER_KEY_PRD)
 * 2. Config encryption.keys.{env}.source (supports env, file, s3, inline)
 * 3. Key file ~/.vaulter/projects/{project}/keys/{key_name || env}
 * 4. VAULTER_KEY env var
 * 5. Config encryption.key_source (supports env, file, s3, inline)
 * 6. Key file ~/.vaulter/projects/{project}/keys/master
 *
 * @param config - Vaulter configuration
 * @param project - Project name (for key file resolution)
 * @param environment - Target environment
 * @returns The encryption key or null if not found
 */
export async function loadEncryptionKeyForEnv(
  config: VaulterConfig | null,
  project: string,
  environment: string
): Promise<string | null> {
  const envUpper = environment.toUpperCase()
  const envKeyConfig = config?.encryption?.keys?.[environment]

  // 1. Try VAULTER_KEY_{ENV}
  const envSpecificKey = process.env[`VAULTER_KEY_${envUpper}`]
  if (envSpecificKey) {
    return envSpecificKey
  }

  // 2. Try config encryption.keys.{env}.source (using canonical helper)
  if (envKeyConfig?.source) {
    const key = await loadKeyFromSources(envKeyConfig.source)
    if (key) return key
  }

  // 3. Try key file ~/.vaulter/projects/{project}/keys/{keyName}
  // Supports global: prefix via resolveKeyPath
  const keyFileName = envKeyConfig?.key_name || environment
  const envKeyPath = resolveKeyPath(keyFileName, project, false)
  if (fs.existsSync(envKeyPath)) {
    const key = fs.readFileSync(envKeyPath, 'utf-8').trim()
    if (key) return key
  }

  // 4. Try VAULTER_KEY (global)
  if (process.env.VAULTER_KEY) {
    return process.env.VAULTER_KEY
  }

  // 5. Try config encryption.key_source (using canonical helper)
  if (config?.encryption?.key_source) {
    const key = await loadKeyFromSources(config.encryption.key_source)
    if (key) return key
  }

  // 6. Try key file ~/.vaulter/projects/{project}/keys/master
  const masterKeyPath = path.join(getProjectKeysDir(project), 'master')
  if (fs.existsSync(masterKeyPath)) {
    const key = fs.readFileSync(masterKeyPath, 'utf-8').trim()
    if (key) return key
  }

  return null
}

/**
 * Unified key source loader - handles env, file, s3, and inline sources
 * This is the canonical implementation used across vaulter
 *
 * @param sources - Array of key sources to try in order
 * @returns The key content or null if not found
 */
export async function loadKeyFromSources(
  sources: Array<{ env?: string; file?: string; s3?: string; inline?: string }>
): Promise<string | null> {
  for (const source of sources) {
    if ('env' in source && source.env) {
      const value = process.env[source.env]
      if (value) return value
    } else if ('file' in source && source.file) {
      const filePath = path.resolve(source.file)
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8').trim()
      }
    } else if ('s3' in source && source.s3) {
      try {
        const key = await loadKeyFromS3(source.s3)
        if (key) return key
      } catch (err: any) {
        if (process.env.VAULTER_VERBOSE) {
          console.warn(`Failed to load key from S3: ${err.message}`)
        }
      }
    } else if ('inline' in source && source.inline) {
      return source.inline
    }
  }
  return null
}

/**
 * Get the encryption mode from config
 * Returns 'symmetric' (default) or 'asymmetric'
 */
export function getEncryptionMode(config: VaulterConfig): 'symmetric' | 'asymmetric' {
  return config.encryption?.mode || 'symmetric'
}

/**
 * Get the asymmetric algorithm from config
 * Returns the configured algorithm or 'rsa-4096' as default
 */
export function getAsymmetricAlgorithm(config: VaulterConfig): string {
  return config.encryption?.asymmetric?.algorithm || 'rsa-4096'
}

/**
 * Create a default config file
 */
export function createDefaultConfig(
  configDir: string,
  project: string,
  options: Partial<VaulterConfig> = {}
): void {
  const config: VaulterConfig = {
    version: '1',
    project,
    ...options
  }

  const directoriesSection = buildDirectoriesSection(config.directories)

  // Ensure directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  // Create directories based on mode
  const directoriesMode = config.directories?.mode || 'unified'
  const baseDir = getBaseDir(configDir)

  if (directoriesMode === 'split') {
    const configsDir = path.join(baseDir, config.directories?.configs || 'deploy/configs')
    const secretsDir = path.join(baseDir, config.directories?.secrets || 'deploy/secrets')

    if (!fs.existsSync(configsDir)) {
      fs.mkdirSync(configsDir, { recursive: true })
    }
    if (!fs.existsSync(secretsDir)) {
      fs.mkdirSync(secretsDir, { recursive: true })
    }
  } else {
    const envDir = config.directories?.path
      ? path.join(baseDir, config.directories.path)
      : getEnvironmentsDir(configDir)

    if (!fs.existsSync(envDir)) {
      fs.mkdirSync(envDir, { recursive: true })
    }
  }

  // Write config file
  const configPath = path.join(configDir, CONFIG_FILE)
  const yamlContent = `# Vaulter Configuration
# https://github.com/forattini-dev/vaulter

version: "1"

# Project identification
project: ${project}
# service: optional-service-name

# Backend configuration
# SECURITY: Use environment variables for credentials!
# Supports: \${VAR}, \${VAR:-default}, $VAR
backend:
  # AWS S3 (uses AWS credential chain - no creds in URL)
  # url: s3://bucket/envs?region=us-east-1

  # AWS S3 with specific profile (from ~/.aws/credentials)
  # url: s3://bucket/envs?region=us-east-1&profile=\${AWS_PROFILE:-default}

  # S3 with explicit credentials from env vars
  # url: s3://\${AWS_ACCESS_KEY_ID}:\${AWS_SECRET_ACCESS_KEY}@bucket/envs?region=us-east-1

  # Or use a single env var for the whole URL
  # url: \${VAULTER_BACKEND_URL}

  # MinIO / S3-compatible
  # url: http://\${MINIO_ACCESS_KEY}:\${MINIO_SECRET_KEY}@localhost:9000/envs

  # Local filesystem (development)
  url: file://${process.env.HOME}/.vaulter/store

  # In-memory (testing)
  # url: memory://test

# Encryption settings
encryption:
  key_source:
    - env: VAULTER_KEY        # 1. Try environment variable first
    - file: .vaulter/.key     # 2. Then local file (gitignored)
    # - s3: s3://secure-bucket/keys/vaulter.key  # 3. Remote key

# Available environments
environments:
${DEFAULT_ENVIRONMENTS.map(e => `  - ${e}`).join('\n')}

# Default environment
default_environment: ${DEFAULT_ENVIRONMENT}
${directoriesSection}

# Sync behavior
sync:
  conflict: local  # local | remote | error

# Security settings
security:
  confirm_production: true
  auto_encrypt:
    patterns:
      - "*_KEY"
      - "*_SECRET"
      - "*_TOKEN"
      - "*_PASSWORD"
      - "DATABASE_URL"

# TIP: For credentials, create .vaulter/config.local.yaml (gitignored)
# and put sensitive overrides there:
#
#   backend:
#     url: s3://real-key:real-secret@bucket/envs
`

  fs.writeFileSync(configPath, yamlContent)
}

function buildDirectoriesSection(directories?: VaulterConfig['directories']): string {
  if (!directories) {
    return ''
  }

  const mode = directories.mode || 'unified'
  const lines = [
    '',
    '# Directory structure',
    'directories:',
    `  mode: ${mode}`
  ]

  if (mode === 'split') {
    lines.push(`  configs: ${directories.configs || 'deploy/configs'}`)
    lines.push(`  secrets: ${directories.secrets || 'deploy/secrets'}`)
  } else if (directories.path) {
    lines.push(`  path: ${directories.path}`)
  }

  lines.push('')
  return lines.join('\n')
}
