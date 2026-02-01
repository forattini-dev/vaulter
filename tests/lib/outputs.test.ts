/**
 * Tests for outputs.ts - Framework-agnostic .env file generation
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeOutputTarget,
  normalizeOutputTargets,
  filterVarsByPatterns,
  getSharedVars,
  getSharedServiceVars,
  formatEnvFile,
  validateOutputsConfig
} from '../../src/lib/outputs.js'
import type { VaulterConfig } from '../../src/types.js'
import { VaulterClient } from '../../src/client.js'

describe('outputs', () => {
  describe('normalizeOutputTarget', () => {
    it('should normalize shorthand string to full object', () => {
      const result = normalizeOutputTarget('web', 'apps/web', 'dev')

      expect(result).toEqual({
        name: 'web',
        path: 'apps/web',
        filename: '.env',
        include: [],
        exclude: [],
        inherit: true
      })
    })

    it('should normalize full object with defaults', () => {
      const result = normalizeOutputTarget('api', { path: 'apps/api' }, 'dev')

      expect(result).toEqual({
        name: 'api',
        path: 'apps/api',
        filename: '.env',
        include: [],
        exclude: [],
        inherit: true
      })
    })

    it('should preserve custom values', () => {
      const result = normalizeOutputTarget('web', {
        path: 'apps/web',
        filename: '.env.local',
        include: ['NEXT_PUBLIC_*'],
        exclude: ['DATABASE_*'],
        inherit: false
      }, 'dev')

      expect(result).toEqual({
        name: 'web',
        path: 'apps/web',
        filename: '.env.local',
        include: ['NEXT_PUBLIC_*'],
        exclude: ['DATABASE_*'],
        inherit: false
      })
    })

    it('should replace {env} placeholder in filename', () => {
      const result = normalizeOutputTarget('api', {
        path: 'apps/api',
        filename: '.env.{env}'
      }, 'production')

      expect(result.filename).toBe('.env.production')
    })

    it('should default inherit to true when not specified', () => {
      const result = normalizeOutputTarget('api', { path: 'apps/api' }, 'dev')
      expect(result.inherit).toBe(true)
    })

    it('should set inherit to false when explicitly false', () => {
      const result = normalizeOutputTarget('api', {
        path: 'apps/api',
        inherit: false
      }, 'dev')
      expect(result.inherit).toBe(false)
    })

    it('should accept "file" as alias for "filename"', () => {
      // @ts-expect-error file is not in types but accepted at runtime
      const result = normalizeOutputTarget('web', {
        path: 'apps/web',
        file: '.env.local'
      }, 'dev')
      expect(result.filename).toBe('.env.local')
    })
  })

  describe('normalizeOutputTargets', () => {
    it('should return empty array when no outputs in config', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test'
      }

      const result = normalizeOutputTargets(config, 'dev')
      expect(result).toEqual([])
    })

    it('should normalize all outputs from config', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        outputs: {
          web: 'apps/web',
          api: { path: 'apps/api', filename: '.env.local' }
        }
      }

      const result = normalizeOutputTargets(config, 'dev')

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('web')
      expect(result[0].path).toBe('apps/web')
      expect(result[1].name).toBe('api')
      expect(result[1].filename).toBe('.env.local')
    })
  })

  describe('filterVarsByPatterns', () => {
    const vars = {
      NEXT_PUBLIC_API_URL: 'https://api.example.com',
      NEXT_PUBLIC_SITE_NAME: 'My Site',
      DATABASE_URL: 'postgres://localhost/db',
      DATABASE_HOST: 'localhost',
      REDIS_URL: 'redis://localhost',
      LOG_LEVEL: 'debug',
      NODE_ENV: 'development'
    }

    it('should return all vars when include is empty', () => {
      const result = filterVarsByPatterns(vars, [], [])
      expect(Object.keys(result)).toHaveLength(7)
    })

    it('should filter by include patterns', () => {
      const result = filterVarsByPatterns(vars, ['NEXT_PUBLIC_*'], [])

      expect(Object.keys(result)).toEqual([
        'NEXT_PUBLIC_API_URL',
        'NEXT_PUBLIC_SITE_NAME'
      ])
    })

    it('should filter by multiple include patterns', () => {
      const result = filterVarsByPatterns(vars, ['NEXT_PUBLIC_*', 'LOG_LEVEL'], [])

      expect(Object.keys(result)).toEqual([
        'NEXT_PUBLIC_API_URL',
        'NEXT_PUBLIC_SITE_NAME',
        'LOG_LEVEL'
      ])
    })

    it('should apply exclude after include', () => {
      const result = filterVarsByPatterns(vars, [], ['DATABASE_*'])

      expect(Object.keys(result)).not.toContain('DATABASE_URL')
      expect(Object.keys(result)).not.toContain('DATABASE_HOST')
      expect(Object.keys(result)).toContain('REDIS_URL')
    })

    it('should combine include and exclude', () => {
      const result = filterVarsByPatterns(
        vars,
        ['DATABASE_*', 'REDIS_*'],
        ['*_HOST']
      )

      expect(Object.keys(result)).toEqual([
        'DATABASE_URL',
        'REDIS_URL'
      ])
    })

    it('should preserve values', () => {
      const result = filterVarsByPatterns(vars, ['DATABASE_URL'], [])

      expect(result.DATABASE_URL).toBe('postgres://localhost/db')
    })
  })

  describe('getSharedVars', () => {
    const vars = {
      LOG_LEVEL: 'debug',
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://localhost/db',
      SENTRY_DSN: 'https://sentry.io/123'
    }

    it('should return empty object when no shared config', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test'
      }

      const result = getSharedVars(vars, config)
      expect(result).toEqual({})
    })

    it('should return empty object when shared.include is empty', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        shared: { include: [] }
      }

      const result = getSharedVars(vars, config)
      expect(result).toEqual({})
    })

    it('should filter vars by shared patterns', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        shared: { include: ['LOG_LEVEL', 'NODE_ENV'] }
      }

      const result = getSharedVars(vars, config)

      expect(result).toEqual({
        LOG_LEVEL: 'debug',
        NODE_ENV: 'development'
      })
    })

    it('should support wildcard patterns in shared', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        shared: { include: ['SENTRY_*', 'LOG_*'] }
      }

      const result = getSharedVars(vars, config)

      expect(result).toEqual({
        LOG_LEVEL: 'debug',
        SENTRY_DSN: 'https://sentry.io/123'
      })
    })
  })

  describe('formatEnvFile', () => {
    it('should format simple values', () => {
      const result = formatEnvFile({
        API_URL: 'https://api.example.com',
        DEBUG: 'true'
      })

      expect(result).toBe('API_URL=https://api.example.com\nDEBUG=true\n')
    })

    it('should sort keys alphabetically', () => {
      const result = formatEnvFile({
        ZEBRA: '1',
        APPLE: '2',
        MANGO: '3'
      })

      expect(result).toBe('APPLE=2\nMANGO=3\nZEBRA=1\n')
    })

    it('should quote values with spaces', () => {
      const result = formatEnvFile({
        MESSAGE: 'Hello World'
      })

      expect(result).toBe('MESSAGE="Hello World"\n')
    })

    it('should quote values with newlines and escape them', () => {
      const result = formatEnvFile({
        MULTILINE: 'Line1\nLine2'
      })

      expect(result).toBe('MULTILINE="Line1\\nLine2"\n')
    })

    it('should quote values with special characters', () => {
      const result = formatEnvFile({
        WITH_HASH: 'value#comment',
        WITH_DOLLAR: 'price$100'
      })

      expect(result).toContain('WITH_DOLLAR="price$100"')
      expect(result).toContain('WITH_HASH="value#comment"')
    })

    it('should escape quotes in values', () => {
      const result = formatEnvFile({
        QUOTED: 'He said "hello"'
      })

      expect(result).toBe('QUOTED="He said \\"hello\\""\n')
    })

    it('should handle empty values', () => {
      const result = formatEnvFile({
        EMPTY: ''
      })

      expect(result).toBe('EMPTY=\n')
    })

    it('should handle empty object', () => {
      const result = formatEnvFile({})
      expect(result).toBe('\n')
    })
  })

  describe('validateOutputsConfig', () => {
    it('should return no errors for valid config', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        outputs: {
          web: 'apps/web',
          api: { path: 'apps/api' }
        }
      }

      const errors = validateOutputsConfig(config)
      expect(errors).toEqual([])
    })

    it('should return no errors when outputs is undefined', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test'
      }

      const errors = validateOutputsConfig(config)
      expect(errors).toEqual([])
    })

    it('should detect empty path in shorthand', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        outputs: {
          web: '',
          api: '  '
        }
      }

      const errors = validateOutputsConfig(config)
      expect(errors).toContain('Output "web": path cannot be empty')
      expect(errors).toContain('Output "api": path cannot be empty')
    })

    it('should detect missing path in object', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        outputs: {
          // @ts-expect-error testing invalid config
          web: { filename: '.env' }
        }
      }

      const errors = validateOutputsConfig(config)
      expect(errors).toContain('Output "web": path is required')
    })

    it('should detect invalid include type', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        outputs: {
          // @ts-expect-error testing invalid config
          web: { path: 'apps/web', include: 'NEXT_PUBLIC_*' }
        }
      }

      const errors = validateOutputsConfig(config)
      expect(errors).toContain('Output "web": include must be an array')
    })

    it('should detect invalid exclude type', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        outputs: {
          // @ts-expect-error testing invalid config
          web: { path: 'apps/web', exclude: 'DATABASE_*' }
        }
      }

      const errors = validateOutputsConfig(config)
      expect(errors).toContain('Output "web": exclude must be an array')
    })

    it('should detect invalid inherit type', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        outputs: {
          // @ts-expect-error testing invalid config
          web: { path: 'apps/web', inherit: 'yes' }
        }
      }

      const errors = validateOutputsConfig(config)
      expect(errors).toContain('Output "web": inherit must be a boolean')
    })

    it('should validate shared config', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        // @ts-expect-error testing invalid config
        shared: { include: 'LOG_LEVEL' }
      }

      const errors = validateOutputsConfig(config)
      expect(errors).toContain('shared.include must be an array')
    })

    it('should detect invalid output value (null)', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        outputs: {
          // @ts-expect-error testing invalid config
          web: null
        }
      }

      const errors = validateOutputsConfig(config)
      expect(errors).toContain('Output "web": must be a string or object')
    })

    it('should detect invalid output value (number)', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        outputs: {
          // @ts-expect-error testing invalid config
          api: 123
        }
      }

      const errors = validateOutputsConfig(config)
      expect(errors).toContain('Output "api": must be a string or object')
    })

    it('should accept "file" as alias for "filename"', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        outputs: {
          // @ts-expect-error file is not in types but accepted at runtime
          web: { path: 'apps/web', file: '.env.local' }
        }
      }

      const errors = validateOutputsConfig(config)
      expect(errors).toEqual([])
    })

    it('should detect unknown field with no suggestion', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        outputs: {
          // @ts-expect-error testing unknown field
          web: { path: 'apps/web', foobar: 'test' }
        }
      }

      const errors = validateOutputsConfig(config)
      expect(errors[0]).toContain('Output "web": unknown field "foobar"')
      expect(errors[0]).toContain('Valid fields:')
    })

    it('should suggest corrections for common typos', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        outputs: {
          // @ts-expect-error testing unknown field
          web: { path: 'apps/web', dir: '/wrong', pattern: ['*'] }
        }
      }

      const errors = validateOutputsConfig(config)
      expect(errors).toContain('Output "web": unknown field "dir". Did you mean "path"?')
      expect(errors).toContain('Output "web": unknown field "pattern". Did you mean "include"?')
    })
  })

  describe('getSharedServiceVars', () => {
    it('should fetch vars from __shared__ service', async () => {
      const client = new VaulterClient({ connectionString: 'memory://test-shared' })
      await client.connect()

      // Set vars in __shared__ service
      await client.set({ key: 'LOG_LEVEL', value: 'debug', project: 'p', environment: 'dev', service: '__shared__' })
      await client.set({ key: 'NODE_ENV', value: 'development', project: 'p', environment: 'dev', service: '__shared__' })

      // Set vars in other service (should NOT be returned)
      await client.set({ key: 'API_KEY', value: 'secret', project: 'p', environment: 'dev', service: 'api' })

      const result = await getSharedServiceVars(client, 'p', 'dev')

      expect(result).toEqual({
        LOG_LEVEL: 'debug',
        NODE_ENV: 'development'
      })
    })

    it('should return empty object when no __shared__ vars exist', async () => {
      const client = new VaulterClient({ connectionString: 'memory://test-no-shared' })
      await client.connect()

      // Only vars in regular service
      await client.set({ key: 'API_KEY', value: 'secret', project: 'p', environment: 'dev', service: 'api' })

      const result = await getSharedServiceVars(client, 'p', 'dev')

      expect(result).toEqual({})
    })
  })
})
