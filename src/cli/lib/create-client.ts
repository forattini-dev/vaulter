/**
 * Shared helper for creating MiniEnvClient with fallback support
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, MiniEnvConfig } from '../../types.js'
import { MiniEnvClient } from '../../client.js'
import { loadEncryptionKey } from '../../lib/config-loader.js'
import { resolveBackendUrls } from '../../index.js'

export interface CreateClientOptions {
  args: CLIArgs
  config: MiniEnvConfig | null
  verbose?: boolean
}

/**
 * Create a MiniEnvClient with proper fallback support
 *
 * Priority:
 * 1. CLI --backend flag (single URL, no fallback)
 * 2. Config backend.urls (multiple URLs with fallback)
 * 3. Config backend.url (single URL)
 * 4. Default filesystem backend
 */
export async function createClientFromConfig(options: CreateClientOptions): Promise<MiniEnvClient> {
  const { args, config, verbose = false } = options

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
      throw new Error('No encryption key found. Set MINIENV_KEY or use --key.')
    }
    console.error(
      'Warning: No encryption key found. Falling back to the default dev key. ' +
      'Set MINIENV_KEY or use --key to avoid insecure encryption.'
    )
  }

  return new MiniEnvClient({
    connectionStrings: connectionStrings.length > 0 ? connectionStrings : undefined,
    passphrase: passphrase || undefined,
    verbose
  })
}

function isLocalBackend(url: string): boolean {
  return url.startsWith('file://') || url.startsWith('memory://')
}
