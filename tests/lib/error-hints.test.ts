/**
 * Tests for shared error-hints module.
 *
 * Covers both CLI (buildErrorHints) and MCP (buildMcpErrorHints) variants.
 */

import { describe, it, expect } from 'vitest'
import { buildErrorHints, buildMcpErrorHints } from '../../src/lib/error-hints.js'

// ============================================================================
// buildErrorHints (CLI)
// ============================================================================

describe('buildErrorHints (CLI)', () => {
  it('returns timeout hints for timeout errors', () => {
    const hints = buildErrorHints(new Error('operation timed out'), {
      command: ['plan'],
      environment: 'dev',
      timeoutMs: 30000
    })
    expect(hints.length).toBeGreaterThan(0)
    expect(hints.some(h => h.includes('60000'))).toBe(true)
  })

  it('returns permission hints for 403 errors', () => {
    const hints = buildErrorHints(new Error('403 Forbidden'), {
      command: ['plan'],
      environment: 'prd'
    })
    expect(hints.length).toBeGreaterThan(0)
    expect(hints.some(h => h.includes('Permission'))).toBe(true)
  })

  it('returns connectivity hints for ECONNREFUSED', () => {
    const hints = buildErrorHints(new Error('ECONNREFUSED'), {
      command: ['plan'],
      environment: 'dev'
    })
    expect(hints.length).toBeGreaterThan(0)
    expect(hints.some(h => h.includes('Connectivity') || h.includes('timeout'))).toBe(true)
  })

  it('returns empty array for empty error message', () => {
    const hints = buildErrorHints(new Error(''), {
      command: ['set'],
      environment: 'dev'
    })
    expect(hints).toEqual([])
  })

  it('returns generic hints for unknown errors', () => {
    const hints = buildErrorHints(new Error('something weird happened'), {
      command: ['set'],
      environment: 'dev'
    })
    expect(hints.length).toBeGreaterThan(0)
    expect(hints.some(h => h.includes('verbose'))).toBe(true)
  })

  it('suggests diff for sync commands on unknown errors', () => {
    const hints = buildErrorHints(new Error('unexpected failure'), {
      command: ['sync'],
      environment: 'dev'
    })
    expect(hints.some(h => h.includes('diff'))).toBe(true)
  })

  it('doubles timeout suggestion but caps at 300000', () => {
    const hints = buildErrorHints(new Error('timeout'), {
      command: ['plan'],
      timeoutMs: 200000
    })
    expect(hints.some(h => h.includes('300000'))).toBe(true)
  })

  it('handles string errors', () => {
    const hints = buildErrorHints('connection timeout', {
      command: ['plan'],
      environment: 'dev'
    })
    expect(hints.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// buildMcpErrorHints (MCP)
// ============================================================================

describe('buildMcpErrorHints (MCP)', () => {
  it('returns timeout hints with tool name', () => {
    const hints = buildMcpErrorHints(new Error('operation timed out'), {
      tool: 'vaulter_plan',
      environment: 'dev',
      timeoutMs: 30000
    })
    expect(hints.length).toBeGreaterThan(0)
    expect(hints.some(h => h.includes('vaulter_plan'))).toBe(true)
    expect(hints.some(h => h.includes('60000'))).toBe(true)
  })

  it('suggests scorecard for timeout on plan/apply/diff tools', () => {
    const hints = buildMcpErrorHints(new Error('timeout'), {
      tool: 'vaulter_plan',
      environment: 'prd'
    })
    expect(hints.some(h => h.includes('scorecard'))).toBe(true)
  })

  it('returns permission hints', () => {
    const hints = buildMcpErrorHints(new Error('access denied'), {
      tool: 'vaulter_list',
      environment: 'prd'
    })
    expect(hints.some(h => h.includes('Permission'))).toBe(true)
    expect(hints.some(h => h.includes('scorecard'))).toBe(true)
  })

  it('returns connectivity hints', () => {
    const hints = buildMcpErrorHints(new Error('ENOTFOUND'), {
      tool: 'vaulter_get',
      environment: 'dev'
    })
    expect(hints.some(h => h.includes('Connectivity'))).toBe(true)
  })

  it('returns generic diagnostic hint for unknown errors', () => {
    const hints = buildMcpErrorHints(new Error('unknown failure'), {
      tool: 'vaulter_list',
      environment: 'dev'
    })
    expect(hints.length).toBeGreaterThan(0)
    expect(hints.some(h => h.includes('scorecard'))).toBe(true)
  })

  it('returns empty for empty error message', () => {
    const hints = buildMcpErrorHints(new Error(''), {
      tool: 'vaulter_get',
      environment: 'dev'
    })
    expect(hints).toEqual([])
  })

  it('uses default env dev when environment not specified', () => {
    const hints = buildMcpErrorHints(new Error('forbidden'), {
      tool: 'vaulter_list'
    })
    expect(hints.some(h => h.includes('dev'))).toBe(true)
  })
})
