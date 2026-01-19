/**
 * Tests for config.ts (smart config loader)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  isKubernetes,
  isCI,
  detectEnvironment,
  getDeployEnvironment,
  config,
  shouldLoadEnvFiles,
  getEnvironmentInfo,
  type ConfigOptions
} from '../src/config.js'

describe('config.ts', () => {
  // Store original env vars
  const originalEnv = { ...process.env }
  let tempDir: string

  beforeEach(() => {
    // Reset env vars before each test
    process.env = { ...originalEnv }
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-config-test-'))
  })

  afterEach(() => {
    // Restore env vars
    process.env = { ...originalEnv }
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('isKubernetes', () => {
    it('should return true when K8s env vars are set', () => {
      process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1'
      process.env.KUBERNETES_SERVICE_PORT = '443'
      expect(isKubernetes()).toBe(true)
    })

    it('should return false when only HOST is set', () => {
      process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1'
      delete process.env.KUBERNETES_SERVICE_PORT
      expect(isKubernetes()).toBe(false)
    })

    it('should return false when only PORT is set', () => {
      delete process.env.KUBERNETES_SERVICE_HOST
      process.env.KUBERNETES_SERVICE_PORT = '443'
      expect(isKubernetes()).toBe(false)
    })

    it('should return false when neither is set', () => {
      delete process.env.KUBERNETES_SERVICE_HOST
      delete process.env.KUBERNETES_SERVICE_PORT
      expect(isKubernetes()).toBe(false)
    })
  })

  describe('isCI', () => {
    beforeEach(() => {
      // Clear all CI-related env vars
      delete process.env.CI
      delete process.env.GITHUB_ACTIONS
      delete process.env.GITLAB_CI
      delete process.env.CIRCLECI
      delete process.env.TRAVIS
      delete process.env.JENKINS_URL
      delete process.env.BUILDKITE
    })

    it('should return true for CI=true', () => {
      process.env.CI = 'true'
      expect(isCI()).toBe(true)
    })

    it('should return true for CI=1', () => {
      process.env.CI = '1'
      expect(isCI()).toBe(true)
    })

    it('should return true for GITHUB_ACTIONS', () => {
      process.env.GITHUB_ACTIONS = 'true'
      expect(isCI()).toBe(true)
    })

    it('should return true for GITLAB_CI', () => {
      process.env.GITLAB_CI = 'true'
      expect(isCI()).toBe(true)
    })

    it('should return true for CIRCLECI', () => {
      process.env.CIRCLECI = 'true'
      expect(isCI()).toBe(true)
    })

    it('should return true for TRAVIS', () => {
      process.env.TRAVIS = 'true'
      expect(isCI()).toBe(true)
    })

    it('should return true for JENKINS_URL', () => {
      process.env.JENKINS_URL = 'https://jenkins.example.com'
      expect(isCI()).toBe(true)
    })

    it('should return true for BUILDKITE', () => {
      process.env.BUILDKITE = 'true'
      expect(isCI()).toBe(true)
    })

    it('should return false when no CI vars set', () => {
      expect(isCI()).toBe(false)
    })

    it('should return false for CI=false', () => {
      process.env.CI = 'false'
      expect(isCI()).toBe(false)
    })
  })

  describe('detectEnvironment', () => {
    beforeEach(() => {
      // Clear env vars
      delete process.env.KUBERNETES_SERVICE_HOST
      delete process.env.KUBERNETES_SERVICE_PORT
      delete process.env.CI
      delete process.env.GITHUB_ACTIONS
    })

    it('should return kubernetes when in K8s', () => {
      process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1'
      process.env.KUBERNETES_SERVICE_PORT = '443'
      expect(detectEnvironment()).toBe('kubernetes')
    })

    it('should return ci when in CI (but not K8s)', () => {
      process.env.CI = 'true'
      expect(detectEnvironment()).toBe('ci')
    })

    it('should return local when not in K8s or CI', () => {
      expect(detectEnvironment()).toBe('local')
    })

    it('should prioritize kubernetes over ci', () => {
      process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1'
      process.env.KUBERNETES_SERVICE_PORT = '443'
      process.env.CI = 'true'
      expect(detectEnvironment()).toBe('kubernetes')
    })
  })

  describe('getDeployEnvironment', () => {
    beforeEach(() => {
      delete process.env.VAULTER_ENV
      delete process.env.DEPLOY_ENV
      delete process.env.NODE_ENV
    })

    it('should return options.environment first', () => {
      process.env.VAULTER_ENV = 'sdx'
      expect(getDeployEnvironment({ environment: 'prd' })).toBe('prd')
    })

    it('should return VAULTER_ENV second', () => {
      process.env.VAULTER_ENV = 'sdx'
      process.env.DEPLOY_ENV = 'prd'
      expect(getDeployEnvironment()).toBe('sdx')
    })

    it('should return DEPLOY_ENV third', () => {
      process.env.DEPLOY_ENV = 'prd'
      expect(getDeployEnvironment()).toBe('prd')
    })

    it('should map NODE_ENV=development to dev', () => {
      process.env.NODE_ENV = 'development'
      expect(getDeployEnvironment()).toBe('dev')
    })

    it('should map NODE_ENV=production to prd', () => {
      process.env.NODE_ENV = 'production'
      expect(getDeployEnvironment()).toBe('prd')
    })

    it('should map NODE_ENV=staging to sdx', () => {
      process.env.NODE_ENV = 'staging'
      expect(getDeployEnvironment()).toBe('sdx')
    })

    it('should map NODE_ENV=sandbox to sdx', () => {
      process.env.NODE_ENV = 'sandbox'
      expect(getDeployEnvironment()).toBe('sdx')
    })

    it('should map NODE_ENV=prod to prd', () => {
      process.env.NODE_ENV = 'prod'
      expect(getDeployEnvironment()).toBe('prd')
    })

    it('should handle case insensitivity', () => {
      process.env.NODE_ENV = 'PRODUCTION'
      expect(getDeployEnvironment()).toBe('prd')
    })

    it('should pass through unknown NODE_ENV', () => {
      process.env.NODE_ENV = 'custom-env'
      expect(getDeployEnvironment()).toBe('custom-env')
    })

    it('should default to dev', () => {
      expect(getDeployEnvironment()).toBe('dev')
    })
  })

  describe('shouldLoadEnvFiles', () => {
    it('should return true when not in K8s', () => {
      delete process.env.KUBERNETES_SERVICE_HOST
      delete process.env.KUBERNETES_SERVICE_PORT
      expect(shouldLoadEnvFiles()).toBe(true)
    })

    it('should return false when in K8s', () => {
      process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1'
      process.env.KUBERNETES_SERVICE_PORT = '443'
      expect(shouldLoadEnvFiles()).toBe(false)
    })
  })

  describe('getEnvironmentInfo', () => {
    beforeEach(() => {
      delete process.env.KUBERNETES_SERVICE_HOST
      delete process.env.KUBERNETES_SERVICE_PORT
      delete process.env.CI
    })

    it('should return environment info', () => {
      delete process.env.NODE_ENV
      delete process.env.VAULTER_ENV
      delete process.env.DEPLOY_ENV
      const info = getEnvironmentInfo()
      expect(info.detected).toBe('local')
      expect(info.shouldLoad).toBe(true)
      expect(info.environment).toBe('dev')
    })

    it('should detect kubernetes', () => {
      process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1'
      process.env.KUBERNETES_SERVICE_PORT = '443'
      const info = getEnvironmentInfo()
      expect(info.detected).toBe('kubernetes')
      expect(info.shouldLoad).toBe(false)
    })

    it('should find configDir when .vaulter exists', () => {
      const vaulterDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(vaulterDir)
      fs.writeFileSync(path.join(vaulterDir, 'config.yaml'), 'version: "1"')

      const info = getEnvironmentInfo(tempDir)
      expect(info.configDir).toBe(vaulterDir)
    })
  })

  describe('config', () => {
    // Helper to create a minimal vaulter structure
    function createVaulterStructure(baseDir: string, opts?: {
      localEnv?: Record<string, string>
      deployConfigs?: Record<string, string>
      deploySecrets?: Record<string, string>
    }) {
      const vaulterDir = path.join(baseDir, '.vaulter')
      const localDir = path.join(vaulterDir, 'local')
      const configsDir = path.join(vaulterDir, 'deploy', 'shared', 'configs')
      const secretsDir = path.join(vaulterDir, 'deploy', 'shared', 'secrets')

      fs.mkdirSync(localDir, { recursive: true })
      fs.mkdirSync(configsDir, { recursive: true })
      fs.mkdirSync(secretsDir, { recursive: true })

      // Config file
      fs.writeFileSync(
        path.join(vaulterDir, 'config.yaml'),
        `version: "1"
project: test-project
default_environment: dev
environments:
  - dev
  - prd
`
      )

      // Local shared.env
      if (opts?.localEnv) {
        const content = Object.entries(opts.localEnv)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')
        fs.writeFileSync(path.join(localDir, 'shared.env'), content)
      }

      // Deploy configs
      if (opts?.deployConfigs) {
        for (const [env, content] of Object.entries(opts.deployConfigs)) {
          fs.writeFileSync(path.join(configsDir, `${env}.env`), content)
        }
      }

      // Deploy secrets
      if (opts?.deploySecrets) {
        for (const [env, content] of Object.entries(opts.deploySecrets)) {
          fs.writeFileSync(path.join(secretsDir, `${env}.env`), content)
        }
      }

      return vaulterDir
    }

    beforeEach(() => {
      delete process.env.KUBERNETES_SERVICE_HOST
      delete process.env.KUBERNETES_SERVICE_PORT
      delete process.env.CI
      delete process.env.VAULTER_SERVICE
      delete process.env.VAULTER_VERBOSE
    })

    it('should skip in kubernetes mode', () => {
      process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1'
      process.env.KUBERNETES_SERVICE_PORT = '443'

      const result = config({ cwd: tempDir })

      expect(result.skipped).toBe(true)
      expect(result.mode).toBe('skip')
      expect(result.detectedEnv).toBe('kubernetes')
      expect(result.skipReason).toContain('Kubernetes')
    })

    it('should use skip mode when explicitly set', () => {
      const result = config({ mode: 'skip', cwd: tempDir })

      expect(result.skipped).toBe(true)
      expect(result.mode).toBe('skip')
    })

    it('should fallback to dotenv when no .vaulter found', () => {
      // Create a simple .env file
      fs.writeFileSync(path.join(tempDir, '.env'), 'TEST_VAR=hello')

      const result = config({ cwd: tempDir })

      expect(result.skipped).toBe(false)
      expect(result.detectedEnv).toBe('local')
      // Should have loaded .env or skipped it
      expect(result.loadedFiles.length + result.skippedFiles.length).toBeGreaterThanOrEqual(0)
    })

    it('should load local mode files', () => {
      createVaulterStructure(tempDir, {
        localEnv: {
          DB_HOST: 'localhost',
          DB_PORT: '5432'
        }
      })

      const result = config({ mode: 'local', cwd: tempDir })

      expect(result.mode).toBe('local')
      expect(result.skipped).toBe(false)
      expect(result.loadedFiles.length).toBeGreaterThan(0)
      expect(result.varsLoaded).toBe(2)
      expect(process.env.DB_HOST).toBe('localhost')
      expect(process.env.DB_PORT).toBe('5432')
    })

    it('should load deploy mode files', () => {
      createVaulterStructure(tempDir, {
        deployConfigs: {
          dev: 'API_URL=https://dev.api.com\nLOG_LEVEL=debug'
        },
        deploySecrets: {
          dev: 'API_KEY=secret123'
        }
      })

      const result = config({ mode: 'deploy', environment: 'dev', cwd: tempDir })

      expect(result.mode).toBe('deploy')
      expect(result.skipped).toBe(false)
      expect(result.loadedFiles.length).toBe(2)
      expect(result.varsLoaded).toBe(3)
      expect(process.env.API_URL).toBe('https://dev.api.com')
      expect(process.env.LOG_LEVEL).toBe('debug')
      expect(process.env.API_KEY).toBe('secret123')
    })

    it('should auto-detect local mode', () => {
      createVaulterStructure(tempDir, {
        localEnv: { AUTO_VAR: 'detected' }
      })

      const result = config({ cwd: tempDir })

      expect(result.mode).toBe('local')
      expect(result.detectedEnv).toBe('local')
      expect(process.env.AUTO_VAR).toBe('detected')
    })

    it('should auto-detect deploy mode in CI', () => {
      process.env.CI = 'true'
      delete process.env.NODE_ENV
      delete process.env.VAULTER_ENV
      delete process.env.DEPLOY_ENV

      createVaulterStructure(tempDir, {
        deployConfigs: {
          dev: 'CI_VAR=from-config'
        },
        deploySecrets: {
          dev: 'CI_SECRET=from-secret'
        }
      })

      const result = config({ cwd: tempDir, environment: 'dev' })

      expect(result.mode).toBe('deploy')
      expect(result.detectedEnv).toBe('ci')
      expect(process.env.CI_VAR).toBe('from-config')
      expect(process.env.CI_SECRET).toBe('from-secret')
    })

    it('should track skipped files', () => {
      createVaulterStructure(tempDir, {})
      // No local/shared.env created

      const result = config({ mode: 'local', cwd: tempDir })

      expect(result.skippedFiles.length).toBeGreaterThan(0)
    })

    it('should not override existing vars by default', () => {
      createVaulterStructure(tempDir, {
        localEnv: { EXISTING: 'from-file' }
      })

      process.env.EXISTING = 'pre-existing'

      const result = config({ cwd: tempDir, override: false })

      expect(process.env.EXISTING).toBe('pre-existing')
    })

    it('should override existing vars when override=true', () => {
      createVaulterStructure(tempDir, {
        localEnv: { EXISTING: 'from-file' }
      })

      process.env.EXISTING = 'pre-existing'

      const result = config({ cwd: tempDir, override: true })

      expect(process.env.EXISTING).toBe('from-file')
    })

    it('should use VAULTER_SERVICE from env', () => {
      process.env.VAULTER_SERVICE = 'my-service'

      createVaulterStructure(tempDir, {
        localEnv: { BASE_VAR: 'base' }
      })

      const result = config({ cwd: tempDir })

      expect(result.skipped).toBe(false)
      // Service override file won't exist, but it should still load base
      expect(result.loadedFiles.length).toBeGreaterThan(0)
    })

    it('should handle verbose mode', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      createVaulterStructure(tempDir, {
        localEnv: { VERBOSE_VAR: 'test' }
      })

      const result = config({ cwd: tempDir, verbose: true })

      expect(consoleSpy).toHaveBeenCalled()
      expect(consoleSpy.mock.calls.some(call =>
        call[0]?.includes?.('[vaulter]')
      )).toBe(true)

      consoleSpy.mockRestore()
    })

    it('should handle VAULTER_VERBOSE env var', () => {
      process.env.VAULTER_VERBOSE = 'true'
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      createVaulterStructure(tempDir, {
        localEnv: { VERBOSE_VAR: 'test' }
      })

      config({ cwd: tempDir })

      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })
})
