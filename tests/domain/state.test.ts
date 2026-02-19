import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  readLocalState,
  writeLocalVariable,
  deleteLocalVariable,
  moveLocalVariable,
  listLocalServices,
  hasLocalState,
  readProvenance,
  getProvenanceCount
} from '../../src/domain/state.js'
import { sharedScope, serviceScope } from '../../src/domain/types.js'

let tmpDir: string
let configDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-state-test-'))
  configDir = path.join(tmpDir, '.vaulter')
  fs.mkdirSync(path.join(configDir, 'local'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('readLocalState', () => {
  it('returns empty array when no local files exist', () => {
    const vars = readLocalState(configDir, 'dev')
    expect(vars).toEqual([])
  })

  it('reads shared configs', () => {
    fs.writeFileSync(
      path.join(configDir, 'local', 'configs.env'),
      'LOG_LEVEL=debug\nNODE_ENV=development\n'
    )

    const vars = readLocalState(configDir, 'dev')
    expect(vars).toHaveLength(2)
    expect(vars[0]).toMatchObject({
      key: 'LOG_LEVEL',
      value: 'debug',
      scope: { kind: 'shared' },
      sensitive: false,
      lifecycle: 'active'
    })
  })

  it('reads shared secrets', () => {
    fs.writeFileSync(
      path.join(configDir, 'local', 'secrets.env'),
      'JWT_SECRET=xxx\n'
    )

    const vars = readLocalState(configDir, 'dev')
    expect(vars).toHaveLength(1)
    expect(vars[0]).toMatchObject({
      key: 'JWT_SECRET',
      value: 'xxx',
      scope: { kind: 'shared' },
      sensitive: true
    })
  })

  it('reads service-specific vars', () => {
    const svcDir = path.join(configDir, 'local', 'services', 'svc-auth')
    fs.mkdirSync(svcDir, { recursive: true })
    fs.writeFileSync(path.join(svcDir, 'configs.env'), 'PORT=28000\n')
    fs.writeFileSync(path.join(svcDir, 'secrets.env'), 'DB_URL=postgres://...\n')

    const vars = readLocalState(configDir, 'dev')
    expect(vars).toHaveLength(2)

    const portVar = vars.find(v => v.key === 'PORT')
    expect(portVar).toMatchObject({
      scope: { kind: 'service', name: 'svc-auth' },
      sensitive: false
    })

    const dbVar = vars.find(v => v.key === 'DB_URL')
    expect(dbVar).toMatchObject({
      scope: { kind: 'service', name: 'svc-auth' },
      sensitive: true
    })
  })

  it('filters by service', () => {
    fs.writeFileSync(
      path.join(configDir, 'local', 'configs.env'),
      'LOG_LEVEL=debug\n'
    )

    const svcDir = path.join(configDir, 'local', 'services', 'svc-auth')
    fs.mkdirSync(svcDir, { recursive: true })
    fs.writeFileSync(path.join(svcDir, 'configs.env'), 'PORT=28000\n')

    const svcDir2 = path.join(configDir, 'local', 'services', 'svc-api')
    fs.mkdirSync(svcDir2, { recursive: true })
    fs.writeFileSync(path.join(svcDir2, 'configs.env'), 'PORT=28001\n')

    // Filter to svc-auth only (+ shared)
    const vars = readLocalState(configDir, 'dev', { service: 'svc-auth' })
    expect(vars).toHaveLength(2)
    expect(vars.map(v => v.key).sort()).toEqual(['LOG_LEVEL', 'PORT'])
  })

  it('excludes shared vars when includeShared=false', () => {
    fs.writeFileSync(
      path.join(configDir, 'local', 'configs.env'),
      'LOG_LEVEL=debug\n'
    )

    const svcDir = path.join(configDir, 'local', 'services', 'svc-auth')
    fs.mkdirSync(svcDir, { recursive: true })
    fs.writeFileSync(path.join(svcDir, 'configs.env'), 'PORT=28000\n')

    const vars = readLocalState(configDir, 'dev', {
      service: 'svc-auth',
      includeShared: false
    })
    expect(vars).toHaveLength(1)
    expect(vars[0].key).toBe('PORT')
  })
})

describe('writeLocalVariable', () => {
  it('writes a shared config', () => {
    const result = writeLocalVariable(configDir, 'dev', {
      key: 'LOG_LEVEL',
      value: 'debug',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli' })

    expect(result.success).toBe(true)
    expect(result.variable.key).toBe('LOG_LEVEL')
    expect(result.variable.scope).toEqual({ kind: 'shared' })

    // Verify file was written
    const content = fs.readFileSync(
      path.join(configDir, 'local', 'configs.env'), 'utf-8'
    )
    expect(content).toContain('LOG_LEVEL=debug')
  })

  it('writes a shared secret', () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'JWT_SECRET',
      value: 'supersecret',
      scope: sharedScope(),
      sensitive: true
    }, { source: 'cli' })

    const content = fs.readFileSync(
      path.join(configDir, 'local', 'secrets.env'), 'utf-8'
    )
    expect(content).toContain('JWT_SECRET=supersecret')
  })

  it('writes a service config', () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'PORT',
      value: '28000',
      scope: serviceScope('svc-auth'),
      sensitive: false
    }, { source: 'cli' })

    const content = fs.readFileSync(
      path.join(configDir, 'local', 'services', 'svc-auth', 'configs.env'), 'utf-8'
    )
    expect(content).toContain('PORT=28000')
  })

  it('writes a service secret', () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'DB_URL',
      value: 'postgres://...',
      scope: serviceScope('svc-auth'),
      sensitive: true
    }, { source: 'mcp' })

    const content = fs.readFileSync(
      path.join(configDir, 'local', 'services', 'svc-auth', 'secrets.env'), 'utf-8'
    )
    expect(content).toContain('DB_URL=postgres://...')
  })

  it('records provenance', () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'LOG_LEVEL',
      value: 'debug',
      scope: sharedScope(),
      sensitive: false
    }, { source: 'cli', actor: 'testuser' })

    const entries = readProvenance(configDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      key: 'LOG_LEVEL',
      scope: 'shared',
      op: 'set',
      actor: 'testuser',
      source: 'cli'
    })
  })
})

describe('deleteLocalVariable', () => {
  it('deletes a shared config', () => {
    fs.writeFileSync(
      path.join(configDir, 'local', 'configs.env'),
      'LOG_LEVEL=debug\nNODE_ENV=dev\n'
    )

    const deleted = deleteLocalVariable(configDir, 'dev', 'LOG_LEVEL', sharedScope(), { source: 'cli' })
    expect(deleted).toBe(true)

    const content = fs.readFileSync(
      path.join(configDir, 'local', 'configs.env'), 'utf-8'
    )
    expect(content).not.toContain('LOG_LEVEL')
    expect(content).toContain('NODE_ENV')
  })

  it('returns false when key does not exist', () => {
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
      op: 'delete'
    })
  })

  it('does not record provenance when key not found', () => {
    deleteLocalVariable(configDir, 'dev', 'NONEXISTENT', sharedScope(), { source: 'cli' })

    const entries = readProvenance(configDir)
    expect(entries).toHaveLength(0)
  })
})

describe('moveLocalVariable', () => {
  it('moves from shared to service', () => {
    fs.writeFileSync(
      path.join(configDir, 'local', 'secrets.env'),
      'DB_URL=postgres://...\n'
    )

    const result = moveLocalVariable(
      configDir, 'dev', 'DB_URL',
      sharedScope(),
      serviceScope('svc-auth'),
      { source: 'cli' }
    )

    expect(result.success).toBe(true)

    // Verify removed from shared (file may be deleted if it was the only key)
    const sharedSecretsPath = path.join(configDir, 'local', 'secrets.env')
    if (fs.existsSync(sharedSecretsPath)) {
      const sharedContent = fs.readFileSync(sharedSecretsPath, 'utf-8').trim()
      expect(sharedContent).not.toContain('DB_URL')
    }

    // Verify added to service
    const svcContent = fs.readFileSync(
      path.join(configDir, 'local', 'services', 'svc-auth', 'secrets.env'), 'utf-8'
    )
    expect(svcContent).toContain('DB_URL=postgres://...')
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

    const sharedContent = fs.readFileSync(
      path.join(configDir, 'local', 'configs.env'), 'utf-8'
    )
    expect(sharedContent).toContain('PORT=28000')
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
      path.join(configDir, 'local', 'configs.env'),
      'LOG_LEVEL=debug\n'
    )

    moveLocalVariable(
      configDir, 'dev', 'LOG_LEVEL',
      sharedScope(),
      serviceScope('svc-auth'),
      { source: 'cli', actor: 'testuser' }
    )

    const entries = readProvenance(configDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      key: 'LOG_LEVEL',
      op: 'move',
      scope: 'service:svc-auth',
      fromScope: 'shared'
    })
  })
})

describe('listLocalServices', () => {
  it('returns empty array when no services dir', () => {
    expect(listLocalServices(configDir)).toEqual([])
  })

  it('lists service directories', () => {
    const servicesDir = path.join(configDir, 'local', 'services')
    fs.mkdirSync(path.join(servicesDir, 'svc-auth'), { recursive: true })
    fs.mkdirSync(path.join(servicesDir, 'svc-api'), { recursive: true })

    const services = listLocalServices(configDir)
    expect(services).toEqual(['svc-api', 'svc-auth'])
  })
})

describe('hasLocalState', () => {
  it('returns false for shared with no files', () => {
    expect(hasLocalState(configDir, sharedScope())).toBe(false)
  })

  it('returns true for shared with configs', () => {
    fs.writeFileSync(
      path.join(configDir, 'local', 'configs.env'),
      'LOG_LEVEL=debug\n'
    )
    expect(hasLocalState(configDir, sharedScope())).toBe(true)
  })

  it('returns false for service with no dir', () => {
    expect(hasLocalState(configDir, serviceScope('svc-auth'))).toBe(false)
  })

  it('returns true for service with configs', () => {
    const svcDir = path.join(configDir, 'local', 'services', 'svc-auth')
    fs.mkdirSync(svcDir, { recursive: true })
    fs.writeFileSync(path.join(svcDir, 'configs.env'), 'PORT=28000\n')

    expect(hasLocalState(configDir, serviceScope('svc-auth'))).toBe(true)
  })
})

describe('Provenance', () => {
  it('readProvenance returns empty for no log', () => {
    expect(readProvenance(configDir)).toEqual([])
  })

  it('getProvenanceCount returns 0 for no log', () => {
    expect(getProvenanceCount(configDir)).toBe(0)
  })

  it('records multiple entries', () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'A', value: '1', scope: sharedScope(), sensitive: false
    }, { source: 'cli', actor: 'user1' })

    writeLocalVariable(configDir, 'dev', {
      key: 'B', value: '2', scope: serviceScope('api'), sensitive: true
    }, { source: 'mcp', actor: 'agent' })

    expect(getProvenanceCount(configDir)).toBe(2)
    const entries = readProvenance(configDir)
    expect(entries).toHaveLength(2)
    // Most recent first
    expect(entries[0].key).toBe('B')
    expect(entries[1].key).toBe('A')
  })

  it('filters by key', () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'A', value: '1', scope: sharedScope(), sensitive: false
    }, { source: 'cli' })

    writeLocalVariable(configDir, 'dev', {
      key: 'B', value: '2', scope: sharedScope(), sensitive: false
    }, { source: 'cli' })

    const entries = readProvenance(configDir, { key: 'A' })
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe('A')
  })

  it('filters by operation', () => {
    writeLocalVariable(configDir, 'dev', {
      key: 'A', value: '1', scope: sharedScope(), sensitive: false
    }, { source: 'cli' })

    fs.writeFileSync(
      path.join(configDir, 'local', 'configs.env'),
      'A=1\nB=2\n'
    )
    deleteLocalVariable(configDir, 'dev', 'B', sharedScope(), { source: 'cli' })

    const deletes = readProvenance(configDir, { operation: 'delete' })
    expect(deletes).toHaveLength(1)
    expect(deletes[0].key).toBe('B')
  })

  it('filters by limit', () => {
    for (let i = 0; i < 5; i++) {
      writeLocalVariable(configDir, 'dev', {
        key: `KEY_${i}`, value: `${i}`, scope: sharedScope(), sensitive: false
      }, { source: 'cli' })
    }

    const entries = readProvenance(configDir, { limit: 2 })
    expect(entries).toHaveLength(2)
  })
})
