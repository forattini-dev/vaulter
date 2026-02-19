# Vaulter MCP Server Reference

Complete reference for the Vaulter Model Context Protocol (MCP) server.

**Stats:** 17 tools | 4 resources | 5 prompts

---

## FOR AI AGENTS - READ THIS FIRST

### When to Use `vaulter_status action="scorecard"`

Use status checks strategically - **not before every operation**, but in these specific scenarios:

#### 1. **Start of Conversation** (Once)
```
User: "Help me manage environment variables"
Agent: [Calls vaulter_status action="scorecard"] ← Understand context ONCE
Agent: [Proceeds with normal operations]
```
**Why:** Get initial context, then work normally without repeated diagnostics.

#### 2. **When Operation Fails** (Diagnosis)
```
User: "Set DATABASE_URL..."
Agent: [Calls vaulter_change action="set"] ← Try normally first
  ↓ FAILS (timeout/error)
Agent: [Calls vaulter_status action="scorecard"] ← NOW diagnose
Agent: [Reports root cause to user]
```
**Why:** Only diagnose when something actually fails - don't waste time when things work.

#### 3. **User Asks Status Questions**
```
User: "Is my setup ok?"
User: "Why is vaulter slow?"
User: "Are variables synced?"
Agent: [Calls vaulter_status action="scorecard"] ← Explicit status check
```

#### 4. **Environment Switch**
```
User: "Now work on production"
Agent: [Calls vaulter_status action="scorecard" environment="prd"] ← New env check
```

#### DON'T Call Before Every Operation
```
SLOW & WASTEFUL:
  vaulter_status → vaulter_change
  vaulter_status → vaulter_get
  vaulter_status → vaulter_list

FAST & EFFICIENT:
  vaulter_change action="set" (try directly)
    ↓ if fails
  vaulter_status action="scorecard" (diagnose)
```

### Intelligent Retry Strategy

Instead of calling status before every operation, use **retry with escalating timeout**:

```typescript
async function executeWithIntelligentRetry(operation, environment) {
  try {
    // 1. Try operation normally (default timeout: 30s)
    return await operation()

  } catch (error) {
    if (error.message.includes("timeout")) {
      // 2. Retry with 2x timeout (60s)
      try {
        return await operation({ timeout_ms: 60000 })
      } catch (retryError) {
        // 3. NOW diagnose with status
        const diagnosis = await vaulter_status({ action: 'scorecard', environment })
        return formatDiagnosisForUser(diagnosis)
      }
    }

    // 4. For non-timeout errors, diagnose immediately
    const diagnosis = await vaulter_status({ action: 'scorecard', environment })
    return formatErrorWithDiagnosis(error, diagnosis)
  }
}
```

### Decision Tree for AI Agents

```
START
  ↓
Try operation normally
  ↓
Success? ✓ → DONE
  ↓ NO
  ↓
Timeout?
  ↓ YES → Retry with 2x timeout
  ↓       Success? ✓ → DONE (warn: "slower than expected")
  ↓       Failed? → Call vaulter_status action="scorecard"
  ↓
  ↓ NO (other error)
  ↓
Call vaulter_status action="scorecard"
  ↓
Format diagnosis for user
  ↓
DONE
```

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

## Tools Reference (17)

### Mutation Flow (4)

#### `vaulter_change`
Mutate local state (set, delete, move, import). Writes to `.vaulter/local/` only — does NOT touch backend. Use `vaulter_plan` + `vaulter_apply` to push changes.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | string | **Yes** | - | `set`, `delete`, `move`, `import` |
| `key` | string | No | - | Variable key (required for set/delete/move) |
| `value` | string | No | - | Variable value (required for set) |
| `sensitive` | boolean | No | `false` | Mark as secret |
| `scope` | string | No | - | Target scope: `shared` or service name (e.g. `svc-auth`) |
| `from` | string | No | - | Source scope for move action |
| `to` | string | No | - | Target scope for move action |
| `overwrite` | boolean | No | `false` | Overwrite target in move |
| `deleteOriginal` | boolean | No | `true` | Delete source after move |
| `vars` | object | No | - | Key-value pairs for import action |
| `environment` | string | No | config | Target environment |

**Examples:**
```json
{ "action": "set", "key": "DATABASE_URL", "value": "postgres://...", "sensitive": true }
{ "action": "delete", "key": "OLD_TOKEN" }
{ "action": "move", "key": "MAILGUN_KEY", "from": "shared", "to": "svc-api" }
{ "action": "import", "vars": { "KEY1": "val1", "KEY2": "val2" }, "scope": "shared" }
```

#### `vaulter_plan`
Compute a plan: diff local state vs backend. Shows what would change if you apply. Writes plan artifacts (JSON + Markdown) for review.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | config | Target environment |
| `service` | string | No | - | Filter by service (monorepo) |
| `scope` | string | No | - | Filter by scope: `shared` or service name |
| `prune` | boolean | No | `false` | Include delete actions for remote-only vars |

#### `vaulter_apply`
Execute a plan: push local changes to backend. Requires a prior `vaulter_plan`. Use `force=true` for production environments.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | config | Target environment |
| `service` | string | No | - | Filter by service |
| `scope` | string | No | - | Filter by scope |
| `prune` | boolean | No | `false` | Delete remote-only vars |
| `force` | boolean | No | `false` | Required for production environments |
| `dryRun` | boolean | No | `false` | Preview without applying |

#### `vaulter_run`
Run an external command with vars loaded from Vaulter.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `command` | string | **Yes** | - | Command to run |
| `args` | string[] | No | - | Arguments for command |
| `shell` | boolean | No | `false` | Run through shell (for `&&`, `|`, redirects) |
| `cwd` | string | No | current dir | Working directory |
| `environment` | string | No | config | Target environment |
| `service` | string | No | - | Service for scoped resolution |
| `source` | string | No | `auto` | `auto`, `local`, `backend` |
| `override` | boolean | No | `false` | Override existing env vars |
| `quiet` | boolean | No | `false` | Reduce response verbosity |
| `verbose` | boolean | No | `false` | Show detailed load info |
| `dry-run` | boolean | No | `false` | Preview command only |
| `dryRun` | boolean | No | `false` | Alias for `dry-run` |
| `timeout_ms` | number | No | `30000` | Timeout in ms |
| `output_limit` | number | No | `8000` | Max chars returned per stream |

---

### Read Operations (4)

#### `vaulter_get`
Read variable(s) from backend. Supports single key or multi-get via `keys[]`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | No | - | Single key to get |
| `keys` | string[] | No | - | Multiple keys to get |
| `environment` | string | No | config | Target environment |
| `service` | string | No | - | Service scope |
| `shared` | boolean | No | `false` | Get from shared scope |

#### `vaulter_list`
List variables from backend for a project/environment.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | config | Target environment |
| `service` | string | No | - | Filter by service |
| `shared` | boolean | No | `false` | List shared vars only |
| `showValues` | boolean | No | `false` | Show decrypted values |
| `filter` | string | No | - | Glob pattern filter (e.g. `DATABASE_*`) |

#### `vaulter_search`
Search variables by pattern across environments, or compare two environments.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | string | No | - | Glob pattern to search (e.g. `DATABASE_*`) |
| `source` | string | No | - | Source environment for compare |
| `target` | string | No | - | Target environment for compare |
| `environments` | string[] | No | all | Environments to search |
| `service` | string | No | - | Filter by service |
| `showValues` | boolean | No | `false` | Show values in compare |

**Modes:**
- **Search:** Provide `pattern` to search across environments
- **Compare:** Provide `source` + `target` to compare two environments

#### `vaulter_diff`
Quick diff: shows what changed locally vs backend without writing plan artifacts.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | config | Target environment |
| `service` | string | No | - | Filter by service |
| `scope` | string | No | - | Filter by scope |
| `showValues` | boolean | No | `false` | Show actual values |

---

### Status (1)

#### `vaulter_status`
Health check and status overview. Multiple views via the `action` parameter.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `offline` | boolean | No | `false` | Run local-first without backend for scorecard/drift/inventory |
| `action` | string | No | `scorecard` | `scorecard`, `vars`, `audit`, `drift`, `inventory` |
| `environment` | string | No | config | Target environment |
| `service` | string | No | - | Filter by service |
| `pattern` | string | No | - | Filter by audit key pattern |
| `source` | string | No | - | Filter by audit source |
| `operation` | string | No | - | Filter audit operations |
| `since` | string | No | - | Filter audit entries after timestamp |
| `until` | string | No | - | Filter audit entries before timestamp |
| `environments` | string[] | No | - | Environments for inventory action |
| `limit` | number | No | - | Limit results for audit action |

**Actions:**
- **`scorecard`** — Health check with diagnostics
- **`vars`** — Variable summary per environment/service
- **`audit`** — Recent audit log entries
- **`drift`** — Local vs backend differences
- **`inventory`** — Cross-environment variable inventory

---

### Export (1)

#### `vaulter_export`
Export variables in various formats.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `format` | string | No | `shell` | `k8s-secret`, `k8s-configmap`, `helm`, `terraform`, `env`, `shell`, `json` |
| `environment` | string | No | config | Target environment |
| `service` | string | No | - | Filter by service |
| `shared` | boolean | No | `false` | Export shared vars |
| `includeShared` | boolean | No | `true` | Include shared vars in service export |
| `namespace` | string | No | - | K8s namespace override |
| `name` | string | No | - | K8s resource name override |
| `tfFormat` | string | No | `tfvars` | Terraform sub-format: `tfvars` or `json` |

---

### Key Management (1)

#### `vaulter_key`
Encryption key management. Action-based tool for all key operations.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | string | **Yes** | - | `generate`, `list`, `show`, `export`, `import`, `rotate` |
| `name` | string | No | - | Key name |
| `environment` | string | No | - | Environment for key generation |
| `global` | boolean | No | `false` | Use global key scope |
| `asymmetric` | boolean | No | `false` | Generate asymmetric key pair |
| `algorithm` | string | No | `rsa-4096` | `rsa-4096`, `rsa-2048`, `ec-p256`, `ec-p384` |
| `force` | boolean | No | `false` | Overwrite existing key |
| `output` | string | No | - | Export output path |
| `file` | string | No | - | Import file path |
| `service` | string | No | - | Service for rotation |
| `dryRun` | boolean | No | `false` | Preview rotation |

**Examples:**
```json
{ "action": "generate", "name": "master" }
{ "action": "generate", "environment": "prd" }
{ "action": "rotate", "dryRun": true }
{ "action": "show", "name": "master" }
{ "action": "export", "name": "master", "output": "/tmp/key.bundle" }
```

---

### Local Development (1)

#### `vaulter_local`
Local overrides management. Offline-first architecture for `.vaulter/local/` files.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | string | **Yes** | - | See actions below |
| `key` | string | No | - | Variable key (for set/delete/shared-set/shared-delete) |
| `value` | string | No | - | Variable value (for set/shared-set) |
| `sensitive` | boolean | No | `false` | Mark as secret |
| `service` | string | No | - | Target service |
| `environment` | string | No | config | Target environment |
| `output` | string | No | - | Specific output target for pull |
| `all` | boolean | No | `true` | Pull/push all outputs |
| `shared` | boolean | No | `false` | Push shared vars only |
| `dryRun` | boolean | No | `false` | Preview changes |
| `overwrite` | boolean | No | `false` | Overwrite backend on push-all |
| `targetEnvironment` | string | No | - | Override target environment for push |
| `sourceEnvironment` | string | No | - | Override source environment for sync |

**Actions:**

| Action | Backend? | Description |
|--------|----------|-------------|
| `pull` | OFFLINE | Generate .env files from `.vaulter/local/` |
| `push` | ONLINE | Push one local var to backend |
| `push-all` | ONLINE | Send entire `.vaulter/local/` → backend |
| `sync` | ONLINE | Download backend → `.vaulter/local/` |
| `set` | OFFLINE | Set service-scoped local override |
| `delete` | OFFLINE | Remove local override |
| `diff` | OFFLINE | Show local overrides vs base |
| `status` | OFFLINE | Show local overrides summary |
| `shared-set` | OFFLINE | Set shared local override (all services) |
| `shared-delete` | OFFLINE | Remove shared local override |
| `shared-list` | OFFLINE | List shared local overrides |

**File structure:**
```
.vaulter/local/
├── configs.env           # Shared configs (sensitive=false)
├── secrets.env           # Shared secrets (sensitive=true)
└── services/             # Monorepo only
    └── <service>/
        ├── configs.env
        └── secrets.env
```

---

### Backup & History (2)

#### `vaulter_snapshot`
Snapshot management. Compressed (gzip) backups with SHA256 integrity verification.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | string | **Yes** | - | `create`, `list`, `restore`, `delete` |
| `environment` | string | No | - | Target environment |
| `service` | string | No | - | Filter by service |
| `id` | string | No | - | Snapshot ID for restore/delete |
| `name` | string | No | - | Custom snapshot name |
| `source` | string | No | `cloud` | Snapshot source: `cloud`, `local`, `merged` |

#### `vaulter_versions`
Version history and rollback. Track changes per variable when versioning is enabled.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | string | **Yes** | - | `list`, `get`, `rollback` |
| `key` | string | **Yes** | - | Variable key |
| `version` | number | No | - | Version number (for get/rollback) |
| `environment` | string | No | config | Target environment |
| `service` | string | No | - | Service scope |
| `showValues` | boolean | No | `false` | Show decrypted values |
| `dryRun` | boolean | No | `false` | Preview rollback |

---

### Setup (2)

#### `vaulter_init`
Initialize a vaulter project. Detects monorepo and generates `.vaulter/` structure.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | No | auto | Project name override |
| `monorepo` | boolean | No | `false` | Force monorepo mode |
| `environments` | string[] | No | `["dev","stg","sdx","prd"]` | Custom environments |
| `backend` | string | No | - | Backend URL |

#### `vaulter_services`
Discover and list services in a monorepo.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | No | `.` | Root path to scan |
| `detailed` | boolean | No | `false` | Show detailed info per service |

---

### Dangerous Operations (1)

#### `vaulter_nuke`
Preview what would be deleted from backend. Actual deletion requires CLI confirmation.

No parameters. Returns summary of data that would be deleted and the CLI command to execute.

```bash
# Preview via MCP
vaulter_nuke

# Execute via CLI (requires --confirm flag)
vaulter nuke --confirm=my-project
```

---

## Resources Reference (4)

Resources provide read-only context to AI agents.

| URI | Description | MIME Type |
|-----|-------------|-----------|
| `vaulter://instructions` | s3db.js architecture + tool overview | `text/markdown` |
| `vaulter://tools-guide` | Which tool to use for each scenario | `text/markdown` |
| `vaulter://config` | Project configuration (.vaulter/config.yaml) | `text/yaml` |
| `vaulter://services` | Monorepo services list | `text/plain` |

### `vaulter://instructions`

Contains essential information about:

1. **Data Storage Architecture** — s3db.js stores data in S3 object **metadata**, NOT the body
2. **Tool Architecture** — 17 action-based tools with domain delegation
3. **Mutation Workflow** — change → plan → apply flow
4. **Local .env Management** — pull, push, sync operations
5. **Sensitive vs Config** — `sensitive=true` (secret) vs `sensitive=false` (config)

### `vaulter://tools-guide`

Quick reference showing which tool to use for each scenario:

| Scenario | Tool |
|----------|------|
| Set/update a variable | `vaulter_change action="set"` |
| Delete a variable | `vaulter_change action="delete"` |
| Move variable between scopes | `vaulter_change action="move"` |
| Read a single variable | `vaulter_get` |
| Run a command with loaded vars | `vaulter_run` |
| List all variables | `vaulter_list` |
| Compare environments | `vaulter_search source="dev" target="prd"` |
| Search by pattern | `vaulter_search pattern="DATABASE_*"` |
| Quick diff | `vaulter_diff` |
| Health check | `vaulter_status action="scorecard"` |
| Export to K8s | `vaulter_export format="k8s-secret"` |
| Generate key | `vaulter_key action="generate"` |
| Local pull | `vaulter_local action="pull"` |
| Create backup | `vaulter_snapshot action="create"` |
| Version history | `vaulter_versions action="list"` |

### `vaulter://config`

Returns the current project configuration from `.vaulter/config.yaml`.

### `vaulter://services`

Lists all services discovered in a monorepo.

---

## Prompts Reference (5)

Prompts are pre-configured workflow templates that guide Claude through common tasks.

| Prompt | Purpose | Key Arguments |
|--------|---------|---------------|
| `setup_project` | Initialize new project | `project`, `monorepo` |
| `deploy_secrets` | Generate deployment artifacts | `environment`, `format` |
| `compare_environments` | Diff two environments | `source`, `target` |
| `rotation_workflow` | Rotate encryption keys | `key` |
| `local_dev_workflow` | Set up local development | `service` |

---

### `setup_project`

Initialize a new vaulter project with guided setup.

| Argument | Required | Description |
|----------|----------|-------------|
| `project` | No | Project name |
| `monorepo` | No | Is monorepo (true/false) |

**Steps performed:**
1. `vaulter_init` — Initialize project
2. `vaulter_key action="generate"` — Generate encryption key
3. `vaulter_change action="set"` — Set initial variables
4. `vaulter_plan` — Plan changes
5. `vaulter_apply` — Apply to backend
6. `vaulter_status action="scorecard"` — Verify setup

---

### `deploy_secrets`

Generate deployment artifacts (K8s secrets, configmaps, Helm values).

| Argument | Required | Description |
|----------|----------|-------------|
| `environment` | **Yes** | Target environment |
| `format` | No | Output format (k8s-secret, k8s-configmap, helm, terraform) |

**Steps performed:**
1. `vaulter_list` — Check current state
2. `vaulter_diff` — Look for drift
3. `vaulter_export` — Generate artifacts

---

### `compare_environments`

Compare variables across environments and identify gaps.

| Argument | Required | Description |
|----------|----------|-------------|
| `source` | **Yes** | Source environment |
| `target` | **Yes** | Target environment |

**Steps performed:**
1. `vaulter_search` — Compare source vs target
2. `vaulter_status action="inventory"` — Overall health
3. Shows: variables only in source, only in target, different values, identical

---

### `rotation_workflow`

Rotate encryption keys with backup and re-encryption.

| Argument | Required | Description |
|----------|----------|-------------|
| `key` | No | Key name to rotate (default: master) |

**Steps performed:**
1. `vaulter_key action="rotate" dryRun=true` — Preview
2. `vaulter_snapshot action="create"` — Create backup
3. `vaulter_key action="rotate"` — Execute rotation
4. `vaulter_key action="show"` — Verify
5. `vaulter_status action="scorecard"` — Check health

---

### `local_dev_workflow`

Set up local development with shared vars and service overrides.

| Argument | Required | Description |
|----------|----------|-------------|
| `service` | No | Service name (for monorepo) |

**Steps performed:**
1. `vaulter_local action="status"` — Check current state
2. `vaulter_local action="sync"` — Sync from backend
3. `vaulter_local action="shared-set"` — Set shared vars
4. `vaulter_local action="set"` — Set service overrides
5. `vaulter_local action="pull" all=true` — Generate .env files
6. `vaulter_local action="shared-list"` — View shared vars
7. `vaulter_local action="diff"` — View diff

---

### Framework Playbooks (Famosos)

Exemplos práticos para frameworks comuns.

#### 1) Next.js (frontend SPA)

```yaml
# .vaulter/config.yaml
outputs:
  web:
    path: apps/web
    filename: .env.local
    include: [NEXT_PUBLIC_*, APP_*, NODE_ENV]
    exclude: [*_LOCAL]
    inherit: true
```

```bash
vaulter local pull --output web
vaulter local set NEXT_PUBLIC_API_URL=https://api.dev.tetis.io
vaulter local set NODE_ENV=local
vaulter local pull --output web
vaulter local diff
```

#### 2) NestJS (API + worker) no monorepo

```yaml
# .vaulter/config.yaml
outputs:
  api:
    path: apps/api
    filename: .env
    include: [DATABASE_*, JWT_*, API_*]
    inherit: true
  worker:
    path: apps/worker
    include: [REDIS_*, QUEUE_*, NODE_ENV]
```

```bash
vaulter change set DATABASE_URL=postgres://postgres:local@localhost:5432/app -e dev --scope svc-api
vaulter change set REDIS_URL=redis://127.0.0.1:6379 -e dev --scope svc-worker
vaulter plan -e dev
vaulter apply -e dev
vaulter local pull --all
vaulter export k8s-secret -e dev --service svc-api --name api-secrets
```

#### 3) Express / Fastify (container + CI)

```bash
vaulter change set PORT::3000 -e stg
vaulter change set SERVICE_NAME::api -e stg --scope shared
vaulter change set STRIPE_SECRET::sk_test_... -e stg --scope svc-payments --sensitive true
vaulter plan -e stg
vaulter apply -e stg --force
```

#### 4) Django/FastAPI (API Python)

```yaml
# .vaulter/config.yaml
outputs:
  django:
    path: apps/django
    filename: .env
    include: [DATABASE_*, DJANGO_*, SECRET_KEY, DEBUG, ALLOWED_HOSTS]
```

```bash
vaulter local set DEBUG=true
vaulter local set DJANGO_SETTINGS_MODULE=app.settings.dev
vaulter local pull -o django
vaulter export helm -e dev --service django-api
```

## Common Workflows

### 1. First Time Setup

```
1. vaulter_init                          → Initialize project
2. vaulter_key action="generate"         → Generate encryption key
3. vaulter_change action="set"           → Add variables (local state)
4. vaulter_plan                          → Compute plan
5. vaulter_apply                         → Push to backend
```

### 2. Deploy to Kubernetes

```
1. vaulter_list                          → Review variables
2. vaulter_export format="k8s-secret"    → Generate Secret YAML
3. vaulter_export format="k8s-configmap" → Generate ConfigMap YAML
4. kubectl apply -f -                    → Apply
```

### 3. Compare Before Deploy

```
1. vaulter_search source="dev" target="prd" → Compare environments
2. vaulter_diff environment="prd"           → Check drift
3. vaulter_status action="inventory"        → Full inventory
```

### 4. Local Development

```
1. vaulter_local action="sync"            → Download from backend
2. vaulter_local action="shared-set"      → Set shared overrides
3. vaulter_local action="set"             → Set service overrides
4. vaulter_local action="pull" all=true   → Generate .env files
5. vaulter_local action="diff"            → See what's overridden
6. vaulter_local action="status"          → Check state
```

### 5. Snapshot Backup/Restore

```
1. vaulter_snapshot action="create" environment="dev"     → Backup
2. vaulter_change action="set" ...                        → Make changes
3. vaulter_plan → vaulter_apply                           → Push changes
4. vaulter_snapshot action="list" environment="dev"       → List backups
5. vaulter_snapshot action="restore" id=<id>              → Rollback
```

### 6. Version History

```
1. vaulter_versions action="list" key="API_KEY"                       → See history
2. vaulter_versions action="get" key="API_KEY" version=2              → View specific version
3. vaulter_versions action="rollback" key="API_KEY" version=2 dryRun=true → Preview rollback
4. vaulter_versions action="rollback" key="API_KEY" version=2        → Execute rollback
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
vaulter local pull --all

# Pull to specific output
vaulter local pull --output web

# Dry run (preview without writing)
vaulter local pull --all --dry-run
```

### MCP Tool Usage

```json
// Pull to all outputs
{ "action": "pull", "all": true }

// Pull to specific output
{ "action": "pull", "output": "web" }
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
  all: true,
  dryRun: false
})

// result.files: Array of { output, path, fullPath, varsCount, vars }
// result.warnings: Array of warning strings
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
npx vaulter apply -e dev
```

### Fast Lookups

Variables are stored with deterministic IDs for O(1) lookups. No scanning required.

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

### MCP Configuration Options (`mcp:`)

You can set MCP defaults in either:
- Project config: `.vaulter/config.yaml` → `mcp:`
- Global config: `~/.vaulter/config.yaml` → `mcp:`

```yaml
mcp:
  default_backend: s3://your-bucket
  default_project: my-app
  default_environment: dev
  default_key: master
  default_cwd: /path/to/project
  timeout_ms: 30000

  # Performance tuning
  warmup: true
  search_concurrency: 6
  config_ttl_ms: 2000
  key_ttl_ms: 2000

  # s3db in-memory cache
  s3db_cache:
    enabled: true
    ttl_ms: 300000
    max_size: 2000
```
