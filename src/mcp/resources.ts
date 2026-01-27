/**
 * Vaulter MCP Resources
 *
 * Read-only data views for the MCP server.
 * Resources provide static/cached data that doesn't require input parameters.
 * For actions that require input, use Tools instead.
 *
 * Resources (5 types - no redundancy with tools):
 *   vaulter://instructions  → CRITICAL: How vaulter works (READ THIS FIRST!)
 *   vaulter://tools-guide   → Guide on which tools to use for each scenario
 *   vaulter://mcp-config    → MCP configuration with sources
 *   vaulter://config        → Current project configuration (YAML)
 *   vaulter://services      → List of services in monorepo
 *
 * Removed (use Tools instead - avoid redundancy):
 *   ❌ vaulter://keys/*           → use vaulter_key_list / vaulter_key_show tools
 *   ❌ vaulter://project/env/*    → use vaulter_list tool
 *   ❌ vaulter://compare/*        → use vaulter_compare tool
 */

import type { Resource } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import { resolveMcpConfigWithSources } from './tools.js'
import { findConfigDir } from '../lib/config-loader.js'

/**
 * Parse a vaulter:// URI
 *
 * Supported formats (5 resources - no redundancy with tools):
 *   vaulter://instructions  → How vaulter works (critical!)
 *   vaulter://tools-guide   → Guide on which tools to use
 *   vaulter://mcp-config    → MCP configuration sources
 *   vaulter://config        → Project configuration
 *   vaulter://services      → Monorepo services
 */
type ParsedUri =
  | { type: 'instructions' }
  | { type: 'tools-guide' }
  | { type: 'mcp-config' }
  | { type: 'config' }
  | { type: 'services' }
  | null

function parseResourceUri(uri: string): ParsedUri {
  // vaulter://instructions (CRITICAL - must read first!)
  if (uri === 'vaulter://instructions') {
    return { type: 'instructions' }
  }

  // vaulter://tools-guide
  if (uri === 'vaulter://tools-guide') {
    return { type: 'tools-guide' }
  }

  // vaulter://mcp-config (shows WHERE each setting comes from)
  if (uri === 'vaulter://mcp-config') {
    return { type: 'mcp-config' }
  }

  // vaulter://config
  if (uri === 'vaulter://config') {
    return { type: 'config' }
  }

  // vaulter://services
  if (uri === 'vaulter://services') {
    return { type: 'services' }
  }

  return null
}

/**
 * Discover services in a monorepo
 * Looks for directories with .vaulter/config.yaml or deploy/configs or deploy/secrets
 */
function discoverServices(rootDir: string): Array<{ name: string; path: string; hasVaulterConfig: boolean }> {
  const services: Array<{ name: string; path: string; hasVaulterConfig: boolean }> = []

  // Common monorepo patterns
  const searchDirs = ['apps', 'services', 'packages', 'libs']

  for (const dir of searchDirs) {
    const fullPath = path.join(rootDir, dir)
    if (!fs.existsSync(fullPath)) continue

    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const servicePath = path.join(fullPath, entry.name)

        // Check for vaulter config
        const hasVaulterConfig = fs.existsSync(path.join(servicePath, '.vaulter', 'config.yaml'))

        // Check for deploy/configs or deploy/secrets (split mode pattern)
        const hasDeployConfigs = fs.existsSync(path.join(servicePath, 'deploy', 'configs'))
        const hasDeploySecrets = fs.existsSync(path.join(servicePath, 'deploy', 'secrets'))

        if (hasVaulterConfig || hasDeployConfigs || hasDeploySecrets) {
          services.push({
            name: entry.name,
            path: servicePath,
            hasVaulterConfig
          })
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return services
}

/**
 * List available resources
 * Returns 5 static resources (no redundancy with tools)
 */
export async function listResources(): Promise<Resource[]> {
  const resources: Resource[] = []

  // CRITICAL: Instructions resource - MUST BE READ FIRST
  resources.push({
    uri: 'vaulter://instructions',
    name: '⚠️ CRITICAL: How Vaulter Works',
    description: 'IMPORTANT: Read this FIRST before using any vaulter tools. Explains how data is stored and what NOT to do.',
    mimeType: 'text/markdown'
  })

  // Tools Guide - which tool to use for each scenario
  resources.push({
    uri: 'vaulter://tools-guide',
    name: 'Tools Guide',
    description: 'Comprehensive guide on which vaulter tool to use for each scenario. Includes 47 tools organized by category.',
    mimeType: 'text/markdown'
  })

  // MCP Configuration Sources - shows WHERE each setting comes from
  resources.push({
    uri: 'vaulter://mcp-config',
    name: 'MCP Configuration Sources',
    description: 'Shows WHERE each MCP setting comes from (cli, project, project.mcp, global.mcp, or default)',
    mimeType: 'application/json'
  })

  // Always include config resource
  resources.push({
    uri: 'vaulter://config',
    name: 'Project Configuration',
    description: 'Current vaulter project configuration (from .vaulter/config.yaml)',
    mimeType: 'application/yaml'
  })

  // Always include services resource (even if empty)
  resources.push({
    uri: 'vaulter://services',
    name: 'Monorepo Services',
    description: 'List of services discovered in this monorepo',
    mimeType: 'application/json'
  })

  return resources
}

/**
 * Read a resource by URI
 */
export async function handleResourceRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const parsed = parseResourceUri(uri)

  if (!parsed) {
    throw new Error(`Invalid resource URI: ${uri}. Valid resources: vaulter://instructions, vaulter://tools-guide, vaulter://mcp-config, vaulter://config, vaulter://services. For keys/env/compare, use the corresponding tools instead.`)
  }

  switch (parsed.type) {
    case 'instructions':
      return handleInstructionsRead(uri)
    case 'tools-guide':
      return handleToolsGuideRead(uri)
    case 'mcp-config':
      return handleMcpConfigRead(uri)
    case 'config':
      return handleConfigRead(uri)
    case 'services':
      return handleServicesRead(uri)
  }
}

/**
 * Read instructions resource - CRITICAL: How vaulter works
 */
async function handleInstructionsRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const instructions = `# ⚠️ CRITICAL: How Vaulter Works

## 🤖 FOR AI AGENTS: Quick Start

**Step 1: Always call \`vaulter_doctor\` first!**
\`\`\`
vaulter_doctor environment="dev"
\`\`\`
This tells you what's configured, what's missing, and what to fix.

**Step 2: Common tasks and which tool to use:**

| Task | Tool | Example |
|------|------|---------|
| Check health/diagnose | \`vaulter_doctor\` | First step always |
| Clone dev → stg/prd | \`vaulter_clone_env\` | \`source="dev" target="stg" dryRun=true\` |
| Copy specific vars | \`vaulter_copy\` | \`source="dev" target="prd" pattern="DATABASE_*"\` |
| See what's different | \`vaulter_compare\` | \`source="dev" target="prd"\` |
| Set multiple vars | \`vaulter_multi_set\` | \`variables=[{key,value,sensitive}]\` |
| List vars | \`vaulter_list\` | \`environment="dev" showValues=true\` |

**Step 3: If environment is empty:**
\`\`\`
# Preview what would be cloned
vaulter_clone_env source="dev" target="prd" dryRun=true

# Execute the clone
vaulter_clone_env source="dev" target="prd"
\`\`\`

---

## Data Storage Architecture

Vaulter uses **s3db.js** internally, which stores data in **S3 OBJECT METADATA**,
NOT in the object body. This is crucial to understand before using any tools.

## 🔑 Fast Lookups

Vaulter uses deterministic IDs for O(1) operations (no scanning needed).

**Performance:**
- get/set/delete: O(1) direct lookup
- batch operations: N parallel O(1) ops

## ❌ NEVER DO THESE THINGS

1. **NEVER upload files directly to S3**
   \`\`\`bash
   # ❌ WRONG - This creates empty/corrupted data
   aws s3 cp .env s3://bucket/path/file.json
   \`\`\`

2. **NEVER create JSON files manually in S3**
   \`\`\`bash
   # ❌ WRONG - s3db.js doesn't read the object body
   echo '{"KEY": "value"}' | aws s3 cp - s3://bucket/path/vars.json
   \`\`\`

3. **NEVER modify S3 objects using AWS CLI/SDK directly**

## ✅ ALWAYS USE VAULTER CLI

\`\`\`bash
# Push local .env to backend
npx vaulter sync push -e dev

# Pull from backend to local .env
npx vaulter sync pull -e dev

# Set individual variable
npx vaulter var set DATABASE_URL="postgres://..." -e dev

# Bidirectional sync
npx vaulter sync merge -e dev

# List variables
npx vaulter var list -e dev

# For monorepo with service
npx vaulter var set KEY=value -e dev -s api

# Shared variables (apply to all services)
npx vaulter var set LOG_LEVEL=debug -e dev --shared
npx vaulter var list -e dev --shared
\`\`\`

## How Data is Stored

- Each variable is stored as an S3 object
- Values are **encrypted** in S3 metadata headers
- Object body is empty (data is in headers, not body)

## Correct Workflow

1. **Initialize project**: \`npx vaulter init\`
2. **Generate key**: \`npx vaulter key generate\`
3. **Set variables**: \`npx vaulter var set KEY=value -e dev\`
4. **Or push existing .env**: \`npx vaulter sync push -e dev\`
5. **Pull to new machine**: \`npx vaulter sync pull -e dev\`

Never bypass the CLI. The CLI handles encryption, metadata formatting, and s3db.js protocol.

---

## 🔧 MCP Server Configuration

### Option 1: Use Project Config (Recommended)

Configure MCP with \`--cwd\` to point to your project directory:

\`\`\`json
{
  "vaulter": {
    "command": "npx",
    "args": ["vaulter", "mcp", "--cwd", "/path/to/your/project"]
  }
}
\`\`\`

The MCP will automatically read \`.vaulter/config.yaml\` from that directory.

### Option 2: Direct Backend Override

\`\`\`json
{
  "vaulter": {
    "command": "npx",
    "args": ["vaulter", "mcp", "--backend", "s3://your-bucket"]
  }
}
\`\`\`

### Option 3: Project MCP Config (Recommended for teams)

Add \`mcp:\` section to your project's \`.vaulter/config.yaml\`:

\`\`\`yaml
# .vaulter/config.yaml (in your project)
version: "1"
project: apps-lair

mcp:
  default_backend: s3://tetis-vaulter
  default_project: apps-lair
  default_environment: dev
\`\`\`

Then configure MCP with \`VAULTER_CWD\` environment variable:

\`\`\`json
{
  "vaulter": {
    "command": "npx",
    "args": ["vaulter", "mcp"],
    "env": {
      "VAULTER_CWD": "/path/to/your/project"
    }
  }
}
\`\`\`

Or use CLI \`--cwd\` flag:

\`\`\`json
{
  "vaulter": {
    "command": "npx",
    "args": ["vaulter", "mcp", "--cwd", "/path/to/your/project"]
  }
}
\`\`\`

### Option 4: Global MCP Config (User-level defaults)

Create \`~/.vaulter/config.yaml\` with global MCP defaults:

\`\`\`yaml
# ~/.vaulter/config.yaml (global)
mcp:
  default_backend: s3://your-bucket
  default_project: your-project
  default_environment: dev
\`\`\`

### Priority Order

Backend resolution priority (first match wins):
1. CLI \`--backend\` flag
2. Project config backend (\`.vaulter/config.yaml\` → \`backend.url\`)
3. Project MCP config (\`.vaulter/config.yaml\` → \`mcp.default_backend\`)
4. Global MCP config (\`~/.vaulter/config.yaml\` → \`mcp.default_backend\`)
5. Default (\`file://$HOME/.vaulter/store\`)
`

  return {
    contents: [{
      uri,
      mimeType: 'text/markdown',
      text: instructions
    }]
  }
}

/**
 * Read tools guide resource - Which tool to use for each scenario
 */
async function handleToolsGuideRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const guide = `# Vaulter MCP Tools Guide (47 tools)

## 🚨 FOR AI AGENTS: START HERE

Before performing any operations, **ALWAYS call \`vaulter_doctor\` first** to understand the current state:

\`\`\`
vaulter_doctor environment="dev"
\`\`\`

This will tell you:
- If config exists and is valid
- If encryption keys are configured
- If backend is reachable
- If environments have variables or are empty
- What needs to be fixed before proceeding

## Quick Reference

| Scenario | Tool to Use |
|----------|-------------|
| **FIRST: Check health** | \`vaulter_doctor\` ⭐ |
| Clone entire environment | \`vaulter_clone_env\` |
| **Diff local vs remote** | \`vaulter_diff\` ⭐ |
| Read a single variable | \`vaulter_get\` |
| Set/update a variable | \`vaulter_set\` |
| Set shared variable | \`vaulter_set\` with shared=true |
| Delete a variable | \`vaulter_delete\` |
| List all variables | \`vaulter_list\` |
| Export to file format | \`vaulter_export\` |
| Compare environments | \`vaulter_compare\` |
| Copy vars between envs | \`vaulter_copy\` |
| Search across envs | \`vaulter_search\` |
| Check system status | \`vaulter_status\` |
| **Batch: read multiple** | \`vaulter_multi_get\` |
| **Batch: set multiple** | \`vaulter_multi_set\` |
| **Batch: delete multiple** | \`vaulter_multi_delete\` |
| **Local: set override** | \`vaulter_local_set\` |
| **Local: pull with overrides** | \`vaulter_local_pull\` |
| **Local: diff vs base** | \`vaulter_local_diff\` |
| **Snapshot: backup env** | \`vaulter_snapshot_create\` |
| **Snapshot: restore env** | \`vaulter_snapshot_restore\` |

---

## 🩺 Diagnostic Tools (Call First!)

### \`vaulter_doctor\` ⭐ IMPORTANT
**Use for:** Diagnosing configuration health before any operation
\`\`\`
environment: "dev"
\`\`\`
Returns: config status, backend connectivity, encryption keys, local files, suggestions.

**Always call this first when:**
- Starting work on a new project
- Environment seems broken
- You're not sure what's configured
- Need to understand why something isn't working

### \`vaulter_clone_env\`
**Use for:** Cloning ALL variables from one environment to another
\`\`\`
source: "dev"
target: "stg"
dryRun: true  # ALWAYS preview first!
\`\`\`

**When to use:**
- Target environment is empty and needs to be populated
- Setting up a new environment (stg, prd) from dev
- Creating a backup of an environment

### \`vaulter_diff\` ⭐ NEW
**Use for:** Preview differences between local .env file and remote backend
\`\`\`
environment: "dev"
showValues: true  # Show masked values
\`\`\`

**Returns:**
| Symbol | Meaning |
|--------|---------|
| \`+\` | Local only (will be pushed) |
| \`-\` | Remote only (will be pulled or deleted with --prune) |
| \`~\` | Different values (conflict) |
| \`=\` | Identical (synced) |

**When to use:**
- Before push/pull/merge operations
- Daily workflow: check what changed before syncing
- Debug sync issues

---

## 📦 Core Operations (8 tools)

### \`vaulter_get\`
**Use for:** Retrieving a single variable value
\`\`\`
key: "DATABASE_URL"
environment: "dev"
\`\`\`

### \`vaulter_set\`
**Use for:** Setting or updating a variable
\`\`\`
key: "API_KEY"
value: "sk-..."
environment: "dev"
sensitive: true   # true=secret, false=config (default: false)
tags: ["production", "api"]  # optional
shared: true  # optional, for monorepo shared vars
\`\`\`

### \`vaulter_delete\`
**Use for:** Removing a variable
\`\`\`
key: "OLD_CONFIG"
environment: "dev"
\`\`\`

### \`vaulter_list\`
**Use for:** Listing all variables in an environment
\`\`\`
environment: "dev"
showValues: true  # optional, shows actual values
\`\`\`
Returns variables with \`[secret]\` or \`[config]\` type based on \`sensitive\` field.

### \`vaulter_export\`
**Use for:** Exporting variables to different formats
- Formats: shell, env, json, yaml, tfvars, docker-args
\`\`\`
environment: "dev"
format: "json"
\`\`\`

### \`vaulter_sync\`
**Use for:** Bidirectional sync between local .env and backend
\`\`\`
environment: "dev"
dry_run: true  # preview changes first
\`\`\`

### \`vaulter_pull\`
**Use for:** Download from backend to local .env
\`\`\`
environment: "dev"
\`\`\`

### \`vaulter_push\`
**Use for:** Upload local .env to backend
\`\`\`
environment: "dev"
\`\`\`

---

## ⚡ Batch Operations (3 tools)

Batch tools reduce round-trips by operating on multiple variables at once.

### \`vaulter_multi_get\`
**Use for:** Retrieving multiple variables at once
\`\`\`
keys: ["DATABASE_URL", "API_KEY", "SECRET_TOKEN"]
environment: "dev"
\`\`\`

### \`vaulter_multi_set\`
**Use for:** Setting multiple variables in one call
\`\`\`
# Object format (all use default sensitive):
variables: { "VAR1": "val1", "VAR2": "val2" }
environment: "dev"
sensitive: true  # default for all vars

# Or array format with per-variable sensitive:
variables: [
  { key: "DB_URL", value: "xxx", sensitive: true },
  { key: "LOG_LEVEL", value: "debug", sensitive: false }
]
shared: true  # optional, for monorepo shared vars
\`\`\`

### \`vaulter_multi_delete\`
**Use for:** Deleting multiple variables at once
\`\`\`
keys: ["OLD_VAR1", "OLD_VAR2", "DEPRECATED"]
environment: "dev"
\`\`\`

> **When to use batch tools:**
> - Migrating multiple variables at once
> - Cleaning up deprecated keys
> - Setting up new environments
> - Copying configs between services

---

## 🔍 Analysis & Discovery (3 tools)

### \`vaulter_compare\`
**Use for:** Comparing two environments
\`\`\`
source: "dev"
target: "prd"
\`\`\`

### \`vaulter_search\`
**Use for:** Searching variables by pattern
\`\`\`
pattern: "DATABASE_*"
\`\`\`

### \`vaulter_scan\`
**Use for:** Scanning monorepo for packages

---

## 📊 Status & Audit (2 tools)

### \`vaulter_status\`
**Use for:** Comprehensive status (encryption, rotation, audit)
\`\`\`
environment: "dev"
include: ["all"]  # or ["encryption", "rotation", "audit"]
overdue_only: true  # for rotation: only overdue secrets
\`\`\`

### \`vaulter_audit_list\`
**Use for:** Viewing audit log (who changed what when)
\`\`\`
environment: "dev"
user: "john"     # optional
operation: "set" # optional
since: "2024-01-01"  # optional
\`\`\`

---

## 📂 Categorization (1 tool)

### \`vaulter_categorize_vars\`
**Use for:** Seeing which vars are secrets vs configs
\`\`\`
environment: "dev"
\`\`\`
> **Note:** Variables are now explicitly marked as secret/config via the \`sensitive\` field.
> Use \`vaulter_list\` to see \`[secret]\` or \`[config]\` for each variable.

---

## 🔗 Shared Variables (2 tools)

### \`vaulter_shared_list\`
**Use for:** Listing shared monorepo variables
\`\`\`
environment: "dev"
\`\`\`

### \`vaulter_inheritance_info\`
**Use for:** Seeing inheritance for a service
\`\`\`
service: "api"
environment: "dev"
\`\`\`

> **Tip:** Use \`vaulter_set\` with \`shared=true\` to set shared variables

---

## ☸️ Kubernetes Integration (2 tools)

### \`vaulter_k8s_secret\`
**Use for:** Generating K8s Secret YAML
- **Only includes variables with \`sensitive: true\`**
\`\`\`
environment: "prd"
namespace: "my-app"
\`\`\`

### \`vaulter_k8s_configmap\`
**Use for:** Generating K8s ConfigMap YAML
- **Only includes variables with \`sensitive: false\`**

---

## 🏗️ Infrastructure as Code (2 tools)

### \`vaulter_helm_values\`
**Use for:** Generating Helm values.yaml

### \`vaulter_tf_vars\`
**Use for:** Generating Terraform .tfvars

---

## 🔑 Key Management (5 tools)

### \`vaulter_key_generate\`
**Use for:** Generating encryption keys
\`\`\`
asymmetric: true  # for asymmetric encryption
algorithm: "rsa-4096"
\`\`\`

### \`vaulter_key_list\`
**Use for:** Listing all keys

### \`vaulter_key_show\`
**Use for:** Showing key details

### \`vaulter_key_export\`
**Use for:** Exporting key to encrypted bundle

### \`vaulter_key_import\`
**Use for:** Importing key from bundle

---

## 🏢 Monorepo (2 tools)

### \`vaulter_services\`
**Use for:** Listing discovered services

### \`vaulter_init\`
**Use for:** Initializing new project
\`\`\`
mode: "split"  # or "unified"
\`\`\`

---

## 💻 Local Overrides (5 tools)

Local overrides layer on top of a base environment. Plaintext, gitignored, never touch the backend.

### \`vaulter_local_set\`
**Use for:** Setting a local override (never touches backend)
\`\`\`
key: "PORT"
value: "3001"
\`\`\`

### \`vaulter_local_delete\`
**Use for:** Removing a local override
\`\`\`
key: "PORT"
\`\`\`

### \`vaulter_local_pull\`
**Use for:** Generating .env files from base env + local overrides
\`\`\`
all: true  # or output: "web"
\`\`\`

### \`vaulter_local_diff\`
**Use for:** Seeing what's overridden locally vs base env

### \`vaulter_local_status\`
**Use for:** Checking local state (overrides count, snapshots, base env)

---

## 📸 Snapshot Tools (3 tools)

Snapshots are timestamped backups of environment variables.

### \`vaulter_snapshot_create\`
**Use for:** Backup before making changes
\`\`\`
environment: "dev"
name: "before-migration"  # optional
\`\`\`

### \`vaulter_snapshot_list\`
**Use for:** Listing available snapshots
\`\`\`
environment: "dev"  # optional filter
\`\`\`

### \`vaulter_snapshot_restore\`
**Use for:** Rollback to a previous state
\`\`\`
id: "dev_2025-01-15T10-30-00"
environment: "dev"
\`\`\`

---

## Common Workflows

### 1. First time setup
1. \`vaulter_init\` - Initialize project
2. \`vaulter_key_generate\` - Generate encryption key
3. \`vaulter_set\` - Add variables

### 2. CI/CD with GitHub Action (Recommended)
Use the official GitHub Action for automated deployments:

\`\`\`yaml
- uses: forattini-dev/vaulter@v1
  with:
    backend: \${{ secrets.VAULTER_BACKEND }}
    project: my-app
    environment: prd
    outputs: k8s-secret,helm-values,tfvars
  env:
    VAULTER_PASSPHRASE: \${{ secrets.VAULTER_PASSPHRASE }}
\`\`\`

**Supported outputs:** env, json, k8s-secret, k8s-configmap, helm-values, tfvars, shell

### 3. Deploy to Kubernetes (manual)
1. \`vaulter_list\` - Review variables
2. \`vaulter_k8s_secret\` - Generate Secret YAML
3. Apply with kubectl

### 4. Compare before deploy
1. \`vaulter_compare\` - Compare dev vs prd
2. \`vaulter_sync\` with dry_run - Preview changes

### 5. Check system status
1. \`vaulter_status\` - Get encryption, rotation & audit overview
2. \`vaulter_audit_list\` - Detailed audit log

### 6. Monorepo shared variables
1. \`vaulter_shared_list\` - See shared vars
2. \`vaulter_set shared=true\` - Add shared var
3. \`vaulter_inheritance_info\` - Check service inheritance

### 7. Batch operations
1. \`vaulter_multi_set\` - Set multiple vars: \`{ "VAR1": "a", "VAR2": "b" }\`
2. \`vaulter_multi_get\` - Get specific vars: \`["VAR1", "VAR2"]\`
3. \`vaulter_multi_delete\` - Remove deprecated keys: \`["OLD1", "OLD2"]\`

### 8. Copy between environments
1. \`vaulter_copy source="dev" target="stg"\` - Copy all vars
2. \`vaulter_copy source="dev" target="prd" pattern="DATABASE_*"\` - Copy by pattern
3. \`vaulter_copy source="dev" target="prd" keys=["KEY1","KEY2"]\` - Copy specific keys

### 9. Rename variables
1. \`vaulter_rename oldKey="OLD_NAME" newKey="NEW_NAME"\` - Atomic rename

### 10. Promote/demote shared vars
1. \`vaulter_promote_shared key="LOG_LEVEL" fromService="api"\` - Make var shared
2. \`vaulter_demote_shared key="LOG_LEVEL" toService="api"\` - Make var service-specific

### 11. Local development with overrides
1. \`vaulter_local_set key="PORT" value="3001"\` - Override port locally
2. \`vaulter_local_set key="DEBUG" value="true"\` - Override debug
3. \`vaulter_local_pull all=true\` - Generate .env files (base + overrides)
4. \`vaulter_local_diff\` - See what's overridden

### 12. Snapshot backup/restore
1. \`vaulter_snapshot_create environment="dev"\` - Backup before changes
2. Make changes with \`vaulter_multi_set\` etc.
3. \`vaulter_snapshot_restore id="..." environment="dev"\` - Rollback if needed

---

## Utility Tools (4 tools)

### \`vaulter_copy\`
**Use for:** Copy variables between environments
\`\`\`
source: "dev"
target: "prd"
pattern: "DATABASE_*"  # optional
overwrite: false       # default
dryRun: true           # preview first
\`\`\`

### \`vaulter_rename\`
**Use for:** Rename a variable (atomic)
\`\`\`
oldKey: "OLD_NAME"
newKey: "NEW_NAME"
environment: "dev"
\`\`\`

### \`vaulter_promote_shared\`
**Use for:** Promote service var to shared scope
\`\`\`
key: "LOG_LEVEL"
fromService: "api"
deleteOriginal: true  # default
\`\`\`

### \`vaulter_demote_shared\`
**Use for:** Demote shared var to service scope
\`\`\`
key: "DEBUG_MODE"
toService: "api"
deleteShared: true  # default
\`\`\`
`

  return {
    contents: [{
      uri,
      mimeType: 'text/markdown',
      text: guide
    }]
  }
}

/**
 * Read MCP configuration with sources
 * Shows WHERE each setting comes from (cli, project, project.mcp, global.mcp, or default)
 */
async function handleMcpConfigRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const resolved = resolveMcpConfigWithSources()

  // Format for human readability
  const formatted = {
    summary: 'MCP Configuration Sources - shows WHERE each setting was loaded from',
    settings: {
      cwd: {
        value: resolved.cwd.value,
        source: resolved.cwd.source,
        sourceDescription: describeSource(resolved.cwd.source)
      },
      backend: {
        value: resolved.backend.value,
        source: resolved.backend.source,
        sourceDescription: describeSource(resolved.backend.source)
      },
      project: {
        value: resolved.project.value,
        source: resolved.project.source,
        sourceDescription: describeSource(resolved.project.source)
      },
      environment: {
        value: resolved.environment.value,
        source: resolved.environment.source,
        sourceDescription: describeSource(resolved.environment.source)
      },
      key: {
        value: resolved.key.value,
        source: resolved.key.source,
        sourceDescription: describeSource(resolved.key.source)
      },
      encryptionMode: {
        value: resolved.encryptionMode.value,
        source: resolved.encryptionMode.source,
        sourceDescription: describeSource(resolved.encryptionMode.source)
      }
    },
    configFiles: {
      projectConfig: resolved.configFiles.project || '(not found)',
      globalConfig: resolved.configFiles.global || '(not found)'
    },
    priorityChain: [
      '1. CLI flags (--backend, --project, etc.)',
      '2. Project config (backend.url, project)',
      '3. Project MCP defaults (mcp.default_backend, etc.)',
      '4. Global MCP defaults (~/.vaulter/config.yaml → mcp.*)',
      '5. Built-in defaults'
    ]
  }

  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(formatted, null, 2)
    }]
  }
}

/**
 * Human-readable description of a config source
 */
function describeSource(source: string): string {
  switch (source) {
    case 'cli':
      return 'CLI flag (--backend, --project, etc.)'
    case 'project':
      return 'Project config (.vaulter/config.yaml)'
    case 'project.mcp':
      return 'Project MCP defaults (.vaulter/config.yaml → mcp section)'
    case 'global.mcp':
      return 'Global MCP defaults (~/.vaulter/config.yaml → mcp section)'
    case 'default':
      return 'Built-in default'
    default:
      return source
  }
}

/**
 * Read config resource
 */
async function handleConfigRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const configDir = findConfigDir()

  if (!configDir) {
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: '# No .vaulter directory found\n# Run `vaulter init` to create a new project'
      }]
    }
  }

  const configPath = path.join(configDir, 'config.yaml')

  if (!fs.existsSync(configPath)) {
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: '# No config.yaml found in .vaulter directory\n# Run `vaulter init` to create a new project'
      }]
    }
  }

  const content = fs.readFileSync(configPath, 'utf-8')

  return {
    contents: [{
      uri,
      mimeType: 'application/yaml',
      text: `# Vaulter Configuration\n# Path: ${configPath}\n\n${content}`
    }]
  }
}

/**
 * Read services resource
 */
async function handleServicesRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const cwd = process.cwd()
  const services = discoverServices(cwd)

  if (services.length === 0) {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          discovered: false,
          message: 'No services found. This may not be a monorepo or services are not configured.',
          searchedDirs: ['apps', 'services', 'packages', 'libs'],
          hint: 'Services are detected by .vaulter/config.yaml or deploy/configs or deploy/secrets directories'
        }, null, 2)
      }]
    }
  }

  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        discovered: true,
        count: services.length,
        services: services.map(s => ({
          name: s.name,
          path: s.path,
          configured: s.hasVaulterConfig
        }))
      }, null, 2)
    }]
  }
}
