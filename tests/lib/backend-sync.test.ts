/**
 * Tests for backend-sync.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pushToBackend, pullFromBackend } from '../../src/lib/backend-sync.js'
import { loadShared, loadService, initEnv, getConfigsPath, getSecretsPath } from '../../src/lib/fs-store.js'

class TestClient {
  public setCalls: string[] = []
  public listCalls: string[] = []
  public sharedVars: Array<{ key: string; value: string; sensitive: boolean }> = []
  public allVars: Array<{ key: string; value: string; sensitive: boolean; service?: string }> = []
  public serviceVarsMap: Record<string, Array<{ key: string; value: string; sensitive: boolean }>> = {}

  set = async (entry: any): Promise<void> => {
    this.setCalls.push(`${entry.service || '__shared__'}:${entry.key}`)
  }

  setMany = async (entries: any[]): Promise<void> => {
    for (const entry of entries) {
      this.setCalls.push(`${entry.service || '__shared__'}:${entry.key}`)
    }
  }

  async list(filter: { project: string; environment: string; service?: string }): Promise<Array<any>> {
    this.listCalls.push(`${filter.service || '__shared__'}`)

    if (filter.service === '__shared__') {
      return this.sharedVars
    }
    if (filter.service && filter.service !== '__shared__') {
      return this.serviceVarsMap[filter.service] || []
    }
    return this.allVars
  }
}

describe('backend-sync', () => {
  let root = ''

  beforeEach(() => {
    root = join(tmpdir(), `vaulter-sync-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('should push local files to backend', async () => {
    const client = new TestClient()
    initEnv(root, 'dev', ['svc-api'])

    await pushToBackend({
      client: client as unknown as never,
      vaulterDir: root,
      project: 'p',
      environment: 'dev',
      dryRun: false
    })

    // shared vars from defaults: only files with header comments from initEnv exist and not parsed
    expect(client.setCalls).toEqual([])

    await import('node:fs')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(getConfigsPath(root, 'dev'), 'SHARED=one')
    writeFileSync(getSecretsPath(root, 'dev'), 'S1=secret')

    const svcConf = join(root, 'dev', 'services', 'svc-api', 'configs.env')
    const svcSec = join(root, 'dev', 'services', 'svc-api', 'secrets.env')
    writeFileSync(svcConf, 'SVC=api')
    writeFileSync(svcSec, 'SVC_SEC=s')

    const client2 = new TestClient()
    await pushToBackend({
      client: client2 as unknown as never,
      vaulterDir: root,
      project: 'p',
      environment: 'dev',
      dryRun: false
    })

    expect(client2.setCalls).toContain('__shared__:SHARED')
    expect(client2.setCalls).toContain('__shared__:S1')
    expect(client2.setCalls).toContain('svc-api:SVC')
    expect(client2.setCalls).toContain('svc-api:SVC_SEC')
  })

  it('should perform dry-run without calling backend', async () => {
    initEnv(root, 'prd', ['svc-web'])
    writeFileSync(getConfigsPath(root, 'prd'), 'A=1')

    const client = new TestClient()
    const result = await pushToBackend({
      client: client as unknown as never,
      vaulterDir: root,
      project: 'p',
      environment: 'prd',
      dryRun: true
    })

    expect(result.pushed).toBe(1)
    expect(result.services).toEqual(['svc-web'])
    expect(client.setCalls).toEqual([])
  })

  it('should pull backend vars into local files', async () => {
    const client = new TestClient()

    const shared = [
      { key: 'A', value: '1', sensitive: false },
      { key: 'B', value: 'secret', sensitive: true }
    ]

    const serviceVars = [
      { key: 'C', value: 'svc', sensitive: false },
      { key: 'D', value: 'svc-secret', sensitive: true }
    ]

    client.sharedVars = shared
    client.allVars = [
      ...shared,
      ...serviceVars.map(item => ({ ...item, service: 'svc-api' }))
    ]
    client.serviceVarsMap['svc-api'] = serviceVars

    const result = await pullFromBackend({
      client: client as unknown as never,
      vaulterDir: root,
      project: 'p',
      environment: 'dev',
      dryRun: false
    })

    expect(result.pulled).toBe(4)
    expect(result.services).toContain('svc-api')
    expect(loadShared(root, 'dev')).toEqual({
      configs: { A: '1' },
      secrets: { B: 'secret' }
    })
    expect(loadService(root, 'dev', 'svc-api')).toEqual({
      configs: { C: 'svc' },
      secrets: { D: 'svc-secret' }
    })
  })

  it('should support pull dry-run without writing', async () => {
    const client = new TestClient()
    client.sharedVars = [{ key: 'A', value: '1', sensitive: false }]

    const result = await pullFromBackend({
      client,
      vaulterDir: root,
      project: 'p',
      environment: 'dev',
      dryRun: true
    })

    expect(result.pulled).toBe(1)
    expect(result.services).toEqual([])
    expect(client.setCalls.length).toBe(0)
  })
})
