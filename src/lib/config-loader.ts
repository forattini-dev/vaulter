/**
 * Vaulter Config Loader
 *
 * Loads and merges configuration from .vaulter/config.yaml files
 * with support for inheritance via "extends" field.
 */

import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { VaulterConfig, Environment } from '../types.js'
import { loadKeyFromS3 } from './s3-key-loader.js'

const CONFIG_DIR = '.vaulter'
const CONFIG_FILE = 'config.yaml'
const CONFIG_LOCAL_FILE = 'config.local.yaml'
const MAX_SEARCH_DEPTH = 5
const MAX_EXTENDS_DEPTH = 10

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
  environments: ['dev', 'stg', 'prd', 'sbx', 'dr'],
  default_environment: 'dev',
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
 * Get the path to an environment file
 */
export function getEnvFilePath(configDir: string, environment: Environment): string {
  return path.join(getEnvironmentsDir(configDir), `${environment}.env`)
}

/**
 * Check if a config directory exists
 */
export function configExists(startDir?: string): boolean {
  return findConfigDir(startDir) !== null
}

/**
 * Get the encryption key from configured sources
 */
export async function loadEncryptionKey(config: VaulterConfig): Promise<string | null> {
  const keySources = config.encryption?.key_source || []

  for (const source of keySources) {
    if ('env' in source) {
      // Environment variable
      const value = process.env[source.env]
      if (value) return value
    } else if ('file' in source) {
      // Local file
      const filePath = path.resolve(source.file)
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8').trim()
      }
    } else if ('s3' in source) {
      // S3 remote key
      try {
        const key = await loadKeyFromS3(source.s3)
        if (key) return key
      } catch (err: any) {
        // Log error but continue to next source
        if (process.env.VAULTER_VERBOSE) {
          console.warn(`Failed to load key from S3: ${err.message}`)
        }
      }
    }
  }

  // Fallback to VAULTER_KEY environment variable
  if (process.env.VAULTER_KEY) {
    return process.env.VAULTER_KEY
  }

  return null
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

  // Ensure directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  // Create environments directory
  const envDir = getEnvironmentsDir(configDir)
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true })
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
  - dev
  - stg
  - prd
  - sbx
  - dr

# Default environment
default_environment: dev

# Sync behavior
sync:
  conflict: local  # local | remote | prompt | error

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
