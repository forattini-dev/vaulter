/**
 * Tests for config-loader.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  findConfigDir,
  loadConfig,
  getProjectName,
  configExists,
  loadEncryptionKey,
  createDefaultConfig,
  getEnvFilePath,
  DEFAULT_CONFIG
} from '../../src/lib/config-loader.js'

describe('config-loader', () => {
  let tempDir: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minienv-config-test-'))
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    process.env = originalEnv
  })

  describe('findConfigDir', () => {
    it('should find .minienv directory in current directory', () => {
      const minienvDir = path.join(tempDir, '.minienv')
      fs.mkdirSync(minienvDir)
      fs.writeFileSync(path.join(minienvDir, 'config.yaml'), 'version: "1"')

      const result = findConfigDir(tempDir)
      expect(result).toBe(minienvDir)
    })

    it('should find .minienv directory in parent directory', () => {
      const parentDir = tempDir
      const childDir = path.join(tempDir, 'subdir')
      fs.mkdirSync(childDir)

      const minienvDir = path.join(parentDir, '.minienv')
      fs.mkdirSync(minienvDir)
      fs.writeFileSync(path.join(minienvDir, 'config.yaml'), 'version: "1"')

      const result = findConfigDir(childDir)
      expect(result).toBe(minienvDir)
    })

    it('should return null when no .minienv directory found', () => {
      const result = findConfigDir(tempDir)
      expect(result).toBeNull()
    })

    it('should not find config beyond max search depth', () => {
      // Create deeply nested directory
      let deepDir = tempDir
      for (let i = 0; i < 10; i++) {
        deepDir = path.join(deepDir, `level${i}`)
        fs.mkdirSync(deepDir)
      }

      // Create config at root
      const minienvDir = path.join(tempDir, '.minienv')
      fs.mkdirSync(minienvDir)
      fs.writeFileSync(path.join(minienvDir, 'config.yaml'), 'version: "1"')

      // Should not find it from very deep directory
      const result = findConfigDir(deepDir)
      expect(result).toBeNull()
    })
  })

  describe('loadConfig', () => {
    it('should return default config when no config found', () => {
      const config = loadConfig(tempDir)
      expect(config.version).toBe('1')
      expect(config.environments).toEqual(['dev', 'stg', 'prd', 'sbx', 'dr'])
      expect(config.default_environment).toBe('dev')
    })

    it('should load config from file', () => {
      const minienvDir = path.join(tempDir, '.minienv')
      fs.mkdirSync(minienvDir)
      fs.writeFileSync(path.join(minienvDir, 'config.yaml'), `
version: "1"
project: test-project
backend:
  url: memory://test
`)

      const config = loadConfig(tempDir)
      expect(config.project).toBe('test-project')
      expect(config.backend?.url).toBe('memory://test')
    })

    it('should merge config.local.yaml over config.yaml', () => {
      const minienvDir = path.join(tempDir, '.minienv')
      fs.mkdirSync(minienvDir)
      fs.writeFileSync(path.join(minienvDir, 'config.yaml'), `
version: "1"
project: test-project
backend:
  url: s3://bucket/path
`)
      fs.writeFileSync(path.join(minienvDir, 'config.local.yaml'), `
backend:
  url: memory://local-override
`)

      const config = loadConfig(tempDir)
      expect(config.project).toBe('test-project')
      expect(config.backend?.url).toBe('memory://local-override')
    })

    it('should expand environment variables in config', () => {
      process.env.TEST_BUCKET = 'my-bucket'
      process.env.TEST_REGION = 'us-west-2'

      const minienvDir = path.join(tempDir, '.minienv')
      fs.mkdirSync(minienvDir)
      fs.writeFileSync(path.join(minienvDir, 'config.yaml'), `
version: "1"
project: test-project
backend:
  url: s3://\${TEST_BUCKET}/path?region=\${TEST_REGION}
`)

      const config = loadConfig(tempDir)
      expect(config.backend?.url).toBe('s3://my-bucket/path?region=us-west-2')
    })

    it('should handle ${VAR:-default} syntax', () => {
      delete process.env.UNDEFINED_VAR

      const minienvDir = path.join(tempDir, '.minienv')
      fs.mkdirSync(minienvDir)
      fs.writeFileSync(path.join(minienvDir, 'config.yaml'), `
version: "1"
project: test-project
backend:
  url: s3://\${UNDEFINED_VAR:-fallback-bucket}/path
`)

      const config = loadConfig(tempDir)
      expect(config.backend?.url).toBe('s3://fallback-bucket/path')
    })

    it('should handle $VAR syntax', () => {
      process.env.MY_PROJECT = 'env-project'

      const minienvDir = path.join(tempDir, '.minienv')
      fs.mkdirSync(minienvDir)
      fs.writeFileSync(path.join(minienvDir, 'config.yaml'), `
version: "1"
project: $MY_PROJECT
`)

      const config = loadConfig(tempDir)
      expect(config.project).toBe('env-project')
    })

    it('should deep merge objects', () => {
      const minienvDir = path.join(tempDir, '.minienv')
      fs.mkdirSync(minienvDir)
      fs.writeFileSync(path.join(minienvDir, 'config.yaml'), `
version: "1"
project: test-project
security:
  paranoid: true
`)

      const config = loadConfig(tempDir)
      // Should have both the file's paranoid value AND default auto_encrypt
      expect(config.security?.paranoid).toBe(true)
      expect(config.security?.auto_encrypt?.patterns).toBeDefined()
    })

    describe('config inheritance (extends)', () => {
      it('should extend from parent config', () => {
        // Parent config
        const parentDir = path.join(tempDir, 'parent')
        const parentMinienv = path.join(parentDir, '.minienv')
        fs.mkdirSync(parentMinienv, { recursive: true })
        fs.writeFileSync(path.join(parentMinienv, 'config.yaml'), `
version: "1"
project: parent-project
backend:
  url: s3://shared-bucket/path
`)

        // Child config
        const childDir = path.join(tempDir, 'parent', 'child')
        const childMinienv = path.join(childDir, '.minienv')
        fs.mkdirSync(childMinienv, { recursive: true })
        fs.writeFileSync(path.join(childMinienv, 'config.yaml'), `
extends: ../../.minienv/config.yaml
service: child-service
`)

        const config = loadConfig(childDir)
        expect(config.project).toBe('parent-project')
        expect(config.service).toBe('child-service')
        expect(config.backend?.url).toBe('s3://shared-bucket/path')
      })

      it('should override parent values', () => {
        // Parent config
        const parentDir = path.join(tempDir, 'parent')
        const parentMinienv = path.join(parentDir, '.minienv')
        fs.mkdirSync(parentMinienv, { recursive: true })
        fs.writeFileSync(path.join(parentMinienv, 'config.yaml'), `
version: "1"
project: parent-project
default_environment: prd
`)

        // Child config
        const childDir = path.join(tempDir, 'parent', 'child')
        const childMinienv = path.join(childDir, '.minienv')
        fs.mkdirSync(childMinienv, { recursive: true })
        fs.writeFileSync(path.join(childMinienv, 'config.yaml'), `
extends: ../../.minienv/config.yaml
default_environment: dev
`)

        const config = loadConfig(childDir)
        expect(config.default_environment).toBe('dev')
      })

      it('should detect circular inheritance', () => {
        // Config A extends B
        const dirA = path.join(tempDir, 'a')
        const minienvA = path.join(dirA, '.minienv')
        fs.mkdirSync(minienvA, { recursive: true })

        // Config B extends A
        const dirB = path.join(tempDir, 'b')
        const minienvB = path.join(dirB, '.minienv')
        fs.mkdirSync(minienvB, { recursive: true })

        fs.writeFileSync(path.join(minienvA, 'config.yaml'), `
extends: ../../b/.minienv/config.yaml
project: a
`)
        fs.writeFileSync(path.join(minienvB, 'config.yaml'), `
extends: ../../a/.minienv/config.yaml
project: b
`)

        expect(() => loadConfig(dirA)).toThrow(/circular/i)
      })
    })
  })

  describe('getProjectName', () => {
    it('should return project name from config', () => {
      const config = { ...DEFAULT_CONFIG, project: 'my-project' }
      expect(getProjectName(config)).toBe('my-project')
    })

    it('should fallback to directory name when no project in config', () => {
      const config = { ...DEFAULT_CONFIG, project: '' }
      const name = getProjectName(config, tempDir)
      expect(name).toBe(path.basename(tempDir))
    })
  })

  describe('configExists', () => {
    it('should return true when config exists', () => {
      const minienvDir = path.join(tempDir, '.minienv')
      fs.mkdirSync(minienvDir)
      fs.writeFileSync(path.join(minienvDir, 'config.yaml'), 'version: "1"')

      expect(configExists(tempDir)).toBe(true)
    })

    it('should return false when config does not exist', () => {
      expect(configExists(tempDir)).toBe(false)
    })
  })

  describe('getEnvFilePath', () => {
    it('should return correct path for environment file', () => {
      const configDir = path.join(tempDir, '.minienv')
      const result = getEnvFilePath(configDir, 'dev')
      expect(result).toBe(path.join(configDir, 'environments', 'dev.env'))
    })

    it('should work for different environments', () => {
      const configDir = path.join(tempDir, '.minienv')
      expect(getEnvFilePath(configDir, 'prd')).toContain('prd.env')
      expect(getEnvFilePath(configDir, 'stg')).toContain('stg.env')
    })
  })

  describe('loadEncryptionKey', () => {
    it('should load key from environment variable', async () => {
      process.env.TEST_KEY = 'my-secret-key'

      const config = {
        ...DEFAULT_CONFIG,
        encryption: {
          key_source: [{ env: 'TEST_KEY' }]
        }
      }

      const key = await loadEncryptionKey(config)
      expect(key).toBe('my-secret-key')
    })

    it('should load key from file', async () => {
      const keyFile = path.join(tempDir, 'key')
      fs.writeFileSync(keyFile, 'file-secret-key\n')

      const config = {
        ...DEFAULT_CONFIG,
        encryption: {
          key_source: [{ file: keyFile }]
        }
      }

      const key = await loadEncryptionKey(config)
      expect(key).toBe('file-secret-key')
    })

    it('should try sources in order', async () => {
      // First source doesn't exist
      delete process.env.MISSING_KEY

      // Second source exists
      const keyFile = path.join(tempDir, 'key')
      fs.writeFileSync(keyFile, 'fallback-key')

      const config = {
        ...DEFAULT_CONFIG,
        encryption: {
          key_source: [
            { env: 'MISSING_KEY' },
            { file: keyFile }
          ]
        }
      }

      const key = await loadEncryptionKey(config)
      expect(key).toBe('fallback-key')
    })

    it('should fallback to MINIENV_KEY environment variable', async () => {
      process.env.MINIENV_KEY = 'minienv-fallback-key'

      const config = {
        ...DEFAULT_CONFIG,
        encryption: {
          key_source: [{ env: 'NONEXISTENT' }]
        }
      }

      const key = await loadEncryptionKey(config)
      expect(key).toBe('minienv-fallback-key')
    })

    it('should return null when no key found', async () => {
      delete process.env.MINIENV_KEY

      const config = {
        ...DEFAULT_CONFIG,
        encryption: {
          key_source: []
        }
      }

      const key = await loadEncryptionKey(config)
      expect(key).toBeNull()
    })

    it('should handle missing key_source', async () => {
      delete process.env.MINIENV_KEY

      const config = { ...DEFAULT_CONFIG }

      const key = await loadEncryptionKey(config)
      expect(key).toBeNull()
    })
  })

  describe('createDefaultConfig', () => {
    it('should create config directory structure', () => {
      const configDir = path.join(tempDir, '.minienv')
      createDefaultConfig(configDir, 'test-project')

      expect(fs.existsSync(configDir)).toBe(true)
      expect(fs.existsSync(path.join(configDir, 'environments'))).toBe(true)
      expect(fs.existsSync(path.join(configDir, 'config.yaml'))).toBe(true)
    })

    it('should write project name to config', () => {
      const configDir = path.join(tempDir, '.minienv')
      createDefaultConfig(configDir, 'my-awesome-project')

      const content = fs.readFileSync(path.join(configDir, 'config.yaml'), 'utf-8')
      expect(content).toContain('project: my-awesome-project')
    })

    it('should handle existing directory', () => {
      const configDir = path.join(tempDir, '.minienv')
      fs.mkdirSync(configDir, { recursive: true })

      // Should not throw
      createDefaultConfig(configDir, 'test-project')
      expect(fs.existsSync(path.join(configDir, 'config.yaml'))).toBe(true)
    })
  })

  describe('DEFAULT_CONFIG', () => {
    it('should have required fields', () => {
      expect(DEFAULT_CONFIG.version).toBe('1')
      expect(DEFAULT_CONFIG.environments).toContain('dev')
      expect(DEFAULT_CONFIG.environments).toContain('prd')
      expect(DEFAULT_CONFIG.default_environment).toBe('dev')
      expect(DEFAULT_CONFIG.sync?.conflict).toBe('local')
      expect(DEFAULT_CONFIG.security?.confirm_production).toBe(true)
    })

    it('should have auto_encrypt patterns', () => {
      const patterns = DEFAULT_CONFIG.security?.auto_encrypt?.patterns
      expect(patterns).toContain('*_KEY')
      expect(patterns).toContain('*_SECRET')
      expect(patterns).toContain('DATABASE_URL')
    })
  })
})
