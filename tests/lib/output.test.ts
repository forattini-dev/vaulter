/**
 * Tests for output.ts
 */

import { describe, it, expect } from 'vitest'
import { rmSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  normalizeOutputTargets,
  generateOutputs,
  generateOutput,
  type GenerateOutputsOptions
} from '../../src/lib/output.js'
import { loadFlat } from '../../src/lib/fs-store.js'
import { vi } from 'vitest'
import type { VaulterConfig } from '../../src/types.js'

vi.mock('../../src/lib/fs-store.js', async () => {
  const actual = await vi.importActual('../../src/lib/fs-store.js')
  return {
    ...actual,
    loadFlat: vi.fn()
  }
})

describe('lib/output', () => {
  const root = path.join(tmpdir(), `vaulter-output-${Date.now()}-${Math.random().toString(16).slice(2)}`)

  beforeAll(() => {
    mkdirSync(root, { recursive: true })
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('should normalize output targets', () => {
    const config: VaulterConfig = {
      version: '1',
      project: 'test',
      outputs: {
        web: 'apps/web',
        api: {
          path: 'apps/api',
          filename: '.env.local',
          service: 'svc-api'
        }
      }
    }

    const targets = normalizeOutputTargets(config)
    expect(targets).toEqual([
      {
        name: 'web',
        path: 'apps/web',
        filename: '.env',
        service: undefined
      },
      {
        name: 'api',
        path: 'apps/api',
        filename: '.env.local',
        service: 'svc-api'
      }
    ])
  })

  it('should generate outputs for all targets', () => {
    vi.mocked(loadFlat).mockReturnValue({ A: '1', B: '2' })

    const config: VaulterConfig = {
      version: '1',
      project: 'test',
      outputs: {
        web: 'apps/web',
        api: { path: 'apps/api', filename: '.env.{env}', service: 'svc-api' }
      }
    }

    const options: GenerateOutputsOptions = {
      vaulterDir: '/tmp/noop',
      projectRoot: root,
      config,
      env: 'prd',
      targets: undefined,
      dryRun: false
    }

    const result = generateOutputs(options)

    expect(result.errors).toHaveLength(0)
    expect(result.outputs).toHaveLength(2)
    expect(result.outputs[0]).toMatchObject({
      target: 'web',
      varsCount: 2,
      vars: { A: '1', B: '2' }
    })
    expect(result.outputs[1].path).toBe(path.join(root, 'apps/api', '.env.prd'))
  })

  it('should prioritize legacy file property in output config', () => {
    vi.mocked(loadFlat).mockReturnValue({ A: '1' })

    const result = generateOutputs({
      vaulterDir: '/tmp/noop',
      projectRoot: root,
      config: {
        version: '1',
        project: 'test',
        outputs: {
          legacy: {
            path: 'apps/legacy',
            file: '.env.legacy',
            service: 'svc-legacy'
          }
        }
      },
      env: 'dev'
    })

    expect(result.errors).toHaveLength(0)
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0].path).toBe(path.join(root, 'apps/legacy', '.env.legacy'))
  })

  it('should return errors when no targets are found', () => {
    const config: VaulterConfig = {
      version: '1',
      project: 'test'
    }

    const result = generateOutputs({
      vaulterDir: '/tmp/noop',
      projectRoot: root,
      config,
      env: 'dev'
    })

    expect(result.outputs).toHaveLength(0)
    expect(result.errors[0]).toBe('No output targets found')
  })

  it('should return error when load returns no variables for a target', () => {
    vi.mocked(loadFlat).mockReturnValue({})
    const result = generateOutputs({
      vaulterDir: '/tmp/noop',
      projectRoot: root,
      config: {
        version: '1',
        project: 'test',
        outputs: {
          api: {
            path: 'apps/api',
            filename: '.env'
          }
        }
      },
      env: 'dev'
    })

    expect(result.outputs).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe('No variables found for api (env: dev)')
  })

  it('should generate one output with dry-run false using loadFlat', () => {
    vi.mocked(loadFlat).mockReturnValue({ C: 'value', Z: 'two' })

    const output = generateOutput(
      '/tmp/noop',
      root,
      {
        name: 'api',
        path: 'apps/api',
        filename: '.env',
        service: 'svc-api'
      },
      'dev',
      false
    )

    expect(output).toMatchObject({
      target: 'api',
      varsCount: 2,
      path: path.join(root, 'apps/api', '.env')
    })
  })

  it('should generate one output with dry-run true without writing', () => {
    vi.mocked(loadFlat).mockReturnValue({ A: 'x' })

    const output = generateOutput(
      '/tmp/noop',
      root,
      {
        name: 'api',
        path: 'apps/api',
        filename: '.env',
        service: 'svc-api'
      },
      'dev',
      true
    )

    expect(output.varsCount).toBe(1)
    expect(output.path).toBe(path.join(root, 'apps/api', '.env'))
  })

  it('should escape and quote values when special characters are found', () => {
    vi.mocked(loadFlat).mockReturnValue({
      SIMPLE: 'plain',
      WHITESPACE: 'value with space',
      HASHED: 'value#hash',
      QUOTED: 'va"l"ue',
      MULTILINE: 'line1\nline2'
    })

    generateOutput(
      '/tmp/noop',
      root,
      {
        name: 'api',
        path: 'apps/api',
        filename: '.env',
        service: 'svc-api'
      },
      'dev',
      false
    )

    const content = readFileSync(path.join(root, 'apps/api', '.env'), 'utf8')
    expect(content).toContain('SIMPLE=plain')
    expect(content).toContain('WHITESPACE="value with space"')
    expect(content).toContain('HASHED="value#hash"')
    expect(content).toContain('QUOTED="va\\"l\\"ue"')
    expect(content).toContain('MULTILINE="line1\\nline2"')
  })

  it('should return error when output generation fails', () => {
    vi.mocked(loadFlat).mockImplementationOnce(() => {
      throw new Error('flat-load-failed')
    })

    const result = generateOutputs({
      vaulterDir: '/tmp/noop',
      projectRoot: root,
      config: {
        version: '1',
        project: 'test',
        outputs: {
          api: {
            path: 'apps/api',
            filename: '.env'
          }
        }
      },
      env: 'dev'
    })

    expect(result.outputs).toHaveLength(0)
    expect(result.errors[0]).toContain('Error generating api: flat-load-failed')
  })
})
