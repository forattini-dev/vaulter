/**
 * Vaulter MCP Server
 *
 * Model Context Protocol server for Claude integration
 * Exposes vaulter tools, resources, and prompts via stdio transport
 *
 * Tools:     21 tools for managing secrets and configs
 * Resources: 6 resource types (config, services, keys, env, compare)
 * Prompts:   5 workflow prompts (setup, migrate, deploy, compare, audit)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js'
import { registerTools, handleToolCall } from './tools.js'
import { handleResourceRead, listResources } from './resources.js'
import { registerPrompts, getPrompt } from './prompts.js'
import { createRequire } from 'node:module'

const SERVER_NAME = 'vaulter'
const SERVER_VERSION = process.env.VAULTER_VERSION || getPackageVersion() || '0.0.0'

function getPackageVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('../../package.json') as { version?: string }
    return pkg.version
  } catch {
    return undefined
  }
}

/**
 * Create and configure the MCP server
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    }
  )

  // ─────────────────────────────────────────────────────────────
  // Tools: Actions that can be executed
  // ─────────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registerTools()
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      return await handleToolCall(name, args || {})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new McpError(ErrorCode.InternalError, message)
    }
  })

  // ─────────────────────────────────────────────────────────────
  // Resources: Read-only data views
  // ─────────────────────────────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: await listResources()
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params
    try {
      return await handleResourceRead(uri)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new McpError(ErrorCode.InternalError, message)
    }
  })

  // ─────────────────────────────────────────────────────────────
  // Prompts: Pre-configured workflow templates
  // ─────────────────────────────────────────────────────────────
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: registerPrompts()
  }))

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      return getPrompt(name, args || {})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new McpError(ErrorCode.InternalError, message)
    }
  })

  return server
}

/**
 * Start the MCP server with stdio transport
 */
export async function startServer(): Promise<void> {
  const server = createServer()
  const transport = new StdioServerTransport()

  await server.connect(transport)

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.close()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await server.close()
    process.exit(0)
  })
}

// Start server if run directly
if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  startServer().catch((error) => {
    console.error('Failed to start MCP server:', error)
    process.exit(1)
  })
}
