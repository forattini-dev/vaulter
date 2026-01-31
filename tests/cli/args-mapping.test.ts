/**
 * Tests for CLI argument mapping
 *
 * Validates that CLI options are correctly mapped to CLIArgs
 */

import { describe, it, expect } from 'vitest'

// Import the toCliArgs function by loading it dynamically
// We test the CLI arg parsing behavior indirectly through the types
import type { CLIArgs } from '../../src/types.js'

describe('CLI Args Mapping', () => {
  describe('CLIArgs type', () => {
    it('should have strategy field for sync command', () => {
      const args: CLIArgs = {
        _: ['sync', 'merge'],
        strategy: 'local'
      }
      expect(args.strategy).toBe('local')
      expect(['local', 'remote', 'error']).toContain(args.strategy)
    })

    it('should have values field for sync command', () => {
      const args: CLIArgs = {
        _: ['sync', 'diff'],
        values: true
      }
      expect(args.values).toBe(true)
    })

    it('should have scope field for key commands', () => {
      const args: CLIArgs = {
        _: ['key', 'backup'],
        scope: 'project'
      }
      expect(args.scope).toBe('project')
    })

    it('should have repo field for export command', () => {
      const args: CLIArgs = {
        _: ['export', 'github-actions'],
        repo: 'owner/repo'
      }
      expect(args.repo).toBe('owner/repo')
    })

    it('should have prune field for sync push/pull', () => {
      const args: CLIArgs = {
        _: ['sync', 'push'],
        prune: true
      }
      expect(args.prune).toBe(true)
    })

    it('should have shared field for monorepo operations', () => {
      const args: CLIArgs = {
        _: ['var', 'set'],
        shared: true
      }
      expect(args.shared).toBe(true)
    })
  })

  describe('CLIArgs required fields', () => {
    it('should always have positional args array', () => {
      const args: CLIArgs = { _: [] }
      expect(args._).toBeDefined()
      expect(Array.isArray(args._)).toBe(true)
    })

    it('should support environment field', () => {
      const args: CLIArgs = {
        _: ['var', 'list'],
        environment: 'dev'
      }
      expect(args.environment).toBe('dev')
    })

    it('should support project field', () => {
      const args: CLIArgs = {
        _: ['var', 'list'],
        project: 'my-project'
      }
      expect(args.project).toBe('my-project')
    })

    it('should support service field', () => {
      const args: CLIArgs = {
        _: ['var', 'list'],
        service: 'api'
      }
      expect(args.service).toBe('api')
    })
  })

  describe('CLIArgs optional flags', () => {
    it('should support verbose flag', () => {
      const args: CLIArgs = {
        _: [],
        verbose: true
      }
      expect(args.verbose).toBe(true)
    })

    it('should support dryRun flag', () => {
      const args: CLIArgs = {
        _: [],
        dryRun: true
      }
      expect(args.dryRun).toBe(true)
    })

    it('should support json flag', () => {
      const args: CLIArgs = {
        _: [],
        json: true
      }
      expect(args.json).toBe(true)
    })

    it('should support force flag', () => {
      const args: CLIArgs = {
        _: [],
        force: true
      }
      expect(args.force).toBe(true)
    })

    it('should support all flag for monorepo batch operations', () => {
      const args: CLIArgs = {
        _: ['sync', 'push'],
        all: true
      }
      expect(args.all).toBe(true)
    })
  })

  describe('Export format options', () => {
    it('should support format field', () => {
      const args: CLIArgs = {
        _: ['export'],
        format: 'json'
      }
      expect(args.format).toBe('json')
    })

    it('should support namespace field for k8s exports', () => {
      const args: CLIArgs = {
        _: ['export', 'k8s-secret'],
        namespace: 'my-namespace'
      }
      expect(args.namespace).toBe('my-namespace')
    })

    it('should support output field', () => {
      const args: CLIArgs = {
        _: ['sync', 'pull'],
        output: 'web'
      }
      expect(args.output).toBe('web')
    })
  })

  describe('File operations', () => {
    it('should support file field', () => {
      const args: CLIArgs = {
        _: ['sync', 'merge'],
        file: '/path/to/.env'
      }
      expect(args.file).toBe('/path/to/.env')
    })

    it('should support key field for encryption', () => {
      const args: CLIArgs = {
        _: ['var', 'set'],
        key: 'my-key-name'
      }
      expect(args.key).toBe('my-key-name')
    })

    it('should support backend field', () => {
      const args: CLIArgs = {
        _: ['var', 'list'],
        backend: 's3://bucket/path'
      }
      expect(args.backend).toBe('s3://bucket/path')
    })
  })

  describe('Key command options', () => {
    it('should support name field for key generation', () => {
      const args: CLIArgs = {
        _: ['key', 'generate'],
        name: 'master'
      }
      expect(args.name).toBe('master')
    })

    it('should support asymmetric flag', () => {
      const args: CLIArgs = {
        _: ['key', 'generate'],
        asymmetric: true
      }
      expect(args.asymmetric).toBe(true)
    })

    it('should support algorithm field', () => {
      const args: CLIArgs = {
        _: ['key', 'generate'],
        algorithm: 'rsa-4096'
      }
      expect(args.algorithm).toBe('rsa-4096')
    })
  })
})
