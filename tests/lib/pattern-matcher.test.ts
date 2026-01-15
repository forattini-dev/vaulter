/**
 * Tests for pattern-matcher.ts
 */

import { describe, it, expect } from 'vitest'
import { compileGlobPatterns } from '../../src/lib/pattern-matcher.js'

describe('pattern-matcher', () => {
  describe('compileGlobPatterns', () => {
    describe('basic patterns', () => {
      it('should match exact strings', () => {
        const matcher = compileGlobPatterns(['DATABASE_URL'])
        expect(matcher('DATABASE_URL')).toBe(true)
        expect(matcher('OTHER_VAR')).toBe(false)
      })

      it('should be case-insensitive', () => {
        const matcher = compileGlobPatterns(['database_url'])
        expect(matcher('DATABASE_URL')).toBe(true)
        expect(matcher('Database_Url')).toBe(true)
      })

      it('should match multiple patterns', () => {
        const matcher = compileGlobPatterns(['DATABASE_URL', 'REDIS_URL'])
        expect(matcher('DATABASE_URL')).toBe(true)
        expect(matcher('REDIS_URL')).toBe(true)
        expect(matcher('API_KEY')).toBe(false)
      })
    })

    describe('wildcard patterns', () => {
      it('should match * at end', () => {
        const matcher = compileGlobPatterns(['*_KEY'])
        expect(matcher('API_KEY')).toBe(true)
        expect(matcher('SECRET_KEY')).toBe(true)
        expect(matcher('KEY')).toBe(false)
        expect(matcher('KEY_VALUE')).toBe(false)
      })

      it('should match * at start', () => {
        const matcher = compileGlobPatterns(['DATABASE_*'])
        expect(matcher('DATABASE_URL')).toBe(true)
        expect(matcher('DATABASE_HOST')).toBe(true)
        expect(matcher('MY_DATABASE')).toBe(false)
      })

      it('should match * in middle', () => {
        const matcher = compileGlobPatterns(['DB_*_URL'])
        expect(matcher('DB_MAIN_URL')).toBe(true)
        expect(matcher('DB_REPLICA_URL')).toBe(true)
        expect(matcher('DB_URL')).toBe(false)
      })

      it('should match multiple * wildcards', () => {
        const matcher = compileGlobPatterns(['*_*_KEY'])
        expect(matcher('AWS_SECRET_KEY')).toBe(true)
        expect(matcher('API_KEY')).toBe(false)
      })

      it('should match ? single character', () => {
        const matcher = compileGlobPatterns(['KEY_?'])
        expect(matcher('KEY_1')).toBe(true)
        expect(matcher('KEY_A')).toBe(true)
        expect(matcher('KEY_12')).toBe(false)
        expect(matcher('KEY_')).toBe(false)
      })
    })

    describe('special characters', () => {
      it('should escape regex special characters', () => {
        const matcher = compileGlobPatterns(['config.yaml'])
        expect(matcher('config.yaml')).toBe(true)
        expect(matcher('configXyaml')).toBe(false)
      })

      it('should escape dots', () => {
        const matcher = compileGlobPatterns(['*.env'])
        expect(matcher('development.env')).toBe(true)
        expect(matcher('Xenv')).toBe(false)
      })

      it('should escape brackets', () => {
        const matcher = compileGlobPatterns(['[test]'])
        expect(matcher('[test]')).toBe(true)
        expect(matcher('t')).toBe(false)
      })

      it('should escape parentheses', () => {
        const matcher = compileGlobPatterns(['(secret)'])
        expect(matcher('(secret)')).toBe(true)
      })
    })

    describe('edge cases', () => {
      it('should return false matcher for empty array', () => {
        const matcher = compileGlobPatterns([])
        expect(matcher('anything')).toBe(false)
      })

      it('should ignore empty strings', () => {
        const matcher = compileGlobPatterns(['', '  ', 'API_KEY'])
        expect(matcher('API_KEY')).toBe(true)
        expect(matcher('')).toBe(false)
      })

      it('should trim whitespace', () => {
        const matcher = compileGlobPatterns(['  API_KEY  '])
        expect(matcher('API_KEY')).toBe(true)
      })

      it('should handle patterns with only wildcards', () => {
        const matcher = compileGlobPatterns(['*'])
        expect(matcher('anything')).toBe(true)
        expect(matcher('')).toBe(true)
      })

      it('should handle empty string pattern', () => {
        const matcher = compileGlobPatterns([''])
        expect(matcher('')).toBe(false)
        expect(matcher('test')).toBe(false)
      })
    })

    describe('real-world patterns', () => {
      it('should match secret patterns from DEFAULT_SECRET_PATTERNS', () => {
        const matcher = compileGlobPatterns([
          '*_KEY',
          '*_SECRET',
          '*_TOKEN',
          '*_PASSWORD',
          'DATABASE_URL',
          'REDIS_URL'
        ])

        // Should match
        expect(matcher('API_KEY')).toBe(true)
        expect(matcher('JWT_SECRET')).toBe(true)
        expect(matcher('AUTH_TOKEN')).toBe(true)
        expect(matcher('DB_PASSWORD')).toBe(true)
        expect(matcher('DATABASE_URL')).toBe(true)
        expect(matcher('REDIS_URL')).toBe(true)

        // Should not match
        expect(matcher('DEBUG')).toBe(false)
        expect(matcher('NODE_ENV')).toBe(false)
        expect(matcher('PORT')).toBe(false)
      })
    })
  })
})
