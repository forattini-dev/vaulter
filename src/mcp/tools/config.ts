/**
 * Vaulter MCP Tools - Configuration & Shared Utilities
 *
 * MCP server options, config resolution, and helper functions
 */

import { VaulterClient } from '../../client.js'
import {
  loadConfig,
  loadEncryptionKey,
  loadPublicKey,
  loadPrivateKey,
  getEncryptionMode,
  getAsymmetricAlgorithm,
  findConfigDir,
  loadMcpConfig
} from '../../lib/config-loader.js'
import type { VaulterConfig, AsymmetricAlgorithm } from '../../types.js'
import { resolveBackendUrls } from '../../index.js'
import os from 'node:os'
import path from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server Options (set by server.ts when CLI args are passed)
// ─────────────────────────────────────────────────────────────────────────────

export interface McpServerOptions {
  /** Backend URL override from CLI --backend flag */
  backend?: string
  /** Working directory (where to look for .vaulter/config.yaml) */
  cwd?: string
  /** Verbose mode */
  verbose?: boolean
}

let mcpOptions: McpServerOptions = {}

/**
 * Set MCP server options (called by server.ts with CLI args)
 * If cwd is specified, changes the working directory so config can be found
 *
 * Priority for cwd:
 * 1. CLI --cwd flag
 * 2. VAULTER_CWD environment variable
 * 3. mcp.default_cwd from ~/.vaulter/config.yaml
 */
export function setMcpOptions(options: McpServerOptions): void {
  mcpOptions = options

  // Change working directory if specified (so loadConfig finds .vaulter/config.yaml)
  // Priority: CLI --cwd > VAULTER_CWD env var > global config default_cwd
  let cwd = options.cwd || process.env.VAULTER_CWD

  // If no cwd from CLI or env, try global config
  if (!cwd) {
    const globalMcpConfig = loadMcpConfig()
    if (globalMcpConfig?.default_cwd) {
      cwd = globalMcpConfig.default_cwd
    }
  }

  if (cwd) {
    try {
      process.chdir(cwd)
    } catch {
      // Ignore if directory doesn't exist - tools will handle missing config
    }
  }
}

/**
 * Get current MCP server options
 */
export function getMcpOptions(): McpServerOptions {
  return mcpOptions
}

/**
 * Effective defaults resolved from all config sources
 */
export interface McpDefaults {
  project: string
  environment: string
  key?: string
}

/**
 * Config source tracking - shows WHERE each setting came from
 */
export type ConfigSource = 'cli' | 'project' | 'project.mcp' | 'global.mcp' | 'default'

export interface ResolvedMcpConfig {
  cwd: { value: string; source: ConfigSource }
  backend: { value: string; source: ConfigSource }
  project: { value: string; source: ConfigSource }
  environment: { value: string; source: ConfigSource }
  key: { value: string | null; source: ConfigSource }
  encryptionMode: { value: string; source: ConfigSource }
  configFiles: {
    project: string | null
    global: string | null
  }
}

/**
 * Resolve MCP configuration with full source tracking
 * Use this to understand WHERE each setting is coming from
 */
export function resolveMcpConfigWithSources(): ResolvedMcpConfig {
  const cwd = process.cwd()

  // Try to load project config
  let projectConfig: VaulterConfig | null = null
  let projectConfigPath: string | null = null
  try {
    projectConfig = loadConfig()
    const configDir = findConfigDir()
    if (configDir) {
      projectConfigPath = path.join(configDir, 'config.yaml')
    }
  } catch {
    // No project config
  }

  // Load global MCP config
  const globalMcpConfig = loadMcpConfig()
  const globalConfigPath = path.join(os.homedir(), '.vaulter', 'config.yaml')
  const hasGlobalConfig = globalMcpConfig !== null

  // CLI overrides
  const cliBackend = mcpOptions.backend
  const cliCwd = mcpOptions.cwd || process.env.VAULTER_CWD

  // Resolve backend with source tracking
  let backendValue: string
  let backendSource: ConfigSource
  if (cliBackend) {
    backendValue = cliBackend
    backendSource = 'cli'
  } else if (projectConfig?.backend?.url) {
    backendValue = projectConfig.backend.url
    backendSource = 'project'
  } else if (projectConfig?.backend?.urls?.[0]) {
    backendValue = projectConfig.backend.urls[0]
    backendSource = 'project'
  } else if (projectConfig?.mcp?.default_backend) {
    backendValue = projectConfig.mcp.default_backend
    backendSource = 'project.mcp'
  } else if (globalMcpConfig?.default_backend) {
    backendValue = globalMcpConfig.default_backend
    backendSource = 'global.mcp'
  } else {
    backendValue = `file://${os.homedir()}/.vaulter/store`
    backendSource = 'default'
  }

  // Resolve project with source tracking
  let projectValue: string
  let projectSource: ConfigSource
  if (projectConfig?.project) {
    projectValue = projectConfig.project
    projectSource = 'project'
  } else if (projectConfig?.mcp?.default_project) {
    projectValue = projectConfig.mcp.default_project
    projectSource = 'project.mcp'
  } else if (globalMcpConfig?.default_project) {
    projectValue = globalMcpConfig.default_project
    projectSource = 'global.mcp'
  } else {
    projectValue = ''
    projectSource = 'default'
  }

  // Resolve environment with source tracking
  let envValue: string
  let envSource: ConfigSource
  if (projectConfig?.default_environment) {
    envValue = projectConfig.default_environment
    envSource = 'project'
  } else if (projectConfig?.mcp?.default_environment) {
    envValue = projectConfig.mcp.default_environment
    envSource = 'project.mcp'
  } else if (globalMcpConfig?.default_environment) {
    envValue = globalMcpConfig.default_environment
    envSource = 'global.mcp'
  } else {
    envValue = 'dev'
    envSource = 'default'
  }

  // Resolve key with source tracking
  let keyValue: string | null
  let keySource: ConfigSource
  if (projectConfig?.mcp?.default_key) {
    keyValue = projectConfig.mcp.default_key
    keySource = 'project.mcp'
  } else if (globalMcpConfig?.default_key) {
    keyValue = globalMcpConfig.default_key
    keySource = 'global.mcp'
  } else {
    keyValue = null
    keySource = 'default'
  }

  // Resolve encryption mode
  let encModeValue: string
  let encModeSource: ConfigSource
  if (projectConfig?.encryption?.mode) {
    encModeValue = projectConfig.encryption.mode
    encModeSource = 'project'
  } else {
    encModeValue = 'symmetric'
    encModeSource = 'default'
  }

  return {
    cwd: {
      value: cwd,
      source: cliCwd ? 'cli' : 'default'
    },
    backend: { value: backendValue, source: backendSource },
    project: { value: projectValue, source: projectSource },
    environment: { value: envValue, source: envSource },
    key: { value: keyValue, source: keySource },
    encryptionMode: { value: encModeValue, source: encModeSource },
    configFiles: {
      project: projectConfigPath,
      global: hasGlobalConfig ? globalConfigPath : null
    }
  }
}

/**
 * Format resolved config for display (human-readable)
 */
export function formatResolvedConfig(config: ResolvedMcpConfig): string {
  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║           VAULTER MCP - CONFIGURATION SOURCES                ║',
    '╠══════════════════════════════════════════════════════════════╣'
  ]

  // Config files found
  lines.push('║ Config Files:                                                 ║')
  if (config.configFiles.project) {
    lines.push(`║   ✓ Project: ${config.configFiles.project.padEnd(45)}║`)
  } else {
    lines.push('║   ✗ Project: (not found)                                      ║')
  }
  if (config.configFiles.global) {
    lines.push(`║   ✓ Global:  ${config.configFiles.global.padEnd(45)}║`)
  } else {
    lines.push('║   ✗ Global:  (not found)                                      ║')
  }

  lines.push('╠══════════════════════════════════════════════════════════════╣')
  lines.push('║ Resolved Values:                         SOURCE              ║')
  lines.push('╠══════════════════════════════════════════════════════════════╣')

  const formatLine = (label: string, value: string, source: ConfigSource): string => {
    const truncValue = value.length > 30 ? value.substring(0, 27) + '...' : value
    const sourceTag = `[${source}]`
    return `║   ${label.padEnd(12)} ${truncValue.padEnd(30)} ${sourceTag.padEnd(14)}║`
  }

  lines.push(formatLine('cwd:', config.cwd.value, config.cwd.source))
  lines.push(formatLine('backend:', config.backend.value, config.backend.source))
  lines.push(formatLine('project:', config.project.value || '(empty)', config.project.source))
  lines.push(formatLine('environment:', config.environment.value, config.environment.source))
  lines.push(formatLine('key:', config.key.value || '(none)', config.key.source))
  lines.push(formatLine('encryption:', config.encryptionMode.value, config.encryptionMode.source))

  lines.push('╚══════════════════════════════════════════════════════════════╝')

  return lines.join('\n')
}

/**
 * Get current config and client
 * Supports both symmetric and asymmetric encryption modes
 *
 * Priority order for all settings:
 * 1. CLI flags / tool arguments
 * 2. Project config (.vaulter/config.yaml)
 * 3. Project MCP config (.vaulter/config.yaml → mcp.*)
 * 4. Global MCP config (~/.vaulter/config.yaml → mcp.*)
 * 5. Defaults
 */
export async function getClientAndConfig(): Promise<{
  client: VaulterClient
  config: VaulterConfig | null
  defaults: McpDefaults
}> {
  let config: VaulterConfig | null = null
  try {
    config = loadConfig()
  } catch {
    // Config not found is OK
  }

  // Load global MCP config as fallback
  const mcpConfig = loadMcpConfig()

  // Resolve effective defaults with priority chain:
  // project config > project mcp > global mcp > hardcoded default
  const defaults: McpDefaults = {
    project: config?.project
      || config?.mcp?.default_project
      || mcpConfig?.default_project
      || '',
    environment: config?.default_environment
      || config?.mcp?.default_environment
      || mcpConfig?.default_environment
      || 'dev',
    key: config?.mcp?.default_key
      || mcpConfig?.default_key
  }

  // CLI --backend flag takes precedence over config file
  const backendOverride = mcpOptions.backend

  // Determine connection strings with priority:
  // 1. CLI --backend flag
  // 2. Project config backend (config.backend)
  // 3. Project MCP config (config.mcp.default_backend)
  // 4. Global MCP config (~/.vaulter/config.yaml → mcp.default_backend)
  // 5. Default (file://$HOME/.vaulter/store)
  let connectionStrings: string[]
  if (backendOverride) {
    connectionStrings = [backendOverride]
  } else if (config?.backend) {
    connectionStrings = resolveBackendUrls(config)
  } else if (config?.mcp?.default_backend) {
    connectionStrings = [config.mcp.default_backend]
  } else if (mcpConfig?.default_backend) {
    connectionStrings = [mcpConfig.default_backend]
  } else {
    connectionStrings = []
  }

  // Determine encryption mode
  const encryptionMode = config ? getEncryptionMode(config) : 'symmetric'

  // For asymmetric mode, load public/private keys
  if (encryptionMode === 'asymmetric' && config) {
    const publicKey = await loadPublicKey(config, config.project)
    const privateKey = await loadPrivateKey(config, config.project)
    const algorithm = getAsymmetricAlgorithm(config) as AsymmetricAlgorithm

    const client = new VaulterClient({
      connectionStrings: connectionStrings.length > 0 ? connectionStrings : undefined,
      encryptionMode: 'asymmetric',
      publicKey: publicKey || undefined,
      privateKey: privateKey || undefined,
      asymmetricAlgorithm: algorithm
    })

    return { client, config, defaults }
  }

  // Symmetric mode (default)
  const passphrase = config ? await loadEncryptionKey(config) : undefined

  const client = new VaulterClient({
    connectionStrings: connectionStrings.length > 0 ? connectionStrings : undefined,
    encryptionMode: 'symmetric',
    passphrase: passphrase || undefined
  })

  return { client, config, defaults }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize name for Kubernetes
 */
export function sanitizeK8sName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Base64 encode
 */
export function base64Encode(value: string): string {
  return Buffer.from(value).toString('base64')
}

/**
 * Standard MCP tool response type
 */
export type ToolResponse = { content: Array<{ type: 'text'; text: string }> }

/**
 * Create a successful tool response
 */
export function textResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }] }
}

/**
 * Create an error tool response
 */
export function errorResponse(message: string): ToolResponse {
  return { content: [{ type: 'text', text: `Error: ${message}` }] }
}
