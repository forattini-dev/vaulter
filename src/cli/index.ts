/**
 * Vaulter CLI
 *
 * Multi-backend environment variable and secrets manager
 */

// Preload must be first - sets process.maxListeners before other imports
import './preload.js'

import { createCLI, type CommandParseResult, type CLISchema } from 'cli-args-parser'
import type { CLIArgs, VaulterConfig, Environment } from '../types.js'
import { loadConfig, getProjectName } from '../lib/config-loader.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { c, print, vaulterFormatter } from './lib/colors.js'
import * as ui from './ui.js'

// Version is injected at build time or read from package.json
const VERSION = process.env.VAULTER_VERSION || getPackageVersion() || '0.0.0'

function getPackageVersion(): string | undefined {
  try {
    // Handle both ESM (import.meta.url) and CJS (__dirname) contexts
    let baseDir: string
    if (typeof __dirname !== 'undefined') {
      // CJS context
      baseDir = __dirname
    } else if (typeof import.meta?.url === 'string') {
      // ESM context
      baseDir = path.dirname(fileURLToPath(import.meta.url))
    } else {
      return undefined
    }

    // Try to find package.json by walking up the directory tree
    let dir = baseDir
    for (let i = 0; i < 5; i++) {
      const pkgPath = path.join(dir, 'package.json')
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string }
        return pkg.version
      }
      dir = path.dirname(dir)
    }
    return undefined
  } catch {
    return undefined
  }
}

// CLI commands
import { runInit } from './commands/init.js'
import { runKey } from './commands/key.js'
import { runAudit } from './commands/audit.js'
import { runRotation } from './commands/rotation.js'
import { runRun } from './commands/run.js'

// Hierarchical command group routers
import { runVar } from './commands/var/index.js'
import { runSyncGroup } from './commands/sync/index.js'
import { runExportGroup } from './commands/export/index.js'
import { runServiceGroup } from './commands/service/index.js'

// MCP is loaded dynamically (not available in standalone binaries)
const IS_STANDALONE = process.env.VAULTER_STANDALONE === 'true'

/**
 * CLI Schema definition
 */
/**
 * Custom separators for vaulter CLI
 *
 * Enables special syntax for setting variables:
 *   vaulter set KEY=value              → secret (encrypted, file + backend)
 *   vaulter set KEY:=123               → secret typed (number/boolean)
 *   vaulter set PORT::3000             → config (split: file only | unified: file + backend)
 *   vaulter set @tag:sensitive         → metadata
 *
 * In split mode:
 *   secrets → deploy/secrets/<env>.env + remote backend
 *   configs → deploy/configs/<env>.env (git-tracked, no backend)
 */
const VAULTER_SEPARATORS = {
  '=': 'secrets',                        // KEY=value → secrets bucket
  ':=': { to: 'secrets', typed: true },  // KEY:=123 → typed secret
  '::': 'configs',                       // KEY::value → configs bucket (plain text)
  '@': { to: 'meta', prefix: true }      // @tag:value → metadata (prefix mode)
}

const cliSchema: CLISchema = {
  name: 'vaulter',
  version: VERSION,
  description: 'Multi-backend environment variable and secrets manager',
  autoShort: false,
  separators: VAULTER_SEPARATORS,
  formatter: vaulterFormatter,

  // Global options available to all commands
  options: {
    help: {
      short: 'h',
      type: 'boolean',
      default: false,
      description: 'Show help'
    },
    version: {
      type: 'boolean',
      default: false,
      description: 'Show version'
    },
    project: {
      short: 'p',
      type: 'string',
      description: 'Project name (default: from config or directory)'
    },
    service: {
      short: 's',
      type: 'string',
      description: 'Service name (for monorepos, supports comma-separated)'
    },
    env: {
      short: 'e',
      type: 'string',
      description: 'Environment name (as defined in config)'
    },
    backend: {
      short: 'b',
      type: 'string',
      description: 'Backend URL override'
    },
    key: {
      short: 'k',
      type: 'string',
      description: 'Encryption key path or raw key'
    },
    verbose: {
      short: 'v',
      type: 'boolean',
      default: false,
      description: 'Enable verbose output'
    },
    quiet: {
      short: 'q',
      type: 'boolean',
      default: false,
      description: 'Suppress non-essential output (errors still shown)'
    },
    all: {
      type: 'boolean',
      default: false,
      description: 'Apply to all services in monorepo'
    },
    'dry-run': {
      type: 'boolean',
      default: false,
      description: 'Show what would be done without making changes'
    },
    json: {
      type: 'boolean',
      default: false,
      description: 'Output in JSON format'
    },
    force: {
      type: 'boolean',
      default: false,
      description: 'Skip confirmations'
    },
    file: {
      short: 'f',
      type: 'string',
      description: 'File path'
    },
    output: {
      short: 'o',
      type: 'string',
      description: 'Output file path'
    },
    namespace: {
      short: 'n',
      type: 'string',
      description: 'Kubernetes namespace'
    },
    format: {
      type: 'string',
      description: 'Output format'
    },
    // New global options for v1.1
    prune: {
      type: 'boolean',
      default: false,
      description: 'Delete variables that don\'t exist in source (sync push/pull)'
    },
    shared: {
      type: 'boolean',
      default: false,
      description: 'Target shared variables in monorepo'
    },
    'skip-shared': {
      type: 'boolean',
      default: false,
      description: 'Disable shared vars inheritance when exporting service'
    }
  },

  commands: {
    run: {
      description: 'Execute command with env vars loaded (auto-detects environment)',
      aliases: ['exec'],
      options: {
        mode: {
          type: 'string',
          description: 'Force mode: auto, local, deploy, skip (default: auto)'
        }
      }
    },

    init: {
      description: 'Initialize a new .vaulter configuration',
      options: {
        monorepo: {
          type: 'boolean',
          default: false,
          description: 'Force monorepo mode (auto-detected from nx.json, turbo.json, etc.)'
        },
        split: {
          type: 'boolean',
          default: false,
          description: 'DEPRECATED: Use default structure instead'
        }
      }
    },

    // NEW: Hierarchical var command group
    var: {
      description: 'Variable management commands',
      commands: {
        get: {
          description: 'Get a single variable',
          positional: [
            { name: 'key', required: true, description: 'Variable name' }
          ]
        },
        set: {
          description: 'Set variables (supports batch: KEY1=v1 KEY2=v2)',
          positional: [
            { name: 'key', required: false, description: 'Variable name (legacy)' },
            { name: 'value', required: false, description: 'Variable value (legacy)' }
          ]
        },
        delete: {
          description: 'Delete a variable',
          aliases: ['rm', 'remove'],
          positional: [
            { name: 'key', required: true, description: 'Variable name' }
          ]
        },
        list: {
          description: 'List all variables',
          aliases: ['ls'],
          options: {
            'all-envs': {
              type: 'boolean',
              default: false,
              description: 'List across all environments'
            }
          }
        }
      }
    },

    // Hierarchical export command group
    export: {
      description: 'Export variables to various formats',
      commands: {
        shell: {
          description: 'Export for shell eval (default)'
        },
        'k8s-secret': {
          description: 'Kubernetes Secret YAML'
        },
        'k8s-configmap': {
          description: 'Kubernetes ConfigMap YAML'
        },
        helm: {
          description: 'Helm values.yaml'
        },
        terraform: {
          description: 'Terraform .tfvars'
        },
        docker: {
          description: 'Docker --env-file format'
        },
        vercel: {
          description: 'Vercel environment JSON'
        },
        railway: {
          description: 'Railway CLI format'
        },
        fly: {
          description: 'Fly.io secrets format'
        },
        'github-actions': {
          description: 'GitHub Actions gh secret commands'
        }
      }
    },

    // NEW: Hierarchical sync command group
    sync: {
      description: 'Synchronization commands',
      commands: {
        merge: {
          description: 'Two-way merge (local ↔ remote)'
        },
        push: {
          description: 'Push local to remote (use --prune to delete remote-only)'
        },
        pull: {
          description: 'Pull remote to local. Use --all for outputs mode, --output <name> for specific output'
        },
        diff: {
          description: 'Show differences between local and remote'
        }
      }
    },

    key: {
      description: 'Key management commands',
      commands: {
        generate: {
          description: 'Generate a new encryption key',
          options: {
            name: {
              type: 'string',
              description: 'Key name (e.g., master, deploy)'
            },
            global: {
              type: 'boolean',
              default: false,
              description: 'Use global scope instead of project scope'
            },
            asymmetric: {
              type: 'boolean',
              default: false,
              description: 'Generate asymmetric key pair (RSA/EC)'
            },
            asym: {
              type: 'boolean',
              default: false,
              description: 'Alias for --asymmetric'
            },
            algorithm: {
              type: 'string',
              description: 'Algorithm: rsa-4096, rsa-2048, ec-p256, ec-p384'
            },
            alg: {
              type: 'string',
              description: 'Alias for --algorithm'
            }
          }
        },
        export: {
          description: 'Export key to encrypted bundle',
          options: {
            name: {
              type: 'string',
              description: 'Key name to export'
            },
            global: {
              type: 'boolean',
              default: false,
              description: 'Use global scope instead of project scope'
            }
          }
        },
        import: {
          description: 'Import key from encrypted bundle',
          options: {
            name: {
              type: 'string',
              description: 'Key name for imported key (optional, uses name from bundle)'
            },
            global: {
              type: 'boolean',
              default: false,
              description: 'Import to global scope instead of project scope'
            }
          }
        },
        list: {
          description: 'List all keys',
          aliases: ['ls']
        },
        show: {
          description: 'Show key info',
          options: {
            name: {
              type: 'string',
              description: 'Key name to show'
            },
            global: {
              type: 'boolean',
              default: false,
              description: 'Use global scope instead of project scope'
            }
          }
        },
        rotate: {
          description: 'Rotate encryption key'
        }
      }
    },

    // NEW: Hierarchical service command group
    service: {
      description: 'Monorepo service management',
      aliases: ['svc'],
      commands: {
        list: {
          description: 'List services in monorepo',
          aliases: ['ls']
        },
        scan: {
          description: 'Scan for packages (NX, Turborepo, Lerna, pnpm)',
          positional: [
            { name: 'path', required: false, description: 'Root directory' }
          ]
        },
        tree: {
          description: 'Show inheritance tree with shared variables'
        }
      }
    },

    mcp: {
      description: 'Start MCP server for Claude integration',
      options: {
        cwd: {
          type: 'string' as const,
          description: 'Working directory (where to look for .vaulter/config.yaml)',
          aliases: ['C']
        }
      }
    },

    tui: {
      description: 'Launch interactive TUI (menu, dashboard, audit, keys)',
      aliases: ['ui'],
      positional: [
        { name: 'screen', required: false, description: 'Screen to open: menu, dashboard, audit, keys' }
      ]
    },

    config: {
      description: 'Manage configuration'
    },

    audit: {
      description: 'Audit log management',
      commands: {
        list: {
          description: 'List audit entries',
          aliases: ['ls'],
          options: {
            'all-envs': {
              type: 'boolean',
              default: false,
              description: 'List across all environments'
            },
            user: {
              type: 'string',
              description: 'Filter by user'
            },
            operation: {
              type: 'string',
              description: 'Filter by operation (set, delete, sync, push, rotate)'
            },
            pattern: {
              type: 'string',
              description: 'Filter by key pattern (supports * and ? wildcards)'
            },
            source: {
              type: 'string',
              description: 'Filter by source (cli, mcp, api, loader)'
            },
            since: {
              type: 'string',
              description: 'Filter entries after this date (ISO format)'
            },
            until: {
              type: 'string',
              description: 'Filter entries before this date (ISO format)'
            },
            limit: {
              type: 'number',
              description: 'Maximum entries to return (default: 50)'
            }
          }
        },
        show: {
          description: 'Show details of an audit entry',
          positional: [
            { name: 'id', required: true, description: 'Audit entry ID' }
          ]
        },
        stats: {
          description: 'Show audit statistics'
        },
        cleanup: {
          description: 'Delete old audit entries',
          options: {
            retention: {
              type: 'number',
              description: 'Retention period in days (default: 90)'
            }
          }
        }
      }
    },

    rotation: {
      description: 'Secret rotation management',
      commands: {
        check: {
          description: 'Check which secrets need rotation',
          aliases: ['status'],
          options: {
            'all-envs': {
              type: 'boolean',
              default: false,
              description: 'Check across all environments'
            },
            days: {
              type: 'number',
              description: 'Check secrets older than N days (default: 90)'
            }
          }
        },
        set: {
          description: 'Set rotation policy for a secret',
          positional: [
            { name: 'key', required: true, description: 'Secret key name' }
          ],
          options: {
            interval: {
              type: 'string',
              description: 'Rotation interval (e.g., 30d, 90d, 1y)'
            },
            clear: {
              type: 'boolean',
              default: false,
              description: 'Clear rotation policy'
            }
          }
        },
        list: {
          description: 'List secrets with rotation policies',
          aliases: ['ls']
        },
        run: {
          description: 'CI/CD gate - exit 1 if secrets are overdue',
          options: {
            'all-envs': {
              type: 'boolean',
              default: false,
              description: 'Check across all environments'
            },
            overdue: {
              type: 'boolean',
              default: false,
              description: 'Only show overdue secrets'
            },
            pattern: {
              type: 'string',
              description: 'Filter by key pattern (e.g., "*_KEY")'
            },
            days: {
              type: 'number',
              description: 'Override rotation threshold (default: 90)'
            },
            fail: {
              type: 'boolean',
              default: true,
              description: 'Exit with code 1 if secrets need rotation'
            }
          }
        }
      }
    }
  }
}

/**
 * Convert cli-args-parser result to CLIArgs format for backward compatibility
 */
function toCliArgs(result: CommandParseResult): CLIArgs {
  const opts = result.options as Record<string, unknown>
  const pos = result.positional as Record<string, unknown>

  // Build the _ array: command + positional args + rest
  const args: string[] = [...result.command]
  // Add all positional values in order
  for (const value of Object.values(pos)) {
    if (value !== undefined && value !== null) {
      args.push(value as string)
    }
  }
  args.push(...(result.rest as string[]))

  return {
    _: args,
    // Global options
    project: opts.project as string | undefined,
    p: opts.project as string | undefined,
    service: opts.service as string | undefined,
    s: opts.service as string | undefined,
    env: opts.env as string | undefined,
    e: opts.env as string | undefined,
    backend: opts.backend as string | undefined,
    b: opts.backend as string | undefined,
    key: opts.key as string | undefined,
    k: opts.key as string | undefined,
    verbose: opts.verbose as boolean | undefined,
    v: opts.verbose as boolean | undefined,
    'dry-run': opts['dry-run'] as boolean | undefined,
    json: opts.json as boolean | undefined,
    force: opts.force as boolean | undefined,
    all: opts.all as boolean | undefined,
    file: opts.file as string | undefined,
    f: opts.file as string | undefined,
    output: opts.output as string | undefined,
    o: opts.output as string | undefined,
    namespace: opts.namespace as string | undefined,
    n: opts.namespace as string | undefined,
    format: opts.format as string | undefined,
    // Command-specific options
    split: opts.split as boolean | undefined,
    monorepo: opts.monorepo as boolean | undefined,
    // Key command options
    name: opts.name as string | undefined,
    global: opts.global as boolean | undefined,
    asymmetric: opts.asymmetric as boolean | undefined,
    asym: opts.asym as boolean | undefined,
    algorithm: opts.algorithm as string | undefined,
    alg: opts.alg as string | undefined,
    // List command options
    'all-envs': opts['all-envs'] as boolean | undefined,
    // Rotation command options
    days: opts.days as number | undefined,
    interval: opts.interval as string | undefined,
    clear: opts.clear as boolean | undefined,
    // Audit command options
    retention: opts.retention as number | undefined,
    pattern: opts.pattern as string | undefined,
    user: opts.user as string | undefined,
    operation: opts.operation as string | undefined,
    since: opts.since as string | undefined,
    until: opts.until as string | undefined,
    limit: opts.limit as number | undefined,
    source: opts.source as string | undefined,
    // Rotation run options
    overdue: opts.overdue as boolean | undefined,
    fail: opts.fail as boolean | undefined,
    // Sync options
    prune: opts.prune as boolean | undefined,
    shared: opts.shared as boolean | undefined,
    // Export options
    'skip-shared': opts['skip-shared'] as boolean | undefined,
    skipShared: opts['skip-shared'] as boolean | undefined  // camelCase alias
  }
}

/**
 * Separator buckets from cli-args-parser
 */
type SeparatorValue = string | number | boolean | null

/**
 * Build context from parsed args
 */
function buildContext(result: CommandParseResult, config: VaulterConfig | null) {
  const opts = result.options as Record<string, unknown>
  const args = toCliArgs(result)

  // Resolve options
  const environment = (opts.env || config?.default_environment || 'dev') as Environment
  const project = (opts.project || (config ? getProjectName(config) : '')) as string
  const service = (opts.service || config?.service) as string | undefined
  const verbose = (opts.verbose || false) as boolean
  const quiet = (opts.quiet || false) as boolean
  const dryRun = (opts['dry-run'] || false) as boolean
  const jsonOutput = (opts.json || false) as boolean

  // Set global quiet mode for UI
  ui.setQuiet(quiet)

  // Separator buckets (from KEY=value, KEY::value, @tag:value syntax)
  const secrets = (result as Record<string, unknown>).secrets as Record<string, SeparatorValue> | undefined
  const configs = (result as Record<string, unknown>).configs as Record<string, SeparatorValue> | undefined
  const meta = (result as Record<string, unknown>).meta as Record<string, SeparatorValue> | undefined

  return {
    args,
    config,
    project,
    service,
    environment,
    verbose,
    quiet,
    dryRun,
    jsonOutput,
    // Separator buckets
    secrets: secrets ?? {},
    configs: configs ?? {},
    meta: meta ?? {}
  }
}

// Create CLI instance
const cli = createCLI(cliSchema)

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const result = cli.parse(process.argv.slice(2))
  const opts = result.options as Record<string, unknown>

  // Handle help first (before error check, so `get --help` works)
  if (opts.help || result.command.length === 0) {
    ui.output(cli.help(result.command))
    return
  }

  // Handle version
  if (opts.version) {
    ui.output(`vaulter v${VERSION}`)
    return
  }

  // Handle errors from parser (after help/version checks)
  if (result.errors.length > 0) {
    for (const error of result.errors) {
      print.error(error)
    }
    process.exit(1)
  }

  const command = result.command[0]

  // Load configuration
  let config: VaulterConfig | null = null
  try {
    config = loadConfig()
  } catch {
    // Config not found is OK for some commands
  }

  // Build context
  const context = buildContext(result, config)

  try {
    switch (command) {
      case 'run':
      case 'exec':
        await runRun(context)
        break

      case 'init':
        await runInit(context)
        break

      case 'var':
        await runVar(context)
        break

      case 'export':
        await runExportGroup(context)
        break

      case 'sync':
        await runSyncGroup(context)
        break

      case 'key':
        await runKey(context)
        break

      case 'service':
      case 'svc':
        await runServiceGroup(context)
        break

      case 'mcp':
        // MCP server - dynamically loaded (not available in standalone binaries)
        if (IS_STANDALONE) {
          print.error('MCP server is not available in standalone binaries')
          ui.log(`Install via npm/pnpm to use MCP: ${c.command('pnpm add -g vaulter')}`)
          process.exit(1)
        }
        const { startServer } = await import('../mcp/server.js')
        // Pass CLI options to MCP server (e.g., --backend, --cwd flags)
        await startServer({
          backend: opts.backend as string | undefined,
          cwd: opts.cwd as string | undefined,
          verbose: opts.verbose as boolean | undefined
        })
        break

      case 'tui':
      case 'ui':
        // TUI - dynamically loaded (not available in standalone binaries)
        if (IS_STANDALONE) {
          print.error('TUI is not available in standalone binaries')
          ui.log(`Install via npm/pnpm to use TUI: ${c.command('pnpm add -g vaulter')}`)
          process.exit(1)
        }
        const tuiScreen = context.args._[1] || 'menu'
        switch (tuiScreen) {
          case 'dashboard':
          case 'secrets':
            const { startDashboard } = await import('./tui/index.js')
            await startDashboard({
              environment: context.environment,
              service: context.service,
              verbose: context.verbose
            })
            break
          case 'audit':
          case 'logs':
            const { startAuditViewer } = await import('./tui/index.js')
            await startAuditViewer({
              environment: context.environment,
              service: context.service,
              verbose: context.verbose
            })
            break
          case 'keys':
          case 'key':
            const { startKeyManager } = await import('./tui/index.js')
            await startKeyManager({
              verbose: context.verbose
            })
            break
          case 'menu':
          default:
            const { startLauncher } = await import('./tui/index.js')
            await startLauncher({
              environment: context.environment,
              service: context.service,
              verbose: context.verbose,
              screen: tuiScreen !== 'menu' ? tuiScreen : undefined
            })
            break
        }
        break

      case 'config':
        ui.log('config command not yet implemented')
        break

      case 'audit':
        await runAudit(context)
        break

      case 'rotation':
        await runRotation(context)
        break

      default:
        print.error(`Unknown command: ${c.command(command)}`)
        ui.log(`Run "${c.command('vaulter --help')}" for usage information`)
        process.exit(1)
    }
  } catch (err) {
    if (context.verbose) {
      ui.log(String(err))
    } else {
      print.error((err as Error).message)
    }
    process.exit(1)
  }
}

// Run
main().catch(err => {
  print.error(`Fatal error: ${err.message}`)
  process.exit(1)
})
