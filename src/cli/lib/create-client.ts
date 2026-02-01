/**
 * Shared helper for creating VaulterClient with fallback support
 *
 * Supports both symmetric (passphrase) and asymmetric (RSA/EC) encryption modes.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, VaulterConfig, AsymmetricAlgorithm } from '../../types.js'
import { VaulterClient } from '../../client.js'
import {
  loadEncryptionKeyForEnv,
  getEncryptionMode,
  getAsymmetricAlgorithm
} from '../../lib/config-loader.js'
import { loadKeyForEnv } from '../../lib/keys.js'
import { resolveBackendUrls } from '../../index.js'
import { print } from './colors.js'
import * as ui from '../ui.js'

export interface CreateClientOptions {
  args: CLIArgs
  config: VaulterConfig | null
  /** Effective project name (CLI --project takes precedence over config.project) */
  project?: string
  /** Target environment (for per-env key resolution) */
  environment?: string
  verbose?: boolean
}

/**
 * Create a VaulterClient with proper fallback support
 *
 * Priority:
 * 1. CLI --backend flag (single URL, no fallback)
 * 2. Config backend.urls (multiple URLs with fallback)
 * 3. Config backend.url (single URL)
 * 4. Default filesystem backend
 *
 * Encryption modes:
 * - symmetric (default): Uses passphrase-based AES-256-GCM
 * - asymmetric: Uses RSA/EC hybrid encryption with public/private key pairs
 */
export async function createClientFromConfig(options: CreateClientOptions): Promise<VaulterClient> {
  const { args, config, project, environment, verbose = false } = options

  // Effective project: CLI --project > options.project > config.project
  const effectiveProject = args.project || project || config?.project

  // Effective environment: CLI --env > options.environment > config.default_environment > 'dev'
  const effectiveEnvironment = args.env || environment || config?.default_environment || 'dev'

  // CLI backend override takes precedence (no fallback)
  const cliBackend = args.backend
  const cliKey = args.key

  let connectionStrings: string[]
  if (cliBackend) {
    connectionStrings = [cliBackend]
  } else if (config) {
    connectionStrings = resolveBackendUrls(config)
  } else {
    connectionStrings = []
  }

  // Determine encryption mode (allow per-environment override)
  const envKeyConfig = config?.encryption?.keys?.[effectiveEnvironment]
  const encryptionMode = envKeyConfig?.mode || (config ? getEncryptionMode(config) : 'symmetric')

  // For asymmetric mode, load public/private keys
  if (encryptionMode === 'asymmetric' && config) {
    // Use effective project (CLI --project takes precedence over config.project)
    const projectForKeys = effectiveProject || config.project || 'default'
    const keyResult = await loadKeyForEnv({
      project: projectForKeys,
      environment: effectiveEnvironment,
      config,
      loadPublicKey: true,
      loadPrivateKey: true
    })
    const algorithm =
      (keyResult.algorithm || (config ? getAsymmetricAlgorithm(config) : 'rsa-4096')) as AsymmetricAlgorithm

    if (!keyResult.publicKey && !keyResult.key) {
      throw new Error(
        'Asymmetric encryption mode requires at least a public key (for writing) or private key (for reading). ' +
        'Set encryption.asymmetric.key_name in config or VAULTER_PUBLIC_KEY/VAULTER_PRIVATE_KEY environment variables.'
      )
    }

    ui.verbose(
      `Using asymmetric encryption (${algorithm}) for project: ${projectForKeys} (env: ${effectiveEnvironment})`,
      verbose
    )
    if (verbose && keyResult.publicKey) ui.verbose('  Public key: loaded', true)
    if (verbose && keyResult.key) ui.verbose('  Private key: loaded', true)

    return new VaulterClient({
      connectionStrings: connectionStrings.length > 0 ? connectionStrings : undefined,
      encryptionMode: 'asymmetric',
      publicKey: keyResult.publicKey || undefined,
      privateKey: keyResult.key || undefined,
      asymmetricAlgorithm: algorithm,
      verbose
    })
  }

  // Symmetric mode (default)
  // Load encryption key from CLI, config, or env vars
  let passphrase: string | undefined
  if (cliKey) {
    const keyPath = path.resolve(cliKey)
    if (fs.existsSync(keyPath)) {
      const stat = fs.statSync(keyPath)
      if (!stat.isFile()) {
        throw new Error(`Encryption key path is not a file: ${keyPath}`)
      }
      passphrase = fs.readFileSync(keyPath, 'utf-8').trim() || undefined
    } else {
      passphrase = cliKey
    }
  } else if (config && effectiveProject) {
    // Use per-environment key resolution with config
    passphrase = (await loadEncryptionKeyForEnv(config, effectiveProject, effectiveEnvironment)) || undefined
  } else {
    // No config: try env vars directly (VAULTER_KEY_{ENV} > VAULTER_KEY)
    const envUpper = effectiveEnvironment.toUpperCase()
    passphrase = process.env[`VAULTER_KEY_${envUpper}`] || process.env.VAULTER_KEY || undefined
    if (passphrase && verbose) {
      ui.verbose(`Loaded key from env var (no config)`, true)
    }
  }

  const hasRemoteBackend = connectionStrings.some(url => !isLocalBackend(url))
  if (!passphrase && hasRemoteBackend) {
    if (config?.security?.paranoid) {
      throw new Error('No encryption key found. Set VAULTER_KEY or use --key.')
    }
    print.warning(
      'No encryption key found. Falling back to the default dev key. ' +
      'Set VAULTER_KEY or use --key to avoid insecure encryption.'
    )
  }

  return new VaulterClient({
    connectionStrings: connectionStrings.length > 0 ? connectionStrings : undefined,
    encryptionMode: 'symmetric',
    passphrase: passphrase || undefined,
    verbose
  })
}

function isLocalBackend(url: string): boolean {
  return url.startsWith('file://') || url.startsWith('memory://')
}

/**
 * Execute a function with a connected VaulterClient
 *
 * Handles connect/disconnect automatically, ensuring proper cleanup.
 *
 * @example
 * ```typescript
 * const result = await withClient({ args, config, project }, async (client) => {
 *   return await client.get(key, project, environment)
 * })
 * ```
 */
export async function withClient<T>(
  options: CreateClientOptions,
  fn: (client: VaulterClient) => Promise<T>
): Promise<T> {
  const client = await createClientFromConfig(options)
  try {
    await client.connect()
    return await fn(client)
  } finally {
    await client.disconnect()
  }
}
