/**
 * Vaulter Client - s3db.js wrapper for environment variable storage
 *
 * Supports two encryption modes:
 * - symmetric (default): Uses s3db.js built-in AES-256-GCM encryption via passphrase
 * - asymmetric: Uses RSA/EC hybrid encryption (public key encrypts, private key decrypts)
 */

import { S3db, TasksPool } from 's3db.js/lite'
import os from 'node:os'
import { Writable } from 'node:stream'
import type {
  EnvVar,
  EnvVarInput,
  Environment,
  ListOptions,
  VaulterClientOptions,
  SyncResult,
  BatchResult,
  BatchOptions,
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

    // Asymmetric mode requires hybrid-encrypted payloads
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('Cannot decrypt: value is not hybrid-encrypted JSON')
    }

    if (!isHybridEncrypted(parsed)) {
      throw new Error('Cannot decrypt: value is not hybrid-encrypted')
    }

    if (!this.privateKey) {
      throw new Error('Cannot decrypt: private key not configured')
    }

    return hybridDecrypt(parsed, this.privateKey)
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

        // Cast to any to bypass incomplete s3db.js types
        // idGenerator, partitions, asyncPartitions are valid runtime options
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
              source: { type: 'string', enum: ['manual', 'sync', 'import', 'rotation'], optional: true }
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
        } as any)

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
   * NOTE: Partitions are currently DISABLED due to s3db.js bug where partition
   * indices get out of sync with actual data. Once fixed, partitions can be
   * re-enabled for O(1) performance instead of O(n) scan + filter.
   *
   * Previously would use:
   * - project + service + environment → byProjectServiceEnv
   * - project + environment → byProjectEnv
   * - project only → byProject
   * - environment only → byEnvironment (cross-project, for auditing)
   */
  async list(options: ListOptions = {}): Promise<EnvVar[]> {
    this.ensureConnected()

    const { project, service, environment, limit, offset } = options

    // WORKAROUND: Partition indices are broken in s3db.js (asyncPartitions bug?)
    // They return fewer results than actually exist.
    // For now, we do a full scan and filter manually.
    // TODO: Re-enable partitions when s3db.js fixes the bug
    //
    // Original partition logic (disabled):
    // if (project && service && environment) {
    //   partition = 'byProjectServiceEnv'
    //   partitionValues = { project, service, environment }
    // } else if (project && environment) {
    //   partition = 'byProjectEnv'
    //   partitionValues = { project, environment }
    // } ...

    const listOptions: any = {}
    if (limit) listOptions.limit = limit
    if (offset) listOptions.offset = offset

    let results = await this.resource.list(listOptions)

    // Manual filtering (workaround for partition bug)
    if (project) {
      results = results.filter((item: EnvVar) => item.project === project)
    }
    if (service !== undefined) {
      // service can be empty string for "no service" or '__shared__' for shared
      results = results.filter((item: EnvVar) => (item.service || '') === service)
    }
    if (environment) {
      results = results.filter((item: EnvVar) => item.environment === environment)
    }

    // Decrypt values if in asymmetric mode
    return results.map((item: EnvVar) => ({
      ...item,
      value: this.decryptValue(item.value)
    }))
  }

  /**
   * Set multiple environment variables efficiently using s3db.js TasksPool
   *
   * Uses replace() for single PUT operation per variable (no get/exists checks)
   * and TasksPool.map() for intelligent concurrency control with:
   * - Auto-tuning concurrency based on latency
   * - Retry with exponential backoff
   * - Rate limiting and throttling protection
   *
   * Performance comparison (per variable):
   * - Old approach: getOrNull (GET) + update (HEAD + GET + PUT) = 4 S3 ops
   * - New approach: replace (PUT only) = 1 S3 op
   *
   * @param inputs - Array of environment variables to set
   * @param options - Optional settings
   * @param options.preserveMetadata - If true, uses slower get+update to preserve existing metadata (default: false)
   * @param options.concurrency - Max concurrent operations (default: 10)
   */
  async setMany(
    inputs: EnvVarInput[],
    options: { preserveMetadata?: boolean; concurrency?: number } = {}
  ): Promise<EnvVar[]> {
    this.ensureConnected()

    if (inputs.length === 0) return []

    const { preserveMetadata = false, concurrency = 10 } = options

    // Fast path: use replace() with TasksPool for intelligent concurrency
    if (!preserveMetadata) {
      const { results, errors } = await TasksPool.map(
        inputs,
        async (input) => {
          const id = generateVarId(input.project, input.environment, input.service, input.key)
          const encryptedValue = this.encryptValue(input.value)

          // replace() does only 1 PUT operation - no get/exists checks
          const result = await this.resource.replace(id, {
            key: input.key,
            value: encryptedValue,
            project: input.project,
            environment: input.environment,
            service: input.service,
            tags: input.tags,
            metadata: {
              ...input.metadata,
              source: input.metadata?.source || 'manual'
            }
          })
          return { ...result, value: input.value } as EnvVar
        },
        { concurrency }
      )

      if (errors.length > 0) {
        const errorMsg = errors.map(e => `${e.item.key}: ${e.error.message}`).join(', ')
        throw new Error(`Failed to set some variables: ${errorMsg}`)
      }

      return results
    }

    // Slow path: preserve existing metadata (uses get + update)
    const { results, errors } = await TasksPool.map(
      inputs,
      async (input) => {
        const id = generateVarId(input.project, input.environment, input.service, input.key)
        const encryptedValue = this.encryptValue(input.value)

        // Use getOrNull - returns null if not found (no exception)
        const existing = await this.resource.getOrNull(id)

        if (existing) {
          // Update existing - merges metadata
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
      },
      { concurrency }
    )

    if (errors.length > 0) {
      const errorMsg = errors.map(e => `${e.item.key}: ${e.error.message}`).join(', ')
      throw new Error(`Failed to set some variables: ${errorMsg}`)
    }

    return results
  }

  /**
   * Set multiple environment variables with controlled concurrency using TasksPool
   *
   * Uses s3db.js TasksPool for intelligent concurrency control with:
   * - Auto-tuning based on latency
   * - Retry with exponential backoff
   * - Progress callbacks
   *
   * Performance: Uses replace() by default (1 PUT per var) instead of
   * get+update (4 S3 ops per var). Set preserveMetadata=true for merge behavior.
   *
   * @param inputs - Array of environment variables to set
   * @param options - Batch options (concurrency, error handling, progress)
   * @returns BatchResult with success/failure details
   *
   * @example
   * ```ts
   * const result = await client.setManyChunked(vars, {
   *   concurrency: 5,
   *   onProgress: ({ completed, total, percentage }) => {
   *     console.log(`${percentage}% complete (${completed}/${total})`)
   *   }
   * })
   * ```
   */
  async setManyChunked(
    inputs: EnvVarInput[],
    options: BatchOptions = {}
  ): Promise<BatchResult> {
    this.ensureConnected()

    const startTime = Date.now()
    const { concurrency = 10, continueOnError = true, preserveMetadata = false, onProgress } = options

    const result: BatchResult = {
      success: [],
      failed: [],
      total: inputs.length,
      durationMs: 0
    }

    if (inputs.length === 0) {
      result.durationMs = Date.now() - startTime
      return result
    }

    let completed = 0

    const { errors } = await TasksPool.map(
      inputs,
      async (input) => {
        const id = generateVarId(input.project, input.environment, input.service, input.key)
        const encryptedValue = this.encryptValue(input.value)

        // Fast path: use replace() for single PUT (default)
        if (!preserveMetadata) {
          await this.resource.replace(id, {
            key: input.key,
            value: encryptedValue,
            project: input.project,
            environment: input.environment,
            service: input.service,
            tags: input.tags,
            metadata: {
              ...input.metadata,
              source: input.metadata?.source || 'manual'
            }
          })
          return input.key
        }

        // Slow path: preserve existing metadata
        const existing = await this.resource.getOrNull(id)

        if (existing) {
          const filteredInputMeta = input.metadata
            ? Object.fromEntries(Object.entries(input.metadata).filter(([, v]) => v !== undefined))
            : {}

          await this.resource.update(id, {
            value: encryptedValue,
            tags: input.tags,
            metadata: {
              ...existing.metadata,
              ...filteredInputMeta,
              source: input.metadata?.source || existing.metadata?.source || 'manual'
            }
          })
        } else {
          await this.resource.insert({
            ...input,
            value: encryptedValue,
            metadata: {
              ...input.metadata,
              source: input.metadata?.source || 'manual'
            }
          })
        }

        return input.key
      },
      {
        concurrency,
        onItemComplete: (key, index) => {
          result.success.push(key as string)
          completed++
          if (onProgress) {
            onProgress({
              completed,
              total: inputs.length,
              percentage: Math.round((completed / inputs.length) * 100),
              currentChunk: Math.ceil(completed / concurrency),
              totalChunks: Math.ceil(inputs.length / concurrency)
            })
          }
        },
        onItemError: (error, item, index) => {
          result.failed.push({
            key: item.key,
            error: error.message
          })
          completed++
          if (onProgress) {
            onProgress({
              completed,
              total: inputs.length,
              percentage: Math.round((completed / inputs.length) * 100),
              currentChunk: Math.ceil(completed / concurrency),
              totalChunks: Math.ceil(inputs.length / concurrency)
            })
          }
        }
      }
    )

    result.durationMs = Date.now() - startTime
    return result
  }

  /**
   * Create a writable stream for batch variable operations
   *
   * Uses Node.js streams with backpressure to efficiently process
   * large numbers of variables without memory issues.
   *
   * @param options - Batch options (concurrency for internal buffering)
   * @returns Writable stream that accepts EnvVarInput objects
   *
   * @example
   * ```ts
   * const stream = client.createWriteStream({ concurrency: 10 })
   *
   * stream.on('finish', () => console.log('All done!'))
   * stream.on('error', (err) => console.error('Error:', err))
   *
   * for (const v of variables) {
   *   const canContinue = stream.write(v)
   *   if (!canContinue) {
   *     await once(stream, 'drain')
   *   }
   * }
   *
   * stream.end()
   * ```
   */
  createWriteStream(options: BatchOptions = {}): Writable & { getResult(): BatchResult } {
    this.ensureConnected()

    const client = this
    const { concurrency = 5, continueOnError = true, onProgress } = options
    const startTime = Date.now()

    const result: BatchResult = {
      success: [],
      failed: [],
      total: 0,
      durationMs: 0
    }

    let buffer: EnvVarInput[] = []
    let processing = false
    let totalReceived = 0

    const processBuffer = async (stream: Writable, final = false) => {
      if (processing) return
      if (buffer.length === 0 && !final) return
      if (buffer.length < concurrency && !final) return

      processing = true

      // Take a chunk from buffer
      const chunk = buffer.splice(0, concurrency)

      if (chunk.length === 0) {
        processing = false
        return
      }

      try {
        const chunkResults = await Promise.allSettled(
          chunk.map(async (input) => {
            const id = generateVarId(input.project, input.environment, input.service, input.key)
            const encryptedValue = client.encryptValue(input.value)

            const existing = await client.resource.getOrNull(id)

            if (existing) {
              const filteredInputMeta = input.metadata
                ? Object.fromEntries(Object.entries(input.metadata).filter(([, v]) => v !== undefined))
                : {}

              await client.resource.update(id, {
                value: encryptedValue,
                tags: input.tags,
                metadata: {
                  ...existing.metadata,
                  ...filteredInputMeta,
                  source: input.metadata?.source || existing.metadata?.source || 'manual'
                }
              })
            } else {
              await client.resource.insert({
                ...input,
                value: encryptedValue,
                metadata: {
                  ...input.metadata,
                  source: input.metadata?.source || 'manual'
                }
              })
            }

            return input.key
          })
        )

        // Process results
        for (let i = 0; i < chunkResults.length; i++) {
          const chunkResult = chunkResults[i]
          const input = chunk[i]

          if (chunkResult.status === 'fulfilled') {
            result.success.push(input.key)
          } else {
            result.failed.push({
              key: input.key,
              error: chunkResult.reason?.message || String(chunkResult.reason)
            })

            if (!continueOnError) {
              stream.destroy(new Error(`Failed to set ${input.key}: ${chunkResult.reason?.message}`))
              return
            }
          }
        }

        result.total = result.success.length + result.failed.length

        if (onProgress) {
          onProgress({
            completed: result.total,
            total: totalReceived,
            percentage: totalReceived > 0 ? Math.round((result.total / totalReceived) * 100) : 0,
            currentChunk: Math.ceil(result.total / concurrency),
            totalChunks: Math.ceil(totalReceived / concurrency)
          })
        }
      } finally {
        processing = false
      }

      // Process more if buffer has items
      if (buffer.length >= concurrency || (final && buffer.length > 0)) {
        await processBuffer(stream, final)
      }
    }

    const stream = new Writable({
      objectMode: true,
      highWaterMark: concurrency * 2,

      async write(chunk: EnvVarInput, _encoding, callback) {
        buffer.push(chunk)
        totalReceived++

        try {
          await processBuffer(this)
          callback()
        } catch (err) {
          callback(err as Error)
        }
      },

      async final(callback) {
        try {
          // Process remaining items
          await processBuffer(this, true)
          result.durationMs = Date.now() - startTime
          callback()
        } catch (err) {
          callback(err as Error)
        }
      }
    })

    // Attach result getter
    ;(stream as any).getResult = () => {
      result.durationMs = Date.now() - startTime
      return result
    }

    return stream as Writable & { getResult(): BatchResult }
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
      // deleteMany returns { deleted: number, failed: number }
      const result = await this.resource.deleteMany(ids)

      // s3db.js deleteMany doesn't return which IDs were deleted,
      // just the count. Assume all were deleted if count matches.
      if (result?.deleted === keys.length) {
        return { deleted: [...keys], notFound: [] }
      }

      // If counts don't match, we don't know which failed.
      // Return optimistic result (all as deleted).
      // For precise tracking, use fallback path with existence checks.
      return {
        deleted: [...keys],
        notFound: []
      }
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
    // Cast to any to bypass incomplete s3db.js types
    const nukeResource = await this.db!.createResource({
      name: 'environment-variables',
      paranoid: false, // DANGER: allows deleteAllData
      attributes: {
        key: 'string|required',
        value: 'string|required',
        project: 'string|required',
        environment: 'string|required'
      }
    } as any)

    // Delete everything
    const result = await (nukeResource as any).deleteAllData()

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
