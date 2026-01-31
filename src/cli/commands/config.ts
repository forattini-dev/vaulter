/**
 * Vaulter CLI - Config Command
 *
 * Show, validate, and manage configuration
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, VaulterConfig } from '../../types.js'
import { findConfigDir, getProjectName, getValidEnvironments, getDefaultEnvironment } from '../../lib/config-loader.js'
import { c, print } from '../lib/colors.js'
import * as ui from '../ui.js'

interface ConfigContext {
  args: CLIArgs
  config: VaulterConfig | null
  verbose: boolean
  jsonOutput: boolean
}

/**
 * Run the config command
 */
export async function runConfig(context: ConfigContext): Promise<void> {
  const { args } = context

  const subcommand = args._[1]

  switch (subcommand) {
    case 'show':
    case undefined:
      await runConfigShow(context)
      break

    case 'path':
      await runConfigPath(context)
      break

    case 'validate':
      await runConfigValidate(context)
      break

    default:
      print.error(`Unknown config subcommand: ${subcommand}`)
      ui.log('Available subcommands: show, path, validate')
      ui.log('')
      ui.log('Examples:')
      ui.log('  vaulter config                  # Show config summary')
      ui.log('  vaulter config show             # Same as above')
      ui.log('  vaulter config show --json      # JSON output')
      ui.log('  vaulter config path             # Show config file path')
      ui.log('  vaulter config validate         # Validate config')
      process.exit(1)
  }
}

/**
 * Show config summary
 */
async function runConfigShow(context: ConfigContext): Promise<void> {
  const { config, jsonOutput, verbose } = context

  const configDir = findConfigDir()

  if (!config) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        error: 'no_config',
        message: 'No configuration found',
        hint: 'Run "vaulter init" to create a config'
      }))
    } else {
      print.error('No configuration found')
      ui.log(`Run "${c.command('vaulter init')}" to create a config`)
    }
    process.exit(1)
  }

  const project = getProjectName(config)
  const environments = getValidEnvironments(config)
  const defaultEnv = getDefaultEnvironment(config)

  if (jsonOutput) {
    ui.output(JSON.stringify({
      configPath: configDir ? path.join(configDir, 'config.yaml') : null,
      project,
      version: config.version || '1',
      environments,
      defaultEnvironment: defaultEnv,
      backend: config.backend?.url ? { url: config.backend.url } : null,
      encryption: {
        mode: config.encryption?.mode || 'symmetric',
        hasKeySource: !!(config.encryption?.key_source || config.encryption?.asymmetric?.key_name),
        sharedKeyEnvironment: config.encryption?.shared_key_environment
      },
      audit: {
        enabled: config.audit?.enabled ?? true,
        retentionDays: config.audit?.retention_days ?? 90
      },
      outputs: config.outputs ? Object.keys(config.outputs) : [],
      services: config.services || []
    }, null, 2))
    return
  }

  // Pretty print
  ui.log(c.label('Vaulter Configuration'))
  ui.log('')

  if (configDir) {
    ui.log(`  ${c.muted('Config:')} ${path.join(configDir, 'config.yaml')}`)
  }
  ui.log(`  ${c.muted('Project:')} ${c.project(project)}`)
  ui.log(`  ${c.muted('Version:')} ${config.version || '1'}`)
  ui.log('')

  ui.log(c.label('Environments'))
  ui.log(`  ${c.muted('Available:')} ${environments.join(', ')}`)
  ui.log(`  ${c.muted('Default:')} ${defaultEnv}`)
  ui.log('')

  ui.log(c.label('Backend'))
  if (config.backend?.url) {
    // Mask credentials in URL
    const url = config.backend.url.replace(/:[^:@]+@/, ':***@')
    ui.log(`  ${c.muted('URL:')} ${url}`)
  } else {
    ui.log(`  ${c.muted('URL:')} ${c.removed('not configured')}`)
  }
  ui.log('')

  ui.log(c.label('Encryption'))
  ui.log(`  ${c.muted('Mode:')} ${config.encryption?.mode || 'symmetric'}`)
  if (config.encryption?.asymmetric?.key_name) {
    ui.log(`  ${c.muted('Key name:')} ${config.encryption.asymmetric.key_name}`)
  }
  if (config.encryption?.shared_key_environment) {
    ui.log(`  ${c.muted('Shared key env:')} ${config.encryption.shared_key_environment}`)
  }
  ui.log('')

  ui.log(c.label('Audit'))
  ui.log(`  ${c.muted('Enabled:')} ${config.audit?.enabled ?? true}`)
  ui.log(`  ${c.muted('Retention:')} ${config.audit?.retention_days ?? 90} days`)

  if (config.outputs && Object.keys(config.outputs).length > 0) {
    ui.log('')
    ui.log(c.label('Output Targets'))
    for (const name of Object.keys(config.outputs)) {
      ui.log(`  ${c.muted('•')} ${name}`)
    }
  }

  if (verbose && config.services && config.services.length > 0) {
    ui.log('')
    ui.log(c.label('Services'))
    for (const svc of config.services) {
      ui.log(`  ${c.muted('•')} ${svc}`)
    }
  }
}

/**
 * Show config file path
 */
async function runConfigPath(context: ConfigContext): Promise<void> {
  const { jsonOutput } = context

  const configDir = findConfigDir()

  if (!configDir) {
    if (jsonOutput) {
      ui.output(JSON.stringify({ error: 'no_config', path: null }))
    } else {
      print.error('No .vaulter directory found')
    }
    process.exit(1)
  }

  const configPath = path.join(configDir, 'config.yaml')

  if (jsonOutput) {
    ui.output(JSON.stringify({
      configDir,
      configPath,
      exists: fs.existsSync(configPath)
    }))
  } else {
    ui.output(configPath)
  }
}

/**
 * Validate config
 */
async function runConfigValidate(context: ConfigContext): Promise<void> {
  const { config, jsonOutput, verbose } = context

  const issues: { level: 'error' | 'warning'; message: string }[] = []

  // Check if config exists
  if (!config) {
    issues.push({ level: 'error', message: 'No configuration found. Run "vaulter init"' })
  } else {
    // Check project name
    if (!config.project) {
      issues.push({ level: 'error', message: 'Missing project name' })
    }

    // Check backend
    if (!config.backend?.url) {
      issues.push({ level: 'warning', message: 'No backend URL configured (local-only mode)' })
    }

    // Check environments
    const envs = config.environments || []
    if (envs.length === 0) {
      issues.push({ level: 'warning', message: 'No environments defined (using defaults)' })
    }

    // Check encryption
    if (!config.encryption?.key_source && !config.encryption?.asymmetric?.key_name) {
      issues.push({ level: 'warning', message: 'No encryption key source configured' })
    }

    // Check outputs
    if (config.outputs) {
      for (const [name, output] of Object.entries(config.outputs)) {
        if (typeof output === 'object' && output !== null) {
          if (!output.path) {
            issues.push({ level: 'error', message: `Output "${name}" missing path` })
          }
        }
      }
    }

    // Check for common misconfigurations
    if (config.encryption?.mode === 'asymmetric' && !config.encryption?.asymmetric?.algorithm) {
      issues.push({ level: 'warning', message: 'Asymmetric mode without algorithm specified (defaulting to rsa-4096)' })
    }

    // Check directories exist
    const configDir = findConfigDir()
    if (configDir) {
      const localDir = path.join(configDir, 'local')
      if (!fs.existsSync(localDir)) {
        issues.push({ level: 'warning', message: 'Local directory not found (.vaulter/local/)' })
      }
    }
  }

  const errors = issues.filter(i => i.level === 'error')
  const warnings = issues.filter(i => i.level === 'warning')

  if (jsonOutput) {
    ui.output(JSON.stringify({
      valid: errors.length === 0,
      errors: errors.map(e => e.message),
      warnings: warnings.map(w => w.message)
    }, null, 2))
  } else {
    if (issues.length === 0) {
      ui.success('Configuration is valid')
      if (verbose) {
        ui.log('')
        ui.log(c.muted('All checks passed'))
      }
    } else {
      if (errors.length > 0) {
        print.error(`Found ${errors.length} error(s)`)
        for (const err of errors) {
          ui.log(`  ${c.removed('✗')} ${err.message}`)
        }
      }

      if (warnings.length > 0) {
        if (errors.length > 0) ui.log('')
        print.warning(`Found ${warnings.length} warning(s)`)
        for (const warn of warnings) {
          ui.log(`  ${c.muted('⚠')} ${warn.message}`)
        }
      }

      if (errors.length > 0) {
        process.exit(1)
      }
    }
  }
}
