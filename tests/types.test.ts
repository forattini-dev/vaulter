/**
 * Tests for types.ts
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ENVIRONMENTS,
  DEFAULT_ENVIRONMENT,
  COMMON_ENVIRONMENT_NAMES,
  EXPORT_FORMATS
} from '../src/types.js'

describe('types', () => {
  describe('DEFAULT_ENVIRONMENTS', () => {
    it('should have default environments', () => {
      expect(DEFAULT_ENVIRONMENTS).toHaveLength(4)
    })

    it('should contain dev, stg, sdx, prd', () => {
      expect(DEFAULT_ENVIRONMENTS).toContain('dev')
      expect(DEFAULT_ENVIRONMENTS).toContain('stg')
      expect(DEFAULT_ENVIRONMENTS).toContain('sdx')
      expect(DEFAULT_ENVIRONMENTS).toContain('prd')
    })

    it('should have dev as default environment', () => {
      expect(DEFAULT_ENVIRONMENT).toBe('dev')
    })
  })

  describe('COMMON_ENVIRONMENT_NAMES', () => {
    it('should have full names for common environments', () => {
      expect(COMMON_ENVIRONMENT_NAMES.dev).toBe('development')
      expect(COMMON_ENVIRONMENT_NAMES.stg).toBe('staging')
      expect(COMMON_ENVIRONMENT_NAMES.prd).toBe('production')
      expect(COMMON_ENVIRONMENT_NAMES.sbx).toBe('sandbox')
      expect(COMMON_ENVIRONMENT_NAMES.dr).toBe('disaster-recovery')
      expect(COMMON_ENVIRONMENT_NAMES.qa).toBe('quality assurance')
      expect(COMMON_ENVIRONMENT_NAMES.uat).toBe('user acceptance testing')
    })
  })

  describe('EXPORT_FORMATS', () => {
    it('should have all export formats', () => {
      expect(EXPORT_FORMATS).toContain('shell')
      expect(EXPORT_FORMATS).toContain('json')
      expect(EXPORT_FORMATS).toContain('yaml')
      expect(EXPORT_FORMATS).toContain('env')
      expect(EXPORT_FORMATS).toContain('tfvars')
      expect(EXPORT_FORMATS).toContain('docker-args')
    })

    it('should have 6 formats', () => {
      expect(EXPORT_FORMATS).toHaveLength(6)
    })
  })

})
