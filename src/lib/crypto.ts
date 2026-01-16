/**
 * Vaulter Crypto Module
 *
 * Provides hybrid encryption using asymmetric keys (RSA/EC) for key exchange
 * and symmetric AES-256-GCM for data encryption.
 *
 * Flow:
 * 1. Generate random AES-256 key
 * 2. Encrypt data with AES-256-GCM
 * 3. Encrypt AES key with RSA/EC public key
 * 4. Package as HybridEncryptedData
 *
 * This allows:
 * - Public key holders to ONLY encrypt (CI/CD, developers)
 * - Private key holders to decrypt (production, key managers)
 */

import crypto from 'node:crypto'
import type { AsymmetricAlgorithm, HybridEncryptedData } from '../types.js'

// ============================================================================
// Key Generation
// ============================================================================

export interface KeyPair {
  publicKey: string
  privateKey: string
  algorithm: AsymmetricAlgorithm
}

/**
 * Generate an asymmetric key pair
 */
export function generateKeyPair(algorithm: AsymmetricAlgorithm = 'rsa-4096'): KeyPair {
  let keyPair: { publicKey: string; privateKey: string }

  switch (algorithm) {
    case 'rsa-4096':
      keyPair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      })
      break

    case 'rsa-2048':
      keyPair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      })
      break

    case 'ec-p256':
      keyPair = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1', // P-256
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      })
      break

    case 'ec-p384':
      keyPair = crypto.generateKeyPairSync('ec', {
        namedCurve: 'secp384r1', // P-384
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      })
      break

    default:
      throw new Error(`Unsupported algorithm: ${algorithm}`)
  }

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    algorithm
  }
}

/**
 * Generate a symmetric passphrase (for symmetric mode)
 */
export function generatePassphrase(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('base64')
}

// ============================================================================
// Hybrid Encryption
// ============================================================================

/**
 * Encrypt data using hybrid encryption
 * Requires only the public key
 *
 * @param data - Plain text data to encrypt
 * @param publicKeyPem - Public key in PEM format
 * @param algorithm - Algorithm used (for metadata)
 * @returns HybridEncryptedData object
 */
export function hybridEncrypt(
  data: string,
  publicKeyPem: string,
  algorithm: AsymmetricAlgorithm = 'rsa-4096'
): HybridEncryptedData {
  // 1. Generate random AES-256 key (32 bytes)
  const aesKey = crypto.randomBytes(32)

  // 2. Generate random IV for AES-GCM (12 bytes recommended)
  const iv = crypto.randomBytes(12)

  // 3. Encrypt data with AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
  const encryptedData = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final()
  ])
  const authTag = cipher.getAuthTag()

  // 4. Encrypt AES key with public key
  let encryptedKey: Buffer

  if (algorithm.startsWith('rsa-')) {
    // RSA encryption
    encryptedKey = crypto.publicEncrypt(
      {
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      aesKey
    )
  } else if (algorithm.startsWith('ec-')) {
    // ECDH key exchange for EC keys
    // Create ephemeral EC key pair
    const curve = algorithm === 'ec-p256' ? 'prime256v1' : 'secp384r1'
    // EC key sizes: P-256 = 32 bytes private / 65 bytes public, P-384 = 48 bytes private / 97 bytes public
    const privateKeySize = algorithm === 'ec-p256' ? 32 : 48
    const publicKeySize = algorithm === 'ec-p256' ? 65 : 97

    const ephemeralKeyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: curve,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })

    // Derive shared secret using ECDH
    const ecdh = crypto.createECDH(curve)
    ecdh.setPrivateKey(
      crypto.createPrivateKey(ephemeralKeyPair.privateKey)
        .export({ type: 'pkcs8', format: 'der' })
        .subarray(-privateKeySize) // Extract raw private key (32 for P-256, 48 for P-384)
    )

    // Get public key from PEM
    const publicKeyObj = crypto.createPublicKey(publicKeyPem)
    const publicKeyDer = publicKeyObj.export({ type: 'spki', format: 'der' })

    // Compute shared secret - extract raw public key point (65 for P-256, 97 for P-384)
    const sharedSecret = ecdh.computeSecret(publicKeyDer.subarray(-publicKeySize))

    // Derive key from shared secret using HKDF
    const derivedKeyBuffer = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, '', 'vaulter-ec', 32))

    // XOR AES key with derived key
    const xorKey = Buffer.alloc(32)
    for (let i = 0; i < 32; i++) {
      xorKey[i] = aesKey[i] ^ derivedKeyBuffer[i]
    }

    // Package: ephemeral public key + XORed AES key
    const ephemeralPubKeyDer = crypto.createPublicKey(ephemeralKeyPair.publicKey)
      .export({ type: 'spki', format: 'der' })

    encryptedKey = Buffer.concat([
      Buffer.from([ephemeralPubKeyDer.length >> 8, ephemeralPubKeyDer.length & 0xff]),
      ephemeralPubKeyDer,
      xorKey
    ])
  } else {
    throw new Error(`Unsupported algorithm: ${algorithm}`)
  }

  return {
    v: 1,
    alg: `${algorithm}+aes-256-gcm`,
    key: encryptedKey.toString('base64'),
    iv: iv.toString('base64'),
    data: encryptedData.toString('base64'),
    tag: authTag.toString('base64')
  }
}

/**
 * Decrypt hybrid-encrypted data
 * Requires the private key
 *
 * @param encrypted - HybridEncryptedData object
 * @param privateKeyPem - Private key in PEM format
 * @returns Decrypted plain text
 */
export function hybridDecrypt(
  encrypted: HybridEncryptedData,
  privateKeyPem: string
): string {
  if (encrypted.v !== 1) {
    throw new Error(`Unsupported encryption version: ${encrypted.v}`)
  }

  const [algorithm] = encrypted.alg.split('+') as [AsymmetricAlgorithm]
  const encryptedKey = Buffer.from(encrypted.key, 'base64')
  const iv = Buffer.from(encrypted.iv, 'base64')
  const encryptedData = Buffer.from(encrypted.data, 'base64')
  const authTag = Buffer.from(encrypted.tag, 'base64')

  let aesKey: Buffer

  if (algorithm.startsWith('rsa-')) {
    // RSA decryption
    aesKey = crypto.privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      encryptedKey
    )
  } else if (algorithm.startsWith('ec-')) {
    // ECDH key exchange for EC keys
    const curve = algorithm === 'ec-p256' ? 'prime256v1' : 'secp384r1'
    // EC key sizes: P-256 = 32 bytes private / 65 bytes public, P-384 = 48 bytes private / 97 bytes public
    const privateKeySize = algorithm === 'ec-p256' ? 32 : 48
    const publicKeySize = algorithm === 'ec-p256' ? 65 : 97

    // Extract ephemeral public key and XORed key
    const ephemeralPubKeyLen = (encryptedKey[0] << 8) | encryptedKey[1]
    const ephemeralPubKeyDer = encryptedKey.subarray(2, 2 + ephemeralPubKeyLen)
    const xorKey = encryptedKey.subarray(2 + ephemeralPubKeyLen)

    // Create ECDH from our private key
    const privateKeyObj = crypto.createPrivateKey(privateKeyPem)
    const privateKeyDer = privateKeyObj.export({ type: 'pkcs8', format: 'der' })

    const ecdh = crypto.createECDH(curve)
    // Extract raw private key
    ecdh.setPrivateKey(privateKeyDer.subarray(-privateKeySize))

    // Compute shared secret - extract raw public key point
    const sharedSecret = ecdh.computeSecret(ephemeralPubKeyDer.subarray(-publicKeySize))

    // Derive key from shared secret using HKDF
    const derivedKeyBuffer = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, '', 'vaulter-ec', 32))

    // XOR to recover AES key
    aesKey = Buffer.alloc(32)
    for (let i = 0; i < 32; i++) {
      aesKey[i] = xorKey[i] ^ derivedKeyBuffer[i]
    }
  } else {
    throw new Error(`Unsupported algorithm: ${algorithm}`)
  }

  // Decrypt data with AES-256-GCM
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final()
  ])

  return decrypted.toString('utf8')
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a string is a valid PEM public key
 */
export function isPublicKey(pem: string): boolean {
  try {
    crypto.createPublicKey(pem)
    return true
  } catch {
    return false
  }
}

/**
 * Check if a string is a valid PEM private key
 */
export function isPrivateKey(pem: string): boolean {
  try {
    crypto.createPrivateKey(pem)
    return true
  } catch {
    return false
  }
}

/**
 * Detect the algorithm from a PEM key
 */
export function detectAlgorithm(pem: string): AsymmetricAlgorithm | null {
  try {
    const key = pem.includes('PRIVATE')
      ? crypto.createPrivateKey(pem)
      : crypto.createPublicKey(pem)

    const keyDetails = key.asymmetricKeyDetails

    if (key.asymmetricKeyType === 'rsa') {
      const modulusLength = keyDetails?.modulusLength || 0
      if (modulusLength >= 4096) return 'rsa-4096'
      if (modulusLength >= 2048) return 'rsa-2048'
    }

    if (key.asymmetricKeyType === 'ec') {
      const namedCurve = keyDetails?.namedCurve
      if (namedCurve === 'prime256v1' || namedCurve === 'P-256') return 'ec-p256'
      if (namedCurve === 'secp384r1' || namedCurve === 'P-384') return 'ec-p384'
    }

    return null
  } catch {
    return null
  }
}

/**
 * Check if data is hybrid-encrypted
 */
export function isHybridEncrypted(data: unknown): data is HybridEncryptedData {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  return (
    obj.v === 1 &&
    typeof obj.alg === 'string' &&
    typeof obj.key === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.data === 'string' &&
    typeof obj.tag === 'string'
  )
}

/**
 * Serialize HybridEncryptedData to a string (for storage)
 */
export function serializeEncrypted(data: HybridEncryptedData): string {
  return JSON.stringify(data)
}

/**
 * Parse a serialized HybridEncryptedData string
 */
export function parseEncrypted(serialized: string): HybridEncryptedData {
  const parsed = JSON.parse(serialized)
  if (!isHybridEncrypted(parsed)) {
    throw new Error('Invalid hybrid encrypted data format')
  }
  return parsed
}
