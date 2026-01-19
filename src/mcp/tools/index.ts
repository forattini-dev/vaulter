/**
 * Vaulter MCP Tools - Main Entry Point
 *
 * Re-exports tool definitions and provides the main handleToolCall dispatcher
 */

import type { Environment } from '../../types.js'
import {
  getClientAndConfig,
  setMcpOptions,
  getMcpOptions,
  resolveMcpConfigWithSources,
  formatResolvedConfig,
  type McpServerOptions,
  type McpDefaults,
  type ToolResponse
} from './config.js'

// Re-export definitions and config utilities
export { registerTools } from './definitions.js'
export {
  setMcpOptions,
  getMcpOptions,
  getClientAndConfig,
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
  handleExportCall
} from './handlers/core.js'
import {
  handleMultiGetCall,
  handleMultiSetCall,
  handleMultiDeleteCall
} from './handlers/batch.js'
import {
  handleSyncCall,
  handlePullCall,
  handlePushCall
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
  handleKeyImportCall
} from './handlers/keys.js'
import {
  handleCategorizeVarsCall,
  handleSharedListCall,
  handleInheritanceInfoCall,
  handleAuditListCall,
  handleStatusCall
} from './handlers/monorepo.js'

/**
 * Main tool call dispatcher
 *
 * Routes tool calls to appropriate handlers
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { client, config, defaults } = await getClientAndConfig()
  // Use effective defaults from config chain (project > project.mcp > global mcp > hardcoded)
  const project = (args.project as string) || defaults.project
  const environment = (args.environment as Environment) || defaults.environment
  const service = args.service as string | undefined

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

  if (!project && !['vaulter_services', 'vaulter_init'].includes(name)) {
    return {
      content: [{
        type: 'text',
        text: 'Error: Project not specified. Either set project in args or run from a directory with .vaulter/config.yaml'
      }]
    }
  }

  try {
    await client.connect()

    switch (name) {
      case 'vaulter_get':
        return await handleGetCall(client, project, environment, service, args)

      case 'vaulter_set':
        return await handleSetCall(client, project, environment, service, args)

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
        return await handleMultiSetCall(client, project, environment, service, args)

      case 'vaulter_multi_delete':
        return await handleMultiDeleteCall(client, project, environment, service, args)

      // === SYNC TOOLS ===
      case 'vaulter_sync':
        return await handleSyncCall(client, config, project, environment, service, args)

      case 'vaulter_pull':
        return await handlePullCall(client, config, project, environment, service, args)

      case 'vaulter_push':
        return await handlePushCall(client, config, project, environment, service, args)

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
        return await handleAuditListCall(client, config, project, environment, service, args)

      // === CATEGORIZATION TOOLS ===
      case 'vaulter_categorize_vars':
        return await handleCategorizeVarsCall(client, config, project, environment, service, args)

      // === SHARED VARIABLES TOOLS ===
      case 'vaulter_shared_list':
        return await handleSharedListCall(client, project, environment, args)

      case 'vaulter_inheritance_info':
        return await handleInheritanceInfoCall(client, project, environment, args)

      // === STATUS TOOL (consolidated) ===
      case 'vaulter_status':
        return await handleStatusCall(client, config, project, environment, service, args)

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
    }
  } finally {
    await client.disconnect()
  }
}
