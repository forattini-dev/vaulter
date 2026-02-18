/**
 * Tests for monorepo.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  discoverServices,
  discoverConfiguredServices,
  discoverServicesFromOutputs,
  discoverServicesWithFallback,
  filterServices,
  findMonorepoRoot,
  isMonorepoFromConfig,
  isMonorepo,
  mergeServices,
  getCurrentService,
  formatServiceList,
  type ServiceInfo,
  type ServiceInfo
} from '../../src/lib/monorepo.js'

describe('monorepo', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-monorepo-test-'))
    originalCwd = process.cwd()
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function createServiceConfig(servicePath: string, config: object = {}) {
    const configDir = path.join(servicePath, '.vaulter')
    fs.mkdirSync(configDir, { recursive: true })

    const fullConfig = {
      version: '1',
      project: 'test-project',
      ...config
    }

    const yaml = Object.entries(fullConfig)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join('\n')

    fs.writeFileSync(path.join(configDir, 'config.yaml'), yaml)
  }

  describe('discoverServices', () => {
    it('should discover services in subdirectories', () => {
      // Create service directories
      const svc1 = path.join(tempDir, 'apps', 'svc-auth')
      const svc2 = path.join(tempDir, 'apps', 'svc-api')

      fs.mkdirSync(svc1, { recursive: true })
      fs.mkdirSync(svc2, { recursive: true })

      createServiceConfig(svc1, { service: 'svc-auth' })
      createServiceConfig(svc2, { service: 'svc-api' })

      const services = discoverServices(tempDir)

      expect(services.length).toBe(2)
      const names = services.map(s => s.name)
      expect(names).toContain('svc-auth')
      expect(names).toContain('svc-api')
    })

    it('should skip node_modules', () => {
      const nodeModules = path.join(tempDir, 'node_modules', 'some-package')
      fs.mkdirSync(nodeModules, { recursive: true })
      createServiceConfig(nodeModules, { service: 'should-not-find' })

      const services = discoverServices(tempDir)

      expect(services.find(s => s.name === 'should-not-find')).toBeUndefined()
    })

    it('should skip hidden directories', () => {
      const hiddenDir = path.join(tempDir, '.hidden-service')
      fs.mkdirSync(hiddenDir, { recursive: true })
      createServiceConfig(hiddenDir, { service: 'hidden' })

      const services = discoverServices(tempDir)

      expect(services.find(s => s.name === 'hidden')).toBeUndefined()
    })

    it('should skip dist/build directories', () => {
      const distDir = path.join(tempDir, 'dist', 'service')
      fs.mkdirSync(distDir, { recursive: true })
      createServiceConfig(distDir, { service: 'dist-service' })

      const services = discoverServices(tempDir)

      expect(services.find(s => s.name === 'dist-service')).toBeUndefined()
    })

    it('should return empty array when no services found', () => {
      const services = discoverServices(tempDir)
      expect(services).toEqual([])
    })

    it('should use directory name when service not in config', () => {
      const svcDir = path.join(tempDir, 'my-service')
      fs.mkdirSync(svcDir, { recursive: true })
      createServiceConfig(svcDir) // No service field

      const services = discoverServices(tempDir)

      expect(services.length).toBe(1)
      expect(services[0].name).toBe('my-service')
    })

    it('should include path and configDir in service info', () => {
      const svcDir = path.join(tempDir, 'test-svc')
      fs.mkdirSync(svcDir, { recursive: true })
      createServiceConfig(svcDir, { service: 'test-svc' })

      const services = discoverServices(tempDir)

      expect(services[0].path).toBe(svcDir)
      expect(services[0].configDir).toBe(path.join(svcDir, '.vaulter'))
    })

    it('should handle directories with empty/malformed YAML (uses defaults)', () => {
      const svcDir = path.join(tempDir, 'malformed-svc')
      const configDir = path.join(svcDir, '.vaulter')
      fs.mkdirSync(configDir, { recursive: true })
      // Write YAML that parses as null (not truly "invalid" syntax)
      fs.writeFileSync(path.join(configDir, 'config.yaml'), '---\n')

      const services = discoverServices(tempDir)

      // Service is discovered but uses directory name as service name
      const service = services.find(s => s.name === 'malformed-svc')
      expect(service).toBeDefined()
      expect(service!.name).toBe('malformed-svc')
    })

    it('should skip configured services when disabled', () => {
      const configDir = path.join(tempDir, '.vaulter')
      fs.mkdirSync(configDir)
      fs.writeFileSync(path.join(configDir, 'config.yaml'), `
version: "1"
project: monorepo
services:
  - configured-svc
`)

      const discovered = discoverServices(tempDir, { includeConfiguredServices: false })
      expect(discovered).toEqual([])
    })
  })

  describe('discoverConfiguredServices', () => {
    it('should resolve services from config.services with mixed declarations', () => {
      const config = {
        version: '1',
        project: 'monorepo',
        services: ['auth', { name: 'notifications', path: 'services/notifications' }],
        monorepo: {
          services_pattern: 'services/*'
        }
      }

      const authConfigDir = path.join(tempDir, 'services', 'auth', '.vaulter')
      const notificationsConfigDir = path.join(tempDir, 'services', 'notifications', '.vaulter')
      fs.mkdirSync(authConfigDir, { recursive: true })
      fs.mkdirSync(notificationsConfigDir, { recursive: true })
      fs.writeFileSync(path.join(notificationsConfigDir, 'config.yaml'), 'version: "1"\nservice: notifications\n')

      const services = discoverConfiguredServices(config as any, tempDir)

      expect(services).toHaveLength(2)
      expect(services.map(s => s.name)).toContain('auth')
      expect(services.map(s => s.name)).toContain('notifications')

      const notifications = services.find(s => s.name === 'notifications')
      expect(notifications?.path).toBe(path.join(tempDir, 'services', 'notifications'))
      expect(notifications?.config.service).toBe('notifications')

      const auth = services.find(s => s.name === 'auth')
      expect(auth?.path).toBe(path.join(tempDir, 'services', 'auth'))
      expect(auth?.config.service).toBe('auth')
    })
  })

  describe('discoverServicesFromOutputs', () => {
    it('should discover services from outputs and ignore shared marker', () => {
      const config = {
        version: '1',
        outputs: {
          web: 'apps/web',
          'svc-notifications': {
            path: 'services/notifications',
            service: 'notifications',
            filename: '.env'
          },
          __shared__: 'shared/.env'
        }
      }

      const services = discoverServicesFromOutputs(config as any, tempDir)

      expect(services).toHaveLength(2)
      expect(services.map(s => s.name).sort()).toEqual(['notifications', 'web'])

      const web = services.find(s => s.name === 'web')
      expect(web?.path).toBe(path.join(tempDir, 'apps/web'))
      const notifications = services.find(s => s.name === 'notifications')
      expect(notifications?.path).toBe(path.join(tempDir, 'services/notifications'))
    })
  })

  describe('discoverServicesWithFallback', () => {
    it('should fallback to outputs when no filesystem services are found', () => {
      const config = {
        version: '1',
        outputs: {
          api: {
            path: 'apps/api',
            service: 'svc-api'
          }
        }
      }

      const services = discoverServicesWithFallback(config as any, tempDir)
      expect(services).toHaveLength(1)
      expect(services[0].name).toBe('svc-api')
      expect(services[0].path).toBe(path.join(tempDir, 'apps/api'))
    })
  })

  describe('isMonorepoFromConfig', () => {
    it('should detect monorepo config from services declaration', () => {
      expect(isMonorepoFromConfig({ version: '1', project: 'x', services: ['svc-1'] } as any)).toBe(true)
    })

    it('should detect monorepo from monorepo config', () => {
      expect(isMonorepoFromConfig({
        version: '1',
        project: 'x',
        monorepo: { services_pattern: 'services/*' }
      } as any)).toBe(true)
    })

    it('should detect monorepo from deploy service outputs', () => {
      expect(isMonorepoFromConfig({
        version: '1',
        project: 'x',
        deploy: { services: { configs: 'services/{service}/configs/{env}.env' } }
      } as any)).toBe(true)
    })

    it('should return false for non-monorepo config', () => {
      expect(isMonorepoFromConfig({ version: '1', project: 'x' } as any)).toBe(false)
    })
  })

  describe('mergeServices', () => {
    it('should merge lists by unique service name keeping first occurrence', () => {
      const listA: ServiceInfo[] = [
        { name: 'shared', path: '/a', configDir: '/a', config: {} as any },
        { name: 'api', path: '/a/api', configDir: '/a/api', config: {} as any }
      ]
      const listB: ServiceInfo[] = [
        { name: 'api', path: '/b/api', configDir: '/b/api', config: {} as any },
        { name: 'worker', path: '/b/worker', configDir: '/b/worker', config: {} as any }
      ]

      const merged = mergeServices(listA, listB)

      expect(merged).toHaveLength(3)
      expect(merged.map(s => s.name)).toEqual(['shared', 'api', 'worker'])
      expect(merged[1].path).toBe('/a/api')
    })
  })

  describe('filterServices', () => {
    const mockServices: ServiceInfo[] = [
      { name: 'svc-auth', path: '/app/svc-auth', configDir: '', config: {} as any },
      { name: 'svc-api', path: '/app/svc-api', configDir: '', config: {} as any },
      { name: 'svc-gateway', path: '/app/svc-gateway', configDir: '', config: {} as any },
      { name: 'lib-common', path: '/app/lib-common', configDir: '', config: {} as any }
    ]

    it('should filter by exact name', () => {
      const filtered = filterServices(mockServices, 'svc-auth')
      expect(filtered.length).toBe(1)
      expect(filtered[0].name).toBe('svc-auth')
    })

    it('should filter by multiple names', () => {
      const filtered = filterServices(mockServices, 'svc-auth,svc-api')
      expect(filtered.length).toBe(2)
    })

    it('should filter by glob pattern', () => {
      const filtered = filterServices(mockServices, 'svc-*')
      expect(filtered.length).toBe(3)
      expect(filtered.every(s => s.name.startsWith('svc-'))).toBe(true)
    })

    it('should filter by pattern with * and ?', () => {
      // Note: ? only works when pattern also contains *
      const filtered = filterServices(mockServices, 'svc-*?')
      expect(filtered.length).toBe(3)
      expect(filtered.every(s => s.name.startsWith('svc-'))).toBe(true)
    })

    it('should return all services for empty pattern', () => {
      const filtered = filterServices(mockServices, '')
      expect(filtered.length).toBe(4)
    })

    it('should return empty array when no matches', () => {
      const filtered = filterServices(mockServices, 'non-existent')
      expect(filtered.length).toBe(0)
    })

    it('should handle multiple patterns with glob', () => {
      const filtered = filterServices(mockServices, 'svc-auth,lib-*')
      expect(filtered.length).toBe(2)
      expect(filtered.map(s => s.name)).toContain('svc-auth')
      expect(filtered.map(s => s.name)).toContain('lib-common')
    })
  })

  describe('findMonorepoRoot', () => {
    it('should find root when starting from nested service', () => {
      // Create root config
      createServiceConfig(tempDir, { project: 'monorepo' })

      // Create nested service
      const nestedService = path.join(tempDir, 'apps', 'nested', 'service')
      fs.mkdirSync(nestedService, { recursive: true })
      createServiceConfig(nestedService, { service: 'nested' })

      const root = findMonorepoRoot(nestedService)

      expect(root).toBe(tempDir)
    })

    it('should return null when no config found', () => {
      const emptyDir = path.join(tempDir, 'empty')
      fs.mkdirSync(emptyDir, { recursive: true })

      const root = findMonorepoRoot(emptyDir)

      expect(root).toBeNull()
    })

    it('should return the service dir if only one config exists', () => {
      const svcDir = path.join(tempDir, 'single-service')
      fs.mkdirSync(svcDir, { recursive: true })
      createServiceConfig(svcDir, { project: 'single' })

      const root = findMonorepoRoot(svcDir)

      expect(root).toBe(svcDir)
    })
  })

  describe('isMonorepo', () => {
    it('should return true when multiple services exist', () => {
      createServiceConfig(tempDir, { project: 'monorepo' })

      const svc1 = path.join(tempDir, 'svc1')
      const svc2 = path.join(tempDir, 'svc2')
      fs.mkdirSync(svc1, { recursive: true })
      fs.mkdirSync(svc2, { recursive: true })
      createServiceConfig(svc1, { service: 'svc1' })
      createServiceConfig(svc2, { service: 'svc2' })

      expect(isMonorepo(tempDir)).toBe(true)
    })

    it('should return false when only one service exists', () => {
      const svc1 = path.join(tempDir, 'svc1')
      fs.mkdirSync(svc1, { recursive: true })
      createServiceConfig(svc1, { service: 'svc1' })

      expect(isMonorepo(svc1)).toBe(false)
    })

    it('should return false when no config found', () => {
      expect(isMonorepo(tempDir)).toBe(false)
    })
  })

  describe('getCurrentService', () => {
    it('should return service info for directory with config', () => {
      const svcDir = path.join(tempDir, 'my-service')
      fs.mkdirSync(svcDir, { recursive: true })
      createServiceConfig(svcDir, { service: 'my-service' })

      const service = getCurrentService(svcDir)

      expect(service).not.toBeNull()
      expect(service!.name).toBe('my-service')
      expect(service!.path).toBe(svcDir)
    })

    it('should return null for directory without config', () => {
      const emptyDir = path.join(tempDir, 'empty')
      fs.mkdirSync(emptyDir, { recursive: true })

      const service = getCurrentService(emptyDir)

      expect(service).toBeNull()
    })

    it('should use directory name if no service in config', () => {
      const svcDir = path.join(tempDir, 'fallback-name')
      fs.mkdirSync(svcDir, { recursive: true })
      createServiceConfig(svcDir) // No service field

      const service = getCurrentService(svcDir)

      expect(service).not.toBeNull()
      expect(service!.name).toBe('fallback-name')
    })
  })

  describe('formatServiceList', () => {
    it('should format empty list', () => {
      const result = formatServiceList([])
      expect(result).toBe('No services found')
    })

    it('should format service list', () => {
      process.chdir(tempDir)

      const services: ServiceInfo[] = [
        { name: 'svc-auth', path: path.join(tempDir, 'apps', 'svc-auth'), configDir: '', config: {} as any },
        { name: 'svc-api', path: path.join(tempDir, 'apps', 'svc-api'), configDir: '', config: {} as any }
      ]

      const result = formatServiceList(services)

      expect(result).toContain('Services found:')
      expect(result).toContain('svc-auth')
      expect(result).toContain('svc-api')
      expect(result).toContain('apps/svc-auth')
      expect(result).toContain('apps/svc-api')
    })

    it('should show dot for current directory', () => {
      process.chdir(tempDir)

      const services: ServiceInfo[] = [
        { name: 'current', path: tempDir, configDir: '', config: {} as any }
      ]

      const result = formatServiceList(services)

      expect(result).toContain('current (.)')
    })
  })
})
