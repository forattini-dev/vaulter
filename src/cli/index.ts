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
import { isVaulterError, formatErrorForCli } from '../lib/errors.js'

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
import { runDoctor } from './commands/doctor.js'
import { runKey } from './commands/key.js'
import { runAudit } from './commands/audit.js'
import { runRotation } from './commands/rotation.js'
import { runRun } from './commands/run.js'
import { runNuke } from './commands/nuke.js'
import { runOutput } from './commands/output.js'

// Hierarchical command group routers
import { runVar } from './commands/var/index.js'
import { runSyncGroup } from './commands/sync/index.js'
import { runExportGroup } from './commands/export/index.js'
import { runServiceGroup } from './commands/service/index.js'
import { runLocalGroup } from './commands/local/index.js'
import { runSnapshotGroup } from './commands/snapshot/index.js'
import { runReleaseGroup } from './commands/release/index.js'

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
  strict: true,
  separators: VAULTER_SEPARATORS,
  formatter: vaulterFormatter,
  help: {
    includeGlobalOptionsInCommands: true
  },

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
      description: 'Output target (file path or target name depending on command)'
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
    path: {
      type: 'string',
      description: 'Root path for vaulter config discovery'
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
    },
    confirm: {
      type: 'string',
      description: 'Confirmation token for destructive operations (must match project name)'
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

    doctor: {
      description: 'Check local and remote configuration health',
      options: {
        fix: {
          type: 'boolean',
          default: false,
          description: 'Apply safe repository fixes (currently .gitignore hygiene)'
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
        environments: {
          type: 'string',
          description: 'Comma-separated environments list (e.g., dev,stg,prd)'
        }
      }
    },

    // NEW: Hierarchical var command group
    var: {
      description: 'Variable management commands',
      options: {
        from: {
          type: 'string',
          description: 'Source scope for move operations (shared or service:<name>)'
        },
        to: {
          type: 'string',
          description: 'Destination scope for move operations (shared or service:<name>)'
        },
        overwrite: {
          type: 'boolean',
          default: false,
          description: 'Overwrite destination value when moving'
        },
        'delete-original': {
          type: 'boolean',
          default: true,
          description: 'Delete source variable after move (set false to copy only)'
        }
      },
      commands: {
        get: {
          description: 'Get a single variable',
          positional: [
            { name: 'key', required: true, description: 'Variable name' }
          ],
          options: {
            version: {
              type: 'number',
              description: 'Get specific version (requires versioning enabled)'
            }
          }
        },
        set: {
          description: 'Set variables (supports batch: KEY1=v1 KEY2=v2)'
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
        },
        versions: {
          description: 'List version history for a variable',
          aliases: ['history'],
          positional: [
            { name: 'key', required: true, description: 'Variable name' }
          ],
          options: {
            values: {
              type: 'boolean',
              default: false,
              description: 'Show decrypted values (masked by default)'
            }
          }
        },
        rollback: {
          description: 'Rollback variable to a previous version',
          positional: [
            { name: 'key', required: true, description: 'Variable name' },
            { name: 'version', required: true, description: 'Version number to rollback to' }
          ]
        },
        move: {
          description: 'Move/copy a variable between scopes',
          positional: [
            { name: 'key', required: true, description: 'Variable name' }
          ],
          options: {
            from: {
              type: 'string',
              description: 'Source scope (shared or service:<name>)'
            },
            to: {
              type: 'string',
              description: 'Destination scope (shared or service:<name>)'
            },
            overwrite: {
              type: 'boolean',
              default: false,
              description: 'Overwrite destination value'
            },
            'delete-original': {
              type: 'boolean',
              default: true,
              description: 'Delete source variable after move (set false to copy)'
            }
          }
        }
      }
    },

    // Hierarchical export command group
    export: {
      description: 'Export variables to various formats',
      options: {
        repo: {
          type: 'string',
          description: 'GitHub repository (owner/repo) for github-actions export'
        }
      },
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
        'terraform-json': {
          description: 'Terraform JSON variables file'
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
      options: {
        action: {
          type: 'string',
          description: 'For plan command: merge, push, pull'
        },
        strategy: {
          type: 'string',
          description: 'Conflict strategy: local (default), remote, error'
        },
        values: {
          type: 'boolean',
          default: false,
          description: 'Show masked values in diff output'
        },
        dir: {
          type: 'boolean',
          default: false,
          description: 'Use directory mode: push/pull entire .vaulter/{env}/ structure'
        },
        apply: {
          type: 'boolean',
          default: false,
          description: 'Apply changes for sync plan (without this flag, plan is dry-run)'
        }
      },
      commands: {
        merge: {
          description: 'Two-way merge (local ↔ remote)'
        },
        push: {
          description: 'Push local to remote (use --prune to delete remote-only, --dir for directory mode)'
        },
        pull: {
          description: 'Pull remote to local. Use --all or --output <name>, --dir for directory mode'
        },
        diff: {
          description: 'Show differences between local and remote'
        },
        plan: {
          description: 'Plan/apply sync operation (merge, push, pull) without changing context'
        }
      }
    },

    // High-level release workflow for day-to-day operations
    release: {
      description: 'Plan/apply release-grade changes from local to backend',
      options: {
        action: {
          type: 'string',
          description: 'Used by plan/apply when action is passed without positional value (merge, push, pull)'
        }
      },
      commands: {
        plan: {
          description: 'Plan release changes (preview first, safe by default)'
        },
        apply: {
          description: 'Apply release plan'
        },
        push: {
          description: 'Push local values to backend'
        },
        pull: {
          description: 'Pull backend values (for diagnostics or snapshot capture)'
        },
        merge: {
          description: 'Two-way merge local ↔ remote in release flow'
        },
        diff: {
          description: 'Show environment-level differences'
        },
        status: {
          description: 'Run health check before release'
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
            algorithm: {
              type: 'string',
              description: 'Algorithm: rsa-4096, rsa-2048, ec-p256, ec-p384'
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
        backup: {
          description: 'Backup keys to encrypted bundle',
          options: {
            scope: {
              type: 'string',
              description: 'Scope to backup: all, project, global'
            },
            global: {
              type: 'boolean',
              default: false,
              description: 'Alias for --scope global'
            }
          }
        },
        restore: {
          description: 'Restore keys from encrypted backup',
          options: {
            scope: {
              type: 'string',
              description: 'Scope to restore: all, project, global'
            },
            global: {
              type: 'boolean',
              default: false,
              description: 'Alias for --scope global'
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
        },
        dedupe: {
          description: 'Find and clean duplicate vars between services and __shared__',
          positional: [
            { name: 'action', required: false, description: 'preview | clean | keep-service' }
          ]
        }
      }
    },

    local: {
      description: 'Local development overrides (never touches backend)',
      commands: {
        init: {
          description: 'Create overrides file from base env'
        },
        pull: {
          description: 'Base + overrides → .env outputs'
        },
        push: {
          description: 'Push local overrides to remote backend (share with team)'
        },
        set: {
          description: 'Add local override (KEY=val KEY2::val2)'
        },
        delete: {
          description: 'Remove a local override',
          aliases: ['rm'],
          positional: [
            { name: 'key', required: true, description: 'Variable name' }
          ]
        },
        diff: {
          description: 'Show overrides vs base environment'
        },
        status: {
          description: 'Show local state summary'
        }
      }
    },

    snapshot: {
      description: 'Backup and restore environment snapshots',
      commands: {
        create: {
          description: 'Save snapshot of an environment',
          options: {
            name: {
              type: 'string',
              description: 'Optional name suffix for the snapshot'
            },
            source: {
              type: 'string',
              description: 'Source: cloud (default), local, merged'
            }
          }
        },
        list: {
          description: 'List snapshots',
          aliases: ['ls']
        },
        restore: {
          description: 'Restore snapshot to backend',
          positional: [
            { name: 'id', required: true, description: 'Snapshot ID' }
          ]
        },
        delete: {
          description: 'Remove a snapshot',
          aliases: ['rm'],
          positional: [
            { name: 'id', required: true, description: 'Snapshot ID' }
          ]
        }
      }
    },

    mcp: {
      description: 'Start MCP server for Claude integration',
      options: {
        cwd: {
          type: 'string',
          description: 'Working directory (where to look for .vaulter/config.yaml)',
          short: 'C'
        },
        warmup: {
          type: 'boolean',
          default: false,
          description: 'Warm up backend connections on startup'
        }
      }
    },

    shell: {
      description: 'Launch interactive shell (menu, dashboard, audit, keys)',
      aliases: ['tui', 'ui'],
      positional: [
        { name: 'screen', required: false, description: 'Screen to open: menu, dashboard, audit, keys' }
      ],
      options: {
        cwd: {
          type: 'string',
          description: 'Working directory (project root with .vaulter/config.yaml)'
        }
      }
    },

    config: {
      description: 'Manage configuration',
      commands: {
        show: { description: 'Show config summary (default)' },
        path: { description: 'Show config file path' },
        validate: { description: 'Validate configuration' }
      }
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

    nuke: {
      description: 'Delete all data from backend',
      options: {
        confirm: {
          type: 'string',
          description: 'Project name confirmation (required)'
        }
      }
    },

    output: {
      description: 'Generate .env files in apps from local .vaulter/{env}/ files'
    },

    completion: {
      description: 'Generate shell completion script',
      positional: [
        { name: 'shell', required: true, description: 'Shell type: bash, zsh, or fish' }
      ]
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
 * Convert cli-args-parser result to CLIArgs format
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
    service: opts.service as string | undefined,
    env: opts.env as string | undefined,
    backend: opts.backend as string | undefined,
    key: opts.key as string | undefined,
    verbose: opts.verbose as boolean | undefined,
    'dry-run': opts['dry-run'] as boolean | undefined,
    json: opts.json as boolean | undefined,
    force: opts.force as boolean | undefined,
    all: opts.all as boolean | undefined,
    file: opts.file as string | undefined,
    output: opts.output as string | undefined,
    namespace: opts.namespace as string | undefined,
    format: opts.format as string | undefined,
    // Command-specific options
    monorepo: opts.monorepo as boolean | undefined,
    environments: opts.environments as string | undefined,
    // Key command options
    name: opts.name as string | undefined,
    global: opts.global as boolean | undefined,
    asymmetric: opts.asymmetric as boolean | undefined,
    algorithm: opts.algorithm as string | undefined,
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
    strategy: opts.strategy as 'local' | 'remote' | 'error' | undefined,
    values: opts.values as boolean | undefined,
    action: opts.action as 'merge' | 'push' | 'pull' | undefined,
    apply: opts.apply as boolean | undefined,
    // Key command options
    scope: opts.scope as string | undefined,
    // Export options
    repo: opts.repo as string | undefined,
    'skip-shared': opts['skip-shared'] as boolean | undefined,
    // Nuke command
    confirm: opts.confirm as string | undefined,
    // Sync dir mode
    dir: opts.dir as boolean | undefined,
    path: opts.path as string | undefined,
    from: opts.from as string | undefined,
    to: opts.to as string | undefined,
    deleteOriginal: opts['delete-original'] as boolean | undefined
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

  // Apply global working directory override before resolving config
  const pathArg = opts.path as string | undefined
  if (pathArg) {
    const targetDir = path.resolve(String(pathArg))
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      print.error(`Path does not exist or is not a directory: ${targetDir}`)
      process.exit(1)
    }
    process.chdir(targetDir)
  }

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

      case 'doctor':
        await runDoctor(context)
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

      case 'release':
        await runReleaseGroup(context)
        break

      case 'key':
        await runKey(context)
        break

      case 'local':
        await runLocalGroup(context)
        break

      case 'snapshot':
        await runSnapshotGroup(context)
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
          verbose: opts.verbose as boolean | undefined,
          warmup: opts.warmup as boolean | undefined
        })
        break

      case 'shell':
      case 'tui':
      case 'ui':
        // Shell - dynamically loaded (not available in standalone binaries)
        if (IS_STANDALONE) {
          print.error('Shell is not available in standalone binaries')
          ui.log(`Install via npm/pnpm to use shell: ${c.command('pnpm add -g vaulter')}`)
          process.exit(1)
        }

        // Handle --cwd option: change to specified directory
        const shellCwd = opts.cwd as string | undefined
        if (shellCwd) {
          const targetDir = path.resolve(shellCwd)
          if (!fs.existsSync(targetDir)) {
            print.error(`Directory not found: ${targetDir}`)
            process.exit(1)
          }
          process.chdir(targetDir)
        }

        const shellScreen = context.args._[1] || ''
        switch (shellScreen) {
          case 'audit':
          case 'logs': {
            const { startAuditViewer } = await import('./tui/index.js')
            await startAuditViewer({
              environment: context.environment,
              service: context.service,
              verbose: context.verbose
            })
            break
          }
          case 'keys':
          case 'key': {
            const { startKeyManager } = await import('./tui/index.js')
            await startKeyManager({
              verbose: context.verbose
            })
            break
          }
          case 'menu': {
            const { startLauncher } = await import('./tui/index.js')
            await startLauncher({
              environment: context.environment,
              service: context.service,
              verbose: context.verbose
            })
            break
          }
          case 'tabs': {
            // New tabbed shell (experimental) - F1-F4 to switch tabs
            const { startShell } = await import('./tui/index.js')
            await startShell({
              environment: context.environment,
              service: context.service,
              verbose: context.verbose
            })
            break
          }
          default: {
            // Default: open Secrets Explorer directly (original with full splash)
            const { startSecretsExplorer } = await import('./tui/index.js')
            await startSecretsExplorer({
              service: context.service,
              verbose: context.verbose
            })
            break
          }
        }
        break

      case 'config': {
        const { runConfig } = await import('./commands/config.js')
        await runConfig(context)
        break
      }

      case 'audit':
        await runAudit(context)
        break

      case 'nuke':
        await runNuke(context)
        break

      case 'output':
        await runOutput(context)
        break

      case 'rotation':
        await runRotation(context)
        break

      case 'completion': {
        const shell = context.args._[1] as 'bash' | 'zsh' | 'fish' | undefined
        if (!shell || !['bash', 'zsh', 'fish'].includes(shell)) {
          print.error('Shell type required: bash, zsh, or fish')
          // Use console.error directly to ensure help shows even in non-TTY (pipes, scripts)
          console.error('')
          console.error(`${c.label('Usage:')}`)
          console.error(`  ${c.command('vaulter completion bash')}   # Bash`)
          console.error(`  ${c.command('vaulter completion zsh')}    # Zsh`)
          console.error(`  ${c.command('vaulter completion fish')}   # Fish`)
          console.error('')
          console.error(`${c.label('Add to your shell config:')}`)
          console.error(`  ${c.muted('# Bash (~/.bashrc)')}`)
          console.error(`  ${c.command('eval "$(vaulter completion bash)"')}`)
          console.error('')
          console.error(`  ${c.muted('# Zsh (~/.zshrc)')}`)
          console.error(`  ${c.command('eval "$(vaulter completion zsh)"')}`)
          console.error('')
          console.error(`  ${c.muted('# Fish (~/.config/fish/config.fish)')}`)
          console.error(`  ${c.command('vaulter completion fish | source')}`)
          process.exit(1)
        }
        ui.output(cli.completion(shell))
        break
      }

      default:
        print.error(`Unknown command: ${c.command(command)}`)
        ui.log(`Run "${c.command('vaulter --help')}" for usage information`)
        process.exit(1)
    }
  } catch (err) {
    // Use structured error formatting for VaulterErrors
    if (isVaulterError(err)) {
      print.error(err.message)
      if (err.suggestion) {
        ui.log(`  ${c.muted('Suggestion:')} ${err.suggestion}`)
      }
      if (context.verbose && err.context) {
        ui.log(`  ${c.muted('Context:')} ${JSON.stringify(err.context)}`)
      }
    } else if (context.verbose) {
      ui.log(String(err))
    } else {
      print.error((err as Error).message)
    }
    process.exit(1)
  }
}

// Run
main().catch(err => {
  // Handle uncaught errors at the top level
  const errorMessage = isVaulterError(err)
    ? formatErrorForCli(err)
    : `Fatal error: ${err.message}`
  print.error(errorMessage)
  process.exit(1)
})
