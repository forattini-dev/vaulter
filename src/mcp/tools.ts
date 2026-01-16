/**
 * Vaulter MCP Tools
 *
 * Comprehensive tool definitions and handlers for the MCP server
 * Provides 14 tools for environment and secrets management
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { VaulterClient } from '../client.js'
import {
  loadConfig,
  loadEncryptionKey,
  findConfigDir,
  getEnvFilePath,
  getEnvFilePathForConfig,
  getSecretsFilePath,
  getConfigsFilePath,
  isSplitMode,
  getValidEnvironments
} from '../lib/config-loader.js'
import { parseEnvFile, serializeEnv } from '../lib/env-parser.js'
import { discoverServices } from '../lib/monorepo.js'
import { scanMonorepo, formatScanResult } from '../lib/monorepo-detect.js'
import { getSecretPatterns, splitVarsBySecret } from '../lib/secret-patterns.js'
import type { VaulterConfig, Environment } from '../types.js'
import { DEFAULT_ENVIRONMENTS } from '../types.js'
import { resolveBackendUrls } from '../index.js'
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

/**
 * Get current config and client
 */
async function getClientAndConfig(): Promise<{ client: VaulterClient; config: VaulterConfig | null }> {
  let config: VaulterConfig | null = null
  try {
    config = loadConfig()
  } catch {
    // Config not found is OK
  }

  const connectionStrings = config ? resolveBackendUrls(config) : []
  const passphrase = config ? await loadEncryptionKey(config) : undefined

  const client = new VaulterClient({
    connectionStrings: connectionStrings.length > 0 ? connectionStrings : undefined,
    passphrase: passphrase || undefined
  })

  return { client, config }
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
      description: 'Export all environment variables in various formats (shell, env, json, yaml, tfvars)',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          format: { type: 'string', description: 'Output format', enum: ['shell', 'env', 'json', 'yaml', 'tfvars'], default: 'shell' }
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
  const { client, config } = await getClientAndConfig()
  const project = (args.project as string) || config?.project || ''
  const environment = (args.environment as Environment) || config?.default_environment || 'dev'
  const service = args.service as string | undefined

  // Tools that don't need project
  if (name === 'vaulter_scan') {
    return handleScanCall(args)
  }

  if (name === 'vaulter_services') {
    return handleServicesCall(args)
  }

  if (name === 'vaulter_init') {
    return handleInitCall(args)
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
    config.backend = { url: 'file://${HOME}/.vaulter-store' }
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
