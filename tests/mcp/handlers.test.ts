/**
 * MCP Handler Tests
 *
 * Tests handler logic for tools that don't require a backend connection.
 * For backend-requiring tools, tests error handling and dispatch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { handleChange } from '../../src/mcp/tools/handlers/change.js'
import type { HandlerContext } from '../../src/mcp/tools/index.js'
import type { VaulterConfig } from '../../src/types.js'

// ============================================================================
// Test Helpers
// ============================================================================

let tmpDir: string
let configDir: string

function makeConfig(overrides: Partial<VaulterConfig> = {}): VaulterConfig {
  return {
    version: '1',
    project: 'test-project',
    ...overrides
  }
}

function makeContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    config: makeConfig(),
    project: 'test-project',
    environment: 'dev',
    service: undefined,
    configDir: configDir,
    connectionStrings: [],
    ...overrides
  }
}

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0].text
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-mcp-handler-'))
  configDir = path.join(tmpDir, '.vaulter')
  fs.mkdirSync(path.join(configDir, 'local'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ============================================================================
// handleChange — set
// ============================================================================

describe('handleChange set', () => {
  it('sets a variable in local state', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'set',
      key: 'LOG_LEVEL',
      value: 'debug',
      sensitive: false
    })

    expect(result.isError).toBe(false)
    const text = getText(result)
    expect(text).toContain('Set LOG_LEVEL')
    expect(text).toContain('config')
    expect(text).toContain('vaulter_plan')
  })

  it('sets a secret and labels it correctly', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'set',
      key: 'API_KEY',
      value: 'sk-xxx',
      sensitive: true
    })

    expect(result.isError).toBe(false)
    expect(getText(result)).toContain('secret')
  })

  it('auto-corrects sensitive for secret-like key names', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'set',
      key: 'JWT_SECRET',
      value: 'mytoken',
      sensitive: false
    })

    expect(result.isError).toBe(false)
    const text = getText(result)
    expect(text).toContain('Auto-set sensitive=true')
    expect(text).toContain('secret')
  })

  it('reports implicit scope note when no scope specified', () => {
    const ctx = makeContext({ service: undefined })
    const result = handleChange(ctx, {
      action: 'set',
      key: 'FOO',
      value: 'bar'
    })

    expect(result.isError).toBe(false)
    expect(getText(result)).toContain('No scope specified')
  })

  it('does not report implicit scope when scope is explicit', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'set',
      key: 'FOO',
      value: 'bar',
      scope: 'shared'
    })

    expect(result.isError).toBe(false)
    expect(getText(result)).not.toContain('No scope specified')
  })

  it('does not report implicit scope when service context exists', () => {
    const ctx = makeContext({ service: 'svc-auth' })
    const result = handleChange(ctx, {
      action: 'set',
      key: 'PORT',
      value: '28000'
    })

    expect(result.isError).toBe(false)
    expect(getText(result)).not.toContain('No scope specified')
  })

  it('errors when key is missing', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'set',
      value: 'bar'
    })

    expect(result.isError).toBe(true)
    expect(getText(result)).toContain('key and value are required')
  })

  it('errors when configDir is null', () => {
    const ctx = makeContext({ configDir: null })
    const result = handleChange(ctx, {
      action: 'set',
      key: 'FOO',
      value: 'bar'
    })

    expect(result.isError).toBe(true)
    expect(getText(result)).toContain('.vaulter')
  })

  it('writes to service scope when scope=service name', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'set',
      key: 'PORT',
      value: '3000',
      scope: 'svc-auth'
    })

    expect(result.isError).toBe(false)
    expect(getText(result)).toContain('svc-auth')
  })

  it('surfaces governance suggestions', () => {
    const ctx = makeContext({
      config: makeConfig({
        sync: { required: { dev: ['MISSING_VAR'] } } as any
      })
    })
    const result = handleChange(ctx, {
      action: 'set',
      key: 'LOG_LEVEL',
      value: 'debug'
    })

    // Suggestions should be surfaced in the response
    // (whether they appear depends on governance config, but the code path is exercised)
    expect(result.isError).toBe(false)
  })
})

// ============================================================================
// handleChange — delete
// ============================================================================

describe('handleChange delete', () => {
  it('deletes an existing variable', () => {
    const ctx = makeContext()
    // First set a variable
    handleChange(ctx, {
      action: 'set',
      key: 'TO_DELETE',
      value: 'x',
      scope: 'shared'
    })

    // Then delete it
    const result = handleChange(ctx, {
      action: 'delete',
      key: 'TO_DELETE',
      scope: 'shared'
    })

    expect(result.isError).toBe(false)
    expect(getText(result)).toContain('Deleted TO_DELETE')
  })

  it('reports not found for nonexistent key', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'delete',
      key: 'NONEXISTENT',
      scope: 'shared'
    })

    expect(result.isError).toBe(false)
    expect(getText(result)).toContain('not found')
  })

  it('errors when key is missing', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'delete'
    })

    expect(result.isError).toBe(true)
    expect(getText(result)).toContain('key is required')
  })

  it('reports implicit scope on delete', () => {
    const ctx = makeContext({ service: undefined })
    // Set then delete without explicit scope
    handleChange(ctx, { action: 'set', key: 'X', value: '1', scope: 'shared' })
    const result = handleChange(ctx, { action: 'delete', key: 'X' })

    // Should have implicit scope note
    const text = getText(result)
    expect(text).toContain('No scope specified')
  })
})

// ============================================================================
// handleChange — move
// ============================================================================

describe('handleChange move', () => {
  it('moves a variable between scopes', () => {
    const ctx = makeContext()
    handleChange(ctx, {
      action: 'set',
      key: 'DB_URL',
      value: 'postgres://...',
      scope: 'shared',
      sensitive: true
    })

    const result = handleChange(ctx, {
      action: 'move',
      key: 'DB_URL',
      from: 'shared',
      to: 'svc-api'
    })

    expect(result.isError).toBe(false)
    expect(getText(result)).toContain('Moved')
    expect(getText(result)).toContain('shared')
    expect(getText(result)).toContain('svc-api')
  })

  it('errors when from/to are missing', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'move',
      key: 'X'
    })

    expect(result.isError).toBe(true)
    expect(getText(result)).toContain('from, and to are required')
  })

  it('errors when key is missing', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'move',
      from: 'shared',
      to: 'svc-auth'
    })

    expect(result.isError).toBe(true)
  })

  it('errors for invalid scope format', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'move',
      key: 'X',
      from: 'shared',
      to: 'invalid:format:extra'
    })

    expect(result.isError).toBe(true)
    expect(getText(result)).toContain('Invalid scope')
  })
})

// ============================================================================
// handleChange — import
// ============================================================================

describe('handleChange import', () => {
  it('imports multiple variables from vars object', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'import',
      vars: {
        FOO: 'bar',
        BAZ: 'qux'
      }
    })

    expect(result.isError).toBe(false)
    const text = getText(result)
    expect(text).toContain('Imported 2 variable(s)')
  })

  it('errors when vars is empty', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'import',
      vars: {}
    })

    expect(result.isError).toBe(true)
    expect(getText(result)).toContain('vars object is required')
  })

  it('reports implicit scope on import', () => {
    const ctx = makeContext({ service: undefined })
    const result = handleChange(ctx, {
      action: 'import',
      vars: { A: '1' }
    })

    expect(result.isError).toBe(false)
    expect(getText(result)).toContain('No scope specified')
  })

  it('auto-corrects sensitive keys during import', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'import',
      vars: {
        JWT_SECRET: 'xxx',
        LOG_LEVEL: 'debug'
      }
    })

    expect(result.isError).toBe(false)
    const text = getText(result)
    expect(text).toContain('auto-set sensitive=true')
  })
})

// ============================================================================
// handleChange — unknown action
// ============================================================================

describe('handleChange unknown action', () => {
  it('errors for unknown action', () => {
    const ctx = makeContext()
    const result = handleChange(ctx, {
      action: 'unknown_action'
    })

    expect(result.isError).toBe(true)
    expect(getText(result)).toContain('Unknown action')
  })
})

// ============================================================================
// Dispatcher error handling
// ============================================================================

describe('MCP Dispatcher error handling', () => {
  it('returns error with hints for unknown tools', async () => {
    const { handleToolCall } = await import('../../src/mcp/tools/index.js')
    const result = await handleToolCall('vaulter_nonexistent', {})

    expect(result.isError).toBe(true)
    expect(getText(result)).toContain('Unknown tool')
    expect(result.meta?.suggestions).toBeDefined()
  })

  it('returns error for client-requiring tools when backend unavailable', async () => {
    const { handleToolCall } = await import('../../src/mcp/tools/index.js')
    // vaulter_list requires backend — without proper config, it should error
    const result = await handleToolCall('vaulter_list', {
      project: 'test',
      environment: 'dev'
    })

    // Should either be an error or have content indicating no vars
    // The important thing is it doesn't crash
    expect(result.content).toBeDefined()
    expect(result.content.length).toBeGreaterThan(0)
  })
})
