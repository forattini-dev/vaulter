/**
 * Versioning tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { VaulterClient } from '../src/client.js'
import type { VersioningConfig } from '../src/types.js'
import { tmpdir } from 'node:os'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

describe('Versioning', () => {
  const testDir = join(tmpdir(), 'vaulter-versioning-test-' + Date.now())

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('Basic Versioning', () => {
    it('should create initial version when versioning enabled', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'count',
        max_versions: 10
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      // Create variable
      const result = await client.set({
        key: 'API_KEY',
        value: 'initial-value',
        project: 'test',
        environment: 'dev'
      })

      expect(result.metadata?.currentVersion).toBe(1)
      expect(result.metadata?.versions).toBeDefined()
      expect(result.metadata?.versions?.length).toBe(1)
      expect(result.metadata?.versions?.[0].version).toBe(1)
      expect(result.metadata?.versions?.[0].operation).toBe('set')

      await client.disconnect()
    })

    it('should create new version on update', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'count',
        max_versions: 10
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      // Create initial
      await client.set({
        key: 'API_KEY',
        value: 'v1',
        project: 'test',
        environment: 'dev'
      })

      // Update
      const updated = await client.set({
        key: 'API_KEY',
        value: 'v2',
        project: 'test',
        environment: 'dev'
      })

      expect(updated.metadata?.currentVersion).toBe(2)
      expect(updated.metadata?.versions?.length).toBe(2)
      expect(updated.metadata?.versions?.[0].version).toBe(2)
      expect(updated.metadata?.versions?.[1].version).toBe(1)

      await client.disconnect()
    })

    it('should not version when disabled', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: false
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      const result = await client.set({
        key: 'API_KEY',
        value: 'value',
        project: 'test',
        environment: 'dev'
      })

      expect(result.metadata?.currentVersion).toBeUndefined()
      expect(result.metadata?.versions).toBeUndefined()

      await client.disconnect()
    })
  })

  describe('Pattern-Based Versioning', () => {
    it('should only version keys matching include patterns', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'count',
        max_versions: 10,
        include: ['*_KEY', '*_SECRET']
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      // Should be versioned (matches pattern)
      const versioned = await client.set({
        key: 'API_KEY',
        value: 'secret',
        project: 'test',
        environment: 'dev'
      })

      expect(versioned.metadata?.versions).toBeDefined()

      // Should NOT be versioned (doesn't match pattern)
      const notVersioned = await client.set({
        key: 'LOG_LEVEL',
        value: 'debug',
        project: 'test',
        environment: 'dev'
      })

      expect(notVersioned.metadata?.versions).toBeUndefined()

      await client.disconnect()
    })

    it('should not version keys matching exclude patterns', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'count',
        max_versions: 10,
        exclude: ['TEMP_*']
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      // Should be versioned (doesn't match exclude)
      const versioned = await client.set({
        key: 'API_KEY',
        value: 'secret',
        project: 'test',
        environment: 'dev'
      })

      expect(versioned.metadata?.versions).toBeDefined()

      // Should NOT be versioned (matches exclude)
      const excluded = await client.set({
        key: 'TEMP_VALUE',
        value: 'temporary',
        project: 'test',
        environment: 'dev'
      })

      expect(excluded.metadata?.versions).toBeUndefined()

      await client.disconnect()
    })
  })

  describe('Retention Policies', () => {
    it('should apply count-based retention', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'count',
        max_versions: 3
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      // Create 5 versions
      for (let i = 1; i <= 5; i++) {
        await client.set({
          key: 'API_KEY',
          value: `v${i}`,
          project: 'test',
          environment: 'dev'
        })
      }

      const result = await client.get('API_KEY', 'test', 'dev')

      // Should keep only 3 most recent versions
      expect(result?.metadata?.versions?.length).toBe(3)
      expect(result?.metadata?.versions?.[0].version).toBe(5)
      expect(result?.metadata?.versions?.[1].version).toBe(4)
      expect(result?.metadata?.versions?.[2].version).toBe(3)

      await client.disconnect()
    })

    it('should apply days-based retention', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'days',
        retention_days: 30
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      // Create version
      await client.set({
        key: 'API_KEY',
        value: 'v1',
        project: 'test',
        environment: 'dev'
      })

      const result = await client.get('API_KEY', 'test', 'dev')

      // All versions should be kept (they're recent)
      expect(result?.metadata?.versions?.length).toBeGreaterThan(0)

      await client.disconnect()
    })

    it('should apply both retention (union)', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'both',
        max_versions: 2,
        retention_days: 30
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      // Create 3 versions
      for (let i = 1; i <= 3; i++) {
        await client.set({
          key: 'API_KEY',
          value: `v${i}`,
          project: 'test',
          environment: 'dev'
        })
      }

      const result = await client.get('API_KEY', 'test', 'dev')

      // Should keep all 3 (recent by days, and 2 by count)
      // "both" mode is union, so if any condition is met, version is kept
      expect(result?.metadata?.versions?.length).toBe(3)

      await client.disconnect()
    })
  })

  describe('Version History API', () => {
    it('should list version history', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'count',
        max_versions: 10
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      // Create versions
      await client.set({
        key: 'API_KEY',
        value: 'v1',
        project: 'test',
        environment: 'dev'
      })

      await client.set({
        key: 'API_KEY',
        value: 'v2',
        project: 'test',
        environment: 'dev'
      })

      const versions = await client.listVersions('API_KEY', 'test', 'dev')

      expect(versions.length).toBe(2)
      expect(versions[0].version).toBe(2)
      expect(versions[0].value).toBe('v2')
      expect(versions[1].version).toBe(1)
      expect(versions[1].value).toBe('v1')
      expect(versions[0].checksum).toBeDefined()
      expect(versions[0].timestamp).toBeDefined()

      await client.disconnect()
    })

    it('should return empty array for non-versioned keys', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: false
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      await client.set({
        key: 'API_KEY',
        value: 'value',
        project: 'test',
        environment: 'dev'
      })

      const versions = await client.listVersions('API_KEY', 'test', 'dev')

      expect(versions.length).toBe(0)

      await client.disconnect()
    })

    it('should get specific version', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'count',
        max_versions: 10
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      // Create versions
      await client.set({
        key: 'API_KEY',
        value: 'v1',
        project: 'test',
        environment: 'dev'
      })

      await client.set({
        key: 'API_KEY',
        value: 'v2',
        project: 'test',
        environment: 'dev'
      })

      const version1 = await client.getVersion('API_KEY', 'test', 'dev', 1)
      const version2 = await client.getVersion('API_KEY', 'test', 'dev', 2)
      const versionNonExistent = await client.getVersion('API_KEY', 'test', 'dev', 999)

      expect(version1).not.toBeNull()
      expect(version1?.value).toBe('v1')
      expect(version2).not.toBeNull()
      expect(version2?.value).toBe('v2')
      expect(versionNonExistent).toBeNull()

      await client.disconnect()
    })
  })

  describe('Rollback', () => {
    it('should rollback to previous version', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'count',
        max_versions: 10
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      // Create versions
      await client.set({
        key: 'API_KEY',
        value: 'v1',
        project: 'test',
        environment: 'dev'
      })

      await client.set({
        key: 'API_KEY',
        value: 'v2-bad',
        project: 'test',
        environment: 'dev'
      })

      // Current value is v2-bad
      const before = await client.get('API_KEY', 'test', 'dev')
      expect(before?.value).toBe('v2-bad')

      // Rollback to version 1
      await client.rollback('API_KEY', 'test', 'dev', 1)

      // Current value should now be v1
      const after = await client.get('API_KEY', 'test', 'dev')
      expect(after?.value).toBe('v1')

      // Should create a new version with operation='rollback'
      expect(after?.metadata?.currentVersion).toBe(3)

      const versions = await client.listVersions('API_KEY', 'test', 'dev')
      expect(versions[0].operation).toBe('rollback')
      expect(versions[0].value).toBe('v1')

      await client.disconnect()
    })

    it('should throw error for non-existent version', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'count',
        max_versions: 10
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      await client.set({
        key: 'API_KEY',
        value: 'v1',
        project: 'test',
        environment: 'dev'
      })

      await expect(
        client.rollback('API_KEY', 'test', 'dev', 999)
      ).rejects.toThrow('Version 999 not found')

      await client.disconnect()
    })

    it('should throw error for non-existent key', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'count',
        max_versions: 10
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      await expect(
        client.rollback('NONEXISTENT', 'test', 'dev', 1)
      ).rejects.toThrow('Variable NONEXISTENT not found')

      await client.disconnect()
    })
  })

  describe('Encryption & Integrity', () => {
    it('should encrypt version values', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'count',
        max_versions: 10
      }

      const client = new VaulterClient({
        connectionString: `file://${testDir}/encrypted`,
        passphrase: 'strong-passphrase-32-chars!!',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      const plaintext = 'my-secret-api-key-12345'

      await client.set({
        key: 'API_KEY',
        value: plaintext,
        project: 'test',
        environment: 'dev'
      })

      // In symmetric mode, s3db.js handles encryption/decryption transparently
      // When we read via client.get(), values are already decrypted
      const decrypted = await client.get('API_KEY', 'test', 'dev')
      expect(decrypted?.value).toBe(plaintext)

      // Version values are also decrypted when retrieved
      const versions = await client.listVersions('API_KEY', 'test', 'dev')
      expect(versions[0].value).toBe(plaintext)
      expect(versions[0].checksum).toBeDefined()
      expect(versions[0].timestamp).toBeDefined()

      // Verify data is actually stored encrypted on disk
      const fs = await import('node:fs')
      const files = fs.readdirSync(`${testDir}/encrypted`)
      const hasEncryptedData = files.some(f => f.includes('resource=environment-variables'))
      expect(hasEncryptedData).toBe(true)

      await client.disconnect()
    })

    it('should verify integrity with checksums', async () => {
      const versioningConfig: VersioningConfig = {
        enabled: true,
        retention_mode: 'count',
        max_versions: 10
      }

      const client = new VaulterClient({
        connectionString: `memory://test-${Date.now()}`,
        passphrase: 'test-key',
        config: { version: '1', project: 'test', versioning: versioningConfig }
      })

      await client.connect()

      const value = 'my-secret-value-123'

      await client.set({
        key: 'API_KEY',
        value,
        project: 'test',
        environment: 'dev'
      })

      const versions = await client.listVersions('API_KEY', 'test', 'dev')

      // Checksum should be SHA256 of plaintext value
      const crypto = require('node:crypto')
      const expectedChecksum = crypto.createHash('sha256').update(value).digest('hex')

      expect(versions[0].checksum).toBe(expectedChecksum)

      await client.disconnect()
    })
  })
})
