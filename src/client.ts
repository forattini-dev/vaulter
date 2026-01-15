/**
 * MiniEnv Client - s3db.js wrapper for environment variable storage
 */

import { S3db } from 's3db.js'
import type {
  EnvVar,
  EnvVarInput,
  Environment,
  ListOptions,
  MiniEnvClientOptions,
  SyncResult
} from './types.js'

// Default connection string for local development (FileSystem backend)
const DEFAULT_CONNECTION_STRING = `file://${process.env.HOME || '/tmp'}/.minienv/store`
const DEFAULT_PASSPHRASE = 'minienv-default-dev-key'

/**
 * MiniEnv Client
 *
 * Provides a high-level API for managing environment variables
 * using s3db.js as the storage backend.
 */
export class MiniEnvClient {
  private db: S3db | null = null
  private resource: any = null
  private connectionStrings: string[]
  private activeConnectionString: string | null = null
  private passphrase: string
  private initialized = false
  private verbose: boolean

  constructor(options: MiniEnvClientOptions = {}) {
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
          console.error(`[minienv] Trying backend: ${this.maskCredentials(connectionString)}`)
        }

        this.db = new S3db({
          connectionString,
          passphrase: this.passphrase
        })

        await this.db.connect()

        // Create or get the environment-variables resource
        this.resource = await this.db.createResource({
          name: 'environment-variables',

          attributes: {
            key: 'string|required',
            value: 'secret|required', // Auto-encrypted with AES-256-GCM
            project: 'string|required',
            service: 'string|optional',
            environment: 'enum:dev,stg,prd,sbx,dr|required',
            tags: 'array|items:string|optional',
            metadata: {
              description: 'string|optional',
              owner: 'string|optional',
              rotateAfter: 'date|optional',
              source: 'enum:manual,sync,import|optional'
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
            }
          },

          behavior: 'body-overflow', // Handle large values
          timestamps: true,
          asyncPartitions: true // Faster writes
        })

        // Success! Store the active connection string
        this.activeConnectionString = connectionString
        this.initialized = true

        if (this.verbose) {
          console.error(`[minienv] Connected to: ${this.maskCredentials(connectionString)}`)
        }

        return // Exit on first successful connection

      } catch (err) {
        errors.push({ url: connectionString, error: err as Error })

        if (this.verbose) {
          console.error(`[minienv] Failed to connect to ${this.maskCredentials(connectionString)}: ${(err as Error).message}`)
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
      throw new Error('MiniEnvClient not initialized. Call connect() first.')
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
    return found || null
  }

  /**
   * Set an environment variable (create or update)
   */
  async set(input: EnvVarInput): Promise<EnvVar> {
    this.ensureConnected()

    const existing = await this.get(
      input.key,
      input.project,
      input.environment,
      input.service
    )

    if (existing) {
      // Update existing
      return await this.resource.update(existing.id, {
        value: input.value,
        tags: input.tags,
        metadata: {
          ...existing.metadata,
          ...input.metadata,
          source: input.metadata?.source || 'manual'
        }
      })
    } else {
      // Create new
      return await this.resource.insert({
        ...input,
        metadata: {
          ...input.metadata,
          source: input.metadata?.source || 'manual'
        }
      })
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
    }

    const listOptions: any = {}
    if (partition && partitionValues) {
      listOptions.partition = partition
      listOptions.partitionValues = partitionValues
    }
    if (limit) listOptions.limit = limit
    if (offset) listOptions.offset = offset

    return await this.resource.list(listOptions)
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
   */
  async sync(
    vars: Record<string, string>,
    project: string,
    environment: Environment,
    service?: string,
    options: { source?: 'manual' | 'sync' | 'import' } = {}
  ): Promise<SyncResult> {
    this.ensureConnected()

    const existing = await this.list({ project, environment, service })
    const existingMap = new Map(existing.map(v => [v.key, v]))

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
    for (const [key] of existingMap) {
      result.deleted.push(key)
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
}

// Factory function for creating clients
export function createClient(options?: MiniEnvClientOptions): MiniEnvClient {
  return new MiniEnvClient(options)
}

// Default export
export default MiniEnvClient
