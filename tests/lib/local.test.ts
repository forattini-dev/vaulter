/**
 * Tests for local.ts helpers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { isMonorepoFromConfig } from '../../src/lib/monorepo.js'
import {
  getLocalDir,
  getSharedDir,
  getSharedConfigPath,
  getSharedSecretsPath,
  getServiceDir,
  getServiceConfigPath,
  getServiceSecretsPath,
  validateLocalServiceScope,
  loadLocalSharedConfigs,
  loadLocalSharedSecrets,
  loadLocalShared,
  setLocalShared,
  deleteLocalShared,
  loadServiceConfigs,
  loadServiceSecrets,
  loadOverrides,
  setOverride,
  deleteOverride,
  resetOverrides,
  resetShared,
  mergeWithOverrides,
  mergeAllLocalVars,
  diffOverrides,
  getLocalStatus,
  resolveBaseEnvironment,
  type LocalStatusResult
} from '../../src/lib/local.js'
import type { VaulterConfig } from '../../src/types.js'

describe('local helpers', () => {
  let tempDir: string
  let configDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-local-helpers-'))
    configDir = path.join(tempDir, '.vaulter')
    fs.mkdirSync(configDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('builds local path helpers correctly', () => {
    expect(getLocalDir(configDir)).toBe(path.join(configDir, 'local'))
    expect(getSharedDir(configDir)).toBe(path.join(configDir, 'local'))
    expect(getSharedConfigPath(configDir)).toBe(path.join(configDir, 'local', 'configs.env'))
    expect(getSharedSecretsPath(configDir)).toBe(path.join(configDir, 'local', 'secrets.env'))
    expect(getServiceDir(configDir)).toBe(path.join(configDir, 'local'))
    expect(getServiceDir(configDir, 'api')).toBe(path.join(configDir, 'local', 'services', 'api'))
    expect(getServiceConfigPath(configDir, 'api')).toBe(path.join(configDir, 'local', 'services', 'api', 'configs.env'))
    expect(getServiceSecretsPath(configDir, 'api')).toBe(path.join(configDir, 'local', 'services', 'api', 'secrets.env'))
  })

  describe('validateLocalServiceScope', () => {
    const baseConfig: VaulterConfig = {
      version: '1',
      project: 'test'
    }

    it('skips scope checks when config is not monorepo', () => {
      const result = validateLocalServiceScope({
        config: baseConfig,
        command: 'set'
      })

      expect(result).toEqual({ ok: true })
    })

    it('passes when shared mode is explicitly set in monorepo', () => {
      const result = validateLocalServiceScope({
        config: { ...baseConfig, services: ['api'] },
        shared: true,
        command: 'push'
      })

      expect(result).toEqual({ ok: true })
    })

    it('passes when service is explicit in monorepo', () => {
      const result = validateLocalServiceScope({
        config: { ...baseConfig, services: ['api', 'worker'] },
        service: 'api',
        command: 'sync'
      })

      expect(result).toEqual({ ok: true })
    })

    it('returns guidance when monorepo requires service', () => {
      const result = validateLocalServiceScope({
        config: { ...baseConfig, services: ['api'] },
        command: 'delete'
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('requires a service')
        expect(result.hint).toContain('api')
      }
    })
  })

  describe('shared and service vars operations', () => {
    it('reads and writes shared and sensitive shared vars', () => {
      expect(loadLocalShared(configDir)).toEqual({})

      setLocalShared(configDir, 'APP_NAME', 'shared')
      setLocalShared(configDir, 'API_KEY', 'secret', true)
      setLocalShared(configDir, 'APP_NAME', 'updated', false)
      setLocalShared(configDir, 'API_KEY', 'updated-secret', true)

      expect(loadLocalSharedConfigs(configDir)).toEqual({ APP_NAME: 'updated' })
      expect(loadLocalSharedSecrets(configDir)).toEqual({ API_KEY: 'updated-secret' })
      expect(loadLocalShared(configDir)).toEqual({
        APP_NAME: 'updated',
        API_KEY: 'updated-secret'
      })

      expect(deleteLocalShared(configDir, 'APP_NAME')).toBe(true)
      expect(loadLocalShared(configDir)).toEqual({ API_KEY: 'updated-secret' })
      expect(deleteLocalShared(configDir, 'MISSING')).toBe(false)
    })

    it('reads and writes service-specific vars and keeps service isolation', () => {
      setOverride(configDir, 'DATABASE_URL', 'postgres://api', 'api')
      setOverride(configDir, 'DATABASE_URL', 'postgres://worker', 'worker')
      setOverride(configDir, 'API_SECRET', 'api-secret', 'api', true)

      expect(loadServiceConfigs(configDir, 'api')).toEqual({ DATABASE_URL: 'postgres://api' })
      expect(loadServiceSecrets(configDir, 'api')).toEqual({ API_SECRET: 'api-secret' })
      expect(loadOverrides(configDir, 'api')).toEqual({
        DATABASE_URL: 'postgres://api',
        API_SECRET: 'api-secret'
      })
      expect(loadOverrides(configDir, 'worker')).toEqual({ DATABASE_URL: 'postgres://worker' })
      expect(loadServiceConfigs(configDir, 'api')).not.toEqual(loadServiceConfigs(configDir, 'worker'))
    })

    it('deletes service keys and cleans service directories', () => {
      setOverride(configDir, 'A', '1', 'api')
      setOverride(configDir, 'B', '2', 'api', true)
      setOverride(configDir, 'C', '3', 'worker')

      expect(resetOverrides(configDir, 'api')).toBeUndefined()
      expect(loadOverrides(configDir, 'api')).toEqual({})
      expect(loadOverrides(configDir, 'worker')).toEqual({ C: '3' })
      expect(fs.existsSync(getServiceDir(configDir, 'api'))).toBe(false)
    })

    it('deletes shared files with resetShared', () => {
      setLocalShared(configDir, 'A', '1')
      setLocalShared(configDir, 'B', '2', true)

      expect(loadLocalShared(configDir)).toEqual({ A: '1', B: '2' })
      resetShared(configDir)
      expect(loadLocalShared(configDir)).toEqual({})
    })

    it('deletes explicit keys with deleteOverride', () => {
      setOverride(configDir, 'SHOULD_DELETE', '1', 'api')
      setOverride(configDir, 'KEEP', '2', 'api')

      expect(deleteOverride(configDir, 'SHOULD_DELETE', 'api')).toBe(true)
      expect(deleteOverride(configDir, 'MISSING', 'api')).toBe(false)
      expect(loadOverrides(configDir, 'api')).toEqual({ KEEP: '2' })
    })
  })

  describe('merge and diff helpers', () => {
    it('merges override precedence and diffs', () => {
      const base = { A: '1', B: '2', C: '3' }
      const overrides = { A: 'override', D: '4' }

      expect(mergeWithOverrides(base, overrides)).toEqual({
        A: 'override',
        B: '2',
        C: '3',
        D: '4'
      })

      const diff = diffOverrides(base, overrides)
      expect(diff).toEqual({
        added: ['D'],
        modified: ['A'],
        baseOnly: ['B', 'C'],
        overrides: { A: 'override', D: '4' },
        baseVars: { A: '1', B: '2', C: '3' }
      })

      expect(mergeAllLocalVars(base, { SHARED: 's' }, overrides)).toEqual({
        A: 'override',
        B: '2',
        C: '3',
        D: '4',
        SHARED: 's'
      })
    })
  })

  describe('status and base environment', () => {
    it('returns local status with zero snapshots by default', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'status-project',
        default_environment: 'stg',
        outputs: {
          web: 'apps/web'
        }
      }

      const status: LocalStatusResult = getLocalStatus(configDir, config)
      const expectedSharedPath = getSharedDir(configDir)

      expect(status).toEqual({
        sharedPath: expectedSharedPath,
        sharedExist: false,
        sharedCount: 0,
        sharedConfigCount: 0,
        sharedSecretsCount: 0,
        overridesPath: getServiceDir(configDir),
        overridesExist: false,
        overridesCount: 0,
        overridesConfigCount: 0,
        overridesSecretsCount: 0,
        baseEnvironment: 'stg',
        snapshotsCount: 0
      })
    })

    it('reads monorepo local status with service scope', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'status-project',
        services: ['api'],
        outputs: {
          web: 'apps/web'
        }
      }
      setLocalShared(configDir, 'APP', '1')
      setOverride(configDir, 'API', '1', 'api', true)

      const status = getLocalStatus(configDir, config, 'api')

      expect(status.baseEnvironment).toBe('dev')
      expect(status.sharedExist).toBe(true)
      expect(status.overridesExist).toBe(true)
      expect(status.overridesPath).toBe(getServiceDir(configDir, 'api'))
      expect(status.overridesCount).toBe(1)
      expect(isMonorepoFromConfig(config)).toBe(true)
    })

    it('returns default base environment', () => {
      const config: VaulterConfig = {
        version: '1',
        project: 'env'
      }
      expect(resolveBaseEnvironment(config)).toBe('dev')
      expect(resolveBaseEnvironment({ ...config, default_environment: 'prd' })).toBe('prd')
    })
  })
})
