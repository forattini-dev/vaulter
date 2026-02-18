/**
 * Tests for crypto.ts - Hybrid encryption module
 */
import { describe, it, expect } from 'vitest'
import {
  generateKeyPair,
  generatePassphrase,
  hybridEncrypt,
  hybridDecrypt,
  isPublicKey,
  isPrivateKey,
  detectAlgorithm,
  isHybridEncrypted,
  serializeEncrypted,
  parseEncrypted,
  type KeyPair
} from '../../src/lib/crypto.js'
import type { HybridEncryptedData } from '../../src/types.js'

describe('crypto', () => {
  describe('generateKeyPair', () => {
    it('should generate RSA-4096 key pair by default', () => {
      const keyPair = generateKeyPair()
      expect(keyPair.algorithm).toBe('rsa-4096')
      expect(keyPair.publicKey).toContain('-----BEGIN PUBLIC KEY-----')
      expect(keyPair.privateKey).toContain('-----BEGIN PRIVATE KEY-----')
    })

    it('should generate RSA-2048 key pair', () => {
      const keyPair = generateKeyPair('rsa-2048')
      expect(keyPair.algorithm).toBe('rsa-2048')
      expect(keyPair.publicKey).toContain('-----BEGIN PUBLIC KEY-----')
      expect(keyPair.privateKey).toContain('-----BEGIN PRIVATE KEY-----')
    })

    it('should generate EC P-256 key pair', () => {
      const keyPair = generateKeyPair('ec-p256')
      expect(keyPair.algorithm).toBe('ec-p256')
      expect(keyPair.publicKey).toContain('-----BEGIN PUBLIC KEY-----')
      expect(keyPair.privateKey).toContain('-----BEGIN PRIVATE KEY-----')
    })

    it('should generate EC P-384 key pair', () => {
      const keyPair = generateKeyPair('ec-p384')
      expect(keyPair.algorithm).toBe('ec-p384')
      expect(keyPair.publicKey).toContain('-----BEGIN PUBLIC KEY-----')
      expect(keyPair.privateKey).toContain('-----BEGIN PRIVATE KEY-----')
    })

    it('should throw for unsupported algorithm', () => {
      expect(() => generateKeyPair('invalid' as any)).toThrow('Unsupported algorithm')
    })
  })

  describe('generatePassphrase', () => {
    it('should generate a 32-byte passphrase by default', () => {
      const passphrase = generatePassphrase()
      // Base64 of 32 bytes = 44 characters (with padding)
      expect(passphrase.length).toBe(44)
    })

    it('should generate passphrase with custom length', () => {
      const passphrase = generatePassphrase(16)
      // Base64 of 16 bytes = 24 characters (with padding)
      expect(passphrase.length).toBe(24)
    })

    it('should generate unique passphrases', () => {
      const p1 = generatePassphrase()
      const p2 = generatePassphrase()
      expect(p1).not.toBe(p2)
    })
  })

  describe('hybridEncrypt / hybridDecrypt', () => {
    describe('RSA-4096', () => {
      let keyPair: KeyPair

      beforeAll(() => {
        keyPair = generateKeyPair('rsa-4096')
      })

      it('should encrypt and decrypt data', () => {
        const plaintext = 'Hello, World!'
        const encrypted = hybridEncrypt(plaintext, keyPair.publicKey, 'rsa-4096')
        const decrypted = hybridDecrypt(encrypted, keyPair.privateKey)
        expect(decrypted).toBe(plaintext)
      })

      it('should encrypt and decrypt long data', () => {
        const plaintext = 'A'.repeat(10000)
        const encrypted = hybridEncrypt(plaintext, keyPair.publicKey, 'rsa-4096')
        const decrypted = hybridDecrypt(encrypted, keyPair.privateKey)
        expect(decrypted).toBe(plaintext)
      })

      it('should encrypt and decrypt unicode data', () => {
        const plaintext = '日本語テスト 🔐 émoji'
        const encrypted = hybridEncrypt(plaintext, keyPair.publicKey, 'rsa-4096')
        const decrypted = hybridDecrypt(encrypted, keyPair.privateKey)
        expect(decrypted).toBe(plaintext)
      })

      it('should produce different ciphertext for same plaintext', () => {
        const plaintext = 'Same data'
        const e1 = hybridEncrypt(plaintext, keyPair.publicKey, 'rsa-4096')
        const e2 = hybridEncrypt(plaintext, keyPair.publicKey, 'rsa-4096')
        expect(e1.data).not.toBe(e2.data)
        expect(e1.iv).not.toBe(e2.iv)
      })
    })

    describe('RSA-2048', () => {
      let keyPair: KeyPair

      beforeAll(() => {
        keyPair = generateKeyPair('rsa-2048')
      })

      it('should encrypt and decrypt data', () => {
        const plaintext = 'Hello, World!'
        const encrypted = hybridEncrypt(plaintext, keyPair.publicKey, 'rsa-2048')
        const decrypted = hybridDecrypt(encrypted, keyPair.privateKey)
        expect(decrypted).toBe(plaintext)
      })
    })

    // Note: EC P-256/384 can be slower on some environments, but should be stable in this runtime.
    describe('EC P-256', () => {
      let keyPair: KeyPair

      beforeAll(() => {
        keyPair = generateKeyPair('ec-p256')
      })

      it('should encrypt and decrypt data', () => {
        const plaintext = 'Hello, EC!'
        const encrypted = hybridEncrypt(plaintext, keyPair.publicKey, 'ec-p256')
        const decrypted = hybridDecrypt(encrypted, keyPair.privateKey)
        expect(decrypted).toBe(plaintext)
      })

      it('should encrypt and decrypt long data', () => {
        const plaintext = 'B'.repeat(5000)
        const encrypted = hybridEncrypt(plaintext, keyPair.publicKey, 'ec-p256')
        const decrypted = hybridDecrypt(encrypted, keyPair.privateKey)
        expect(decrypted).toBe(plaintext)
      })
    })

    describe('EC P-384', () => {
      let keyPair: KeyPair

      beforeAll(() => {
        keyPair = generateKeyPair('ec-p384')
      })

      it('should encrypt and decrypt data', () => {
        const plaintext = 'Hello, EC P-384!'
        const encrypted = hybridEncrypt(plaintext, keyPair.publicKey, 'ec-p384')
        const decrypted = hybridDecrypt(encrypted, keyPair.privateKey)
        expect(decrypted).toBe(plaintext)
      })
    })

    describe('error handling', () => {
      it('should throw for unsupported algorithm on encrypt', () => {
        const keyPair = generateKeyPair('rsa-4096')
        expect(() => hybridEncrypt('test', keyPair.publicKey, 'invalid' as any)).toThrow('Unsupported algorithm')
      })

      it('should throw for unsupported encryption version', () => {
        const keyPair = generateKeyPair('rsa-4096')
        const encrypted = hybridEncrypt('test', keyPair.publicKey)
        encrypted.v = 2 as any
        expect(() => hybridDecrypt(encrypted, keyPair.privateKey)).toThrow('Unsupported encryption version')
      })

      it('should throw for wrong private key', () => {
        const keyPair1 = generateKeyPair('rsa-2048')
        const keyPair2 = generateKeyPair('rsa-2048')
        const encrypted = hybridEncrypt('test', keyPair1.publicKey, 'rsa-2048')
        expect(() => hybridDecrypt(encrypted, keyPair2.privateKey)).toThrow()
      })
    })
  })

  describe('isPublicKey', () => {
    it('should return true for valid public key', () => {
      const keyPair = generateKeyPair('rsa-2048')
      expect(isPublicKey(keyPair.publicKey)).toBe(true)
    })

    // Note: Node.js can derive public key from private key, so this returns true
    it('should return true for private key (Node extracts public key)', () => {
      const keyPair = generateKeyPair('rsa-2048')
      expect(isPublicKey(keyPair.privateKey)).toBe(true)
    })

    it('should return false for invalid string', () => {
      expect(isPublicKey('not a key')).toBe(false)
    })
  })

  describe('isPrivateKey', () => {
    it('should return true for valid private key', () => {
      const keyPair = generateKeyPair('rsa-2048')
      expect(isPrivateKey(keyPair.privateKey)).toBe(true)
    })

    it('should return false for public key', () => {
      const keyPair = generateKeyPair('rsa-2048')
      expect(isPrivateKey(keyPair.publicKey)).toBe(false)
    })

    it('should return false for invalid string', () => {
      expect(isPrivateKey('not a key')).toBe(false)
    })
  })

  describe('detectAlgorithm', () => {
    it('should detect RSA-4096', () => {
      const keyPair = generateKeyPair('rsa-4096')
      expect(detectAlgorithm(keyPair.publicKey)).toBe('rsa-4096')
      expect(detectAlgorithm(keyPair.privateKey)).toBe('rsa-4096')
    })

    it('should detect RSA-2048', () => {
      const keyPair = generateKeyPair('rsa-2048')
      expect(detectAlgorithm(keyPair.publicKey)).toBe('rsa-2048')
      expect(detectAlgorithm(keyPair.privateKey)).toBe('rsa-2048')
    })

    it('should detect EC P-256', () => {
      const keyPair = generateKeyPair('ec-p256')
      expect(detectAlgorithm(keyPair.publicKey)).toBe('ec-p256')
      expect(detectAlgorithm(keyPair.privateKey)).toBe('ec-p256')
    })

    it('should detect EC P-384', () => {
      const keyPair = generateKeyPair('ec-p384')
      expect(detectAlgorithm(keyPair.publicKey)).toBe('ec-p384')
      expect(detectAlgorithm(keyPair.privateKey)).toBe('ec-p384')
    })

    it('should return null for invalid key', () => {
      expect(detectAlgorithm('invalid')).toBe(null)
    })
  })

  describe('isHybridEncrypted', () => {
    it('should return true for valid HybridEncryptedData', () => {
      const data: HybridEncryptedData = {
        v: 1,
        alg: 'rsa-4096+aes-256-gcm',
        key: 'base64key',
        iv: 'base64iv',
        data: 'base64data',
        tag: 'base64tag'
      }
      expect(isHybridEncrypted(data)).toBe(true)
    })

    it('should return false for null', () => {
      expect(isHybridEncrypted(null)).toBe(false)
    })

    it('should return false for string', () => {
      expect(isHybridEncrypted('string')).toBe(false)
    })

    it('should return false for wrong version', () => {
      expect(isHybridEncrypted({ v: 2, alg: 'x', key: 'x', iv: 'x', data: 'x', tag: 'x' })).toBe(false)
    })

    it('should return false for missing fields', () => {
      expect(isHybridEncrypted({ v: 1, alg: 'x' })).toBe(false)
    })
  })

  describe('serializeEncrypted / parseEncrypted', () => {
    it('should serialize and parse encrypted data', () => {
      const keyPair = generateKeyPair('rsa-2048')
      const encrypted = hybridEncrypt('test', keyPair.publicKey, 'rsa-2048')
      const serialized = serializeEncrypted(encrypted)
      const parsed = parseEncrypted(serialized)
      expect(parsed).toEqual(encrypted)
    })

    it('should throw for invalid format', () => {
      expect(() => parseEncrypted('{"invalid": true}')).toThrow('Invalid hybrid encrypted data format')
    })

    it('should throw for invalid JSON', () => {
      expect(() => parseEncrypted('not json')).toThrow()
    })
  })
})
