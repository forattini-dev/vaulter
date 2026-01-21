/**
 * Vaulter MCP Tools
 *
 * This file re-exports all functionality from the modular tools structure
 * for backward compatibility.
 *
 * The actual implementation is split across:
 *   - tools/config.ts      - Configuration utilities
 *   - tools/definitions.ts - Tool schema definitions
 *   - tools/index.ts       - Main dispatcher
 *   - tools/handlers/      - Handler implementations by category
 */

// Re-export everything from the modular structure
export {
  // Tool definitions
  registerTools,

  // Main dispatcher
  handleToolCall,

  // Config utilities
  setMcpOptions,
  getMcpOptions,
  resolveMcpConfigWithSources,
  formatResolvedConfig,

  // Helpers
  sanitizeK8sName,
  base64Encode,
  textResponse,
  errorResponse,

  // Types
  type McpServerOptions,
  type McpDefaults,
  type ToolResponse,
  type ConfigSource,
  type ResolvedMcpConfig
} from './tools/index.js'
