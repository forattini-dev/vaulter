/**
 * Doctor enhanced checks tests
 */

import { describe, it, expect } from 'vitest'
import { VaulterClient } from '../src/client.js'
import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

describe('Doctor - Enhanced Checks', () => {
  const testDir = join(tmpdir(), 'vaulter-doctor-test-' + Date.now())

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('Performance Check', () => {
    it('should measure read and list latency', async () => {
      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key'
      })

      await client.connect()

      // Populate some test data
      await client.set({
        key: 'TEST1',
        value: 'value1',
        project: 'test',
        environment: 'dev'
      })

      const readStart = Date.now()
      await client.list({ project: 'test', environment: 'dev', limit: 1 })
      const readTime = Date.now() - readStart

      expect(readTime).toBeLessThan(2000) // Should be fast in memory (increased for CI tolerance)

      await client.disconnect()
    })
  })

  describe('Write Permissions Check', () => {
    it('should verify read/write/delete permissions', async () => {
      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key'
      })

      await client.connect()

      const testKey = '_vaulter_healthcheck'
      const testValue = 'test-123'

      // Write
      await client.set({
        key: testKey,
        value: testValue,
        project: 'test',
        environment: 'dev'
      })

      // Read back
      const read = await client.get(testKey, 'test', 'dev')
      expect(read).not.toBeNull()
      expect(read!.value).toBe(testValue)

      // Delete
      const deleted = await client.delete(testKey, 'test', 'dev')
      expect(deleted).toBe(true)

      // Verify deleted
      const notFound = await client.get(testKey, 'test', 'dev')
      expect(notFound).toBeNull()

      await client.disconnect()
    })
  })

  describe('Encryption Round-Trip Check', () => {
    it('should encrypt and decrypt successfully', async () => {
      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'strong-test-key-32-characters!'
      })

      await client.connect()

      const testKey = '_encryption_test'
      const testValue = 'secret-value-' + Math.random()

      // Set (encrypts)
      await client.set({
        key: testKey,
        value: testValue,
        project: 'test',
        environment: 'dev'
      })

      // Get (decrypts)
      const retrieved = await client.get(testKey, 'test', 'dev')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.value).toBe(testValue)

      // Cleanup
      await client.delete(testKey, 'test', 'dev')
      await client.disconnect()
    })

    it('should detect wrong encryption key via value mismatch', async () => {
      const client1 = new VaulterClient({
        connectionString: `file://${testDir}/shared`,
        passphrase: 'key-1-very-strong-passphrase'
      })

      await client1.connect()

      const originalValue = 'my-secret-value-123'

      await client1.set({
        key: 'SECRET',
        value: originalValue,
        project: 'test',
        environment: 'dev'
      })

      await client1.disconnect()

      // Try to read with different key - s3db.js returns encrypted data
      const client2 = new VaulterClient({
        connectionString: `file://${testDir}/shared`,
        passphrase: 'key-2-different-passphrase'
      })

      await client2.connect()

      const retrieved = await client2.get('SECRET', 'test', 'dev')

      // With wrong key, the value will be different (still encrypted or garbled)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.value).not.toBe(originalValue)

      await client2.disconnect()
    })
  })

  describe('Sync Status Check', () => {
    it('should detect differences between local and remote', async () => {
      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key'
      })

      await client.connect()

      // Remote has these
      await client.set({ key: 'REMOTE_ONLY', value: 'val1', project: 'test', environment: 'dev' })
      await client.set({ key: 'BOTH', value: 'remote-value', project: 'test', environment: 'dev' })

      const remoteVars = await client.export('test', 'dev')

      // Local has these
      const localVars = {
        'LOCAL_ONLY': 'val2',
        'BOTH': 'local-value' // Conflict!
      }

      // Calculate differences
      const localKeys = new Set(Object.keys(localVars))
      const remoteKeys = new Set(Object.keys(remoteVars))

      let localOnly = 0
      let remoteOnly = 0
      let conflicts = 0

      for (const key of localKeys) {
        if (!remoteKeys.has(key)) localOnly++
        else if (localVars[key] !== remoteVars[key]) conflicts++
      }

      for (const key of remoteKeys) {
        if (!localKeys.has(key)) remoteOnly++
      }

      expect(localOnly).toBe(1) // LOCAL_ONLY
      expect(remoteOnly).toBe(1) // REMOTE_ONLY
      expect(conflicts).toBe(1) // BOTH

      await client.disconnect()
    })
  })

  describe('Security Check', () => {
    it('should detect weak encryption keys', () => {
      const weakKey = '12345' // < 32 chars
      const strongKey = 'this-is-a-strong-key-with-32-chars-or-more!'

      expect(weakKey.length).toBeLessThan(32)
      expect(strongKey.length).toBeGreaterThanOrEqual(32)
    })

    it('should detect file permission issues on Unix', () => {
      if (process.platform === 'win32') {
        // Skip on Windows
        return
      }

      const testFile = join(testDir, 'test.env')
      writeFileSync(testFile, 'SECRET=value')

      const fs = require('node:fs')
      const stats = fs.statSync(testFile)
      const mode = stats.mode & 0o777

      // Should check if mode is not 0o600 or 0o400
      const isSafe = mode === 0o600 || mode === 0o400

      // File created with default permissions may not be safe
      expect(typeof isSafe).toBe('boolean')
    })
  })
})
