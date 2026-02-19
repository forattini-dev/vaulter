/**
 * Vaulter MCP Tool Dispatcher
 *
 * 16 action-based tools delegating to domain layer.
 */

import type { Environment } from '../../types.js'
import type { VaulterClient } from '../../client.js'
import { inferServiceFromPath } from '../../lib/monorepo.js'
import { findConfigDir } from '../../lib/config-loader.js'
import { withRetry } from '../../lib/timeout.js'
import { buildMcpErrorHints } from '../../lib/error-hints.js'
import {
  getConfigAndDefaults,
  getClientForEnvironment,
  getClientForSharedVars,
  getMcpOptions,
  errorResponse,
  type ToolResponse
} from './config.js'

// Re-export definitions and config utilities
export { registerTools } from './definitions.js'
export {
  setMcpOptions,
  getMcpOptions,
  getConfigAndDefaults,
  getClientForEnvironment,
  getClientForSharedVars,
  clearClientCache,
  getMcpRuntimeOptions,
  resolveMcpConfigWithSources,
  formatResolvedConfig,
  sanitizeK8sName,
  base64Encode,
  textResponse,
  errorResponse,
  type McpServerOptions,
  type McpDefaults,
  type ToolResponse,
  type ConfigSource,
  type ResolvedMcpConfig
} from './config.js'

// Import handlers
import { handleChange } from './handlers/change.js'
import { handlePlan } from './handlers/plan.js'
import { handleApply } from './handlers/apply.js'
import { handleGet, handleList } from './handlers/read.js'
import { handleStatus } from './handlers/status.js'
import { handleSearch } from './handlers/search.js'
import { handleDiff } from './handlers/diff.js'
import { handleExport } from './handlers/export.js'
import { handleKey } from './handlers/key.js'
import { handleSnapshot } from './handlers/snapshot.js'
import { handleVersions } from './handlers/versions.js'
import { handleLocal } from './handlers/local.js'
import { handleInit } from './handlers/init.js'
import { handleServices } from './handlers/services.js'
import { handleNuke } from './handlers/nuke.js'

/**
 * Shared handler context
 */
export interface HandlerContext {
  config: import('../../types.js').VaulterConfig | null
  project: string
  environment: string
  service: string | undefined
  configDir: string | null
  connectionStrings: string[]
}

function resolveContext(args: Record<string, unknown>): HandlerContext {
  const { config, defaults, connectionStrings } = getConfigAndDefaults()
  const project = (args.project as string) || defaults.project
  const environment = (args.environment as string) || defaults.environment
  const explicitService = args.service as string | undefined
  const service = explicitService || (config && inferServiceFromPath(process.cwd(), config)) || undefined
  const configDir = findConfigDir() || null

  return { config, project, environment, service, configDir, connectionStrings }
}

async function resolveClient(
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<VaulterClient> {
  const isSharedOperation = args.shared === true
  const timeoutMs = args.timeout_ms as number | undefined

  let client: VaulterClient
  if (isSharedOperation) {
    const { client: sharedClient } = await getClientForSharedVars({
      config: ctx.config,
      connectionStrings: ctx.connectionStrings,
      project: ctx.project,
      timeoutMs
    })
    client = sharedClient
  } else {
    client = await getClientForEnvironment(ctx.environment as Environment, {
      config: ctx.config,
      connectionStrings: ctx.connectionStrings,
      project: ctx.project,
      timeoutMs
    })
  }

  if (!client.isConnected()) {
    const options = getMcpOptions()
    await withRetry(
      () => client.connect(),
      {
        maxAttempts: 3,
        delayMs: 1000,
        onRetry: (attempt, error) => {
          if (options.verbose) {
            console.error(`[vaulter] Connection attempt ${attempt} failed, retrying...`, error.message)
          }
        }
      }
    )
  }

  return client
}

/**
 * Main tool call dispatcher
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const ctx = resolveContext(args)

  // ─── No-backend tools ──────────────────────────────────────────────
  switch (name) {
    case 'vaulter_change':
      return handleChange(ctx, args)

    case 'vaulter_init':
      return handleInit(args)

    case 'vaulter_services':
      return handleServices(args)

    case 'vaulter_key':
      return handleKey(ctx, args)
  }

  // Local actions that don't need backend
  if (name === 'vaulter_local') {
    const action = args.action as string
    const offlineActions = ['pull', 'set', 'delete', 'status', 'shared-set', 'shared-delete', 'shared-list']
    if (offlineActions.includes(action)) {
      return handleLocal(ctx, null, args)
    }
  }

  // ─── Client-required tools ─────────────────────────────────────────
  if (!ctx.project && !['vaulter_init', 'vaulter_services'].includes(name)) {
    return errorResponse(
      'Project not specified. Either set project in args or run from a directory with .vaulter/config.yaml',
      [
        'Set project: { "project": "<name>" }',
        'Run from a directory containing .vaulter/config.yaml',
        'Run vaulter init in the current project'
      ]
    )
  }

  let client: VaulterClient
  try {
    client = await resolveClient(ctx, args)
  } catch (err) {
    const hints = buildMcpErrorHints(err, {
      tool: name,
      environment: ctx.environment,
      timeoutMs: args.timeout_ms as number | undefined
    })
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(`Backend connection failed: ${message}`, hints)
  }

  try {
    switch (name) {
      case 'vaulter_plan':
        return handlePlan(ctx, client, args)

      case 'vaulter_apply':
        return handleApply(ctx, client, args)

      case 'vaulter_get':
        return handleGet(ctx, client, args)

      case 'vaulter_list':
        return handleList(ctx, client, args)

      case 'vaulter_status':
        return handleStatus(ctx, client, args)

      case 'vaulter_search':
        return handleSearch(ctx, client, args)

      case 'vaulter_diff':
        return handleDiff(ctx, client, args)

      case 'vaulter_export':
        return handleExport(ctx, client, args)

      case 'vaulter_snapshot':
        return handleSnapshot(ctx, client, args)

      case 'vaulter_versions':
        return handleVersions(ctx, client, args)

      case 'vaulter_local':
        return handleLocal(ctx, client, args)

      case 'vaulter_nuke':
        return handleNuke(client)

      default:
        return errorResponse(`Unknown tool: ${name}`, [
          'Check tool name against registerTools output',
          'Use tools list for canonical command names'
        ])
    }
  } catch (err) {
    const hints = buildMcpErrorHints(err, {
      tool: name,
      environment: ctx.environment,
      timeoutMs: args.timeout_ms as number | undefined
    })
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(message, hints)
  }
}
