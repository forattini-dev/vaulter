/**
 * Shared helper for creating MiniEnvClient with fallback support
 */

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

  let connectionStrings: string[]
  if (cliBackend) {
    connectionStrings = [cliBackend]
  } else if (config) {
    connectionStrings = resolveBackendUrls(config)
  } else {
    connectionStrings = []
  }

  // Load encryption key from config
  const passphrase = config ? await loadEncryptionKey(config) : undefined

  return new MiniEnvClient({
    connectionStrings: connectionStrings.length > 0 ? connectionStrings : undefined,
    passphrase: passphrase || undefined,
    verbose
  })
}
