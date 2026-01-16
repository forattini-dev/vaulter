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
  loadEncryptionKey,
  loadPublicKey,
  loadPrivateKey,
  getEncryptionMode,
  getAsymmetricAlgorithm
} from '../../lib/config-loader.js'
import { resolveBackendUrls } from '../../index.js'

export interface CreateClientOptions {
  args: CLIArgs
  config: VaulterConfig | null
  /** Effective project name (CLI --project takes precedence over config.project) */
  project?: string
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
  const { args, config, project, verbose = false } = options

  // Effective project: CLI --project > options.project > config.project
  const effectiveProject = args.project || args.p || project || config?.project

  // CLI backend override takes precedence (no fallback)
  const cliBackend = args.backend || args.b
  const cliKey = args.key || args.k

  let connectionStrings: string[]
  if (cliBackend) {
    connectionStrings = [cliBackend]
  } else if (config) {
    connectionStrings = resolveBackendUrls(config)
  } else {
    connectionStrings = []
  }

  // Determine encryption mode
  const encryptionMode = config ? getEncryptionMode(config) : 'symmetric'

  // For asymmetric mode, load public/private keys
  if (encryptionMode === 'asymmetric' && config) {
    // Use effective project (CLI --project takes precedence over config.project)
    const projectForKeys = effectiveProject || config.project
    const publicKey = await loadPublicKey(config, projectForKeys)
    const privateKey = await loadPrivateKey(config, projectForKeys)
    const algorithm = getAsymmetricAlgorithm(config) as AsymmetricAlgorithm

    if (!publicKey && !privateKey) {
      throw new Error(
        'Asymmetric encryption mode requires at least a public key (for writing) or private key (for reading). ' +
        'Set encryption.asymmetric.key_name in config or VAULTER_PUBLIC_KEY/VAULTER_PRIVATE_KEY environment variables.'
      )
    }

    if (verbose) {
      console.error(`Using asymmetric encryption (${algorithm}) for project: ${projectForKeys}`)
      if (publicKey) console.error('  Public key: loaded')
      if (privateKey) console.error('  Private key: loaded')
    }

    return new VaulterClient({
      connectionStrings: connectionStrings.length > 0 ? connectionStrings : undefined,
      encryptionMode: 'asymmetric',
      publicKey: publicKey || undefined,
      privateKey: privateKey || undefined,
      asymmetricAlgorithm: algorithm,
      verbose
    })
  }

  // Symmetric mode (default)
  // Load encryption key from CLI or config
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
  } else {
    passphrase = config ? (await loadEncryptionKey(config)) || undefined : undefined
  }

  const hasRemoteBackend = connectionStrings.some(url => !isLocalBackend(url))
  if (!passphrase && hasRemoteBackend) {
    if (config?.security?.paranoid) {
      throw new Error('No encryption key found. Set VAULTER_KEY or use --key.')
    }
    console.error(
      'Warning: No encryption key found. Falling back to the default dev key. ' +
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
