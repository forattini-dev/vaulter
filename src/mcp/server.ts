/**
 * Vaulter MCP Server
 *
 * Model Context Protocol server for Claude integration
 * Exposes vaulter tools, resources, and prompts via stdio transport
 *
 * Tools:     58 tools for managing secrets and configs
 * Resources: 7 resource types (instructions, workflow, tools-guide, monorepo-example, mcp-config, config, services)
 * Prompts:   12 workflow prompts (setup, migrate, deploy, compare, audit, rotation, shared, batch, copy, sync, monorepo_deploy, local_overrides)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CRITICAL: HOW VAULTER STORES DATA
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Vaulter uses s3db.js internally, which stores data in S3 OBJECT METADATA,
 * NOT in the object body. This means:
 *
 * ❌ NEVER upload .env files directly using AWS CLI (aws s3 cp)
 * ❌ NEVER create JSON files manually in S3
 * ❌ NEVER modify S3 objects outside of vaulter
 *
 * ✅ ALWAYS use vaulter CLI commands:
 *    - npx vaulter sync push -e <env>   → Push local .env to backend
 *    - npx vaulter sync pull -e <env>   → Pull from backend to local
 *    - npx vaulter var set KEY=value    → Set individual variable
 *    - npx vaulter sync merge -e <env>  → Bidirectional sync
 *
 * If you see empty {} metadata in S3 objects, the data was uploaded wrong!
 * The correct structure stores encrypted values in x-amz-meta-* headers.
 * ═══════════════════════════════════════════════════════════════════════
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
import {
  registerTools,
  handleToolCall,
  setMcpOptions,
  resolveMcpConfigWithSources,
  formatResolvedConfig,
  getConfigAndDefaults,
  getMcpRuntimeOptions,
  getClientForEnvironment,
  getClientForSharedVars,
  type McpServerOptions
} from './tools.js'
import { handleResourceRead, listResources } from './resources.js'
import { registerPrompts, getPrompt } from './prompts.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_NAME = 'vaulter'
const SERVER_VERSION = process.env.VAULTER_VERSION || getPackageVersion() || '0.0.0'

function getPackageVersion(): string | undefined {
  try {
    // Handle both ESM (import.meta.url) and CJS (__dirname) contexts
    let baseDir: string
    if (typeof __dirname !== 'undefined') {
      // CJS context
      baseDir = __dirname
    } else if (typeof import.meta?.url === 'string') {
      // ESM context
      baseDir = path.dirname(fileURLToPath(import.meta.url))
    } else {
      return undefined
    }

    // Try to find package.json by walking up the directory tree
    let dir = baseDir
    for (let i = 0; i < 5; i++) {
      const pkgPath = path.join(dir, 'package.json')
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string }
        return pkg.version
      }
      dir = path.dirname(dir)
    }
    return undefined
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

async function warmupClients(options: McpServerOptions): Promise<void> {
  const { config, defaults, connectionStrings } = getConfigAndDefaults()
  const project = defaults.project || config?.project

  if (!project) {
    if (options.verbose) {
      console.error('[vaulter] MCP warmup skipped (project not set)')
    }
    return
  }

  const connectIfNeeded = async (label: string, client: { isConnected: () => boolean; connect: () => Promise<void> }) => {
    if (!client.isConnected()) {
      await client.connect()
    }
    if (options.verbose) {
      console.error(`[vaulter] MCP warmup connected: ${label}`)
    }
  }

  try {
    const client = await getClientForEnvironment(defaults.environment as any, { config, connectionStrings, project })
    await connectIfNeeded(`${project}/${defaults.environment}`, client)
  } catch (error) {
    if (options.verbose) {
      console.error(`[vaulter] MCP warmup failed (default env): ${(error as Error).message}`)
    }
  }

  try {
    const { client: sharedClient, sharedKeyEnv } = await getClientForSharedVars({ config, connectionStrings, project })
    if (sharedKeyEnv !== defaults.environment) {
      await connectIfNeeded(`${project}/${sharedKeyEnv} (shared)`, sharedClient)
    }
  } catch (error) {
    if (options.verbose) {
      console.error(`[vaulter] MCP warmup failed (shared env): ${(error as Error).message}`)
    }
  }
}

/**
 * Start the MCP server with stdio transport
 *
 * @param options - Server options from CLI args (e.g., --backend flag)
 */
export async function startServer(options: McpServerOptions = {}): Promise<void> {
  // Set options so tools can access them (e.g., backend override)
  setMcpOptions(options)

  // Show configuration sources on startup (to stderr so it doesn't interfere with MCP protocol)
  if (options.verbose) {
    const resolvedConfig = resolveMcpConfigWithSources()
    console.error(formatResolvedConfig(resolvedConfig))
    console.error('')
  }

  // Ensure runtime options reflect config before deciding warmup behavior
  getConfigAndDefaults()
  const warmupEnabled = options.warmup ?? getMcpRuntimeOptions().warmup

  if (warmupEnabled) {
    await warmupClients(options)
  }

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
