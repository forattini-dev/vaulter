/**
 * Tests for secret-patterns.ts
 */

import { describe, it, expect } from 'vitest'
import { getSecretPatterns, splitVarsBySecret } from '../../src/lib/secret-patterns.js'
import { DEFAULT_SECRET_PATTERNS } from '../../src/types.js'
import type { MiniEnvConfig } from '../../src/types.js'

describe('secret-patterns', () => {
  describe('getSecretPatterns', () => {
    it('should return DEFAULT_SECRET_PATTERNS when config is null', () => {
      const patterns = getSecretPatterns(null)
      expect(patterns).toEqual(DEFAULT_SECRET_PATTERNS)
    })

    it('should return DEFAULT_SECRET_PATTERNS when config is undefined', () => {
      const patterns = getSecretPatterns(undefined)
      expect(patterns).toEqual(DEFAULT_SECRET_PATTERNS)
    })

    it('should return DEFAULT_SECRET_PATTERNS when no patterns in config', () => {
      const config: MiniEnvConfig = {
        version: '1',
        project: 'test'
      }
      const patterns = getSecretPatterns(config)
      expect(patterns).toEqual(DEFAULT_SECRET_PATTERNS)
    })

    it('should return DEFAULT_SECRET_PATTERNS when patterns array is empty', () => {
      const config: MiniEnvConfig = {
        version: '1',
        project: 'test',
        security: {
          auto_encrypt: {
            patterns: []
          }
        }
      }
      const patterns = getSecretPatterns(config)
      expect(patterns).toEqual(DEFAULT_SECRET_PATTERNS)
    })

    it('should return custom patterns when provided', () => {
      const customPatterns = ['CUSTOM_*', '*_CUSTOM']
      const config: MiniEnvConfig = {
        version: '1',
        project: 'test',
        security: {
          auto_encrypt: {
            patterns: customPatterns
          }
        }
      }
      const patterns = getSecretPatterns(config)
      expect(patterns).toEqual(customPatterns)
    })
  })

  describe('splitVarsBySecret', () => {
    it('should split vars into secrets and plain', () => {
      const vars = {
        API_KEY: 'secret-key',
        DATABASE_URL: 'postgres://localhost',
        NODE_ENV: 'production',
        PORT: '3000'
      }
      const patterns = ['*_KEY', 'DATABASE_URL']

      const result = splitVarsBySecret(vars, patterns)

      expect(result.secrets).toEqual({
        API_KEY: 'secret-key',
        DATABASE_URL: 'postgres://localhost'
      })
      expect(result.plain).toEqual({
        NODE_ENV: 'production',
        PORT: '3000'
      })
    })

    it('should return all as plain when no patterns match', () => {
      const vars = {
        NODE_ENV: 'production',
        PORT: '3000'
      }
      const patterns = ['*_KEY', '*_SECRET']

      const result = splitVarsBySecret(vars, patterns)

      expect(result.secrets).toEqual({})
      expect(result.plain).toEqual(vars)
    })

    it('should return all as secrets when all patterns match', () => {
      const vars = {
        API_KEY: 'key1',
        JWT_KEY: 'key2'
      }
      const patterns = ['*_KEY']

      const result = splitVarsBySecret(vars, patterns)

      expect(result.secrets).toEqual(vars)
      expect(result.plain).toEqual({})
    })

    it('should handle empty vars', () => {
      const result = splitVarsBySecret({}, ['*_KEY'])

      expect(result.secrets).toEqual({})
      expect(result.plain).toEqual({})
    })

    it('should handle empty patterns (all plain)', () => {
      const vars = {
        API_KEY: 'key',
        SECRET: 'secret'
      }

      const result = splitVarsBySecret(vars, [])

      expect(result.secrets).toEqual({})
      expect(result.plain).toEqual(vars)
    })

    it('should work with real DEFAULT_SECRET_PATTERNS', () => {
      const vars = {
        // These should be secrets
        API_KEY: 'secret-api-key',
        JWT_SECRET: 'jwt-secret-value',
        AUTH_TOKEN: 'auth-token-value',
        DB_PASSWORD: 'db-password',
        DATABASE_URL: 'postgres://localhost/db',
        REDIS_URL: 'redis://localhost',
        AWS_CREDENTIAL: 'aws-cred',

        // These should be plain
        NODE_ENV: 'production',
        PORT: '3000',
        DEBUG: 'false',
        LOG_LEVEL: 'info'
      }

      const result = splitVarsBySecret(vars, DEFAULT_SECRET_PATTERNS)

      expect(result.secrets).toHaveProperty('API_KEY')
      expect(result.secrets).toHaveProperty('JWT_SECRET')
      expect(result.secrets).toHaveProperty('AUTH_TOKEN')
      expect(result.secrets).toHaveProperty('DB_PASSWORD')
      expect(result.secrets).toHaveProperty('DATABASE_URL')
      expect(result.secrets).toHaveProperty('REDIS_URL')
      expect(result.secrets).toHaveProperty('AWS_CREDENTIAL')

      expect(result.plain).toHaveProperty('NODE_ENV')
      expect(result.plain).toHaveProperty('PORT')
      expect(result.plain).toHaveProperty('DEBUG')
      expect(result.plain).toHaveProperty('LOG_LEVEL')
    })
  })
})
