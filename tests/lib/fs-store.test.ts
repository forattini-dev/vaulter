/**
 * Tests for fs-store.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getEnvDir,
  getServicesDir,
  getServiceDir,
  getConfigsPath,
  getSecretsPath,
  parseEnvFile,
  writeEnvFile,
  loadShared,
  loadService,
  loadMerged,
  loadFlat,
  toEnvVarArray,
  saveVar,
  deleteVar,
  listServices,
  listEnvironments,
  initEnv,
  type EnvVar
} from '../../src/lib/fs-store.js'

describe('fs-store', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `vaulter-fs-store-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(root, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('should resolve path helpers', () => {
    expect(getEnvDir(root, 'dev')).toBe(join(root, 'dev'))
    expect(getServicesDir(root, 'dev')).toBe(join(root, 'dev', 'services'))
    expect(getServiceDir(root, 'dev', 'svc-api')).toBe(join(root, 'dev', 'services', 'svc-api'))
    expect(getConfigsPath(root, 'dev')).toBe(join(root, 'dev', 'configs.env'))
    expect(getSecretsPath(root, 'dev')).toBe(join(root, 'dev', 'secrets.env'))
    expect(getConfigsPath(root, 'dev', 'svc-api')).toBe(join(root, 'dev', 'services', 'svc-api', 'configs.env'))
    expect(getSecretsPath(root, 'dev', 'svc-api')).toBe(join(root, 'dev', 'services', 'svc-api', 'secrets.env'))
  })

  it('should parse env file with comments and quotes', () => {
    const path = join(root, 'env.txt')
    const content = [
      '# comment',
      'A=1',
      'B="spaced value"',
      'C=with # hash',
      'D=',
      "E='single quote'",
      '  ',
      'INVALID'
    ].join('\n')

    writeFileSync(path, content)
    expect(parseEnvFile(path)).toEqual({
      A: '1',
      B: 'spaced value',
      C: 'with # hash',
      D: '',
      E: 'single quote'
    })
  })

  it('should return empty object when env file does not exist', () => {
    expect(parseEnvFile(join(root, 'missing.env'))).toEqual({})
  })

  it('should write env file sorted and quoted when needed', () => {
    const path = join(root, 'out.env')
    writeEnvFile(path, {
      NORMAL: 'value',
      SPACED: 'hello world',
      HASHED: 'a#b',
      EMPTY: '',
      QUOTED: 'va\"l',
      NEWLINE: 'line1\nline2'
    })

    const raw = readFileSync(path, 'utf-8').trim().split('\n')
    expect(raw).toEqual([
      'EMPTY=',
      'HASHED="a#b"',
      'NEWLINE="line1\\nline2"',
      'NORMAL=value',
      'QUOTED="va\\\"l"',
      'SPACED="hello world"'
    ])
  })

  it('should load shared and service vars', () => {
    initEnv(root, 'dev')

    saveVar(root, 'dev', 'A', '1', false)
    saveVar(root, 'dev', 'B', 'secret', true)
    saveVar(root, 'dev', 'C', 'service-value', false, 'svc-api')
    saveVar(root, 'dev', 'D', 'service-secret', true, 'svc-api')

    expect(loadShared(root, 'dev')).toEqual({
      configs: { A: '1' },
      secrets: { B: 'secret' }
    })

    expect(loadService(root, 'dev', 'svc-api')).toEqual({
      configs: { C: 'service-value' },
      secrets: { D: 'service-secret' }
    })

    expect(loadMerged(root, 'dev', 'svc-api')).toEqual({
      configs: { A: '1', C: 'service-value' },
      secrets: { B: 'secret', D: 'service-secret' }
    })

    expect(loadFlat(root, 'dev', 'svc-api')).toEqual({
      A: '1',
      B: 'secret',
      C: 'service-value',
      D: 'service-secret'
    })

    expect(toEnvVarArray(loadMerged(root, 'dev', 'svc-api'))).toEqual([
      { key: 'A', value: '1', sensitive: false },
      { key: 'B', value: 'secret', sensitive: true },
      { key: 'C', value: 'service-value', sensitive: false },
      { key: 'D', value: 'service-secret', sensitive: true }
    ])
  })

  it('should delete vars from both configs and secrets', () => {
    initEnv(root, 'dev')
    saveVar(root, 'dev', 'A', '1', false)
    saveVar(root, 'dev', 'A', 'secret', true)

    expect(parseEnvFile(getConfigsPath(root, 'dev'))).toEqual({ A: '1' })
    expect(parseEnvFile(getSecretsPath(root, 'dev'))).toEqual({ A: 'secret' })

    const removed = deleteVar(root, 'dev', 'A')
    expect(removed).toBe(true)
    expect(parseEnvFile(getConfigsPath(root, 'dev'))).toEqual({})
    expect(parseEnvFile(getSecretsPath(root, 'dev'))).toEqual({})
  })

  it('should list services and environments', () => {
    initEnv(root, 'dev', ['svc-a', 'svc-b'])
    initEnv(root, 'prd', ['svc-a'])

    expect(listServices(root, 'dev')).toEqual(['svc-a', 'svc-b'])
    expect(listServices(root, 'prd')).toEqual(['svc-a'])
    expect(listEnvironments(root)).toEqual(['dev', 'prd'])
  })

  it('should ignore non-env files in listServices', () => {
    initEnv(root, 'dev', ['svc-a'])
    writeFileSync(join(root, 'dev', 'services', 'README.md'), 'ignore')

    expect(listServices(root, 'dev')).toEqual(['svc-a'])
  })

  it('should expose legacy aliases to env structures', () => {
    initEnv(root, 'dev', ['svc-api'])
    saveVar(root, 'dev', 'A', 'shared', false)
    saveVar(root, 'dev', 'A', 'svc', false, 'svc-api')

    expect(loadMerged(root, 'dev', 'svc-api')).toEqual({
      configs: { A: 'svc' },
      secrets: {}
    })
  })
})
