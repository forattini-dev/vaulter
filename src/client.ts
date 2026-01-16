/**
 * Vaulter Client - s3db.js wrapper for environment variable storage
 *
 * Supports two encryption modes:
 * - symmetric (default): Uses s3db.js built-in AES-256-GCM encryption via passphrase
 * - asymmetric: Uses RSA/EC hybrid encryption (public key encrypts, private key decrypts)
 */

import { S3db } from 's3db.js/lite'
import os from 'node:os'
import type {
  EnvVar,
  EnvVarInput,
  Environment,
  ListOptions,
  VaulterClientOptions,
  SyncResult,
  AsymmetricAlgorithm
} from './types.js'
import {
  hybridEncrypt,
  hybridDecrypt,
  isHybridEncrypted,
  serializeEncrypted
} from './lib/crypto.js'

// Default connection string for local development (FileSystem backend)
const DEFAULT_CONNECTION_STRING = `file://${os.homedir()}/.vaulter/store`
const DEFAULT_PASSPHRASE = 'vaulter-default-dev-key'

/**
 * Vaulter Client
 *
 * Provides a high-level API for managing environment variables
 * using s3db.js as the storage backend.
 *
 * Encryption modes:
 * - symmetric: passphrase-based AES-256-GCM (via s3db.js)
 * - asymmetric: RSA/EC hybrid encryption (public key for write, private for read)
 */
export class VaulterClient {
  private db: S3db | null = null
  private resource: any = null
  private connectionStrings: string[]
  private activeConnectionString: string | null = null
  private passphrase: string
  private initialized = false
  private verbose: boolean

  // Asymmetric encryption properties
  private encryptionMode: 'symmetric' | 'asymmetric'
  private publicKey: string | null
  private privateKey: string | null
  private asymmetricAlgorithm: AsymmetricAlgorithm

  constructor(options: VaulterClientOptions = {}) {
    // Support single connectionString or array of connectionStrings
    if (options.connectionStrings && options.connectionStrings.length > 0) {
      this.connectionStrings = options.connectionStrings
    } else if (options.connectionString) {
      this.connectionStrings = [options.connectionString]
    } else {
      this.connectionStrings = [DEFAULT_CONNECTION_STRING]
    }
    this.passphrase = options.passphrase || DEFAULT_PASSPHRASE
    this.verbose = options.verbose || false

    // Asymmetric encryption configuration
    this.encryptionMode = options.encryptionMode || 'symmetric'
    this.publicKey = options.publicKey || null
    this.privateKey = options.privateKey || null
    this.asymmetricAlgorithm = options.asymmetricAlgorithm || 'rsa-4096'

    // Validate asymmetric mode requirements
    if (this.encryptionMode === 'asymmetric') {
      if (!this.publicKey && !this.privateKey) {
        throw new Error('Asymmetric mode requires at least a public key (for encryption) or private key (for decryption)')
      }
    }
  }

  /**
   * Encrypt a value using the configured encryption mode
   * For symmetric mode, encryption is handled by s3db.js
   * For asymmetric mode, we use hybrid encryption
   */
  private encryptValue(value: string): string {
    if (this.encryptionMode === 'symmetric') {
      // s3db.js handles encryption via 'secret' field type
      return value
    }

    // Asymmetric mode - use hybrid encryption
    if (!this.publicKey) {
      throw new Error('Cannot encrypt: public key not configured')
    }

    const encrypted = hybridEncrypt(value, this.publicKey, this.asymmetricAlgorithm)
    return serializeEncrypted(encrypted)
  }

  /**
   * Decrypt a value using the configured encryption mode
   * For symmetric mode, decryption is handled by s3db.js
   * For asymmetric mode, we use hybrid decryption
   */
  private decryptValue(value: string): string {
    if (this.encryptionMode === 'symmetric') {
      // s3db.js handles decryption via 'secret' field type
      return value
    }

    // Asymmetric mode - check if value is hybrid-encrypted
    try {
      const parsed = JSON.parse(value)
      if (isHybridEncrypted(parsed)) {
        if (!this.privateKey) {
          throw new Error('Cannot decrypt: private key not configured')
        }
        return hybridDecrypt(parsed, this.privateKey)
      }
    } catch {
      // Not JSON or not hybrid-encrypted, return as-is
    }

    // Return as-is if not hybrid-encrypted (for backwards compatibility)
    return value
  }

  /**
   * Check if the client can encrypt (has public key for asymmetric mode)
   */
  canEncrypt(): boolean {
    if (this.encryptionMode === 'symmetric') {
      return !!this.passphrase
    }
    return !!this.publicKey
  }

  /**
   * Check if the client can decrypt (has private key for asymmetric mode)
   */
  canDecrypt(): boolean {
    if (this.encryptionMode === 'symmetric') {
      return !!this.passphrase
    }
    return !!this.privateKey
  }

  /**
   * Initialize the client and connect to the storage backend
   * Tries each URL in order until one succeeds (fallback support)
   */
  async connect(): Promise<void> {
    if (this.initialized) return

    const errors: Array<{ url: string; error: Error }> = []

    for (const connectionString of this.connectionStrings) {
      try {
        if (this.verbose) {
          console.error(`[vaulter] Trying backend: ${this.maskCredentials(connectionString)}`)
        }

        this.db = new S3db({
          connectionString,
          passphrase: this.passphrase
        })

        await this.db.connect()

        // Create or get the environment-variables resource
        // In symmetric mode, use 'secret' type for s3db.js auto-encryption
        // In asymmetric mode, use 'string' type as we handle encryption ourselves
        const valueFieldType = this.encryptionMode === 'symmetric' ? 'secret|required' : 'string|required'

        this.resource = await this.db.createResource({
          name: 'environment-variables',

          attributes: {
            key: 'string|required',
            value: valueFieldType, // Encryption depends on mode
            project: 'string|required',
            service: 'string|optional',
            environment: 'string|required', // User-defined environment names (no enum constraint)
            tags: 'array|items:string|optional',
            metadata: {
              description: 'string|optional',
              owner: 'string|optional',
              rotateAfter: 'date|optional',
              source: { type: 'string', enum: ['manual', 'sync', 'import'], optional: true }
            }
          },

          // Partitions for O(1) queries
          partitions: {
            byProject: {
              fields: { project: 'string' }
            },
            byProjectEnv: {
              fields: { project: 'string', environment: 'string' }
            },
            byProjectServiceEnv: {
              fields: { project: 'string', service: 'string', environment: 'string' }
            },
            // Cross-project partition for compliance/auditing
            byEnvironment: {
              fields: { environment: 'string' }
            }
          },

          behavior: 'body-overflow', // Works for both symmetric and asymmetric modes
          timestamps: true,
          asyncPartitions: true // Faster writes
        })

        // Success! Store the active connection string
        this.activeConnectionString = connectionString
        this.initialized = true

        if (this.verbose) {
          console.error(`[vaulter] Connected to: ${this.maskCredentials(connectionString)}`)
        }

        return // Exit on first successful connection

      } catch (err) {
        errors.push({ url: connectionString, error: err as Error })

        if (this.verbose) {
          console.error(`[vaulter] Failed to connect to ${this.maskCredentials(connectionString)}: ${(err as Error).message}`)
        }

        // Clean up failed connection
        if (this.db) {
          try {
            await this.db.disconnect()
          } catch {
            // Ignore disconnect errors
          }
          this.db = null
        }
      }
    }

    // All backends failed
    const errorMessages = errors.map(e => `  - ${this.maskCredentials(e.url)}: ${e.error.message}`).join('\n')
    throw new Error(`Failed to connect to any backend:\n${errorMessages}`)
  }

  /**
   * Mask credentials in connection string for logging
   */
  private maskCredentials(url: string): string {
    // Mask password in URLs like s3://key:secret@bucket or http://user:pass@host
    return url.replace(/:([^:@/]+)@/, ':***@')
  }

  /**
   * Ensure client is connected
   */
  private ensureConnected(): void {
    if (!this.initialized || !this.resource) {
      throw new Error('VaulterClient not initialized. Call connect() first.')
    }
  }

  /**
   * Get a single environment variable
   */
  async get(
    key: string,
    project: string,
    environment: Environment,
    service?: string
  ): Promise<EnvVar | null> {
    this.ensureConnected()

    const partition = service ? 'byProjectServiceEnv' : 'byProjectEnv'
    const partitionValues = service
      ? { project, service, environment }
      : { project, environment }

    const results = await this.resource.list({
      partition,
      partitionValues
    })

    const found = results.find((item: EnvVar) => item.key === key)
    if (!found) return null

    // Decrypt value if in asymmetric mode
    return {
      ...found,
      value: this.decryptValue(found.value)
    }
  }

  /**
   * Set an environment variable (create or update)
   */
  async set(input: EnvVarInput): Promise<EnvVar> {
    this.ensureConnected()

    // Encrypt value if in asymmetric mode
    const encryptedValue = this.encryptValue(input.value)

    // For get, we need to query without decryption to find existing record
    const partition = input.service ? 'byProjectServiceEnv' : 'byProjectEnv'
    const partitionValues = input.service
      ? { project: input.project, service: input.service, environment: input.environment }
      : { project: input.project, environment: input.environment }

    const results = await this.resource.list({ partition, partitionValues })
    const existing = results.find((item: EnvVar) => item.key === input.key)

    if (existing) {
      // Update existing - filter undefined values to preserve existing metadata
      const filteredInputMeta = input.metadata
        ? Object.fromEntries(Object.entries(input.metadata).filter(([, v]) => v !== undefined))
        : {}

      const result = await this.resource.update(existing.id, {
        value: encryptedValue,
        tags: input.tags,
        metadata: {
          ...existing.metadata,
          ...filteredInputMeta,
          source: input.metadata?.source || existing.metadata?.source || 'manual'
        }
      })

      // Return with decrypted value
      return { ...result, value: input.value }
    } else {
      // Create new
      const result = await this.resource.insert({
        ...input,
        value: encryptedValue,
        metadata: {
          ...input.metadata,
          source: input.metadata?.source || 'manual'
        }
      })

      // Return with decrypted value
      return { ...result, value: input.value }
    }
  }

  /**
   * Delete an environment variable
   */
  async delete(
    key: string,
    project: string,
    environment: Environment,
    service?: string
  ): Promise<boolean> {
    this.ensureConnected()

    const existing = await this.get(key, project, environment, service)
    if (!existing) return false

    await this.resource.delete(existing.id)
    return true
  }

  /**
   * List environment variables
   *
   * Automatically selects the most efficient partition based on provided filters:
   * - project + service + environment → byProjectServiceEnv
   * - project + environment → byProjectEnv
   * - project only → byProject
   * - environment only → byEnvironment (cross-project, for auditing)
   */
  async list(options: ListOptions = {}): Promise<EnvVar[]> {
    this.ensureConnected()

    const { project, service, environment, limit, offset } = options

    // Determine partition based on provided filters
    let partition: string | undefined
    let partitionValues: Record<string, string> | undefined

    if (project && service && environment) {
      partition = 'byProjectServiceEnv'
      partitionValues = { project, service, environment }
    } else if (project && environment) {
      partition = 'byProjectEnv'
      partitionValues = { project, environment }
    } else if (project) {
      partition = 'byProject'
      partitionValues = { project }
    } else if (environment) {
      // Cross-project query by environment (for auditing/compliance)
      partition = 'byEnvironment'
      partitionValues = { environment }
    }

    const listOptions: any = {}
    if (partition && partitionValues) {
      listOptions.partition = partition
      listOptions.partitionValues = partitionValues
    }
    if (limit) listOptions.limit = limit
    if (offset) listOptions.offset = offset

    const results = await this.resource.list(listOptions)

    // Decrypt values if in asymmetric mode
    return results.map((item: EnvVar) => ({
      ...item,
      value: this.decryptValue(item.value)
    }))
  }

  /**
   * Bulk insert environment variables
   */
  async insertMany(inputs: EnvVarInput[]): Promise<EnvVar[]> {
    this.ensureConnected()

    const results: EnvVar[] = []
    for (const input of inputs) {
      const result = await this.set(input)
      results.push(result)
    }
    return results
  }

  /**
   * Delete all variables for a project/environment
   */
  async deleteAll(
    project: string,
    environment: Environment,
    service?: string
  ): Promise<number> {
    this.ensureConnected()

    const vars = await this.list({ project, environment, service })
    let deleted = 0

    for (const v of vars) {
      await this.resource.delete(v.id)
      deleted++
    }

    return deleted
  }

  /**
   * Export variables to a Record<string, string>
   */
  async export(
    project: string,
    environment: Environment,
    service?: string
  ): Promise<Record<string, string>> {
    const vars = await this.list({ project, environment, service })
    const result: Record<string, string> = {}

    for (const v of vars) {
      result[v.key] = v.value
    }

    return result
  }

  /**
   * Sync variables from a Record<string, string>
   * Returns sync statistics
   * Optionally deletes remote keys that are missing from input
   */
  async sync(
    vars: Record<string, string>,
    project: string,
    environment: Environment,
    service?: string,
    options: { source?: 'manual' | 'sync' | 'import'; deleteMissing?: boolean } = {}
  ): Promise<SyncResult> {
    this.ensureConnected()

    const existing = await this.list({ project, environment, service })
    const existingMap = new Map(existing.map(v => [v.key, v]))
    const deleteMissing = options.deleteMissing ?? false

    const result: SyncResult = {
      added: [],
      updated: [],
      deleted: [],
      unchanged: [],
      conflicts: []
    }

    // Process new/updated vars
    for (const [key, value] of Object.entries(vars)) {
      const existingVar = existingMap.get(key)

      if (!existingVar) {
        // New variable
        await this.set({
          key,
          value,
          project,
          environment,
          service,
          metadata: { source: options.source || 'sync' }
        })
        result.added.push(key)
      } else if (existingVar.value !== value) {
        // Updated variable
        await this.set({
          key,
          value,
          project,
          environment,
          service,
          metadata: { source: options.source || 'sync' }
        })
        result.updated.push(key)
      } else {
        // Unchanged
        result.unchanged.push(key)
      }

      existingMap.delete(key)
    }

    // Remaining are deleted (not in new vars)
    if (deleteMissing) {
      for (const [key, existingVar] of existingMap) {
        await this.resource.delete(existingVar.id)
        result.deleted.push(key)
      }
    }

    return result
  }

  /**
   * Close the connection
   */
  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.disconnect()
      this.db = null
      this.resource = null
      this.initialized = false
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.initialized
  }

  /**
   * Get the active connection string (the one that succeeded)
   */
  getConnectionString(): string {
    return this.activeConnectionString || this.connectionStrings[0]
  }

  /**
   * Get all configured connection strings
   */
  getConnectionStrings(): string[] {
    return this.connectionStrings
  }

  /**
   * Get the current encryption mode
   */
  getEncryptionMode(): 'symmetric' | 'asymmetric' {
    return this.encryptionMode
  }

  /**
   * Get the asymmetric algorithm (only relevant in asymmetric mode)
   */
  getAsymmetricAlgorithm(): AsymmetricAlgorithm {
    return this.asymmetricAlgorithm
  }
}

// Factory function for creating clients
export function createClient(options?: VaulterClientOptions): VaulterClient {
  return new VaulterClient(options)
}

// Default export
export default VaulterClient
