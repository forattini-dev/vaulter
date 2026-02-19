/**
 * Vaulter MCP Tools — Re-export shim
 */
export {
  registerTools,
  handleToolCall,
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
  type ResolvedMcpConfig,
  type HandlerContext
} from './tools/index.js'
