/**
 * Tests for client.ts
 * Uses mocks for s3db.js to test client logic
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Use vi.hoisted() to make mocks available before vi.mock runs
const { mockResource, mockDb, TasksPool } = vi.hoisted(() => {
  const mockResource = {
    insert: vi.fn(),
    update: vi.fn(),
    replace: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    getOrNull: vi.fn()
  }

  const mockDb = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    createResource: vi.fn()
  }

  // TasksPool.map() - simplified version for testing
  const TasksPool = {
    map: async (
      items: any[],
      processor: (item: any, index: number) => Promise<any>,
      options: {
        concurrency?: number
        onItemComplete?: (result: any, index: number) => void
        onItemError?: (error: Error, item: any, index: number) => void
      } = {}
    ): Promise<{ results: any[]; errors: Array<{ error: Error; item: any; index: number }> }> => {
      const results: any[] = []
      const errors: Array<{ error: Error; item: any; index: number }> = []

      for (let i = 0; i < items.length; i++) {
        try {
          const result = await processor(items[i], i)
          results.push(result)
          if (options.onItemComplete) {
            options.onItemComplete(result, i)
          }
        } catch (err) {
          errors.push({ error: err as Error, item: items[i], index: i })
          if (options.onItemError) {
            options.onItemError(err as Error, items[i], i)
          }
        }
      }

      return { results, errors }
    }
  }

  return { mockResource, mockDb, TasksPool }
})

// Mock s3db.js/lite before importing client
vi.mock('s3db.js/lite', () => {
  return {
    S3db: function(config: any) {
      (this as any).config = config
      ;(this as any).connect = mockDb.connect
      ;(this as any).disconnect = mockDb.disconnect
      ;(this as any).createResource = mockDb.createResource
    },
    TasksPool
  }
})

import { VaulterClient, createClient, generateVarId } from '../src/client.js'

describe('VaulterClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock implementations
    mockDb.connect.mockResolvedValue(undefined)
    mockDb.disconnect.mockResolvedValue(undefined)
    mockDb.createResource.mockResolvedValue(mockResource)
    mockResource.list.mockResolvedValue([])
    mockResource.get.mockResolvedValue(null) // Default: not found
    mockResource.getOrNull.mockResolvedValue(null) // Default: not found (returns null, no exception)
    mockResource.insert.mockImplementation(async (data: any) => ({
      id: 'test-id-' + Date.now(),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
    mockResource.update.mockImplementation(async (id: string, data: any) => ({
      id,
      ...data
    }))
    mockResource.replace.mockImplementation(async (id: string, data: any) => ({
      id,
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
    mockResource.delete.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should create client with single connectionString', () => {
      const c = new VaulterClient({
        connectionString: 'memory://bucket1'
      })
      expect(c.getConnectionStrings()).toEqual(['memory://bucket1'])
    })

    it('should create client with multiple connectionStrings', () => {
      const c = new VaulterClient({
        connectionStrings: ['memory://bucket1', 'memory://bucket2']
      })
      expect(c.getConnectionStrings()).toEqual(['memory://bucket1', 'memory://bucket2'])
    })

    it('should use default connectionString when none provided', () => {
      const c = new VaulterClient()
      const strings = c.getConnectionStrings()
      expect(strings.length).toBe(1)
      expect(strings[0]).toContain('.vaulter/store')
    })
  })

  describe('connect/disconnect', () => {
    it('should connect successfully', async () => {
      const c = new VaulterClient({
        connectionString: 'memory://test'
      })
      await c.connect()
      expect(c.isConnected()).toBe(true)
      expect(mockDb.connect).toHaveBeenCalled()
    })

    it('should not reconnect if already connected', async () => {
      const c = new VaulterClient({
        connectionString: 'memory://test'
      })
      await c.connect()
      await c.connect() // Second connect should be no-op
      expect(mockDb.connect).toHaveBeenCalledTimes(1)
    })

    it('should disconnect properly', async () => {
      const c = new VaulterClient({
        connectionString: 'memory://test'
      })
      await c.connect()
      expect(c.isConnected()).toBe(true)
      await c.disconnect()
      expect(c.isConnected()).toBe(false)
      expect(mockDb.disconnect).toHaveBeenCalled()
    })

    it('should throw when all backends fail', async () => {
      mockDb.connect.mockRejectedValue(new Error('Connection failed'))

      const c = new VaulterClient({
        connectionStrings: [
          'invalid://not-a-real-protocol',
          'also-invalid://nope'
        ]
      })
      await expect(c.connect()).rejects.toThrow(/failed to connect/i)
    })

    it('should try fallback backends', async () => {
      let callCount = 0
      mockDb.connect.mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          throw new Error('First backend failed')
        }
        // Second call succeeds
      })

      const c = new VaulterClient({
        connectionStrings: [
          'invalid://will-fail',
          'memory://will-succeed'
        ],
        verbose: false
      })
      await c.connect()
      expect(c.isConnected()).toBe(true)
      expect(c.getConnectionString()).toBe('memory://will-succeed')
    })

    it('should store active connection string', async () => {
      const c = new VaulterClient({
        connectionString: 'memory://my-bucket'
      })
      await c.connect()
      expect(c.getConnectionString()).toBe('memory://my-bucket')
    })
  })

  describe('set', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({
        connectionString: 'memory://test-bucket'
      })
      await client.connect()
    })

    it('should set a new variable', async () => {
      mockResource.list.mockResolvedValue([])

      const result = await client.set({
        key: 'DATABASE_URL',
        value: 'postgres://localhost/testdb',
        project: 'test-project',
        environment: 'dev'
      })

      expect(mockResource.insert).toHaveBeenCalledWith(expect.objectContaining({
        key: 'DATABASE_URL',
        value: 'postgres://localhost/testdb',
        project: 'test-project',
        environment: 'dev'
      }))
      expect(result.key).toBe('DATABASE_URL')
    })

    it('should update existing variable', async () => {
      const expectedId = generateVarId('test-project', 'dev', undefined, 'API_KEY')
      const existingVar = {
        id: expectedId,
        key: 'API_KEY',
        value: 'original-value',
        project: 'test-project',
        environment: 'dev',
        metadata: {}
      }
      // Now uses resource.getOrNull with deterministic ID instead of list
      mockResource.getOrNull.mockResolvedValue(existingVar)
      mockResource.update.mockResolvedValue({
        ...existingVar,
        value: 'updated-value'
      })

      const updated = await client.set({
        key: 'API_KEY',
        value: 'updated-value',
        project: 'test-project',
        environment: 'dev'
      })

      expect(mockResource.update).toHaveBeenCalledWith(expectedId, expect.objectContaining({
        value: 'updated-value'
      }))
      expect(updated.value).toBe('updated-value')
    })

    it('should set variable with service', async () => {
      mockResource.list.mockResolvedValue([])

      const result = await client.set({
        key: 'SERVICE_KEY',
        value: 'service-value',
        project: 'test-project',
        service: 'api',
        environment: 'dev'
      })

      expect(mockResource.insert).toHaveBeenCalledWith(expect.objectContaining({
        service: 'api'
      }))
      expect(result.service).toBe('api')
    })

    it('should set variable with metadata', async () => {
      mockResource.list.mockResolvedValue([])

      await client.set({
        key: 'METADATA_KEY',
        value: 'value',
        project: 'test-project',
        environment: 'dev',
        metadata: {
          description: 'Test key',
          owner: 'test-user'
        }
      })

      expect(mockResource.insert).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({
          description: 'Test key',
          owner: 'test-user'
        })
      }))
    })

    it('should throw when not connected', async () => {
      const c = new VaulterClient({ connectionString: 'memory://test' })
      await expect(c.set({
        key: 'KEY',
        value: 'value',
        project: 'project',
        environment: 'dev'
      })).rejects.toThrow(/not initialized/i)
    })
  })

  describe('get', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({
        connectionString: 'memory://test-bucket'
      })
      await client.connect()
    })

    it('should get existing variable', async () => {
      const expectedId = generateVarId('test-project', 'dev', undefined, 'EXISTING_KEY')
      const existingVar = {
        id: expectedId,
        key: 'EXISTING_KEY',
        value: 'existing-value',
        project: 'test-project',
        environment: 'dev'
      }
      // Now uses resource.getOrNull with deterministic ID instead of list
      mockResource.getOrNull.mockResolvedValue(existingVar)

      const result = await client.get('EXISTING_KEY', 'test-project', 'dev')
      expect(result).not.toBeNull()
      expect(result!.key).toBe('EXISTING_KEY')
      expect(result!.value).toBe('existing-value')
      expect(mockResource.getOrNull).toHaveBeenCalledWith(expectedId)
    })

    it('should return null for non-existent variable', async () => {
      mockResource.list.mockResolvedValue([])

      const result = await client.get('NON_EXISTENT', 'test-project', 'dev')
      expect(result).toBeNull()
    })

    it('should get variable with service filter', async () => {
      const expectedId = generateVarId('test-project', 'dev', 'api', 'SERVICE_KEY')
      const serviceVar = {
        id: expectedId,
        key: 'SERVICE_KEY',
        value: 'service-value',
        project: 'test-project',
        service: 'api',
        environment: 'dev'
      }
      // Now uses resource.getOrNull with deterministic ID including service
      mockResource.getOrNull.mockResolvedValue(serviceVar)

      const result = await client.get('SERVICE_KEY', 'test-project', 'dev', 'api')
      expect(result).not.toBeNull()
      expect(result!.service).toBe('api')
      expect(mockResource.getOrNull).toHaveBeenCalledWith(expectedId)
    })
  })

  describe('delete', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({
        connectionString: 'memory://test-bucket'
      })
      await client.connect()
    })

    it('should delete existing variable', async () => {
      // With deterministic IDs, delete uses the computed ID directly
      // Successful delete just resolves without error
      mockResource.delete.mockResolvedValue(undefined)
      const expectedId = generateVarId('test-project', 'dev', undefined, 'TO_DELETE')

      const result = await client.delete('TO_DELETE', 'test-project', 'dev')
      expect(result).toBe(true)
      expect(mockResource.delete).toHaveBeenCalledWith(expectedId)
    })

    it('should return false for non-existent variable', async () => {
      // Delete throws NOT_FOUND error when ID doesn't exist
      mockResource.delete.mockRejectedValue({ code: 'NOT_FOUND', message: 'not found' })

      const result = await client.delete('NON_EXISTENT', 'test-project', 'dev')
      expect(result).toBe(false)
    })
  })

  describe('list', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({
        connectionString: 'memory://test-bucket'
      })
      await client.connect()
    })

    it('should list all variables for project+environment', async () => {
      // Mock returns all data; filtering is done in-memory (partition workaround)
      const vars = [
        { id: '1', key: 'VAR_1', value: 'value1', project: 'test-project', environment: 'dev' },
        { id: '2', key: 'VAR_2', value: 'value2', project: 'test-project', environment: 'dev' },
        { id: '3', key: 'VAR_3', value: 'value3', project: 'other-project', environment: 'dev' },
        { id: '4', key: 'VAR_4', value: 'value4', project: 'test-project', environment: 'prd' }
      ]
      mockResource.list.mockResolvedValue(vars)

      const results = await client.list({
        project: 'test-project',
        environment: 'dev'
      })

      // Should filter to only matching project+environment
      expect(results.length).toBe(2)
      expect(results.every(r => r.project === 'test-project' && r.environment === 'dev')).toBe(true)
      // Partitions are disabled; list is called with empty options
      expect(mockResource.list).toHaveBeenCalledWith({})
    })

    it('should list all variables for project', async () => {
      // Mock returns all data; filtering is done in-memory (partition workaround)
      const vars = [
        { id: '1', key: 'VAR_1', value: 'value1', project: 'test-project', environment: 'dev' },
        { id: '2', key: 'VAR_2', value: 'value2', project: 'test-project', environment: 'dev' },
        { id: '3', key: 'VAR_3', value: 'value3', project: 'test-project', environment: 'prd' },
        { id: '4', key: 'VAR_4', value: 'value4', project: 'other-project', environment: 'dev' }
      ]
      mockResource.list.mockResolvedValue(vars)

      const results = await client.list({
        project: 'test-project'
      })

      // Should filter to only matching project
      expect(results.length).toBe(3)
      expect(results.every(r => r.project === 'test-project')).toBe(true)
      // Partitions are disabled; list is called with empty options
      expect(mockResource.list).toHaveBeenCalledWith({})
    })

    it('should return empty array for non-existent project', async () => {
      mockResource.list.mockResolvedValue([])

      const results = await client.list({
        project: 'non-existent'
      })

      expect(results).toEqual([])
    })

    it('should pass limit and offset options', async () => {
      mockResource.list.mockResolvedValue([])

      await client.list({
        project: 'test-project',
        limit: 10,
        offset: 5
      })

      expect(mockResource.list).toHaveBeenCalledWith(expect.objectContaining({
        limit: 10,
        offset: 5
      }))
    })

    it('should list variables for project+service+environment', async () => {
      // Mock returns all data; filtering is done in-memory (partition workaround)
      const vars = [
        { id: '1', key: 'VAR_1', value: 'value1', project: 'test-project', service: 'api', environment: 'dev' },
        { id: '2', key: 'VAR_2', value: 'value2', project: 'test-project', service: 'web', environment: 'dev' },
        { id: '3', key: 'VAR_3', value: 'value3', project: 'test-project', service: 'api', environment: 'prd' }
      ]
      mockResource.list.mockResolvedValue(vars)

      const results = await client.list({
        project: 'test-project',
        service: 'api',
        environment: 'dev'
      })

      // Should filter to only matching project+service+environment
      expect(results.length).toBe(1)
      expect(results[0].key).toBe('VAR_1')
      // Partitions are disabled; list is called with empty options
      expect(mockResource.list).toHaveBeenCalledWith({})
    })

    it('should list variables by environment only (cross-project)', async () => {
      // Mock returns all data; filtering is done in-memory (partition workaround)
      const vars = [
        { id: '1', key: 'VAR_1', value: 'value1', project: 'project-a', environment: 'prd' },
        { id: '2', key: 'VAR_2', value: 'value2', project: 'project-b', environment: 'prd' },
        { id: '3', key: 'VAR_3', value: 'value3', project: 'project-a', environment: 'dev' }
      ]
      mockResource.list.mockResolvedValue(vars)

      const results = await client.list({
        environment: 'prd'
      })

      // Should filter to only matching environment across all projects
      expect(results.length).toBe(2)
      expect(results.every(r => r.environment === 'prd')).toBe(true)
      // Partitions are disabled; list is called with empty options
      expect(mockResource.list).toHaveBeenCalledWith({})
    })

    it('should list all variables without filters', async () => {
      const vars = [
        { id: '1', key: 'VAR_1', value: 'value1', project: 'project-a', environment: 'dev' },
        { id: '2', key: 'VAR_2', value: 'value2', project: 'project-b', environment: 'prd' }
      ]
      mockResource.list.mockResolvedValue(vars)

      const results = await client.list({})

      expect(results.length).toBe(2)
      // Should call list without partition when no filters provided
      expect(mockResource.list).toHaveBeenCalledWith({})
    })
  })

  describe('export', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({
        connectionString: 'memory://test-bucket'
      })
      await client.connect()
    })

    it('should export variables as Record', async () => {
      const vars = [
        { id: '1', key: 'EXPORT_VAR_1', value: 'export-value-1', project: 'test-project', environment: 'dev' },
        { id: '2', key: 'EXPORT_VAR_2', value: 'export-value-2', project: 'test-project', environment: 'dev' }
      ]
      mockResource.list.mockResolvedValue(vars)

      const result = await client.export('test-project', 'dev')

      expect(result).toEqual({
        EXPORT_VAR_1: 'export-value-1',
        EXPORT_VAR_2: 'export-value-2'
      })
    })

    it('should return empty object for non-existent environment', async () => {
      mockResource.list.mockResolvedValue([])

      const result = await client.export('test-project', 'prd')
      expect(result).toEqual({})
    })
  })

  describe('sync', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({
        connectionString: 'memory://test-bucket'
      })
      await client.connect()
    })

    it('should sync new, updated, and deleted variables', async () => {
      const existing = [
        { id: '1', key: 'EXISTING_1', value: 'old-value-1', project: 'sync-project', environment: 'dev', metadata: {} },
        { id: '2', key: 'EXISTING_2', value: 'unchanged-value', project: 'sync-project', environment: 'dev', metadata: {} },
        { id: '3', key: 'TO_DELETE', value: 'will-be-deleted', project: 'sync-project', environment: 'dev', metadata: {} }
      ]
      mockResource.list.mockResolvedValue(existing)

      const newVars = {
        EXISTING_1: 'new-value-1',    // Updated
        EXISTING_2: 'unchanged-value', // Unchanged
        NEW_VAR: 'brand-new'          // Added
        // TO_DELETE not included
      }

      const result = await client.sync(newVars, 'sync-project', 'dev')

      expect(result.added).toContain('NEW_VAR')
      expect(result.updated).toContain('EXISTING_1')
      expect(result.unchanged).toContain('EXISTING_2')
      // By default deleteMissing is false
    })

    it('should delete missing when deleteMissing is true', async () => {
      const existing = [
        { id: '1', key: 'TO_DELETE', value: 'will-be-deleted', project: 'sync-project', environment: 'dev', metadata: {} }
      ]
      mockResource.list.mockResolvedValue(existing)

      const result = await client.sync({}, 'sync-project', 'dev', undefined, { deleteMissing: true })

      expect(result.deleted).toContain('TO_DELETE')
      expect(mockResource.delete).toHaveBeenCalledWith('1')
    })

    it('should set source metadata', async () => {
      mockResource.list.mockResolvedValue([])

      await client.sync(
        { NEW_WITH_SOURCE: 'value' },
        'sync-project',
        'dev',
        undefined,
        { source: 'import' }
      )

      expect(mockResource.insert).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({
          source: 'import'
        })
      }))
    })
  })

  describe('setMany', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({
        connectionString: 'memory://test-bucket'
      })
      await client.connect()
      mockResource.list.mockResolvedValue([])
    })

    it('should insert multiple variables', async () => {
      const inputs = [
        { key: 'BULK_1', value: 'value1', project: 'bulk-project', environment: 'dev' as const },
        { key: 'BULK_2', value: 'value2', project: 'bulk-project', environment: 'dev' as const }
      ]

      const results = await client.setMany(inputs)

      expect(results.length).toBe(2)
      // setMany now uses replace() by default for better performance (1 PUT instead of 4 S3 ops)
      expect(mockResource.replace).toHaveBeenCalledTimes(2)
    })
  })

  describe('deleteAll', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({
        connectionString: 'memory://test-bucket'
      })
      await client.connect()
    })

    it('should delete all variables for project+environment', async () => {
      const vars = [
        { id: '1', key: 'DELETE_ALL_1', value: 'value1', project: 'delete-project', environment: 'dev' },
        { id: '2', key: 'DELETE_ALL_2', value: 'value2', project: 'delete-project', environment: 'dev' }
      ]
      mockResource.list.mockResolvedValue(vars)

      const count = await client.deleteAll('delete-project', 'dev')
      expect(count).toBe(2)
      expect(mockResource.delete).toHaveBeenCalledTimes(2)
    })
  })

  describe('maskCredentials', () => {
    it('should mask credentials in connection strings', async () => {
      let callCount = 0
      mockDb.connect.mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          throw new Error('First failed')
        }
      })

      const c = new VaulterClient({
        connectionStrings: [
          's3://key:secret@bucket',
          'memory://test'
        ],
        verbose: true
      })

      // Capture console.error
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await c.connect()

      // Check that credentials were masked in output
      const calls = errorSpy.mock.calls.map(c => c[0])
      const masked = calls.find(c => typeof c === 'string' && c.includes(':***@'))
      expect(masked).toBeDefined()

      errorSpy.mockRestore()
    })
  })
})

describe('createClient', () => {
  it('should create a VaulterClient instance', () => {
    const client = createClient({
      connectionString: 'memory://test'
    })
    expect(client).toBeInstanceOf(VaulterClient)
  })

  it('should create client with default options', () => {
    const client = createClient()
    expect(client).toBeInstanceOf(VaulterClient)
  })
})

describe('VaulterClient - Additional Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.connect.mockResolvedValue(undefined)
    mockDb.disconnect.mockResolvedValue(undefined)
    mockDb.createResource.mockResolvedValue(mockResource)
    mockResource.list.mockResolvedValue([])
    mockResource.get.mockResolvedValue(null)
    mockResource.getOrNull.mockResolvedValue(null)
    mockResource.insert.mockImplementation(async (data: any) => ({
      id: 'test-id-' + Date.now(),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
    mockResource.update.mockImplementation(async (id: string, data: any) => ({
      id,
      ...data
    }))
    mockResource.replace.mockImplementation(async (id: string, data: any) => ({
      id,
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
    mockResource.delete.mockResolvedValue(undefined)
  })

  describe('setMany with preserveMetadata', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({ connectionString: 'memory://test-bucket' })
      await client.connect()
    })

    it('should use update when preserveMetadata is true and var exists', async () => {
      mockResource.getOrNull.mockResolvedValue({
        id: 'existing-id',
        key: 'EXISTING',
        value: 'old-value',
        metadata: { source: 'old-source', custom: 'data' }
      })

      const inputs = [
        { key: 'EXISTING', value: 'new-value', project: 'proj', environment: 'dev' as const }
      ]

      await client.setMany(inputs, { preserveMetadata: true })

      expect(mockResource.getOrNull).toHaveBeenCalled()
      expect(mockResource.update).toHaveBeenCalled()
      expect(mockResource.replace).not.toHaveBeenCalled()
    })

    it('should use insert when preserveMetadata is true and var does not exist', async () => {
      mockResource.getOrNull.mockResolvedValue(null)

      const inputs = [
        { key: 'NEW_VAR', value: 'value', project: 'proj', environment: 'dev' as const }
      ]

      await client.setMany(inputs, { preserveMetadata: true })

      expect(mockResource.getOrNull).toHaveBeenCalled()
      expect(mockResource.insert).toHaveBeenCalled()
      expect(mockResource.update).not.toHaveBeenCalled()
    })

    it('should handle empty inputs', async () => {
      const results = await client.setMany([])
      expect(results).toEqual([])
    })
  })

  describe('setManyChunked', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({ connectionString: 'memory://test-bucket' })
      await client.connect()
    })

    it('should process multiple variables with progress callback', async () => {
      const inputs = [
        { key: 'VAR_1', value: 'v1', project: 'proj', environment: 'dev' as const },
        { key: 'VAR_2', value: 'v2', project: 'proj', environment: 'dev' as const },
        { key: 'VAR_3', value: 'v3', project: 'proj', environment: 'dev' as const }
      ]

      const progressCalls: any[] = []
      const result = await client.setManyChunked(inputs, {
        concurrency: 2,
        onProgress: (progress) => progressCalls.push(progress)
      })

      expect(result.success.length).toBe(3)
      expect(result.failed.length).toBe(0)
      expect(result.total).toBe(3)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(progressCalls.length).toBeGreaterThan(0)
    })

    it('should handle empty inputs', async () => {
      const result = await client.setManyChunked([])
      expect(result.success).toEqual([])
      expect(result.failed).toEqual([])
      expect(result.total).toBe(0)
    })

    it('should handle errors gracefully', async () => {
      mockResource.replace.mockRejectedValueOnce(new Error('S3 error'))

      const inputs = [
        { key: 'FAIL_VAR', value: 'v1', project: 'proj', environment: 'dev' as const },
        { key: 'OK_VAR', value: 'v2', project: 'proj', environment: 'dev' as const }
      ]

      const result = await client.setManyChunked(inputs, { continueOnError: true })

      expect(result.failed.length).toBe(1)
      expect(result.failed[0].key).toBe('FAIL_VAR')
      expect(result.success.length).toBe(1)
    })

    it('should use preserveMetadata option', async () => {
      mockResource.getOrNull.mockResolvedValue({
        id: 'id',
        key: 'VAR',
        value: 'old',
        metadata: { old: 'data' }
      })

      const inputs = [
        { key: 'VAR', value: 'new', project: 'proj', environment: 'dev' as const }
      ]

      await client.setManyChunked(inputs, { preserveMetadata: true })

      expect(mockResource.getOrNull).toHaveBeenCalled()
      expect(mockResource.update).toHaveBeenCalled()
    })
  })

  describe('getMany', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({ connectionString: 'memory://test-bucket' })
      await client.connect()
    })

    it('should get multiple variables by keys', async () => {
      mockResource.getOrNull
        .mockResolvedValueOnce({ id: '1', key: 'VAR1', value: 'val1', project: 'p', environment: 'dev' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: '3', key: 'VAR3', value: 'val3', project: 'p', environment: 'dev' })

      const results = await client.getMany(['VAR1', 'VAR2', 'VAR3'], 'p', 'dev')

      // getMany returns a Map<string, EnvVar | null>
      expect(results).toBeInstanceOf(Map)
      expect(results.size).toBe(3)
      expect(results.get('VAR1')).toBeDefined()
      expect(results.get('VAR2')).toBeNull()
      expect(results.get('VAR3')).toBeDefined()
    })

    it('should return empty map for empty keys', async () => {
      const results = await client.getMany([], 'p', 'dev')
      expect(results).toBeInstanceOf(Map)
      expect(results.size).toBe(0)
    })
  })

  describe('deleteManyByKeys', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({ connectionString: 'memory://test-bucket' })
      await client.connect()
    })

    it('should delete multiple variables by keys', async () => {
      const result = await client.deleteManyByKeys(['VAR1', 'VAR2'], 'proj', 'dev')
      // Returns { deleted: string[], notFound: string[] }
      expect(result.deleted).toEqual(['VAR1', 'VAR2'])
      expect(mockResource.delete).toHaveBeenCalledTimes(2)
    })

    it('should return empty arrays for empty keys', async () => {
      const result = await client.deleteManyByKeys([], 'proj', 'dev')
      expect(result.deleted).toEqual([])
      expect(result.notFound).toEqual([])
    })
  })

  describe('export', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({ connectionString: 'memory://test-bucket' })
      await client.connect()
    })

    it('should export variables as key-value object', async () => {
      mockResource.list.mockResolvedValue([
        { id: '1', key: 'DB_HOST', value: 'localhost', project: 'p', environment: 'dev' },
        { id: '2', key: 'DB_PORT', value: '5432', project: 'p', environment: 'dev' }
      ])

      const result = await client.export('p', 'dev')

      expect(result).toEqual({
        DB_HOST: 'localhost',
        DB_PORT: '5432'
      })
    })

    it('should export with service filter', async () => {
      mockResource.list.mockResolvedValue([
        { id: '1', key: 'API_KEY', value: 'secret', project: 'p', environment: 'dev', service: 'api' }
      ])

      const result = await client.export('p', 'dev', 'api')

      expect(result).toEqual({
        API_KEY: 'secret'
      })
    })

    it('should include shared vars when service specified and includeShared true', async () => {
      mockResource.list
        // First call for shared vars
        .mockResolvedValueOnce([
          { id: '1', key: 'SHARED_VAR', value: 'shared', project: 'p', environment: 'dev', service: '__shared__' }
        ])
        // Second call for service vars
        .mockResolvedValueOnce([
          { id: '2', key: 'SERVICE_VAR', value: 'service', project: 'p', environment: 'dev', service: 'api' }
        ])

      const result = await client.export('p', 'dev', 'api', { includeShared: true })

      expect(result).toEqual({
        SHARED_VAR: 'shared',
        SERVICE_VAR: 'service'
      })
    })

    it('should not include shared vars when includeShared is false', async () => {
      mockResource.list.mockResolvedValue([
        { id: '1', key: 'SERVICE_VAR', value: 'service', project: 'p', environment: 'dev', service: 'api' }
      ])

      const result = await client.export('p', 'dev', 'api', { includeShared: false })

      expect(result).toEqual({
        SERVICE_VAR: 'service'
      })
      // Should only call once (no shared vars call)
      expect(mockResource.list).toHaveBeenCalledTimes(1)
    })

    it('should export __shared__ service without merging', async () => {
      mockResource.list.mockResolvedValue([
        { id: '1', key: 'SHARED_VAR', value: 'shared', project: 'p', environment: 'dev', service: '__shared__' }
      ])

      const result = await client.export('p', 'dev', '__shared__')

      expect(result).toEqual({
        SHARED_VAR: 'shared'
      })
      // Should only call once (no extra shared call when already fetching __shared__)
      expect(mockResource.list).toHaveBeenCalledTimes(1)
    })
  })

  describe('sync', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({ connectionString: 'memory://test-bucket' })
      await client.connect()
    })

    it('should sync variables with deleteMissing', async () => {
      mockResource.list.mockResolvedValue([
        { id: '1', key: 'OLD_VAR', value: 'old', project: 'p', environment: 'dev' }
      ])

      const vars = {
        NEW_VAR: 'new'
      }

      // sync(vars, project, environment, service?, options?)
      const result = await client.sync(vars, 'p', 'dev', undefined, { deleteMissing: true })

      // SyncResult has: added, updated, deleted, unchanged, conflicts
      expect(result.added.length).toBe(1)
      expect(result.deleted.length).toBe(1)
      expect(mockResource.delete).toHaveBeenCalled()
    })

    it('should not delete when deleteMissing is false', async () => {
      mockResource.list.mockResolvedValue([
        { id: '1', key: 'OLD_VAR', value: 'old', project: 'p', environment: 'dev' }
      ])

      const vars = {
        NEW_VAR: 'new'
      }

      const result = await client.sync(vars, 'p', 'dev', undefined, { deleteMissing: false })

      expect(result.added.length).toBe(1)
      expect(result.deleted.length).toBe(0)
      expect(mockResource.delete).not.toHaveBeenCalled()
    })

    it('should update existing variables with different values', async () => {
      mockResource.list.mockResolvedValue([
        { id: '1', key: 'EXISTING_VAR', value: 'old-value', project: 'p', environment: 'dev' }
      ])

      const vars = {
        EXISTING_VAR: 'new-value'
      }

      const result = await client.sync(vars, 'p', 'dev')

      expect(result.updated.length).toBe(1)
      expect(result.added.length).toBe(0)
    })

    it('should not update unchanged variables', async () => {
      mockResource.list.mockResolvedValue([
        { id: '1', key: 'SAME_VAR', value: 'same-value', project: 'p', environment: 'dev' }
      ])

      const vars = {
        SAME_VAR: 'same-value'
      }

      const result = await client.sync(vars, 'p', 'dev')

      expect(result.unchanged.length).toBe(1)
      expect(result.updated.length).toBe(0)
    })
  })

  describe('createWriteStream', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({ connectionString: 'memory://test-bucket' })
      await client.connect()
    })

    it('should create a writable stream', () => {
      const stream = client.createWriteStream({ concurrency: 5 })
      expect(stream).toBeDefined()
      expect(stream.writable).toBe(true)
      stream.destroy()
    })

    it('should be a Writable stream instance', () => {
      const { Writable } = require('node:stream')
      const stream = client.createWriteStream()
      expect(stream).toBeInstanceOf(Writable)
      stream.destroy()
    })

    it('should have getResult method that returns batch result', async () => {
      const stream = client.createWriteStream({ concurrency: 5 })

      // Get result immediately (before any writes)
      const result = (stream as any).getResult()

      expect(result).toBeDefined()
      expect(typeof result.durationMs).toBe('number')
      expect(result.total).toBe(0)
      expect(result.success).toEqual([])
      expect(result.failed).toEqual([])

      stream.destroy()
    })
  })

  describe('deleteManyByKeys with native deleteMany', () => {
    let client: VaulterClient

    beforeEach(async () => {
      // Add deleteMany method to mock to test native path
      ;(mockResource as any).deleteMany = vi.fn()
      client = new VaulterClient({ connectionString: 'memory://test-bucket' })
      await client.connect()
    })

    afterEach(() => {
      delete (mockResource as any).deleteMany
    })

    it('should use deleteMany when available and count matches', async () => {
      ;(mockResource as any).deleteMany.mockResolvedValue({ deleted: 2 })

      const result = await client.deleteManyByKeys(['VAR1', 'VAR2'], 'proj', 'dev')

      expect(result.deleted).toEqual(['VAR1', 'VAR2'])
      expect(result.notFound).toEqual([])
      expect((mockResource as any).deleteMany).toHaveBeenCalled()
    })

    it('should use deleteMany when available and count does not match', async () => {
      ;(mockResource as any).deleteMany.mockResolvedValue({ deleted: 1 })

      const result = await client.deleteManyByKeys(['VAR1', 'VAR2'], 'proj', 'dev')

      // Optimistic result - all considered deleted
      expect(result.deleted).toEqual(['VAR1', 'VAR2'])
      expect(result.notFound).toEqual([])
    })
  })

  describe('nukePreview', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({ connectionString: 'memory://test-bucket' })
      await client.connect()
    })

    it('should return preview of data to be deleted', async () => {
      mockResource.list.mockResolvedValue([
        { id: '1', key: 'VAR1', value: 'v1', project: 'myproject', environment: 'dev' },
        { id: '2', key: 'VAR2', value: 'v2', project: 'myproject', environment: 'prd' }
      ])

      const result = await client.nukePreview()

      expect(result.project).toBe('myproject')
      expect(result.totalVars).toBe(2)
      expect(result.environments).toContain('dev')
      expect(result.environments).toContain('prd')
    })

    it('should return empty preview when no data', async () => {
      mockResource.list.mockResolvedValue([])

      const result = await client.nukePreview()

      expect(result.project).toBeNull()
      expect(result.totalVars).toBe(0)
    })
  })

  describe('nukeAllData', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({ connectionString: 'memory://test-bucket' })
      await client.connect()
    })

    it('should reject with mismatched confirm token', async () => {
      mockResource.list.mockResolvedValue([
        { id: '1', key: 'VAR1', value: 'v1', project: 'myproject', environment: 'dev' }
      ])

      await expect(client.nukeAllData('wrong-project'))
        .rejects.toThrow(/Safety check failed/)
    })

    it('should return 0 when no data exists', async () => {
      mockResource.list.mockResolvedValue([])

      const result = await client.nukeAllData('anytoken')

      expect(result.deletedCount).toBe(0)
    })
  })

  describe('asymmetric encryption', () => {
    it('should initialize with asymmetric mode when specified with public key', () => {
      const client = new VaulterClient({
        connectionString: 'memory://test-bucket',
        encryptionMode: 'asymmetric',
        publicKey: '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----'
      })

      expect(client.getEncryptionMode()).toBe('asymmetric')
    })

    it('should initialize with asymmetric mode when specified with private key', () => {
      const client = new VaulterClient({
        connectionString: 'memory://test-bucket',
        encryptionMode: 'asymmetric',
        privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
      })

      expect(client.getEncryptionMode()).toBe('asymmetric')
    })

    it('should use symmetric mode by default', () => {
      const client = new VaulterClient({
        connectionString: 'memory://test-bucket'
      })

      expect(client.getEncryptionMode()).toBe('symmetric')
    })

    it('should return asymmetric algorithm', () => {
      const client = new VaulterClient({
        connectionString: 'memory://test-bucket',
        encryptionMode: 'asymmetric',
        publicKey: '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----',
        asymmetricAlgorithm: 'rsa-4096'
      })

      expect(client.getAsymmetricAlgorithm()).toBe('rsa-4096')
    })

    it('should throw when asymmetric mode without keys', () => {
      expect(() => new VaulterClient({
        connectionString: 'memory://test-bucket',
        encryptionMode: 'asymmetric'
      })).toThrow(/requires at least a public key/)
    })
  })

  describe('getConnectionStrings', () => {
    it('should return connection strings array', () => {
      const client = new VaulterClient({
        connectionStrings: ['memory://bucket1', 'memory://bucket2']
      })

      expect(client.getConnectionStrings()).toEqual(['memory://bucket1', 'memory://bucket2'])
    })
  })

  describe('deleteManyByKeys fallback path', () => {
    let client: VaulterClient

    beforeEach(async () => {
      // Ensure no deleteMany method to trigger fallback path
      delete (mockResource as any).deleteMany
      client = new VaulterClient({ connectionString: 'memory://test-bucket' })
      await client.connect()
    })

    it('should handle NOT_FOUND errors in fallback path', async () => {
      // First delete succeeds, second throws NOT_FOUND
      mockResource.delete
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce({ code: 'NOT_FOUND' })

      const result = await client.deleteManyByKeys(['VAR1', 'VAR2'], 'proj', 'dev')

      expect(result.deleted).toEqual(['VAR1'])
      expect(result.notFound).toEqual(['VAR2'])
    })

    it('should handle "not found" message errors in fallback path', async () => {
      // Throws error with "not found" message
      mockResource.delete.mockRejectedValue(new Error('Resource not found'))

      const result = await client.deleteManyByKeys(['VAR1'], 'proj', 'dev')

      expect(result.deleted).toEqual([])
      expect(result.notFound).toEqual(['VAR1'])
    })

    it('should throw unexpected errors in fallback path', async () => {
      mockResource.delete.mockRejectedValue(new Error('Network error'))

      await expect(client.deleteManyByKeys(['VAR1'], 'proj', 'dev'))
        .rejects.toThrow('Network error')
    })

    it('should return all deleted when fallback succeeds', async () => {
      mockResource.delete.mockResolvedValue(undefined)

      const result = await client.deleteManyByKeys(['VAR1', 'VAR2', 'VAR3'], 'proj', 'dev')

      expect(result.deleted).toEqual(['VAR1', 'VAR2', 'VAR3'])
      expect(result.notFound).toEqual([])
      expect(mockResource.delete).toHaveBeenCalledTimes(3)
    })
  })

  describe('nukeAllData with valid token', () => {
    let client: VaulterClient

    beforeEach(async () => {
      client = new VaulterClient({ connectionString: 'memory://test-bucket' })
      await client.connect()
    })

    it('should delete all data when confirmation matches project', async () => {
      // Setup: list returns data for the project
      mockResource.list.mockResolvedValue([
        { id: '1', key: 'VAR1', value: 'v1', project: 'myproject', environment: 'dev' }
      ])

      // Mock createResource to return a resource with deleteAllData
      const nukeResource = {
        deleteAllData: vi.fn().mockResolvedValue({ deletedCount: 10 })
      }
      mockDb.createResource.mockResolvedValue(nukeResource)

      const result = await client.nukeAllData('myproject')

      expect(result.deletedCount).toBe(10)
      expect(result.project).toBe('myproject')
      expect(nukeResource.deleteAllData).toHaveBeenCalled()
      expect(mockDb.createResource).toHaveBeenCalledWith(expect.objectContaining({
        name: 'environment-variables',
        paranoid: false
      }))
    })
  })
})
