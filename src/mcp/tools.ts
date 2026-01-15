/**
 * MiniEnv MCP Tools
 *
 * Tool definitions and handlers for the MCP server
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { MiniEnvClient } from '../client.js'
import { loadConfig, loadEncryptionKey, findConfigDir, getEnvFilePath } from '../lib/config-loader.js'
import { parseEnvFile } from '../lib/env-parser.js'
import type { Environment, MiniEnvConfig } from '../types.js'
import fs from 'node:fs'

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
 * Register all available tools
 */
export function registerTools(): Tool[] {
  return [
    {
      name: 'minienv_get',
      description: 'Get the value of an environment variable',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'The name of the environment variable'
          },
          environment: {
            type: 'string',
            description: 'Environment (dev/stg/prd/sbx/dr)',
            enum: ['dev', 'stg', 'prd', 'sbx', 'dr'],
            default: 'dev'
          },
          project: {
            type: 'string',
            description: 'Project name (optional, defaults to config)'
          },
          service: {
            type: 'string',
            description: 'Service name for monorepos (optional)'
          }
        },
        required: ['key']
      }
    },
    {
      name: 'minienv_set',
      description: 'Set an environment variable value',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'The name of the environment variable'
          },
          value: {
            type: 'string',
            description: 'The value to set'
          },
          environment: {
            type: 'string',
            description: 'Environment (dev/stg/prd/sbx/dr)',
            enum: ['dev', 'stg', 'prd', 'sbx', 'dr'],
            default: 'dev'
          },
          project: {
            type: 'string',
            description: 'Project name (optional, defaults to config)'
          },
          service: {
            type: 'string',
            description: 'Service name for monorepos (optional)'
          }
        },
        required: ['key', 'value']
      }
    },
    {
      name: 'minienv_delete',
      description: 'Delete an environment variable',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'The name of the environment variable to delete'
          },
          environment: {
            type: 'string',
            description: 'Environment (dev/stg/prd/sbx/dr)',
            enum: ['dev', 'stg', 'prd', 'sbx', 'dr'],
            default: 'dev'
          },
          project: {
            type: 'string',
            description: 'Project name (optional, defaults to config)'
          },
          service: {
            type: 'string',
            description: 'Service name for monorepos (optional)'
          }
        },
        required: ['key']
      }
    },
    {
      name: 'minienv_list',
      description: 'List all environment variables for a project/environment',
      inputSchema: {
        type: 'object',
        properties: {
          environment: {
            type: 'string',
            description: 'Environment (dev/stg/prd/sbx/dr)',
            enum: ['dev', 'stg', 'prd', 'sbx', 'dr'],
            default: 'dev'
          },
          project: {
            type: 'string',
            description: 'Project name (optional, defaults to config)'
          },
          service: {
            type: 'string',
            description: 'Service name for monorepos (optional)'
          },
          showValues: {
            type: 'boolean',
            description: 'Show values (default: false for security)',
            default: false
          }
        }
      }
    },
    {
      name: 'minienv_export',
      description: 'Export environment variables in shell format',
      inputSchema: {
        type: 'object',
        properties: {
          environment: {
            type: 'string',
            description: 'Environment (dev/stg/prd/sbx/dr)',
            enum: ['dev', 'stg', 'prd', 'sbx', 'dr'],
            default: 'dev'
          },
          project: {
            type: 'string',
            description: 'Project name (optional, defaults to config)'
          },
          service: {
            type: 'string',
            description: 'Service name for monorepos (optional)'
          },
          format: {
            type: 'string',
            description: 'Output format',
            enum: ['shell', 'env', 'json', 'yaml'],
            default: 'shell'
          }
        }
      }
    },
    {
      name: 'minienv_sync',
      description: 'Sync local .env file with backend storage',
      inputSchema: {
        type: 'object',
        properties: {
          environment: {
            type: 'string',
            description: 'Environment (dev/stg/prd/sbx/dr)',
            enum: ['dev', 'stg', 'prd', 'sbx', 'dr'],
            default: 'dev'
          },
          project: {
            type: 'string',
            description: 'Project name (optional, defaults to config)'
          },
          service: {
            type: 'string',
            description: 'Service name for monorepos (optional)'
          },
          dryRun: {
            type: 'boolean',
            description: 'Show what would be changed without making changes',
            default: false
          }
        }
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

  if (!project) {
    return {
      content: [{
        type: 'text',
        text: 'Error: Project not specified. Either set project in args or run from a directory with .minienv/config.yaml'
      }]
    }
  }

  try {
    await client.connect()

    switch (name) {
      case 'minienv_get': {
        const key = args.key as string
        const envVar = await client.get(key, project, environment, service)
        return {
          content: [{
            type: 'text',
            text: envVar !== null ? envVar.value : `Variable ${key} not found`
          }]
        }
      }

      case 'minienv_set': {
        const key = args.key as string
        const value = args.value as string
        await client.set({
          key,
          value,
          project,
          environment,
          service,
          metadata: { source: 'manual' }
        })
        return {
          content: [{
            type: 'text',
            text: `✓ Set ${key} in ${project}/${environment}`
          }]
        }
      }

      case 'minienv_delete': {
        const key = args.key as string
        const deleted = await client.delete(key, project, environment, service)
        return {
          content: [{
            type: 'text',
            text: deleted ? `✓ Deleted ${key}` : `Variable ${key} not found`
          }]
        }
      }

      case 'minienv_list': {
        const showValues = args.showValues as boolean || false
        const vars = await client.list({ project, environment, service })

        if (vars.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `No variables found for ${project}/${environment}`
            }]
          }
        }

        const lines = vars.map(v =>
          showValues ? `${v.key}=${v.value}` : v.key
        )

        return {
          content: [{
            type: 'text',
            text: `Variables in ${project}/${environment}:\n${lines.join('\n')}`
          }]
        }
      }

      case 'minienv_export': {
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
          case 'shell':
          default:
            output = Object.entries(vars)
              .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
              .join('\n')
        }

        return {
          content: [{
            type: 'text',
            text: output
          }]
        }
      }

      case 'minienv_sync': {
        const dryRun = args.dryRun as boolean || false

        // Read local .env file
        const configDir = findConfigDir()
        if (!configDir) {
          return {
            content: [{
              type: 'text',
              text: 'Error: No .minienv directory found'
            }]
          }
        }

        const envFilePath = getEnvFilePath(configDir, environment)
        if (!fs.existsSync(envFilePath)) {
          return {
            content: [{
              type: 'text',
              text: `Error: Environment file not found: ${envFilePath}`
            }]
          }
        }

        const localVars = parseEnvFile(envFilePath)

        if (dryRun) {
          const remoteVars = await client.export(project, environment, service)
          const toAdd: string[] = []
          const toUpdate: string[] = []
          const toDelete: string[] = []

          for (const [key, value] of Object.entries(localVars)) {
            if (!(key in remoteVars)) {
              toAdd.push(key)
            } else if (remoteVars[key] !== value) {
              toUpdate.push(key)
            }
          }

          for (const key of Object.keys(remoteVars)) {
            if (!(key in localVars)) {
              toDelete.push(key)
            }
          }

          const lines = ['Dry run - changes that would be made:']
          if (toAdd.length > 0) lines.push(`  Add: ${toAdd.join(', ')}`)
          if (toUpdate.length > 0) lines.push(`  Update: ${toUpdate.join(', ')}`)
          if (toDelete.length > 0) lines.push(`  Delete: ${toDelete.join(', ')}`)
          if (toAdd.length === 0 && toUpdate.length === 0 && toDelete.length === 0) {
            lines.push('  No changes needed')
          }

          return {
            content: [{
              type: 'text',
              text: lines.join('\n')
            }]
          }
        }

        const result = await client.sync(localVars, project, environment, service, {
          source: 'sync'
        })

        const lines = [`✓ Synced ${project}/${environment}`]
        if (result.added.length > 0) lines.push(`  Added: ${result.added.length}`)
        if (result.updated.length > 0) lines.push(`  Updated: ${result.updated.length}`)
        if (result.deleted.length > 0) lines.push(`  Deleted: ${result.deleted.length}`)
        if (result.unchanged.length > 0) lines.push(`  Unchanged: ${result.unchanged.length}`)

        return {
          content: [{
            type: 'text',
            text: lines.join('\n')
          }]
        }
      }

      default:
        return {
          content: [{
            type: 'text',
            text: `Unknown tool: ${name}`
          }]
        }
    }
  } finally {
    await client.disconnect()
  }
}
