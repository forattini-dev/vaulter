# Vaulter MCP Server Reference

Complete reference for the Vaulter Model Context Protocol (MCP) server.

**Stats:** 32 tools | 5 resources | 8 prompts

---

## Quick Start

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "vaulter": {
      "command": "npx",
      "args": ["vaulter", "mcp", "--cwd", "/path/to/project"]
    }
  }
}
```

### Alternative: Environment Variable

```json
{
  "mcpServers": {
    "vaulter": {
      "command": "npx",
      "args": ["vaulter", "mcp"],
      "env": {
        "VAULTER_CWD": "/path/to/project"
      }
    }
  }
}
```

---

## Tools Reference (32)

### Core Operations (5)

#### `vaulter_get`
Get a single environment variable value.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | **Yes** | - | Variable name to retrieve |
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name (monorepo) |

#### `vaulter_set`
Set or update an environment variable (encrypted).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | **Yes** | - | Variable name |
| `value` | string | **Yes** | - | Value to set |
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name (monorepo) |
| `shared` | boolean | No | `false` | Set as shared variable |
| `tags` | string[] | No | - | Tags for categorization |

#### `vaulter_delete`
Delete an environment variable.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | **Yes** | - | Variable name to delete |
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |

#### `vaulter_list`
List all environment variables for a project/environment.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `showValues` | boolean | No | `false` | Show actual values |
| `filter` | string | No | - | Filter pattern (e.g., `DATABASE_*`) |

#### `vaulter_export`
Export variables in various formats.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `format` | string | No | `shell` | Output format: `shell`, `env`, `json`, `yaml`, `tfvars`, `docker-args` |
| `includeShared` | boolean | No | `true` | Include shared variables |

---

### Batch Operations (3)

#### `vaulter_multi_get`
Get multiple variables in a single call.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `keys` | string[] | **Yes** | - | Array of variable names |
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |

**Example:**
```json
{
  "keys": ["DATABASE_URL", "API_KEY", "SECRET_TOKEN"],
  "environment": "prd"
}
```

#### `vaulter_multi_set`
Set multiple variables in a single call.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `variables` | object or array | **Yes** | - | Variables to set |
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `shared` | boolean | No | `false` | Set as shared variables |

**Example (object format):**
```json
{
  "variables": { "VAR1": "value1", "VAR2": "value2" },
  "environment": "dev"
}
```

**Example (array format with tags):**
```json
{
  "variables": [
    { "key": "VAR1", "value": "value1", "tags": ["api"] },
    { "key": "VAR2", "value": "value2" }
  ],
  "shared": true
}
```

#### `vaulter_multi_delete`
Delete multiple variables in a single call.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `keys` | string[] | **Yes** | - | Array of variable names to delete |
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |

---

### Sync Operations (3)

#### `vaulter_sync`
Bidirectional sync between local .env and backend.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `dryRun` | boolean | No | `false` | Preview changes without applying |

#### `vaulter_pull`
Download from backend to local .env file or output targets.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `output` | string | No | auto | Output file path OR output target name (when config has `outputs`) |
| `all` | boolean | No | `false` | Pull to ALL output targets defined in config |

**Output Targets Mode:**

When config has `outputs` section:
- `--all` → Pulls to all defined output targets
- `--output <name>` → Pulls to specific output target (e.g., `web`, `api`)

```bash
# Pull to all outputs
vaulter sync pull --all -e dev

# Pull to specific output
vaulter sync pull --output web -e dev
```

#### `vaulter_push`
Upload local .env file to backend.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `file` | string | No | auto | Input file path |

---

### Analysis & Discovery (2)

#### `vaulter_compare`
Compare variables between two environments.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `source` | string | **Yes** | - | Source environment |
| `target` | string | **Yes** | - | Target environment |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `showValues` | boolean | No | `false` | Show actual values in diff |

#### `vaulter_search`
Search for variables by key pattern.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | string | **Yes** | - | Search pattern (e.g., `DATABASE_*`, `*_SECRET`) |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `environments` | string[] | No | all | Environments to search |

---

### Status & Audit (2)

#### `vaulter_status`
Get comprehensive status including encryption, rotation, and audit.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `include` | string[] | No | `["all"]` | Sections: `encryption`, `rotation`, `audit`, `all` |
| `overdue_only` | boolean | No | `false` | For rotation: only overdue secrets |

#### `vaulter_audit_list`
List audit log entries.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `user` | string | No | - | Filter by user name |
| `operation` | string | No | - | Filter: `set`, `delete`, `sync`, `push`, `rotate`, `deleteAll` |
| `key` | string | No | - | Filter by key pattern |
| `since` | string | No | - | Filter after date (ISO 8601) |
| `until` | string | No | - | Filter before date (ISO 8601) |
| `limit` | number | No | `50` | Maximum entries |

---

### Kubernetes Integration (2)

#### `vaulter_k8s_secret`
Generate Kubernetes Secret YAML.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `namespace` | string | No | auto | K8s namespace |
| `name` | string | No | auto | Secret name |

#### `vaulter_k8s_configmap`
Generate Kubernetes ConfigMap YAML (non-secret variables).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `namespace` | string | No | auto | K8s namespace |
| `name` | string | No | auto | ConfigMap name |

---

### Infrastructure as Code (2)

#### `vaulter_helm_values`
Generate Helm values.yaml with env and secrets sections.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |

#### `vaulter_tf_vars`
Generate Terraform .tfvars file.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `format` | string | No | `tfvars` | Output format: `tfvars`, `json` |

---

### Key Management (6)

#### `vaulter_key_generate`
Generate a new encryption key. Supports per-environment keys for complete isolation.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | No | `master` or `{env}` | Key name (e.g., `master`, `deploy`) |
| `environment` | string | No | - | Target environment (creates key named after env) |
| `project` | string | No | auto | Project name |
| `global` | boolean | No | `false` | Store in global scope (`~/.vaulter/global/`) |
| `asymmetric` | boolean | No | `false` | Generate asymmetric key pair |
| `algorithm` | string | No | `rsa-4096` | Algorithm: `rsa-4096`, `rsa-2048`, `ec-p256`, `ec-p384` |
| `force` | boolean | No | `false` | Overwrite existing key |

**Per-environment keys example:**
```json
// Generate key for production
{
  "tool": "vaulter_key_generate",
  "arguments": { "environment": "prd" }
}

// Result: Key stored at ~/.vaulter/projects/{project}/keys/prd
```

**Multi-app isolation:**
```json
// Each app has its own isolated keys
{ "arguments": { "project": "app-landing", "environment": "prd" } }
{ "arguments": { "project": "app-api", "environment": "prd" } }
// app-landing/prd keys cannot decrypt app-api/prd secrets
```

#### `vaulter_key_list`
List all encryption keys.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | No | auto | Project name |

#### `vaulter_key_show`
Show detailed key information.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | **Yes** | - | Key name |
| `project` | string | No | auto | Project name |
| `global` | boolean | No | `false` | Look in global scope |

#### `vaulter_key_export`
Export key to encrypted bundle.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | **Yes** | - | Key name to export |
| `output` | string | **Yes** | - | Output file path |
| `project` | string | No | auto | Project name |
| `global` | boolean | No | `false` | Export from global scope |

**Note:** Use `VAULTER_EXPORT_PASSPHRASE` env var to set encryption passphrase.

#### `vaulter_key_import`
Import key from encrypted bundle.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | **Yes** | - | Input bundle file |
| `name` | string | No | original | New name for imported key |
| `project` | string | No | auto | Project name |
| `global` | boolean | No | `false` | Import to global scope |
| `force` | boolean | No | `false` | Overwrite existing key |

#### `vaulter_key_rotate`
Rotate encryption key. Exports all variables, generates new key, re-encrypts everything.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name (for monorepos) |
| `keyName` | string | No | `master` | Key name to rotate |
| `dryRun` | boolean | No | `false` | Preview what would be rotated |

**Process:**
1. Exports all variables (decrypted) from all environments
2. Backs up current key to `~/.vaulter/projects/{project}/keys/{key}-backup-{timestamp}`
3. Generates new encryption key
4. Re-encrypts all variables with new key

**Example:**
```json
// Preview rotation
{
  "tool": "vaulter_key_rotate",
  "arguments": { "dryRun": true }
}

// Perform rotation
{
  "tool": "vaulter_key_rotate",
  "arguments": {}
}
```

---

### Monorepo Support (5)

#### `vaulter_init`
Initialize a new vaulter project.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | No | auto | Project name |
| `backend` | string | No | - | Backend URL |
| `monorepo` | boolean | No | `false` | Force monorepo mode |
| `environments` | string[] | No | `["dev", "sdx", "prd"]` | Environments to create |

#### `vaulter_scan`
Scan monorepo for packages/apps.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | No | `.` | Root directory to scan |
| `format` | string | No | `text` | Output format: `text`, `json` |

Detects: NX, Turborepo, Lerna, pnpm workspaces, Yarn workspaces, Rush.

#### `vaulter_services`
List discovered services in monorepo.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `detailed` | boolean | No | `false` | Show environments and backend URLs |

#### `vaulter_shared_list`
List shared variables (apply to all services).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `showValues` | boolean | No | `false` | Show actual values |

#### `vaulter_inheritance_info`
Show inheritance information for a service.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `service` | string | **Yes** | - | Service name |
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |

---

### Categorization (1)

#### `vaulter_categorize_vars`
Categorize variables by secret patterns.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |

Shows which variables would be treated as secrets vs configs based on naming patterns.

---

### Dangerous Operations (1)

#### `vaulter_nuke_preview`
Preview what would be deleted by a nuke operation.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | No | auto | Project name |

**⚠️ Important:** This tool only previews what would be deleted. The actual deletion must be executed via CLI for safety:

```bash
# Preview via MCP
vaulter_nuke_preview project="my-project"

# Execute via CLI (requires --confirm flag)
vaulter nuke --confirm=my-project
```

Returns:
- Summary of data that would be deleted
- Count of variables per environment
- CLI command to execute the actual nuke

---

## Resources Reference (5)

Resources provide static/cached data that doesn't require input parameters. They are read-only and ideal for getting context before using tools.

| URI | Description | MIME Type | When to Use |
|-----|-------------|-----------|-------------|
| `vaulter://instructions` | **⚠️ Read first!** How vaulter works | `text/markdown` | Before any other operation |
| `vaulter://tools-guide` | Which tool to use for each scenario | `text/markdown` | When unsure which tool to use |
| `vaulter://mcp-config` | MCP settings with sources | `application/json` | Debugging configuration issues |
| `vaulter://config` | Project configuration (YAML) | `application/yaml` | Understanding project setup |
| `vaulter://services` | Monorepo services list | `application/json` | Working with monorepos |

---

### `vaulter://instructions`

**⚠️ CRITICAL - Read this first before using any vaulter tools.**

Contains essential information about:

1. **Data Storage Architecture**
   - s3db.js stores data in S3 object **metadata**, NOT the body
   - Each variable = one S3 object with encrypted value in headers

2. **Deterministic ID Format**
   ```
   {project}|{environment}|{service}|{key}
   ```
   - Single repo: `myproject|dev||DATABASE_URL`
   - Monorepo: `myproject|dev|api|DATABASE_URL`
   - Shared var: `myproject|dev||SHARED_KEY`

3. **What NOT to Do**
   - ❌ Never upload files directly to S3 (`aws s3 cp`)
   - ❌ Never create JSON files manually in S3
   - ❌ Never modify S3 objects using AWS CLI/SDK directly

4. **MCP Configuration Options**
   - CLI flags, project config, global config priority

---

### `vaulter://tools-guide`

Comprehensive guide on which tool to use for each scenario. Includes:

| Scenario | Recommended Tool |
|----------|------------------|
| Read a single variable | `vaulter_get` |
| Set/update a variable | `vaulter_set` |
| Set shared variable (monorepo) | `vaulter_set` with `shared=true` |
| Delete a variable | `vaulter_delete` |
| List all variables | `vaulter_list` |
| Export to file format | `vaulter_export` |
| Compare environments | `vaulter_compare` |
| Batch read multiple | `vaulter_multi_get` |
| Batch set multiple | `vaulter_multi_set` |
| Batch delete multiple | `vaulter_multi_delete` |

Also covers:
- Core operations (8 tools)
- Batch operations (3 tools)
- Analysis & Discovery (3 tools)
- Status & Audit (2 tools)
- K8s/IaC Integration (4 tools)
- Key Management (5 tools)
- Monorepo Support (5 tools)

---

### `vaulter://mcp-config`

Shows WHERE each MCP setting comes from with a priority chain. Useful for debugging configuration issues.

**Example output:**
```json
{
  "config": {
    "backend": "s3://tetis-vaulter",
    "project": "apps-lair",
    "environment": "dev",
    "service": null
  },
  "sources": {
    "backend": "project",      // from .vaulter/config.yaml → backend.url
    "project": "project",      // from .vaulter/config.yaml → project
    "environment": "project.mcp",  // from .vaulter/config.yaml → mcp.default_environment
    "service": "default"       // no configuration found, using default
  },
  "priority": [
    "1. CLI flags (--backend, --project, etc.)",
    "2. Project config (.vaulter/config.yaml → backend.url)",
    "3. Project MCP config (.vaulter/config.yaml → mcp.*)",
    "4. Global MCP config (~/.vaulter/config.yaml → mcp.*)",
    "5. Default values"
  ]
}
```

---

### `vaulter://config`

Returns the current project configuration from `.vaulter/config.yaml`.

**Example output:**
```yaml
version: "1"
project: apps-lair
default_environment: dev

environments:
  - dev
  - sdx
  - prd

backend:
  url: s3://tetis-vaulter
  region: us-east-1

encryption:
  key_source:
    - env: VAULTER_KEY
    - file: ~/.vaulter/projects/apps-lair/keys/master
    - inline: "fallback-dev-key"

outputs:
  web:
    path: apps/web
    filename: .env.local
    include: [NEXT_PUBLIC_*]
```

---

### `vaulter://services`

Lists all services discovered in a monorepo. Services are detected by looking for:
- `.vaulter/config.yaml` in subdirectories
- `deploy/configs` or `deploy/secrets` directories

**Example output:**
```json
{
  "services": [
    {
      "name": "app-landing",
      "path": "apps/app-landing",
      "hasVaulterConfig": false
    },
    {
      "name": "svc-auth",
      "path": "apps/svc-auth",
      "hasVaulterConfig": true
    }
  ],
  "searchedDirs": ["apps", "services", "packages", "libs"],
  "monorepoRoot": "/home/user/project"
}
```

---

## Prompts Reference (8)

Prompts are pre-configured workflow templates that guide Claude through common tasks. They combine multiple tools and provide structured guidance.

| Prompt | Purpose | Key Arguments |
|--------|---------|---------------|
| `setup_project` | Initialize new project | `project_name`, `mode`, `backend` |
| `migrate_dotenv` | Import .env files | `file_path`, `environment` |
| `deploy_secrets` | Deploy to Kubernetes | `environment`, `namespace` |
| `compare_environments` | Diff two environments | `source_env`, `target_env` |
| `security_audit` | Check for security issues | `environment`, `strict` |
| `rotation_workflow` | Manage secret rotation | `environment`, `action` |
| `shared_vars_workflow` | Manage monorepo shared vars | `action`, `environment` |
| `batch_operations` | Bulk variable operations | `operation`, `variables` |

---

### `setup_project`

Initialize a new vaulter project with guided setup.

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `project_name` | **Yes** | - | Project name (e.g., `my-app`, `api-service`) |
| `mode` | No | `unified` | `unified` (single .env) or `split` (configs/secrets dirs) |
| `backend` | No | `file` | Storage: `s3`, `minio`, `r2`, `file`, `memory` |

**Example conversation:**
```
User: Set up a new vaulter project called "my-api" using S3

Claude: I'll use the setup_project prompt to guide you through initialization...
→ Uses vaulter_init with project="my-api", backend="s3"
→ Uses vaulter_key_generate to create encryption key
→ Provides next steps for configuration
```

---

### `migrate_dotenv`

Migrate existing .env files to vaulter. Analyzes files, identifies secrets vs configs, and syncs to backend.

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `file_path` | **Yes** | - | Path to .env file (e.g., `.env.local`, `.env.production`) |
| `environment` | **Yes** | - | Target environment: `dev`, `stg`, `prd`, `sbx`, `dr` |
| `dry_run` | No | `false` | Preview changes without applying |

**Example conversation:**
```
User: Migrate my .env.local file to the dev environment

Claude: I'll analyze your .env.local and migrate it to vaulter...
→ Reads and parses .env.local
→ Uses vaulter_categorize_vars to identify secrets
→ Uses vaulter_multi_set to push variables
→ Reports what was migrated
```

---

### `deploy_secrets`

Deploy secrets to Kubernetes. Generates Secret YAML and provides deployment instructions.

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `environment` | **Yes** | - | Environment: `dev`, `stg`, `prd`, `sbx`, `dr` |
| `namespace` | No | `{project}-{env}` | Kubernetes namespace |
| `secret_name` | No | `{project}-secrets` | Name of the K8s Secret |

**Example conversation:**
```
User: Deploy my production secrets to Kubernetes

Claude: I'll generate the Kubernetes Secret manifest...
→ Uses vaulter_list to verify variables exist
→ Uses vaulter_k8s_secret to generate YAML
→ Provides kubectl apply command
→ Shows verification steps
```

---

### `compare_environments`

Compare variables between two environments. Shows differences, missing keys, and value changes.

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `source_env` | **Yes** | - | Source environment: `dev`, `stg`, `prd`, `sbx`, `dr` |
| `target_env` | **Yes** | - | Target environment |
| `show_values` | No | `false` | Show masked values in comparison |

**Example conversation:**
```
User: Compare dev and production environments

Claude: I'll compare the variables between dev and prd...
→ Uses vaulter_compare with source="dev", target="prd"
→ Shows: variables only in dev, only in prd, different values
→ Suggests actions for missing variables
```

---

### `security_audit`

Audit environment variables for security issues. Checks for exposed secrets, weak patterns, and best practices.

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `environment` | **Yes** | - | Environment to audit: `dev`, `stg`, `prd`, or `all` |
| `strict` | No | `false` | Enable strict mode with additional checks |

**Checks performed:**
- Secrets in wrong locations (e.g., committed files)
- Weak or default values
- Missing encryption
- Exposed API keys/tokens
- Variables with rotation overdue

**Example conversation:**
```
User: Run a security audit on production

Claude: I'll perform a comprehensive security audit of your production environment...
→ Uses vaulter_list to get all variables
→ Uses vaulter_categorize_vars to identify secrets
→ Uses vaulter_status for rotation status
→ Reports findings with severity levels
```

---

### `rotation_workflow`

Check and manage secret rotation. Identifies overdue secrets and helps with rotation process.

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `environment` | **Yes** | - | Environment: `dev`, `stg`, `prd`, `sbx`, `dr`, or `all` |
| `action` | No | `check` | `check` (list overdue), `rotate` (interactive), `report` (full status) |
| `key_pattern` | No | - | Filter pattern (e.g., `*_KEY`, `API_*`) |

**Actions:**
- `check`: List secrets that need rotation
- `rotate`: Interactive rotation with new value generation
- `report`: Full rotation status report with recommendations

**Example conversation:**
```
User: Check which secrets need rotation in production

Claude: I'll check for overdue secret rotations...
→ Uses vaulter_status with include=["rotation"], overdue_only=true
→ Lists secrets with last rotation dates
→ Prioritizes by age and risk level
→ Suggests rotation schedule
```

---

### `shared_vars_workflow`

Manage monorepo shared variables. Shared vars apply to all services and can be overridden per-service.

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `action` | **Yes** | - | `list`, `promote`, `override`, `audit` |
| `environment` | **Yes** | - | Environment: `dev`, `stg`, `prd`, `sbx`, `dr` |
| `service` | No | - | Service name (required for `promote`/`override`) |

**Actions:**
- `list`: Show shared vars and which services inherit/override them
- `promote`: Move a service-specific var to shared (applies to all)
- `override`: Create a service-specific override of a shared var
- `audit`: Check for inconsistencies between services

**Example conversation:**
```
User: Show me how shared variables are inherited in dev

Claude: I'll analyze shared variable inheritance...
→ Uses vaulter_shared_list to get shared vars
→ Uses vaulter_services to list all services
→ For each service, uses vaulter_inheritance_info
→ Shows inheritance tree with overrides highlighted
```

---

### `batch_operations`

Perform batch operations on multiple variables at once.

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `operation` | **Yes** | - | `set`, `get`, `delete` |
| `environment` | **Yes** | - | Environment: `dev`, `stg`, `prd`, `sbx`, `dr` |
| `variables` | **Yes** | - | JSON object `{"K":"V"}` or comma-separated keys `K1,K2,K3` |
| `shared` | No | `false` | For `set`: create as shared variables |

**Example conversations:**

```
User: Set DATABASE_URL, REDIS_URL, and API_KEY in production

Claude: I'll set these variables in production...
→ Uses vaulter_multi_set with variables object
→ Reports success/failure for each variable
```

```
User: Delete all the deprecated OLD_* variables from dev

Claude: I'll search for and delete deprecated variables...
→ Uses vaulter_search with pattern="OLD_*"
→ Confirms list with user
→ Uses vaulter_multi_delete to remove them
```

---

## Common Workflows

### 1. First Time Setup

```
1. vaulter_init         → Initialize project
2. vaulter_key_generate → Generate encryption key
3. vaulter_set          → Add variables
```

### 2. Deploy to Kubernetes

```
1. vaulter_list       → Review variables
2. vaulter_k8s_secret → Generate Secret YAML
3. kubectl apply -f - → Apply
```

### 3. Compare Before Deploy

```
1. vaulter_compare → Compare dev vs prd
2. vaulter_sync    → Sync with dry_run first
```

### 4. Batch Migration

```
1. vaulter_multi_set    → Set multiple vars: { "VAR1": "a", "VAR2": "b" }
2. vaulter_multi_delete → Remove old keys: ["OLD1", "OLD2"]
```

### 5. Monorepo Shared Variables

```
1. vaulter_shared_list     → See shared vars
2. vaulter_set shared=true → Add shared var
3. vaulter_inheritance_info → Check service inheritance
```

### 6. Output Targets (Multi-Framework)

```
1. Configure outputs in config.yaml
2. vaulter_pull all=true   → Pull to all outputs
3. vaulter_pull output=web → Pull to specific output
```

---

## Output Targets

Generate multiple `.env` files from a single backend, with filtering and shared variable inheritance.

### Configuration

```yaml
# .vaulter/config.yaml
outputs:
  web:
    path: apps/web              # Where to write .env
    filename: .env.local        # Filename (default: .env)
    include: [NEXT_PUBLIC_*]    # Glob patterns to include
    exclude: [*_DEV]            # Glob patterns to exclude
    inherit: true               # Inherit shared vars (default: true)

  api:
    path: apps/api
    include: [DATABASE_*, JWT_*, API_*]

  admin: apps/admin             # Shorthand: just the path (all vars)

# Variables shared across ALL outputs
shared:
  include: [NODE_ENV, LOG_LEVEL, SENTRY_*]
```

### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `path` | string | **required** | Directory for .env file |
| `filename` | string | `.env` | Filename (supports `{env}` placeholder: `.env.{env}` → `.env.dev`) |
| `include` | string[] | `[]` | Glob patterns to include (empty = all) |
| `exclude` | string[] | `[]` | Glob patterns to exclude |
| `inherit` | boolean | `true` | Include shared vars |

### Pattern Matching

| Pattern | Matches | Doesn't Match |
|---------|---------|---------------|
| `NEXT_PUBLIC_*` | `NEXT_PUBLIC_API_URL` | `API_URL` |
| `*_SECRET` | `JWT_SECRET`, `API_SECRET` | `SECRET_KEY` |
| `DATABASE_*` | `DATABASE_URL`, `DATABASE_HOST` | `DB_URL` |
| `*_URL` | `API_URL`, `DATABASE_URL` | `URL_PREFIX` |

### Filter Algorithm

```
1. If include is empty → include ALL vars
2. If include is specified → only matching vars
3. Apply exclude patterns to filter out
4. If inherit=true → merge with shared vars (output overrides shared)
```

### CLI Commands

```bash
# Pull to all outputs
vaulter sync pull --all -e dev

# Pull to specific output
vaulter sync pull --output web -e dev

# Dry run (preview without writing)
vaulter sync pull --all --dry-run -e dev

# With verbose output
vaulter sync pull --all --verbose -e dev
```

### MCP Tool Usage

```json
// Pull to all outputs
{
  "tool": "vaulter_pull",
  "arguments": {
    "environment": "dev",
    "all": true
  }
}

// Pull to specific output
{
  "tool": "vaulter_pull",
  "arguments": {
    "environment": "dev",
    "output": "web"
  }
}
```

### Example: Monorepo with Next.js + NestJS

```yaml
# .vaulter/config.yaml
project: my-monorepo

outputs:
  # Next.js frontend - only public vars
  web:
    path: apps/web
    filename: .env.local
    include: [NEXT_PUBLIC_*]

  # NestJS API - backend vars
  api:
    path: apps/api
    include: [DATABASE_*, REDIS_*, JWT_*, API_*]
    exclude: [*_DEV, *_LOCAL]

  # Worker service - minimal vars
  worker:
    path: apps/worker
    include: [REDIS_*, QUEUE_*]
    inherit: true

# Common vars for all outputs
shared:
  include: [NODE_ENV, LOG_LEVEL, SENTRY_DSN]
```

**Result of `vaulter sync pull --all -e prd`:**

```
apps/web/.env.local:
  NODE_ENV=production          ← shared
  LOG_LEVEL=info               ← shared
  SENTRY_DSN=...               ← shared
  NEXT_PUBLIC_API_URL=...      ← filtered by include

apps/api/.env:
  NODE_ENV=production          ← shared
  LOG_LEVEL=info               ← shared
  SENTRY_DSN=...               ← shared
  DATABASE_URL=...             ← filtered by include
  REDIS_URL=...                ← filtered by include
  JWT_SECRET=...               ← filtered by include

apps/worker/.env:
  NODE_ENV=production          ← shared
  LOG_LEVEL=info               ← shared
  SENTRY_DSN=...               ← shared
  REDIS_URL=...                ← filtered by include
  QUEUE_URL=...                ← filtered by include
```

### Programmatic API

```typescript
import { pullToOutputs, loadConfig, createClient } from 'vaulter'

const config = loadConfig()
const client = createClient({ config })
await client.connect()

const result = await pullToOutputs({
  client,
  config,
  environment: 'dev',
  projectRoot: '/path/to/project',
  all: true,           // or output: 'web'
  dryRun: false,
  verbose: true
})

// result.files: Array of { output, path, fullPath, varsCount, vars }
// result.warnings: Array of warning strings

console.log(`Wrote ${result.files.length} files`)
for (const file of result.files) {
  console.log(`  ${file.output}: ${file.fullPath} (${file.varsCount} vars)`)
}

await client.disconnect()
```

---

## Configuration Priority

Backend resolution (first match wins):

1. CLI `--backend` flag
2. Project config backend (`.vaulter/config.yaml` → `backend.url`)
3. Project MCP config (`.vaulter/config.yaml` → `mcp.default_backend`)
4. Global MCP config (`~/.vaulter/config.yaml` → `mcp.default_backend`)
5. Default (`file://$HOME/.vaulter/store`)

---

## Important Notes

### s3db.js Architecture

Vaulter uses **s3db.js** which stores data in **S3 object metadata**, NOT in the object body.

**Never do:**
```bash
# WRONG - Creates corrupted data
aws s3 cp .env s3://bucket/path/file.json
```

**Always use:**
```bash
# CORRECT - Uses vaulter CLI
npx vaulter sync push -e dev
```

### Deterministic IDs

Variables are stored with deterministic IDs for O(1) lookups:

```
{project}|{environment}|{service}|{key}
```

Examples:
- Single repo: `myproject|dev||DATABASE_URL`
- Monorepo: `myproject|dev|api|DATABASE_URL`
- Shared: `myproject|dev|__shared__|SHARED_KEY`

### Per-Environment Keys

Vaulter supports different encryption keys per environment for complete isolation:

```yaml
encryption:
  keys:
    dev:
      source:
        - env: VAULTER_KEY_DEV
    prd:
      source:
        - env: VAULTER_KEY_PRD
```

**Key resolution order:**
1. `VAULTER_KEY_{ENV}` env var
2. Config `encryption.keys.{env}.source`
3. File `~/.vaulter/projects/{project}/keys/{env}`
4. `VAULTER_KEY` env var (global fallback)
5. Config `encryption.key_source`
6. File `keys/master`

### Shared Variables Key (Monorepo)

For monorepos with per-environment keys, use `shared_key_environment` to specify which key encrypts shared variables:

```yaml
encryption:
  shared_key_environment: dev  # Shared vars always use dev key
  keys:
    dev: { source: [{ env: VAULTER_KEY_DEV }] }
    prd: { source: [{ env: VAULTER_KEY_PRD }] }
```

This ensures shared variables can be read across all environments using a consistent key.
