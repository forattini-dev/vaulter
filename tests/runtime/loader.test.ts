/**
 * Runtime Loader Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

    it('throws and logs error with required true when backend missing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(
        loadRuntime({
          cwd: tempDir,
          required: true,
          silent: false,
          environment: 'dev'
        })
      ).rejects.toThrow('No backend configured')

      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('warns when backend is missing in loud, non-fatal mode', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await loadRuntime({
        cwd: tempDir,
        required: false,
        silent: false
      })

      expect(result.varsLoaded).toBe(0)
      expect(result.backend).toBe('none')
      expect(warnSpy).toHaveBeenCalledTimes(1)

      warnSpy.mockRestore()
    })

    it('respects verbose mode during successful runtime load', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      // Create config
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        `version: "1"
project: verbose-runtime
backend:
  url: memory://verbose-runtime
encryption:
  key_source:
    - inline: test-passphrase
`
      )

      const client = createClient({
        connectionString: 'memory://verbose-runtime',
        passphrase: 'test-passphrase'
      })
      await client.connect()
      await client.set({
        key: 'VERBOSE_VAR',
        value: 'verbose-value',
        project: 'verbose-runtime',
        environment: 'dev'
      })
      await client.disconnect()

      delete process.env.VERBOSE_VAR

      const result = await loadRuntime({
        cwd: tempDir,
        environment: 'dev',
        silent: false,
        verbose: true
      })

      expect(result.varsLoaded).toBe(1)
      expect(process.env.VERBOSE_VAR).toBe('verbose-value')
      expect(logSpy).toHaveBeenCalled()

      logSpy.mockRestore()
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

    it('masks backend URL with user info in info', async () => {
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        `version: "1"
project: runtime-url-mask
backend:
  url: "s3://user-with-long-name:token123@bucket"`
      )

      const info = await getRuntimeInfo({ cwd: tempDir })

      expect(info.backend).toBeDefined()
      expect(info.backend).toContain('user***')
      expect(info.backend).toContain('***')
      expect(info.backend).not.toContain('token123')
    })
  })

  describe('loadRuntime edge cases', () => {
    it('loads using direct config object without file discovery', async () => {
      const config = {
        version: '1' as const,
        project: 'runtime-direct',
        backend: {
          url: 'memory://runtime-direct'
        },
        environments: ['dev'],
        encryption: {
          keys: {
            dev: { mode: 'symmetric' }
          }
        }
      }

      const client = createClient({
        connectionString: 'memory://runtime-direct',
        passphrase: undefined
      })
      await client.connect()
      await client.set({
        key: 'DIRECT_VAR',
        value: 'direct-value',
        project: 'runtime-direct',
        environment: 'dev'
      })
      await client.disconnect()

      const result = await loadRuntime({
        config,
        cwd: tempDir,
        silent: true,
        environment: 'dev'
      })

      expect(result.varsLoaded).toBe(1)
      expect(result.project).toBe('runtime-direct')
      expect(process.env.DIRECT_VAR).toBe('direct-value')
    })

    it('uses explicit configPath as project root', async () => {
      const projectRoot = path.join(tempDir, 'root-project')
      const vaulterDir = path.join(projectRoot, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        `version: "1"
project: root-project-runtime
backend:
  url: memory://runtime-root
`
      )

      const client = createClient({
        connectionString: 'memory://runtime-root',
        passphrase: undefined
      })
      await client.connect()
      await client.set({
        key: 'ROOT_VAR',
        value: 'root-value',
        project: 'root-project-runtime',
        environment: 'dev'
      })
      await client.disconnect()

      process.env.VAULTER_KEY = undefined

      const result = await loadRuntime({
        configPath: projectRoot,
        cwd: tempDir,
        environment: 'dev',
        silent: true
      })

      expect(result.varsLoaded).toBe(1)
      expect(process.env.ROOT_VAR).toBe('root-value')
    })

    it('falls back to NODE_ENV for environment when not explicit', async () => {
      process.env.NODE_ENV = 'prd'

      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        `version: "1"
project: runtime-node-env
backend:
  url: memory://runtime-node-env
environments:
  - prd
encryption:
  key_source:
    - inline: test-key
`
      )

      const client = createClient({
        connectionString: 'memory://runtime-node-env',
        passphrase: 'test-key'
      })
      await client.connect()
      await client.set({
        key: 'ENV_KEY',
        value: 'env-value',
        project: 'runtime-node-env',
        environment: 'prd'
      })
      await client.disconnect()

      delete process.env.ENV_KEY

      const result = await loadRuntime({
        cwd: tempDir,
        silent: true
      })

      expect(result.environment).toBe('prd')
      expect(process.env.ENV_KEY).toBe('env-value')
    })

    it('loads from an explicit .vaulter configPath', async () => {
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        'version: "1"\nproject: runtime-configpath\nbackend:\n  url: memory://runtime-configpath\n'
      )

      const client = createClient({
        connectionString: 'memory://runtime-configpath',
        passphrase: 'runtime-configpath-key'
      })
      await client.connect()
      await client.set({
        key: 'PATH_VAR',
        value: 'path-value',
        project: 'runtime-configpath',
        environment: 'dev'
      })
      await client.disconnect()
      process.env.VAULTER_KEY = 'runtime-configpath-key'

      const result = await loadRuntime({
        configPath: vaulterDir,
        cwd: tempDir,
        silent: true,
        environment: 'dev'
      })

      expect(result.varsLoaded).toBe(1)
      expect(process.env.PATH_VAR).toBe('path-value')
    })

    it('supports onError callback and throws with required runtime config', async () => {
      const onError = vi.fn()

      await expect(
        loadRuntime({
          cwd: tempDir,
          required: true,
          silent: true,
          onError
        })
      ).rejects.toThrow()

      expect(onError).toHaveBeenCalledTimes(1)
    })

    it('returns info when config is invalid on parse', async () => {
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(path.join(vaulterDir, 'config.yaml'), '::: invalid yaml :::')

      const info = await getRuntimeInfo({ cwd: tempDir })

      expect(info.available).toBe(true)
      expect(info.project).toBeUndefined()
      expect(info.configFile).toContain('config.yaml')
    })

    it('fails fast when asymmetric mode is configured but no private key is available', async () => {
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir, { recursive: true })
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        `version: "1"
project: runtime-asymmetric
encryption:
  mode: asymmetric
  keys:
    dev:
      mode: asymmetric
backend:
  url: memory://runtime-asymmetric
`
      )

      await expect(
        loadRuntime({
          cwd: tempDir,
          required: true,
          environment: 'dev',
          silent: true
        })
      ).rejects.toThrow('Asymmetric encryption mode requires a private key')
    })

    it('uses explicit runtime encryption key even without config key configuration', async () => {
      const client = createClient({
        connectionString: 'memory://runtime-direct-key',
        passphrase: 'explicit-secret'
      })
      await client.connect()
      await client.set({
        key: 'EXPLICIT_KEY_VAR',
        value: 'explicit-value',
        project: 'runtime-direct-key',
        environment: 'dev'
      })
      await client.disconnect()

      const result = await loadRuntime({
        config: {
          version: '1' as const,
          project: 'runtime-direct-key',
          backend: {
            url: 'memory://runtime-direct-key'
          }
        },
        cwd: tempDir,
        environment: 'dev',
        encryptionKey: 'explicit-secret',
        silent: true
      })

      expect(result.varsLoaded).toBe(1)
      expect(process.env.EXPLICIT_KEY_VAR).toBe('explicit-value')
    })
  })
})
