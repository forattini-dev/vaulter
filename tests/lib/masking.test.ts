/**
 * Tests for centralized masking utility
 */

import { describe, it, expect } from 'vitest'
import { maskValue, maskValueToggle, maskValueBySensitivity } from '../../src/lib/masking.js'

describe('masking', () => {
  describe('maskValue', () => {
    it('should mask a standard secret value', () => {
      const result = maskValue('sk-abc123xyz789def')
      // 17 chars: 4 start (sk-a) + 4 mask (****) + 4 end (def) = shows 9def as end
      expect(result).toBe('sk-a****9def')
    })

    it('should handle undefined value', () => {
      expect(maskValue(undefined)).toBe('')
    })

    it('should handle null value', () => {
      expect(maskValue(null)).toBe('')
    })

    it('should handle empty string', () => {
      expect(maskValue('')).toBe('')
    })

    it('should show *** for short values', () => {
      expect(maskValue('short')).toBe('***')
      expect(maskValue('1234567')).toBe('***') // 7 chars, below minLengthToMask
    })

    it('should mask values at minLengthToMask boundary', () => {
      // 8 chars: 4 start + 4 end = 8, so only 0 chars to mask → min 1 mask char
      expect(maskValue('12345678')).toBe('1234*5678')
    })

    it('should show full value when showFull is true', () => {
      expect(maskValue('my-secret-key', { showFull: true })).toBe('my-secret-key')
    })

    it('should truncate long values even with showFull', () => {
      const longValue = 'a'.repeat(50)
      const result = maskValue(longValue, { showFull: true, maxLength: 20 })
      expect(result.length).toBe(20)
      expect(result.endsWith('...')).toBe(true)
    })

    it('should respect maxLength option', () => {
      const result = maskValue('very-long-secret-key-here-abc', { maxLength: 15 })
      expect(result.length).toBeLessThanOrEqual(15)
    })

    it('should use custom visibleStart', () => {
      const result = maskValue('abcdefghijklmnop', { visibleStart: 6, visibleEnd: 2 })
      expect(result.startsWith('abcdef')).toBe(true)
      expect(result.endsWith('op')).toBe(true)
    })

    it('should use custom visibleEnd', () => {
      const result = maskValue('abcdefghijklmnop', { visibleStart: 2, visibleEnd: 6 })
      expect(result.startsWith('ab')).toBe(true)
      expect(result.endsWith('klmnop')).toBe(true)
    })

    it('should use custom maskChar', () => {
      const result = maskValue('my-secret-value', { maskChar: 'x' })
      expect(result).toContain('xxxx')
      expect(result).not.toContain('*')
    })

    it('should respect custom minLengthToMask', () => {
      expect(maskValue('short', { minLengthToMask: 3 })).not.toBe('***')
      expect(maskValue('ab', { minLengthToMask: 3 })).toBe('***')
    })

    it('should handle edge case: value equals minLengthToMask', () => {
      const result = maskValue('abcdefgh', { minLengthToMask: 8 })
      expect(result).not.toBe('***')
    })

    it('should handle maxLength of 0 (unlimited)', () => {
      const longValue = 'a'.repeat(100)
      const result = maskValue(longValue, { showFull: true, maxLength: 0 })
      expect(result).toBe(longValue)
    })

    it('should produce consistent output for same input', () => {
      const value = 'my-api-key-12345'
      const result1 = maskValue(value)
      const result2 = maskValue(value)
      expect(result1).toBe(result2)
    })
  })

  describe('maskValueToggle', () => {
    it('should show full value when show is true', () => {
      expect(maskValueToggle('my-secret', true)).toBe('my-secret')
    })

    it('should mask value when show is false', () => {
      // 13 chars: 4 start (my-s) + 4 mask (****) + 4 end (-key)
      expect(maskValueToggle('my-secret-key', false)).toBe('my-s****-key')
    })

    it('should handle undefined', () => {
      expect(maskValueToggle(undefined, true)).toBe('')
      expect(maskValueToggle(undefined, false)).toBe('')
    })

    it('should handle null', () => {
      expect(maskValueToggle(null, true)).toBe('')
      expect(maskValueToggle(null, false)).toBe('')
    })
  })

  describe('maskValueBySensitivity', () => {
    it('should mask sensitive values', () => {
      const result = maskValueBySensitivity('password123!', true)
      expect(result).not.toBe('password123!')
      expect(result).toContain('****')
    })

    it('should show non-sensitive values in full', () => {
      const result = maskValueBySensitivity('DEBUG', false)
      expect(result).toBe('DEBUG')
    })

    it('should handle undefined', () => {
      expect(maskValueBySensitivity(undefined, true)).toBe('')
      expect(maskValueBySensitivity(undefined, false)).toBe('')
    })

    it('should handle null', () => {
      expect(maskValueBySensitivity(null, true)).toBe('')
      expect(maskValueBySensitivity(null, false)).toBe('')
    })
  })

  describe('real-world scenarios', () => {
    it('should mask AWS access key', () => {
      const result = maskValue('AKIAIOSFODNN7EXAMPLE')
      expect(result.startsWith('AKIA')).toBe(true)
      expect(result).toContain('****')
    })

    it('should mask JWT token', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
      const result = maskValue(jwt)
      expect(result.length).toBeLessThanOrEqual(30)
      expect(result.startsWith('eyJh')).toBe(true)
    })

    it('should mask database URL', () => {
      const dbUrl = 'postgresql://user:password@localhost:5432/mydb'
      const result = maskValue(dbUrl)
      expect(result.startsWith('post')).toBe(true)
      expect(result).toContain('****')
    })

    it('should mask API key with prefix', () => {
      const apiKey = 'sk-proj-abc123def456ghi789'
      const result = maskValue(apiKey)
      expect(result.startsWith('sk-p')).toBe(true)
    })

    it('should handle short env values', () => {
      expect(maskValue('true')).toBe('***')
      expect(maskValue('3000')).toBe('***')
      expect(maskValue('debug')).toBe('***')
    })
  })
})
