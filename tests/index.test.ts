/**
 * Tests for src/index.ts exports
 */

import { describe, it, expect } from 'vitest'
import { resolveBackendUrls } from '../src/index.js'
import type { VaulterConfig } from '../src/types.js'

describe('index exports', () => {
  describe('resolveBackendUrls', () => {
    it('should return empty array when no backend config', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test'
      }
      expect(resolveBackendUrls(config)).toEqual([])
    })

    it('should return empty array when backend has no url or urls', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        backend: {}
      }
      expect(resolveBackendUrls(config)).toEqual([])
    })

    it('should return single url in array', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        backend: {
          url: 's3://bucket/path'
        }
      }
      expect(resolveBackendUrls(config)).toEqual(['s3://bucket/path'])
    })

    it('should return urls array when provided', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        backend: {
          urls: ['s3://primary/path', 's3://secondary/path']
        }
      }
      expect(resolveBackendUrls(config)).toEqual(['s3://primary/path', 's3://secondary/path'])
    })

    it('should prefer urls over url when both provided', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        backend: {
          url: 's3://single/path',
          urls: ['s3://first/path', 's3://second/path']
        }
      }
      expect(resolveBackendUrls(config)).toEqual(['s3://first/path', 's3://second/path'])
    })

    it('should filter empty strings from urls', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        backend: {
          urls: ['s3://valid/path', '', '  ', 's3://another/path']
        }
      }
      expect(resolveBackendUrls(config)).toEqual(['s3://valid/path', 's3://another/path'])
    })

    it('should fall back to url when urls array is empty', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        backend: {
          url: 's3://fallback/path',
          urls: []
        }
      }
      expect(resolveBackendUrls(config)).toEqual(['s3://fallback/path'])
    })

    it('should return empty array for whitespace-only url', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'test',
        backend: {
          url: '   '
        }
      }
      expect(resolveBackendUrls(config)).toEqual([])
    })
  })
})
