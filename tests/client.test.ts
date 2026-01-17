/**
 * Tests for client.ts
 * Uses mocks for s3db.js to test client logic
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Create mock objects that will be shared
const mockResource = {
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  get: vi.fn()
}

const mockDb = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  createResource: vi.fn()
}

// Mock s3db.js/lite before importing client
vi.mock('s3db.js/lite', () => {
  return {
    S3db: function(config: any) {
      // Store config for assertions
      (this as any).config = config
      ;(this as any).connect = mockDb.connect
      ;(this as any).disconnect = mockDb.disconnect
      ;(this as any).createResource = mockDb.createResource
    }
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
      // Now uses resource.get with deterministic ID instead of list
      mockResource.get.mockResolvedValue(existingVar)
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
      // Now uses resource.get with deterministic ID instead of list
      mockResource.get.mockResolvedValue(existingVar)

      const result = await client.get('EXISTING_KEY', 'test-project', 'dev')
      expect(result).not.toBeNull()
      expect(result!.key).toBe('EXISTING_KEY')
      expect(result!.value).toBe('existing-value')
      expect(mockResource.get).toHaveBeenCalledWith(expectedId)
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
      // Now uses resource.get with deterministic ID including service
      mockResource.get.mockResolvedValue(serviceVar)

      const result = await client.get('SERVICE_KEY', 'test-project', 'dev', 'api')
      expect(result).not.toBeNull()
      expect(result!.service).toBe('api')
      expect(mockResource.get).toHaveBeenCalledWith(expectedId)
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
      const vars = [
        { id: '1', key: 'VAR_1', value: 'value1', project: 'test-project', environment: 'dev' },
        { id: '2', key: 'VAR_2', value: 'value2', project: 'test-project', environment: 'dev' }
      ]
      mockResource.list.mockResolvedValue(vars)

      const results = await client.list({
        project: 'test-project',
        environment: 'dev'
      })

      expect(results.length).toBe(2)
      expect(mockResource.list).toHaveBeenCalledWith(expect.objectContaining({
        partition: 'byProjectEnv',
        partitionValues: { project: 'test-project', environment: 'dev' }
      }))
    })

    it('should list all variables for project', async () => {
      const vars = [
        { id: '1', key: 'VAR_1', value: 'value1', project: 'test-project', environment: 'dev' },
        { id: '2', key: 'VAR_2', value: 'value2', project: 'test-project', environment: 'dev' },
        { id: '3', key: 'VAR_3', value: 'value3', project: 'test-project', environment: 'prd' }
      ]
      mockResource.list.mockResolvedValue(vars)

      const results = await client.list({
        project: 'test-project'
      })

      expect(results.length).toBe(3)
      expect(mockResource.list).toHaveBeenCalledWith(expect.objectContaining({
        partition: 'byProject',
        partitionValues: { project: 'test-project' }
      }))
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
      const vars = [
        { id: '1', key: 'VAR_1', value: 'value1', project: 'test-project', service: 'api', environment: 'dev' }
      ]
      mockResource.list.mockResolvedValue(vars)

      const results = await client.list({
        project: 'test-project',
        service: 'api',
        environment: 'dev'
      })

      expect(results.length).toBe(1)
      expect(mockResource.list).toHaveBeenCalledWith(expect.objectContaining({
        partition: 'byProjectServiceEnv',
        partitionValues: { project: 'test-project', service: 'api', environment: 'dev' }
      }))
    })

    it('should list variables by environment only (cross-project)', async () => {
      const vars = [
        { id: '1', key: 'VAR_1', value: 'value1', project: 'project-a', environment: 'prd' },
        { id: '2', key: 'VAR_2', value: 'value2', project: 'project-b', environment: 'prd' }
      ]
      mockResource.list.mockResolvedValue(vars)

      const results = await client.list({
        environment: 'prd'
      })

      expect(results.length).toBe(2)
      expect(mockResource.list).toHaveBeenCalledWith(expect.objectContaining({
        partition: 'byEnvironment',
        partitionValues: { environment: 'prd' }
      }))
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

  describe('insertMany', () => {
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

      const results = await client.insertMany(inputs)

      expect(results.length).toBe(2)
      expect(mockResource.insert).toHaveBeenCalledTimes(2)
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
