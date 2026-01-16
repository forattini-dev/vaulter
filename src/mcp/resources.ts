/**
 * Vaulter MCP Resources
 *
 * Resource definitions and handlers for the MCP server
 *
 * Resources:
 *   vaulter://config               → Current project configuration
 *   vaulter://services             → List of services in monorepo
 *   vaulter://project/env          → Environment variables for project/env
 *   vaulter://project/env/service  → Environment variables for service
 *   vaulter://compare/env1/env2    → Comparison between two environments
 */

import type { Resource } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import { VaulterClient } from '../client.js'
import { loadConfig, loadEncryptionKey, findConfigDir } from '../lib/config-loader.js'
import type { Environment, VaulterConfig } from '../types.js'
import { resolveBackendUrls } from '../index.js'

const ENVIRONMENTS: Environment[] = ['dev', 'stg', 'prd', 'sbx', 'dr']

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
 * Parse a vaulter:// URI
 *
 * Formats:
 *   vaulter://config
 *   vaulter://services
 *   vaulter://project/environment
 *   vaulter://project/environment/service
 *   vaulter://compare/env1/env2
 */
type ParsedUri =
  | { type: 'config' }
  | { type: 'services' }
  | { type: 'env'; project: string; environment: Environment; service?: string }
  | { type: 'compare'; env1: Environment; env2: Environment }
  | null

function parseResourceUri(uri: string): ParsedUri {
  // vaulter://config
  if (uri === 'vaulter://config') {
    return { type: 'config' }
  }

  // vaulter://services
  if (uri === 'vaulter://services') {
    return { type: 'services' }
  }

  // vaulter://compare/env1/env2
  const compareMatch = uri.match(/^vaulter:\/\/compare\/([^/]+)\/([^/]+)$/)
  if (compareMatch) {
    const [, env1, env2] = compareMatch
    if (ENVIRONMENTS.includes(env1 as Environment) && ENVIRONMENTS.includes(env2 as Environment)) {
      return { type: 'compare', env1: env1 as Environment, env2: env2 as Environment }
    }
    return null
  }

  // vaulter://project/environment[/service]
  const envMatch = uri.match(/^vaulter:\/\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/)
  if (envMatch) {
    const [, project, env, service] = envMatch
    if (ENVIRONMENTS.includes(env as Environment)) {
      return {
        type: 'env',
        project,
        environment: env as Environment,
        service
      }
    }
  }

  return null
}

/**
 * Discover services in a monorepo
 * Looks for directories with .vaulter/config.yaml or deploy/configs or deploy/secrets
 */
function discoverServices(rootDir: string): Array<{ name: string; path: string; hasVaulterConfig: boolean }> {
  const services: Array<{ name: string; path: string; hasVaulterConfig: boolean }> = []

  // Common monorepo patterns
  const searchDirs = ['apps', 'services', 'packages', 'libs']

  for (const dir of searchDirs) {
    const fullPath = path.join(rootDir, dir)
    if (!fs.existsSync(fullPath)) continue

    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const servicePath = path.join(fullPath, entry.name)

        // Check for vaulter config
        const hasVaulterConfig = fs.existsSync(path.join(servicePath, '.vaulter', 'config.yaml'))

        // Check for deploy/configs or deploy/secrets (split mode pattern)
        const hasDeployConfigs = fs.existsSync(path.join(servicePath, 'deploy', 'configs'))
        const hasDeploySecrets = fs.existsSync(path.join(servicePath, 'deploy', 'secrets'))

        if (hasVaulterConfig || hasDeployConfigs || hasDeploySecrets) {
          services.push({
            name: entry.name,
            path: servicePath,
            hasVaulterConfig
          })
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return services
}

/**
 * List available resources
 * Returns resources for config, services, and each project/environment combination
 */
export async function listResources(): Promise<Resource[]> {
  const { config } = await getClientAndConfig()
  const resources: Resource[] = []

  // Always include config resource
  resources.push({
    uri: 'vaulter://config',
    name: 'Project Configuration',
    description: 'Current vaulter project configuration (from .vaulter/config.yaml)',
    mimeType: 'application/yaml'
  })

  // Always include services resource (even if empty)
  resources.push({
    uri: 'vaulter://services',
    name: 'Monorepo Services',
    description: 'List of services discovered in this monorepo',
    mimeType: 'application/json'
  })

  if (!config?.project) {
    return resources
  }

  const project = config.project
  const environments = config.environments || ENVIRONMENTS
  const service = config.service

  // Add environment resources
  for (const env of environments) {
    const uri = service
      ? `vaulter://${project}/${env}/${service}`
      : `vaulter://${project}/${env}`

    resources.push({
      uri,
      name: `${project}/${env}${service ? `/${service}` : ''}`,
      description: `Environment variables for ${project} in ${env}`,
      mimeType: 'text/plain'
    })
  }

  // Add comparison resources for common pairs
  const comparisonPairs: Array<[Environment, Environment]> = [
    ['dev', 'stg'],
    ['stg', 'prd'],
    ['dev', 'prd']
  ]

  for (const [env1, env2] of comparisonPairs) {
    if (environments.includes(env1) && environments.includes(env2)) {
      resources.push({
        uri: `vaulter://compare/${env1}/${env2}`,
        name: `Compare ${env1} vs ${env2}`,
        description: `Comparison of variables between ${env1} and ${env2} environments`,
        mimeType: 'text/plain'
      })
    }
  }

  return resources
}

/**
 * Read a resource by URI
 */
export async function handleResourceRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const parsed = parseResourceUri(uri)

  if (!parsed) {
    throw new Error(`Invalid resource URI: ${uri}. Expected format: vaulter://config, vaulter://services, vaulter://project/environment, or vaulter://compare/env1/env2`)
  }

  switch (parsed.type) {
    case 'config':
      return handleConfigRead(uri)
    case 'services':
      return handleServicesRead(uri)
    case 'compare':
      return handleCompareRead(uri, parsed.env1, parsed.env2)
    case 'env':
      return handleEnvRead(uri, parsed.project, parsed.environment, parsed.service)
  }
}

/**
 * Read config resource
 */
async function handleConfigRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const configDir = findConfigDir()

  if (!configDir) {
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: '# No .vaulter directory found\n# Run `vaulter init` to create a new project'
      }]
    }
  }

  const configPath = path.join(configDir, 'config.yaml')

  if (!fs.existsSync(configPath)) {
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: '# No config.yaml found in .vaulter directory\n# Run `vaulter init` to create a new project'
      }]
    }
  }

  const content = fs.readFileSync(configPath, 'utf-8')

  return {
    contents: [{
      uri,
      mimeType: 'application/yaml',
      text: `# Vaulter Configuration\n# Path: ${configPath}\n\n${content}`
    }]
  }
}

/**
 * Read services resource
 */
async function handleServicesRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const cwd = process.cwd()
  const services = discoverServices(cwd)

  if (services.length === 0) {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          discovered: false,
          message: 'No services found. This may not be a monorepo or services are not configured.',
          searchedDirs: ['apps', 'services', 'packages', 'libs'],
          hint: 'Services are detected by .vaulter/config.yaml or deploy/configs or deploy/secrets directories'
        }, null, 2)
      }]
    }
  }

  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        discovered: true,
        count: services.length,
        services: services.map(s => ({
          name: s.name,
          path: s.path,
          configured: s.hasVaulterConfig
        }))
      }, null, 2)
    }]
  }
}

/**
 * Read environment comparison resource
 */
async function handleCompareRead(
  uri: string,
  env1: Environment,
  env2: Environment
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const { client, config } = await getClientAndConfig()

  if (!config?.project) {
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: '# No project configured\n# Run `vaulter init` to create a new project'
      }]
    }
  }

  const project = config.project
  const service = config.service

  try {
    await client.connect()

    const [vars1, vars2] = await Promise.all([
      client.export(project, env1, service),
      client.export(project, env2, service)
    ])

    const allKeys = new Set([...Object.keys(vars1), ...Object.keys(vars2)])
    const sorted = Array.from(allKeys).sort()

    const onlyIn1: string[] = []
    const onlyIn2: string[] = []
    const different: string[] = []
    const same: string[] = []

    for (const key of sorted) {
      const v1 = vars1[key]
      const v2 = vars2[key]

      if (v1 !== undefined && v2 === undefined) {
        onlyIn1.push(key)
      } else if (v1 === undefined && v2 !== undefined) {
        onlyIn2.push(key)
      } else if (v1 !== v2) {
        different.push(key)
      } else {
        same.push(key)
      }
    }

    const lines: string[] = [
      `# Comparison: ${env1} vs ${env2}`,
      `# Project: ${project}${service ? `/${service}` : ''}`,
      '',
      `Total keys: ${allKeys.size}`,
      `  Same: ${same.length}`,
      `  Different: ${different.length}`,
      `  Only in ${env1}: ${onlyIn1.length}`,
      `  Only in ${env2}: ${onlyIn2.length}`,
      ''
    ]

    if (onlyIn1.length > 0) {
      lines.push(`## Only in ${env1}`)
      for (const key of onlyIn1) {
        lines.push(`  ${key}`)
      }
      lines.push('')
    }

    if (onlyIn2.length > 0) {
      lines.push(`## Only in ${env2}`)
      for (const key of onlyIn2) {
        lines.push(`  ${key}`)
      }
      lines.push('')
    }

    if (different.length > 0) {
      lines.push(`## Different values`)
      for (const key of different) {
        lines.push(`  ${key}:`)
        lines.push(`    ${env1}: ${maskValue(vars1[key])}`)
        lines.push(`    ${env2}: ${maskValue(vars2[key])}`)
      }
      lines.push('')
    }

    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: lines.join('\n')
      }]
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Read environment variables resource
 */
async function handleEnvRead(
  uri: string,
  project: string,
  environment: Environment,
  service?: string
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const { client } = await getClientAndConfig()

  try {
    await client.connect()

    const vars = await client.export(project, environment, service)
    const entries = Object.entries(vars)

    if (entries.length === 0) {
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: `# No variables found for ${project}/${environment}${service ? `/${service}` : ''}`
        }]
      }
    }

    // Format as .env file content
    const envContent = entries
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: `# Environment: ${project}/${environment}${service ? `/${service}` : ''}\n# Variables: ${entries.length}\n\n${envContent}`
      }]
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Mask a value for safe display (show first 3 chars + ... + last 3 chars if > 10 chars)
 */
function maskValue(value: string | undefined): string {
  if (!value) return '(undefined)'
  if (value.length <= 10) return value
  return `${value.slice(0, 3)}...${value.slice(-3)}`
}
