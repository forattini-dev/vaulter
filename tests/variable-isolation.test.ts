/**
 * Variable Isolation Tests
 * Verifies variables are correctly isolated by sensitive/environment/service.
 * Runs quickly by combining checks into fewer tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { VaulterClient } from '../src/client.js'

describe('Variable Isolation', () => {
  let client: VaulterClient
  const project = 'iso'
  const SHARED = '__shared__'

  beforeAll(async () => {
    client = new VaulterClient({
      connectionString: 'memory://isolation',
      passphrase: 'k'
    })
    await client.connect()
  })

  afterAll(async () => {
    await client.disconnect()
  })

  it('isolates sensitive, environment, service, and shared correctly', async () => {
    // Set up test data in one batch
    await client.setMany([
      // Sensitive flag
      { key: 'A', value: 'sec', project, environment: 'a', sensitive: true },
      { key: 'B', value: 'cfg', project, environment: 'a', sensitive: false },
      // Environment isolation
      { key: 'C', value: 'dev', project, environment: 'dev' },
      { key: 'C', value: 'prd', project, environment: 'prd' },
      // Service isolation
      { key: 'D', value: 'api', project, environment: 'b', service: 'api' },
      { key: 'D', value: 'wrk', project, environment: 'b', service: 'worker' },
      // Shared inheritance
      { key: 'E', value: 'shared', project, environment: 'c', service: SHARED },
      { key: 'F', value: 'shared', project, environment: 'c', service: SHARED },
      { key: 'F', value: 'override', project, environment: 'c', service: 'api' }
    ])

    // Verify sensitive flag
    const a = await client.get('A', project, 'a')
    const b = await client.get('B', project, 'a')
    expect(a!.sensitive).toBe(true)
    expect(b!.sensitive).toBe(false)

    // Verify environment isolation
    const cDev = await client.get('C', project, 'dev')
    const cPrd = await client.get('C', project, 'prd')
    const cStg = await client.get('C', project, 'stg')
    expect(cDev!.value).toBe('dev')
    expect(cPrd!.value).toBe('prd')
    expect(cStg).toBeNull()

    // Verify service isolation
    const dApi = await client.get('D', project, 'b', 'api')
    const dWrk = await client.get('D', project, 'b', 'worker')
    expect(dApi!.value).toBe('api')
    expect(dWrk!.value).toBe('wrk')

    // Verify shared inheritance
    const exp = await client.export(project, 'c', 'api')
    expect(exp.E).toBe('shared')    // Inherited
    expect(exp.F).toBe('override')  // Overridden
  })

  it('preserves sensitive flag on update', async () => {
    await client.set({ key: 'UPD', value: 'v1', project, environment: 'u', sensitive: true })
    await client.set({ key: 'UPD', value: 'v2', project, environment: 'u' }) // No sensitive
    const r = await client.get('UPD', project, 'u')
    expect(r!.value).toBe('v2')
    expect(r!.sensitive).toBe(true)
  })

  it('deletes only from target scope', async () => {
    await client.set({ key: 'DEL', value: 'api', project, environment: 'd', service: 'api' })
    await client.set({ key: 'DEL', value: 'shd', project, environment: 'd', service: SHARED })
    await client.delete('DEL', project, 'd', 'api')

    expect(await client.get('DEL', project, 'd', 'api')).toBeNull()
    expect((await client.get('DEL', project, 'd', SHARED))!.value).toBe('shd')
  })
})
