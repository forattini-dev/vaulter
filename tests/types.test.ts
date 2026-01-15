/**
 * Tests for types.ts
 */

import { describe, it, expect } from 'vitest'
import {
  ENVIRONMENTS,
  ENVIRONMENT_NAMES,
  EXPORT_FORMATS,
  DEFAULT_SECRET_PATTERNS
} from '../src/types.js'

describe('types', () => {
  describe('ENVIRONMENTS', () => {
    it('should have all 5 environments', () => {
      expect(ENVIRONMENTS).toHaveLength(5)
    })

    it('should contain dev, stg, prd, sbx, dr', () => {
      expect(ENVIRONMENTS).toContain('dev')
      expect(ENVIRONMENTS).toContain('stg')
      expect(ENVIRONMENTS).toContain('prd')
      expect(ENVIRONMENTS).toContain('sbx')
      expect(ENVIRONMENTS).toContain('dr')
    })
  })

  describe('ENVIRONMENT_NAMES', () => {
    it('should have full names for all environments', () => {
      expect(ENVIRONMENT_NAMES.dev).toBe('development')
      expect(ENVIRONMENT_NAMES.stg).toBe('staging')
      expect(ENVIRONMENT_NAMES.prd).toBe('production')
      expect(ENVIRONMENT_NAMES.sbx).toBe('sandbox')
      expect(ENVIRONMENT_NAMES.dr).toBe('disaster-recovery')
    })
  })

  describe('EXPORT_FORMATS', () => {
    it('should have all export formats', () => {
      expect(EXPORT_FORMATS).toContain('shell')
      expect(EXPORT_FORMATS).toContain('json')
      expect(EXPORT_FORMATS).toContain('yaml')
      expect(EXPORT_FORMATS).toContain('env')
      expect(EXPORT_FORMATS).toContain('tfvars')
    })

    it('should have 5 formats', () => {
      expect(EXPORT_FORMATS).toHaveLength(5)
    })
  })

  describe('DEFAULT_SECRET_PATTERNS', () => {
    it('should include common secret patterns', () => {
      expect(DEFAULT_SECRET_PATTERNS).toContain('*_KEY')
      expect(DEFAULT_SECRET_PATTERNS).toContain('*_SECRET')
      expect(DEFAULT_SECRET_PATTERNS).toContain('*_TOKEN')
      expect(DEFAULT_SECRET_PATTERNS).toContain('*_PASSWORD')
      expect(DEFAULT_SECRET_PATTERNS).toContain('DATABASE_URL')
      expect(DEFAULT_SECRET_PATTERNS).toContain('REDIS_URL')
    })

    it('should have patterns for security-sensitive values', () => {
      expect(DEFAULT_SECRET_PATTERNS).toContain('*_CREDENTIAL')
      expect(DEFAULT_SECRET_PATTERNS).toContain('*_CERT')
      expect(DEFAULT_SECRET_PATTERNS).toContain('*_PRIVATE')
    })
  })
})
