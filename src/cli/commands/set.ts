/**
 * Vaulter CLI - Set Command
 *
 * Set environment variables (supports batch operations)
 *
 * Syntax options:
 *   vaulter set KEY "value" -e dev          # Legacy single-key syntax (secret)
 *   vaulter set KEY=value -e dev            # Secret (encrypted, file + backend)
 *   vaulter set KEY:=123 -e dev             # Secret typed (number/boolean)
 *   vaulter set KEY::value -e dev           # Config (split: file only | unified: file + backend)
 *   vaulter set K1=v1 K2::v2 -e dev         # Batch: mix secrets and configs
 *   vaulter set KEY=val @tag:db,secret      # With metadata (@ prefix)
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import { findConfigDir, getSecretsFilePath, getConfigsFilePath, getEnvFilePath, getEnvFilePathForConfig } from '../../lib/config-loader.js'
import { parseEnvFile, serializeEnv } from '../../lib/env-parser.js'
import { createConnectedAuditLogger, logSetOperation, disconnectAuditLogger } from '../lib/audit-helper.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import { SHARED_SERVICE } from '../../lib/shared.js'
import * as ui from '../ui.js'

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
  /** Target shared variables scope */
  shared?: boolean
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

  ui.verbose(`Wrote ${variables.size} variables to ${filePath}`, verbose)
}

/**
 * Run the set command
 */
export async function runSet(context: SetContext): Promise<void> {
  const { args, config, project, service, environment, verbose, dryRun, jsonOutput, meta } = context

  // Check for --shared flag
  const isShared = args.shared || context.shared

  // Determine effective service
  const effectiveService = isShared ? SHARED_SERVICE : service

  // Build variables maps (secrets and configs)
  const { secrets, configs } = buildVariablesMaps(context)

  // Extract metadata from meta bucket (@tag:x @owner:y @desc:z)
  const { tags, owner, description } = extractMetadata(meta)

  const totalVars = secrets.size + configs.size

  if (totalVars === 0) {
    print.error('No variables specified')
    ui.log('')
    ui.log(c.header('Usage:'))
    ui.log(`  ${c.command('vaulter set')} ${c.key('KEY')} ${c.value('"value"')} ${c.highlight('-e')} ${colorEnv('dev')}                  ${c.muted('# Single secret')}`)
    ui.log(`  ${c.command('vaulter set')} ${c.key('KEY')}${c.secret('=')}${c.value('value')} ${c.highlight('-e')} ${colorEnv('dev')}                    ${c.muted('# Secret (encrypted)')}`)
    ui.log(`  ${c.command('vaulter set')} ${c.key('KEY')}${c.config('::')}${c.value('value')} ${c.highlight('-e')} ${colorEnv('dev')}                   ${c.muted('# Config (file only in split mode)')}`)
    ui.log(`  ${c.command('vaulter set')} ${c.key('K1')}${c.secret('=')}${c.value('v1')} ${c.key('K2')}${c.config('::')}${c.value('v2')} ${c.key('PORT')}${c.muted(':=')}${c.value('3000')}             ${c.muted('# Batch: mix secrets & configs')}`)
    ui.log(`  ${c.command('vaulter set')} ${c.key('KEY')}${c.secret('=')}${c.value('val')} ${c.muted('@tag:db,secret @owner:team')}  ${c.muted('# With metadata')}`)
    process.exit(1)
  }

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  // Show environment banner (respects --quiet and --json)
  if (!jsonOutput && !dryRun) {
    ui.showEnvironmentBanner(environment, {
      project,
      service: isShared ? 'shared' : service,
      action: 'Setting variables'
    })
  }

  // Production confirmation
  if (isProdEnvironment(environment) && config?.security?.confirm_production && !args.force) {
    print.warning(`You are modifying ${colorEnv(environment)} (production) environment`)
    ui.log(`Use ${c.highlight('--force')} to confirm this action`)
    process.exit(1)
  }

  const splitMode = isSplitMode(config)
  const configDir = findConfigDir()

  if (verbose) {
    const scope = isShared ? c.env('shared') : c.service(service || '(no service)')
    ui.verbose(`Setting variables for ${c.project(project)}/${scope}/${colorEnv(environment)}`, true)
    ui.verbose(`Mode: ${c.value(splitMode ? 'split' : 'unified')}`, true)
    if (secrets.size > 0) ui.verbose(`${c.secretType('Secrets')}: ${c.key([...secrets.keys()].join(', '))}`, true)
    if (configs.size > 0) ui.verbose(`${c.configType('Configs')}: ${c.key([...configs.keys()].join(', '))}`, true)
  }

  // Dry run output
  if (dryRun) {
    const result: Record<string, unknown> = {
      action: 'set',
      mode: splitMode ? 'split' : 'unified',
      project,
      service: effectiveService,
      environment,
      shared: isShared,
      dryRun: true
    }

    if (secrets.size > 0) {
      result.secrets = {
        count: secrets.size,
        keys: [...secrets.keys()],
        destination: splitMode ? 'deploy/secrets + backend' : 'env file + backend'
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
      ui.output(JSON.stringify(result))
    } else {
      if (secrets.size > 0) {
        ui.log(`${c.muted('Dry run')} - would set ${c.secretType(String(secrets.size))} ${c.secretType('secret(s)')}:`)
        for (const key of secrets.keys()) {
          const dest = splitMode ? 'secrets file + backend' : 'env file + backend'
          ui.log(`  ${c.key(key)} ${symbols.arrow} ${c.muted(dest)}`)
        }
      }
      if (configs.size > 0) {
        ui.log(`${c.muted('Dry run')} - would set ${c.configType(String(configs.size))} ${c.configType('config(s)')}:`)
        for (const key of configs.keys()) {
          const dest = splitMode ? 'configs file (no backend)' : 'env file + backend'
          ui.log(`  ${c.key(key)} ${symbols.arrow} ${c.muted(dest)}`)
        }
      }
      if (tags.length > 0) ui.log(`  ${c.muted('[tags:')} ${c.value(tags.join(', '))}${c.muted(']')}`)
      if (owner) ui.log(`  ${c.muted('[owner:')} ${c.value(owner)}${c.muted(']')}`)
    }
    return
  }

  // Results tracking
  const results: Array<{ key: string; type: 'secret' | 'config'; success: boolean; error?: string }> = []

  // === HANDLE SECRETS (split: secrets file + backend | unified: env file + backend) ===
  if (secrets.size > 0) {
    // Write to file (secrets file in split mode, unified env file otherwise)
    if (configDir) {
      const secretsFilePath = splitMode
        ? getSecretsFilePath(config!, configDir, environment)
        : config
          ? getEnvFilePathForConfig(config, configDir, environment)
          : getEnvFilePath(configDir, environment)
      writeToEnvFile(secretsFilePath, secrets, verbose)
    }

    // Sync secrets to backend
    const client = await createClientFromConfig({ args, config, project, verbose })
    const auditLogger = await createConnectedAuditLogger(config, verbose)

    try {
      await client.connect()

      for (const [key, value] of secrets) {
        try {
          // Get existing value for audit log
          const existing = await client.get(key, project, environment, effectiveService)
          const previousValue = existing?.value

          // Update rotatedAt if value changed (secret rotation tracking)
          const isValueChanged = previousValue !== undefined && previousValue !== value
          const rotatedAt = isValueChanged ? new Date().toISOString() : existing?.metadata?.rotatedAt

          await client.set({
            key,
            value,
            project,
            service: effectiveService,
            environment,
            tags: tags.length > 0 ? tags : undefined,
            metadata: {
              source: 'manual',
              ...(owner && { owner }),
              ...(description && { description }),
              // Preserve rotation policy (rotateAfter) if it exists
              ...(existing?.metadata?.rotateAfter && { rotateAfter: existing.metadata.rotateAfter }),
              // Update rotatedAt when value changes
              ...(rotatedAt && { rotatedAt })
            }
          })

          // Log to audit trail
          await logSetOperation(auditLogger, {
            key,
            previousValue,
            newValue: value,
            project,
            environment,
            service: effectiveService,
            source: 'cli'
          })

          results.push({ key, type: 'secret', success: true })

          // Show rotation update in verbose mode
          if (isValueChanged && !jsonOutput) {
            ui.verbose(`Updated rotatedAt timestamp for ${key}`, verbose)
          }

          if (!jsonOutput) {
            const scope = isShared ? c.env('shared') : colorEnv(environment)
            ui.log(`${symbols.success} Set ${c.secretType('secret')} ${c.key(key)} in ${c.project(project)}/${scope}`)
          }
        } catch (err) {
          results.push({ key, type: 'secret', success: false, error: (err as Error).message })

          if (!jsonOutput) {
            ui.log(`${symbols.error} Failed to set ${c.secretType('secret')} ${c.key(key)}: ${c.error((err as Error).message)}`)
          }
        }
      }
    } finally {
      await client.disconnect()
      await disconnectAuditLogger(auditLogger)
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
          ui.log(`${symbols.success} Set ${c.configType('config')} ${c.key(key)} in ${c.muted(configsFilePath)}`)
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
      const client = await createClientFromConfig({ args, config, project, verbose })
      const auditLogger = await createConnectedAuditLogger(config, verbose)

      try {
        await client.connect()

        for (const [key, value] of configs) {
          try {
            // Get existing value for audit log
            const existing = await client.get(key, project, environment, effectiveService)
            const previousValue = existing?.value

            // Update rotatedAt if value changed (rotation tracking)
            const isValueChanged = previousValue !== undefined && previousValue !== value
            const rotatedAt = isValueChanged ? new Date().toISOString() : existing?.metadata?.rotatedAt

            await client.set({
              key,
              value,
              project,
              service: effectiveService,
              environment,
              tags: tags.length > 0 ? tags : undefined,
              metadata: {
                source: 'manual',
                ...(owner && { owner }),
                ...(description && { description }),
                // Preserve rotation policy (rotateAfter) if it exists
                ...(existing?.metadata?.rotateAfter && { rotateAfter: existing.metadata.rotateAfter }),
                // Update rotatedAt when value changes
                ...(rotatedAt && { rotatedAt })
              }
            })

            // Log to audit trail
            await logSetOperation(auditLogger, {
              key,
              previousValue,
              newValue: value,
              project,
              environment,
              service: effectiveService,
              source: 'cli'
            })

            results.push({ key, type: 'config', success: true })

            // Show rotation update in verbose mode
            if (isValueChanged && !jsonOutput) {
              ui.verbose(`Updated rotatedAt timestamp for ${key}`, verbose)
            }

            if (!jsonOutput) {
              const scope = isShared ? c.env('shared') : colorEnv(environment)
              ui.log(`${symbols.success} Set ${c.configType('config')} ${c.key(key)} in ${c.project(project)}/${scope}`)
            }
          } catch (err) {
            results.push({ key, type: 'config', success: false, error: (err as Error).message })

            if (!jsonOutput) {
              ui.log(`${symbols.error} Failed to set ${c.configType('config')} ${c.key(key)}: ${c.error((err as Error).message)}`)
            }
          }
        }
      } finally {
        await client.disconnect()
        await disconnectAuditLogger(auditLogger)
      }
    } else {
      print.error('No config directory found')
      process.exit(1)
    }
  }

  // Calculate final results
  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  // JSON output summary
  if (jsonOutput) {
    ui.output(JSON.stringify({
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
      service: effectiveService,
      environment,
      shared: isShared
    }))
  } else if (totalVars > 1) {
    ui.log(`\n${c.success(String(successful))}/${c.value(String(totalVars))} variables set successfully`)
  }

  // Exit with error code if any failures occurred
  if (failed > 0) {
    process.exit(1)
  }
}
