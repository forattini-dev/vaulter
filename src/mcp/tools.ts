/**
 * Vaulter MCP Tools
 *
 * Comprehensive tool definitions and handlers for the MCP server
 * Provides 22 tools for environment, secrets, and key management
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { VaulterClient } from '../client.js'
import {
  loadConfig,
  loadEncryptionKey,
  loadPublicKey,
  loadPrivateKey,
  getEncryptionMode,
  getAsymmetricAlgorithm,
  findConfigDir,
  getEnvFilePath,
  getEnvFilePathForConfig,
  getSecretsFilePath,
  getConfigsFilePath,
  isSplitMode,
  getValidEnvironments,
  getProjectKeysDir,
  getGlobalKeysDir,
  resolveKeyPath,
  resolveKeyPaths,
  keyExists,
  parseKeyName,
  loadMcpConfig
} from '../lib/config-loader.js'
import { parseEnvFile, serializeEnv } from '../lib/env-parser.js'
import { discoverServices } from '../lib/monorepo.js'
import { scanMonorepo, formatScanResult } from '../lib/monorepo-detect.js'
import { getSecretPatterns, splitVarsBySecret } from '../lib/secret-patterns.js'
import { generateKeyPair, generatePassphrase, detectAlgorithm } from '../lib/crypto.js'
import type { VaulterConfig, Environment, AsymmetricAlgorithm } from '../types.js'
import { DEFAULT_ENVIRONMENTS } from '../types.js'
import { resolveBackendUrls } from '../index.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import YAML from 'yaml'

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
 */
export function setMcpOptions(options: McpServerOptions): void {
  mcpOptions = options

  // Change working directory if specified (so loadConfig finds .vaulter/config.yaml)
  // Priority: CLI --cwd > VAULTER_CWD env var
  const cwd = options.cwd || process.env.VAULTER_CWD
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
interface McpDefaults {
  project: string
  environment: string
  key?: string
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
async function getClientAndConfig(): Promise<{
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

/**
 * Sanitize name for Kubernetes
 */
function sanitizeK8sName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Base64 encode
 */
function base64Encode(value: string): string {
  return Buffer.from(value).toString('base64')
}

/**
 * Register all available tools
 */
export function registerTools(): Tool[] {
  return [
    // === CORE TOOLS ===
    {
      name: 'vaulter_get',
      description: 'Get the value of a single environment variable from the backend',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name to retrieve' },
          environment: { type: 'string', description: 'Environment name (as defined in config)', default: 'dev' },
          project: { type: 'string', description: 'Project name (auto-detected from config if omitted)' },
          service: { type: 'string', description: 'Service name for monorepos' }
        },
        required: ['key']
      }
    },
    {
      name: 'vaulter_set',
      description: 'Set an environment variable in the backend (encrypted)',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name' },
          value: { type: 'string', description: 'Value to set' },
          environment: { type: 'string', description: 'Environment name (as defined in config)', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name for monorepos' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization (e.g., ["database", "sensitive"])' }
        },
        required: ['key', 'value']
      }
    },
    {
      name: 'vaulter_delete',
      description: 'Delete an environment variable from the backend',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name to delete' },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' }
        },
        required: ['key']
      }
    },
    {
      name: 'vaulter_list',
      description: 'List all environment variables for a project/environment. By default hides values for security.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          showValues: { type: 'boolean', description: 'Show actual values (default: false for security)', default: false },
          filter: { type: 'string', description: 'Filter keys by pattern (e.g., "DATABASE_*", "*_URL")' }
        }
      }
    },
    {
      name: 'vaulter_export',
      description: 'Export all environment variables in various formats (shell, env, json, yaml, tfvars, docker-args)',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          format: { type: 'string', description: 'Output format', enum: ['shell', 'env', 'json', 'yaml', 'tfvars', 'docker-args'], default: 'shell' }
        }
      }
    },

    // === SYNC TOOLS ===
    {
      name: 'vaulter_sync',
      description: 'Bidirectional sync between local .env file and backend. Local values win on conflict.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          dryRun: { type: 'boolean', description: 'Preview changes without applying', default: false }
        }
      }
    },
    {
      name: 'vaulter_pull',
      description: 'Download variables from backend to local .env file. Overwrites local file.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          output: { type: 'string', description: 'Output file path (default: auto-detected from config)' }
        }
      }
    },
    {
      name: 'vaulter_push',
      description: 'Upload local .env file to backend. Overwrites backend values.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          file: { type: 'string', description: 'Input file path (default: auto-detected from config)' }
        }
      }
    },

    // === ANALYSIS TOOLS ===
    {
      name: 'vaulter_compare',
      description: 'Compare environment variables between two environments. Shows added, removed, and changed variables.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Source environment name', default: 'dev' },
          target: { type: 'string', description: 'Target environment name', default: 'prd' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          showValues: { type: 'boolean', description: 'Show actual values in diff', default: false }
        },
        required: ['source', 'target']
      }
    },
    {
      name: 'vaulter_search',
      description: 'Search for variables by key pattern across all environments',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (e.g., "DATABASE_*", "*_SECRET", "*redis*")' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          environments: { type: 'array', items: { type: 'string' }, description: 'Environments to search (default: from config or dev/stg/prd)' }
        },
        required: ['pattern']
      }
    },

    // === MONOREPO TOOLS ===
    {
      name: 'vaulter_scan',
      description: 'Scan monorepo to discover all packages/apps. Detects NX, Turborepo, Lerna, pnpm workspaces, Yarn workspaces, and Rush. Shows which packages have .env files and which need vaulter initialization.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Root directory to scan (default: current directory)' },
          format: { type: 'string', description: 'Output format', enum: ['text', 'json'], default: 'text' }
        }
      }
    },
    {
      name: 'vaulter_services',
      description: 'List all services discovered in the monorepo (directories with .vaulter/config.yaml)',
      inputSchema: {
        type: 'object',
        properties: {
          detailed: { type: 'boolean', description: 'Show detailed info (environments, backend URLs)', default: false }
        }
      }
    },

    // === KUBERNETES TOOLS ===
    {
      name: 'vaulter_k8s_secret',
      description: 'Generate Kubernetes Secret YAML from environment variables. Ready to pipe to kubectl apply.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          namespace: { type: 'string', description: 'K8s namespace (default: project-environment)' },
          name: { type: 'string', description: 'Secret name (default: project-secrets or service-secrets)' }
        }
      }
    },
    {
      name: 'vaulter_k8s_configmap',
      description: 'Generate Kubernetes ConfigMap YAML from non-secret variables. Automatically filters out sensitive vars.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          namespace: { type: 'string', description: 'K8s namespace' },
          name: { type: 'string', description: 'ConfigMap name' }
        }
      }
    },

    // === TERRAFORM TOOLS ===
    {
      name: 'vaulter_helm_values',
      description: 'Generate Helm values.yaml from environment variables. Separates variables into env (plain) and secrets sections.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' }
        }
      }
    },
    {
      name: 'vaulter_tf_vars',
      description: 'Generate Terraform .tfvars file from environment variables. Converts names to lowercase and includes an env_vars map.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          format: { type: 'string', description: 'Output format', enum: ['tfvars', 'json'], default: 'tfvars' }
        }
      }
    },

    // === SETUP TOOLS ===
    {
      name: 'vaulter_init',
      description: 'Initialize a new vaulter project. Creates .vaulter/config.yaml with the specified settings.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name (required)' },
          service: { type: 'string', description: 'Service name (for monorepos)' },
          backend: { type: 'string', description: 'Backend URL (e.g., s3://bucket/path, file:///path)' },
          mode: { type: 'string', description: 'Directory mode', enum: ['unified', 'split'], default: 'unified' },
          environments: { type: 'array', items: { type: 'string' }, description: 'Environments to create (any names)', default: ['dev', 'stg', 'prd'] }
        },
        required: ['project']
      }
    },

    // === KEY MANAGEMENT TOOLS ===
    {
      name: 'vaulter_key_generate',
      description: 'Generate a new encryption key. Supports symmetric (AES-256) and asymmetric (RSA/EC) keys. Keys are stored in ~/.vaulter/',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Key name (e.g., master, deploy)' },
          project: { type: 'string', description: 'Project name (auto-detected from config if omitted)' },
          global: { type: 'boolean', description: 'Store in global scope (~/.vaulter/global/) instead of project scope', default: false },
          asymmetric: { type: 'boolean', description: 'Generate asymmetric key pair instead of symmetric', default: false },
          algorithm: { type: 'string', description: 'Algorithm for asymmetric keys', enum: ['rsa-4096', 'rsa-2048', 'ec-p256', 'ec-p384'], default: 'rsa-4096' },
          force: { type: 'boolean', description: 'Overwrite existing key', default: false }
        },
        required: ['name']
      }
    },
    {
      name: 'vaulter_key_list',
      description: 'List all encryption keys (project and global). Shows key type, algorithm, and status.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name (auto-detected from config if omitted)' }
        }
      }
    },
    {
      name: 'vaulter_key_show',
      description: 'Show detailed information about a specific key.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Key name to show' },
          project: { type: 'string', description: 'Project name' },
          global: { type: 'boolean', description: 'Look in global scope', default: false }
        },
        required: ['name']
      }
    },
    {
      name: 'vaulter_key_export',
      description: 'Export a key to an encrypted bundle file. Use VAULTER_EXPORT_PASSPHRASE env var to set encryption passphrase.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Key name to export' },
          output: { type: 'string', description: 'Output file path for the encrypted bundle' },
          project: { type: 'string', description: 'Project name' },
          global: { type: 'boolean', description: 'Export from global scope', default: false }
        },
        required: ['name', 'output']
      }
    },
    {
      name: 'vaulter_key_import',
      description: 'Import a key from an encrypted bundle file. Use VAULTER_EXPORT_PASSPHRASE env var to decrypt.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Input bundle file path' },
          name: { type: 'string', description: 'New name for the imported key (optional, uses original name from bundle)' },
          project: { type: 'string', description: 'Project name' },
          global: { type: 'boolean', description: 'Import to global scope', default: false },
          force: { type: 'boolean', description: 'Overwrite existing key', default: false }
        },
        required: ['file']
      }
    }
  ]
}

/**
 * Handle tool calls
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
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

      case 'vaulter_sync':
        return await handleSyncCall(client, config, project, environment, service, args)

      case 'vaulter_pull':
        return await handlePullCall(client, config, project, environment, service, args)

      case 'vaulter_push':
        return await handlePushCall(client, config, project, environment, service, args)

      case 'vaulter_compare':
        return await handleCompareCall(client, project, service, args)

      case 'vaulter_search':
        return await handleSearchCall(client, project, service, args, config)

      case 'vaulter_k8s_secret':
        return await handleK8sSecretCall(client, config, project, environment, service, args)

      case 'vaulter_k8s_configmap':
        return await handleK8sConfigMapCall(client, config, project, environment, service, args)

      case 'vaulter_helm_values':
        return await handleHelmValuesCall(client, config, project, environment, service, args)

      case 'vaulter_tf_vars':
        return await handleTfVarsCall(client, config, project, environment, service, args)

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
    }
  } finally {
    await client.disconnect()
  }
}

// === HANDLER IMPLEMENTATIONS ===

async function handleGetCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const key = args.key as string
  const envVar = await client.get(key, project, environment, service)
  return {
    content: [{
      type: 'text',
      text: envVar !== null ? envVar.value : `Variable ${key} not found in ${project}/${environment}`
    }]
  }
}

async function handleSetCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const key = args.key as string
  const value = args.value as string
  const tags = args.tags as string[] | undefined

  await client.set({
    key,
    value,
    project,
    environment,
    service,
    tags,
    metadata: { source: 'manual' }
  })

  return {
    content: [{
      type: 'text',
      text: `✓ Set ${key} in ${project}/${environment}${service ? `/${service}` : ''}`
    }]
  }
}

async function handleDeleteCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const key = args.key as string
  const deleted = await client.delete(key, project, environment, service)
  return {
    content: [{
      type: 'text',
      text: deleted ? `✓ Deleted ${key} from ${project}/${environment}` : `Variable ${key} not found`
    }]
  }
}

async function handleListCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const showValues = args.showValues as boolean || false
  const filter = args.filter as string | undefined
  const vars = await client.list({ project, environment, service })

  if (vars.length === 0) {
    return { content: [{ type: 'text', text: `No variables found for ${project}/${environment}` }] }
  }

  // Apply filter if provided
  let filtered = vars
  if (filter) {
    const regex = new RegExp('^' + filter.replace(/\*/g, '.*') + '$', 'i')
    filtered = vars.filter(v => regex.test(v.key))
  }

  const lines = filtered.map(v => showValues ? `${v.key}=${v.value}` : v.key)
  const header = `Variables in ${project}/${environment}${filter ? ` (filter: ${filter})` : ''}:`

  return {
    content: [{
      type: 'text',
      text: `${header}\n${lines.join('\n')}\n\nTotal: ${filtered.length} variable(s)`
    }]
  }
}

async function handleExportCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const format = (args.format as string) || 'shell'
  const vars = await client.export(project, environment, service)

  let output: string
  switch (format) {
    case 'json':
      output = JSON.stringify(vars, null, 2)
      break
    case 'yaml':
      output = Object.entries(vars)
        .map(([k, v]) => `${k}: "${v.replace(/"/g, '\\"')}"`)
        .join('\n')
      break
    case 'env':
      output = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
      break
    case 'tfvars':
      output = Object.entries(vars)
        .map(([k, v]) => `${k.toLowerCase()} = "${v.replace(/"/g, '\\"')}"`)
        .join('\n')
      break
    case 'docker-args':
      output = Object.entries(vars)
        .map(([k, v]) => `-e ${k}="${v.replace(/"/g, '\\"')}"`)
        .join(' ')
      break
    case 'shell':
    default:
      output = Object.entries(vars)
        .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
        .join('\n')
  }

  return { content: [{ type: 'text', text: output || '# No variables found' }] }
}

async function handleSyncCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const dryRun = args.dryRun as boolean || false

  const configDir = findConfigDir()
  if (!configDir) {
    return { content: [{ type: 'text', text: 'Error: No .vaulter directory found' }] }
  }

  const envFilePath = config
    ? getEnvFilePathForConfig(config, configDir, environment)
    : getEnvFilePath(configDir, environment)

  if (!fs.existsSync(envFilePath)) {
    return { content: [{ type: 'text', text: `Error: Environment file not found: ${envFilePath}` }] }
  }

  const localVars = parseEnvFile(envFilePath)

  if (dryRun) {
    const remoteVars = await client.export(project, environment, service)
    const toAdd: string[] = []
    const toUpdate: string[] = []

    for (const [key, value] of Object.entries(localVars)) {
      if (!(key in remoteVars)) {
        toAdd.push(key)
      } else if (remoteVars[key] !== value) {
        toUpdate.push(key)
      }
    }

    const lines = ['Dry run - changes that would be made:']
    if (toAdd.length > 0) lines.push(`  Add: ${toAdd.join(', ')}`)
    if (toUpdate.length > 0) lines.push(`  Update: ${toUpdate.join(', ')}`)
    if (toAdd.length === 0 && toUpdate.length === 0) {
      lines.push('  No changes needed')
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  const result = await client.sync(localVars, project, environment, service, { source: 'sync' })

  const lines = [`✓ Synced ${project}/${environment}`]
  if (result.added.length > 0) lines.push(`  Added: ${result.added.length}`)
  if (result.updated.length > 0) lines.push(`  Updated: ${result.updated.length}`)
  if (result.deleted.length > 0) lines.push(`  Deleted: ${result.deleted.length}`)
  if (result.unchanged.length > 0) lines.push(`  Unchanged: ${result.unchanged.length}`)

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

async function handlePullCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const configDir = findConfigDir()
  if (!configDir) {
    return { content: [{ type: 'text', text: 'Error: No .vaulter directory found' }] }
  }

  const outputPath = (args.output as string) || (config
    ? getEnvFilePathForConfig(config, configDir, environment)
    : getEnvFilePath(configDir, environment))

  const vars = await client.export(project, environment, service)
  const content = serializeEnv(vars)

  // Ensure directory exists
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, content + '\n')

  return {
    content: [{
      type: 'text',
      text: `✓ Pulled ${Object.keys(vars).length} variables to ${outputPath}`
    }]
  }
}

async function handlePushCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const configDir = findConfigDir()
  if (!configDir) {
    return { content: [{ type: 'text', text: 'Error: No .vaulter directory found' }] }
  }

  const inputPath = (args.file as string) || (config
    ? getEnvFilePathForConfig(config, configDir, environment)
    : getEnvFilePath(configDir, environment))

  if (!fs.existsSync(inputPath)) {
    return { content: [{ type: 'text', text: `Error: File not found: ${inputPath}` }] }
  }

  const localVars = parseEnvFile(inputPath)
  const result = await client.sync(localVars, project, environment, service, { source: 'sync' })

  return {
    content: [{
      type: 'text',
      text: `✓ Pushed ${Object.keys(localVars).length} variables from ${inputPath}\n  Added: ${result.added.length}, Updated: ${result.updated.length}`
    }]
  }
}

async function handleCompareCall(
  client: VaulterClient,
  project: string,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const source = args.source as Environment
  const target = args.target as Environment
  const showValues = args.showValues as boolean || false

  const [sourceVars, targetVars] = await Promise.all([
    client.export(project, source, service),
    client.export(project, target, service)
  ])

  const sourceKeys = new Set(Object.keys(sourceVars))
  const targetKeys = new Set(Object.keys(targetVars))

  const onlyInSource: string[] = []
  const onlyInTarget: string[] = []
  const different: string[] = []
  const same: string[] = []

  for (const key of sourceKeys) {
    if (!targetKeys.has(key)) {
      onlyInSource.push(key)
    } else if (sourceVars[key] !== targetVars[key]) {
      different.push(key)
    } else {
      same.push(key)
    }
  }

  for (const key of targetKeys) {
    if (!sourceKeys.has(key)) {
      onlyInTarget.push(key)
    }
  }

  const lines = [`Comparing ${project}: ${source} → ${target}\n`]

  if (onlyInSource.length > 0) {
    lines.push(`Only in ${source} (${onlyInSource.length}):`)
    for (const key of onlyInSource) {
      lines.push(showValues ? `  - ${key}=${sourceVars[key]}` : `  - ${key}`)
    }
    lines.push('')
  }

  if (onlyInTarget.length > 0) {
    lines.push(`Only in ${target} (${onlyInTarget.length}):`)
    for (const key of onlyInTarget) {
      lines.push(showValues ? `  + ${key}=${targetVars[key]}` : `  + ${key}`)
    }
    lines.push('')
  }

  if (different.length > 0) {
    lines.push(`Different values (${different.length}):`)
    for (const key of different) {
      if (showValues) {
        lines.push(`  ~ ${key}:`)
        lines.push(`      ${source}: ${sourceVars[key]}`)
        lines.push(`      ${target}: ${targetVars[key]}`)
      } else {
        lines.push(`  ~ ${key}`)
      }
    }
    lines.push('')
  }

  lines.push(`Summary: ${same.length} identical, ${different.length} different, ${onlyInSource.length} only in ${source}, ${onlyInTarget.length} only in ${target}`)

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

async function handleSearchCall(
  client: VaulterClient,
  project: string,
  service: string | undefined,
  args: Record<string, unknown>,
  config: VaulterConfig | null
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const pattern = args.pattern as string
  // Use args.environments, config environments, or default
  const environments = (args.environments as string[]) || (config ? getValidEnvironments(config) : DEFAULT_ENVIRONMENTS)

  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i')
  const results: Array<{ env: string; key: string; found: boolean }> = []

  for (const env of environments) {
    try {
      const vars = await client.list({ project, environment: env, service })
      for (const v of vars) {
        if (regex.test(v.key)) {
          results.push({ env, key: v.key, found: true })
        }
      }
    } catch {
      // Environment might not exist
    }
  }

  if (results.length === 0) {
    return { content: [{ type: 'text', text: `No variables matching "${pattern}" found in any environment` }] }
  }

  // Group by key
  const byKey = new Map<string, string[]>()
  for (const r of results) {
    const envs = byKey.get(r.key) || []
    envs.push(r.env)
    byKey.set(r.key, envs)
  }

  const lines = [`Search results for "${pattern}":\n`]
  for (const [key, envs] of byKey) {
    lines.push(`  ${key}: [${envs.join(', ')}]`)
  }
  lines.push(`\nFound ${byKey.size} unique variable(s) across ${environments.length} environment(s)`)

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

async function handleScanCall(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const scanPath = (args.path as string) || process.cwd()
  const format = (args.format as string) || 'text'

  try {
    const result = await scanMonorepo(scanPath)

    if (format === 'json') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            monorepo: {
              tool: result.monorepo.tool,
              root: result.monorepo.root,
              configFile: result.monorepo.configFile,
              workspacePatterns: result.monorepo.workspacePatterns
            },
            summary: {
              total: result.packages.length,
              initialized: result.initialized.length,
              uninitialized: result.uninitialized.length,
              withEnvFiles: result.withEnvFiles.length
            },
            packages: result.packages.map(p => ({
              name: p.name,
              path: p.relativePath,
              type: p.type,
              hasVaulterConfig: p.hasVaulterConfig,
              hasEnvFiles: p.hasEnvFiles,
              hasDeployDir: p.hasDeployDir
            }))
          }, null, 2)
        }]
      }
    }

    // Text format
    return { content: [{ type: 'text', text: formatScanResult(result) }] }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error scanning monorepo: ${(error as Error).message}`
      }]
    }
  }
}

async function handleServicesCall(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const detailed = args.detailed as boolean || false

  try {
    const services = await discoverServices()

    if (services.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No services found. Run from a monorepo root with .vaulter directories in subdirectories.'
        }]
      }
    }

    const lines = [`Discovered ${services.length} service(s):\n`]

    for (const svc of services) {
      if (detailed) {
        lines.push(`${svc.name}:`)
        lines.push(`  Path: ${svc.path}`)
        lines.push(`  Project: ${svc.config.project || '(inherit)'}`)
        if (svc.config.environments) {
          lines.push(`  Environments: ${svc.config.environments.join(', ')}`)
        }
        lines.push('')
      } else {
        lines.push(`  - ${svc.name}`)
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error discovering services: ${(error as Error).message}`
      }]
    }
  }
}

async function handleInitCall(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const project = args.project as string
  const service = args.service as string | undefined
  const backend = args.backend as string | undefined
  const mode = (args.mode as 'unified' | 'split') || 'unified'
  const environments = (args.environments as string[]) || ['dev', 'stg', 'prd']

  if (!project) {
    return { content: [{ type: 'text', text: 'Error: project name is required' }] }
  }

  const configDir = '.vaulter'
  const configPath = path.join(configDir, 'config.yaml')

  if (fs.existsSync(configPath)) {
    return { content: [{ type: 'text', text: `Error: ${configPath} already exists. Delete it first to reinitialize.` }] }
  }

  // Build config object
  const config: Record<string, unknown> = {
    version: '1',
    project,
    default_environment: 'dev',
    environments
  }

  if (service) {
    config.service = service
  }

  if (backend) {
    config.backend = { url: backend }
  } else {
    config.backend = { url: `file://${os.homedir()}/.vaulter/store` }
  }

  if (mode === 'split') {
    config.directories = {
      mode: 'split',
      configs: 'deploy/configs',
      secrets: 'deploy/secrets'
    }
  }

  // Create directories
  fs.mkdirSync(configDir, { recursive: true })

  if (mode === 'unified') {
    fs.mkdirSync(path.join(configDir, 'environments'), { recursive: true })
  } else {
    fs.mkdirSync('deploy/configs', { recursive: true })
    fs.mkdirSync('deploy/secrets', { recursive: true })
  }

  // Write config
  const yamlContent = YAML.stringify(config)
  fs.writeFileSync(configPath, yamlContent)

  // Create empty env files
  for (const env of environments) {
    if (mode === 'unified') {
      const envPath = path.join(configDir, 'environments', `${env}.env`)
      fs.writeFileSync(envPath, `# ${project} - ${env} environment\n`)
    } else {
      const configsPath = path.join('deploy/configs', `${env}.env`)
      const secretsPath = path.join('deploy/secrets', `${env}.env`)
      fs.writeFileSync(configsPath, `# ${project} - ${env} configs\n`)
      fs.writeFileSync(secretsPath, `# ${project} - ${env} secrets\n`)
    }
  }

  const lines = [
    `✓ Initialized vaulter project: ${project}`,
    `  Mode: ${mode}`,
    `  Config: ${configPath}`,
    `  Environments: ${environments.join(', ')}`
  ]

  if (mode === 'split') {
    lines.push('  Configs: deploy/configs/')
    lines.push('  Secrets: deploy/secrets/')
  } else {
    lines.push(`  Env files: ${configDir}/environments/`)
  }

  lines.push('\nNext steps:')
  lines.push('  1. Configure your backend URL in .vaulter/config.yaml')
  lines.push('  2. Generate an encryption key: vaulter key generate')
  lines.push('  3. Add variables: vaulter set KEY=value -e dev')

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

async function handleK8sSecretCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const namespace = (args.namespace as string) || `${project}-${environment}`
  const name = (args.name as string) || (service ? `${service}-secrets` : `${project}-secrets`)

  let vars: Record<string, string>

  // Check for split mode - read from local file
  if (config && isSplitMode(config)) {
    const configDir = findConfigDir()
    if (configDir) {
      const secretsPath = getSecretsFilePath(config, configDir, environment)
      if (fs.existsSync(secretsPath)) {
        vars = parseEnvFile(secretsPath)
      } else {
        return { content: [{ type: 'text', text: `Error: Secrets file not found: ${secretsPath}` }] }
      }
    } else {
      return { content: [{ type: 'text', text: 'Error: No .vaulter directory found' }] }
    }
  } else {
    // Fetch from backend
    vars = await client.export(project, environment, service)
  }

  if (Object.keys(vars).length === 0) {
    return { content: [{ type: 'text', text: 'Warning: No variables found' }] }
  }

  // Generate YAML
  const lines = [
    '# Generated by vaulter MCP',
    '# kubectl apply -f - <<< "$(vaulter_k8s_secret)"',
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    `  name: ${sanitizeK8sName(name)}`,
    `  namespace: ${sanitizeK8sName(namespace)}`,
    '  labels:',
    `    app.kubernetes.io/managed-by: vaulter`,
    `    app.kubernetes.io/environment: ${environment}`,
    'type: Opaque',
    'data:'
  ]

  for (const [key, value] of Object.entries(vars)) {
    lines.push(`  ${key}: ${base64Encode(value)}`)
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

async function handleK8sConfigMapCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const namespace = (args.namespace as string) || `${project}-${environment}`
  const name = (args.name as string) || (service ? `${service}-config` : `${project}-config`)

  let vars: Record<string, string>

  // Check for split mode - read from local file
  if (config && isSplitMode(config)) {
    const configDir = findConfigDir()
    if (configDir) {
      const configsPath = getConfigsFilePath(config, configDir, environment)
      if (fs.existsSync(configsPath)) {
        vars = parseEnvFile(configsPath)
      } else {
        return { content: [{ type: 'text', text: `Error: Configs file not found: ${configsPath}` }] }
      }
    } else {
      return { content: [{ type: 'text', text: 'Error: No .vaulter directory found' }] }
    }
  } else {
    // Fetch from backend and filter out secrets
    const allVars = await client.export(project, environment, service)
    const patterns = getSecretPatterns(config)
    const { plain } = splitVarsBySecret(allVars, patterns)
    vars = plain
  }

  if (Object.keys(vars).length === 0) {
    return { content: [{ type: 'text', text: 'Warning: No config variables found (all matched secret patterns)' }] }
  }

  // Generate YAML
  const lines = [
    '# Generated by vaulter MCP',
    '# kubectl apply -f - <<< "$(vaulter_k8s_configmap)"',
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    `  name: ${sanitizeK8sName(name)}`,
    `  namespace: ${sanitizeK8sName(namespace)}`,
    '  labels:',
    `    app.kubernetes.io/managed-by: vaulter`,
    `    app.kubernetes.io/environment: ${environment}`,
    'data:'
  ]

  for (const [key, value] of Object.entries(vars)) {
    const needsQuote = value.includes(':') || value.includes('#') || value.includes('\n')
    if (needsQuote) {
      lines.push(`  ${key}: "${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
    } else {
      lines.push(`  ${key}: ${value}`)
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

// === HELM & TERRAFORM HANDLERS ===

/**
 * Format value for YAML
 */
function formatYamlValue(value: string): string {
  const needsQuote =
    value === '' ||
    value === 'true' ||
    value === 'false' ||
    value === 'null' ||
    value === 'yes' ||
    value === 'no' ||
    !isNaN(Number(value)) ||
    value.includes(':') ||
    value.includes('#') ||
    value.includes('\n') ||
    value.includes('"') ||
    value.includes("'") ||
    value.startsWith(' ') ||
    value.endsWith(' ') ||
    value.startsWith('{') ||
    value.startsWith('[')

  if (needsQuote) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
  }

  return value
}

/**
 * Format value for Terraform HCL
 */
function formatTfValue(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')

  return `"${escaped}"`
}

/**
 * Handle Helm values generation
 */
async function handleHelmValuesCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  _args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const vars = await client.export(project, environment, service)

  if (Object.keys(vars).length === 0) {
    return { content: [{ type: 'text', text: 'Warning: No variables found' }] }
  }

  const patterns = getSecretPatterns(config)
  const { plain, secrets } = splitVarsBySecret(vars, patterns)

  // Generate Helm values YAML
  const lines: string[] = [
    '# Generated by vaulter MCP',
    `# Project: ${project}`,
    `# Environment: ${environment}`,
    service ? `# Service: ${service}` : null,
    '# DO NOT EDIT - changes will be overwritten',
    '',
    '# Environment variables (plain)',
    'env:'
  ].filter(Boolean) as string[]

  for (const [key, value] of Object.entries(plain)) {
    lines.push(`  ${key}: ${formatYamlValue(value)}`)
  }

  lines.push('')
  lines.push('# Secrets (matching patterns, for use with secretKeyRef)')
  lines.push('secrets:')

  for (const [key, value] of Object.entries(secrets)) {
    lines.push(`  ${key}: ${formatYamlValue(value)}`)
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Handle Terraform vars generation
 */
async function handleTfVarsCall(
  client: VaulterClient,
  _config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const format = (args.format as string) || 'tfvars'
  const vars = await client.export(project, environment, service)

  if (Object.keys(vars).length === 0) {
    return { content: [{ type: 'text', text: 'Warning: No variables found' }] }
  }

  if (format === 'json') {
    // Terraform JSON format
    const tfVars: Record<string, string> = {}
    for (const [key, value] of Object.entries(vars)) {
      const tfKey = key.toLowerCase()
      tfVars[tfKey] = value
    }

    const output = {
      ...tfVars,
      env_vars: vars
    }

    return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] }
  }

  // Generate .tfvars content
  const lines: string[] = [
    '# Generated by vaulter MCP',
    `# Project: ${project}`,
    `# Environment: ${environment}`,
    service ? `# Service: ${service}` : null,
    '# DO NOT EDIT - changes will be overwritten',
    ''
  ].filter(Boolean) as string[]

  // Individual variables (lowercase names)
  for (const [key, value] of Object.entries(vars)) {
    const tfKey = key.toLowerCase()
    lines.push(`${tfKey} = ${formatTfValue(value)}`)
  }

  // All env vars as a map
  lines.push('')
  lines.push('# All environment variables as a map')
  lines.push('env_vars = {')

  for (const [key, value] of Object.entries(vars)) {
    lines.push(`  "${key}" = ${formatTfValue(value)}`)
  }

  lines.push('}')

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

// === KEY MANAGEMENT HANDLERS ===

/**
 * Get project name for key operations
 */
function getKeyProjectName(args: Record<string, unknown>, config: VaulterConfig | null): string {
  return (args.project as string) || config?.project || 'default'
}

/**
 * Handle key generate
 */
async function handleKeyGenerateCall(
  args: Record<string, unknown>,
  config: VaulterConfig | null
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const keyName = args.name as string
  const isGlobal = args.global as boolean || false
  const isAsymmetric = args.asymmetric as boolean || false
  const algorithm = (args.algorithm as AsymmetricAlgorithm) || 'rsa-4096'
  const force = args.force as boolean || false
  const projectName = getKeyProjectName(args, config)

  if (!keyName) {
    return { content: [{ type: 'text', text: 'Error: name is required' }] }
  }

  // Validate algorithm if asymmetric
  const validAlgorithms: AsymmetricAlgorithm[] = ['rsa-4096', 'rsa-2048', 'ec-p256', 'ec-p384']
  if (isAsymmetric && !validAlgorithms.includes(algorithm)) {
    return { content: [{ type: 'text', text: `Error: Invalid algorithm: ${algorithm}. Valid: ${validAlgorithms.join(', ')}` }] }
  }

  const fullKeyName = isGlobal ? `global:${keyName}` : keyName

  // Check if key already exists
  const existing = keyExists(fullKeyName, projectName)
  if (existing.exists && !force) {
    return { content: [{ type: 'text', text: `Error: Key '${keyName}' already exists${isGlobal ? ' (global)' : ''}. Use force=true to overwrite` }] }
  }

  if (isAsymmetric) {
    // Generate asymmetric key pair
    const paths = resolveKeyPaths(fullKeyName, projectName)
    const keyPair = generateKeyPair(algorithm)

    // Ensure directory exists
    const dir = path.dirname(paths.privateKey)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Write keys
    fs.writeFileSync(paths.privateKey, keyPair.privateKey, { mode: 0o600 })
    fs.writeFileSync(paths.publicKey, keyPair.publicKey, { mode: 0o644 })

    const { scope, name } = parseKeyName(fullKeyName)
    return {
      content: [{
        type: 'text',
        text: [
          `✓ Generated ${algorithm} key pair: ${name}${scope === 'global' ? ' (global)' : ''}`,
          `  Private: ${paths.privateKey}`,
          `  Public:  ${paths.publicKey}`,
          '',
          'To use in config.yaml:',
          '  encryption:',
          '    mode: asymmetric',
          '    asymmetric:',
          `      algorithm: ${algorithm}`,
          `      key_name: ${fullKeyName}`
        ].join('\n')
      }]
    }
  } else {
    // Generate symmetric key
    const keyPath = resolveKeyPath(fullKeyName, projectName, false)
    const key = generatePassphrase(32)

    // Ensure directory exists
    const dir = path.dirname(keyPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Write key
    fs.writeFileSync(keyPath, key + '\n', { mode: 0o600 })

    const { scope, name } = parseKeyName(fullKeyName)
    return {
      content: [{
        type: 'text',
        text: [
          `✓ Generated symmetric key: ${name}${scope === 'global' ? ' (global)' : ''}`,
          `  Path: ${keyPath}`,
          '',
          'To use in config.yaml:',
          '  encryption:',
          '    mode: symmetric',
          '    key_source:',
          `      - file: ${keyPath}`
        ].join('\n')
      }]
    }
  }
}

/**
 * Handle key list
 */
async function handleKeyListCall(
  args: Record<string, unknown>,
  config: VaulterConfig | null
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const projectName = getKeyProjectName(args, config)
  const projectKeysDir = getProjectKeysDir(projectName)
  const globalKeysDir = getGlobalKeysDir()

  const keys: Array<{
    name: string
    scope: 'project' | 'global'
    type: 'symmetric' | 'asymmetric'
    algorithm?: string
    hasPrivateKey: boolean
    hasPublicKey: boolean
  }> = []

  // List project keys
  if (fs.existsSync(projectKeysDir)) {
    const files = fs.readdirSync(projectKeysDir)
    const keyNames = new Set<string>()

    for (const file of files) {
      const name = file.replace(/\.pub$/, '')
      keyNames.add(name)
    }

    for (const name of keyNames) {
      const pubPath = path.join(projectKeysDir, name + '.pub')
      const privPath = path.join(projectKeysDir, name)
      const hasPublicKey = fs.existsSync(pubPath)
      const hasPrivateKey = fs.existsSync(privPath) && !privPath.endsWith('.pub')

      let type: 'symmetric' | 'asymmetric' = 'symmetric'
      let algorithm: string | undefined

      if (hasPublicKey) {
        type = 'asymmetric'
        const content = fs.readFileSync(pubPath, 'utf-8')
        algorithm = detectAlgorithm(content) || undefined
      } else if (hasPrivateKey) {
        const content = fs.readFileSync(privPath, 'utf-8')
        if (content.includes('BEGIN') && content.includes('KEY')) {
          type = 'asymmetric'
          algorithm = detectAlgorithm(content) || undefined
        }
      }

      keys.push({
        name,
        scope: 'project',
        type,
        algorithm,
        hasPrivateKey: fs.existsSync(privPath) && fs.statSync(privPath).isFile(),
        hasPublicKey
      })
    }
  }

  // List global keys
  if (fs.existsSync(globalKeysDir)) {
    const files = fs.readdirSync(globalKeysDir)
    const keyNames = new Set<string>()

    for (const file of files) {
      const name = file.replace(/\.pub$/, '')
      keyNames.add(name)
    }

    for (const name of keyNames) {
      const pubPath = path.join(globalKeysDir, name + '.pub')
      const privPath = path.join(globalKeysDir, name)
      const hasPublicKey = fs.existsSync(pubPath)
      const hasPrivateKey = fs.existsSync(privPath) && !privPath.endsWith('.pub')

      let type: 'symmetric' | 'asymmetric' = 'symmetric'
      let algorithm: string | undefined

      if (hasPublicKey) {
        type = 'asymmetric'
        const content = fs.readFileSync(pubPath, 'utf-8')
        algorithm = detectAlgorithm(content) || undefined
      } else if (hasPrivateKey) {
        const content = fs.readFileSync(privPath, 'utf-8')
        if (content.includes('BEGIN') && content.includes('KEY')) {
          type = 'asymmetric'
          algorithm = detectAlgorithm(content) || undefined
        }
      }

      keys.push({
        name,
        scope: 'global',
        type,
        algorithm,
        hasPrivateKey: fs.existsSync(privPath) && fs.statSync(privPath).isFile(),
        hasPublicKey
      })
    }
  }

  const lines = [
    `Keys for project: ${projectName}`,
    `  Project keys: ${projectKeysDir}`,
    `  Global keys:  ${globalKeysDir}`,
    ''
  ]

  if (keys.length === 0) {
    lines.push('No keys found')
    lines.push('')
    lines.push('Generate a new key:')
    lines.push('  vaulter_key_generate({ name: "master", asymmetric: true })')
  } else {
    for (const key of keys) {
      const scopeLabel = key.scope === 'global' ? ' (global)' : ''
      const typeLabel = key.type === 'asymmetric' ? ` [${key.algorithm || 'asymmetric'}]` : ' [symmetric]'
      const privLabel = key.hasPrivateKey ? '✓' : '✗'
      const pubLabel = key.hasPublicKey ? '✓' : '✗'
      lines.push(`  ${key.name}${scopeLabel}${typeLabel}`)
      lines.push(`    Private: ${privLabel}  Public: ${pubLabel}`)
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Handle key show
 */
async function handleKeyShowCall(
  args: Record<string, unknown>,
  config: VaulterConfig | null
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const keyName = args.name as string
  const isGlobal = args.global as boolean || false
  const projectName = getKeyProjectName(args, config)

  if (!keyName) {
    return { content: [{ type: 'text', text: 'Error: name is required' }] }
  }

  const fullKeyName = isGlobal ? `global:${keyName}` : keyName
  const paths = resolveKeyPaths(fullKeyName, projectName)
  const existing = keyExists(fullKeyName, projectName)

  if (!existing.exists) {
    return { content: [{ type: 'text', text: `Error: Key '${keyName}' not found${isGlobal ? ' (global)' : ''}` }] }
  }

  let algorithm: string | null = null
  if (existing.publicKey) {
    const content = fs.readFileSync(paths.publicKey, 'utf-8')
    algorithm = detectAlgorithm(content)
  } else if (existing.privateKey) {
    const content = fs.readFileSync(paths.privateKey, 'utf-8')
    algorithm = detectAlgorithm(content)
  }

  const { scope, name } = parseKeyName(fullKeyName)
  const lines = [
    `Key: ${name}${scope === 'global' ? ' (global)' : ''}`,
    `  Algorithm: ${algorithm || 'symmetric'}`,
    `  Private key: ${existing.privateKey ? paths.privateKey : '(not found)'}`,
    `  Public key:  ${existing.publicKey ? paths.publicKey : '(not found)'}`
  ]

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Handle key export
 */
async function handleKeyExportCall(
  args: Record<string, unknown>,
  config: VaulterConfig | null
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const keyName = args.name as string
  const outputPath = args.output as string
  const isGlobal = args.global as boolean || false
  const projectName = getKeyProjectName(args, config)

  if (!keyName) {
    return { content: [{ type: 'text', text: 'Error: name is required' }] }
  }

  if (!outputPath) {
    return { content: [{ type: 'text', text: 'Error: output path is required' }] }
  }

  const fullKeyName = isGlobal ? `global:${keyName}` : keyName
  const paths = resolveKeyPaths(fullKeyName, projectName)
  const existing = keyExists(fullKeyName, projectName)

  if (!existing.exists) {
    return { content: [{ type: 'text', text: `Error: Key '${keyName}' not found${isGlobal ? ' (global)' : ''}` }] }
  }

  // Read keys
  const bundle: {
    version: number
    keyName: string
    projectName: string
    algorithm?: string
    publicKey?: string
    privateKey?: string
    createdAt: string
  } = {
    version: 1,
    keyName: fullKeyName,
    projectName,
    createdAt: new Date().toISOString()
  }

  if (existing.publicKey) {
    const content = fs.readFileSync(paths.publicKey, 'utf-8')
    bundle.publicKey = content
    const alg = detectAlgorithm(content)
    if (alg) bundle.algorithm = alg
  }

  if (existing.privateKey) {
    const content = fs.readFileSync(paths.privateKey, 'utf-8')
    bundle.privateKey = content
    if (!bundle.algorithm) {
      const alg = detectAlgorithm(content)
      if (alg) bundle.algorithm = alg
    }
  }

  // Encrypt bundle
  const passphrase = process.env.VAULTER_EXPORT_PASSPHRASE || 'vaulter-export-key'
  const plaintext = JSON.stringify(bundle)
  const salt = crypto.randomBytes(16)
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Package: salt (16) + iv (12) + authTag (16) + encrypted
  const output = Buffer.concat([salt, iv, authTag, encrypted])

  // Write to file
  const absPath = path.resolve(outputPath)
  fs.writeFileSync(absPath, output)

  return {
    content: [{
      type: 'text',
      text: [
        `✓ Exported key '${keyName}' to ${absPath}`,
        '',
        'To import on another machine:',
        `  vaulter_key_import({ file: "${outputPath}" })`,
        '',
        process.env.VAULTER_EXPORT_PASSPHRASE
          ? 'Note: Set VAULTER_EXPORT_PASSPHRASE to the same value when importing'
          : 'Note: Using default passphrase. Set VAULTER_EXPORT_PASSPHRASE for better security'
      ].join('\n')
    }]
  }
}

/**
 * Handle key import
 */
async function handleKeyImportCall(
  args: Record<string, unknown>,
  config: VaulterConfig | null
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const inputPath = args.file as string
  const targetName = args.name as string | undefined
  const isGlobal = args.global as boolean || false
  const force = args.force as boolean || false
  const projectName = getKeyProjectName(args, config)

  if (!inputPath) {
    return { content: [{ type: 'text', text: 'Error: file path is required' }] }
  }

  const absPath = path.resolve(inputPath)
  if (!fs.existsSync(absPath)) {
    return { content: [{ type: 'text', text: `Error: File not found: ${absPath}` }] }
  }

  // Read and decrypt bundle
  const input = fs.readFileSync(absPath)

  // Extract: salt (16) + iv (12) + authTag (16) + encrypted
  const salt = input.subarray(0, 16)
  const iv = input.subarray(16, 28)
  const authTag = input.subarray(28, 44)
  const encrypted = input.subarray(44)

  const passphrase = process.env.VAULTER_EXPORT_PASSPHRASE || 'vaulter-export-key'
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256')

  let bundle: {
    version: number
    keyName: string
    projectName: string
    algorithm?: string
    publicKey?: string
    privateKey?: string
    createdAt: string
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    bundle = JSON.parse(decrypted.toString('utf8'))
  } catch {
    return { content: [{ type: 'text', text: 'Error: Failed to decrypt bundle. Check VAULTER_EXPORT_PASSPHRASE' }] }
  }

  // Determine target key name
  let fullKeyName = targetName || parseKeyName(bundle.keyName).name
  if (isGlobal) {
    fullKeyName = `global:${fullKeyName}`
  }

  const paths = resolveKeyPaths(fullKeyName, projectName)

  // Check if keys already exist
  const existing = keyExists(fullKeyName, projectName)
  if (existing.exists && !force) {
    return { content: [{ type: 'text', text: `Error: Key '${fullKeyName}' already exists. Use force=true to overwrite` }] }
  }

  // Ensure directory exists
  const dir = path.dirname(paths.privateKey)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Write keys
  if (bundle.privateKey) {
    fs.writeFileSync(paths.privateKey, bundle.privateKey, { mode: 0o600 })
  }
  if (bundle.publicKey) {
    fs.writeFileSync(paths.publicKey, bundle.publicKey, { mode: 0o644 })
  }

  const { scope, name } = parseKeyName(fullKeyName)
  const lines = [
    `✓ Imported key: ${name}${scope === 'global' ? ' (global)' : ''}`
  ]
  if (bundle.privateKey) {
    lines.push(`  Private: ${paths.privateKey}`)
  }
  if (bundle.publicKey) {
    lines.push(`  Public:  ${paths.publicKey}`)
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}
