/**
 * Vaulter MCP Tools - Doctor Handler
 *
 * Diagnose configuration health and provide actionable suggestions.
 * This is the FIRST tool AI agents should call to understand the current state.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { VaulterConfig, Environment } from '../../../types.js'
import {
  findConfigDir,
  getBaseDir,
  getEnvFilePathForConfig,
  getConfigsFilePath,
  getSecretsFilePath,
  isSplitMode,
  isValidEnvironment,
  resolveBackendUrls
} from '../../../lib/config-loader.js'
import { loadKeyForEnv } from '../../../lib/keys.js'
import { normalizeOutputTargets, validateOutputsConfig } from '../../../lib/outputs.js'
import { parseEnvFile } from '../../../lib/env-parser.js'
import type { ToolResponse } from '../config.js'
import type { VaulterClient } from '../../../client.js'

type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip'

interface DoctorCheck {
  name: string
  status: CheckStatus
  details: string
  hint?: string
}

interface DoctorResult {
  project: string | null
  service: string | null
  environment: string
  configPath: string | null
  backend: {
    urls: string[]
    type: 'local' | 'remote' | 'none'
  }
  encryption: {
    mode: 'symmetric' | 'asymmetric' | 'none'
    keyFound: boolean
    source?: string
  }
  environments: {
    [env: string]: {
      varsCount?: number
      isEmpty?: boolean
      localFileExists?: boolean
    }
  }
  services: string[]
  checks: DoctorCheck[]
  summary: {
    ok: number
    warn: number
    fail: number
    skip: number
    healthy: boolean
  }
  suggestions: string[]
}

function isLocalBackend(url: string): boolean {
  return url.startsWith('file://') || url.startsWith('memory://')
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.username || url.password) {
      const userInfo = `${url.username}${url.password ? `:${url.password}` : ''}@`
      return raw.replace(userInfo, '****:****@')
    }
    return raw
  } catch {
    return raw
  }
}

/**
 * Doctor handler - diagnoses vaulter configuration health
 */
export async function handleDoctorCall(
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>,
  testConnection: () => Promise<{ connected: boolean; error?: string; varsCount?: number }>
): Promise<ToolResponse> {
  const checks: DoctorCheck[] = []
  const suggestions: string[] = []

  const addCheck = (check: DoctorCheck) => {
    checks.push(check)
    if (check.hint) suggestions.push(check.hint)
  }

  const configDir = findConfigDir()
  const configPath = configDir ? path.join(configDir, 'config.yaml') : null

  // Result object to build
  const result: DoctorResult = {
    project: project || null,
    service: service || null,
    environment,
    configPath,
    backend: { urls: [], type: 'none' },
    encryption: { mode: 'none', keyFound: false },
    environments: {},
    services: [],
    checks: [],
    summary: { ok: 0, warn: 0, fail: 0, skip: 0, healthy: false },
    suggestions: []
  }

  // === CHECK 1: Config file ===
  if (!config || !configDir) {
    addCheck({
      name: 'config',
      status: 'fail',
      details: 'config.yaml not found',
      hint: 'Run "vaulter init" to create .vaulter/config.yaml'
    })
  } else {
    addCheck({
      name: 'config',
      status: 'ok',
      details: `found at ${configPath}`
    })
  }

  // === CHECK 2: Project name ===
  if (!project) {
    addCheck({
      name: 'project',
      status: 'fail',
      details: 'project not set',
      hint: 'Set project in config.yaml or pass project parameter'
    })
  } else {
    result.project = project
    addCheck({
      name: 'project',
      status: 'ok',
      details: project
    })
  }

  // === CHECK 3: Environment validation ===
  if (config) {
    if (!isValidEnvironment(config, environment)) {
      addCheck({
        name: 'environment',
        status: 'warn',
        details: `${environment} not listed in config.environments`,
        hint: `Add "${environment}" to config.environments or use a valid environment`
      })
    } else {
      addCheck({
        name: 'environment',
        status: 'ok',
        details: environment
      })
    }

    // Build environments info
    const envList = config.environments || ['dev', 'stg', 'prd']
    for (const env of envList) {
      result.environments[env] = { isEmpty: true }
    }
  }

  // === CHECK 4: Monorepo service ===
  if (config?.services && config.services.length > 0) {
    const serviceNames = config.services.map(s => (typeof s === 'string' ? s : s.name))
    result.services = serviceNames

    if (!service) {
      addCheck({
        name: 'service',
        status: 'warn',
        details: `monorepo with ${serviceNames.length} services but no service selected`,
        hint: 'Use service parameter to specify which service to work with'
      })
    } else if (!serviceNames.includes(service)) {
      addCheck({
        name: 'service',
        status: 'warn',
        details: `${service} not found in configured services`,
        hint: `Valid services: ${serviceNames.join(', ')}`
      })
    } else {
      addCheck({
        name: 'service',
        status: 'ok',
        details: service
      })
    }
  }

  // === CHECK 5: Backend configuration ===
  let backendUrls: string[] = []
  if (args.backend) {
    backendUrls = [args.backend as string]
  } else if (config) {
    backendUrls = resolveBackendUrls(config)
  }

  result.backend.urls = backendUrls.map(redactUrl)

  if (backendUrls.length === 0) {
    result.backend.type = 'none'
    addCheck({
      name: 'backend',
      status: 'warn',
      details: 'no backend configured (using default local store)',
      hint: 'Set backend.url in config.yaml to use remote storage (S3, MinIO, etc.)'
    })
  } else {
    const hasRemote = backendUrls.some(url => !isLocalBackend(url))
    result.backend.type = hasRemote ? 'remote' : 'local'
    addCheck({
      name: 'backend',
      status: 'ok',
      details: `${backendUrls.length} backend(s) configured (${result.backend.type})`
    })
  }

  // === CHECK 6: Encryption key ===
  if (project) {
    try {
      const keyResult = await loadKeyForEnv({ project, environment, config })
      if (keyResult.mode === 'asymmetric') {
        result.encryption.mode = 'asymmetric'
        const hasPublic = !!keyResult.publicKey
        const hasPrivate = !!keyResult.key
        result.encryption.keyFound = hasPublic || hasPrivate

        if (!hasPublic && !hasPrivate) {
          addCheck({
            name: 'encryption',
            status: 'fail',
            details: 'asymmetric keys not found',
            hint: `Run "vaulter key generate --asymmetric -e ${environment}" or set VAULTER_PUBLIC_KEY/VAULTER_PRIVATE_KEY`
          })
        } else if (!hasPublic || !hasPrivate) {
          addCheck({
            name: 'encryption',
            status: 'warn',
            details: `asymmetric key incomplete (${hasPublic ? 'private' : 'public'} missing)`,
            hint: 'Provide both public and private keys for full read/write'
          })
        } else {
          addCheck({
            name: 'encryption',
            status: 'ok',
            details: `asymmetric (${keyResult.algorithm || 'rsa-4096'})`
          })
        }
      } else {
        result.encryption.mode = 'symmetric'
        if (!keyResult.key) {
          result.encryption.keyFound = false
          addCheck({
            name: 'encryption',
            status: 'warn',
            details: 'no encryption key found',
            hint: `Set VAULTER_KEY_${environment.toUpperCase()} or run "vaulter key generate -e ${environment}"`
          })
        } else {
          result.encryption.keyFound = true
          result.encryption.source = keyResult.source
          addCheck({
            name: 'encryption',
            status: 'ok',
            details: `symmetric (from ${keyResult.source})`
          })
        }
      }
    } catch (error) {
      result.encryption.mode = 'none'
      addCheck({
        name: 'encryption',
        status: 'fail',
        details: (error as Error).message,
        hint: 'Fix encryption configuration'
      })
    }
  }

  // === CHECK 7: Shared key environment (if monorepo) ===
  if (config?.encryption?.shared_key_environment && project) {
    const sharedEnv = config.encryption.shared_key_environment
    try {
      const sharedKey = await loadKeyForEnv({ project, environment: sharedEnv, config })
      const hasKey = sharedKey.mode === 'asymmetric'
        ? !!sharedKey.publicKey || !!sharedKey.key
        : !!sharedKey.key

      if (!hasKey) {
        addCheck({
          name: 'shared-key',
          status: 'warn',
          details: `no key for shared_key_environment=${sharedEnv}`,
          hint: `Set VAULTER_KEY_${sharedEnv.toUpperCase()} for shared variables`
        })
      } else {
        addCheck({
          name: 'shared-key',
          status: 'ok',
          details: sharedEnv
        })
      }
    } catch {
      addCheck({
        name: 'shared-key',
        status: 'warn',
        details: `failed to load key for ${sharedEnv}`
      })
    }
  }

  // === CHECK 8: Local env files ===
  if (config && configDir) {
    if (isSplitMode(config)) {
      const secretsPath = getSecretsFilePath(config, configDir, environment)
      const configsPath = getConfigsFilePath(config, configDir, environment)
      const secretsExists = fs.existsSync(secretsPath)
      const configsExists = fs.existsSync(configsPath)

      result.environments[environment] = {
        ...result.environments[environment],
        localFileExists: secretsExists && configsExists
      }

      if (secretsExists && configsExists) {
        addCheck({
          name: 'local-files',
          status: 'ok',
          details: 'split mode files present'
        })
      } else {
        addCheck({
          name: 'local-files',
          status: 'warn',
          details: `missing split mode file(s)`,
          hint: `Run "vaulter sync pull -e ${environment}" to create local files`
        })
      }
    } else {
      const envPath = getEnvFilePathForConfig(config, configDir, environment)
      const envExists = fs.existsSync(envPath)

      result.environments[environment] = {
        ...result.environments[environment],
        localFileExists: envExists
      }

      if (envExists) {
        addCheck({
          name: 'local-files',
          status: 'ok',
          details: 'env file present'
        })
      } else {
        addCheck({
          name: 'local-files',
          status: 'warn',
          details: 'missing local env file',
          hint: `Run "vaulter sync pull -e ${environment}" to create local file`
        })
      }
    }
  }

  // === CHECK 9: Outputs configuration ===
  if (config) {
    const outputErrors = validateOutputsConfig(config)
    if (outputErrors.length > 0) {
      addCheck({
        name: 'outputs',
        status: 'fail',
        details: outputErrors[0],
        hint: 'Fix outputs configuration in config.yaml'
      })
    } else if (config.outputs) {
      const targets = normalizeOutputTargets(config, environment)
      const projectRoot = configDir ? getBaseDir(configDir) : process.cwd()
      const missing = targets.filter(target => {
        const fullPath = path.join(projectRoot, target.path, target.filename)
        return !fs.existsSync(fullPath)
      })

      if (missing.length === 0) {
        addCheck({
          name: 'outputs',
          status: 'ok',
          details: `${targets.length} output file(s) present`
        })
      } else {
        addCheck({
          name: 'outputs',
          status: 'warn',
          details: `${missing.length}/${targets.length} output file(s) missing`,
          hint: 'Run "vaulter sync pull --all" to populate outputs'
        })
      }
    } else {
      addCheck({
        name: 'outputs',
        status: 'skip',
        details: 'no outputs configured'
      })
    }
  }

  // === CHECK 10: Backend connection ===
  try {
    const { connected, error, varsCount } = await testConnection()
    if (connected) {
      addCheck({
        name: 'connection',
        status: 'ok',
        details: varsCount !== undefined ? `connected (${varsCount} vars in ${environment})` : 'connected'
      })
      if (varsCount !== undefined) {
        result.environments[environment] = {
          ...result.environments[environment],
          varsCount,
          isEmpty: varsCount === 0
        }
      }
    } else {
      addCheck({
        name: 'connection',
        status: 'fail',
        details: error || 'failed to connect',
        hint: 'Check backend URL, credentials, and encryption keys'
      })
    }
  } catch (error) {
    addCheck({
      name: 'connection',
      status: 'fail',
      details: (error as Error).message,
      hint: 'Check backend configuration'
    })
  }

  // Calculate summary
  const summary = checks.reduce(
    (acc, check) => {
      acc[check.status] += 1
      return acc
    },
    { ok: 0, warn: 0, fail: 0, skip: 0 }
  )

  result.checks = checks
  result.summary = {
    ...summary,
    healthy: summary.fail === 0
  }
  result.suggestions = suggestions

  // Add high-level suggestions based on state
  if (result.summary.fail > 0) {
    result.suggestions.unshift('⚠️ Fix failing checks before proceeding')
  }

  if (result.environments[environment]?.isEmpty) {
    result.suggestions.push(`Environment "${environment}" is empty. Use vaulter_copy or vaulter_clone_env to populate from another env.`)
  }

  // Format output
  const lines: string[] = []
  lines.push('# Vaulter Doctor Report')
  lines.push('')
  lines.push(`**Project:** ${result.project || '(not set)'}`)
  lines.push(`**Environment:** ${result.environment}`)
  if (result.service) lines.push(`**Service:** ${result.service}`)
  lines.push(`**Backend:** ${result.backend.type} (${result.backend.urls.length > 0 ? result.backend.urls.join(', ') : 'default local'})`)
  lines.push(`**Encryption:** ${result.encryption.mode} (key found: ${result.encryption.keyFound})`)
  lines.push('')

  lines.push('## Checks')
  lines.push('')
  for (const check of checks) {
    const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : check.status === 'fail' ? '✗' : '○'
    lines.push(`${icon} **${check.name}**: ${check.details}`)
    if (check.hint) {
      lines.push(`  → ${check.hint}`)
    }
  }
  lines.push('')

  lines.push('## Summary')
  lines.push(`✓ ok: ${summary.ok} | ⚠ warn: ${summary.warn} | ✗ fail: ${summary.fail} | ○ skip: ${summary.skip}`)
  lines.push('')

  if (result.suggestions.length > 0) {
    lines.push('## Suggestions')
    for (const suggestion of result.suggestions) {
      lines.push(`- ${suggestion}`)
    }
  }

  return {
    content: [{
      type: 'text',
      text: lines.join('\n')
    }]
  }
}

/**
 * Clone environment handler - copies all variables from one env to another
 */
export async function handleCloneEnvCall(
  getClient: (env: Environment) => Promise<{ client: { list: Function; set: Function }; disconnect: () => Promise<void> }>,
  project: string,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const source = args.source as Environment
  const target = args.target as Environment
  const overwrite = args.overwrite === true
  const dryRun = args.dryRun === true

  if (!source || !target) {
    return {
      content: [{
        type: 'text',
        text: 'Error: Both source and target environments are required'
      }]
    }
  }

  if (source === target) {
    return {
      content: [{
        type: 'text',
        text: 'Error: Source and target environments cannot be the same'
      }]
    }
  }

  // Get source client
  const sourceResult = await getClient(source)
  const sourceClient = sourceResult.client

  try {
    // List all vars from source
    const sourceVars = await sourceClient.list({ project, environment: source, service })

    if (sourceVars.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No variables found in ${source} to clone`
        }]
      }
    }

    // Get target client
    const targetResult = await getClient(target)
    const targetClient = targetResult.client

    try {
      // List existing vars in target
      const targetVars = await targetClient.list({ project, environment: target, service })
      const targetKeys = new Set(targetVars.map((v: { key: string }) => v.key))

      const toCopy: Array<{ key: string; value: string; sensitive?: boolean; tags?: string[] }> = []
      const skipped: string[] = []
      const wouldOverwrite: string[] = []

      for (const v of sourceVars) {
        if (targetKeys.has(v.key)) {
          if (overwrite) {
            wouldOverwrite.push(v.key)
            toCopy.push({ key: v.key, value: v.value, sensitive: v.sensitive, tags: v.tags })
          } else {
            skipped.push(v.key)
          }
        } else {
          toCopy.push({ key: v.key, value: v.value, sensitive: v.sensitive, tags: v.tags })
        }
      }

      if (dryRun) {
        const lines = [
          `# Clone Environment Preview`,
          ``,
          `**Source:** ${source} (${sourceVars.length} vars)`,
          `**Target:** ${target}`,
          `**Overwrite:** ${overwrite}`,
          ``,
          `## Would copy (${toCopy.length} vars):`
        ]

        for (const v of toCopy.slice(0, 20)) {
          const type = v.sensitive ? '[secret]' : '[config]'
          lines.push(`- ${v.key} ${type}`)
        }
        if (toCopy.length > 20) {
          lines.push(`- ... and ${toCopy.length - 20} more`)
        }

        if (wouldOverwrite.length > 0) {
          lines.push('')
          lines.push(`## Would overwrite (${wouldOverwrite.length} vars):`)
          for (const k of wouldOverwrite.slice(0, 10)) {
            lines.push(`- ${k}`)
          }
          if (wouldOverwrite.length > 10) {
            lines.push(`- ... and ${wouldOverwrite.length - 10} more`)
          }
        }

        if (skipped.length > 0) {
          lines.push('')
          lines.push(`## Would skip (already exist, use overwrite=true): ${skipped.length} vars`)
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      // Perform the clone
      let copied = 0
      for (const v of toCopy) {
        await targetClient.set({
          key: v.key,
          value: v.value,
          project,
          environment: target,
          service,
          sensitive: v.sensitive,
          tags: v.tags,
          metadata: { source: 'clone', clonedFrom: source }
        })
        copied++
      }

      const lines = [
        `✓ Cloned ${copied} variables from ${source} to ${target}`
      ]
      if (wouldOverwrite.length > 0) {
        lines.push(`  Overwrote ${wouldOverwrite.length} existing vars`)
      }
      if (skipped.length > 0) {
        lines.push(`  Skipped ${skipped.length} existing vars (use overwrite=true to replace)`)
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] }
    } finally {
      await targetResult.disconnect()
    }
  } finally {
    await sourceResult.disconnect()
  }
}

/**
 * Mask a value for display (show first/last few chars)
 */
function maskValue(value: string, maxLen = 30): string {
  if (value.length <= 8) return '***'
  if (value.length <= 16) return value.slice(0, 3) + '***' + value.slice(-3)
  const preview = value.slice(0, 6) + '***' + value.slice(-4)
  return preview.length > maxLen ? preview.slice(0, maxLen) + '...' : preview
}

/**
 * Diff handler - show differences between local and remote
 */
export async function handleDiffCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const showValues = args.showValues === true

  // Find local file
  const configDir = findConfigDir()
  if (!configDir || !config) {
    return {
      content: [{
        type: 'text',
        text: 'Error: No config directory found. Run vaulter init first.'
      }]
    }
  }

  const localFilePath = getEnvFilePathForConfig(config, configDir, environment)

  // Parse local vars
  let localVars: Record<string, string> = {}
  if (fs.existsSync(localFilePath)) {
    localVars = parseEnvFile(localFilePath)
  }

  // Get remote vars
  const remoteVars = await client.export(project, environment, service)

  // Calculate diff
  const allKeys = new Set([...Object.keys(localVars), ...Object.keys(remoteVars)])
  const localOnly: string[] = []
  const remoteOnly: string[] = []
  const different: string[] = []
  const identical: string[] = []

  for (const key of allKeys) {
    const local = localVars[key]
    const remote = remoteVars[key]

    if (local !== undefined && remote === undefined) {
      localOnly.push(key)
    } else if (local === undefined && remote !== undefined) {
      remoteOnly.push(key)
    } else if (local !== remote) {
      different.push(key)
    } else {
      identical.push(key)
    }
  }

  // Build output
  const lines: string[] = []
  lines.push(`# Diff: ${project}/${environment}`)
  lines.push(``)
  lines.push(`**Local file:** ${localFilePath}`)
  lines.push(`**Remote:** ${project}/${environment}${service ? `/${service}` : ''}`)
  lines.push(``)

  if (localOnly.length === 0 && remoteOnly.length === 0 && different.length === 0) {
    lines.push(`✓ **All variables are in sync!**`)
  } else {
    lines.push(`## Summary`)
    lines.push(`- **${localOnly.length}** local-only (would be added on push)`)
    lines.push(`- **${remoteOnly.length}** remote-only (would be added on pull)`)
    lines.push(`- **${different.length}** different values (conflicts)`)
    lines.push(`- **${identical.length}** identical`)
    lines.push(``)

    if (localOnly.length > 0) {
      lines.push(`## Local Only (+ on push)`)
      for (const key of localOnly) {
        const value = showValues ? ` = ${maskValue(localVars[key])}` : ''
        lines.push(`- ${key}${value}`)
      }
      lines.push(``)
    }

    if (remoteOnly.length > 0) {
      lines.push(`## Remote Only (+ on pull)`)
      for (const key of remoteOnly) {
        const value = showValues ? ` = ${maskValue(remoteVars[key])}` : ''
        lines.push(`- ${key}${value}`)
      }
      lines.push(``)
    }

    if (different.length > 0) {
      lines.push(`## Different Values (conflicts)`)
      for (const key of different) {
        if (showValues) {
          lines.push(`- **${key}**`)
          lines.push(`  - local: ${maskValue(localVars[key])}`)
          lines.push(`  - remote: ${maskValue(remoteVars[key])}`)
        } else {
          lines.push(`- ${key}`)
        }
      }
      lines.push(``)
    }

    lines.push(`## Next Steps`)
    if (localOnly.length > 0 || different.length > 0) {
      lines.push(`- \`vaulter sync push -e ${environment}\` → Push local to remote`)
      lines.push(`- \`vaulter sync push -e ${environment} --prune\` → Push and delete remote-only`)
    }
    if (remoteOnly.length > 0) {
      lines.push(`- \`vaulter sync pull -e ${environment}\` → Pull remote to outputs`)
    }
  }

  return {
    content: [{
      type: 'text',
      text: lines.join('\n')
    }]
  }
}
