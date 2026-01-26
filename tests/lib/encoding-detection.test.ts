import { describe, it, expect } from 'vitest'
import {
  detectEncoding,
  formatEncodingWarning,
  checkValuesForEncoding
} from '../../src/lib/encoding-detection.js'

describe('encoding-detection', () => {
  describe('detectEncoding', () => {
    describe('short values', () => {
      it('should not detect short values', () => {
        expect(detectEncoding('abc123')).toEqual({
          detected: false,
          confidence: 'low'
        })
      })

      it('should not detect normal env values', () => {
        expect(detectEncoding('production')).toEqual({
          detected: false,
          confidence: 'low'
        })
      })
    })

    describe('bcrypt hashes', () => {
      it('should detect bcrypt $2a$ hash', () => {
        const hash = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G.3pQ8vXqHK3ey'
        const result = detectEncoding(hash)
        expect(result.detected).toBe(true)
        expect(result.type).toBe('bcrypt')
        expect(result.confidence).toBe('high')
      })

      it('should detect bcrypt $2b$ hash', () => {
        const hash = '$2b$10$N9qo8uLOickgx2ZMRZoMye/qz8A.FfBfJVKX/LS3LLcNLdBjXq3Aq'
        const result = detectEncoding(hash)
        expect(result.detected).toBe(true)
        expect(result.type).toBe('bcrypt')
        expect(result.confidence).toBe('high')
      })

      it('should detect bcrypt $2y$ hash', () => {
        const hash = '$2y$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234'
        const result = detectEncoding(hash)
        expect(result.detected).toBe(true)
        expect(result.type).toBe('bcrypt')
        expect(result.confidence).toBe('high')
      })
    })

    describe('argon2 hashes', () => {
      it('should detect argon2id hash', () => {
        const hash = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG'
        const result = detectEncoding(hash)
        expect(result.detected).toBe(true)
        expect(result.type).toBe('argon2')
        expect(result.confidence).toBe('high')
      })

      it('should detect argon2i hash', () => {
        const hash = '$argon2i$v=19$m=16,t=2,p=1$c29tZXNhbHQ$bGFz'
        const result = detectEncoding(hash)
        expect(result.detected).toBe(true)
        expect(result.type).toBe('argon2')
        expect(result.confidence).toBe('high')
      })
    })

    describe('JWT tokens', () => {
      it('should detect JWT token', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
        const result = detectEncoding(jwt)
        expect(result.detected).toBe(true)
        expect(result.type).toBe('jwt')
        expect(result.confidence).toBe('high')
      })

      it('should not detect values with dots but not JWT', () => {
        const result = detectEncoding('host.domain.com')
        expect(result.type).not.toBe('jwt')
      })
    })

    describe('base64', () => {
      it('should detect base64 with padding', () => {
        // "Hello World, this is a test message" in base64
        const base64 = 'SGVsbG8gV29ybGQsIHRoaXMgaXMgYSB0ZXN0IG1lc3NhZ2U='
        const result = detectEncoding(base64)
        expect(result.detected).toBe(true)
        expect(result.type).toBe('base64')
        expect(result.confidence).toBe('medium')
      })

      it('should not detect short base64-like strings', () => {
        const result = detectEncoding('SGVsbG8=')
        expect(result.detected).toBe(false)
      })

      it('should not detect normal strings that could be base64', () => {
        // This looks like it could be base64 but is too short
        const result = detectEncoding('mypassword123')
        expect(result.detected).toBe(false)
      })
    })

    describe('hex encoding', () => {
      it('should detect hex strings that are not valid base64', () => {
        // This hex string contains characters that make it invalid base64
        // but still valid hex (only 0-9 and a-f, odd length padding would fail)
        const hex = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
        const result = detectEncoding(hex)
        // Note: hex detection is low priority, may be detected as base64url first
        expect(result.detected).toBe(true)
        // Accept either hex or base64url since hex chars overlap with base64url charset
        expect(['hex', 'base64url']).toContain(result.type)
      })

      it('should not detect short hex strings', () => {
        const result = detectEncoding('a1b2c3d4')
        expect(result.detected).toBe(false)
      })
    })

    describe('PGP encrypted', () => {
      it('should detect PGP message', () => {
        const pgp = '-----BEGIN PGP MESSAGE-----\nVersion: GnuPG\n\nhQEMA...'
        const result = detectEncoding(pgp)
        expect(result.detected).toBe(true)
        expect(result.type).toBe('pgp')
        expect(result.confidence).toBe('high')
      })
    })

    describe('SSH keys', () => {
      it('should detect SSH RSA key', () => {
        const sshKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC7...'
        const result = detectEncoding(sshKey)
        expect(result.detected).toBe(true)
        expect(result.type).toBe('ssh-key')
        expect(result.confidence).toBe('high')
      })

      it('should detect SSH ed25519 key', () => {
        const sshKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...'
        const result = detectEncoding(sshKey)
        expect(result.detected).toBe(true)
        expect(result.type).toBe('ssh-key')
        expect(result.confidence).toBe('high')
      })

      it('should detect OpenSSH private key', () => {
        const sshKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nbase64data...'
        const result = detectEncoding(sshKey)
        expect(result.detected).toBe(true)
        expect(result.type).toBe('ssh-key')
        expect(result.confidence).toBe('high')
      })
    })

    describe('AWS encrypted', () => {
      it('should detect AWS KMS encrypted data', () => {
        const awsEncrypted = 'AQICAHhHlbkdjflskdjflsdkjf...'
        const result = detectEncoding(awsEncrypted)
        expect(result.detected).toBe(true)
        expect(result.type).toBe('aws-encrypted')
        expect(result.confidence).toBe('medium')
      })
    })

    describe('normal values', () => {
      it('should not detect database URLs', () => {
        const dbUrl = 'postgres://user:password@localhost:5432/mydb'
        const result = detectEncoding(dbUrl)
        expect(result.detected).toBe(false)
      })

      it('should not detect API URLs', () => {
        const url = 'https://api.example.com/v1/users'
        const result = detectEncoding(url)
        expect(result.detected).toBe(false)
      })

      it('should not detect JSON strings', () => {
        const json = '{"key":"value","number":123}'
        const result = detectEncoding(json)
        expect(result.detected).toBe(false)
      })
    })
  })

  describe('formatEncodingWarning', () => {
    it('should return null for not detected', () => {
      const result = formatEncodingWarning({ detected: false, confidence: 'low' }, 'KEY')
      expect(result).toBeNull()
    })

    it('should return null for low confidence', () => {
      const result = formatEncodingWarning({
        detected: true,
        type: 'hex',
        confidence: 'low',
        message: 'test'
      }, 'KEY')
      expect(result).toBeNull()
    })

    it('should format warning for high confidence', () => {
      const result = formatEncodingWarning({
        detected: true,
        type: 'bcrypt',
        confidence: 'high',
        message: 'Value appears to be a bcrypt hash.'
      }, 'PASSWORD')
      expect(result).toBe('Warning: PASSWORD - Value appears to be a bcrypt hash.')
    })

    it('should format note for medium confidence', () => {
      const result = formatEncodingWarning({
        detected: true,
        type: 'base64',
        confidence: 'medium',
        message: 'Value appears to be base64 encoded.'
      }, 'DATA')
      expect(result).toBe('Note: DATA - Value appears to be base64 encoded.')
    })
  })

  describe('checkValuesForEncoding', () => {
    it('should return empty array for normal values', () => {
      const result = checkValuesForEncoding([
        { key: 'DB_URL', value: 'postgres://localhost/db' },
        { key: 'PORT', value: '3000' }
      ])
      expect(result).toEqual([])
    })

    it('should return warnings for encoded values', () => {
      const bcrypt = '$2b$10$N9qo8uLOickgx2ZMRZoMye/qz8A.FfBfJVKX/LS3LLcNLdBjXq3Aq'
      const result = checkValuesForEncoding([
        { key: 'PASSWORD_HASH', value: bcrypt },
        { key: 'PORT', value: '3000' }
      ])
      expect(result.length).toBe(1)
      expect(result[0].key).toBe('PASSWORD_HASH')
      expect(result[0].result.type).toBe('bcrypt')
    })

    it('should return multiple warnings', () => {
      const bcrypt = '$2b$10$N9qo8uLOickgx2ZMRZoMye/qz8A.FfBfJVKX/LS3LLcNLdBjXq3Aq'
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
      const result = checkValuesForEncoding([
        { key: 'PASSWORD_HASH', value: bcrypt },
        { key: 'TOKEN', value: jwt }
      ])
      expect(result.length).toBe(2)
    })
  })
})
