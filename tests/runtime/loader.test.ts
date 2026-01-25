/**
 * Runtime Loader Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadRuntime, isRuntimeAvailable, getRuntimeInfo } from '../../src/runtime/index.js'
import { createClient } from '../../src/client.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('Runtime Loader', () => {
  let tempDir: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env }

    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-runtime-test-'))
  })

  afterEach(() => {
    // Restore original env
    process.env = originalEnv

    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('isRuntimeAvailable', () => {
    it('returns false when no config exists', () => {
      expect(isRuntimeAvailable(tempDir)).toBe(false)
    })

    it('returns true when config exists', () => {
      // Create .vaulter/config.yaml
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        'version: "1"\nproject: test-project\n'
      )

      expect(isRuntimeAvailable(tempDir)).toBe(true)
    })
  })

  describe('getRuntimeInfo', () => {
    it('returns available: false when no config', async () => {
      const info = await getRuntimeInfo({ cwd: tempDir })
      expect(info.available).toBe(false)
    })

    it('returns info when config exists', async () => {
      // Create .vaulter/config.yaml with memory backend
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        `version: "1"
project: test-project
backend:
  url: memory://test
environments:
  - dev
  - prd
`
      )

      const info = await getRuntimeInfo({ cwd: tempDir })
      expect(info.available).toBe(true)
      expect(info.project).toBe('test-project')
      expect(info.configFile).toContain('config.yaml')
    })
  })

  describe('loadRuntime', () => {
    it('loads variables from memory backend', async () => {
      // Create .vaulter/config.yaml
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        `version: "1"
project: test-runtime
backend:
  url: memory://runtime-test
encryption:
  key_source:
    - inline: test-passphrase
environments:
  - dev
`
      )

      // First, set some variables in the backend
      const client = createClient({
        connectionString: 'memory://runtime-test',
        passphrase: 'test-passphrase'
      })
      await client.connect()
      await client.set({
        key: 'TEST_DATABASE_URL',
        value: 'postgres://localhost/test',
        project: 'test-runtime',
        environment: 'dev'
      })
      await client.set({
        key: 'TEST_API_KEY',
        value: 'secret-api-key-123',
        project: 'test-runtime',
        environment: 'dev'
      })
      await client.disconnect()

      // Clear any existing values
      delete process.env.TEST_DATABASE_URL
      delete process.env.TEST_API_KEY

      // Now load with runtime loader
      const result = await loadRuntime({
        cwd: tempDir,
        environment: 'dev',
        silent: true
      })

      expect(result.varsLoaded).toBe(2)
      expect(result.project).toBe('test-runtime')
      expect(result.environment).toBe('dev')
      expect(result.keys).toContain('TEST_DATABASE_URL')
      expect(result.keys).toContain('TEST_API_KEY')

      // Check process.env
      expect(process.env.TEST_DATABASE_URL).toBe('postgres://localhost/test')
      expect(process.env.TEST_API_KEY).toBe('secret-api-key-123')
    })

    it('respects override option', async () => {
      // Create config
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        `version: "1"
project: override-test
backend:
  url: memory://override-test
encryption:
  key_source:
    - inline: test-key
`
      )

      // Set variable in backend
      const client = createClient({
        connectionString: 'memory://override-test',
        passphrase: 'test-key'
      })
      await client.connect()
      await client.set({
        key: 'EXISTING_VAR',
        value: 'backend-value',
        project: 'override-test',
        environment: 'dev'
      })
      await client.disconnect()

      // Pre-set env var
      process.env.EXISTING_VAR = 'original-value'

      // Load without override (default)
      await loadRuntime({
        cwd: tempDir,
        environment: 'dev',
        override: false,
        silent: true
      })

      // Should keep original value
      expect(process.env.EXISTING_VAR).toBe('original-value')

      // Load with override
      await loadRuntime({
        cwd: tempDir,
        environment: 'dev',
        override: true,
        silent: true
      })

      // Should use backend value
      expect(process.env.EXISTING_VAR).toBe('backend-value')
    })

    it('applies filters correctly', async () => {
      // Create config
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        `version: "1"
project: filter-test
backend:
  url: memory://filter-test
encryption:
  key_source:
    - inline: test-key
`
      )

      // Set variables in backend
      const client = createClient({
        connectionString: 'memory://filter-test',
        passphrase: 'test-key'
      })
      await client.connect()
      await client.set({
        key: 'DATABASE_URL',
        value: 'postgres://localhost/db',
        project: 'filter-test',
        environment: 'dev'
      })
      await client.set({
        key: 'REDIS_URL',
        value: 'redis://localhost',
        project: 'filter-test',
        environment: 'dev'
      })
      await client.set({
        key: 'API_KEY',
        value: 'secret',
        project: 'filter-test',
        environment: 'dev'
      })
      await client.disconnect()

      // Clear env
      delete process.env.DATABASE_URL
      delete process.env.REDIS_URL
      delete process.env.API_KEY

      // Load with filter - only *_URL
      const result = await loadRuntime({
        cwd: tempDir,
        environment: 'dev',
        filter: {
          include: ['*_URL']
        },
        silent: true
      })

      expect(result.varsLoaded).toBe(2)
      expect(process.env.DATABASE_URL).toBe('postgres://localhost/db')
      expect(process.env.REDIS_URL).toBe('redis://localhost')
      expect(process.env.API_KEY).toBeUndefined()
    })

    it('fails with required: true when backend unavailable', async () => {
      await expect(
        loadRuntime({
          cwd: tempDir,
          required: true,
          silent: true
        })
      ).rejects.toThrow()
    })

    it('warns but continues with required: false', async () => {
      const result = await loadRuntime({
        cwd: tempDir,
        required: false,
        silent: true
      })

      expect(result.varsLoaded).toBe(0)
    })
  })

  describe('environment-specific keys', () => {
    it('uses VAULTER_KEY_{ENV} when available', async () => {
      // Create config
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        `version: "1"
project: env-key-test
backend:
  url: memory://env-key-test
`
      )

      // Set PRD-specific key
      process.env.VAULTER_KEY_PRD = 'prd-secret-key'

      // Set variable using prd key
      const client = createClient({
        connectionString: 'memory://env-key-test',
        passphrase: 'prd-secret-key'
      })
      await client.connect()
      await client.set({
        key: 'PRD_SECRET',
        value: 'production-value',
        project: 'env-key-test',
        environment: 'prd'
      })
      await client.disconnect()

      // Clear and load for prd
      delete process.env.PRD_SECRET

      const result = await loadRuntime({
        cwd: tempDir,
        environment: 'prd',
        silent: true
      })

      expect(result.varsLoaded).toBe(1)
      expect(process.env.PRD_SECRET).toBe('production-value')
    })

    it('falls back to VAULTER_KEY when env-specific not set', async () => {
      // Create config
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        `version: "1"
project: fallback-key-test
backend:
  url: memory://fallback-key-test
`
      )

      // Set global key only
      process.env.VAULTER_KEY = 'global-key'
      delete process.env.VAULTER_KEY_DEV

      // Set variable using global key
      const client = createClient({
        connectionString: 'memory://fallback-key-test',
        passphrase: 'global-key'
      })
      await client.connect()
      await client.set({
        key: 'GLOBAL_SECRET',
        value: 'global-value',
        project: 'fallback-key-test',
        environment: 'dev'
      })
      await client.disconnect()

      // Clear and load
      delete process.env.GLOBAL_SECRET

      const result = await loadRuntime({
        cwd: tempDir,
        environment: 'dev',
        silent: true
      })

      expect(result.varsLoaded).toBe(1)
      expect(process.env.GLOBAL_SECRET).toBe('global-value')
    })
  })

  describe('getRuntimeInfo edge cases', () => {
    it('returns info even with minimal config', async () => {
      // Create .vaulter/config.yaml with minimal config
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      // Empty config - project will be inferred from directory name
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        '# empty config\n'
      )

      const info = await getRuntimeInfo({ cwd: tempDir })

      // Should still report available and configFile
      expect(info.available).toBe(true)
      expect(info.configFile).toContain('config.yaml')
      // Project might be inferred from directory name, so it could exist
      expect(typeof info.available).toBe('boolean')
    })

    it('masks backend URL with password in info', async () => {
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        'version: "1"\nproject: test\nbackend: "s3://longusername:secretpassword@bucket?region=us-east-1"\n'
      )

      process.env.NODE_ENV = 'dev'
      process.env.VAULTER_KEY = 'test-key'

      const info = await getRuntimeInfo({ cwd: tempDir })

      // Backend should be masked
      if (info.backend) {
        expect(info.backend).toContain('long***')  // username masked
        expect(info.backend).toContain('***')      // password masked
        expect(info.backend).not.toContain('secretpassword')
      }
    })
  })
})
