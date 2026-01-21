<div align="center">

# vaulter

### Multi-Backend Environment & Secrets Manager

[![npm version](https://img.shields.io/npm/v/vaulter.svg?style=flat-square&color=F5A623)](https://www.npmjs.com/package/vaulter)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Claude_AI-7C3AED?style=flat-square&logo=anthropic&logoColor=white)](https://modelcontextprotocol.io/)

Organizes your `.env` files with structure and best practices.
<br>
Powered by [dotenv](https://github.com/motdotla/dotenv) for parsing. Store secrets anywhere: S3, MinIO, R2, or filesystem.

</div>

---

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/forattini-dev/vaulter/main/install.sh | sh
# or: npm install -g vaulter
```

## Quick Start

```bash
vaulter init                                          # Initialize project
vaulter key generate --name master                    # Generate encryption key
vaulter var set DATABASE_URL="postgres://..." -e dev  # Set secret
vaulter var set PORT::3000 -e dev                     # Set config (plain)
eval $(vaulter export shell -e dev)                   # Export to shell
```

---

## What is Vaulter?

Vaulter is an **opinionated organizer** for your environment variables. It uses [dotenv](https://github.com/motdotla/dotenv) under the hood for parsing `.env` files - we don't reinvent the wheel, we just add structure.

```bash
# Install in your project
pnpm add vaulter
# or: npm install vaulter
```

**What vaulter adds on top of dotenv:**

| Feature | dotenv | vaulter |
|:--------|:------:|:-------:|
| Parse `.env` files | ✅ | ✅ (uses dotenv) |
| Organize by environment (dev/stg/prd) | ❌ | ✅ |
| Separate local vs deploy files | ❌ | ✅ |
| Auto-detect environment (local/CI/K8s) | ❌ | ✅ |
| Encrypted remote storage | ❌ | ✅ |
| Sync between team members | ❌ | ✅ |
| Export to K8s, Helm, Terraform | ❌ | ✅ |

**Philosophy**: Your local `.env` stays local (gitignored). Configs are committed. Secrets are encrypted in your own storage.

---

## Quick Start (Local Development)

```typescript
// app.ts
import { config } from 'vaulter'

config() // Loads .vaulter/local/shared.env (default: local mode)
```

```bash
# Copy the example and fill in your values
cp .vaulter/local/shared.env.example .vaulter/local/shared.env

# Or run commands with env vars loaded
npx vaulter run -- pnpm dev
```

That's it! For most local development, vaulter is just a structured dotenv.

---

## Commands

### Setup

| Command | Description |
|:--------|:------------|
| `init` | Initialize project config |
| `init --split` | Initialize with split mode (configs/secrets dirs) |

### Variables (`var`)

| Command | Description |
|:--------|:------------|
| `var get <key> -e <env>` | Get a variable |
| `var set KEY=val -e <env>` | Set secret (encrypted) |
| `var set KEY::val -e <env>` | Set config (plain text) |
| `var set KEY:=123 -e <env>` | Set typed secret (number/boolean) |
| `var delete <key> -e <env>` | Delete a variable |
| `var list -e <env>` | List all variables |

**Set syntax**: `=` encrypted secret · `::` plain config · `:=` typed secret

### Sync

| Command | Description |
|:--------|:------------|
| `sync merge -e <env>` | Bidirectional merge (default) |
| `sync pull -e <env>` | Download from backend |
| `sync pull --prune -e <env>` | Download, delete local-only vars |
| `sync push -e <env>` | Upload to backend |
| `sync push --prune -e <env>` | Upload, delete remote-only vars |
| `sync diff -e <env>` | Show differences without changes |

### Export

| Command | Description |
|:--------|:------------|
| `export shell -e <env>` | Export for shell `eval $(...)` |
| `export k8s-secret -e <env>` | Generate Kubernetes Secret |
| `export k8s-configmap -e <env>` | Generate Kubernetes ConfigMap |
| `export helm -e <env>` | Generate Helm values.yaml |
| `export terraform -e <env>` | Generate Terraform .tfvars |
| `export docker -e <env>` | Docker env-file format |
| `export vercel -e <env>` | Vercel environment JSON |
| `export github-actions -e <env>` | GitHub Actions secrets |

### Services (monorepo)

| Command | Description |
|:--------|:------------|
| `service list` | List discovered services |
| `service init` | Add service to config |

### Audit & Rotation

| Command | Description |
|:--------|:------------|
| `audit list -e <env>` | List audit entries |
| `audit stats -e <env>` | Show statistics |
| `rotation list -e <env>` | Check rotation status |
| `rotation run -e <env>` | CI/CD gate for overdue secrets |

### Key Management

| Command | Description |
|:--------|:------------|
| `key generate --name <n>` | Generate symmetric key |
| `key generate --env <env>` | Generate key for specific environment |
| `key generate --name <n> --asymmetric` | Generate RSA/EC key pair |
| `key list` | List all keys |
| `key export --name <n>` | Export encrypted bundle |
| `key import -f <file>` | Import encrypted bundle |
| `key backup -o <file>` | Backup keys to encrypted bundle |
| `key restore -f <file>` | Restore keys from backup bundle |

### Run (Execute with Env Vars)

| Command | Description |
|:--------|:------------|
| `run -- <command>` | Execute command with auto-loaded env vars |
| `run -e prd -- <command>` | Execute with specific environment |
| `run -s api -- <command>` | Execute with service-specific vars (monorepo) |
| `run --verbose -- <command>` | Show which files were loaded |
| `run --dry-run -- <command>` | Preview without executing |

**Examples:**

```bash
# Local development
npx vaulter run -- pnpm dev

# CI/CD build with production vars
npx vaulter run -e prd -- pnpm build

# Monorepo service
npx vaulter run -e dev -s api -- pnpm start
```

The `run` command auto-detects the environment (local, CI, K8s) and loads the appropriate files before executing your command.

> Run `vaulter --help` or `vaulter <command> --help` for all options.

---

## Security

Every secret is encrypted **before** leaving your machine using **AES-256-GCM**.

### Symmetric (Default)

```bash
vaulter key generate --name master
```

### Asymmetric (RSA/EC)

For CI/CD separation: public key encrypts, private key decrypts.

```bash
vaulter key generate --name master --asymmetric              # RSA-4096
vaulter key generate --name master --asym --alg ec-p256      # EC P-256
```

```yaml
# .vaulter/config.yaml
encryption:
  mode: asymmetric
  asymmetric:
    algorithm: rsa-4096
    key_name: master    # ~/.vaulter/projects/<project>/keys/master[.pub]
```

**CI/CD**: Give CI only the public key (can write, can't read). Production gets the private key.

### Per-Environment Keys

Use different encryption keys for each environment (dev, stg, prd). This provides **complete isolation** - production secrets can't be decrypted with dev keys.

```bash
# Generate keys for each environment
vaulter key generate --env dev
vaulter key generate --env stg
vaulter key generate --env prd
```

Keys are stored in `~/.vaulter/projects/{project}/keys/{env}`.

**Key Resolution Order** (per environment):

| Priority | Source | Example |
|:---------|:-------|:--------|
| 1 | Env var `VAULTER_KEY_{ENV}` | `VAULTER_KEY_PRD=my-secret` |
| 2 | Config `encryption.keys.{env}` | See below |
| 3 | File `keys/{env}` | `~/.vaulter/projects/myapp/keys/prd` |
| 4 | Env var `VAULTER_KEY` | Global fallback |
| 5 | Config `encryption.key_source` | Default config |
| 6 | File `keys/master` | Default fallback |

**Per-environment config:**

```yaml
# .vaulter/config.yaml
encryption:
  keys:
    dev:
      source:
        - env: VAULTER_KEY_DEV
        - file: ~/.vaulter/projects/myapp/keys/dev
    prd:
      source:
        - env: VAULTER_KEY_PRD
      mode: asymmetric  # Optional: different mode per env
```

**Multi-app isolation:**

```
~/.vaulter/projects/
├── app-landing/keys/
│   ├── dev    # app-landing dev key
│   ├── stg    # app-landing stg key
│   └── prd    # app-landing prd key
├── app-api/keys/
│   ├── dev    # app-api dev key (DIFFERENT from app-landing)
│   └── prd
└── svc-auth/keys/
    └── prd
```

Each app has completely isolated secrets - `app-landing/prd` keys cannot decrypt `app-api/prd` secrets.

---

## Configuration

```yaml
# .vaulter/config.yaml
version: "1"
project: my-project

backend:
  url: s3://bucket/envs?region=us-east-1

encryption:
  key_source:
    - env: VAULTER_KEY
    - file: .vaulter/.key
  rotation:
    enabled: true
    interval_days: 90
    patterns: ["*_KEY", "*_SECRET", "*_TOKEN"]

environments: [dev, stg, prd]
default_environment: dev

audit:
  enabled: true
  retention_days: 90

# Local vs Deploy separation (recommended)
local:
  shared: .vaulter/local/shared.env
  shared_example: .vaulter/local/shared.env.example

deploy:
  shared:
    configs: .vaulter/deploy/shared/configs/{env}.env
    secrets: .vaulter/deploy/shared/secrets/{env}.env
  services:
    configs: .vaulter/deploy/services/{service}/configs/{env}.env
    secrets: .vaulter/deploy/services/{service}/secrets/{env}.env
```

### Backend URLs

| Provider | URL |
|:---------|:----|
| AWS S3 | `s3://bucket/path?region=us-east-1` |
| MinIO | `http://KEY:SECRET@localhost:9000/bucket` |
| Cloudflare R2 | `https://KEY:SECRET@ACCOUNT.r2.cloudflarestorage.com/bucket` |
| DigitalOcean | `https://KEY:SECRET@nyc3.digitaloceanspaces.com/bucket` |
| FileSystem | `file:///path/to/storage` |

### Local vs Deploy Structure

Vaulter separates **local development** from **deployment** configurations:

```
.vaulter/
├── config.yaml
├── local/                     # Developer machine (gitignored)
│   ├── shared.env             # Your local secrets
│   └── shared.env.example     # Template (committed)
└── deploy/                    # CI/CD pipelines
    └── shared/
        ├── configs/           # Committed to git
        │   ├── dev.env
        │   ├── stg.env
        │   └── prd.env
        └── secrets/           # Gitignored, pulled from backend
            ├── dev.env
            └── prd.env
```

**Why this structure:**

| Location | Purpose | Git | Contains |
|:---------|:--------|:----|:---------|
| `local/shared.env` | Developer's machine | Ignored | Personal secrets (API keys, DB creds) |
| `local/shared.env.example` | Template for devs | Committed | Placeholder values |
| `deploy/configs/*.env` | CI/CD configs | Committed | Non-sensitive (PORT, HOST, LOG_LEVEL) |
| `deploy/secrets/*.env` | CI/CD secrets | Ignored | Pulled via `vaulter sync pull` |

**Gitignore:**

```gitignore
# Local development
.vaulter/local/shared.env
.vaulter/local/*.env
!.vaulter/local/*.env.example

# Deploy secrets (pulled in CI)
.vaulter/deploy/shared/secrets/
.vaulter/deploy/services/*/secrets/
```

---

## CI/CD

### GitHub Action (Recommended)

Use the official Vaulter GitHub Action for seamless CI/CD integration:

```yaml
- uses: forattini-dev/vaulter@v1
  id: secrets
  with:
    backend: s3://my-bucket/secrets
    project: my-app
    environment: prd
    outputs: env,k8s-secret
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    VAULTER_PASSPHRASE: ${{ secrets.VAULTER_PASSPHRASE }}
```

#### Output Formats

| Output | File | Use Case |
|:-------|:-----|:---------|
| `env` | `.env` | Docker, Node.js |
| `json` | `vaulter-vars.json` | Custom scripts |
| `k8s-secret` | `k8s-secret.yaml` | `kubectl apply` |
| `k8s-configmap` | `k8s-configmap.yaml` | `kubectl apply` |
| `helm-values` | `helm-values.yaml` | `helmfile`, `helm` |
| `tfvars` | `terraform.auto.tfvars` | `terraform`, `terragrunt` |
| `shell` | `vaulter-env.sh` | `source` in scripts |

#### Full Examples

**kubectl:**
```yaml
- uses: forattini-dev/vaulter@v1
  with:
    backend: ${{ secrets.VAULTER_BACKEND }}
    project: my-app
    environment: prd
    outputs: k8s-secret,k8s-configmap
    k8s-namespace: my-namespace
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    VAULTER_PASSPHRASE: ${{ secrets.VAULTER_PASSPHRASE }}

- run: |
    kubectl apply -f k8s-secret.yaml
    kubectl apply -f k8s-configmap.yaml
```

**Helmfile:**
```yaml
- uses: forattini-dev/vaulter@v1
  with:
    backend: ${{ secrets.VAULTER_BACKEND }}
    project: my-app
    environment: prd
    outputs: helm-values
    helm-values-path: ./helm/secrets.yaml
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    VAULTER_PASSPHRASE: ${{ secrets.VAULTER_PASSPHRASE }}

- run: helmfile -e prd apply
```

**Terraform/Terragrunt:**
```yaml
- uses: forattini-dev/vaulter@v1
  with:
    backend: ${{ secrets.VAULTER_BACKEND }}
    project: infra
    environment: prd
    outputs: tfvars
    # .auto.tfvars is loaded automatically by Terraform!
    tfvars-path: ./secrets.auto.tfvars
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    VAULTER_PASSPHRASE: ${{ secrets.VAULTER_PASSPHRASE }}

- run: terragrunt apply -auto-approve
```

**Docker Build:**
```yaml
- uses: forattini-dev/vaulter@v1
  with:
    backend: ${{ secrets.VAULTER_BACKEND }}
    project: my-app
    environment: prd
    outputs: env
    env-path: .env.production
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    VAULTER_PASSPHRASE: ${{ secrets.VAULTER_PASSPHRASE }}

- run: docker build --secret id=env,src=.env.production -t app .
```

**Export to GITHUB_ENV:**
```yaml
- uses: forattini-dev/vaulter@v1
  with:
    backend: ${{ secrets.VAULTER_BACKEND }}
    project: my-app
    environment: prd
    export-to-env: true  # Makes vars available in subsequent steps
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    VAULTER_PASSPHRASE: ${{ secrets.VAULTER_PASSPHRASE }}

- run: echo "Database is $DATABASE_URL"  # Available!
```

#### Action Inputs

| Input | Required | Default | Description |
|:------|:--------:|:--------|:------------|
| `backend` | ✓ | - | S3 connection string |
| `project` | ✓ | - | Project name |
| `environment` | ✓ | - | Environment (dev/stg/prd) |
| `service` | | - | Service (monorepo) |
| `outputs` | | `env` | Comma-separated outputs |
| `k8s-namespace` | | `default` | K8s namespace |
| `export-to-env` | | `false` | Export to GITHUB_ENV |
| `mask-values` | | `true` | Mask secrets in logs |

#### Action Outputs

| Output | Description |
|:-------|:------------|
| `env-file` | Path to .env file |
| `k8s-secret-file` | Path to K8s Secret YAML |
| `k8s-configmap-file` | Path to K8s ConfigMap YAML |
| `helm-values-file` | Path to Helm values file |
| `tfvars-file` | Path to .tfvars file |
| `vars-count` | Number of variables |
| `vars-json` | JSON array of variable names |

### CLI in CI/CD

You can also use the CLI directly:

```yaml
- name: Pull and build
  env:
    VAULTER_PASSPHRASE: ${{ secrets.VAULTER_PASSPHRASE }}
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  run: |
    npx vaulter sync pull -e prd
    npx vaulter run -e prd -- pnpm build
```

### Other Platforms

```bash
# GitLab CI
npx vaulter run -e ${CI_ENVIRONMENT_NAME} -- pnpm build

# Docker (build with secrets)
npx vaulter run -e prd -- docker build -t myapp .

# Terraform
vaulter export terraform -e prd > secrets.auto.tfvars

# Helm
vaulter export helm -e prd | helm upgrade myapp ./chart -f -

# Direct export
npx vaulter export k8s-secret -e prd | kubectl apply -f -
```

### Kubernetes Runtime

When running in Kubernetes, env vars are already injected via ConfigMap/Secret. Vaulter's `config()` function **automatically skips** loading when it detects K8s:

```typescript
import { config } from 'vaulter'

config() // Skips in K8s, loads files elsewhere
```

Detection: `KUBERNETES_SERVICE_HOST` environment variable is set by K8s automatically.

---

## Monorepo Support

Auto-detects NX, Turborepo, Lerna, pnpm, Yarn workspaces, Rush.

```bash
vaulter service list                       # List discovered services
vaulter sync push -e dev -s api            # Push specific service
vaulter sync push -e dev --shared          # Push shared variables
vaulter export shell -e dev -s api         # Export with shared inheritance
vaulter export shell -e dev --shared       # Export only shared variables
```

### Shared Variables Inheritance

When exporting for a specific service, **shared variables are automatically included**:

```bash
# Shared vars: NODE_ENV=development, LOG_LEVEL=debug
# API service vars: PORT=3000, LOG_LEVEL=info

vaulter export shell -e dev -s api
# Output: NODE_ENV=development, LOG_LEVEL=info, PORT=3000
# (service vars override shared vars with same key)

# To export without inheritance:
vaulter export shell -e dev -s api --no-shared
```

---

## Output Targets (Multi-Framework)

**One config → multiple `.env` files.** Works with any framework: Next.js, NestJS, Express, NX, Turborepo, etc.

### The Problem

Different apps need different variables in different places:

```
apps/
├── web/          # Next.js needs .env.local with NEXT_PUBLIC_*
├── api/          # NestJS needs .env with DATABASE_*, JWT_*
└── admin/        # Needs everything
```

### The Solution

Define outputs once, pull everywhere:

```yaml
# .vaulter/config.yaml
outputs:
  web:
    path: apps/web
    filename: .env.local
    include: [NEXT_PUBLIC_*]      # Only public vars

  api:
    path: apps/api
    include: [DATABASE_*, JWT_*]  # Only backend vars
    exclude: [*_DEV]              # No dev-only vars

  admin: apps/admin               # Shorthand: all vars

# Shared across all outputs (inherited automatically)
shared:
  include: [NODE_ENV, LOG_LEVEL, SENTRY_*]
```

### Pull to All Outputs

```bash
# Pull to all outputs at once
vaulter sync pull --all

# Result:
# ✓ web: apps/web/.env.local (5 vars)
# ✓ api: apps/api/.env (12 vars)
# ✓ admin: apps/admin/.env (25 vars)
```

### Pull to Specific Output

```bash
# Pull only web
vaulter sync pull --output web

# Preview without writing
vaulter sync pull --all --dry-run
```

### How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    Backend (S3)                         │
│  DATABASE_URL, JWT_SECRET, NEXT_PUBLIC_API, LOG_LEVEL   │
└────────────────────────┬────────────────────────────────┘
                         │
              vaulter sync pull --all
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   ┌──────────┐    ┌──────────┐    ┌──────────┐
   │   web    │    │   api    │    │  admin   │
   │ .env.local│   │  .env    │    │  .env    │
   │          │    │          │    │          │
   │ LOG_LEVEL│    │ LOG_LEVEL│    │ LOG_LEVEL│  ← shared (inherited)
   │ NEXT_*   │    │ DATABASE_│    │ ALL VARS │  ← filtered by include/exclude
   └──────────┘    │ JWT_*    │    └──────────┘
                   └──────────┘
```

### Pattern Syntax

| Pattern | Matches |
|:--------|:--------|
| `NEXT_PUBLIC_*` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GA_ID` |
| `*_SECRET` | `JWT_SECRET`, `API_SECRET` |
| `DATABASE_*` | `DATABASE_URL`, `DATABASE_HOST` |
| `*_URL` | `API_URL`, `DATABASE_URL`, `REDIS_URL` |

### Inheritance

By default, `shared.include` vars are added to ALL outputs. Override with `inherit: false`:

```yaml
outputs:
  isolated-app:
    path: apps/isolated
    inherit: false           # No shared vars
    include: [ISOLATED_*]
```

---

## API Usage

```typescript
import { VaulterClient, loadConfig } from 'vaulter'

const client = new VaulterClient({ config: loadConfig() })
await client.connect()

await client.set({ key: 'API_KEY', value: 'sk-xxx', project: 'my-project', environment: 'prd' })
const value = await client.get('API_KEY', 'my-project', 'prd')
const vars = await client.list({ project: 'my-project', environment: 'prd' })

await client.disconnect()
```

### Smart Config (Auto-Detection)

The `config()` function auto-detects your environment and loads the appropriate files:

```typescript
import { config } from 'vaulter'

// Auto-detect environment and load appropriate files
const result = config()

// With options
config({
  mode: 'auto',        // 'auto' | 'local' | 'deploy' | 'skip'
  environment: 'dev',  // Override environment (dev, stg, prd)
  service: 'api',      // For monorepo service-specific vars
  verbose: true,       // Debug output
})
```

**Environment Detection:**

| Environment | Detection | Behavior |
|:------------|:----------|:---------|
| **Kubernetes** | `KUBERNETES_SERVICE_HOST` set | Skip loading (vars injected via ConfigMap/Secret) |
| **CI/CD** | `CI=true`, `GITHUB_ACTIONS`, etc. | Load from `.vaulter/deploy/` |
| **Local** | Default | Load from `.vaulter/local/shared.env` |

**Why this matters:**
- **K8s**: Env vars are already injected, no file loading needed
- **CI/CD**: Uses committed configs + secrets pulled from backend
- **Local**: Developer's machine-specific `.env` file (gitignored)

### Auto-load (dotenv compatible)

```typescript
import 'vaulter/load'  // Auto-loads .env into process.env
```

---

## Runtime Loader (No .env Files)

Load secrets directly from the backend at application startup - **no .env files, no Kubernetes ConfigMaps/Secrets needed**.

### Quick Start

```typescript
// Option 1: Side-effect import (auto-loads with defaults)
import 'vaulter/runtime/load'

// Option 2: With options
import { loadRuntime } from 'vaulter'

await loadRuntime({
  environment: 'prd',
  service: 'api',        // Optional: for monorepos
  required: true         // Default: true in prd, false otherwise
})

// Now process.env has all your secrets!
console.log(process.env.DATABASE_URL)
```

### How It Works

1. Reads `.vaulter/config.yaml` to find backend URL
2. Loads encryption key (per-environment support)
3. Fetches secrets from S3/MinIO backend
4. Populates `process.env`

### Configuration

```yaml
# .vaulter/config.yaml
project: my-app
backend:
  url: s3://my-bucket/secrets

# Runtime detects environment from NODE_ENV or config
default_environment: dev
```

### Options

| Option | Type | Default | Description |
|:-------|:-----|:--------|:------------|
| `environment` | string | `NODE_ENV` or `dev` | Target environment |
| `project` | string | from config | Project name |
| `service` | string | - | Service name (monorepo) |
| `required` | boolean | `true` in prd | Throw on failure |
| `override` | boolean | `false` | Override existing env vars |
| `includeShared` | boolean | `true` | Include shared vars (monorepo) |
| `filter.include` | string[] | `[]` | Glob patterns to include |
| `filter.exclude` | string[] | `[]` | Glob patterns to exclude |
| `verbose` | boolean | `false` | Enable logging |

### Per-Environment Keys

Runtime loader automatically uses per-environment keys:

```bash
# Set env-specific keys
export VAULTER_KEY_DEV="dev-secret"
export VAULTER_KEY_PRD="prd-secret"

# Or generate key files
vaulter key generate --env prd
```

### Use Cases

**Kubernetes without ConfigMaps/Secrets:**

```yaml
# deployment.yaml - No configMapRef/secretRef needed!
env:
  - name: VAULTER_KEY_PRD
    valueFrom:
      secretKeyRef:
        name: vaulter-key
        key: prd
  - name: VAULTER_BACKEND
    value: "s3://my-bucket/secrets"
```

```typescript
// app.ts - Secrets loaded at startup
import 'vaulter/runtime/load'
// process.env.DATABASE_URL is now available
```

**Lambda/Serverless:**

```typescript
import { loadRuntime } from 'vaulter'

export const handler = async (event) => {
  await loadRuntime({ environment: 'prd' })
  // Use secrets from process.env
}
```

### Library API

```typescript
import { loadRuntime, isRuntimeAvailable, getRuntimeInfo } from 'vaulter'

// Check if runtime config exists
if (isRuntimeAvailable()) {
  const info = await getRuntimeInfo()
  console.log(info.project, info.environment, info.backend)
}

// Load with callbacks
const result = await loadRuntime({
  environment: 'prd',
  onLoaded: (r) => console.log(`Loaded ${r.varsLoaded} vars in ${r.durationMs}ms`),
  onError: (e) => console.error('Failed:', e.message)
})
```

---

## MCP Server

Claude AI integration via Model Context Protocol. **30 tools, 5 resources, 8 prompts.**

```bash
vaulter mcp
```

### Claude Desktop

```json
{
  "mcpServers": {
    "vaulter": {
      "command": "vaulter",
      "args": ["mcp", "--cwd", "/path/to/project"]
    }
  }
}
```

### Tools (30)

| Category | Tools |
|:---------|:------|
| **Core (5)** | `vaulter_get`, `vaulter_set`, `vaulter_delete`, `vaulter_list`, `vaulter_export` |
| **Batch (3)** | `vaulter_multi_get`, `vaulter_multi_set`, `vaulter_multi_delete` |
| **Sync (3)** | `vaulter_sync`, `vaulter_pull`, `vaulter_push` |
| **Analysis (2)** | `vaulter_compare`, `vaulter_search` |
| **Status (2)** | `vaulter_status`, `vaulter_audit_list` |
| **K8s (2)** | `vaulter_k8s_secret`, `vaulter_k8s_configmap` |
| **IaC (2)** | `vaulter_helm_values`, `vaulter_tf_vars` |
| **Keys (5)** | `vaulter_key_generate`, `vaulter_key_list`, `vaulter_key_show`, `vaulter_key_export`, `vaulter_key_import` |
| **Monorepo (5)** | `vaulter_init`, `vaulter_scan`, `vaulter_services`, `vaulter_shared_list`, `vaulter_inheritance_info` |
| **Other (1)** | `vaulter_categorize_vars` |

### Resources (5)

Static data views (no input required). For actions with parameters, use tools.

| URI | Description |
|:----|:------------|
| `vaulter://instructions` | **Read first!** How vaulter stores data (s3db.js architecture) |
| `vaulter://tools-guide` | Which tool to use for each scenario |
| `vaulter://mcp-config` | MCP settings sources (priority chain) |
| `vaulter://config` | Project configuration (YAML) |
| `vaulter://services` | Monorepo services list |

### Prompts (8)

Pre-configured workflows for common tasks.

| Prompt | Description |
|:-------|:------------|
| `setup_project` | Initialize new vaulter project |
| `migrate_dotenv` | Migrate existing .env files |
| `deploy_secrets` | Deploy to Kubernetes |
| `compare_environments` | Compare dev vs prd |
| `security_audit` | Audit secrets for issues |
| `rotation_workflow` | Check/rotate/report on rotation |
| `shared_vars_workflow` | Manage monorepo shared vars |
| `batch_operations` | Multi-set/get/delete operations |

> **Full MCP documentation:** See [docs/MCP.md](docs/MCP.md) for complete tool reference with parameters.

---

## TUI (Terminal Interface)

```bash
vaulter tui              # Menu
vaulter tui dashboard    # Secrets dashboard
vaulter tui audit        # Audit log viewer
vaulter tui keys         # Key manager
```

### Shortcuts

**Global**: `q` quit · `ESC` back · `↑↓` navigate

| Screen | Shortcuts |
|:-------|:----------|
| Menu | `1` `2` `3` quick access to screens |
| Dashboard | `r` refresh · `v` toggle values · `e` cycle env |
| Audit | `o` filter op · `s` filter source · `/` search · `c` clear |
| Keys | `r` refresh · `c` toggle config |

---

## Pre-built Binaries

Download from [Releases](https://github.com/forattini-dev/vaulter/releases):

| Platform | Binary |
|:---------|:-------|
| Linux x64/ARM64 | `vaulter-linux-x64`, `vaulter-linux-arm64` |
| macOS x64/ARM64 | `vaulter-macos-x64`, `vaulter-macos-arm64` |
| Windows x64 | `vaulter-win-x64.exe` |

---

## License

MIT © [Forattini](https://github.com/forattini-dev)
