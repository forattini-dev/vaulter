/**
 * Tests for s3-key-loader.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseS3Url, fetchKeyFromS3, loadKeyFromS3 } from '../../src/lib/s3-key-loader.js'
import type { S3KeyLocation } from '../../src/lib/s3-key-loader.js'

describe('s3-key-loader', () => {
  describe('parseS3Url', () => {
    describe('s3:// protocol', () => {
      it('should parse basic s3:// URL', () => {
        const result = parseS3Url('s3://my-bucket/path/to/key.txt')
        expect(result).toEqual({
          bucket: 'my-bucket',
          key: 'path/to/key.txt',
          region: undefined
        })
      })

      it('should parse s3:// URL with region', () => {
        const result = parseS3Url('s3://my-bucket/keys/master.key?region=us-west-2')
        expect(result).toEqual({
          bucket: 'my-bucket',
          key: 'keys/master.key',
          region: 'us-west-2'
        })
      })

      it('should parse s3:// URL with root key', () => {
        const result = parseS3Url('s3://bucket/key.txt')
        expect(result).toEqual({
          bucket: 'bucket',
          key: 'key.txt',
          region: undefined
        })
      })

      it('should handle empty path', () => {
        const result = parseS3Url('s3://bucket/')
        expect(result.bucket).toBe('bucket')
        expect(result.key).toBe('')
      })

      it('should parse s3:// URL with deep path', () => {
        const result = parseS3Url('s3://my-bucket/a/b/c/d/key.txt')
        expect(result).toEqual({
          bucket: 'my-bucket',
          key: 'a/b/c/d/key.txt',
          region: undefined
        })
      })

      it('should parse s3:// URL with special characters in key', () => {
        const result = parseS3Url('s3://bucket/path/file-with_special.chars.key')
        expect(result.key).toBe('path/file-with_special.chars.key')
      })
    })

    describe('http:// protocol (MinIO, custom endpoints)', () => {
      it('should parse http endpoint without auth', () => {
        const result = parseS3Url('http://localhost:9000/my-bucket/keys/master.key')
        expect(result).toEqual({
          bucket: 'my-bucket',
          key: 'keys/master.key',
          endpoint: 'http://localhost:9000',
          accessKeyId: undefined,
          secretAccessKey: undefined
        })
      })

      it('should parse http endpoint with auth', () => {
        const result = parseS3Url('http://minioadmin:minioadmin@localhost:9000/bucket/key.txt')
        expect(result).toEqual({
          bucket: 'bucket',
          key: 'key.txt',
          endpoint: 'http://localhost:9000',
          accessKeyId: 'minioadmin',
          secretAccessKey: 'minioadmin'
        })
      })

      it('should parse https endpoint', () => {
        const result = parseS3Url('https://s3.amazonaws.com/my-bucket/keys/file.key')
        expect(result).toEqual({
          bucket: 'my-bucket',
          key: 'keys/file.key',
          endpoint: 'https://s3.amazonaws.com',
          accessKeyId: undefined,
          secretAccessKey: undefined
        })
      })

      it('should handle R2 endpoint', () => {
        const result = parseS3Url('https://key:secret@accountid.r2.cloudflarestorage.com/bucket/path')
        expect(result.bucket).toBe('bucket')
        expect(result.key).toBe('path')
        expect(result.endpoint).toBe('https://accountid.r2.cloudflarestorage.com')
        expect(result.accessKeyId).toBe('key')
        expect(result.secretAccessKey).toBe('secret')
      })

      it('should handle custom port', () => {
        const result = parseS3Url('http://localhost:8080/bucket/key')
        expect(result.endpoint).toBe('http://localhost:8080')
      })

      it('should handle IP address', () => {
        const result = parseS3Url('http://192.168.1.100:9000/bucket/key')
        expect(result.endpoint).toBe('http://192.168.1.100:9000')
        expect(result.bucket).toBe('bucket')
      })

      it('should handle deeply nested key in http URL', () => {
        const result = parseS3Url('http://localhost:9000/bucket/a/b/c/key.txt')
        expect(result.key).toBe('a/b/c/key.txt')
      })

      it('should handle URL with only bucket (no key)', () => {
        const result = parseS3Url('http://localhost:9000/bucket/')
        expect(result.bucket).toBe('bucket')
        expect(result.key).toBe('')
      })
    })

    describe('error handling', () => {
      it('should throw for unsupported protocol', () => {
        expect(() => parseS3Url('ftp://bucket/key')).toThrow(/unsupported/i)
      })

      it('should throw for invalid URL', () => {
        expect(() => parseS3Url('not-a-url')).toThrow()
      })

      it('should throw for file:// protocol', () => {
        expect(() => parseS3Url('file:///path/to/file')).toThrow(/unsupported/i)
      })

      it('should throw for empty string', () => {
        expect(() => parseS3Url('')).toThrow()
      })

      it('should throw for memory:// protocol', () => {
        expect(() => parseS3Url('memory://bucket/key')).toThrow(/unsupported/i)
      })
    })

    describe('edge cases', () => {
      it('should handle bucket with hyphens', () => {
        const result = parseS3Url('s3://my-test-bucket/key')
        expect(result.bucket).toBe('my-test-bucket')
      })

      it('should handle bucket with numbers', () => {
        const result = parseS3Url('s3://bucket123/key')
        expect(result.bucket).toBe('bucket123')
      })

      it('should handle credentials with special characters', () => {
        // Standard URL parsing - credentials are passed as-is from the URL object
        const result = parseS3Url('http://myuser:mypassword@localhost:9000/bucket/key')
        expect(result.accessKeyId).toBe('myuser')
        expect(result.secretAccessKey).toBe('mypassword')
      })

      it('should handle multiple query parameters', () => {
        const result = parseS3Url('s3://bucket/key?region=us-east-1&foo=bar')
        expect(result.region).toBe('us-east-1')
      })
    })
  })

  describe('fetchKeyFromS3', () => {
    beforeEach(() => {
      vi.resetModules()
      vi.unstubAllGlobals()
    })

    it('should fetch key from S3 successfully', async () => {
      let capturedConfig: any
      let capturedCommand: any

      const mockBody = {
        transformToString: vi.fn().mockResolvedValue('  my-secret-key  ')
      }

      vi.doMock('@aws-sdk/client-s3', () => {
        return {
          S3Client: class MockS3Client {
            constructor(config: any) {
              capturedConfig = config
            }
            send = vi.fn().mockResolvedValue({ Body: mockBody })
          },
          GetObjectCommand: class MockGetObjectCommand {
            constructor(params: any) {
              capturedCommand = params
            }
          }
        }
      })

      const { fetchKeyFromS3 } = await import('../../src/lib/s3-key-loader.js')

      const location: S3KeyLocation = {
        bucket: 'my-bucket',
        key: 'keys/master.key'
      }

      const result = await fetchKeyFromS3(location)

      expect(result).toBe('my-secret-key')
      expect(capturedCommand).toEqual({
        Bucket: 'my-bucket',
        Key: 'keys/master.key'
      })
    })

    it('should configure region when provided', async () => {
      let capturedConfig: any

      vi.doMock('@aws-sdk/client-s3', () => {
        return {
          S3Client: class MockS3Client {
            constructor(config: any) {
              capturedConfig = config
            }
            send = vi.fn().mockResolvedValue({
              Body: { transformToString: () => Promise.resolve('key') }
            })
          },
          GetObjectCommand: class MockGetObjectCommand {
            constructor() {}
          }
        }
      })

      const { fetchKeyFromS3 } = await import('../../src/lib/s3-key-loader.js')

      await fetchKeyFromS3({
        bucket: 'bucket',
        key: 'key',
        region: 'us-west-2'
      })

      expect(capturedConfig.region).toBe('us-west-2')
    })

    it('should configure endpoint for MinIO/custom endpoints', async () => {
      let capturedConfig: any

      vi.doMock('@aws-sdk/client-s3', () => {
        return {
          S3Client: class MockS3Client {
            constructor(config: any) {
              capturedConfig = config
            }
            send = vi.fn().mockResolvedValue({
              Body: { transformToString: () => Promise.resolve('key') }
            })
          },
          GetObjectCommand: class MockGetObjectCommand {
            constructor() {}
          }
        }
      })

      const { fetchKeyFromS3 } = await import('../../src/lib/s3-key-loader.js')

      await fetchKeyFromS3({
        bucket: 'bucket',
        key: 'key',
        endpoint: 'http://localhost:9000'
      })

      expect(capturedConfig.endpoint).toBe('http://localhost:9000')
      expect(capturedConfig.forcePathStyle).toBe(true)
    })

    it('should configure credentials when provided', async () => {
      let capturedConfig: any

      vi.doMock('@aws-sdk/client-s3', () => {
        return {
          S3Client: class MockS3Client {
            constructor(config: any) {
              capturedConfig = config
            }
            send = vi.fn().mockResolvedValue({
              Body: { transformToString: () => Promise.resolve('key') }
            })
          },
          GetObjectCommand: class MockGetObjectCommand {
            constructor() {}
          }
        }
      })

      const { fetchKeyFromS3 } = await import('../../src/lib/s3-key-loader.js')

      await fetchKeyFromS3({
        bucket: 'bucket',
        key: 'key',
        accessKeyId: 'myAccessKey',
        secretAccessKey: 'mySecretKey'
      })

      expect(capturedConfig.credentials).toEqual({
        accessKeyId: 'myAccessKey',
        secretAccessKey: 'mySecretKey'
      })
    })

    it('should throw error for empty response body', async () => {
      vi.doMock('@aws-sdk/client-s3', () => {
        return {
          S3Client: class MockS3Client {
            constructor() {}
            send = vi.fn().mockResolvedValue({ Body: null })
          },
          GetObjectCommand: class MockGetObjectCommand {
            constructor() {}
          }
        }
      })

      const { fetchKeyFromS3 } = await import('../../src/lib/s3-key-loader.js')

      await expect(fetchKeyFromS3({
        bucket: 'bucket',
        key: 'key'
      })).rejects.toThrow(/empty response/i)
    })

    it('should wrap S3 errors with context', async () => {
      vi.doMock('@aws-sdk/client-s3', () => {
        return {
          S3Client: class MockS3Client {
            constructor() {}
            send = vi.fn().mockRejectedValue(new Error('Access Denied'))
          },
          GetObjectCommand: class MockGetObjectCommand {
            constructor() {}
          }
        }
      })

      const { fetchKeyFromS3 } = await import('../../src/lib/s3-key-loader.js')

      await expect(fetchKeyFromS3({
        bucket: 'bucket',
        key: 'key'
      })).rejects.toThrow(/failed to fetch key from s3.*access denied/i)
    })
  })

  describe('loadKeyFromS3', () => {
    beforeEach(() => {
      vi.resetModules()
      vi.unstubAllGlobals()
    })

    it('should parse URL and fetch key', async () => {
      let capturedConfig: any
      let capturedCommand: any

      vi.doMock('@aws-sdk/client-s3', () => {
        return {
          S3Client: class MockS3Client {
            constructor(config: any) {
              capturedConfig = config
            }
            send = vi.fn().mockResolvedValue({
              Body: { transformToString: () => Promise.resolve('loaded-key') }
            })
          },
          GetObjectCommand: class MockGetObjectCommand {
            constructor(params: any) {
              capturedCommand = params
            }
          }
        }
      })

      const { loadKeyFromS3 } = await import('../../src/lib/s3-key-loader.js')

      const result = await loadKeyFromS3('s3://my-bucket/keys/master.key?region=us-east-1')

      expect(result).toBe('loaded-key')
      expect(capturedConfig.region).toBe('us-east-1')
      expect(capturedCommand).toEqual({
        Bucket: 'my-bucket',
        Key: 'keys/master.key'
      })
    })

    it('should propagate parse errors', async () => {
      const { loadKeyFromS3 } = await import('../../src/lib/s3-key-loader.js')

      await expect(loadKeyFromS3('invalid-url')).rejects.toThrow()
    })

    it('should work with http endpoints', async () => {
      let capturedConfig: any

      vi.doMock('@aws-sdk/client-s3', () => {
        return {
          S3Client: class MockS3Client {
            constructor(config: any) {
              capturedConfig = config
            }
            send = vi.fn().mockResolvedValue({
              Body: { transformToString: () => Promise.resolve('http-key') }
            })
          },
          GetObjectCommand: class MockGetObjectCommand {
            constructor() {}
          }
        }
      })

      const { loadKeyFromS3 } = await import('../../src/lib/s3-key-loader.js')

      const result = await loadKeyFromS3('http://minioadmin:secret@localhost:9000/bucket/key.txt')

      expect(result).toBe('http-key')
      expect(capturedConfig.endpoint).toBe('http://localhost:9000')
      expect(capturedConfig.forcePathStyle).toBe(true)
      expect(capturedConfig.credentials).toEqual({
        accessKeyId: 'minioadmin',
        secretAccessKey: 'secret'
      })
    })
  })
})
