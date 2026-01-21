/**
 * Tests for src/lib/keys.ts
 *
 * Multi-environment key management library functions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  generateKey,
  loadKeyForEnv,
  listKeys,
  keyExistsForEnv,
  getKeyPathForEnv,
  deleteKey
} from '../../src/lib/keys.js'
import { getProjectKeysDir } from '../../src/lib/config-loader.js'

// ============================================================================
// Test Setup
// ============================================================================

const TEST_PROJECT = 'keys-test-project'
let originalEnv: NodeJS.ProcessEnv

function cleanupTestKeys() {
  // Clean up project keys
  const projectKeysDir = getProjectKeysDir(TEST_PROJECT)
  if (fs.existsSync(projectKeysDir)) {
    fs.rmSync(projectKeysDir, { recursive: true, force: true })
  }

  // Also clean up parent if empty
  const projectDir = path.dirname(projectKeysDir)
  if (fs.existsSync(projectDir)) {
    try {
      fs.rmdirSync(projectDir)
    } catch {
      // Not empty, that's fine
    }
  }
}

describe('keys.ts', () => {
  beforeEach(() => {
    originalEnv = { ...process.env }
    cleanupTestKeys()
  })

  afterEach(() => {
    process.env = originalEnv
    cleanupTestKeys()
  })

  // ==========================================================================
  // generateKey
  // ==========================================================================

  describe('generateKey', () => {
    it('generates symmetric key for environment', async () => {
      const result = await generateKey({
        project: TEST_PROJECT,
        environment: 'prd'
      })

      expect(result.name).toBe('prd')
      expect(result.asymmetric).toBe(false)
      expect(result.algorithm).toBe('symmetric')
      expect(result.scope).toBe('project')
      expect(result.environment).toBe('prd')
      expect(fs.existsSync(result.keyPath)).toBe(true)

      // Key should be a valid passphrase
      const key = fs.readFileSync(result.keyPath, 'utf-8')
      expect(key.length).toBeGreaterThanOrEqual(32)
    })

    it('generates symmetric key with custom name', async () => {
      const result = await generateKey({
        project: TEST_PROJECT,
        name: 'custom-key'
      })

      expect(result.name).toBe('custom-key')
      expect(result.asymmetric).toBe(false)
      expect(fs.existsSync(result.keyPath)).toBe(true)
    })

    it('generates master key by default', async () => {
      const result = await generateKey({
        project: TEST_PROJECT
      })

      expect(result.name).toBe('master')
      expect(result.asymmetric).toBe(false)
      expect(fs.existsSync(result.keyPath)).toBe(true)
    })

    it('generates asymmetric RSA-4096 key pair', async () => {
      const result = await generateKey({
        project: TEST_PROJECT,
        environment: 'prd',
        asymmetric: true,
        algorithm: 'rsa-4096'
      })

      expect(result.name).toBe('prd')
      expect(result.asymmetric).toBe(true)
      expect(result.algorithm).toBe('rsa-4096')
      expect(fs.existsSync(result.keyPath)).toBe(true)
      expect(fs.existsSync(result.publicKeyPath!)).toBe(true)

      // Verify key content
      const privateKey = fs.readFileSync(result.keyPath, 'utf-8')
      const publicKey = fs.readFileSync(result.publicKeyPath!, 'utf-8')
      expect(privateKey).toContain('PRIVATE KEY')
      expect(publicKey).toContain('PUBLIC KEY')
    })

    it('generates asymmetric RSA-2048 key pair', async () => {
      const result = await generateKey({
        project: TEST_PROJECT,
        name: 'rsa2048',
        asymmetric: true,
        algorithm: 'rsa-2048'
      })

      expect(result.algorithm).toBe('rsa-2048')
      expect(fs.existsSync(result.keyPath)).toBe(true)
      expect(fs.existsSync(result.publicKeyPath!)).toBe(true)
    })

    it('throws error when key already exists', async () => {
      await generateKey({
        project: TEST_PROJECT,
        name: 'existing'
      })

      await expect(
        generateKey({
          project: TEST_PROJECT,
          name: 'existing'
        })
      ).rejects.toThrow(/already exists/)
    })

    it('overwrites existing key with force option', async () => {
      const result1 = await generateKey({
        project: TEST_PROJECT,
        name: 'overwrite-me'
      })

      const key1 = fs.readFileSync(result1.keyPath, 'utf-8')

      const result2 = await generateKey({
        project: TEST_PROJECT,
        name: 'overwrite-me',
        force: true
      })

      const key2 = fs.readFileSync(result2.keyPath, 'utf-8')

      expect(key1).not.toBe(key2)
    })

    it('sets restrictive permissions on key files', async () => {
      const result = await generateKey({
        project: TEST_PROJECT,
        name: 'secure-key'
      })

      const stats = fs.statSync(result.keyPath)
      // 0o600 = owner read/write only (on Unix systems)
      const expectedMode = 0o600
      expect(stats.mode & 0o777).toBe(expectedMode)
    })

    it('name option takes precedence over environment', async () => {
      const result = await generateKey({
        project: TEST_PROJECT,
        name: 'explicit-name',
        environment: 'prd'
      })

      expect(result.name).toBe('explicit-name')
      expect(result.environment).toBe('prd')
    })
  })

  // ==========================================================================
  // loadKeyForEnv
  // ==========================================================================

  describe('loadKeyForEnv', () => {
    it('loads key from VAULTER_KEY_{ENV} env var', async () => {
      process.env.VAULTER_KEY_PRD = 'prd-key-from-env'

      const result = await loadKeyForEnv({
        project: TEST_PROJECT,
        environment: 'prd'
      })

      expect(result.key).toBe('prd-key-from-env')
      expect(result.source).toBe('env-specific')
      expect(result.keyName).toBe('VAULTER_KEY_PRD')
      expect(result.mode).toBe('symmetric')
    })

    it('loads key from environment-specific file', async () => {
      // Generate key file first
      await generateKey({
        project: TEST_PROJECT,
        environment: 'dev'
      })

      const result = await loadKeyForEnv({
        project: TEST_PROJECT,
        environment: 'dev'
      })

      expect(result.key).toBeTruthy()
      expect(result.source).toBe('file-env')
      expect(result.keyName).toBe('dev')
    })

    it('falls back to VAULTER_KEY env var', async () => {
      process.env.VAULTER_KEY = 'global-key'

      const result = await loadKeyForEnv({
        project: TEST_PROJECT,
        environment: 'stg'
      })

      expect(result.key).toBe('global-key')
      expect(result.source).toBe('env')
      expect(result.keyName).toBe('VAULTER_KEY')
    })

    it('falls back to master key file', async () => {
      // Generate master key
      await generateKey({
        project: TEST_PROJECT,
        name: 'master'
      })

      const result = await loadKeyForEnv({
        project: TEST_PROJECT,
        environment: 'unknown-env'
      })

      expect(result.key).toBeTruthy()
      expect(result.source).toBe('fallback')
      expect(result.keyName).toBe('master')
    })

    it('returns null when no key found', async () => {
      const result = await loadKeyForEnv({
        project: 'nonexistent-project',
        environment: 'prd'
      })

      expect(result.key).toBeNull()
      expect(result.source).toBe('none')
    })

    it('env-specific key takes priority over global key', async () => {
      process.env.VAULTER_KEY = 'global-key'
      process.env.VAULTER_KEY_PRD = 'prd-specific-key'

      const result = await loadKeyForEnv({
        project: TEST_PROJECT,
        environment: 'prd'
      })

      expect(result.key).toBe('prd-specific-key')
      expect(result.source).toBe('env-specific')
    })

    it('env-specific file takes priority over global env var', async () => {
      process.env.VAULTER_KEY = 'global-key'

      await generateKey({
        project: TEST_PROJECT,
        environment: 'dev'
      })

      const result = await loadKeyForEnv({
        project: TEST_PROJECT,
        environment: 'dev'
      })

      expect(result.source).toBe('file-env')
      expect(result.key).not.toBe('global-key')
    })

    it('handles case-insensitive environment names in env vars', async () => {
      process.env.VAULTER_KEY_PRD = 'prd-key'

      // Lowercase env should still find VAULTER_KEY_PRD
      const result = await loadKeyForEnv({
        project: TEST_PROJECT,
        environment: 'prd'
      })

      expect(result.key).toBe('prd-key')
    })

    it('loads key from config with inline source', async () => {
      const config = {
        project: TEST_PROJECT,
        encryption: {
          keys: {
            prd: {
              source: [{ inline: 'inline-key-value' }]
            }
          }
        }
      }

      const result = await loadKeyForEnv({
        project: TEST_PROJECT,
        environment: 'prd',
        config: config as any
      })

      expect(result.key).toBe('inline-key-value')
      expect(result.source).toBe('config')
    })
  })

  // ==========================================================================
  // listKeys
  // ==========================================================================

  describe('listKeys', () => {
    it('lists all project keys', async () => {
      // Generate multiple keys
      await generateKey({ project: TEST_PROJECT, environment: 'dev' })
      await generateKey({ project: TEST_PROJECT, environment: 'prd' })
      await generateKey({ project: TEST_PROJECT, name: 'master' })

      const keys = await listKeys({ project: TEST_PROJECT, includeGlobal: false })

      expect(keys.length).toBe(3)
      const names = keys.map(k => k.name).sort()
      expect(names).toEqual(['dev', 'master', 'prd'])
    })

    it('detects symmetric vs asymmetric keys', async () => {
      await generateKey({ project: TEST_PROJECT, name: 'sym-key', asymmetric: false })
      await generateKey({ project: TEST_PROJECT, name: 'asym-key', asymmetric: true, algorithm: 'rsa-2048' })

      const keys = await listKeys({ project: TEST_PROJECT, includeGlobal: false })

      const symKey = keys.find(k => k.name === 'sym-key')
      const asymKey = keys.find(k => k.name === 'asym-key')

      expect(symKey?.asymmetric).toBe(false)
      expect(symKey?.hasPublicKey).toBe(false)
      expect(asymKey?.asymmetric).toBe(true)
      expect(asymKey?.hasPublicKey).toBe(true)
    })

    it('returns empty array when no keys exist', async () => {
      const keys = await listKeys({ project: 'no-keys-project', includeGlobal: false })
      expect(keys).toEqual([])
    })

    it('includes environment inference for common env names', async () => {
      await generateKey({ project: TEST_PROJECT, environment: 'prd' })
      await generateKey({ project: TEST_PROJECT, name: 'master' })

      const keys = await listKeys({ project: TEST_PROJECT, includeGlobal: false })

      const prdKey = keys.find(k => k.name === 'prd')
      const masterKey = keys.find(k => k.name === 'master')

      expect(prdKey?.environments).toEqual(['prd'])
      expect(masterKey?.environments).toEqual(['*'])
    })

    it('detects algorithm for asymmetric keys', async () => {
      await generateKey({
        project: TEST_PROJECT,
        name: 'rsa-key',
        asymmetric: true,
        algorithm: 'rsa-4096'
      })

      const keys = await listKeys({ project: TEST_PROJECT, includeGlobal: false })
      const rsaKey = keys.find(k => k.name === 'rsa-key')

      expect(rsaKey?.algorithm).toBe('rsa-4096')
    })
  })

  // ==========================================================================
  // keyExistsForEnv
  // ==========================================================================

  describe('keyExistsForEnv', () => {
    it('returns true when environment-specific key exists', async () => {
      await generateKey({ project: TEST_PROJECT, environment: 'prd' })

      expect(keyExistsForEnv(TEST_PROJECT, 'prd')).toBe(true)
    })

    it('returns true when master key exists (fallback)', async () => {
      await generateKey({ project: TEST_PROJECT, name: 'master' })

      expect(keyExistsForEnv(TEST_PROJECT, 'any-env')).toBe(true)
    })

    it('returns false when no key exists', () => {
      expect(keyExistsForEnv('nonexistent', 'prd')).toBe(false)
    })

    it('prefers env-specific key over master', async () => {
      await generateKey({ project: TEST_PROJECT, environment: 'prd' })
      await generateKey({ project: TEST_PROJECT, name: 'master' })

      // Both exist, should still return true
      expect(keyExistsForEnv(TEST_PROJECT, 'prd')).toBe(true)
    })
  })

  // ==========================================================================
  // getKeyPathForEnv
  // ==========================================================================

  describe('getKeyPathForEnv', () => {
    it('returns env-specific key path when it exists', async () => {
      const generated = await generateKey({ project: TEST_PROJECT, environment: 'prd' })

      const keyPath = getKeyPathForEnv(TEST_PROJECT, 'prd')
      expect(keyPath).toBe(generated.keyPath)
    })

    it('returns master key path as fallback', async () => {
      const generated = await generateKey({ project: TEST_PROJECT, name: 'master' })

      const keyPath = getKeyPathForEnv(TEST_PROJECT, 'nonexistent-env')
      expect(keyPath).toBe(generated.keyPath)
    })

    it('returns master key path when env key does not exist', async () => {
      await generateKey({ project: TEST_PROJECT, name: 'master' })

      const keyPath = getKeyPathForEnv(TEST_PROJECT, 'dev')
      expect(keyPath).toContain('master')
    })
  })

  // ==========================================================================
  // deleteKey
  // ==========================================================================

  describe('deleteKey', () => {
    it('deletes symmetric key', async () => {
      const generated = await generateKey({ project: TEST_PROJECT, name: 'to-delete' })
      expect(fs.existsSync(generated.keyPath)).toBe(true)

      deleteKey(TEST_PROJECT, 'to-delete')

      expect(fs.existsSync(generated.keyPath)).toBe(false)
    })

    it('deletes asymmetric key pair', async () => {
      const generated = await generateKey({
        project: TEST_PROJECT,
        name: 'asym-delete',
        asymmetric: true
      })

      expect(fs.existsSync(generated.keyPath)).toBe(true)
      expect(fs.existsSync(generated.publicKeyPath!)).toBe(true)

      deleteKey(TEST_PROJECT, 'asym-delete')

      expect(fs.existsSync(generated.keyPath)).toBe(false)
      expect(fs.existsSync(generated.publicKeyPath!)).toBe(false)
    })

    it('does not throw when key does not exist', () => {
      expect(() => deleteKey(TEST_PROJECT, 'nonexistent')).not.toThrow()
    })
  })

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('integration', () => {
    it('full lifecycle: generate, load, list, delete', async () => {
      // Generate keys for multiple environments
      await generateKey({ project: TEST_PROJECT, environment: 'dev' })
      await generateKey({ project: TEST_PROJECT, environment: 'stg' })
      await generateKey({ project: TEST_PROJECT, environment: 'prd' })

      // List keys
      let keys = await listKeys({ project: TEST_PROJECT, includeGlobal: false })
      expect(keys.length).toBe(3)

      // Load each key
      const devResult = await loadKeyForEnv({ project: TEST_PROJECT, environment: 'dev' })
      const stgResult = await loadKeyForEnv({ project: TEST_PROJECT, environment: 'stg' })
      const prdResult = await loadKeyForEnv({ project: TEST_PROJECT, environment: 'prd' })

      expect(devResult.key).toBeTruthy()
      expect(stgResult.key).toBeTruthy()
      expect(prdResult.key).toBeTruthy()

      // All keys should be different
      expect(devResult.key).not.toBe(stgResult.key)
      expect(stgResult.key).not.toBe(prdResult.key)

      // Delete one key
      deleteKey(TEST_PROJECT, 'stg')

      // List again
      keys = await listKeys({ project: TEST_PROJECT, includeGlobal: false })
      expect(keys.length).toBe(2)

      // Loading deleted key should fall back
      const stgAfterDelete = await loadKeyForEnv({ project: TEST_PROJECT, environment: 'stg' })
      expect(stgAfterDelete.source).toBe('none')
    })

    it('env vars override file-based keys', async () => {
      // Generate file-based key
      await generateKey({ project: TEST_PROJECT, environment: 'prd' })

      // Load from file
      const fromFile = await loadKeyForEnv({ project: TEST_PROJECT, environment: 'prd' })
      expect(fromFile.source).toBe('file-env')

      // Set env var
      process.env.VAULTER_KEY_PRD = 'env-override'

      // Load again - env var should win
      const fromEnv = await loadKeyForEnv({ project: TEST_PROJECT, environment: 'prd' })
      expect(fromEnv.source).toBe('env-specific')
      expect(fromEnv.key).toBe('env-override')
    })
  })
})
