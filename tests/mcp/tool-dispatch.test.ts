/**
 * MCP Tool registration and dispatch tests
 */

import { describe, it, expect } from 'vitest'
import { registerTools } from '../../src/mcp/tools/definitions.js'
import { handleToolCall } from '../../src/mcp/tools/index.js'

const EXPECTED_TOOLS = [
  'vaulter_change',
  'vaulter_plan',
  'vaulter_apply',
  'vaulter_run',
  'vaulter_get',
  'vaulter_list',
  'vaulter_status',
  'vaulter_search',
  'vaulter_diff',
  'vaulter_export',
  'vaulter_key',
  'vaulter_snapshot',
  'vaulter_versions',
  'vaulter_local',
  'vaulter_init',
  'vaulter_services',
  'vaulter_nuke'
] as const

/** Tools that require `action` in their schema */
const ACTION_REQUIRED_TOOLS: Record<string, string[]> = {
  vaulter_change: ['set', 'delete', 'move', 'import'],
  vaulter_key: ['generate', 'list', 'show', 'export', 'import', 'rotate'],
  vaulter_snapshot: ['create', 'list', 'restore', 'delete'],
  vaulter_versions: ['list', 'get', 'rollback'],
  vaulter_local: ['pull', 'push', 'push-all', 'sync', 'set', 'delete', 'diff', 'status', 'shared-set', 'shared-delete', 'shared-list']
}

/** Tools that have an action enum but it's optional (has a default) */
const ACTION_OPTIONAL_TOOLS: Record<string, string[]> = {
  vaulter_status: ['scorecard', 'vars', 'audit', 'drift', 'inventory']
}

describe('MCP Tool Registration', () => {
  const tools = registerTools()

  it('should register exactly 17 tools', () => {
    expect(tools).toHaveLength(17)
  })

  it('should have all expected tool names', () => {
    const names = tools.map(t => t.name)
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected)
    }
  })

  it('should not have unexpected tools', () => {
    const names = tools.map(t => t.name)
    for (const name of names) {
      expect(EXPECTED_TOOLS).toContain(name)
    }
  })

  it('should have non-empty description for each tool', () => {
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  it('should have inputSchema.type === "object" for each tool', () => {
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('should require "action" for action-required tools', () => {
    for (const [toolName, _actions] of Object.entries(ACTION_REQUIRED_TOOLS)) {
      const tool = tools.find(t => t.name === toolName)
      expect(tool, `${toolName} should exist`).toBeDefined()
      expect(tool!.inputSchema.required, `${toolName} should have required fields`).toContain('action')
    }
  })

  it('should have action enum but not require it for optional-action tools', () => {
    for (const [toolName, expectedActions] of Object.entries(ACTION_OPTIONAL_TOOLS)) {
      const tool = tools.find(t => t.name === toolName)!
      const actionProp = tool.inputSchema.properties.action as { enum?: string[] }
      expect(actionProp.enum, `${toolName} should have action enum`).toBeDefined()
      expect(actionProp.enum!.sort()).toEqual([...expectedActions].sort())
      // action is optional (has default), so should NOT be in required
      expect(tool.inputSchema.required || []).not.toContain('action')
    }
  })

  it('should have correct action enum values for action-required tools', () => {
    for (const [toolName, expectedActions] of Object.entries(ACTION_REQUIRED_TOOLS)) {
      const tool = tools.find(t => t.name === toolName)!
      const actionProp = tool.inputSchema.properties.action as { enum?: string[] }
      expect(actionProp.enum, `${toolName} should have action enum`).toBeDefined()
      expect(actionProp.enum!.sort()).toEqual([...expectedActions].sort())
    }
  })
})

describe('MCP Tool Dispatch', () => {
  it('should return "Unknown tool" for unregistered tools', async () => {
    const result = await handleToolCall('vaulter_nonexistent', {})
    const text = result.content[0]
    expect(text.type).toBe('text')
    expect((text as { type: 'text'; text: string }).text).toContain('Unknown tool')
  })

  it('should return "Unknown tool" for v2 tool names', async () => {
    const v2Tools = ['vaulter_doctor', 'vaulter_multi_set', 'vaulter_clone_env', 'vaulter_k8s_secret']
    for (const name of v2Tools) {
      const result = await handleToolCall(name, {})
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text, `${name} should be unknown`).toContain('Unknown tool')
    }
  })
})
