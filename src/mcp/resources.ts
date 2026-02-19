/**
 * Vaulter MCP Resources
 *
 * 4 read-only resources exposing project context to AI agents.
 */

import fs from 'node:fs'
import path from 'node:path'
import { getConfigAndDefaults } from './tools.js'
import { findConfigDir } from '../lib/config-loader.js'
import { discoverServicesWithFallback, isMonorepoFromConfig } from '../lib/monorepo.js'

interface McpResource {
  uri: string
  name: string
  description: string
  mimeType: string
}

interface ResourceReadResult {
  contents: Array<{ uri: string; mimeType?: string; text: string }>
  _meta?: Record<string, unknown>
}

/**
 * List available resources
 */
export async function listResources(): Promise<McpResource[]> {
  return [
    {
      uri: 'vaulter://instructions',
      name: 'Vaulter Instructions',
      description: 'How vaulter stores data (s3db.js architecture). Read before any operations.',
      mimeType: 'text/markdown'
    },
    {
      uri: 'vaulter://config',
      name: 'Project Config',
      description: 'Current project vaulter configuration (.vaulter/config.yaml)',
      mimeType: 'text/yaml'
    },
    {
      uri: 'vaulter://services',
      name: 'Monorepo Services',
      description: 'Discovered services in the current monorepo',
      mimeType: 'text/plain'
    },
    {
      uri: 'vaulter://tools-guide',
      name: 'Tools Quick Reference',
      description: 'Which tool to use for each scenario',
      mimeType: 'text/markdown'
    },
    {
      uri: 'vaulter://workflow',
      name: 'Recommended Workflows',
      description: 'Primary local-first and release workflows for VAULTER.',
      mimeType: 'text/markdown'
    }
  ]
}

/**
 * Read a resource by URI
 */
export async function handleResourceRead(uri: string): Promise<ResourceReadResult> {
  switch (uri) {
    case 'vaulter://instructions':
      return { contents: [{ uri, mimeType: 'text/markdown', text: getInstructions() }] }

    case 'vaulter://config':
      return { contents: [{ uri, mimeType: 'text/yaml', text: getConfig() }] }

    case 'vaulter://services':
      return { contents: [{ uri, mimeType: 'text/plain', text: getServices() }] }

    case 'vaulter://tools-guide':
      return { contents: [{ uri, mimeType: 'text/markdown', text: getToolsGuide() }] }

    case 'vaulter://workflow':
      return { contents: [{ uri, mimeType: 'text/markdown', text: getWorkflow() }] }

    default:
      throw new Error(`Unknown resource: ${uri}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource content generators
// ─────────────────────────────────────────────────────────────────────────────

function getInstructions(): string {
  return `# Vaulter — How Data is Stored

## CRITICAL: s3db.js Architecture

Vaulter uses **s3db.js** internally, which stores data in **S3 OBJECT METADATA**,
NOT in the object body. This means:

- **NEVER** upload .env files directly using AWS CLI (\`aws s3 cp\`)
- **NEVER** create JSON files manually in S3
- **NEVER** modify S3 objects outside of vaulter

## Tool Architecture (17 tools)

| Tool | Role |
|------|------|
| \`vaulter_change\` | **Primary mutation entrypoint** — set, delete, move, import to local state |
| \`vaulter_plan\` | Compute diff between local state and backend |
| \`vaulter_apply\` | Push planned changes to backend |
| \`vaulter_run\` | Execute command with vars loaded by vaulter |
| \`vaulter_get\` | Read variable(s) from backend |
| \`vaulter_list\` | List variables from backend |
| \`vaulter_search\` | Search/compare across environments |
| \`vaulter_diff\` | Quick diff (no plan artifacts) |
| \`vaulter_status\` | Health check and scorecard |
| \`vaulter_export\` | Export in k8s, helm, terraform, env formats |
| \`vaulter_key\` | Encryption key management |
| \`vaulter_local\` | Local sync/pull/push for .env files and backend |
| \`vaulter_snapshot\` | Backup and restore |
| \`vaulter_versions\` | Version history and rollback |
| \`vaulter_init\` | Initialize project |
| \`vaulter_services\` | Discover monorepo services |
| \`vaulter_nuke\` | Preview backend deletion |

`vaulter_run` is useful for local tasks like `pnpm build`, `pnpm dev`, `docker compose`, or custom scripts after loading the correct var set.

## Workflow: Local-First Mutations

1. **\`vaulter_change\`** — Edit local state (set/delete/move/import). Writes to \`.vaulter/local/\` only.
2. **\`vaulter_plan\`** — See what would change in backend (diff + scorecard).
3. **\`vaulter_apply\`** — Push planned changes to backend.
4. **\`vaulter_run\`** — Run your command with loaded vars before deploy/build.

## Workflow: Local .env Management

- **\`vaulter_local pull\`** — Generate .env files from local state (offline).
- **\`vaulter_local push\`** / **\`push-all\`** — Push local vars to backend (share with team).
- **\`vaulter_local sync\`** — Download backend vars to local state.

## Sensitive vs Config

- \`sensitive=true\` → secret (encrypted, masked in output)
- \`sensitive=false\` → config (plain text, visible)

CLI syntax: \`KEY=value\` (secret), \`KEY::value\` (config)
`
}

function getConfig(): string {
  const configDir = findConfigDir()
  if (!configDir) return '# No .vaulter/config.yaml found\n# Run vaulter_init to create one.'

  const configPath = path.join(configDir, 'config.yaml')
  if (!fs.existsSync(configPath)) return '# config.yaml not found'

  return fs.readFileSync(configPath, 'utf-8')
}

function getServices(): string {
  const { config } = getConfigAndDefaults()
  if (!config) return 'No configuration found.'
  if (!isMonorepoFromConfig(config)) return 'Not a monorepo project.'

  const services = discoverServicesWithFallback(config)
  if (services.length === 0) return 'No services discovered.'

  const lines = [`Services (${services.length}):`, '']
  for (const svc of services) {
    const relativePath = path.relative(process.cwd(), svc.path)
    lines.push(`  ${svc.name} → ${relativePath || '.'}`)
  }
  return lines.join('\n')
}

function getToolsGuide(): string {
  return `# Vaulter Tools Quick Reference

## Mutation Flow (Local-First)
| Step | Tool | Purpose |
|------|------|---------|
| 1 | \`vaulter_change\` | Edit local state (set/delete/move/import) |
| 2 | \`vaulter_plan\` | Compute diff (local vs backend) |
| 3 | \`vaulter_apply\` | Push changes to backend |
| 4 | \`vaulter_run\` | Execute command with loaded vars |

## Read Operations
| Tool | Purpose |
|------|---------|
| \`vaulter_get\` | Get single var or multi-get via \`keys[]\` |
| \`vaulter_list\` | List vars with optional filter |
| \`vaulter_search\` | Search by pattern or compare environments |
| \`vaulter_diff\` | Quick diff without plan artifacts |

## Status & Health
| Tool | Purpose |
|------|---------|
| \`vaulter_status\` | Scorecard, vars, audit, drift, inventory |

## Export Formats
| Tool | Formats |
|------|---------|
| \`vaulter_export\` | k8s-secret, k8s-configmap, helm, terraform, env, shell, json |

## Key Management
| Tool | Actions |
|------|---------|
| \`vaulter_key\` | generate, list, show, export, import, rotate |

## Local Development
| Tool | Actions |
|------|---------|
| \`vaulter_local\` | pull, push, push-all, sync, set, delete, diff, status, shared-set, shared-delete, shared-list |

## Backup & History
| Tool | Actions |
|------|---------|
| \`vaulter_snapshot\` | create, list, restore, delete |
| \`vaulter_versions\` | list, get, rollback |

## Setup
| Tool | Purpose |
|------|---------|
| \`vaulter_init\` | Initialize project |
| \`vaulter_services\` | Discover monorepo services |
| \`vaulter_nuke\` | Preview backend deletion (CLI-only execution) |

## Common JSON Examples

### Set a secret
\`\`\`json
{ "action": "set", "key": "DATABASE_URL", "value": "postgres://...", "sensitive": true, "scope": "svc-api", "environment": "dev" }
\`\`\`

### Set a config
\`\`\`json
{ "action": "set", "key": "LOG_LEVEL", "value": "debug", "sensitive": false, "scope": "shared", "environment": "dev" }
\`\`\`

### Delete
\`\`\`json
{ "action": "delete", "key": "OLD_VAR", "scope": "shared", "environment": "dev" }
\`\`\`

### Move between scopes
\`\`\`json
{ "action": "move", "key": "DB_URL", "from": "shared", "to": "svc-api" }
\`\`\`

### Import batch
\`\`\`json
{ "action": "import", "vars": { "A": "1", "B": "2" }, "scope": "shared" }
\`\`\`

### Plan
\`\`\`json
{ "environment": "prd" }
\`\`\`

### Run a command
\`\`\`json
{ "command": "pnpm", "args": ["--dir", "apps/api", "build"], "environment": "prd", "service": "api" }
\`\`\`

### Status scorecard
\`\`\`json
{ "action": "scorecard", "environment": "dev" }
\`\`\`
`
}

function getWorkflow(): string {
  return [
    '# Vaulter Workflows',
    '',
    '## 1) Dia a dia do dev (offline first)',
    '',
    '1. `vaulter_change` (CLI: `change`) edits local `.vaulter/local/*` only.',
    '2. `vaulter_plan` shows what would be synchronized to backend.',
    '3. `vaulter_apply` pushes after review.',
    '4. `vaulter_run` (optional) runs your command with loaded vars.',
    '',
    'Use `change set`, `change delete`, `change move` for local-first mutations.',
    '',
    '### MCP equivalent',
    '1. `vaulter_change` (set/delete/move/import)',
    '2. `vaulter_plan`',
    '3. `vaulter_apply`',
    '4. `vaulter_run` (`{"command":"pnpm","args":["build"]}`)',
    '',
    '## 2) Pre-deploy / release gate',
    '',
    '1. `vaulter_plan` (or `status`/`drift`) for review.',
    '2. Fix `status`/`policy` issues before publishing.',
    '3. `vaulter_apply --force` on the highest-criticality environment.',
    '',
    '## 3) Sync / environment diagnostics',
    '',
    '- `vaulter_status` → overall health (scorecard)',
    '- `vaulter_status` action=`drift` → local vs backend inconsistency',
    '- `vaulter_status` action=`inventory` → orphans and cross-env gaps',
    '- `vaulter_status` action=`vars` → local loaded values and scope',
    '',
    '## 4) Local .env workflow',
    '',
    '1. `vaulter_local pull` generates artifacts without backend.',
    '2. `vaulter_local push` publishes only when requested.',
    '3. `vaulter_local sync` re-aligns when needed.',
    '',
    '## 5) CI / Preflight checks',
    '',
    '1. `vaulter_plan --preflight` — dry-run plan that emits scorecard without artifacts.',
    '2. Check `scorecard.health` — `ok` passes, `warning` passes with notes, `critical` blocks.',
    '3. `vaulter_status` action=`scorecard` — full health check with exit code:',
    '   - Exit 0 = healthy',
    '   - Exit 1 = critical issues (block deploy)',
    '   - Exit 2 = warnings (informational)',
  ].join('\n')
}
