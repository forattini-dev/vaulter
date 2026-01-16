/**
 * Vaulter CLI - Set Command
 *
 * Set environment variables (supports batch operations)
 *
 * Syntax options:
 *   vaulter set KEY "value" -e dev          # Legacy single-key syntax (secret)
 *   vaulter set KEY=value -e dev            # Secret (encrypted, file + backend)
 *   vaulter set KEY:=123 -e dev             # Secret typed (number/boolean)
 *   vaulter set KEY::value -e dev           # Config (plain text, file only)
 *   vaulter set K1=v1 K2::v2 -e dev         # Batch: mix secrets and configs
 *   vaulter set KEY=val @tag:db,secret      # With metadata (@ prefix)
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import { findConfigDir, getSecretsFilePath, getConfigsFilePath, getEnvFilePath, getEnvFilePathForConfig } from '../../lib/config-loader.js'
import { parseEnvFile, serializeEnv } from '../../lib/env-parser.js'

type SeparatorValue = string | number | boolean | null

interface SetContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
  secrets: Record<string, SeparatorValue>
  configs: Record<string, SeparatorValue>
  meta: Record<string, SeparatorValue>
}

/**
 * Check if this is a production environment and confirm if needed
 */
function isProdEnvironment(env: Environment): boolean {
  return env === 'prd' || env === 'dr'
}

/**
 * Check if config uses split mode
 */
function isSplitMode(config: VaulterConfig | null): boolean {
  return config?.directories?.mode === 'split'
}

/**
 * Build variables map from args (handles legacy, secrets, and configs)
 */
function buildVariablesMaps(context: SetContext): {
  secrets: Map<string, string>
  configs: Map<string, string>
} {
  const { args, secrets: secretsBucket, configs: configsBucket } = context
  const secrets = new Map<string, string>()
  const configs = new Map<string, string>()

  // 1. Secrets from separator syntax (KEY=value)
  for (const [key, value] of Object.entries(secretsBucket)) {
    secrets.set(key, String(value))
  }

  // 2. Configs from separator syntax (KEY::value)
  for (const [key, value] of Object.entries(configsBucket)) {
    configs.set(key, String(value))
  }

  // 3. Legacy syntax (positional args: KEY "value") → treated as secret
  const legacyKey = args._[1]
  const legacyValue = args._[2]
  if (legacyKey && legacyValue !== undefined) {
    secrets.set(legacyKey, String(legacyValue))
  }

  return { secrets, configs }
}

/**
 * Extract metadata from meta bucket
 *
 * Supports:
 *   @tag:sensitive,database     → ['sensitive', 'database'] (comma-separated)
 *   @tags:auth,secret           → ['auth', 'secret']
 *   @owner:backend              → stored in metadata.owner
 *   @description:my-var         → stored in metadata.description
 */
function extractMetadata(meta: Record<string, SeparatorValue>): {
  tags: string[]
  owner?: string
  description?: string
} {
  const tags: string[] = []
  let owner: string | undefined
  let description: string | undefined

  for (const [key, value] of Object.entries(meta)) {
    const strValue = String(value)

    if (key === 'tag' || key === 'tags') {
      // Support comma-separated tags: @tag:sensitive,database,secret
      const tagList = strValue.split(',').map(t => t.trim()).filter(t => t.length > 0)
      tags.push(...tagList)
    } else if (key === 'owner') {
      owner = strValue
    } else if (key === 'description' || key === 'desc') {
      description = strValue
    } else {
      // Unknown meta keys become tags: @foo:bar → tag 'foo:bar'
      tags.push(`${key}:${strValue}`)
    }
  }

  return { tags, owner, description }
}

/**
 * Write variables to a .env file (append/update)
 */
function writeToEnvFile(filePath: string, variables: Map<string, string>, verbose: boolean): void {
  // Ensure directory exists
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Load existing vars if file exists
  let existing: Record<string, string> = {}
  if (fs.existsSync(filePath)) {
    existing = parseEnvFile(filePath)
  }

  // Merge new variables
  for (const [key, value] of variables) {
    existing[key] = value
  }

  // Write back
  const content = serializeEnv(existing)
  fs.writeFileSync(filePath, content + '\n')

  if (verbose) {
    console.error(`[vaulter] Wrote ${variables.size} variables to ${filePath}`)
  }
}

/**
 * Run the set command
 */
export async function runSet(context: SetContext): Promise<void> {
  const { args, config, project, service, environment, verbose, dryRun, jsonOutput, meta } = context

  // Build variables maps (secrets and configs)
  const { secrets, configs } = buildVariablesMaps(context)

  // Extract metadata from meta bucket (@tag:x @owner:y @desc:z)
  const { tags, owner, description } = extractMetadata(meta)

  const totalVars = secrets.size + configs.size

  if (totalVars === 0) {
    console.error('Error: No variables specified')
    console.error('')
    console.error('Usage:')
    console.error('  vaulter set KEY "value" -e dev                  # Single secret')
    console.error('  vaulter set KEY=value -e dev                    # Secret (encrypted)')
    console.error('  vaulter set KEY::value -e dev                   # Config (plain text)')
    console.error('  vaulter set K1=v1 K2::v2 PORT:=3000             # Batch: mix secrets & configs')
    console.error('  vaulter set KEY=val @tag:db,secret @owner:team  # With metadata')
    process.exit(1)
  }

  if (!project) {
    console.error('Error: Project not specified and no config found')
    console.error('Run "vaulter init" or specify --project')
    process.exit(1)
  }

  // Production confirmation
  if (isProdEnvironment(environment) && config?.security?.confirm_production && !args.force) {
    console.error(`Warning: You are modifying ${environment} (production) environment`)
    console.error('Use --force to confirm this action')
    process.exit(1)
  }

  const splitMode = isSplitMode(config)
  const configDir = findConfigDir()

  if (verbose) {
    console.error(`Mode: ${splitMode ? 'split' : 'unified'}`)
    if (secrets.size > 0) console.error(`Secrets: ${[...secrets.keys()].join(', ')}`)
    if (configs.size > 0) console.error(`Configs: ${[...configs.keys()].join(', ')}`)
  }

  // Dry run output
  if (dryRun) {
    const result: Record<string, unknown> = {
      action: 'set',
      mode: splitMode ? 'split' : 'unified',
      project,
      service,
      environment,
      dryRun: true
    }

    if (secrets.size > 0) {
      result.secrets = {
        count: secrets.size,
        keys: [...secrets.keys()],
        destination: splitMode ? 'deploy/secrets + backend' : 'backend'
      }
    }

    if (configs.size > 0) {
      result.configs = {
        count: configs.size,
        keys: [...configs.keys()],
        destination: splitMode ? 'deploy/configs (file only)' : 'env file + backend'
      }
    }

    if (tags.length > 0 || owner || description) {
      result.metadata = { tags: tags.length > 0 ? tags : undefined, owner, description }
    }

    if (jsonOutput) {
      console.log(JSON.stringify(result))
    } else {
      if (secrets.size > 0) {
        console.log(`Dry run - would set ${secrets.size} secret(s):`)
        for (const key of secrets.keys()) {
          const dest = splitMode ? 'secrets file + backend' : 'backend'
          console.log(`  ${key} → ${dest}`)
        }
      }
      if (configs.size > 0) {
        console.log(`Dry run - would set ${configs.size} config(s):`)
        for (const key of configs.keys()) {
          const dest = splitMode ? 'configs file (no backend)' : 'env file + backend'
          console.log(`  ${key} → ${dest}`)
        }
      }
      if (tags.length > 0) console.log(`  [tags: ${tags.join(', ')}]`)
      if (owner) console.log(`  [owner: ${owner}]`)
    }
    return
  }

  // Results tracking
  const results: Array<{ key: string; type: 'secret' | 'config'; success: boolean; error?: string }> = []

  // === HANDLE SECRETS (file + backend) ===
  if (secrets.size > 0) {
    // Write to secrets file in split mode
    if (splitMode && configDir) {
      const secretsFilePath = getSecretsFilePath(config!, configDir, environment)
      writeToEnvFile(secretsFilePath, secrets, verbose)
    }

    // Sync secrets to backend
    const client = await createClientFromConfig({ args, config, verbose })

    try {
      await client.connect()

      for (const [key, value] of secrets) {
        try {
          await client.set({
            key,
            value,
            project,
            service,
            environment,
            tags: tags.length > 0 ? tags : undefined,
            metadata: {
              source: 'manual',
              ...(owner && { owner }),
              ...(description && { description })
            }
          })

          results.push({ key, type: 'secret', success: true })

          if (!jsonOutput) {
            console.log(`✓ Set secret ${key} in ${project}/${environment}`)
          }
        } catch (err) {
          results.push({ key, type: 'secret', success: false, error: (err as Error).message })

          if (!jsonOutput) {
            console.error(`✗ Failed to set secret ${key}: ${(err as Error).message}`)
          }
        }
      }
    } finally {
      await client.disconnect()
    }
  }

  // === HANDLE CONFIGS (split: file only | unified: file + backend) ===
  if (configs.size > 0) {
    if (splitMode && configDir) {
      // Split mode: write to configs file only
      const configsFilePath = getConfigsFilePath(config!, configDir, environment)
      writeToEnvFile(configsFilePath, configs, verbose)

      for (const key of configs.keys()) {
        results.push({ key, type: 'config', success: true })

        if (!jsonOutput) {
          console.log(`✓ Set config ${key} in ${configsFilePath}`)
        }
      }
    } else if (configDir) {
      // Unified mode: write configs to the single env file + backend
      // Use getEnvFilePathForConfig to respect directories.path if configured
      const envFilePath = config
        ? getEnvFilePathForConfig(config, configDir, environment)
        : getEnvFilePath(configDir, environment)
      writeToEnvFile(envFilePath, configs, verbose)

      // Also sync to backend in unified mode
      const client = await createClientFromConfig({ args, config, verbose })

      try {
        await client.connect()

        for (const [key, value] of configs) {
          try {
            await client.set({
              key,
              value,
              project,
              service,
              environment,
              tags: tags.length > 0 ? tags : undefined,
              metadata: {
                source: 'manual',
                ...(owner && { owner }),
                ...(description && { description })
              }
            })

            results.push({ key, type: 'config', success: true })

            if (!jsonOutput) {
              console.log(`✓ Set config ${key} in ${project}/${environment}`)
            }
          } catch (err) {
            results.push({ key, type: 'config', success: false, error: (err as Error).message })

            if (!jsonOutput) {
              console.error(`✗ Failed to set config ${key}: ${(err as Error).message}`)
            }
          }
        }
      } finally {
        await client.disconnect()
      }
    } else {
      console.error('Error: No config directory found')
      process.exit(1)
    }
  }

  // Calculate final results
  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  // JSON output summary
  if (jsonOutput) {
    console.log(JSON.stringify({
      success: failed === 0,
      results,
      summary: {
        total: results.length,
        successful,
        failed,
        secrets: secrets.size,
        configs: configs.size
      },
      project,
      service,
      environment
    }))
  } else if (totalVars > 1) {
    console.log(`\n${successful}/${totalVars} variables set successfully`)
  }

  // Exit with error code if any failures occurred
  if (failed > 0) {
    process.exit(1)
  }
}
