/**
 * Vaulter MCP Tools - Main Entry Point
 *
 * Re-exports tool definitions and provides the main handleToolCall dispatcher
 */

import type { Environment } from '../../types.js'
import type { VaulterClient } from '../../client.js'
import { SHARED_SERVICE } from '../../lib/shared.js'
import { withRetry } from '../../lib/timeout.js'
import {
  getConfigAndDefaults,
  getClientForEnvironment,
  getClientForSharedVars,
  clearClientCache,
  getMcpOptions,
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
import { handleInitCall } from './handlers/init.js'
import {
  handleGetCall,
  handleSetCall,
  handleDeleteCall,
  handleListCall,
  handleExportCall,
  handleNukePreviewCall
} from './handlers/core.js'
import {
  handleMultiGetCall,
  handleMultiSetCall,
  handleMultiDeleteCall
} from './handlers/batch.js'
import {
  handlePullCall,
  handlePushCall,
  handleSyncPlanCall
} from './handlers/sync.js'
import {
  handleCompareCall,
  handleSearchCall,
  handleScanCall,
  handleServicesCall
} from './handlers/analysis.js'
import {
  handleK8sSecretCall,
  handleK8sConfigMapCall
} from './handlers/k8s.js'
import {
  handleHelmValuesCall,
  handleTfVarsCall
} from './handlers/iac.js'
import {
  handleKeyGenerateCall,
  handleKeyListCall,
  handleKeyShowCall,
  handleKeyExportCall,
  handleKeyImportCall,
  handleKeyRotateCall
} from './handlers/keys.js'
import {
  handleCategorizeVarsCall,
  handleSharedListCall,
  handleInheritanceInfoCall,
  handleAuditListCall,
  handleStatusCall
} from './handlers/monorepo.js'
import {
  handleCopyCall,
  handleMoveCall,
  handleRenameCall,
  handlePromoteSharedCall,
  handleDemoteSharedCall
} from './handlers/utility.js'
import {
  handleDoctorCall,
  handleCloneEnvCall,
  handleDiffCall
} from './handlers/doctor.js'
import {
  handleLocalPullCall,
  handleLocalPushCall,
  handleLocalPushAllCall,
  handleLocalSyncCall,
  handleLocalSetCall,
  handleLocalDeleteCall,
  handleLocalDiffCall,
  handleLocalStatusCall,
  handleLocalSharedSetCall,
  handleLocalSharedDeleteCall,
  handleLocalSharedListCall,
  handleSnapshotCreateCall,
  handleSnapshotListCall,
  handleSnapshotRestoreCall
} from './handlers/local.js'
import {
  handleListVersions,
  handleGetVersion,
  handleRollback
} from './handlers/versioning.js'

/**
 * Main tool call dispatcher
 *
 * Routes tool calls to appropriate handlers.
 * Uses per-environment clients for proper encryption key handling.
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  // Step 1: Get config and defaults (without creating client yet)
  const { config, defaults, connectionStrings } = getConfigAndDefaults()

  // Step 2: Resolve project, environment, service from args/defaults
  const project = (args.project as string) || defaults.project
  const environment = (args.environment as Environment) || defaults.environment
  const service = args.service as string | undefined
  const timeoutMs = args.timeout_ms as number | undefined

  // Determine if this is a shared var operation
  const isSharedOperation = args.shared === true || service === SHARED_SERVICE

  // Tools that don't need backend connection
  if (name === 'vaulter_scan') {
    return handleScanCall(args)
  }

  if (name === 'vaulter_services') {
    return handleServicesCall(args)
  }

  if (name === 'vaulter_init') {
    return handleInitCall(args)
  }

  // Local tools that don't need backend
  if (name === 'vaulter_local_set' && config) {
    return handleLocalSetCall(config, args)
  }
  if (name === 'vaulter_local_delete' && config) {
    return handleLocalDeleteCall(config, args)
  }
  if (name === 'vaulter_local_status' && config) {
    return handleLocalStatusCall(config, args)
  }
  // Local shared tools (don't need backend)
  if (name === 'vaulter_local_shared_set' && config) {
    return handleLocalSharedSetCall(config, args)
  }
  if (name === 'vaulter_local_shared_delete' && config) {
    return handleLocalSharedDeleteCall(config, args)
  }
  if (name === 'vaulter_local_shared_list' && config) {
    return handleLocalSharedListCall(config, args)
  }
  if (name === 'vaulter_snapshot_list' && config && config.snapshots?.driver !== 's3db') {
    return handleSnapshotListCall(config, args)
  }

  // Key management tools - don't need backend, but need project for scoping
  if (name === 'vaulter_key_generate') {
    return handleKeyGenerateCall(args, config)
  }

  if (name === 'vaulter_key_list') {
    return handleKeyListCall(args, config)
  }

  if (name === 'vaulter_key_show') {
    return handleKeyShowCall(args, config)
  }

  if (name === 'vaulter_key_export') {
    return handleKeyExportCall(args, config)
  }

  if (name === 'vaulter_key_import') {
    return handleKeyImportCall(args, config)
  }

  if (name === 'vaulter_key_rotate') {
    // Key rotate needs a client factory that creates per-environment clients
    // Also clears cache to pick up new keys after rotation
    const createClientForRotation = async (env?: string) => {
      clearClientCache()
      const targetEnv = env || environment
      const newClient = await getClientForEnvironment(targetEnv, { config, connectionStrings, project })
      return newClient
    }
    return handleKeyRotateCall(args, config, createClientForRotation)
  }

  // Doctor tool - handles its own connection testing
  if (name === 'vaulter_doctor') {
    return handleDoctorCall(
      config,
      project,
      environment,
      service,
      args,
      async () => {
        try {
          const testClient = await getClientForEnvironment(environment, { config, connectionStrings, project })
          await testClient.connect()
          try {
            const vars = await testClient.list({ project, environment, service })
            return { connected: true, varsCount: vars.length }
          } finally {
            await testClient.disconnect()
          }
        } catch (error) {
          return { connected: false, error: (error as Error).message }
        }
      }
    )
  }

  // Clone env tool - handles multiple clients
  if (name === 'vaulter_clone_env') {
    if (!project) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Project not specified. Either set project in args or run from a directory with .vaulter/config.yaml'
        }]
      }
    }
    return handleCloneEnvCall(
      async (env: Environment) => {
        const envClient = await getClientForEnvironment(env, { config, connectionStrings, project })
        await envClient.connect()
        return {
          client: envClient,
          disconnect: () => envClient.disconnect()
        }
      },
      project,
      service,
      args
    )
  }

  if (!project && !['vaulter_services', 'vaulter_init'].includes(name)) {
    return {
      content: [{
        type: 'text',
        text: 'Error: Project not specified. Either set project in args or run from a directory with .vaulter/config.yaml'
      }]
    }
  }

  // Step 3: Get client with correct encryption key for this environment
  // For shared vars, use the shared key environment
  let client: VaulterClient | undefined
  try {
    if (isSharedOperation) {
      const { client: sharedClient } = await getClientForSharedVars({ config, connectionStrings, project, timeoutMs })
      client = sharedClient
    } else {
      client = await getClientForEnvironment(environment, { config, connectionStrings, project, timeoutMs })
    }

    // Only connect if not already connected (reuse existing connection)
    if (!client.isConnected()) {
      // Retry connection with exponential backoff (3 attempts: 1s, 2s, 4s)
      const options = getMcpOptions()
      await withRetry(
        () => client!.connect(),
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

    switch (name) {
      case 'vaulter_get':
        return await handleGetCall(client, project, environment, service, args)

      case 'vaulter_set':
        return await handleSetCall(client, project, environment, service, config, args)

      case 'vaulter_delete':
        return await handleDeleteCall(client, project, environment, service, args)

      case 'vaulter_list':
        return await handleListCall(client, project, environment, service, args)

      case 'vaulter_export':
        return await handleExportCall(client, project, environment, service, args)

      // === BATCH OPERATIONS ===
      case 'vaulter_multi_get':
        return await handleMultiGetCall(client, project, environment, service, args)

      case 'vaulter_multi_set':
        return await handleMultiSetCall(client, project, environment, service, config, args)

      case 'vaulter_multi_delete':
        return await handleMultiDeleteCall(client, project, environment, service, args)

      // === SYNC TOOLS ===
      case 'vaulter_pull':
        return await handlePullCall(client, config, project, environment, service, args)

      case 'vaulter_push':
        return await handlePushCall(client, config, project, environment, service, args)

      case 'vaulter_sync_plan':
        return await handleSyncPlanCall(client, config, project, environment, service, args)

      // === ANALYSIS TOOLS ===
      case 'vaulter_compare':
        return await handleCompareCall(client, project, service, args)

      case 'vaulter_search':
        return await handleSearchCall(client, project, service, args, config)

      // === KUBERNETES TOOLS ===
      case 'vaulter_k8s_secret':
        return await handleK8sSecretCall(client, config, project, environment, service, args)

      case 'vaulter_k8s_configmap':
        return await handleK8sConfigMapCall(client, config, project, environment, service, args)

      // === IAC TOOLS ===
      case 'vaulter_helm_values':
        return await handleHelmValuesCall(client, config, project, environment, service, args)

      case 'vaulter_tf_vars':
        return await handleTfVarsCall(client, config, project, environment, service, args)

      // === AUDIT TOOLS ===
      case 'vaulter_audit_list':
        return await handleAuditListCall(config, project, environment, service, args)

      // === CATEGORIZATION TOOLS ===
      case 'vaulter_categorize_vars':
        return await handleCategorizeVarsCall(client, config, project, environment, service)

      // === SHARED VARIABLES TOOLS ===
      case 'vaulter_shared_list':
        return await handleSharedListCall(client, project, environment, args)

      case 'vaulter_inheritance_info':
        return await handleInheritanceInfoCall(client, project, environment, args)

      // === STATUS TOOL (consolidated) ===
      case 'vaulter_status':
        return await handleStatusCall(client, config, project, environment, service, args)

      // === DANGEROUS OPERATIONS (preview only) ===
      case 'vaulter_nuke_preview':
        return await handleNukePreviewCall(client)

      // === UTILITY TOOLS (for full autonomy) ===
      case 'vaulter_copy':
        return await handleCopyCall(client, project, environment, service, args)

      case 'vaulter_move':
        return await handleMoveCall(client, project, environment, service, config, args)

      case 'vaulter_rename':
        return await handleRenameCall(client, project, environment, service, args)

      case 'vaulter_promote_shared':
        return await handlePromoteSharedCall(client, project, environment, service, config, args)

      case 'vaulter_demote_shared':
        return await handleDemoteSharedCall(client, project, environment, service, config, args)

      case 'vaulter_diff':
        return await handleDiffCall(client, config, project, environment, service, args)

      // === LOCAL OVERRIDES TOOLS (need client for base env) ===
      case 'vaulter_local_pull':
        return await handleLocalPullCall(client, config!, project, environment, service, args)

      case 'vaulter_local_push':
        return await handleLocalPushCall(client, config!, project, environment, service, args)

      case 'vaulter_local_diff':
        return await handleLocalDiffCall(client, config!, project, environment, service, args)

      case 'vaulter_local_push_all':
        return await handleLocalPushAllCall(client, config!, project, environment, service, args)

      case 'vaulter_local_sync':
        return await handleLocalSyncCall(client, config!, project, environment, service, args)

      // === SNAPSHOT TOOLS (need client) ===
      case 'vaulter_snapshot_create':
        return await handleSnapshotCreateCall(client, config!, project, environment, service, args)

      case 'vaulter_snapshot_list':
        return await handleSnapshotListCall(config!, args, client)

      case 'vaulter_snapshot_restore':
        return await handleSnapshotRestoreCall(client, config!, project, environment, service, args)

      // === VERSIONING TOOLS ===
      case 'vaulter_list_versions':
        return await handleListVersions(args, { client, project, config: config! })

      case 'vaulter_get_version':
        return await handleGetVersion(args, { client, project, config: config! })

      case 'vaulter_rollback':
        return await handleRollback(args, { client, project, config: config! })

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
    }
  } catch (error) {
    // Re-throw to let caller handle it
    throw error
  }
  // NOTE: We intentionally do NOT disconnect the client here.
  // Clients are cached and reused across MCP calls for better performance.
  // Disconnecting would force a new connection on every call, adding latency.
  // The connection will be kept alive for the lifetime of the MCP server.
}
