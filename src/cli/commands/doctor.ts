/**
 * Vaulter CLI - Doctor Command
 *
 * Check local and remote configuration health.
 */

import fs from 'node:fs'
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
import { loadKeyForEnv } from '../../lib/keys.js'
import { normalizeOutputTargets, validateOutputsConfig } from '../../lib/outputs.js'
import { createClientFromConfig } from '../lib/create-client.js'
import { ensureRootGitignoreForVaulter } from '../../lib/init-generator.js'
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

  const projectRoot = configDir ? getBaseDir(configDir) : process.cwd()

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
  const hasMonorepoConfig = Boolean(config?.services && config.services.length > 0)
    || Boolean(config?.monorepo?.services_pattern || config?.monorepo?.root)
    || Boolean(config?.deploy?.services?.configs || config?.deploy?.services?.secrets)
    || Boolean(config?.outputs && Object.keys(config.outputs).length > 1)
  const isMonorepo = hasMonorepoConfig && Boolean(config)

  if (config) {
    const configServices = config.services || []
    const serviceNames = configServices.map(s => (typeof s === 'string' ? s : s.name))
    const hasMonorepoStructure = configServices.length > 0 || hasMonorepoConfig

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

  // Root .gitignore hygiene
  try {
    const rootGitignore = ensureRootGitignoreForVaulter(
      projectRoot,
      isMonorepo,
      !applyFixes || args['dry-run'] === true
    )

    if (rootGitignore.missingEntries.length === 0) {
      addCheck({
        name: 'gitignore',
        status: 'ok',
        details: 'required Vaulter entries present in .gitignore'
      })
    } else if (applyFixes && rootGitignore.updated) {
      addCheck({
        name: 'gitignore',
        status: 'ok',
        details: `added ${rootGitignore.missingEntries.length} .gitignore ${rootGitignore.missingEntries.length === 1 ? 'entry' : 'entries'}`
      })
    } else if (args['dry-run'] === true) {
      addCheck({
        name: 'gitignore',
        status: 'warn',
        details: `missing ${rootGitignore.missingEntries.length} required .gitignore ${rootGitignore.missingEntries.length === 1 ? 'entry' : 'entries'} (would add with --fix)`,
        hint: 'Run "vaulter doctor --fix" to update .gitignore'
      })
    } else {
      addCheck({
        name: 'gitignore',
        status: 'warn',
        details: `missing ${rootGitignore.missingEntries.length} required .gitignore ${rootGitignore.missingEntries.length === 1 ? 'entry' : 'entries'}`,
        hint: 'Run "vaulter doctor --fix" to update .gitignore'
      })
    }
  } catch (error) {
    addCheck({
      name: 'gitignore',
      status: 'warn',
      details: `failed to validate .gitignore: ${(error as Error).message}`,
      hint: 'Check filesystem permissions and run in project root'
    })
  }

  // Remote connection check
  let clientConnected = false
  let clientError: string | null = null
  let client: Awaited<ReturnType<typeof createClientFromConfig>> | null = null
  try {
    client = await createClientFromConfig({ args, config, project, environment, verbose })
    await client.connect()
    clientConnected = true
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

  if (clientConnected) {
    const safeBackends = backendUrls.length > 0 ? summarizeBackends(backendUrls) : 'default local store'
    const status: DoctorStatus = backendUrls.length === 0 ? 'warn' : 'ok'
    addCheck({
      name: 'connect',
      status,
      details: `connected (${safeBackends})`,
      hint: backendUrls.length === 0
        ? 'Configure backend.url to use remote storage'
        : undefined
    })
  } else {
    addCheck({
      name: 'connect',
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

  if (jsonOutput) {
    ui.output(JSON.stringify({
      project: project || null,
      service: service || null,
      environment,
      backend: backendUrls.map(redactUrl),
      checks,
      summary,
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

  if (hints.size > 0) {
    ui.log('')
    ui.log(c.header('Next steps:'))
    for (const hint of hints) {
      ui.log(`- ${hint}`)
    }
  }

  process.exit(summary.fail > 0 ? 1 : 0)
}
