# Vaulter MCP Server Reference

Complete reference for the Vaulter Model Context Protocol (MCP) server.

**Stats:** 57 tools | 7 resources | 12 prompts

---

## 🚨 FOR AI AGENTS - READ THIS FIRST

### When to Use `vaulter_doctor`

Use doctor strategically - **not before every operation**, but in these specific scenarios:

#### ✅ 1. **Start of Conversation** (Once) 🆕
```
User: "Help me manage environment variables"
Agent: [Calls vaulter_doctor] ← Understand context ONCE
Agent: [Proceeds with normal operations]
```
**Why:** Get initial context, then work normally without repeated diagnostics.

#### ✅ 2. **When Operation Fails** (Diagnosis) 🐛
```
User: "Set DATABASE_URL..."
Agent: [Calls vaulter_set] ← Try normally first
  ↓ FAILS (timeout/error)
Agent: [Calls vaulter_doctor] ← NOW diagnose
Agent: [Reports root cause to user]
```
**Why:** Only diagnose when something actually fails - don't waste time when things work.

#### ✅ 3. **User Asks Status Questions** ❓
```
User: "Is my setup ok?"
User: "Why is vaulter slow?"
User: "Are variables synced?"
Agent: [Calls vaulter_doctor] ← Explicit status check
```

#### ✅ 4. **Environment Switch** 🔄
```
User: "Now work on production"
Agent: [Calls vaulter_doctor environment="prd"] ← New env check
```

#### ❌ DON'T Call Before Every Operation
```
❌ SLOW & WASTEFUL:
  vaulter_doctor → vaulter_set
  vaulter_doctor → vaulter_get
  vaulter_doctor → vaulter_list

✅ FAST & EFFICIENT:
  vaulter_set (try directly)
    ↓ if fails
  vaulter_doctor (diagnose)
```

### What Doctor Checks (17 comprehensive checks)

| Check | What It Does | Why It Matters |
|-------|--------------|----------------|
| **1. Config** | `.vaulter/config.yaml` exists | Can't do anything without config |
| **2. Project** | Project name is set | All operations need a project |
| **3. Environment** | Environment is valid | Prevents typos (dev vs dvg) |
| **4. Service** | Service exists (monorepo) | Avoids creating orphan vars |
| **5. Backend** | Backend URLs configured | Need to know where to store |
| **6. Encryption** | Encryption keys exist | Can't encrypt/decrypt without keys |
| **7. Shared Key** | Shared vars key exists | Needed for monorepo shared vars |
| **8. Local Files** | `.env` files exist locally | For sync operations |
| **9. Outputs** | Output files configured | For framework integration |
| **10. Connection** | Backend responds | **Most important - tests connectivity** |
| **11. Latency** | Operations are fast | Detects slow backends |
| **12. Permissions** | Can read/write/delete | Tests full access |
| **13. Encryption** | Round-trip works | Detects wrong keys |
| **14. Sync Status** | Local vs remote diff | Shows out-of-sync vars |
| **15. Security** | No leaked secrets | Finds .env in git, weak keys |
| **16. Perf Config** | Tuning suggestions | Cache/warmup/concurrency tips |

### Doctor Output Example

```
✓ ok: 14 | ⚠ warn: 1 | ✗ fail: 1 | ○ skip: 0

✓ connection: connected (24 vars in dev)
✓ latency: read=45ms, list=67ms
✓ permissions: read/write/delete OK
✓ encryption: round-trip successful
⚠ sync-status: 5 local-only, 3 remote-only, 2 conflicts
✗ security: 2 .env files tracked in git
```

### How to Interpret Results

- **✓ ok:** Healthy - proceed normally
- **⚠ warn:** Works but needs attention - inform user
- **✗ fail:** Broken - MUST fix before operations
- **○ skip:** Could not check (prerequisite failed)

### Intelligent Retry Strategy

Instead of calling doctor before every operation, use **retry with escalating timeout**:

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
        // 3. NOW diagnose with doctor
        const diagnosis = await vaulter_doctor({ environment })
        return formatDiagnosisForUser(diagnosis)
      }
    }

    // 4. For non-timeout errors, diagnose immediately
    const diagnosis = await vaulter_doctor({ environment })
    return formatErrorWithDiagnosis(error, diagnosis)
  }
}
```

**Example Flow:**

```
User: "Set DATABASE_URL to postgres://..."

Step 1: vaulter_set (timeout: 30s)
  ↓ timeout!

Step 2: vaulter_set (timeout: 60s)
  ↓ timeout again!

Step 3: vaulter_doctor
  ↓ Result: "✗ connection: backend not responding"

Report to user:
  "❌ Cannot connect to backend. Doctor diagnosis:
   - Connection: FAILED (backend not responding)
   - Suggestion: Check backend URL and credentials"
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
  ↓       Failed? → Call vaulter_doctor
  ↓
  ↓ NO (other error)
  ↓
Call vaulter_doctor
  ↓
Format diagnosis for user
  ↓
DONE
```

### First Conversation Check

```typescript
// ONLY at start of conversation (once)
const diagnosis = await vaulter_doctor({ environment: "dev" })

if (diagnosis.summary.fail > 0) {
  return "⚠️ Setup has critical issues:\n" + diagnosis.suggestions.join("\n")
}

if (diagnosis.summary.warn > 0) {
  inform("⚠️ " + diagnosis.summary.warn + " warning(s) detected")
}

// Now proceed with normal operations (no doctor before each one!)
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

## Tools Reference (56)

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

Notes:
- Validates `scope_policy` from `scope_policy` config (default rules + custom rules) before applying.
- In `strict` policy mode, this command is blocked when policy is violated.
- Validates value guardrails (URLs, placeholders, sensitive-key naming, encoding hints) before writing.
- Set `VAULTER_VALUE_GUARDRAILS=warn` (default), `off`, or `strict` to change behavior.

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
| `sensitive` | boolean | No | `false` | Default sensitive flag for all variables when using object format |

Notes:
- Validates `scope_policy` for all provided keys before applying writes.
- Supports `dry run` style review by validating policy/encoding issues in output before execution.
- In `strict` mode, guardrail violations block the operation; in warn mode, it proceeds with warnings.

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

`vaulter_sync` is a CLI-only command and is not exposed in MCP tools.

#### `vaulter_pull`
Download from backend to local .env file or output targets.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `output` | string | No | auto | Output file path OR output target name (when config has `outputs`) |
| `all` | boolean | No | `false` | Pull to ALL output targets defined in config |
| `dir` | boolean | No | `false` | Pull to `.vaulter/{env}/` directory structure |

**Modes:**

1. **Output Targets Mode** (default): Pull to app .env files
   - `--all` → Pulls to all defined output targets
   - `--output <name>` → Pulls to specific output target (e.g., `web`, `api`)

2. **Directory Mode** (`--dir`): Pull to `.vaulter/{env}/` directory
   - Creates `configs.env` + `secrets.env` for shared vars
   - Creates `services/{svc}/` for service-specific vars

```bash
# Pull to all outputs
vaulter sync pull --all -e dev

# Pull to specific output
vaulter sync pull --output web -e dev

# Pull to directory structure
vaulter sync pull --dir -e dev
```

#### `vaulter_push`
Upload local .env file or directory to backend.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `file` | string | No | auto | Input file path |
| `dir` | boolean | No | `false` | Push `.vaulter/{env}/` directory structure |

**Modes:**

1. **File Mode** (default): Push single .env file to backend
2. **Directory Mode** (`--dir`): Push `.vaulter/{env}/` directory structure

```bash
# Push single file
vaulter sync push -e dev

# Push directory structure
vaulter sync push --dir -e dev
```

#### `vaulter_sync_plan`
Plan/apply a sync operation (`merge`, `push`, `pull`) before execution.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | string | **Yes** | - | One of `merge`, `push`, `pull` |
| `apply` | boolean | No | `false` | Execute changes (when `false`, only preview) |
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |
| `file` | string | No | auto | Input file for merge/push |
| `output` | string | No | auto | Target file for pull |
| `prune` | boolean | No | `false` | For push: delete remote vars not in source |
| `strategy` | string | No | `local` | Conflict strategy: `local`, `remote`, `error` |
| `dryRun` | boolean | No | `false` | Explicit preview mode |
| `shared` | boolean | No | `false` | Push to shared scope (`--shared`) |

```bash
# Preview what merge would do
vaulter_sync_plan action=merge environment=dev dryRun=true

# Apply a push plan to backend
vaulter_sync_plan action=push environment=dev apply=true

# Plan a pull into target path
vaulter_sync_plan action=pull environment=dev output=.vaulter/deploy/.env
```

### Analysis & Discovery (4)

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

#### `vaulter_scan`
Scan monorepo to discover packages/apps and initialization state.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | No | `.` | Root directory to scan |
| `format` | string | No | `text` | Output format (`text` or `json`) |

#### `vaulter_services`
List discovered services from local service configs and/or configured services.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | No | `.` | Root directory to scan |
| `detailed` | boolean | No | `false` | Show detailed service info |

Notes:
- Service discovery tries multiple roots (`path`, detected monorepo root, current working directory).
- If no services are found, the command returns fallback hints and monorepo-scan guidance.

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
| `path` | string | No | `.` | Root directory to scan for services |
| `detailed` | boolean | No | `false` | Show environments and backend URLs |

Discovery sources:
- `.vaulter/config.yaml` (per-service configs and `config.services`)
- `config.outputs` (legacy/output-driven monorepos) as fallback when discovery is incomplete

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
Categorize variables by their `sensitive` flag.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name |

Shows which variables are secrets (`sensitive=true`, encrypted) vs configs (`sensitive=false`, plain). No inference - uses the explicit `sensitive` flag set when the variable was created.

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

### Utility Tools (5)

#### `vaulter_move`
Move/copy a variable between scopes (`shared` <-> `service` or service-to-service) in one operation.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | **Yes** | - | Variable name to move |
| `from` | string | **Yes** | - | Source scope (`shared` or `service:<name>`) |
| `to` | string | **Yes** | - | Destination scope (`shared` or `service:<name>`) |
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `overwrite` | boolean | No | `false` | Overwrite destination when exists |
| `dryRun` | boolean | No | `false` | Preview action without applying |
| `deleteOriginal` | boolean | No | `true` | Delete source after move (set false to copy) |

Notes:
- Validates destination scope against `scope_policy` before mutation.
- Uses atomic behavior: on any failure after write, tries to restore destination/source state to avoid half-moves.
- Also validates destination-policy expectations and returns rollback details when needed.

#### `vaulter_copy`
Copy variables from one environment to another. Useful for promoting configs from dev to stg/prd.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `source` | string | **Yes** | - | Source environment (e.g., `dev`) |
| `target` | string | **Yes** | - | Target environment (e.g., `stg`, `prd`) |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name (monorepo) |
| `keys` | string[] | No | - | Specific keys to copy. If omitted, copies all. |
| `pattern` | string | No | - | Pattern to filter keys (e.g., `DATABASE_*`). Ignored if `keys` is provided. |
| `overwrite` | boolean | No | `false` | Overwrite existing vars in target |
| `dryRun` | boolean | No | `false` | Preview what would be copied |

#### `vaulter_rename`
Rename a variable (atomic operation). Copies value to new key and deletes old key.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `oldKey` | string | **Yes** | - | Current variable name |
| `newKey` | string | **Yes** | - | New variable name |
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name (monorepo) |

#### `vaulter_promote_shared`
Promote a service-specific variable to shared (applies to all services).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | **Yes** | - | Variable name to promote |
| `fromService` | string | **Yes** | - | Service where the var currently exists |
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `deleteOriginal` | boolean | No | `true` | Delete the original service var after promoting |

Notes:
- Applies destination scope policy validation (`shared`) and uses atomic behavior with rollback on errors.

#### `vaulter_demote_shared`
Demote a shared variable to a specific service.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | **Yes** | - | Variable name to demote |
| `toService` | string | **Yes** | - | Target service for the var |
| `environment` | string | No | `dev` | Environment name |
| `project` | string | No | auto | Project name |
| `deleteShared` | boolean | No | `true` | Delete the shared var after demoting |

Notes:
- Applies destination scope policy validation (service target) and uses atomic behavior with rollback on errors.

---

### Local Overrides (11)

**OFFLINE-FIRST ARCHITECTURE:**

| Tool | What it does | Backend? |
|------|--------------|----------|
| `vaulter_local_pull` | Generate .env files from `.vaulter/local/` | ❌ OFFLINE |
| `vaulter_local_push` | Push one local var (service/shared) to backend | ✅ Uses backend |
| `vaulter_local_push_all` | Send `.vaulter/local/` → backend | ✅ Uses backend |
| `vaulter_local_sync` | Download backend → `.vaulter/local/` | ✅ Uses backend |
| `vaulter_local_set` | Write service/local overrides to `.vaulter/local/` (shared via `vaulter_local_shared_set`) | ❌ OFFLINE |
| `vaulter_local_delete` | Remove local override from `.vaulter/local/` | ❌ OFFLINE |

**Workflow:**
1. Edit files in `.vaulter/local/`
2. `vaulter_local_pull all=true` → Generate .env files (OFFLINE)
3. `vaulter_local_push_all` → Share with team (when ready)

In monorepos, `vaulter_local_set`, `vaulter_local_delete`, `vaulter_local_diff`, and `vaulter_local_push` require `service` (unless `shared=true` on local push).

New dev joins:
1. `vaulter_local_sync` → Download from backend
2. `vaulter_local_pull all=true` → Generate .env files

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

#### `vaulter_local_pull`
**[OFFLINE]** Generate .env files from `.vaulter/local/`. NO backend calls!

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `output` | string | No | - | Specific output target name |
| `all` | boolean | No | `false` | Pull to all output targets |
| `service` | string | No | - | Service name (monorepo) |

#### `vaulter_local_set`
Set a service-scoped local override. Only modifies local file, never touches backend.
In monorepo mode, `service` is required.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | **Yes** | - | Variable name |
| `value` | string | **Yes** | - | Value to set |
| `service` | string | No | - | Service name (monorepo) |
| `sensitive` | boolean | No | `false` | If true, writes to secrets.env; if false, writes to configs.env |

#### `vaulter_local_push`
Push a single local override to backend (`configs.env` or `secrets.env`) for the selected scope.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | **Yes** | - | Variable name |
| `service` | string | No | - | Service name (monorepo) |
| `shared` | boolean | No | `false` | Use `true` to target shared scope |
| `targetEnvironment` | string | No | base env | Target environment in backend |
| `dryRun` | boolean | No | `false` | Preview changes without applying |

#### `vaulter_local_delete`
Remove a service-scoped local override.
In monorepo mode, `service` is required.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | **Yes** | - | Variable name to remove |
| `service` | string | No | - | Service name (monorepo) |

#### `vaulter_local_diff`
Show service-scoped local overrides vs base environment.
In monorepo mode, `service` is required.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `service` | string | No | - | Service name (monorepo) |

#### `vaulter_local_status`
Show local overrides status: base environment, overrides count, snapshots count.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `service` | string | No | - | Service name (monorepo) |

#### `vaulter_local_shared_set`
Set a shared local override (applies to all services).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | **Yes** | - | Variable name |
| `value` | string | **Yes** | - | Value to set |
| `sensitive` | boolean | No | `false` | If true, writes to secrets.env; if false, writes to configs.env |

#### `vaulter_local_shared_delete`
Remove a shared local override.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | **Yes** | - | Variable name to remove |

#### `vaulter_local_shared_list`
List all shared local overrides.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| (none) | - | - | - | Returns all shared local vars from configs.env + secrets.env |

#### `vaulter_local_push_all`
**[USES BACKEND]** Push ENTIRE `.vaulter/local/` structure to backend. Use to share your complete local setup with the team.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `targetEnvironment` | string | No | base env | Target environment in backend |
| `overwrite` | boolean | No | `false` | Delete backend vars NOT in local (makes backend match local exactly) |
| `dryRun` | boolean | No | `false` | Preview changes without applying |

**Pushes:**
- `.vaulter/local/configs.env + secrets.env` → backend `__shared__`
- `.vaulter/local/services/{svc}/configs.env`
- `.vaulter/local/services/{svc}/secrets.env` → backend `{svc}`

**With `overwrite=true`:** Also DELETES backend vars that don't exist locally. Use with caution!

#### `vaulter_local_sync`
**[USES BACKEND]** Pull from backend to `.vaulter/local/`. This includes shared and service-specific vars and is the inverse of `vaulter_local_push_all`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `sourceEnvironment` | string | No | base env | Source environment to pull from |
| `dryRun` | boolean | No | `false` | Preview changes without applying |

**After sync, run:** `vaulter_local_pull all=true` to generate .env files.

---

### Snapshot Tools (3)

Snapshots are compressed (gzip) backups of an environment's variables with SHA256 integrity verification.
Supports two storage drivers configured via `snapshots.driver` in `.vaulter/config.yaml`:
- **filesystem** (default): Stored in `.vaulter/snapshots/<id>/` with `data.jsonl.gz` + `manifest.json`.
- **s3db**: Uses s3db.js BackupPlugin, storing backups in the same S3 backend. Restore writes directly to the database.

#### `vaulter_snapshot_create`
Create a compressed snapshot of an environment. Returns checksum and path.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | **Yes** | - | Environment to snapshot |
| `name` | string | No | - | Optional name suffix (e.g. `pre-deploy`) |
| `service` | string | No | - | Service name (monorepo) |

**Output includes:** id, environment, varsCount, checksum (sha256), path.

#### `vaulter_snapshot_list`
List all snapshots, optionally filtered by environment. Shows checksum and compression for each.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | - | Filter by environment |

#### `vaulter_snapshot_restore`
Restore a snapshot to the backend. Verifies SHA256 integrity before restoring. In CLI mode, omitting the ID opens an interactive tuiuiu.js selector.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `id` | string | **Yes** | - | Snapshot ID (from snapshot list) |
| `environment` | string | **Yes** | - | Target environment to restore to |
| `service` | string | No | - | Service name (monorepo) |

---

### Diagnostic Tools (3)

#### `vaulter_doctor`
**⭐ CRITICAL: Call this FIRST at the start of a new session (or when operations fail / environments change)** to diagnose vaulter health. Performs **17 comprehensive checks** and returns actionable diagnostics.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment to check |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name (monorepo) |
| `timeout_ms` | number | No | 30000 | Override timeout (useful for slow backends) |

**17 Checks Performed:**

**Basic Checks (1-9):**
1. ✅ Config file exists
2. ✅ Project name configured
3. ✅ Environment valid
4. ✅ Service exists (monorepo)
5. ✅ Backend URLs configured
6. ✅ Encryption keys found
7. ✅ Shared key environment configured
8. ✅ Local `.env` files exist
9. ✅ Outputs configuration valid

**Advanced Checks (10-17):**
10. ✅ **Backend connection** - Tests connectivity and lists vars
11. ✅ **Performance/Latency** - Measures operation speed (read, list)
12. ✅ **Write permissions** - Tests read/write/delete access
13. ✅ **Encryption round-trip** - Validates encrypt → decrypt → match
14. ✅ **Sync status** - Compares local vs remote (differences)
15. ✅ **Security issues** - Detects .env in git, weak keys, bad permissions
16. ✅ **Scope policy** - Validates expected scope ownership by variable domain
17. ✅ **Perf config** - Suggests cache/warmup/concurrency tuning

**Returns:**
```json
{
  "summary": {
    "ok": 13,
    "warn": 1,
    "fail": 1,
    "skip": 0,
    "healthy": false
  },
  "checks": [
    { "name": "connection", "status": "ok", "details": "connected (24 vars)" },
    { "name": "latency", "status": "ok", "details": "read=45ms, list=67ms" },
    { "name": "permissions", "status": "ok", "details": "read/write/delete OK" },
    { "name": "encryption", "status": "ok", "details": "round-trip successful" },
    { "name": "sync-status", "status": "warn", "details": "5 local-only, 3 remote-only" },
    { "name": "security", "status": "fail", "details": "2 .env files tracked in git" }
  ],
  "suggestions": [
    "Add .env files to .gitignore immediately",
    "Run 'vaulter sync diff -e dev' to see details"
  ]
}
```

**When to Use:**
- ✅ **Start of conversation** - Understand current state
- ✅ **Before operations** - Ensure setup is healthy
- ✅ **When errors occur** - Diagnose root cause
- ✅ **After environment changes** - Validate new environment
- ✅ **User asks questions** - Get comprehensive status

**Full Documentation:** See [DOCTOR.md](DOCTOR.md) for complete guide with examples and troubleshooting.

#### `vaulter_clone_env`
Clone ALL variables from one environment to another. Use `dryRun=true` to preview first.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `source` | string | **Yes** | - | Source environment to clone from (e.g., `dev`) |
| `target` | string | **Yes** | - | Target environment to clone to (e.g., `stg`, `prd`) |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name (monorepo) |
| `includeShared` | boolean | No | `true` | Include shared variables |
| `overwrite` | boolean | No | `false` | Overwrite existing vars in target |
| `dryRun` | boolean | No | `false` | Preview what would be cloned (recommended) |

**Example:**
```json
// Preview cloning dev to production
{
  "tool": "vaulter_clone_env",
  "arguments": { "source": "dev", "target": "prd", "dryRun": true }
}
```

#### `vaulter_diff`
Show differences between local file and remote backend. Essential for understanding what will change before push/pull operations.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `dev` | Environment to compare |
| `project` | string | No | auto | Project name |
| `service` | string | No | - | Service name (monorepo) |
| `showValues` | boolean | No | `false` | Show masked values in diff (e.g., `pg://us***`) |

**Output symbols:**
| Symbol | Meaning |
|--------|---------|
| `+` | Local only (will be pushed) |
| `-` | Remote only (will be pulled or deleted with `--prune`) |
| `~` | Different values (conflict) |
| `=` | Identical (synced) |

---

## Resources Reference (7)

Resources provide static/cached data that doesn't require input parameters. They are read-only and ideal for getting context before using tools.

| URI | Description | MIME Type | When to Use |
|-----|-------------|-----------|-------------|
| `vaulter://instructions` | **⚠️ Read first!** How vaulter works | `text/markdown` | Before any other operation |
| `vaulter://tools-guide` | Which tool to use for each scenario | `text/markdown` | When unsure which tool to use |
| `vaulter://workflow` | Local-first dev workflow and promotion path | `text/markdown` | Planning config changes and deployments |
| `vaulter://mcp-config` | MCP settings with sources | `application/json` | Debugging configuration issues |
| `vaulter://config` | Project configuration (YAML) | `application/yaml` | Understanding project setup |
| `vaulter://services` | Monorepo services list (filesystem + outputs fallback) | `application/json` | Working with monorepos |

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
- Core operations (5 tools)
- Batch operations (3 tools)
- Sync operations (3 tools)
- Analysis & Discovery (4 tools)
- Status & Audit (2 tools)
- K8s/IaC Integration (4 tools)
- Key Management (6 tools)
- Monorepo support (5 tools)
- Categorization (1 tool)
- Dangerous operations (1 tool)
- Utility tools (5 tools)
- Local overrides (11 tools)
- Snapshot tools (3 tools)
- Diagnostic tools (3 tools)

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

### MCP Configuration Options (`mcp:`)

You can set MCP defaults in either:
- Project config: `.vaulter/config.yaml` → `mcp:`
- Global config: `~/.vaulter/config.yaml` → `mcp:`

**Example:**
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

**Env overrides (highest priority):**
- `VAULTER_MCP_WARMUP`
- `VAULTER_MCP_SEARCH_CONCURRENCY`
- `VAULTER_MCP_CONFIG_TTL_MS`
- `VAULTER_MCP_KEY_TTL_MS`
- `S3DB_CACHE_ENABLED`, `S3DB_CACHE_TTL`, `S3DB_CACHE_MAX_SIZE`

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

Lists all services discovered in a monorepo, starting from the Vaulter project root.
Discovery checks both service directories containing `.vaulter/config.yaml` and services
declared in `config.services`.

**Example output:**
```json
{
  "discovered": true,
  "count": 2,
  "scannedRoot": "/home/user/project",
  "services": [
    {
      "name": "app-landing",
      "path": "apps/app-landing",
      "configured": true
    },
    {
      "name": "svc-auth",
      "path": "apps/svc-auth",
      "configured": true
    }
  ]
}
```

**No services found:**
```json
{
  "discovered": false,
  "message": "No services found in /home/user/project",
  "hint": "Services are detected by .vaulter/config.yaml directories or `config.services` declarations"
}
```

---

## Prompts Reference (12)

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
| `copy_environment` | Copy variables between envs | `source`, `target`, `filter` |
| `sync_workflow` | Sync local files with remote | `action`, `environment`, `strategy` |

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

Audit environment variables for security issues. Checks for exposed secrets, weak values, and best practices.

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

### `copy_environment`

Copy variables from one environment to another. Useful for promoting configs from dev to staging/production.

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `source` | **Yes** | - | Source environment: `dev`, `stg`, `prd`, `sbx`, `dr` |
| `target` | **Yes** | - | Target environment |
| `filter` | No | `all` | Filter pattern (e.g., `DATABASE_*`, `*_URL`) or `all` |
| `overwrite` | No | `false` | Overwrite existing variables in target |

**Example conversation:**
```
User: Copy all database settings from dev to production

Claude: I'll copy the database settings...
→ Uses vaulter_copy with source="dev", target="prd", pattern="DATABASE_*", dryRun=true
→ Shows preview of what will be copied
→ After confirmation, executes the copy
```

---

### `sync_workflow`

Synchronize local .env files with remote backend. Covers diff, push, pull, and merge operations with conflict resolution.

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `action` | **Yes** | - | `diff` (preview), `push` (local→remote), `pull` (remote→local), `merge` (bidirectional) |
| `environment` | **Yes** | - | Environment: `dev`, `stg`, `prd`, `sbx`, `dr` |
| `strategy` | No | `local` | Conflict resolution: `local` (local wins), `remote` (remote wins), `error` (fail on conflict) |
| `prune` | No | `false` | For push: delete remote vars not in local |

**Example conversation:**
```
User: I want to see what's different between my local .env and the remote backend

Claude: I'll show you the differences...
→ Uses vaulter_diff with showValues=true
→ Shows: + local only, - remote only, ~ different values, = identical
→ Suggests next steps based on differences
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
2. vaulter_pull --dryRun=true → Preview what would change locally
3. vaulter_push --dryRun=true → Preview what would be pushed
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

### 6. Local Development with Overrides

```
1. vaulter_local_set key=PORT value=3001      → Add local override
2. vaulter_local_set key=DEBUG value=true      → Add another
3. vaulter_local_pull all=true                 → Base + overrides → .env files
4. vaulter_local_diff                          → See what's overridden
5. vaulter_local_status                        → Check state
```

### 7. Snapshot Backup/Restore

Snapshots use gzip compression + SHA256 verification. Stored as `data.jsonl.gz` + `manifest.json`.

```
1. vaulter_snapshot_create environment=dev     → Backup (gzip + SHA256 checksum)
2. vaulter_multi_set ...                       → Make changes
3. vaulter_snapshot_list environment=dev       → List with checksum & compression
4. vaulter_snapshot_restore id=<id> environment=dev → Verify SHA256 + rollback
```

CLI: `vaulter snapshot restore -e dev` (sem ID) abre selector interativo via tuiuiu.js.

### 8. Output Targets (Multi-Framework)

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

### Shared Vars Sources

When `inherit: true`, shared vars come from **two sources**:

1. **Vars with `--shared`**: Variables created with the `--shared` flag
2. **Patterns `shared.include`**: Variables matching the patterns in config

Both are merged automatically.

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
