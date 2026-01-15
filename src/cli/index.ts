/**
 * Vaulter CLI
 *
 * Multi-backend environment variable and secrets manager
 */

// Preload must be first - sets process.maxListeners before other imports
import './preload.js'

import minimist from 'minimist'
import type { CLIArgs, Environment } from '../types.js'
import { loadConfig, getProjectName } from '../lib/config-loader.js'

// Version is injected at build time or read from package.json
const VERSION = process.env.VAULTER_VERSION || '0.1.0'

// CLI commands
import { runInit } from './commands/init.js'
import { runGet } from './commands/get.js'
import { runSet } from './commands/set.js'
import { runDelete } from './commands/delete.js'
import { runList } from './commands/list.js'
import { runExport } from './commands/export.js'
import { runSync } from './commands/sync.js'
import { runPull } from './commands/pull.js'
import { runPush } from './commands/push.js'
import { runK8sSecret, runK8sConfigMap } from './commands/integrations/kubernetes.js'
import { runHelmValues } from './commands/integrations/helm.js'
import { runTfVars, runTfJson } from './commands/integrations/terraform.js'
import { runKey } from './commands/key.js'
import { runServices } from './commands/services.js'
import { startServer as startMcpServer } from '../mcp/server.js'

/**
 * Parse command line arguments
 */
function parseArgs(): CLIArgs {
  return minimist(process.argv.slice(2), {
    string: ['project', 'p', 'service', 's', 'env', 'e', 'backend', 'b', 'key', 'k', 'file', 'f', 'output', 'o', 'namespace', 'n', 'format'],
    boolean: ['verbose', 'v', 'dry-run', 'json', 'no-color', 'help', 'h', 'version', 'force', 'all'],
    alias: {
      p: 'project',
      s: 'service',
      e: 'env',
      b: 'backend',
      k: 'key',
      v: 'verbose',
      f: 'file',
      o: 'output',
      h: 'help',
      n: 'namespace'
    },
    default: {
      verbose: false,
      'dry-run': false,
      json: false,
      'no-color': false
    }
  }) as CLIArgs
}

/**
 * Show help
 */
function showHelp(): void {
  console.log(`
vaulter - Multi-backend environment variable and secrets manager

Usage:
  vaulter <command> [options]

Commands:
  init                  Initialize a new .vaulter configuration
  get <key>             Get a single environment variable
  set <key> <value>     Set an environment variable
  delete <key>          Delete an environment variable
  list                  List all environment variables
  export                Export variables for shell evaluation
  sync                  Merge local .env file with backend
  pull                  Pull variables from backend to local .env
  push                  Push local .env to backend
  key generate          Generate a new encryption key
  services              List services in monorepo
  config                Manage configuration
  mcp                   Start MCP server for Claude integration

Integration Commands:
  k8s:secret            Generate Kubernetes Secret YAML
  k8s:configmap         Generate Kubernetes ConfigMap YAML
  helm:values           Generate Helm values.yaml
  tf:vars               Generate Terraform .tfvars
  tf:json               Generate Terraform JSON

Global Options:
  -p, --project <name>  Project name (default: from config or directory)
  -s, --service <name>  Service name (for monorepos, supports comma-separated)
  -e, --env <env>       Environment (dev/stg/prd/sbx/dr)
  -b, --backend <url>   Backend URL override
  -k, --key <path>      Encryption key path or raw key
  -v, --verbose         Enable verbose output
  --all                 Apply to all services in monorepo
  --dry-run             Show what would be done without making changes
  --json                Output in JSON format
  --no-color            Disable colored output
  -h, --help            Show this help message
  --version             Show version

Examples:
  # Initialize project
  vaulter init

  # Get a variable
  vaulter get DATABASE_URL -e prd

  # Set a variable
  vaulter set API_KEY "sk-..." -e prd

  # Export for shell
  eval $(vaulter export -e dev)

  # Sync local .env
  vaulter sync -f .env.local -e dev

  # Sync all services in monorepo
  vaulter sync -e dev --all

  # Sync specific services
  vaulter sync -e dev -s svc-auth,svc-api

  # List services in monorepo
  vaulter services

  # Generate K8s secret
  vaulter k8s:secret -e prd | kubectl apply -f -

Documentation: https://github.com/tetis-io/vaulter
`)
}

/**
 * Show version
 */
function showVersion(): void {
  console.log(`vaulter v${VERSION}`)
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs()

  // Handle version
  if (args.version) {
    showVersion()
    return
  }

  // Handle help
  if (args.help || args.h || args._.length === 0) {
    showHelp()
    return
  }

  const command = args._[0]

  // Load configuration
  let config
  try {
    config = loadConfig()
  } catch (err) {
    // Config not found is OK for some commands
    config = null
  }

  // Resolve options
  const environment = (args.env || args.e || config?.default_environment || 'dev') as Environment
  const project = args.project || args.p || (config ? getProjectName(config) : '')
  const service = args.service || args.s || config?.service
  const verbose = args.verbose || args.v || false
  const dryRun = args['dry-run'] || false
  const jsonOutput = args.json || false
  const noColor = args['no-color'] || false

  // Context for commands
  const context = {
    args,
    config,
    project,
    service,
    environment,
    verbose,
    dryRun,
    jsonOutput,
    noColor
  }

  try {
    switch (command) {
      case 'init':
        await runInit(context)
        break

      case 'get':
        await runGet(context)
        break

      case 'set':
        await runSet(context)
        break

      case 'delete':
      case 'rm':
      case 'remove':
        await runDelete(context)
        break

      case 'list':
      case 'ls':
        await runList(context)
        break

      case 'export':
        await runExport(context)
        break

      case 'sync':
        await runSync(context)
        break

      case 'pull':
        await runPull(context)
        break

      case 'push':
        await runPush(context)
        break

      case 'key':
        await runKey(context)
        break

      case 'services':
      case 'svc':
        await runServices(context)
        break

      case 'mcp':
        // MCP server doesn't need config context, it runs standalone
        await startMcpServer()
        break

      case 'config':
        console.log('config command not yet implemented')
        break

      case 'k8s:secret':
        await runK8sSecret(context)
        break

      case 'k8s:configmap':
        await runK8sConfigMap(context)
        break

      case 'helm:values':
        await runHelmValues(context)
        break

      case 'tf:vars':
        await runTfVars(context)
        break

      case 'tf:json':
        await runTfJson(context)
        break

      default:
        console.error(`Unknown command: ${command}`)
        console.error('Run "vaulter --help" for usage information')
        process.exit(1)
    }
  } catch (err) {
    if (verbose) {
      console.error(err)
    } else {
      console.error(`Error: ${(err as Error).message}`)
    }
    process.exit(1)
  }
}

// Run
main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
