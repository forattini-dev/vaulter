/**
 * Tests for Vaulter Error Hierarchy
 */

import { describe, it, expect } from 'vitest'
import {
  // Base classes
  VaulterError,
  ConfigError,
  BackendError,
  EncryptionError,
  ValidationError,
  OperationError,
  // Config errors
  ConfigNotFoundError,
  InvalidConfigError,
  CircularExtendsError,
  ExtendsDepthError,
  // Backend errors
  ConnectionError,
  NotInitializedError,
  NoBackendError,
  // Encryption errors
  KeyNotFoundError,
  DecryptionError,
  AsymmetricKeyError,
  // Validation errors
  InvalidEnvironmentError,
  InvalidKeyNameError,
  MissingInputError,
  // Operation errors
  FileNotFoundError,
  VariableNotFoundError,
  SyncConflictError,
  MissingRequiredVarsError,
  BatchOperationError,
  VersionNotFoundError,
  OutputNotFoundError,
  // Type guards
  isVaulterError,
  isConfigError,
  isBackendError,
  isEncryptionError,
  isValidationError,
  isOperationError,
  // Helpers
  formatErrorForCli,
  formatErrorForMcp,
  wrapError
} from '../../src/lib/errors.js'

describe('VaulterError (base class)', () => {
  it('should create error with message and code', () => {
    const error = new VaulterError('test message', 'TEST_CODE')
    expect(error.message).toBe('test message')
    expect(error.code).toBe('TEST_CODE')
    expect(error.name).toBe('VaulterError')
    expect(error instanceof Error).toBe(true)
  })

  it('should support suggestion', () => {
    const error = new VaulterError('test', 'TEST', { suggestion: 'try this' })
    expect(error.suggestion).toBe('try this')
  })

  it('should support context', () => {
    const error = new VaulterError('test', 'TEST', { context: { foo: 'bar' } })
    expect(error.context).toEqual({ foo: 'bar' })
  })

  it('should support cause', () => {
    const cause = new Error('original error')
    const error = new VaulterError('wrapped', 'TEST', { cause })
    expect(error.cause).toBe(cause)
  })

  it('should format for CLI output', () => {
    const error = new VaulterError('test message', 'TEST', { suggestion: 'try this' })
    const output = error.toCliOutput()
    expect(output).toContain('Error: test message')
    expect(output).toContain('Suggestion: try this')
  })

  it('should format for MCP response', () => {
    const error = new VaulterError('test message', 'TEST_CODE', { suggestion: 'try this' })
    const output = error.toMcpResponse()
    expect(output).toContain('Error [TEST_CODE]: test message')
    expect(output).toContain('Suggestion: try this')
  })

  it('should convert to JSON', () => {
    const error = new VaulterError('test', 'TEST', {
      suggestion: 'hint',
      context: { key: 'value' }
    })
    const json = error.toJSON()
    expect(json.name).toBe('VaulterError')
    expect(json.code).toBe('TEST')
    expect(json.message).toBe('test')
    expect(json.suggestion).toBe('hint')
    expect(json.context).toEqual({ key: 'value' })
  })
})

describe('ConfigError hierarchy', () => {
  describe('ConfigNotFoundError', () => {
    it('should create error without path', () => {
      const error = new ConfigNotFoundError()
      expect(error.code).toBe('CONFIG_NOT_FOUND')
      expect(error.message).toContain('No .vaulter/config.yaml found')
      expect(error.suggestion).toContain('vaulter init')
      expect(error instanceof ConfigError).toBe(true)
      expect(error instanceof VaulterError).toBe(true)
    })

    it('should create error with path', () => {
      const error = new ConfigNotFoundError('/path/to/config.yaml')
      expect(error.message).toContain('/path/to/config.yaml')
      expect(error.context?.searchedPath).toBe('/path/to/config.yaml')
    })
  })

  describe('InvalidConfigError', () => {
    it('should create error with message', () => {
      const error = new InvalidConfigError('invalid syntax')
      expect(error.code).toBe('INVALID_CONFIG')
      expect(error.message).toContain('invalid syntax')
    })

    it('should include config path', () => {
      const error = new InvalidConfigError('bad yaml', '/path/config.yaml')
      expect(error.message).toContain('/path/config.yaml')
      expect(error.context?.configPath).toBe('/path/config.yaml')
    })

    it('should include cause', () => {
      const cause = new Error('parse error')
      const error = new InvalidConfigError('bad yaml', undefined, cause)
      expect(error.cause).toBe(cause)
    })
  })

  describe('CircularExtendsError', () => {
    it('should create error with path', () => {
      const error = new CircularExtendsError('/path/to/config.yaml')
      expect(error.code).toBe('CIRCULAR_EXTENDS')
      expect(error.message).toContain('Circular')
      expect(error.message).toContain('/path/to/config.yaml')
    })
  })

  describe('ExtendsDepthError', () => {
    it('should create error with max depth', () => {
      const error = new ExtendsDepthError(10)
      expect(error.code).toBe('EXTENDS_DEPTH_EXCEEDED')
      expect(error.message).toContain('10')
      expect(error.context?.maxDepth).toBe(10)
    })
  })
})

describe('BackendError hierarchy', () => {
  describe('ConnectionError', () => {
    it('should create error with URLs and errors', () => {
      const error = new ConnectionError(
        ['s3://bucket', 'http://localhost'],
        ['access denied', 'timeout']
      )
      expect(error.code).toBe('CONNECTION_FAILED')
      expect(error.message).toContain('s3://bucket')
      expect(error.message).toContain('access denied')
      expect(error.context?.urls).toEqual(['s3://bucket', 'http://localhost'])
    })
  })

  describe('NotInitializedError', () => {
    it('should create error', () => {
      const error = new NotInitializedError()
      expect(error.code).toBe('NOT_INITIALIZED')
      expect(error.message).toContain('not initialized')
      expect(error.suggestion).toContain('connect()')
    })
  })

  describe('NoBackendError', () => {
    it('should create error', () => {
      const error = new NoBackendError()
      expect(error.code).toBe('NO_BACKEND')
      expect(error.message).toContain('No backend URL')
      expect(error.suggestion).toContain('backend.url')
    })
  })
})

describe('EncryptionError hierarchy', () => {
  describe('KeyNotFoundError', () => {
    it('should create error without details', () => {
      const error = new KeyNotFoundError()
      expect(error.code).toBe('KEY_NOT_FOUND')
      expect(error.message).toContain('No encryption key found')
      expect(error.suggestion).toContain('VAULTER_KEY')
    })

    it('should create error with environment', () => {
      const error = new KeyNotFoundError(undefined, 'prd')
      expect(error.message).toContain('prd')
      expect(error.suggestion).toContain('VAULTER_KEY_PRD')
    })

    it('should create error with key name', () => {
      const error = new KeyNotFoundError('master', 'dev')
      expect(error.message).toContain('master')
      expect(error.message).toContain('dev')
    })
  })

  describe('DecryptionError', () => {
    it('should create error with reason', () => {
      const error = new DecryptionError('wrong key')
      expect(error.code).toBe('DECRYPTION_FAILED')
      expect(error.message).toContain('wrong key')
    })

    it('should include cause', () => {
      const cause = new Error('crypto error')
      const error = new DecryptionError('failed', cause)
      expect(error.cause).toBe(cause)
    })
  })

  describe('AsymmetricKeyError', () => {
    it('should create error for missing public key', () => {
      const error = new AsymmetricKeyError('Cannot encrypt', 'public')
      expect(error.code).toBe('ASYMMETRIC_KEY_ERROR')
      expect(error.suggestion).toContain('public key')
    })

    it('should create error for missing private key', () => {
      const error = new AsymmetricKeyError('Cannot decrypt', 'private')
      expect(error.suggestion).toContain('private key')
    })
  })
})

describe('ValidationError hierarchy', () => {
  describe('InvalidEnvironmentError', () => {
    it('should create error with details', () => {
      const error = new InvalidEnvironmentError('staging', ['dev', 'stg', 'prd'])
      expect(error.code).toBe('INVALID_ENVIRONMENT')
      expect(error.message).toContain('staging')
      expect(error.suggestion).toContain('dev, stg, prd')
    })
  })

  describe('InvalidKeyNameError', () => {
    it('should create error for null', () => {
      const error = new InvalidKeyNameError(null)
      expect(error.code).toBe('INVALID_KEY_NAME')
      expect(error.message).toContain('object')
    })

    it('should create error for number', () => {
      const error = new InvalidKeyNameError(123)
      expect(error.message).toContain('number')
    })
  })

  describe('MissingInputError', () => {
    it('should create error with input name', () => {
      const error = new MissingInputError('environment')
      expect(error.code).toBe('MISSING_INPUT')
      expect(error.message).toContain('environment')
      expect(error.suggestion).toContain('environment')
    })
  })
})

describe('OperationError hierarchy', () => {
  describe('FileNotFoundError', () => {
    it('should create error with path', () => {
      const error = new FileNotFoundError('/path/to/file.env')
      expect(error.code).toBe('FILE_NOT_FOUND')
      expect(error.message).toContain('/path/to/file.env')
    })
  })

  describe('VariableNotFoundError', () => {
    it('should create error without environment', () => {
      const error = new VariableNotFoundError('API_KEY')
      expect(error.code).toBe('VARIABLE_NOT_FOUND')
      expect(error.message).toContain('API_KEY')
    })

    it('should create error with environment', () => {
      const error = new VariableNotFoundError('API_KEY', 'prd')
      expect(error.message).toContain('prd')
      expect(error.suggestion).toContain('-e prd')
    })
  })

  describe('SyncConflictError', () => {
    it('should create error with keys', () => {
      const error = new SyncConflictError(['KEY1', 'KEY2'])
      expect(error.code).toBe('SYNC_CONFLICT')
      expect(error.message).toContain('KEY1')
      expect(error.message).toContain('KEY2')
      expect(error.suggestion).toContain('vaulter plan')
    })
  })

  describe('MissingRequiredVarsError', () => {
    it('should create error with details', () => {
      const error = new MissingRequiredVarsError('prd', ['DB_URL', 'API_KEY'])
      expect(error.code).toBe('MISSING_REQUIRED_VARS')
      expect(error.message).toContain('prd')
      expect(error.message).toContain('DB_URL')
    })
  })

  describe('BatchOperationError', () => {
    it('should create error with failures', () => {
      const failures = [
        { key: 'KEY1', error: 'failed' },
        { key: 'KEY2', error: 'timeout' }
      ]
      const error = new BatchOperationError('set', 5, failures)
      expect(error.code).toBe('BATCH_OPERATION_FAILED')
      expect(error.successCount).toBe(5)
      expect(error.failures).toEqual(failures)
      expect(error.message).toContain('KEY1')
    })
  })

  describe('VersionNotFoundError', () => {
    it('should create error', () => {
      const error = new VersionNotFoundError('API_KEY', 5)
      expect(error.code).toBe('VERSION_NOT_FOUND')
      expect(error.message).toContain('API_KEY')
      expect(error.message).toContain('5')
    })
  })

  describe('OutputNotFoundError', () => {
    it('should create error with available outputs', () => {
      const error = new OutputNotFoundError('invalid', ['web', 'api'])
      expect(error.code).toBe('OUTPUT_NOT_FOUND')
      expect(error.message).toContain('invalid')
      expect(error.suggestion).toContain('web, api')
    })
  })
})

describe('Type guards', () => {
  it('isVaulterError should detect VaulterError', () => {
    expect(isVaulterError(new VaulterError('test', 'TEST'))).toBe(true)
    expect(isVaulterError(new ConfigNotFoundError())).toBe(true)
    expect(isVaulterError(new Error('test'))).toBe(false)
    expect(isVaulterError('string')).toBe(false)
    expect(isVaulterError(null)).toBe(false)
  })

  it('isConfigError should detect ConfigError', () => {
    expect(isConfigError(new ConfigNotFoundError())).toBe(true)
    expect(isConfigError(new InvalidConfigError('test'))).toBe(true)
    expect(isConfigError(new BackendError('test', 'TEST'))).toBe(false)
    expect(isConfigError(new VaulterError('test', 'TEST'))).toBe(false)
  })

  it('isBackendError should detect BackendError', () => {
    expect(isBackendError(new NotInitializedError())).toBe(true)
    expect(isBackendError(new NoBackendError())).toBe(true)
    expect(isBackendError(new ConfigError('test', 'TEST'))).toBe(false)
  })

  it('isEncryptionError should detect EncryptionError', () => {
    expect(isEncryptionError(new KeyNotFoundError())).toBe(true)
    expect(isEncryptionError(new DecryptionError('test'))).toBe(true)
    expect(isEncryptionError(new VaulterError('test', 'TEST'))).toBe(false)
  })

  it('isValidationError should detect ValidationError', () => {
    expect(isValidationError(new InvalidEnvironmentError('x', ['a']))).toBe(true)
    expect(isValidationError(new MissingInputError('x'))).toBe(true)
    expect(isValidationError(new OperationError('test', 'TEST'))).toBe(false)
  })

  it('isOperationError should detect OperationError', () => {
    expect(isOperationError(new FileNotFoundError('/path'))).toBe(true)
    expect(isOperationError(new SyncConflictError(['k']))).toBe(true)
    expect(isOperationError(new ValidationError('test', 'TEST'))).toBe(false)
  })
})

describe('Helper functions', () => {
  describe('formatErrorForCli', () => {
    it('should format VaulterError', () => {
      const error = new ConfigNotFoundError('/path')
      const output = formatErrorForCli(error)
      expect(output).toContain('Error:')
      expect(output).toContain('Suggestion:')
    })

    it('should format regular Error', () => {
      const error = new Error('test error')
      const output = formatErrorForCli(error)
      expect(output).toBe('Error: test error')
    })

    it('should format string', () => {
      const output = formatErrorForCli('just a string')
      expect(output).toBe('Error: just a string')
    })
  })

  describe('formatErrorForMcp', () => {
    it('should format VaulterError with code', () => {
      const error = new KeyNotFoundError()
      const output = formatErrorForMcp(error)
      expect(output).toContain('[KEY_NOT_FOUND]')
    })

    it('should format regular Error', () => {
      const error = new Error('test')
      const output = formatErrorForMcp(error)
      expect(output).toBe('Error: test')
    })
  })

  describe('wrapError', () => {
    it('should pass through VaulterError', () => {
      const original = new KeyNotFoundError()
      const wrapped = wrapError(original)
      expect(wrapped).toBe(original)
    })

    it('should wrap regular Error', () => {
      const original = new Error('test')
      const wrapped = wrapError(original, 'WRAPPED')
      expect(wrapped instanceof VaulterError).toBe(true)
      expect(wrapped.code).toBe('WRAPPED')
      expect(wrapped.cause).toBe(original)
    })

    it('should wrap string', () => {
      const wrapped = wrapError('error string', 'STRING_ERROR')
      expect(wrapped instanceof VaulterError).toBe(true)
      expect(wrapped.message).toBe('error string')
    })
  })
})

describe('Error inheritance', () => {
  it('ConfigNotFoundError should be catchable as Error', () => {
    const error = new ConfigNotFoundError()
    try {
      throw error
    } catch (e) {
      expect(e instanceof Error).toBe(true)
      expect(e instanceof VaulterError).toBe(true)
      expect(e instanceof ConfigError).toBe(true)
      expect(e instanceof ConfigNotFoundError).toBe(true)
    }
  })

  it('should maintain proper prototype chain', () => {
    const error = new VersionNotFoundError('key', 1)
    expect(Object.getPrototypeOf(error)).toBe(VersionNotFoundError.prototype)
    expect(Object.getPrototypeOf(VersionNotFoundError.prototype)).toBe(OperationError.prototype)
    expect(Object.getPrototypeOf(OperationError.prototype)).toBe(VaulterError.prototype)
    expect(Object.getPrototypeOf(VaulterError.prototype)).toBe(Error.prototype)
  })
})
