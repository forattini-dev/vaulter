/**
 * Encoding Detection Utility
 *
 * Detects if a value appears to be pre-encoded or pre-encrypted.
 * Used to warn users about potential double-encryption issues.
 */

export type EncodingType =
  | 'base64'
  | 'base64url'
  | 'hex'
  | 'bcrypt'
  | 'argon2'
  | 'jwt'
  | 'aws-encrypted'
  | 'pgp'
  | 'ssh-key'

export interface EncodingDetectionResult {
  detected: boolean
  type?: EncodingType
  confidence: 'high' | 'medium' | 'low'
  message?: string
}

/**
 * Check if string is valid base64
 */
function isBase64(value: string): boolean {
  // Must be at least 20 chars to reduce false positives
  if (value.length < 20) return false

  // Standard base64 pattern
  const base64Regex = /^[A-Za-z0-9+/]+=*$/

  if (!base64Regex.test(value)) return false

  // Check if it decodes without error
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8')
    // Re-encode and compare to verify it's actually base64
    const reencoded = Buffer.from(decoded).toString('base64')

    // If value ends with padding, check exact match
    if (value.endsWith('=')) {
      return reencoded === value
    }

    // Otherwise check if the non-padded version matches
    return reencoded.replace(/=+$/, '') === value.replace(/=+$/, '')
  } catch {
    return false
  }
}

/**
 * Check if string is valid base64url
 */
function isBase64Url(value: string): boolean {
  if (value.length < 20) return false

  // Base64url uses - and _ instead of + and /
  const base64UrlRegex = /^[A-Za-z0-9_-]+$/

  if (!base64UrlRegex.test(value)) return false

  // Try to decode
  try {
    // Convert base64url to standard base64
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    Buffer.from(padded, 'base64')
    return true
  } catch {
    return false
  }
}

/**
 * Check if string looks like hex-encoded data
 */
function isHexEncoded(value: string): boolean {
  // Must be even length and at least 32 chars (16 bytes)
  if (value.length < 32 || value.length % 2 !== 0) return false

  // Hex pattern (case insensitive)
  const hexRegex = /^[0-9a-fA-F]+$/

  return hexRegex.test(value)
}

/**
 * Check if string is a bcrypt hash
 */
function isBcrypt(value: string): boolean {
  // Bcrypt format: $2a$, $2b$, $2y$ followed by cost factor and 53 chars
  const bcryptRegex = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/
  return bcryptRegex.test(value)
}

/**
 * Check if string is an Argon2 hash
 */
function isArgon2(value: string): boolean {
  // Argon2 format: $argon2id$, $argon2i$, $argon2d$
  const argon2Regex = /^\$argon2(id?|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$/
  return argon2Regex.test(value)
}

/**
 * Check if string looks like a JWT token
 */
function isJWT(value: string): boolean {
  // JWT: three base64url parts separated by dots
  const parts = value.split('.')
  if (parts.length !== 3) return false

  // Each part should be base64url
  return parts.every(part => /^[A-Za-z0-9_-]+$/.test(part) && part.length > 0)
}

/**
 * Check if string looks like AWS encrypted data
 */
function isAWSEncrypted(value: string): boolean {
  // AWS KMS encrypted data often starts with AQI or similar
  // Or has the format of a ciphertext blob
  return value.startsWith('AQI') || value.startsWith('AQE')
}

/**
 * Check if string looks like PGP/GPG encrypted data
 */
function isPGPEncrypted(value: string): boolean {
  return value.includes('-----BEGIN PGP MESSAGE-----') ||
         value.includes('-----BEGIN PGP ENCRYPTED MESSAGE-----')
}

/**
 * Check if string looks like an SSH key
 */
function isSSHKey(value: string): boolean {
  return value.startsWith('ssh-rsa ') ||
         value.startsWith('ssh-ed25519 ') ||
         value.startsWith('ecdsa-sha2-') ||
         value.includes('-----BEGIN OPENSSH PRIVATE KEY-----') ||
         value.includes('-----BEGIN RSA PRIVATE KEY-----')
}

/**
 * Detect if a value appears to be pre-encoded or pre-encrypted
 *
 * @param value - The value to check
 * @returns Detection result with type and confidence
 */
export function detectEncoding(value: string): EncodingDetectionResult {
  // Skip short values - less likely to be intentionally encoded
  if (value.length < 16) {
    return { detected: false, confidence: 'low' }
  }

  // Check for specific patterns (high confidence)
  if (isBcrypt(value)) {
    return {
      detected: true,
      type: 'bcrypt',
      confidence: 'high',
      message: 'Value appears to be a bcrypt hash. Vaulter will encrypt it again.'
    }
  }

  if (isArgon2(value)) {
    return {
      detected: true,
      type: 'argon2',
      confidence: 'high',
      message: 'Value appears to be an Argon2 hash. Vaulter will encrypt it again.'
    }
  }

  if (isJWT(value)) {
    return {
      detected: true,
      type: 'jwt',
      confidence: 'high',
      message: 'Value appears to be a JWT token. Vaulter will encrypt it, which is fine for storage.'
    }
  }

  if (isPGPEncrypted(value)) {
    return {
      detected: true,
      type: 'pgp',
      confidence: 'high',
      message: 'Value appears to be PGP encrypted. Storing pre-encrypted data will result in double encryption.'
    }
  }

  if (isSSHKey(value)) {
    return {
      detected: true,
      type: 'ssh-key',
      confidence: 'high',
      message: 'Value appears to be an SSH key. This is fine to store.'
    }
  }

  if (isAWSEncrypted(value)) {
    return {
      detected: true,
      type: 'aws-encrypted',
      confidence: 'medium',
      message: 'Value may be AWS KMS encrypted data. Double encryption will occur.'
    }
  }

  // Check for encoding patterns (medium confidence)
  // Only flag base64 if it looks like it was intentionally encoded
  // (not just a value that happens to match base64 charset)
  if (isBase64(value) && value.length >= 40 && value.endsWith('=')) {
    return {
      detected: true,
      type: 'base64',
      confidence: 'medium',
      message: 'Value appears to be base64 encoded. If you pre-encoded it, Vaulter will encrypt the encoded string.'
    }
  }

  if (isBase64Url(value) && value.length >= 40) {
    return {
      detected: true,
      type: 'base64url',
      confidence: 'medium',
      message: 'Value appears to be base64url encoded. If you pre-encoded it, Vaulter will encrypt the encoded string.'
    }
  }

  // Hex encoding is very common for various things, only flag long hex strings
  if (isHexEncoded(value) && value.length >= 64) {
    return {
      detected: true,
      type: 'hex',
      confidence: 'low',
      message: 'Value appears to be hex encoded. If this is pre-encrypted data, double encryption will occur.'
    }
  }

  return { detected: false, confidence: 'low' }
}

/**
 * Format a warning message for CLI output
 */
export function formatEncodingWarning(result: EncodingDetectionResult, key: string): string | null {
  if (!result.detected || result.confidence === 'low') {
    return null
  }

  const prefix = result.confidence === 'high' ? 'Warning' : 'Note'
  return `${prefix}: ${key} - ${result.message}`
}

/**
 * Check multiple values and return warnings
 */
export function checkValuesForEncoding(
  variables: Array<{ key: string; value: string }>
): Array<{ key: string; result: EncodingDetectionResult }> {
  const warnings: Array<{ key: string; result: EncodingDetectionResult }> = []

  for (const { key, value } of variables) {
    const result = detectEncoding(value)
    if (result.detected && result.confidence !== 'low') {
      warnings.push({ key, result })
    }
  }

  return warnings
}
