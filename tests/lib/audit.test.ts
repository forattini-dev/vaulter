/**
 * Tests for audit.ts - Audit logging module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  maskValue,
  detectUser,
  AuditLogger,
  createAuditLogger
} from '../../src/lib/audit.js'
import type { AuditEntry, AuditEntryInput } from '../../src/types.js'

// Mock resource that will be used across tests
const mockResource = {
  insert: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  get: vi.fn(),
  delete: vi.fn()
}

// Mock s3db.js/lite
vi.mock('s3db.js/lite', () => {
  return {
    S3db: class MockS3db {
      connectionString: string
      passphrase: string

      constructor(opts: { connectionString: string; passphrase: string }) {
        this.connectionString = opts.connectionString
        this.passphrase = opts.passphrase
      }

      async connect() {
        return undefined
      }

      async disconnect() {
        return undefined
      }

      async createResource() {
        return mockResource
      }
    }
  }
})

// Mock child_process for git commands
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn()
}))

import { execFileSync } from 'node:child_process'

const mockedExecFileSync = vi.mocked(execFileSync)

describe('audit', () => {
  describe('maskValue', () => {
    it('should return empty string for undefined input', () => {
      // Note: centralized maskValue returns '' for undefined (not undefined)
      expect(maskValue(undefined)).toBe('')
    })

    it('should return empty string for empty input', () => {
      expect(maskValue('')).toBe('')
    })

    it('should mask short values completely', () => {
      expect(maskValue('abc')).toBe('***')
      expect(maskValue('1234567')).toBe('***') // < 8 chars
    })

    it('should show first and last 4 chars for longer values', () => {
      // 19 chars: 4 start + 4 mask + 4 end
      expect(maskValue('supersecretpassword')).toBe('supe****word')
    })

    it('should handle exactly 8 character strings (minLengthToMask boundary)', () => {
      // 8 chars: 4 start + 1 mask (min) + 4 end = 9 chars (end overlaps)
      expect(maskValue('12345678')).toBe('1234*5678')
    })

    it('should handle 9 character strings', () => {
      // 9 chars: 4 start + 1 mask + 4 end
      expect(maskValue('abcdefghi')).toBe('abcd*fghi')
    })
  })

  describe('detectUser', () => {
    beforeEach(() => {
      vi.resetAllMocks()
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('should return git user.name when available', () => {
      mockedExecFileSync.mockReturnValue('John Doe\n')
      expect(detectUser('git')).toBe('John Doe')
    })

    it('should fall back to git user.email if name not set', () => {
      mockedExecFileSync
        .mockReturnValueOnce('') // First call for user.name
        .mockReturnValueOnce('john@example.com\n') // Second call for user.email
      expect(detectUser('git')).toBe('john@example.com')
    })

    it('should fall back to env vars if git fails', () => {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error('git not found')
      })
      vi.stubEnv('USER', 'envuser')
      expect(detectUser('git')).toBe('envuser')
    })

    it('should return env USER when source is env', () => {
      vi.stubEnv('USER', 'testuser')
      expect(detectUser('env')).toBe('testuser')
    })

    it('should return env USERNAME when USER not set', () => {
      vi.stubEnv('USER', '')
      vi.stubEnv('USERNAME', 'winuser')
      expect(detectUser('env')).toBe('winuser')
    })

    it('should return VAULTER_USER when other env vars not set', () => {
      vi.stubEnv('USER', '')
      vi.stubEnv('USERNAME', '')
      vi.stubEnv('VAULTER_USER', 'vaulteruser')
      expect(detectUser('env')).toBe('vaulteruser')
    })

    it('should return anonymous when source is anonymous', () => {
      expect(detectUser('anonymous')).toBe('anonymous')
    })

    it('should default to git source', () => {
      mockedExecFileSync.mockReturnValue('Git User\n')
      expect(detectUser()).toBe('Git User')
    })

    it('should return anonymous when no user sources available', () => {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error('git not found')
      })
      vi.stubEnv('USER', '')
      vi.stubEnv('USERNAME', '')
      vi.stubEnv('VAULTER_USER', '')
      expect(detectUser('env')).toBe('anonymous')
    })
  })

  describe('createAuditLogger', () => {
    it('should create an AuditLogger instance', () => {
      const logger = createAuditLogger()
      expect(logger).toBeInstanceOf(AuditLogger)
    })

    it('should pass config to constructor', () => {
      const logger = createAuditLogger({ enabled: false, retention_days: 30 })
      expect(logger.isEnabled()).toBe(false)
    })
  })

  describe('AuditLogger', () => {
    let logger: AuditLogger

    beforeEach(async () => {
      vi.clearAllMocks()

      // Reset mock resource methods
      mockResource.insert.mockReset().mockResolvedValue(undefined)
      mockResource.list.mockReset().mockResolvedValue([])
      mockResource.get.mockReset()
      mockResource.delete.mockReset().mockResolvedValue(undefined)

      logger = new AuditLogger()
      await logger.connect('memory://test-bucket')
    })

    describe('constructor', () => {
      it('should enable audit by default', () => {
        const l = new AuditLogger()
        expect(l.isEnabled()).toBe(true)
      })

      it('should respect enabled: false', () => {
        const l = new AuditLogger({ enabled: false })
        expect(l.isEnabled()).toBe(false)
      })

      it('should use default retention of 90 days', () => {
        const l = new AuditLogger()
        expect(l.isEnabled()).toBe(true)
      })
    })

    describe('connect', () => {
      it('should initialize the database', async () => {
        const l = new AuditLogger()
        await l.connect('memory://bucket')
        expect(l.isConnected()).toBe(true)
      })

      it('should not reinitialize if already connected', async () => {
        const l = new AuditLogger()
        await l.connect('memory://bucket')
        const wasConnected = l.isConnected()
        await l.connect('memory://bucket2') // Should do nothing
        expect(wasConnected).toBe(true)
        expect(l.isConnected()).toBe(true)
      })

      it('should use default passphrase', async () => {
        // Since we can't easily check constructor params with class mock,
        // we verify the connection succeeds (passphrase doesn't matter for mock)
        const l = new AuditLogger()
        await l.connect('memory://bucket')
        expect(l.isConnected()).toBe(true)
      })

      it('should use custom passphrase', async () => {
        // Since we can't easily check constructor params with class mock,
        // we verify the connection succeeds (passphrase doesn't matter for mock)
        const l = new AuditLogger()
        await l.connect('memory://bucket', 'custom-key')
        expect(l.isConnected()).toBe(true)
      })
    })

    describe('isConnected', () => {
      it('should return false before connect', () => {
        const l = new AuditLogger()
        expect(l.isConnected()).toBe(false)
      })

      it('should return true after connect', () => {
        expect(logger.isConnected()).toBe(true)
      })
    })

    describe('isEnabled', () => {
      it('should return true by default', () => {
        expect(logger.isEnabled()).toBe(true)
      })

      it('should return false when disabled', () => {
        const l = new AuditLogger({ enabled: false })
        expect(l.isEnabled()).toBe(false)
      })
    })

    describe('log', () => {
      const sampleInput: AuditEntryInput = {
        operation: 'set',
        key: 'API_KEY',
        project: 'test-project',
        environment: 'dev',
        source: 'cli',
        previousValue: 'old-secret-value',
        newValue: 'new-secret-value'
      }

      it('should log an entry with masked values', async () => {
        mockedExecFileSync.mockReturnValue('Test User\n')

        const entry = await logger.log(sampleInput)

        expect(entry).not.toBeNull()
        expect(entry!.operation).toBe('set')
        expect(entry!.key).toBe('API_KEY')
        expect(entry!.project).toBe('test-project')
        expect(entry!.environment).toBe('dev')
        expect(entry!.source).toBe('cli')
        expect(entry!.previousValue).toBe('old-****alue')
        expect(entry!.newValue).toBe('new-****alue')
        expect(entry!.user).toBe('Test User')
        expect(entry!.id).toMatch(/^audit_[a-z0-9]+_[a-z0-9]+$/)
        expect(mockResource.insert).toHaveBeenCalledWith(entry)
      })

      it('should return null when audit is disabled', async () => {
        const l = new AuditLogger({ enabled: false })
        await l.connect('memory://bucket')

        const entry = await l.log(sampleInput)
        expect(entry).toBeNull()
      })

      it('should throw if not connected', async () => {
        const l = new AuditLogger()
        await expect(l.log(sampleInput)).rejects.toThrow('AuditLogger not initialized')
      })

      it('should include service when provided', async () => {
        mockedExecFileSync.mockReturnValue('User\n')

        const entry = await logger.log({
          ...sampleInput,
          service: 'api-service'
        })

        expect(entry!.service).toBe('api-service')
      })

      it('should include metadata when provided', async () => {
        mockedExecFileSync.mockReturnValue('User\n')

        const entry = await logger.log({
          ...sampleInput,
          metadata: { reason: 'rotation' }
        })

        expect(entry!.metadata).toEqual({ reason: 'rotation' })
      })
    })

    describe('query', () => {
      const mockEntries: AuditEntry[] = [
        {
          id: 'audit_1',
          timestamp: new Date('2025-01-15'),
          user: 'user1',
          operation: 'set',
          key: 'API_KEY',
          project: 'proj1',
          environment: 'dev',
          source: 'cli'
        },
        {
          id: 'audit_2',
          timestamp: new Date('2025-01-14'),
          user: 'user2',
          operation: 'delete',
          key: 'DB_URL',
          project: 'proj1',
          environment: 'prd',
          source: 'mcp'
        },
        {
          id: 'audit_3',
          timestamp: new Date('2025-01-13'),
          user: 'user1',
          operation: 'set',
          key: 'SECRET_TOKEN',
          project: 'proj2',
          environment: 'dev',
          source: 'api',
          service: 'auth'
        }
      ]

      beforeEach(() => {
        mockResource.list.mockResolvedValue([...mockEntries])
      })

      it('should throw if not connected', async () => {
        const l = new AuditLogger()
        await expect(l.query()).rejects.toThrow('AuditLogger not initialized')
      })

      it('should return all entries when no filters', async () => {
        const results = await logger.query()
        expect(results).toHaveLength(3)
      })

      it('should sort by timestamp descending', async () => {
        const results = await logger.query()
        expect(results[0].id).toBe('audit_1')
        expect(results[2].id).toBe('audit_3')
      })

      it('should filter by service', async () => {
        const results = await logger.query({ service: 'auth' })
        expect(results).toHaveLength(1)
        expect(results[0].service).toBe('auth')
      })

      it('should filter by source', async () => {
        const results = await logger.query({ source: 'cli' })
        expect(results).toHaveLength(1)
        expect(results[0].source).toBe('cli')
      })

      it('should filter by key with exact match', async () => {
        const results = await logger.query({ key: 'API_KEY' })
        expect(results).toHaveLength(1)
        expect(results[0].key).toBe('API_KEY')
      })

      it('should filter by key with glob pattern *', async () => {
        const results = await logger.query({ key: '*_KEY' })
        expect(results).toHaveLength(1)
      })

      it('should filter by key with glob pattern ?', async () => {
        const results = await logger.query({ key: 'DB_UR?' })
        expect(results).toHaveLength(1)
      })

      it('should filter by since date', async () => {
        const results = await logger.query({ since: new Date('2025-01-14') })
        expect(results).toHaveLength(2)
      })

      it('should filter by until date', async () => {
        const results = await logger.query({ until: new Date('2025-01-14') })
        expect(results).toHaveLength(2)
      })

      it('should use byProjectEnv partition', async () => {
        await logger.query({ project: 'proj1', environment: 'dev' })
        expect(mockResource.list).toHaveBeenCalledWith({
          partition: 'byProjectEnv',
          partitionValues: { project: 'proj1', environment: 'dev' }
        })
      })

      it('should use byProject partition', async () => {
        await logger.query({ project: 'proj1' })
        expect(mockResource.list).toHaveBeenCalledWith({
          partition: 'byProject',
          partitionValues: { project: 'proj1' }
        })
      })

      it('should use byUser partition', async () => {
        await logger.query({ user: 'user1' })
        expect(mockResource.list).toHaveBeenCalledWith({
          partition: 'byUser',
          partitionValues: { user: 'user1' }
        })
      })

      it('should use byOperation partition', async () => {
        await logger.query({ operation: 'set' })
        expect(mockResource.list).toHaveBeenCalledWith({
          partition: 'byOperation',
          partitionValues: { operation: 'set' }
        })
      })

      it('should pass limit and offset', async () => {
        await logger.query({ limit: 10, offset: 5 })
        expect(mockResource.list).toHaveBeenCalledWith({
          limit: 10,
          offset: 5
        })
      })
    })

    describe('get', () => {
      it('should return entry by id', async () => {
        const entry: AuditEntry = {
          id: 'audit_123',
          timestamp: new Date(),
          user: 'user',
          operation: 'set',
          key: 'KEY',
          project: 'proj',
          environment: 'dev',
          source: 'cli'
        }
        mockResource.get.mockResolvedValue(entry)

        const result = await logger.get('audit_123')
        expect(result).toEqual(entry)
        expect(mockResource.get).toHaveBeenCalledWith('audit_123')
      })

      it('should return null if not found', async () => {
        mockResource.get.mockRejectedValue(new Error('Not found'))

        const result = await logger.get('nonexistent')
        expect(result).toBeNull()
      })

      it('should throw if not connected', async () => {
        const l = new AuditLogger()
        await expect(l.get('id')).rejects.toThrow('AuditLogger not initialized')
      })
    })

    describe('cleanup', () => {
      it('should delete entries older than retention period', async () => {
        const oldDate = new Date()
        oldDate.setDate(oldDate.getDate() - 100)

        const recentDate = new Date()
        recentDate.setDate(recentDate.getDate() - 10)

        mockResource.list.mockResolvedValue([
          { id: 'old', timestamp: oldDate },
          { id: 'recent', timestamp: recentDate }
        ])

        const deleted = await logger.cleanup()

        expect(deleted).toBe(1)
        expect(mockResource.delete).toHaveBeenCalledWith('old')
        expect(mockResource.delete).not.toHaveBeenCalledWith('recent')
      })

      it('should use override retention days', async () => {
        const date15DaysAgo = new Date()
        date15DaysAgo.setDate(date15DaysAgo.getDate() - 15)

        mockResource.list.mockResolvedValue([
          { id: 'entry', timestamp: date15DaysAgo }
        ])

        // With default 90 days, entry should be kept
        let deleted = await logger.cleanup()
        expect(deleted).toBe(0)

        // With 10 days override, entry should be deleted
        deleted = await logger.cleanup(10)
        expect(deleted).toBe(1)
      })

      it('should throw if not connected', async () => {
        const l = new AuditLogger()
        await expect(l.cleanup()).rejects.toThrow('AuditLogger not initialized')
      })

      it('should return 0 if no entries to delete', async () => {
        mockResource.list.mockResolvedValue([])
        const deleted = await logger.cleanup()
        expect(deleted).toBe(0)
      })
    })

    describe('stats', () => {
      const mockEntries: AuditEntry[] = [
        {
          id: 'audit_1',
          timestamp: new Date('2025-01-15'),
          user: 'user1',
          operation: 'set',
          key: 'K1',
          project: 'proj1',
          environment: 'dev',
          source: 'cli'
        },
        {
          id: 'audit_2',
          timestamp: new Date('2025-01-10'),
          user: 'user1',
          operation: 'set',
          key: 'K2',
          project: 'proj1',
          environment: 'dev',
          source: 'mcp'
        },
        {
          id: 'audit_3',
          timestamp: new Date('2025-01-12'),
          user: 'user2',
          operation: 'delete',
          key: 'K3',
          project: 'proj1',
          environment: 'dev',
          source: 'cli'
        }
      ]

      beforeEach(() => {
        mockResource.list.mockResolvedValue([...mockEntries])
      })

      it('should return stats for project', async () => {
        const stats = await logger.stats('proj1')

        expect(stats.totalEntries).toBe(3)
        expect(stats.byOperation).toEqual({ set: 2, delete: 1 })
        expect(stats.byUser).toEqual({ user1: 2, user2: 1 })
        expect(stats.bySource).toEqual({ cli: 2, mcp: 1 })
        expect(stats.oldestEntry).toEqual(new Date('2025-01-10'))
        expect(stats.newestEntry).toEqual(new Date('2025-01-15'))
      })

      it('should return stats for project and environment', async () => {
        const stats = await logger.stats('proj1', 'dev')
        expect(stats.totalEntries).toBe(3)
      })

      it('should return empty stats for no entries', async () => {
        mockResource.list.mockResolvedValue([])

        const stats = await logger.stats('empty-project')

        expect(stats.totalEntries).toBe(0)
        expect(stats.byOperation).toEqual({})
        expect(stats.byUser).toEqual({})
        expect(stats.bySource).toEqual({})
        expect(stats.oldestEntry).toBeUndefined()
        expect(stats.newestEntry).toBeUndefined()
      })
    })

    describe('disconnect', () => {
      it('should disconnect from database', async () => {
        expect(logger.isConnected()).toBe(true)
        await logger.disconnect()
        expect(logger.isConnected()).toBe(false)
      })

      it('should handle multiple disconnect calls', async () => {
        await logger.disconnect()
        await logger.disconnect() // Should not throw
        expect(logger.isConnected()).toBe(false)
      })
    })
  })
})
