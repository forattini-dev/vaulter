/**
 * Type declarations for s3db.js
 */

declare module 's3db.js' {
  export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'

  export interface S3dbOptions {
    connectionString: string
    passphrase?: string
    logLevel?: LogLevel
  }

  export interface ResourceSchema {
    name: string
    attributes: Record<string, any>
    partitions?: Record<string, { fields: Record<string, string> }>
    behavior?: string
    timestamps?: boolean
    asyncPartitions?: boolean
  }

  export interface ListOptions {
    partition?: string
    partitionValues?: Record<string, string>
    limit?: number
    offset?: number
  }

  export interface Resource {
    insert(data: Record<string, any>): Promise<any>
    get(id: string): Promise<any>
    update(id: string, data: Record<string, any>): Promise<any>
    delete(id: string): Promise<void>
    list(options?: ListOptions): Promise<any[]>
  }

  export class S3db {
    constructor(options: S3dbOptions)
    connect(): Promise<void>
    disconnect(): Promise<void>
    createResource(schema: ResourceSchema): Promise<Resource>
  }
}
