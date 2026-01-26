/**
 * Vaulter Key Management Module
 *
 * Library-first API for managing encryption keys per environment.
 *
 * Key resolution order for an environment:
 * 1. VAULTER_KEY_{ENV} env var (e.g., VAULTER_KEY_PRD)
 * 2. Config encryption.keys.{env}.source (if configured)
 * 3. Key file ~/.vaulter/projects/{project}/keys/{env}
 * 4. VAULTER_KEY env var (global fallback)
 * 5. Config encryption.key_source (default key sources)
 * 6. Key file ~/.vaulter/projects/{project}/keys/master (default key)
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type {
  VaulterConfig,
  AsymmetricAlgorithm,
  EncryptionMode,
  EnvironmentKeyConfig
} from '../types.js'
import {
  getProjectKeysDir,
  getGlobalKeysDir,
  resolveKeyPath,
  loadKeyFromSources,
  loadConfig
} from './config-loader.js'
import { generateKeyPair, generatePassphrase } from './crypto.js'

// ============================================================================
// Types
// ============================================================================

export interface GenerateKeyOptions {
  /** Project name */
  project: string
  /** Key name (default: 'master' or environment name if env is specified) */
  name?: string
  /** Target environment (creates key named after environment) */
  environment?: string
  /** Generate asymmetric key pair (default: false = symmetric) */
  asymmetric?: boolean
  /** Algorithm for asymmetric keys (default: 'rsa-4096') */
  algorithm?: AsymmetricAlgorithm
  /** Global scope instead of project scope */
  global?: boolean
  /** Overwrite if key exists */
  force?: boolean
}

export interface GenerateKeyResult {
  /** Key name */
  name: string
  /** Path to private/symmetric key */
  keyPath: string
  /** Path to public key (asymmetric only) */
  publicKeyPath?: string
  /** Whether key is asymmetric */
  asymmetric: boolean
  /** Algorithm used */
  algorithm: AsymmetricAlgorithm | 'symmetric'
  /** Scope (project or global) */
  scope: 'project' | 'global'
  /** Target environment (if specified) */
  environment?: string
}

export interface LoadKeyForEnvOptions {
  /** Project name */
  project: string
  /** Target environment */
  environment: string
  /** Optional config (loaded automatically if not provided) */
  config?: VaulterConfig | null
  /** Whether to load public key (asymmetric mode) */
  loadPublicKey?: boolean
  /** Whether to load private key (asymmetric mode) */
  loadPrivateKey?: boolean
}

export interface LoadKeyForEnvResult {
  /** Loaded key (passphrase for symmetric, private key for asymmetric) */
  key: string | null
  /** Public key (asymmetric only) */
  publicKey?: string | null
  /** Encryption mode */
  mode: EncryptionMode
  /** Algorithm (for asymmetric) */
  algorithm?: AsymmetricAlgorithm
  /** Source where key was found */
  source: 'env' | 'env-specific' | 'config' | 'file' | 'file-env' | 'fallback' | 'none'
  /** Key name used */
  keyName: string
}

export interface KeyInfo {
  /** Key name */
  name: string
  /** Scope (project or global) */
  scope: 'project' | 'global'
  /** Whether key is asymmetric */
  asymmetric: boolean
  /** Whether public key exists */
  hasPublicKey: boolean
  /** Whether private key exists */
  hasPrivateKey: boolean
  /** Full path to private/symmetric key */
  keyPath: string
  /** Full path to public key */
  publicKeyPath?: string
  /** Environments that use this key (based on naming convention) */
  environments: string[]
  /** Algorithm (detected from key) */
  algorithm?: AsymmetricAlgorithm | 'symmetric'
  /** Created timestamp */
  createdAt?: Date
}

export interface ListKeysOptions {
  /** Project name */
  project: string
  /** Include global keys */
  includeGlobal?: boolean
}

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Generate an encryption key
 *
 * @example
 * ```typescript
 * // Generate symmetric key for production
 * await generateKey({ project: 'myapp', environment: 'prd' })
 *
 * // Generate asymmetric key pair for production
 * await generateKey({
 *   project: 'myapp',
 *   environment: 'prd',
 *   asymmetric: true,
 *   algorithm: 'rsa-4096'
 * })
 *
 * // Generate default master key
 * await generateKey({ project: 'myapp', name: 'master' })
 * ```
 */
export async function generateKey(options: GenerateKeyOptions): Promise<GenerateKeyResult> {
  const {
    project,
    environment,
    asymmetric = false,
    algorithm = 'rsa-4096',
    global: isGlobal = false,
    force = false
  } = options

  // Determine key name: explicit name > environment > 'master'
  const name = options.name || environment || 'master'

  // Determine key directory
  const keysDir = isGlobal ? getGlobalKeysDir() : getProjectKeysDir(project)

  // Ensure directory exists
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true })
  }

  const keyPath = path.join(keysDir, name)
  const publicKeyPath = path.join(keysDir, `${name}.pub`)

  // Check if key exists
  if (!force && fs.existsSync(keyPath)) {
    throw new Error(
      `Key '${name}' already exists at ${keyPath}. Use force: true to overwrite.`
    )
  }

  if (asymmetric) {
    // Generate asymmetric key pair
    const keyPair = generateKeyPair(algorithm)

    // Write private key (restricted permissions)
    fs.writeFileSync(keyPath, keyPair.privateKey, { mode: 0o600 })

    // Write public key (readable)
    fs.writeFileSync(publicKeyPath, keyPair.publicKey, { mode: 0o644 })

    return {
      name,
      keyPath,
      publicKeyPath,
      asymmetric: true,
      algorithm,
      scope: isGlobal ? 'global' : 'project',
      environment
    }
  } else {
    // Generate symmetric passphrase
    const passphrase = generatePassphrase(32)

    // Write key (restricted permissions)
    fs.writeFileSync(keyPath, passphrase, { mode: 0o600 })

    return {
      name,
      keyPath,
      asymmetric: false,
      algorithm: 'symmetric',
      scope: isGlobal ? 'global' : 'project',
      environment
    }
  }
}

// ============================================================================
// Key Loading
// ============================================================================

/**
 * Load encryption key for a specific environment
 *
 * Resolution order:
 * 1. VAULTER_KEY_{ENV} env var
 * 2. Config encryption.keys.{env}.source
 * 3. Key file ~/.vaulter/projects/{project}/keys/{env}
 * 4. VAULTER_KEY env var
 * 5. Config encryption.key_source
 * 6. Key file ~/.vaulter/projects/{project}/keys/master
 *
 * @example
 * ```typescript
 * const result = await loadKeyForEnv({
 *   project: 'myapp',
 *   environment: 'prd'
 * })
 *
 * if (result.key) {
 *   console.log(`Loaded key from ${result.source}`)
 * }
 * ```
 */
export async function loadKeyForEnv(
  options: LoadKeyForEnvOptions
): Promise<LoadKeyForEnvResult> {
  const { project, environment } = options

  // Auto-load config if not provided (as documented in the interface)
  const config = options.config !== undefined ? options.config : loadConfig()

  const envUpper = environment.toUpperCase()
  const envKeyConfig = config?.encryption?.keys?.[environment]

  // Determine encryption mode
  const mode: EncryptionMode = envKeyConfig?.mode || config?.encryption?.mode || 'symmetric'

  // For asymmetric mode, handle separately
  // Pass the resolved config to ensure asymmetric path has access to it
  if (mode === 'asymmetric') {
    return loadAsymmetricKeyForEnv({ ...options, config }, envKeyConfig)
  }

  // Symmetric mode - find passphrase

  // 1. Try VAULTER_KEY_{ENV}
  const envSpecificKey = process.env[`VAULTER_KEY_${envUpper}`]
  if (envSpecificKey) {
    return {
      key: envSpecificKey,
      mode: 'symmetric',
      source: 'env-specific',
      keyName: `VAULTER_KEY_${envUpper}`
    }
  }

  // 2. Try config encryption.keys.{env}.source
  if (envKeyConfig?.source) {
    const key = await loadKeyFromSources(envKeyConfig.source)
    if (key) {
      return {
        key,
        mode: 'symmetric',
        source: 'config',
        keyName: envKeyConfig.key_name || environment
      }
    }
  }

  // 3. Try key file ~/.vaulter/projects/{project}/keys/{keyName}
  // Use key_name from config if available, otherwise fall back to environment name
  const keyFileName = envKeyConfig?.key_name || environment
  const envKeyPath = path.join(getProjectKeysDir(project), keyFileName)
  if (fs.existsSync(envKeyPath)) {
    const key = fs.readFileSync(envKeyPath, 'utf-8').trim()
    if (key) {
      return {
        key,
        mode: 'symmetric',
        source: 'file-env',
        keyName: keyFileName
      }
    }
  }

  // 4. Try VAULTER_KEY (global)
  if (process.env.VAULTER_KEY) {
    return {
      key: process.env.VAULTER_KEY,
      mode: 'symmetric',
      source: 'env',
      keyName: 'VAULTER_KEY'
    }
  }

  // 5. Try config encryption.key_source
  if (config?.encryption?.key_source) {
    const key = await loadKeyFromSources(config.encryption.key_source)
    if (key) {
      return {
        key,
        mode: 'symmetric',
        source: 'config',
        keyName: 'default'
      }
    }
  }

  // 6. Try key file ~/.vaulter/projects/{project}/keys/master
  const masterKeyPath = path.join(getProjectKeysDir(project), 'master')
  if (fs.existsSync(masterKeyPath)) {
    const key = fs.readFileSync(masterKeyPath, 'utf-8').trim()
    if (key) {
      return {
        key,
        mode: 'symmetric',
        source: 'fallback',
        keyName: 'master'
      }
    }
  }

  // No key found
  return {
    key: null,
    mode: 'symmetric',
    source: 'none',
    keyName: 'none'
  }
}

/**
 * Load asymmetric keys for environment
 */
async function loadAsymmetricKeyForEnv(
  options: LoadKeyForEnvOptions,
  envKeyConfig?: EnvironmentKeyConfig
): Promise<LoadKeyForEnvResult> {
  const { project, environment, config, loadPublicKey = true, loadPrivateKey = true } = options

  const asymConfig = envKeyConfig?.asymmetric || config?.encryption?.asymmetric
  const algorithm = asymConfig?.algorithm || 'rsa-4096'
  const keyName = envKeyConfig?.key_name || asymConfig?.key_name || environment

  let privateKey: string | null = null
  let publicKey: string | null = null
  let source: LoadKeyForEnvResult['source'] = 'none'

  // Try to load private key
  if (loadPrivateKey) {
    // 1. Try VAULTER_PRIVATE_KEY_{ENV}
    const envPrivKey = process.env[`VAULTER_PRIVATE_KEY_${environment.toUpperCase()}`]
    if (envPrivKey) {
      privateKey = envPrivKey
      source = 'env-specific'
    }

    // 2. Try config asymmetric.private_key sources
    if (!privateKey && asymConfig?.private_key) {
      privateKey = await loadKeyFromSources(asymConfig.private_key)
      if (privateKey) source = 'config'
    }

    // 3. Try key file
    if (!privateKey) {
      const keyPath = resolveKeyPath(keyName, project, false)
      if (fs.existsSync(keyPath)) {
        privateKey = fs.readFileSync(keyPath, 'utf-8')
        source = 'file'
      }
    }

    // 4. Try VAULTER_PRIVATE_KEY (global)
    if (!privateKey && process.env.VAULTER_PRIVATE_KEY) {
      privateKey = process.env.VAULTER_PRIVATE_KEY
      source = 'env'
    }
  }

  // Try to load public key
  if (loadPublicKey) {
    // 1. Try VAULTER_PUBLIC_KEY_{ENV}
    const envPubKey = process.env[`VAULTER_PUBLIC_KEY_${environment.toUpperCase()}`]
    if (envPubKey) {
      publicKey = envPubKey
    }

    // 2. Try config asymmetric.public_key sources
    if (!publicKey && asymConfig?.public_key) {
      publicKey = await loadKeyFromSources(asymConfig.public_key)
    }

    // 3. Try key file
    if (!publicKey) {
      const keyPath = resolveKeyPath(keyName, project, true)
      if (fs.existsSync(keyPath)) {
        publicKey = fs.readFileSync(keyPath, 'utf-8')
      }
    }

    // 4. Try VAULTER_PUBLIC_KEY (global)
    if (!publicKey && process.env.VAULTER_PUBLIC_KEY) {
      publicKey = process.env.VAULTER_PUBLIC_KEY
    }
  }

  return {
    key: privateKey,
    publicKey,
    mode: 'asymmetric',
    algorithm: algorithm as AsymmetricAlgorithm,
    source,
    keyName
  }
}

// ============================================================================
// Key Listing
// ============================================================================

/**
 * List all keys for a project
 *
 * @example
 * ```typescript
 * const keys = await listKeys({ project: 'myapp' })
 * for (const key of keys) {
 *   console.log(`${key.name}: ${key.asymmetric ? 'asymmetric' : 'symmetric'}`)
 * }
 * ```
 */
export async function listKeys(options: ListKeysOptions): Promise<KeyInfo[]> {
  const { project, includeGlobal = true } = options
  const keys: KeyInfo[] = []

  // List project keys
  const projectKeysDir = getProjectKeysDir(project)
  if (fs.existsSync(projectKeysDir)) {
    const projectKeys = await listKeysInDir(projectKeysDir, 'project')
    keys.push(...projectKeys)
  }

  // List global keys
  if (includeGlobal) {
    const globalKeysDir = getGlobalKeysDir()
    if (fs.existsSync(globalKeysDir)) {
      const globalKeys = await listKeysInDir(globalKeysDir, 'global')
      keys.push(...globalKeys)
    }
  }

  return keys
}

/**
 * List keys in a directory
 */
async function listKeysInDir(
  keysDir: string,
  scope: 'project' | 'global'
): Promise<KeyInfo[]> {
  const keys: KeyInfo[] = []
  const seenNames = new Set<string>()

  const files = fs.readdirSync(keysDir)

  for (const file of files) {
    // Skip .pub files (handled with their private key)
    if (file.endsWith('.pub')) continue

    const name = file
    if (seenNames.has(name)) continue
    seenNames.add(name)

    const keyPath = path.join(keysDir, name)
    const publicKeyPath = path.join(keysDir, `${name}.pub`)

    const hasPrivateKey = fs.existsSync(keyPath)
    const hasPublicKey = fs.existsSync(publicKeyPath)

    // Determine if asymmetric by checking for .pub file or key content
    let asymmetric = hasPublicKey
    let algorithm: KeyInfo['algorithm'] = 'symmetric'

    if (hasPrivateKey) {
      const content = fs.readFileSync(keyPath, 'utf-8')
      if (content.includes('PRIVATE KEY')) {
        asymmetric = true
        algorithm = detectAlgorithm(content)
      }
    }

    // Determine environments based on naming convention
    const environments = inferEnvironments(name)

    // Get creation time
    let createdAt: Date | undefined
    if (hasPrivateKey) {
      const stat = fs.statSync(keyPath)
      createdAt = stat.birthtime
    }

    keys.push({
      name,
      scope,
      asymmetric,
      hasPublicKey,
      hasPrivateKey,
      keyPath,
      publicKeyPath: hasPublicKey ? publicKeyPath : undefined,
      environments,
      algorithm,
      createdAt
    })
  }

  return keys
}

/**
 * Detect algorithm from private key content
 */
function detectAlgorithm(privateKeyPem: string): AsymmetricAlgorithm | 'symmetric' {
  try {
    const keyObject = crypto.createPrivateKey(privateKeyPem)
    const type = keyObject.asymmetricKeyType

    if (type === 'rsa') {
      // Check key size
      const details = keyObject.asymmetricKeyDetails
      const modulusLength = details?.modulusLength || 0
      return modulusLength >= 4096 ? 'rsa-4096' : 'rsa-2048'
    } else if (type === 'ec') {
      const details = keyObject.asymmetricKeyDetails
      const curve = details?.namedCurve || ''
      return curve.includes('384') ? 'ec-p384' : 'ec-p256'
    }
  } catch {
    // Not a valid key, assume symmetric
  }
  return 'symmetric'
}

/**
 * Infer environments from key name
 */
function inferEnvironments(keyName: string): string[] {
  const commonEnvNames = ['dev', 'stg', 'prd', 'prod', 'staging', 'production', 'sandbox', 'sbx']

  // If key name matches a common env name, it's for that env
  if (commonEnvNames.includes(keyName.toLowerCase())) {
    return [keyName.toLowerCase()]
  }

  // 'master' is typically the fallback for all environments
  if (keyName === 'master' || keyName === 'default') {
    return ['*'] // All environments
  }

  // Otherwise, unknown
  return []
}

// ============================================================================
// Key Utilities
// ============================================================================

/**
 * Check if a key exists for an environment
 */
export function keyExistsForEnv(project: string, environment: string): boolean {
  const envKeyPath = path.join(getProjectKeysDir(project), environment)
  const masterKeyPath = path.join(getProjectKeysDir(project), 'master')

  return fs.existsSync(envKeyPath) || fs.existsSync(masterKeyPath)
}

/**
 * Get the key path for an environment
 */
export function getKeyPathForEnv(project: string, environment: string): string {
  const envKeyPath = path.join(getProjectKeysDir(project), environment)

  if (fs.existsSync(envKeyPath)) {
    return envKeyPath
  }

  // Fallback to master
  return path.join(getProjectKeysDir(project), 'master')
}

/**
 * Delete a key
 */
export function deleteKey(project: string, name: string, global: boolean = false): void {
  const keysDir = global ? getGlobalKeysDir() : getProjectKeysDir(project)
  const keyPath = path.join(keysDir, name)
  const publicKeyPath = path.join(keysDir, `${name}.pub`)

  if (fs.existsSync(keyPath)) {
    fs.unlinkSync(keyPath)
  }
  if (fs.existsSync(publicKeyPath)) {
    fs.unlinkSync(publicKeyPath)
  }
}
