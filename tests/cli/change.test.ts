/**
 * Tests for Vaulter `change` command local-first flow.
 *
 * Tests the integration of:
 * - change set → governance check → domain/state.writeLocalVariable
 * - change delete → domain/state.deleteLocalVariable
 * - change move → domain/state.moveLocalVariable
 * - change import → batch writeLocalVariable from .env file
 *
 * Since CLI commands use process.exit() and dynamic imports,
 * we test the core flows through the domain layer directly,
 * verifying the exact same logic the `change` command uses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  writeLocalVariable,
  deleteLocalVariable,
  moveLocalVariable,
  readLocalState,
  readProvenance
} from '../../src/domain/state.js'
import { checkSingleVariable } from '../../src/domain/governance.js'
import {
  parseScope,
  sharedScope,
  serviceScope,
  formatScope
} from '../../src/domain/types.js'
import type { Scope } from '../../src/domain/types.js'
import type { VaulterConfig } from '../../src/types.js'
import { parseEnvFile } from '../../src/lib/env-parser.js'

let tmpDir: string
let configDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-change-local-'))
  configDir = path.join(tmpDir, '.vaulter')
  fs.mkdirSync(path.join(configDir, 'local'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function makeConfig(overrides: Partial<VaulterConfig> = {}): VaulterConfig {
  return {
    version: '1',
    project: 'test-project',
    ...overrides
  }
}

// ============================================================================
// Scope Resolution Tests
// ============================================================================

describe('Scope resolution (parseScope)', () => {
  it('resolves --scope shared', () => {
    expect(parseScope('shared')).toEqual({ kind: 'shared' })
  })

  it('resolves --scope service:svc-auth', () => {
    expect(parseScope('service:svc-auth')).toEqual({ kind: 'service', name: 'svc-auth' })
  })

  it('resolves --scope svc-auth (bare name)', () => {
    expect(parseScope('svc-auth')).toEqual({ kind: 'service', name: 'svc-auth' })
  })

  it('returns null for empty string', () => {
    expect(parseScope('')).toBeNull()
  })
})

// ============================================================================
// Local-First Set Flow
// ============================================================================

describe('change set flow (local-first)', () => {
  it('writes a secret to local state', () => {
    const result = writeLocalVariable(configDir, 'dev', {
      key: 'DATABASE_URL',
      value: 'postgres://localhost/db',
      scope: sharedScope(),
      sensitive: true
    }, { source: 'cli' })

    expect(result.success).toBe(true)
    expect(result.variable.key).toBe('DATABASE_URL')
    expect(result.variable.sensitive).toBe(true)

    // Verify file
    const secretsPath = path.join(configDir, 'local', 'secrets.env')
    expect(fs.existsSync(secretsPath)).toBe(true)
    const content = fs.readFileSync(secretsPath, 'utf-8')
    expect(content).toContain('DATABASE_URL=postgres://localhost/db')
  })

  it('writes a config to local state', () => {
    const result = writeLocalVariable(configDir, 'dev', {
      key: 'LOG_LEVEL',
      value: 'debug',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    expect(result.success).toBe(true)
    expect(result.variable.sensitive).toBe(false)

    // Verify file
    const configsPath = path.join(configDir, 'local', 'configs.env')
    expect(fs.existsSync(configsPath)).toBe(true)
    const content = fs.readFileSync(configsPath, 'utf-8')
    expect(content).toContain('LOG_LEVEL=debug')
  })

  it('writes to service scope', () => {
    const result = writeLocalVariable(configDir, 'dev', {
      key: 'PORT',
      value: '28000',
      scope: serviceScope('svc-auth'),
      sensitive: false
    }, { source: 'cli' })

    expect(result.success).toBe(true)

    const configsPath = path.join(configDir, 'local', 'services', 'svc-auth', 'configs.env')
    expect(fs.existsSync(configsPath)).toBe(true)
    const content = fs.readFileSync(configsPath, 'utf-8')
    expect(content).toContain('PORT=28000')
  })

  it('records provenance on set', () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'API_KEY',
      value: 'sk-xxx',
      scope: sharedScope(),
      sensitive: true
    }, { source: 'cli', actor: 'testuser' })

    const entries = readProvenance(configDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      key: 'API_KEY',
      op: 'set',
      source: 'cli',
      actor: 'testuser'
    })
  })

  it('batch set writes multiple variables', () => {
    const vars = [
      { key: 'DB_URL', value: 'postgres://...', sensitive: true },
      { key: 'LOG_LEVEL', value: 'info', sensitive: false },
      { key: 'PORT', value: '3000', sensitive: false }
    ]

    for (const v of vars) {
      writeLocalVariable(configDir, 'dev', {
        ...v,
        scope: sharedScope()
      }, { source: 'cli' })
    }

    const state = readLocalState(configDir, 'dev')
    expect(state).toHaveLength(3)
    expect(state.map(v => v.key).sort()).toEqual(['DB_URL', 'LOG_LEVEL', 'PORT'])
  })
})

// ============================================================================
// Governance Integration
// ============================================================================

describe('governance checks before write', () => {
  it('allows well-scoped variables', () => {
    const check = checkSingleVariable({
      key: 'LOG_LEVEL',
      value: 'debug',
      scope: sharedScope(),
      sensitive: false,
      environment: 'dev',
      config: makeConfig()
    })

    expect(check.blocked).toBe(false)
    expect(check.warnings).toEqual([])
  })

  it('warns on scope violation (default mode)', () => {
    const check = checkSingleVariable({
      key: 'MAILGUN_API_KEY',
      value: 'xxx',
      scope: sharedScope(),
      sensitive: true,
      environment: 'dev',
      config: makeConfig()
    })

    expect(check.blocked).toBe(false)
    expect(check.warnings.length).toBeGreaterThan(0)
  })

  it('blocks in strict mode', () => {
    const check = checkSingleVariable({
      key: 'MAILGUN_API_KEY',
      value: 'xxx',
      scope: sharedScope(),
      sensitive: true,
      environment: 'dev',
      config: makeConfig({ scope_policy: { mode: 'strict' } })
    })

    expect(check.blocked).toBe(true)
    expect(check.blockReason).toBeTruthy()
  })

  it('governance result does not affect write when not blocked', () => {
    const check = checkSingleVariable({
      key: 'MAILGUN_API_KEY',
      value: 'xxx',
      scope: sharedScope(),
      sensitive: true,
      environment: 'dev',
      config: makeConfig()
    })

    // Warnings but not blocked — write should succeed
    expect(check.blocked).toBe(false)

    const result = writeLocalVariable(configDir, 'dev', {
      key: 'MAILGUN_API_KEY',
      value: 'xxx',
      scope: sharedScope(),
      sensitive: true
    }, { source: 'cli' })

    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Local-First Delete Flow
// ============================================================================

describe('change delete flow (local-first)', () => {
  it('deletes from shared scope', () => {
    // Setup
    fs.writeFileSync(
      path.join(configDir, 'local', 'configs.env'),
      'LOG_LEVEL=debug\nNODE_ENV=dev\n'
    )

    const deleted = deleteLocalVariable(configDir, 'dev', 'LOG_LEVEL', sharedScope(), { source: 'cli' })
    expect(deleted).toBe(true)

    // Verify removed
    const state = readLocalState(configDir, 'dev')
    expect(state.find(v => v.key === 'LOG_LEVEL')).toBeUndefined()
    expect(state.find(v => v.key === 'NODE_ENV')).toBeDefined()
  })

  it('deletes from service scope', () => {
    const svcDir = path.join(configDir, 'local', 'services', 'svc-auth')
    fs.mkdirSync(svcDir, { recursive: true })
    fs.writeFileSync(path.join(svcDir, 'configs.env'), 'PORT=28000\nHOST=0.0.0.0\n')

    const deleted = deleteLocalVariable(configDir, 'dev', 'PORT', serviceScope('svc-auth'), { source: 'cli' })
    expect(deleted).toBe(true)

    const state = readLocalState(configDir, 'dev', { service: 'svc-auth', includeShared: false })
    expect(state.find(v => v.key === 'PORT')).toBeUndefined()
    expect(state.find(v => v.key === 'HOST')).toBeDefined()
  })

  it('returns false when key not found', () => {
    const deleted = deleteLocalVariable(configDir, 'dev', 'NONEXISTENT', sharedScope(), { source: 'cli' })
    expect(deleted).toBe(false)
  })

  it('records provenance on delete', () => {
    fs.writeFileSync(
      path.join(configDir, 'local', 'configs.env'),
      'LOG_LEVEL=debug\n'
    )

    deleteLocalVariable(configDir, 'dev', 'LOG_LEVEL', sharedScope(), { source: 'cli', actor: 'testuser' })

    const entries = readProvenance(configDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      key: 'LOG_LEVEL',
      op: 'delete',
      source: 'cli'
    })
  })
})

// ============================================================================
// Local-First Move Flow
// ============================================================================

describe('change move flow (local-first)', () => {
  it('moves from shared to service', () => {
    fs.writeFileSync(
      path.join(configDir, 'local', 'configs.env'),
      'LOG_LEVEL=debug\n'
    )

    const result = moveLocalVariable(
      configDir, 'dev', 'LOG_LEVEL',
      sharedScope(),
      serviceScope('svc-auth'),
      { source: 'cli' }
    )

    expect(result.success).toBe(true)

    // Verify moved
    const state = readLocalState(configDir, 'dev')
    const inShared = state.find(v => v.key === 'LOG_LEVEL' && v.scope.kind === 'shared')
    const inService = state.find(v => v.key === 'LOG_LEVEL' && v.scope.kind === 'service')

    expect(inShared).toBeUndefined()
    expect(inService).toBeDefined()
    expect(inService!.scope).toEqual({ kind: 'service', name: 'svc-auth' })
  })

  it('moves from service to shared', () => {
    const svcDir = path.join(configDir, 'local', 'services', 'svc-auth')
    fs.mkdirSync(svcDir, { recursive: true })
    fs.writeFileSync(path.join(svcDir, 'configs.env'), 'PORT=28000\n')

    const result = moveLocalVariable(
      configDir, 'dev', 'PORT',
      serviceScope('svc-auth'),
      sharedScope(),
      { source: 'cli' }
    )

    expect(result.success).toBe(true)

    const state = readLocalState(configDir, 'dev')
    const inShared = state.find(v => v.key === 'PORT' && v.scope.kind === 'shared')
    expect(inShared).toBeDefined()
  })

  it('fails when source key not found', () => {
    const result = moveLocalVariable(
      configDir, 'dev', 'NONEXISTENT',
      sharedScope(),
      serviceScope('svc-auth'),
      { source: 'cli' }
    )

    expect(result.success).toBe(false)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('not found')
  })

  it('records provenance with fromScope', () => {
    fs.writeFileSync(
      path.join(configDir, 'local', 'secrets.env'),
      'DB_URL=postgres://...\n'
    )

    moveLocalVariable(
      configDir, 'dev', 'DB_URL',
      sharedScope(),
      serviceScope('svc-auth'),
      { source: 'cli', actor: 'testuser' }
    )

    const entries = readProvenance(configDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      key: 'DB_URL',
      op: 'move',
      scope: 'service:svc-auth',
      fromScope: 'shared'
    })
  })
})

// ============================================================================
// Import Flow
// ============================================================================

describe('change import flow', () => {
  it('imports variables from .env file', () => {
    // Create a .env file to import
    const envFile = path.join(tmpDir, 'import.env')
    fs.writeFileSync(envFile, 'LOG_LEVEL=info\nNODE_ENV=development\nDB_URL=postgres://...\n')

    const vars = parseEnvFile(envFile)
    expect(Object.keys(vars)).toHaveLength(3)

    // Import each variable (same logic as change import)
    for (const [key, value] of Object.entries(vars)) {
      const sensitive = /secret|key|token|password|url|credentials?/i.test(key)
      writeLocalVariable(configDir, 'dev', {
        key,
        value,
        scope: sharedScope(),
        sensitive
      }, { source: 'import' })
    }

    const state = readLocalState(configDir, 'dev')
    expect(state).toHaveLength(3)

    // DB_URL should be sensitive (matches 'url' pattern)
    const dbVar = state.find(v => v.key === 'DB_URL')
    expect(dbVar?.sensitive).toBe(true)

    // LOG_LEVEL should not be sensitive
    const logVar = state.find(v => v.key === 'LOG_LEVEL')
    expect(logVar?.sensitive).toBe(false)
  })

  it('imports to service scope', () => {
    const envFile = path.join(tmpDir, 'svc.env')
    fs.writeFileSync(envFile, 'PORT=28000\nHOST=0.0.0.0\n')

    const vars = parseEnvFile(envFile)
    const scope = serviceScope('svc-auth')

    for (const [key, value] of Object.entries(vars)) {
      writeLocalVariable(configDir, 'dev', {
        key,
        value,
        scope,
        sensitive: false
      }, { source: 'import' })
    }

    const state = readLocalState(configDir, 'dev', { service: 'svc-auth', includeShared: false })
    expect(state).toHaveLength(2)
    expect(state[0].scope).toEqual({ kind: 'service', name: 'svc-auth' })
  })

  it('records provenance with import source', () => {
    const envFile = path.join(tmpDir, 'import.env')
    fs.writeFileSync(envFile, 'VAR_A=1\nVAR_B=2\n')

    const vars = parseEnvFile(envFile)
    for (const [key, value] of Object.entries(vars)) {
      writeLocalVariable(configDir, 'dev', {
        key,
        value,
        scope: sharedScope(),
        sensitive: false
      }, { source: 'import' })
    }

    const entries = readProvenance(configDir)
    expect(entries).toHaveLength(2)
    expect(entries.every(e => e.source === 'import')).toBe(true)
  })
})

// ============================================================================
// End-to-end: change set → readLocalState round-trip
// ============================================================================

describe('change set → readLocalState round-trip', () => {
  it('preserves scope and sensitivity through write+read', () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'JWT_SECRET',
      value: 'super-secret',
      scope: serviceScope('svc-auth'),
      sensitive: true
    }, { source: 'cli' })

    writeLocalVariable(configDir, 'dev', {
      key: 'LOG_LEVEL',
      value: 'debug',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    const vars = readLocalState(configDir, 'dev')
    expect(vars).toHaveLength(2)

    const jwt = vars.find(v => v.key === 'JWT_SECRET')
    expect(jwt).toMatchObject({
      key: 'JWT_SECRET',
      scope: { kind: 'service', name: 'svc-auth' },
      sensitive: true
    })

    const log = vars.find(v => v.key === 'LOG_LEVEL')
    expect(log).toMatchObject({
      key: 'LOG_LEVEL',
      scope: { kind: 'shared' },
      sensitive: false
    })
  })

  it('filters by service correctly', () => {
    // Shared var
    writeLocalVariable(configDir, 'dev', {
      key: 'SHARED_VAR',
      value: '1',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    // svc-auth var
    writeLocalVariable(configDir, 'dev', {
      key: 'AUTH_PORT',
      value: '28000',
      scope: serviceScope('svc-auth'),
      sensitive: false
    }, { source: 'cli' })

    // svc-api var
    writeLocalVariable(configDir, 'dev', {
      key: 'API_PORT',
      value: '28001',
      scope: serviceScope('svc-api'),
      sensitive: false
    }, { source: 'cli' })

    // Filter to svc-auth (should get shared + svc-auth, not svc-api)
    const vars = readLocalState(configDir, 'dev', { service: 'svc-auth' })
    expect(vars).toHaveLength(2)
    expect(vars.map(v => v.key).sort()).toEqual(['AUTH_PORT', 'SHARED_VAR'])
  })
})
