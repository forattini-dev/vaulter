# Vaulter MCP Server Reference

Complete reference for the Vaulter Model Context Protocol (MCP) server.

**Stats:** 30 tools | 5 resources | 8 prompts

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

## Tools Reference (30)

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
Download from backend to local .env file.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `output` | string | No | auto | Output file path |

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

### Key Management (5)

#### `vaulter_key_generate`
Generate a new encryption key.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | **Yes** | - | Key name (e.g., `master`, `deploy`) |
| `project` | string | No | auto | Project name |
| `global` | boolean | No | `false` | Store in global scope (`~/.vaulter/global/`) |
| `asymmetric` | boolean | No | `false` | Generate asymmetric key pair |
| `algorithm` | string | No | `rsa-4096` | Algorithm: `rsa-4096`, `rsa-2048`, `ec-p256`, `ec-p384` |
| `force` | boolean | No | `false` | Overwrite existing key |

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

## Resources Reference (5)

Resources provide static/cached data that doesn't require input parameters.

| URI | Description | MIME Type |
|-----|-------------|-----------|
| `vaulter://instructions` | **Read first!** How vaulter works, s3db.js architecture | `text/markdown` |
| `vaulter://tools-guide` | Which tool to use for each scenario | `text/markdown` |
| `vaulter://mcp-config` | MCP settings sources (priority chain) | `application/json` |
| `vaulter://config` | Project configuration (YAML) | `application/yaml` |
| `vaulter://services` | Monorepo services list | `application/json` |

### `vaulter://instructions`

**Critical resource - read first before using any tools.**

Contains:
- Data storage architecture (s3db.js uses S3 metadata, not body)
- Deterministic ID format: `{project}|{environment}|{service}|{key}`
- What NOT to do (never upload files directly to S3)
- MCP configuration options

### `vaulter://tools-guide`

Quick reference showing which tool to use for each scenario:
- Single vs batch operations
- Sync workflows
- K8s deployment
- Monorepo shared variables

---

## Prompts Reference (8)

Pre-configured workflows for common tasks.

### `setup_project`
Initialize a new vaulter project.

| Argument | Required | Description |
|----------|----------|-------------|
| `project_name` | **Yes** | Project name |
| `mode` | No | `unified` or `split` |
| `backend` | No | `s3`, `minio`, `r2`, `file`, `memory` |

### `migrate_dotenv`
Migrate existing .env files to vaulter.

| Argument | Required | Description |
|----------|----------|-------------|
| `file_path` | **Yes** | Path to .env file |
| `environment` | **Yes** | Target environment |
| `dry_run` | No | Preview only (`true`/`false`) |

### `deploy_secrets`
Deploy secrets to Kubernetes.

| Argument | Required | Description |
|----------|----------|-------------|
| `environment` | **Yes** | Environment to deploy |
| `namespace` | No | K8s namespace |
| `secret_name` | No | K8s Secret name |

### `compare_environments`
Compare variables between environments.

| Argument | Required | Description |
|----------|----------|-------------|
| `source_env` | **Yes** | Source environment |
| `target_env` | **Yes** | Target environment |
| `show_values` | No | Show masked values |

### `security_audit`
Audit secrets for security issues.

| Argument | Required | Description |
|----------|----------|-------------|
| `environment` | **Yes** | Environment or `all` |
| `strict` | No | Enable strict mode |

### `rotation_workflow`
Check and manage secret rotation.

| Argument | Required | Description |
|----------|----------|-------------|
| `environment` | **Yes** | Environment or `all` |
| `action` | No | `check`, `rotate`, `report` |
| `key_pattern` | No | Filter pattern |

### `shared_vars_workflow`
Manage monorepo shared variables.

| Argument | Required | Description |
|----------|----------|-------------|
| `action` | **Yes** | `list`, `promote`, `override`, `audit` |
| `environment` | **Yes** | Environment |
| `service` | No | Service name (for promote/override) |

### `batch_operations`
Batch operations on multiple variables.

| Argument | Required | Description |
|----------|----------|-------------|
| `operation` | **Yes** | `set`, `get`, `delete` |
| `environment` | **Yes** | Environment |
| `variables` | **Yes** | JSON object or comma-separated keys |
| `shared` | No | For `set`: as shared variables |

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
