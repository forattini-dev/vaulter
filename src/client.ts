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
 * Encode string to base64url (URL-safe base64, no padding)
 * Uses - and _ instead of + and / to be S3 path safe
 */
function toBase64Url(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Decode base64url back to string
 */
function fromBase64Url(b64: string): string {
  // Restore standard base64 chars and padding
  let str = b64.replace(/-/g, '+').replace(/_/g, '/')
  const pad = str.length % 4
  if (pad) str += '='.repeat(4 - pad)
  return Buffer.from(str, 'base64').toString('utf8')
}

/**
 * Generate a deterministic ID for an environment variable using base64url
 * Input: {project}|{environment}|{service}|{key}
 * Output: URL-safe base64 string (reversible)
 *
 * This allows O(1) lookups by computing the ID directly instead of listing + filtering
 */
export function generateVarId(project: string, environment: string, service: string | undefined, key: string): string {
  const input = `${project}|${environment}|${service || ''}|${key}`
  return toBase64Url(input)
}

/**
 * Parse a deterministic ID back to its components
 */
export function parseVarId(id: string): { project: string; environment: string; service: string | undefined; key: string } | null {
  try {
    const decoded = fromBase64Url(id)
    const parts = decoded.split('|')
    if (parts.length !== 4) return null
    return {
      project: parts[0],
      environment: parts[1],
      service: parts[2] || undefined,
      key: parts[3]
    }
  } catch {
    return null
  }
}

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
          passphrase: this.passphrase,
          logLevel: this.verbose ? 'debug' : 'silent'
        })

        await this.db.connect()

        // Create or get the environment-variables resource
        // In symmetric mode, use 'secret' type for s3db.js auto-encryption
        // In asymmetric mode, use 'string' type as we handle encryption ourselves
        const valueFieldType = this.encryptionMode === 'symmetric' ? 'secret|required' : 'string|required'

        this.resource = await this.db.createResource({
          name: 'environment-variables',

          // Deterministic ID generator for O(1) lookups
          // Format: {project}|{environment}|{service}|{key}
          idGenerator: (data: any) => generateVarId(data.project, data.environment, data.service, data.key),

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
   * Uses deterministic ID for O(1) lookup
   */
  async get(
    key: string,
    project: string,
    environment: Environment,
    service?: string
  ): Promise<EnvVar | null> {
    this.ensureConnected()

    // O(1) lookup using deterministic ID
    const id = generateVarId(project, environment, service, key)

    // Use getOrNull to avoid exception handling for missing keys
    const found = await this.resource.getOrNull(id)

    if (!found) return null

    // Decrypt value if in asymmetric mode
    return {
      ...found,
      value: this.decryptValue(found.value)
    }
  }

  /**
   * Set an environment variable (create or update)
   * Uses deterministic ID for O(1) upsert
   */
  async set(input: EnvVarInput): Promise<EnvVar> {
    this.ensureConnected()

    // Encrypt value if in asymmetric mode
    const encryptedValue = this.encryptValue(input.value)

    // O(1) lookup using deterministic ID
    const id = generateVarId(input.project, input.environment, input.service, input.key)

    // Use getOrNull - returns null if not found (no exception)
    const existing = await this.resource.getOrNull(id)

    if (existing) {
      // Update existing - filter undefined values to preserve existing metadata
      const filteredInputMeta = input.metadata
        ? Object.fromEntries(Object.entries(input.metadata).filter(([, v]) => v !== undefined))
        : {}

      const result = await this.resource.update(id, {
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
      // Create new - pass pre-calculated ID to ensure consistency
      const result = await this.resource.insert({
        id,
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
   * Uses deterministic ID for O(1) deletion
   */
  async delete(
    key: string,
    project: string,
    environment: Environment,
    service?: string
  ): Promise<boolean> {
    this.ensureConnected()

    // O(1) deletion using deterministic ID
    const id = generateVarId(project, environment, service, key)

    try {
      await this.resource.delete(id)
      return true
    } catch (err: any) {
      // Handle "not found" errors gracefully
      if (err?.code === 'NOT_FOUND' || err?.message?.includes('not found')) {
        return false
      }
      throw err
    }
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
   * Bulk insert environment variables (legacy - uses sequential set)
   * @deprecated Use setMany for better performance
   */
  async insertMany(inputs: EnvVarInput[]): Promise<EnvVar[]> {
    return this.setMany(inputs)
  }

  /**
   * Set multiple environment variables efficiently
   * Uses deterministic IDs for O(1) lookups - fully parallel without list queries
   */
  async setMany(inputs: EnvVarInput[]): Promise<EnvVar[]> {
    this.ensureConnected()

    if (inputs.length === 0) return []

    // Process all inputs in parallel using deterministic IDs (no list queries needed!)
    const results = await Promise.all(inputs.map(async (input) => {
      const id = generateVarId(input.project, input.environment, input.service, input.key)
      const encryptedValue = this.encryptValue(input.value)

      // Use getOrNull - returns null if not found (no exception)
      const existing = await this.resource.getOrNull(id)

      if (existing) {
        // Update existing
        const filteredInputMeta = input.metadata
          ? Object.fromEntries(Object.entries(input.metadata).filter(([, v]) => v !== undefined))
          : {}

        const result = await this.resource.update(id, {
          value: encryptedValue,
          tags: input.tags,
          metadata: {
            ...existing.metadata,
            ...filteredInputMeta,
            source: input.metadata?.source || existing.metadata?.source || 'manual'
          }
        })
        return { ...result, value: input.value } as EnvVar
      } else {
        // Insert new
        const result = await this.resource.insert({
          ...input,
          value: encryptedValue,
          metadata: {
            ...input.metadata,
            source: input.metadata?.source || 'manual'
          }
        })
        return { ...result, value: input.value } as EnvVar
      }
    }))

    return results
  }

  /**
   * Get multiple environment variables efficiently
   * Uses deterministic IDs for O(1) parallel lookups
   */
  async getMany(
    keys: string[],
    project: string,
    environment: Environment,
    service?: string
  ): Promise<Map<string, EnvVar | null>> {
    this.ensureConnected()

    // Parallel O(1) lookups using deterministic IDs
    const entries = await Promise.all(
      keys.map(async (key): Promise<[string, EnvVar | null]> => {
        const id = generateVarId(project, environment, service, key)

        // Use getOrNull - returns null if not found (no exception)
        const found = await this.resource.getOrNull(id)

        if (!found) return [key, null]

        // Decrypt value if in asymmetric mode
        return [key, { ...found, value: this.decryptValue(found.value) }]
      })
    )

    return new Map(entries)
  }

  /**
   * Delete multiple environment variables efficiently
   * Uses deterministic IDs for O(1) parallel deletion - no list query needed
   */
  async deleteManyByKeys(
    keys: string[],
    project: string,
    environment: Environment,
    service?: string
  ): Promise<{ deleted: string[], notFound: string[] }> {
    this.ensureConnected()

    // Compute deterministic IDs directly - no list query needed!
    const ids = keys.map(key => generateVarId(project, environment, service, key))

    // Use native deleteMany if available (s3db.js)
    if (typeof this.resource.deleteMany === 'function') {
      // deleteMany returns which IDs were actually deleted
      const result = await this.resource.deleteMany(ids)
      const deletedIds = new Set(result?.deleted || ids)

      const deleted: string[] = []
      const notFound: string[] = []

      for (let i = 0; i < keys.length; i++) {
        if (deletedIds.has(ids[i])) {
          deleted.push(keys[i])
        } else {
          notFound.push(keys[i])
        }
      }

      return { deleted, notFound }
    } else {
      // Fallback to parallel deletes with individual existence checks
      const results = await Promise.all(
        keys.map(async (key, i) => {
          try {
            await this.resource.delete(ids[i])
            return { key, deleted: true }
          } catch (err: any) {
            if (err?.code === 'NOT_FOUND' || err?.message?.includes('not found')) {
              return { key, deleted: false }
            }
            throw err
          }
        })
      )

      const deleted = results.filter(r => r.deleted).map(r => r.key)
      const notFound = results.filter(r => !r.deleted).map(r => r.key)

      return { deleted, notFound }
    }
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
   *
   * When a service is specified, shared variables (__shared__) are automatically
   * included and merged, with service-specific values taking precedence.
   *
   * @param project - Project name
   * @param environment - Environment name
   * @param service - Service name (optional)
   * @param options - Export options
   * @param options.includeShared - Include shared vars when service is specified (default: true)
   */
  async export(
    project: string,
    environment: Environment,
    service?: string,
    options: { includeShared?: boolean } = {}
  ): Promise<Record<string, string>> {
    const { includeShared = true } = options
    const result: Record<string, string> = {}

    // If service is specified and includeShared is true, merge shared vars first
    // Service-specific vars will override shared vars (inheritance)
    if (service && service !== '__shared__' && includeShared) {
      const sharedVars = await this.list({ project, environment, service: '__shared__' })
      for (const v of sharedVars) {
        result[v.key] = v.value
      }
    }

    // Get service-specific vars (or all vars if no service)
    const vars = await this.list({ project, environment, service })
    for (const v of vars) {
      result[v.key] = v.value // Overrides shared if same key
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
   * DANGER: Nuke all data from the remote storage
   *
   * This deletes EVERYTHING: data, partitions, metadata, historical versions.
   * This operation is IRREVERSIBLE.
   *
   * Safety: Requires explicit confirmation token that matches project name.
   *
   * @param confirmToken - Must exactly match the project name to proceed
   * @returns Number of objects deleted
   */
  async nukeAllData(confirmToken: string): Promise<{ deletedCount: number; project: string }> {
    this.ensureConnected()

    // Get project name from the stored resource config
    // We need to list at least one var to know the project, or use a preview first
    const vars = await this.resource.list({ limit: 1 })
    const project = vars.length > 0 ? vars[0].project : null

    if (!project) {
      // No data to delete
      return { deletedCount: 0, project: confirmToken }
    }

    // Safety check: token must match project name
    if (confirmToken !== project) {
      throw new Error(
        `Safety check failed: confirmation token "${confirmToken}" does not match project "${project}". ` +
        `To delete all data, pass the exact project name as confirmation.`
      )
    }

    // Create a new resource with paranoid: false to allow deletion
    // We need to access the underlying s3db database
    const nukeResource = await this.db!.createResource({
      name: 'environment-variables',
      paranoid: false, // DANGER: allows deleteAllData
      attributes: {
        key: 'string|required',
        value: 'string|required',
        project: 'string|required',
        environment: 'string|required'
      }
    })

    // Delete everything
    const result = await nukeResource.deleteAllData()

    return {
      deletedCount: result.deletedCount,
      project
    }
  }

  /**
   * Preview what would be deleted by nukeAllData
   *
   * @returns Summary of data that would be deleted
   */
  async nukePreview(): Promise<{
    project: string | null
    environments: string[]
    services: string[]
    totalVars: number
    sampleVars: Array<{ key: string; environment: string; service?: string }>
  }> {
    this.ensureConnected()

    const vars = await this.resource.list({ limit: 100 })

    if (vars.length === 0) {
      return {
        project: null,
        environments: [],
        services: [],
        totalVars: 0,
        sampleVars: []
      }
    }

    const project = vars[0].project
    const environments = [...new Set(vars.map((v: any) => v.environment))] as string[]
    const services = [...new Set(vars.filter((v: any) => v.service).map((v: any) => v.service))] as string[]

    // Get total count (may be more than 100)
    const allVars = await this.resource.list({})
    const totalVars = allVars.length

    return {
      project,
      environments,
      services,
      totalVars,
      sampleVars: vars.slice(0, 10).map((v: any) => ({
        key: v.key,
        environment: v.environment,
        service: v.service
      }))
    }
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
