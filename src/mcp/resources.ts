/**
 * MiniEnv MCP Resources
 *
 * Resource definitions and handlers for the MCP server
 * Resources expose environment variables as readable content
 */

import type { Resource } from '@modelcontextprotocol/sdk/types.js'
import { MiniEnvClient } from '../client.js'
import { loadConfig, loadEncryptionKey } from '../lib/config-loader.js'
import type { Environment, MiniEnvConfig } from '../types.js'

const ENVIRONMENTS: Environment[] = ['dev', 'stg', 'prd', 'sbx', 'dr']

/**
 * Get current config and client
 */
async function getClientAndConfig(): Promise<{ client: MiniEnvClient; config: MiniEnvConfig | null }> {
  let config: MiniEnvConfig | null = null
  try {
    config = loadConfig()
  } catch {
    // Config not found is OK
  }

  const connectionString = config?.backend?.url
  const passphrase = config ? await loadEncryptionKey(config) : undefined

  const client = new MiniEnvClient({
    connectionString: connectionString || undefined,
    passphrase: passphrase || undefined
  })

  return { client, config }
}

/**
 * Parse a minienv:// URI
 * Format: minienv://project/environment
 * Example: minienv://my-app/dev
 */
function parseResourceUri(uri: string): { project: string; environment: Environment; service?: string } | null {
  const match = uri.match(/^minienv:\/\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/)
  if (!match) return null

  const [, project, env, service] = match
  if (!ENVIRONMENTS.includes(env as Environment)) return null

  return {
    project,
    environment: env as Environment,
    service
  }
}

/**
 * List available resources
 * Returns resources for each project/environment combination found in config
 */
export async function listResources(): Promise<Resource[]> {
  const { config } = await getClientAndConfig()

  if (!config?.project) {
    return []
  }

  const project = config.project
  const environments = config.environments || ENVIRONMENTS
  const service = config.service

  const resources: Resource[] = []

  for (const env of environments) {
    const uri = service
      ? `minienv://${project}/${env}/${service}`
      : `minienv://${project}/${env}`

    resources.push({
      uri,
      name: `${project}/${env}${service ? `/${service}` : ''}`,
      description: `Environment variables for ${project} in ${env}`,
      mimeType: 'text/plain'
    })
  }

  return resources
}

/**
 * Read a resource by URI
 */
export async function handleResourceRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const parsed = parseResourceUri(uri)

  if (!parsed) {
    throw new Error(`Invalid resource URI: ${uri}. Expected format: minienv://project/environment[/service]`)
  }

  const { project, environment, service } = parsed
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
          text: `# No variables found for ${project}/${environment}`
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
