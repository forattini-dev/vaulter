/**
 * Vaulter CLI - Doctor Command
 *
 * Check local and remote configuration health.
 */

import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import {
  findConfigDir,
  getBaseDir,
  getEnvFilePathForConfig,
  getConfigsFilePath,
  getSecretsFilePath,
  isSplitMode,
  isValidEnvironment,
  resolveBackendUrls
} from '../../lib/config-loader.js'
import { isMonorepoConfigMode, buildRootGitignoreDoctorCheck } from '../../lib/doctor-shared.js'
import { SHARED_SERVICE } from '../../lib/shared.js'
import { loadKeyForEnv } from '../../lib/keys.js'
import { parseEnvFile } from '../../lib/env-parser.js'
import { normalizeOutputTargets, validateOutputsConfig } from '../../lib/outputs.js'
import {
  collectScopePolicyIssues,
  formatScopePolicySummary,
  resolveScopePolicy,
  hasBlockingPolicyIssues
} from '../../lib/scope-policy.js'
import { calculateDoctorRisk } from '../../lib/doctor-risk.js'
import { createClientFromConfig } from '../lib/create-client.js'
import * as ui from '../ui.js'
import { c } from '../lib/colors.js'

interface DoctorContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  jsonOutput: boolean
}

type DoctorStatus = 'ok' | 'warn' | 'fail' | 'skip'

interface DoctorCheck {
  name: string
  status: DoctorStatus
  details: string
  hint?: string
}

function formatStatus(status: DoctorStatus): string {
  switch (status) {
    case 'ok':
      return c.success('ok')
    case 'warn':
      return c.warning('warn')
    case 'fail':
      return c.error('fail')
    case 'skip':
      return c.muted('skip')
  }
}

function isLocalBackend(url: string): boolean {
  return url.startsWith('file://') || url.startsWith('memory://')
}

const SENSITIVE_PARAM = /(key|secret|token|sig|signature|access|password|passphrase|cred|session|auth|apikey|api_key)/i

function createTempDoctorKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(6).toString('hex')}`
}

function redactUrl(raw: string): string {
  let masked = raw

  // Mask userinfo between scheme:// and @ (works even with env var placeholders)
  masked = masked.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@]+)@/g, '$1****@')

  // Mask sensitive query params
  masked = masked.replace(/([?&])([^=&#]+)=([^&#]*)/g, (match, sep, key) => {
    if (SENSITIVE_PARAM.test(key)) {
      return `${sep}${key}=****`
    }
    return match
  })

  return masked
}

function summarizeBackends(urls: string[]): string {
  if (urls.length === 0) return 'none'
  return urls.map(redactUrl).join(', ')
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 3)}...`
}

/**
 * Run the doctor command
 */
export async function runDoctor(context: DoctorContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context
  const applyFixes = Boolean(args.fix)

  const checks: DoctorCheck[] = []
  const hints = new Set<string>()

  const addCheck = (check: DoctorCheck) => {
    checks.push(check)
    if (check.hint) hints.add(check.hint)
  }

  const configDir = findConfigDir()
  const configPath = configDir ? path.join(configDir, 'config.yaml') : ''

  // Config presence
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

  const projectRoot = configDir ? getBaseDir(configDir) : null
  const isMonorepo = isMonorepoConfigMode(config)
  const isDryRun = args['dry-run'] === true

  // Project name
  if (!project) {
    addCheck({
      name: 'project',
      status: 'fail',
      details: 'project not set',
      hint: 'Set project in config or use --project'
    })
  } else {
    addCheck({
      name: 'project',
      status: 'ok',
      details: project
    })
  }

  // Environment validation
  if (config) {
    if (!isValidEnvironment(config, environment)) {
      addCheck({
        name: 'environment',
        status: 'warn',
        details: `${environment} not listed in config.environments`,
        hint: `Add ${environment} to config.environments or use -e with a valid env`
      })
    } else {
      addCheck({
        name: 'environment',
        status: 'ok',
        details: environment
      })
    }
  } else {
    addCheck({
      name: 'environment',
      status: 'skip',
      details: environment
    })
  }

  // Monorepo service hints
  if (config) {
    const configServices = config.services || []
    const serviceNames = configServices.map(s => (typeof s === 'string' ? s : s.name))
    const hasMonorepoStructure = configServices.length > 0 || isMonorepo

    if (hasMonorepoStructure) {
      if (!service) {
        addCheck({
          name: 'service',
          status: 'warn',
          details: 'monorepo detected but --service not set',
          hint: 'Use --service <name> (or run "vaulter service scan" to discover services)'
        })
      } else if (serviceNames.length > 0 && !serviceNames.includes(service)) {
        addCheck({
          name: 'service',
          status: 'warn',
          details: `${service} not found in config.services`,
          hint: `Add ${service} to config.services or use a valid service name`
        })
      } else {
        addCheck({
          name: 'service',
          status: 'ok',
          details: service
        })
      }
    }
  }

  // Backend config
  let backendUrls: string[] = []
  let backendSource = 'default'

  if (args.backend) {
    backendUrls = [args.backend]
    backendSource = '--backend'
  } else if (config) {
    backendUrls = resolveBackendUrls(config)
    backendSource = 'config'
  }

  if (backendUrls.length === 0) {
    addCheck({
      name: 'backend',
      status: 'warn',
      details: 'no backend configured (using default local store)',
      hint: 'Set backend.url in config or pass --backend to target remote storage'
    })
  } else {
    const hasRemote = backendUrls.some(url => !isLocalBackend(url))
    addCheck({
      name: 'backend',
      status: 'ok',
      details: `${backendUrls.length} configured (${backendSource}${hasRemote ? ', remote' : ', local'})`
    })
  }

  // Encryption key check
  if (project) {
    try {
      const keyResult = await loadKeyForEnv({ project, environment, config })
      if (keyResult.mode === 'asymmetric') {
        const hasPublic = !!keyResult.publicKey
        const hasPrivate = !!keyResult.key
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
            details: `asymmetric key incomplete (${hasPublic ? 'public' : 'private'} missing)`,
            hint: 'Provide both public and private keys for read/write operations'
          })
        } else {
          addCheck({
            name: 'encryption',
            status: 'ok',
            details: `asymmetric (${keyResult.algorithm || 'rsa-4096'})`
          })
        }
      } else {
        if (!keyResult.key) {
          addCheck({
            name: 'encryption',
            status: 'warn',
            details: 'no encryption key found',
            hint: `Set VAULTER_KEY_${environment.toUpperCase()} or run "vaulter key generate -e ${environment}"`
          })
        } else {
          addCheck({
            name: 'encryption',
            status: 'ok',
            details: `symmetric (${keyResult.source})`
          })
        }
      }
    } catch (error) {
      addCheck({
        name: 'encryption',
        status: 'fail',
        details: (error as Error).message,
        hint: 'Fix encryption config or provide valid keys'
      })
    }
  } else {
    addCheck({
      name: 'encryption',
      status: 'skip',
      details: 'project not resolved'
    })
  }

  // Shared key environment check (if configured)
  if (config?.encryption?.shared_key_environment && project) {
    const sharedEnv = config.encryption.shared_key_environment
    try {
      const sharedKey = await loadKeyForEnv({ project, environment: sharedEnv, config })
      const hasSharedKey = sharedKey.mode === 'asymmetric'
        ? !!sharedKey.publicKey || !!sharedKey.key
        : !!sharedKey.key

      if (!hasSharedKey) {
        addCheck({
          name: 'shared-key',
          status: 'warn',
          details: `no key found for shared_key_environment=${sharedEnv}`,
          hint: `Set VAULTER_KEY_${sharedEnv.toUpperCase()} or generate key for ${sharedEnv}`
        })
      } else {
        addCheck({
          name: 'shared-key',
          status: 'ok',
          details: `${sharedEnv}`
        })
      }
    } catch (error) {
      addCheck({
        name: 'shared-key',
        status: 'warn',
        details: (error as Error).message,
        hint: `Fix shared_key_environment key resolution for ${sharedEnv}`
      })
    }
  }

  // Local env files (unified/split)
  if (config && configDir) {
    if (isSplitMode(config)) {
      const secretsPath = getSecretsFilePath(config, configDir, environment)
      const configsPath = getConfigsFilePath(config, configDir, environment)
      const secretsExists = fs.existsSync(secretsPath)
      const configsExists = fs.existsSync(configsPath)

      if (secretsExists && configsExists) {
        addCheck({
          name: 'local-files',
          status: 'ok',
          details: 'split mode files present'
        })
      } else {
        const missing: string[] = []
        if (!secretsExists) missing.push(secretsPath)
        if (!configsExists) missing.push(configsPath)
        addCheck({
          name: 'local-files',
          status: 'warn',
          details: `missing ${missing.length} file(s)`,
          hint: 'Run "vaulter sync pull -e <env>" or create the files for local use'
        })
      }
    } else {
      const envPath = getEnvFilePathForConfig(config, configDir, environment)
      if (fs.existsSync(envPath)) {
        addCheck({
          name: 'local-files',
          status: 'ok',
          details: 'env file present'
        })
      } else {
        addCheck({
          name: 'local-files',
          status: 'warn',
          details: `missing env file`,
          hint: 'Run "vaulter sync pull -e <env>" or create the env file'
        })
      }
    }
  }

  // Outputs config and files
  if (config) {
    const outputErrors = validateOutputsConfig(config)
    if (outputErrors.length > 0) {
      addCheck({
        name: 'outputs',
        status: 'fail',
        details: outputErrors[0] + (outputErrors.length > 1 ? ` (+${outputErrors.length - 1} more)` : ''),
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

  // Scope policy checks on local files (always available, no backend needed)
  const scopePolicyChecks: ReturnType<typeof collectScopePolicyIssues>[number][] = []
  const scopePolicy = resolveScopePolicy(config?.scope_policy)

  for (const warning of scopePolicy.warnings) {
    hints.add(`Scope policy rule warning: ${warning}`)
  }

  const collectScopePolicyFromKeys = (keys: string[], scope: 'shared' | 'service', targetService?: string) => {
    if (keys.length === 0) return
    scopePolicyChecks.push(
      ...collectScopePolicyIssues(keys, {
        scope,
        service: targetService,
        policyMode: scopePolicy.policyMode,
        rules: scopePolicy.rules
      })
    )
  }

  if (config && configDir && !isSplitMode(config) && fs.existsSync(getEnvFilePathForConfig(config, configDir, environment))) {
    try {
      const localEnvPath = getEnvFilePathForConfig(config, configDir, environment)
      const localKeys = Object.keys(parseEnvFile(localEnvPath))
      collectScopePolicyFromKeys(localKeys, 'shared')
    } catch (error) {
      hints.add(`Failed to parse local env file for scope policy checks: ${(error as Error).message}`)
    }
  }

  if (config && configDir && isSplitMode(config)) {
    try {
      const secretsPath = getSecretsFilePath(config, configDir, environment)
      const configsPath = getConfigsFilePath(config, configDir, environment)
      const splitKeys = [
        ...(fs.existsSync(secretsPath) ? Object.keys(parseEnvFile(secretsPath)) : []),
        ...(fs.existsSync(configsPath) ? Object.keys(parseEnvFile(configsPath)) : [])
      ]
      collectScopePolicyFromKeys(splitKeys, 'shared')
    } catch (error) {
      hints.add(`Failed to parse split local files for scope policy checks: ${(error as Error).message}`)
    }
  }

  addCheck(buildRootGitignoreDoctorCheck({
    projectRoot,
    isMonorepo,
    applyFixes,
    dryRun: isDryRun,
    fixHint: 'Run "vaulter doctor --fix" to update .gitignore',
    skipHint: 'Initialize with vaulter init and rerun from the project root'
  }))

  const getLocalVarMapForDoctor = (): Record<string, string> => {
    if (!config || !configDir) return {}

    let localVarMap: Record<string, string> = {}

    if (isSplitMode(config)) {
      const secretsPath = getSecretsFilePath(config, configDir, environment)
      const configsPath = getConfigsFilePath(config, configDir, environment)

      if (fs.existsSync(secretsPath)) {
        localVarMap = { ...localVarMap, ...parseEnvFile(secretsPath) }
      }
      if (fs.existsSync(configsPath)) {
        localVarMap = { ...localVarMap, ...parseEnvFile(configsPath) }
      }
    } else {
      const envPath = getEnvFilePathForConfig(config, configDir, environment)
      if (fs.existsSync(envPath)) {
        localVarMap = parseEnvFile(envPath)
      }
    }

    return localVarMap
  }

  // Remote connection check
  let clientConnected = false
  let clientError: string | null = null
  let client: Awaited<ReturnType<typeof createClientFromConfig>> | null = null
  let clientVarCount = 0
  try {
    client = await createClientFromConfig({ args, config, project, environment, verbose })
    await client.connect()
    clientConnected = true

    if (project) {
      const sharedVars = await client.list({ project, environment, service: SHARED_SERVICE })
      collectScopePolicyFromKeys(sharedVars.map((value) => value.key), 'shared')

      if (service) {
        const serviceVars = await client.list({ project, environment, service })
        collectScopePolicyFromKeys(serviceVars.map((value) => value.key), 'service', service)
      }

      const baseVars = service
        ? await client.list({ project, environment, service })
        : await client.list({ project, environment })
      clientVarCount = baseVars.length
    }

    if (project) {
      const readStart = Date.now()
      await client.list({ project, environment, service })
      const readMs = Date.now() - readStart

      const listStart = Date.now()
      await client.list({ project, environment, service, limit: 20 })
      const listMs = Date.now() - listStart

      const avgLatency = (readMs + listMs) / 2
      if (avgLatency > 2000) {
        addCheck({
          name: 'latency',
          status: 'warn',
          details: `slow operations (avg: ${Math.round(avgLatency)}ms)`,
          hint: 'Check network connectivity, backend region, or consider a closer backend'
        })
      } else if (avgLatency > 1000) {
        addCheck({
          name: 'latency',
          status: 'warn',
          details: `operations slower than ideal (avg: ${Math.round(avgLatency)}ms)`,
          hint: 'Consider using a backend in a closer region'
        })
      } else {
        addCheck({
          name: 'latency',
          status: 'ok',
          details: `read=${readMs}ms, list=${listMs}ms`
        })
      }

      const permTestKey = createTempDoctorKey('vaulter-healthcheck')
      const permTestValue = `${Date.now()}-${randomBytes(6).toString('hex')}`
      try {
        await client.set({
          key: permTestKey,
          value: permTestValue,
          project,
          environment,
          service,
          metadata: { source: 'healthcheck' as const }
        })

        const read = await client.get(permTestKey, project, environment, service)
        if (!read || read.value !== permTestValue) {
          addCheck({
            name: 'permissions',
            status: 'fail',
            details: 'write succeeded but read failed',
            hint: 'Check read permissions and encryption key'
          })
        } else {
          addCheck({
            name: 'permissions',
            status: 'ok',
            details: 'read/write/delete OK'
          })
        }
      } catch (error) {
        const message = (error as Error).message
        if (message.includes('Access Denied') || message.includes('403')) {
          addCheck({
            name: 'permissions',
            status: 'fail',
            details: 'no write permissions',
            hint: 'Check AWS IAM permissions or MinIO policies'
          })
        } else {
          addCheck({
            name: 'permissions',
            status: 'warn',
            details: `write test failed: ${message.slice(0, 50)}...`,
            hint: 'Check backend permissions and credentials'
          })
        }
      } finally {
        try {
          await client.delete(permTestKey, project, environment, service)
        } catch {
          // ignore
        }
      }

      const encTestKey = createTempDoctorKey('vaulter-encryption-test')
      const encTestValue = `enc-${Date.now()}-${randomBytes(6).toString('hex')}`
      try {
        await client.set({
          key: encTestKey,
          value: encTestValue,
          project,
          environment,
          service,
          metadata: { source: 'healthcheck' as const }
        })

        const read = await client.get(encTestKey, project, environment, service)
        if (!read) {
          addCheck({
            name: 'encryption',
            status: 'fail',
            details: 'round-trip failed (value not found)',
            hint: 'Check encryption configuration'
          })
        } else if (read.value !== encTestValue) {
          addCheck({
            name: 'encryption',
            status: 'fail',
            details: 'round-trip failed (value mismatch)',
            hint: 'Wrong encryption key or corrupted data - check VAULTER_KEY'
          })
        } else {
          addCheck({
            name: 'encryption',
            status: 'ok',
            details: 'round-trip successful (encrypt → decrypt → match)'
          })
        }
      } catch {
        addCheck({
          name: 'encryption',
          status: 'skip',
          details: 'cannot test (write failed)'
        })
      } finally {
        try {
          await client.delete(encTestKey, project, environment, service)
        } catch {
          // ignore
        }
      }

      try {
        const localVarMap = getLocalVarMapForDoctor()
        if (Object.keys(localVarMap).length > 0) {
          const remoteVars = await client.export(project, environment, service)
          const localKeys = Object.keys(localVarMap)
          const remoteKeys = Object.keys(remoteVars)

          const localOnly: string[] = []
          const remoteOnly: string[] = []
          const conflicts: string[] = []

          const localSet = new Set(localKeys)
          const remoteSet = new Set(remoteKeys)

          for (const key of localSet) {
            if (!remoteSet.has(key)) {
              localOnly.push(key)
            } else if (remoteVars[key] !== localVarMap[key]) {
              conflicts.push(key)
            }
          }

          for (const key of remoteSet) {
            if (!localSet.has(key)) remoteOnly.push(key)
          }

          const diffCount = localOnly.length + remoteOnly.length + conflicts.length
          if (diffCount === 0) {
            addCheck({
              name: 'sync-status',
              status: 'ok',
              details: 'local and remote in sync'
            })
          } else if (diffCount > 10) {
            addCheck({
              name: 'sync-status',
              status: 'warn',
              details: `${localOnly.length} local-only, ${remoteOnly.length} remote-only, ${conflicts.length} conflicts`,
              hint: `Run "vaulter sync diff -e ${environment} --values" to see details`
            })
          } else {
            addCheck({
              name: 'sync-status',
              status: 'warn',
              details: `${diffCount} difference(s) detected`,
              hint: `Run "vaulter sync diff -e ${environment}" for details`
            })
          }
        } else {
          addCheck({
            name: 'sync-status',
            status: 'skip',
            details: 'no local file to compare'
          })
        }
      } catch {
        addCheck({
          name: 'sync-status',
          status: 'skip',
          details: 'cannot check sync status'
        })
      }

      const cacheFlag = (process.env.S3DB_CACHE_ENABLED || '').toLowerCase()
      const cacheEnabled = cacheFlag === '1' || cacheFlag === 'true' || cacheFlag === 'yes'
      const perfHints: string[] = []
      if (backendUrls.length > 0 && !cacheEnabled) {
        perfHints.push('Enable S3DB cache: S3DB_CACHE_ENABLED=true, S3DB_CACHE_DRIVER=memory|filesystem, S3DB_CACHE_TTL=300000')
      }
      const warmupFlag = (process.env.VAULTER_MCP_WARMUP || '').toLowerCase()
      const warmupEnabled = warmupFlag === '1' || warmupFlag === 'true' || warmupFlag === 'yes'
      if (!warmupEnabled) {
        perfHints.push('Enable MCP warmup: VAULTER_MCP_WARMUP=1')
      }
      const hasManyEnvs = (config?.environments?.length || 0) >= 4 && !process.env.VAULTER_MCP_SEARCH_CONCURRENCY
      if (hasManyEnvs) {
        perfHints.push('Speed up vaulter_search: VAULTER_MCP_SEARCH_CONCURRENCY=4-8')
      }

      if (perfHints.length > 0) {
        addCheck({
          name: 'perf-config',
          status: 'warn',
          details: 'performance tuning available',
          hint: perfHints.join(' | ')
        })
      } else {
        addCheck({
          name: 'perf-config',
          status: 'skip',
          details: 'no performance suggestions'
        })
      }

      if (config && configDir) {
        const securityIssues: string[] = []
        try {
          const { execSync } = await import('node:child_process')
          const projectRootPath = path.dirname(configDir)
          execSync('git rev-parse --is-inside-work-tree', { cwd: projectRootPath, stdio: 'ignore' })

          const trackedFiles = execSync('git ls-files "*.env" ".vaulter/**/*.env"', {
            cwd: projectRootPath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
          }).trim()

          if (trackedFiles) {
            const files = trackedFiles.split('\n').filter((file) => !file.includes('.example'))
            if (files.length > 0) {
              securityIssues.push(
                `${files.length} .env file(s) tracked in git: ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`
              )
            }
          }
        } catch {
          // ignore when git unavailable
        }

        if (process.platform !== 'win32' && config) {
          const basePath = isSplitMode(config)
            ? getSecretsFilePath(config, configDir!, environment)
            : getEnvFilePathForConfig(config, configDir!, environment)
          if (fs.existsSync(basePath)) {
            const mode = fs.statSync(basePath).mode & 0o777
            if (mode !== 0o600 && mode !== 0o400) {
              securityIssues.push(`.env file has weak permissions (${mode.toString(8)})`)
            }
          }

          if (isSplitMode(config)) {
            const secondaryPath = getConfigsFilePath(config, configDir!, environment)
            if (fs.existsSync(secondaryPath)) {
              const mode = fs.statSync(secondaryPath).mode & 0o777
              if (mode !== 0o600 && mode !== 0o400) {
                securityIssues.push(`.env file has weak permissions (${mode.toString(8)})`)
              }
            }
          }
        }

          if (project && process.platform !== 'win32') {
            try {
              const keyResult = await loadKeyForEnv({ project, environment, config })
              if (keyResult.mode !== 'asymmetric' && keyResult.key && keyResult.key.length < 32) {
                securityIssues.push('weak encryption key (< 32 chars)')
              }
            } catch {
              // ignore
            }
          }

          if (securityIssues.length === 0) {
            addCheck({
              name: 'security',
              status: 'ok',
              details: 'no security issues detected'
            })
        } else if (securityIssues.some((issue) => issue.includes('tracked in git'))) {
          addCheck({
            name: 'security',
            status: 'fail',
            details: securityIssues.join('; '),
            hint: 'Add .env files to .gitignore immediately and remove from git history'
          })
        } else {
          addCheck({
            name: 'security',
            status: 'warn',
            details: securityIssues.join('; '),
            hint: 'Fix security issues: generate stronger keys, fix permissions'
          })
        }
      }
    }
  } catch (error) {
    clientError = (error as Error).message
  } finally {
    if (client) {
      try {
        await client.disconnect()
      } catch {
        // ignore
      }
    }
  }

  const scopePolicyIssues = scopePolicyChecks.flatMap(item => item.issues)
  const scopePolicyRequiresService = Boolean(isMonorepo && !service && config?.services && config.services.length > 0)
  const isBlockingScopePolicy = hasBlockingPolicyIssues(scopePolicyChecks)
  const scopePolicyHint = scopePolicyIssues.length > 0 ? truncate(formatScopePolicySummary(scopePolicyIssues), 900) : undefined
  if (scopePolicyIssues.length > 0) {
    addCheck({
      name: 'scope-policy',
      status: isBlockingScopePolicy ? 'fail' : 'warn',
      details: `${scopePolicyIssues.length} scope-policy issue(s) detected`,
      hint: scopePolicyHint
    })
  } else if (scopePolicyRequiresService) {
    addCheck({
      name: 'scope-policy',
      status: 'warn',
      details: 'shared scope policy validated, service scope was not evaluated',
      hint: 'Run with --service <name> to validate service-specific scope policy'
    })
  } else {
    addCheck({
      name: 'scope-policy',
      status: 'ok',
      details: 'no scope-policy issues detected'
    })
  }

  if (clientConnected) {
    const safeBackends = backendUrls.length > 0 ? summarizeBackends(backendUrls) : 'default local store'
    const varInfo = clientVarCount > 0 ? `, ${clientVarCount} vars` : ''
    const status: DoctorStatus = backendUrls.length === 0 ? 'warn' : 'ok'
    addCheck({
      name: 'connection',
      status,
      details: `connected (${safeBackends}${varInfo})`,
      hint: backendUrls.length === 0
        ? 'Configure backend.url to use remote storage'
        : undefined
    })
  } else {
    addCheck({
      name: 'connection',
      status: 'fail',
      details: clientError || 'failed to connect',
      hint: 'Check backend URL, credentials, and encryption keys'
    })
  }

  const summary = checks.reduce(
    (acc, check) => {
      acc[check.status] += 1
      return acc
    },
    { ok: 0, warn: 0, fail: 0, skip: 0 }
  )
  const risk = calculateDoctorRisk(checks)

  if (jsonOutput) {
    ui.output(JSON.stringify({
      project: project || null,
      service: service || null,
      environment,
      backend: backendUrls.map(redactUrl),
      checks,
      summary,
      risk,
      hints: Array.from(hints)
    }, null, 2))
    process.exit(summary.fail > 0 ? 1 : 0)
  }

  const table = ui.formatTable(
    [
      { key: 'check', header: 'CHECK' },
      { key: 'status', header: 'STATUS' },
      { key: 'details', header: 'DETAILS' }
    ],
    checks.map(check => ({
      check: check.name,
      status: formatStatus(check.status),
      details: check.details
    }))
  )

  ui.output(table)

  ui.log('')
  ui.log(`${c.label('Summary:')} ok=${summary.ok} warn=${summary.warn} fail=${summary.fail} skip=${summary.skip}`)
  const riskLabel = risk.level === 'high' ? c.error(`high`) : risk.level === 'medium' ? c.warning('medium') : c.success('low')
  ui.log(`${c.label('Risk:')} ${riskLabel} (${risk.score}/100)`)

  if (risk.reasons.length > 0) {
    ui.log('')
    ui.log(c.header('Top risk reasons:'))
    for (const reason of risk.reasons) {
      ui.log(`- ${reason}`)
    }
  }

  if (hints.size > 0) {
    ui.log('')
    ui.log(c.header('Next steps:'))
    for (const hint of hints) {
      ui.log(`- ${hint}`)
    }
  }

  process.exit(summary.fail > 0 ? 1 : 0)
}
