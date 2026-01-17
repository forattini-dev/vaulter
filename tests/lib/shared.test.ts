/**
 * Tests for shared.ts - Shared variables inheritance module
 */
import { describe, it, expect } from 'vitest'
import {
  SHARED_SERVICE,
  isSharedService,
  normalizeServiceName,
  resolveVariables,
  calculateInheritanceStats,
  toRecord,
  getAffectedServices,
  formatSource
} from '../../src/lib/shared.js'

describe('shared', () => {
  describe('SHARED_SERVICE constant', () => {
    it('should be __shared__', () => {
      expect(SHARED_SERVICE).toBe('__shared__')
    })
  })

  describe('isSharedService', () => {
    it('should return true for __shared__', () => {
      expect(isSharedService('__shared__')).toBe(true)
    })

    it('should return true for "shared"', () => {
      expect(isSharedService('shared')).toBe(true)
    })

    it('should return false for regular service name', () => {
      expect(isSharedService('api')).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isSharedService(undefined)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isSharedService('')).toBe(false)
    })
  })

  describe('normalizeServiceName', () => {
    it('should return __shared__ for "shared"', () => {
      expect(normalizeServiceName('shared')).toBe(SHARED_SERVICE)
    })

    it('should return __shared__ when isShared is true', () => {
      expect(normalizeServiceName('api', true)).toBe(SHARED_SERVICE)
    })

    it('should return __shared__ when isShared is true and service is undefined', () => {
      expect(normalizeServiceName(undefined, true)).toBe(SHARED_SERVICE)
    })

    it('should return original service name when not shared', () => {
      expect(normalizeServiceName('api')).toBe('api')
    })

    it('should return undefined when service is undefined', () => {
      expect(normalizeServiceName(undefined)).toBe(undefined)
    })
  })

  describe('resolveVariables', () => {
    it('should return shared vars when no service vars', () => {
      const sharedVars = { DB_URL: 'shared-db', API_KEY: 'shared-key' }
      const serviceVars = {}

      const resolved = resolveVariables(sharedVars, serviceVars)

      expect(resolved.size).toBe(2)
      expect(resolved.get('DB_URL')).toEqual({
        key: 'DB_URL',
        value: 'shared-db',
        source: 'shared'
      })
    })

    it('should return service vars when no shared vars', () => {
      const sharedVars = {}
      const serviceVars = { PORT: '3000' }

      const resolved = resolveVariables(sharedVars, serviceVars)

      expect(resolved.size).toBe(1)
      expect(resolved.get('PORT')).toEqual({
        key: 'PORT',
        value: '3000',
        source: 'service'
      })
    })

    it('should mark overrides correctly', () => {
      const sharedVars = { DB_URL: 'shared-db' }
      const serviceVars = { DB_URL: 'service-db' }

      const resolved = resolveVariables(sharedVars, serviceVars)

      expect(resolved.size).toBe(1)
      expect(resolved.get('DB_URL')).toEqual({
        key: 'DB_URL',
        value: 'service-db',
        source: 'override',
        originalService: SHARED_SERVICE
      })
    })

    it('should handle mixed inheritance', () => {
      const sharedVars = { DB_URL: 'shared-db', LOG_LEVEL: 'info' }
      const serviceVars = { DB_URL: 'service-db', PORT: '3000' }

      const resolved = resolveVariables(sharedVars, serviceVars)

      expect(resolved.size).toBe(3)
      expect(resolved.get('DB_URL')?.source).toBe('override')
      expect(resolved.get('LOG_LEVEL')?.source).toBe('shared')
      expect(resolved.get('PORT')?.source).toBe('service')
    })

    it('should handle empty inputs', () => {
      const resolved = resolveVariables({}, {})
      expect(resolved.size).toBe(0)
    })
  })

  describe('calculateInheritanceStats', () => {
    it('should calculate correct stats for inheritance', () => {
      const sharedVars = { A: '1', B: '2', C: '3' }
      const serviceVars = { B: 'override', D: 'local' }

      const stats = calculateInheritanceStats('api', sharedVars, serviceVars)

      expect(stats).toEqual({
        service: 'api',
        total: 4, // A, B (override), C, D
        inherited: 2, // A, C
        overrides: 1, // B
        serviceOnly: 1 // D
      })
    })

    it('should handle all shared vars', () => {
      const sharedVars = { A: '1', B: '2' }
      const serviceVars = {}

      const stats = calculateInheritanceStats('api', sharedVars, serviceVars)

      expect(stats.inherited).toBe(2)
      expect(stats.overrides).toBe(0)
      expect(stats.serviceOnly).toBe(0)
    })

    it('should handle all service vars', () => {
      const sharedVars = {}
      const serviceVars = { A: '1', B: '2' }

      const stats = calculateInheritanceStats('api', sharedVars, serviceVars)

      expect(stats.inherited).toBe(0)
      expect(stats.overrides).toBe(0)
      expect(stats.serviceOnly).toBe(2)
    })

    it('should handle all overrides', () => {
      const sharedVars = { A: '1', B: '2' }
      const serviceVars = { A: 'x', B: 'y' }

      const stats = calculateInheritanceStats('api', sharedVars, serviceVars)

      expect(stats.inherited).toBe(0)
      expect(stats.overrides).toBe(2)
      expect(stats.serviceOnly).toBe(0)
    })
  })

  describe('toRecord', () => {
    it('should convert resolved vars to record', () => {
      const sharedVars = { A: '1' }
      const serviceVars = { B: '2' }
      const resolved = resolveVariables(sharedVars, serviceVars)

      const record = toRecord(resolved)

      expect(record).toEqual({ A: '1', B: '2' })
    })

    it('should use override values', () => {
      const sharedVars = { A: 'shared' }
      const serviceVars = { A: 'override' }
      const resolved = resolveVariables(sharedVars, serviceVars)

      const record = toRecord(resolved)

      expect(record).toEqual({ A: 'override' })
    })

    it('should handle empty map', () => {
      const resolved = new Map()
      const record = toRecord(resolved)
      expect(record).toEqual({})
    })
  })

  describe('getAffectedServices', () => {
    it('should return services that inherit a key', () => {
      const services = ['api', 'web', 'worker']
      const getServiceVars = (service: string) => {
        if (service === 'api') return { DB_URL: 'api-db' }
        return {}
      }

      const affected = getAffectedServices('DB_URL', services, getServiceVars)

      expect(affected).toEqual(['web', 'worker'])
    })

    it('should return empty array if all services override', () => {
      const services = ['api', 'web']
      const getServiceVars = () => ({ DB_URL: 'override' })

      const affected = getAffectedServices('DB_URL', services, getServiceVars)

      expect(affected).toEqual([])
    })

    it('should return all services if none override', () => {
      const services = ['api', 'web', 'worker']
      const getServiceVars = () => ({})

      const affected = getAffectedServices('DB_URL', services, getServiceVars)

      expect(affected).toEqual(['api', 'web', 'worker'])
    })

    it('should handle empty services list', () => {
      const affected = getAffectedServices('KEY', [], () => ({}))
      expect(affected).toEqual([])
    })
  })

  describe('formatSource', () => {
    it('should format "shared" as "inherited"', () => {
      expect(formatSource('shared')).toBe('inherited')
    })

    it('should format "override" as "override"', () => {
      expect(formatSource('override')).toBe('override')
    })

    it('should format "service" as "local"', () => {
      expect(formatSource('service')).toBe('local')
    })
  })
})
