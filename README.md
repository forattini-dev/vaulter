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

## Quick Start (mínimo)

```bash
vaulter init                                          # Initialize project
vaulter key generate --name master                    # Generate encryption key
vaulter change set DATABASE_URL="postgres://..." -e dev  # Set secret
vaulter change set PORT::3000 -e dev                     # Set config (plain)
vaulter change set NODE_ENV=local -e dev                 # Set config (sensitive=false)
vaulter change move API_KEY --from shared --to api -e dev # Move variable to service
vaulter change move API_KEY --from shared -e dev -s svc-notifications   # Infer destination service
vaulter plan -e dev                                      # Preview changes before applying
eval $(vaulter export shell -e dev)                   # Export to shell
```

## Exemplo completo (End-to-End)

Monorepo example with two services (`web`, `api`): add variables, share with team, and promote to multiple environments.

```bash
# 0) Initialize + discover services
vaulter init --monorepo
vaulter key generate --name master
vaulter services

# 1) Create/override vars locally (offline)
# `local set` always writes to `.vaulter/local/*`; `-e/--env` is optional here.
# `-e` passa a fazer diferença em operações que tocam backend (`local push/sync`).
vaulter local set NEXT_PUBLIC_APP_NAME=Portal        --shared
vaulter local set NODE_ENV=local                    --shared
vaulter local set DATABASE_URL=postgres://...        -s api
vaulter local set REDIS_URL=redis://...             -s api
vaulter local set QUEUE_ENABLED::true               -s api
vaulter local set WORKER_CONCURRENCY::4             -s web
vaulter local pull --all                             # generates .env for local run (all outputs)
vaulter local diff                                # review local overrides

# 2) Share source of truth with team (backend sync)
vaulter local push --all -e dev

# 3) Team members pull and generate local envs
vaulter local sync -e dev
vaulter local pull --all

# 4) Promote the same managed set to multiple environments
for ENV in dev stg prd; do
  echo "Deploying to $ENV"
  vaulter plan -e "$ENV"
  vaulter apply -e "$ENV" $( [ "$ENV" = "prd" ] && echo '--force' )
done

# 5) Run your scripts with vaulter-managed variables
vaulter run -e dev -- pnpm start                  # local run with local overrides
vaulter run -e dev -s web -- pnpm --dir apps/web dev
vaulter run -e dev -s api -- pnpm --dir apps/api lint
vaulter run -e stg -s api -- pnpm --dir apps/api migrate
vaulter run -e prd -- docker compose -f ./deploy/docker/docker-compose.yml up

# 6) Export service-specific artifacts per environment
vaulter export k8s-secret -e dev --service api --name api-secrets
vaulter export k8s-secret -e dev --service web --name web-secrets
vaulter export k8s-secret -e stg --service api --name api-secrets
vaulter export k8s-secret -e prd --service api --name api-secrets
```

> `--force` is required on `apply -e prd` and other production-like environments.

---

## 🔄 Development Workflow

Vaulter follows a **backend-sync** workflow where the backend is the source of truth and local overrides are for personal customization.

### The Golden Rule

> **Backend is the source of truth. Everything syncs via backend.**

| Component | Git Status | Purpose |
|:----------|:-----------|:--------|
| **`.vaulter/config.yaml`** | ✅ Committed | Project configuration |
| **`.vaulter/local/*`** | ❌ Gitignored | Personal local overrides |
| **`*.env` files** | ❌ Gitignored | Generated outputs |

### Directory Structure

```
.vaulter/
├── config.yaml              # ✅ Committed - Project config
├── local/                   # ❌ Gitignored - Personal overrides
│   ├── configs.env          # Non-sensitive overrides (DEBUG, PORT)
│   ├── secrets.env          # Sensitive overrides (test API keys)
│   └── services/            # Monorepo per-service overrides
│       └── api/
│           ├── configs.env
│           └── secrets.env
└── dev/                     # ❌ Gitignored - Environment data (--dir mode)
    ├── configs.env          # Shared non-sensitive vars
    ├── secrets.env          # Shared sensitive vars
    └── services/            # Monorepo service vars
        └── api/
            ├── configs.env
            └── secrets.env

apps/web/.env                # ❌ Gitignored - Generated output
apps/api/.env                # ❌ Gitignored - Generated output
```

**Directory modes:**
- `.vaulter/local/` - Personal overrides (never synced to backend)
- `.vaulter/{env}/` - Environment data (synced with `--dir` mode)

### .gitignore Setup

```gitignore
# Vaulter - only commit config.yaml
.vaulter/local/
*.env
.env.*
```

### Daily Workflow

```bash
# 1. Start: Pull latest from backend + apply your local overrides
vaulter local pull

# 2. Work: Add personal overrides (not shared with team)
vaulter local set DEBUG::true                  # Shared override
vaulter local set PORT::3001                   # Service-specific (inferred from cwd in monorepo)

# 3. Add new variable for team? Push to backend
vaulter local set NEW_VAR=value --shared        # Personal scratch pad
vaulter local push                             # Share scratch locally with team
vaulter plan -e dev                            # Preview changes (recommended)
vaulter apply -e dev                           # Apply after approval

# 4. Check: See what's different
vaulter diff -e dev                             # Local vs backend diff

# 5. Promote: Clone to staging/production
vaulter clone dev stg --dry-run                # Preview
vaulter clone dev stg                          # Execute
```

### Environment Promotion Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     DEVELOPMENT WORKFLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   LOCAL (.vaulter/local/)      ◄── Personal only (gitignored)   │
│   ├── configs.env                                               │
│   └── secrets.env                                               │
│          │                                                       │
│          │ merged on `vaulter local pull`                       │
│          ▼                                                       │
│                                                                  │
│   BACKEND (S3/MinIO)           ◄── Source of truth (synced)     │
│   ├── dev/  ──────────────────────────────────────────────┐     │
│   │   └── all vars (encrypted)                            │     │
│   │                                                       │     │
│   ├── stg/  ◄─────── vaulter clone dev stg ──────────────┤     │
│   │   └── all vars (encrypted)                            │     │
│   │                                                       │     │
│   └── prd/  ◄─────── vaulter clone stg prd ──────────────┘     │
│       └── all vars (encrypted)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Team Collaboration

**New team member setup:**
```bash
git clone <repo>                    # Gets .vaulter/config.yaml
export VAULTER_KEY_DEV=<from-team>  # Get key securely from team
vaulter local sync                  # Pull from backend → .vaulter/local/
vaulter local pull                 # Generate .env files (offline)
```

**Sharing a new variable:**
```bash
# 1. Add locally
vaulter local set NEW_FEATURE::enabled  # Shared config

# 2. Push to backend (share with team)
vaulter plan -e dev && vaulter apply -e dev

# 3. Notify team
# "New var added, run: vaulter local sync && vaulter local pull"
```

### MCP Tools for Workflow

| Task | Tool |
|:-----|:-----|
| Check health | `vaulter_status action="scorecard"` |
| Pull with overrides | `vaulter_local action="pull"` |
| Set shared override | `vaulter_local action="shared-set" key="DEBUG" value="true"` |
| Set service override | `vaulter_local action="set" key="PORT" value="3001"` |
| See differences | `vaulter_diff` |
| Compare environments | `vaulter_search source="dev" target="prd"` |

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

config() // Loads from .vaulter/local/ (configs.env + secrets.env)
```

```bash
# Run commands with env vars loaded
npx vaulter run -- pnpm dev

# Or pull from backend first
vaulter local pull
```

That's it! For most local development, vaulter is just a structured dotenv.

---

## 🩺 Health Check - Status

**Always start with `vaulter status`** to diagnose your setup:

```bash
vaulter status -e dev
vaulter status -e dev --offline
```

Status performs **up to 18 checks** online, or a local-first subset in `--offline`.

| Check | What It Does |
|-------|--------------|
| ✅ **Connection** | Tests backend connectivity (skipped in `--offline`) |
| ✅ **Latency** | Measures operation speed |
| ✅ **Permissions** | Validates read/write/delete access |
| ✅ **Encryption** | Tests encrypt → decrypt round-trip |
| ✅ **Sync Status** | Compares local vs remote |
| ✅ **Security** | Detects .env in git, weak keys |
| ✅ **Scope Policy** | Checks `shared` vs `service` assignment rules |
| ✅ **Perf Config** | Suggests cache/warmup/concurrency tuning |
| ✅ **+8 more** | Config, project, environment, backend, keys, etc. |

**Example output:**

```
✓ ok: 15 | ⚠ warn: 1 | ✗ fail: 1

✓ connection: connected (24 vars in dev)
✓ latency: read=45ms, list=67ms
✓ permissions: read/write/delete OK
✓ encryption: round-trip successful
⚠ sync-status: 5 local-only, 3 remote-only, 2 conflicts
✗ security: 2 .env files tracked in git
  → Add to .gitignore immediately
```

**When to use:**
- 🆕 Initial setup - validate configuration
- 🐛 Debugging - identify root cause
- 🚀 Pre-deploy - ensure everything is synced
- 🔄 Routine - weekly health check

### Runbook local (`scripts/vaulter-verify-dev.sh`)

For a quick pre-deploy validation in local/dev workflows:

```bash
VAULTER_VERIFY_ENV=dev pnpm run verify:vaulter
VAULTER_VERIFY_OFFLINE=0 VAULTER_VERIFY_REQUIRE_CONFIG=1 pnpm run verify:vaulter
```

The script runs:

- `vaulter status -e <env> -v [--offline]` (offline by default)
- `vaulter diff -e <env> --values`
- `vaulter list -e <env>`

It writes an execution log under `artifacts/vaulter-health/` for auditability.

**For AI Agents:** Call `vaulter_status action="scorecard"` once at the start of a new session (or when operations fail / environments change) to understand the current state before performing sensitive operations.

See [docs/DOCTOR.md](docs/DOCTOR.md) for complete guide.

---

## Commands

### Setup

| Command | Description |
|:--------|:------------|
| `init` | Initialize project config |
| `init --split` | Initialize with split mode (configs/secrets dirs) |

### Health

| Command | Description |
|:--------|:------------|
| `status -e <env>` | Full diagnostic report with checks and suggestions |

### Mutations (`change`)

| Command | Description |
|:--------|:------------|
| `change set KEY=val -e <env>` | Set secret (encrypted) |
| `change set KEY::val -e <env>` | Set config (plain text) |
| `change set KEY:=123 -e <env>` | Set typed secret (number/boolean) |
| `change delete <key> -e <env>` | Delete variable |
| `change move <key> --from <scope> --to <scope> -e <env>` | Move/copy variable between scopes |
| `change import -f <file> -e <env>` | Import variables from file |
| `list -e <env>` | List all variables |

**Set syntax**: `=` encrypted secret · `::` plain config · `:=` typed secret

In monorepo mode, when `--service` is resolved, one of `--from` or `--to` can be omitted and inferred from the active service.

### Plan & Apply

| Command | Description |
|:--------|:------------|
| `plan -e <env>` | Compute diff local vs backend, generate plan artifact |
| `apply -e <env>` | Execute plan, push changes to backend |
| `diff -e <env>` | Quick diff without plan artifacts |
| `plan --dir -e <env>` | Plan from `.vaulter/{env}/` directory |
| `plan [--plan-output <file>] -e <env>` | Write plan artifact (`.json` + `.md`). If `--plan-output` is omitted, defaults to `artifacts/vaulter-plans/<project>-<env>-<timestamp>.*` |

### Recommended daily path

- `vaulter local pull` → `vaulter local set` → `vaulter local push` (when ready)
- `vaulter change set` → `vaulter change move` → `vaulter plan -e <env>` → `vaulter apply -e <env>`
- `vaulter plan -e <env>` → validate → `vaulter apply -e <env>`
- `vaulter status -e <env>` for quick pre-flight health check

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
| `services list` | List discovered services |
| `services` | Same as `services list` |

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

### Run scripts via package.json

Use `vaulter run` directly in your npm scripts to keep variables centralized and explicit.

```json
{
  "scripts": {
    "dev:web": "vaulter run -e dev -s web -- pnpm --dir apps/web dev",
    "lint:api": "vaulter run -e dev -s api -- pnpm --dir apps/api lint",
    "migrate:api:stg": "vaulter run -e stg -s api -- pnpm --dir apps/api run migrate",
    "deploy:api:prd": "vaulter run -e prd -s api -- pnpm --dir apps/api build && vaulter export k8s-secret -e prd -s api --name api-secrets"
  }
}
```

```bash
npm run dev:web
npm run lint:api
npm run migrate:api:stg
```

The important part is that `vaulter run` stays as the first command so variable resolution and scope resolution
happen before your script command.

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

### Shared Variables Key (Monorepo)

In monorepos, shared variables need a consistent encryption key. Use `shared_key_environment` to specify which environment's key encrypts shared vars:

```yaml
# .vaulter/config.yaml
encryption:
  shared_key_environment: dev  # Use dev key for all shared vars
  keys:
    dev:
      source:
        - env: VAULTER_KEY_DEV
    prd:
      source:
        - env: VAULTER_KEY_PRD
```

**Why this matters:**
- Shared vars (`__shared__` service) need ONE key to encrypt/decrypt
- Without `shared_key_environment`, vaulter uses the current environment's key
- This can cause issues when different environments have different keys

**Example flow:**
```bash
# Set shared var (uses dev key because shared_key_environment: dev)
vaulter change set LOG_LEVEL=debug -e dev --scope shared

# Read shared var from prd (still uses dev key for shared vars)
vaulter list -e prd --shared  # Works! Uses dev key for shared
```

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

scope_policy:
  mode: warn
  inherit_defaults: true
  rules:
    - name: api-keys-service
      pattern: '^API_'
      expected_scope: service
      expected_service: svc-app
      reason: 'API_* vars are service-owned'
    - name: app-url-shared-default
      pattern: '^APP_.*_URL$'
      expected_scope: shared
      reason: 'URL variables stay shared by default'

# Local development files (see "Local vs Deploy Structure" below)
# local: .vaulter/local/

# CI/CD deploy files (see "Local vs Deploy Structure" below)
# deploy: .vaulter/deploy/
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
│   ├── configs.env            # Non-sensitive (sensitive=false)
│   ├── secrets.env            # Sensitive (sensitive=true)
│   └── services/              # Monorepo only
│       └── <service>/
│           ├── configs.env
│           └── secrets.env
└── deploy/                    # CI/CD pipelines
    ├── configs/               # Committed to git
    │   ├── dev.env
    │   ├── stg.env
    │   └── prd.env
    └── secrets/               # Gitignored, pulled from backend
        ├── dev.env
        └── prd.env
```

**Why this structure:**

| Location | Purpose | Git | Contains |
|:---------|:--------|:----|:---------|
| `local/configs.env` | Developer's machine | Ignored | Non-sensitive local vars |
| `local/secrets.env` | Developer's machine | Ignored | Sensitive local secrets |
| `deploy/configs/*.env` | CI/CD configs | Committed | Non-sensitive (PORT, HOST, LOG_LEVEL) |
| `deploy/secrets/*.env` | CI/CD secrets | Ignored | Pulled via `vaulter local sync` |

**Gitignore:**

```gitignore
# Local development
.vaulter/local/configs.env
.vaulter/local/secrets.env
.vaulter/local/services/

# Deploy secrets (pulled in CI)
.vaulter/deploy/secrets/
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
    npx vaulter local sync -e prd
    npx vaulter local pull -e prd
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
vaulter plan -e dev -s api                 # Plan changes for specific service
vaulter apply -e dev -s api               # Apply planned changes
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
vaulter local pull --all

# Result:
# ✓ web: apps/web/.env.local (5 vars)
# ✓ api: apps/api/.env (12 vars)
# ✓ admin: apps/admin/.env (25 vars)
```

### Pull to Specific Output

```bash
# Pull only web
vaulter local pull --output web

# Preview without writing
vaulter local pull --all --dry-run
```

### How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    Backend (S3)                         │
│  DATABASE_URL, JWT_SECRET, NEXT_PUBLIC_API, LOG_LEVEL   │
└────────────────────────┬────────────────────────────────┘
                         │
              vaulter local pull --all
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

## Local Overrides (Dev Environment) - OFFLINE FIRST

**`vaulter local pull` and local `.env` generation are 100% OFFLINE** - no backend calls.

Works entirely from local files in `.vaulter/local/`. This is the primary workflow for day-to-day development: edit local overrides, run `vaulter local pull`, and only sync when needed.

### Quick Reference

| Command | What it does | Backend? |
|---------|--------------|----------|
| `vaulter local pull` | Generate .env files from local | ❌ OFFLINE |
| `vaulter local push --all` | Send local → backend | ✅ Backend |
| `vaulter local sync` | Download backend → local | ✅ Backend |
| `vaulter local set` | Write local override to `.vaulter/local/` | ❌ OFFLINE |
| `vaulter local diff` | Compare local overrides vs base env | ❌ OFFLINE |

### Workflow

```
┌─────────────────────────────────────────────────────┐
│              LOCAL DEVELOPMENT                       │
│  1. Edit .vaulter/local/*.env                       │
│  2. vaulter local pull       → Generate .env       │
│  3. Develop...                                       │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│              SHARE WITH TEAM                         │
│  vaulter local push --all  → Upload to backend      │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│              NEW TEAM MEMBER                         │
│  1. git clone <repo>                                │
│  2. vaulter local sync     → Download from backend  │
│  3. vaulter local pull      → Generate .env        │
└─────────────────────────────────────────────────────┘
```

For monorepos, use `--service <name>` on `local set`, `local delete`, `local diff`, and `local push` (without `--all`), unless the CLI can infer the service from your current directory (or the monorepo has only one service).

### File Structure

```
.vaulter/local/
├── configs.env           # Shared configs (all services)
├── secrets.env           # Shared secrets (all services)
└── services/             # Monorepo only
    ├── web/
    │   ├── configs.env   # web-specific configs
    │   └── secrets.env   # web-specific secrets
    └── api/
        ├── configs.env
        └── secrets.env
```

### Merge Order (Per Output)

**Priority:** `shared vars < service-specific vars`

For each output target, vaulter merges:
1. Shared vars from `.vaulter/local/{configs,secrets}.env`
2. Service-specific vars from `.vaulter/local/services/{service}/*.env`

**Example:**
- 20 shared vars + 3 service-specific = 23 vars for that service
- NOT all vars from all services merged together!

### CLI Commands

```bash
# === EDIT LOCALLY ===
vaulter local set --shared DEBUG::true     # shared config
vaulter local set --shared API_KEY=xxx     # shared secret
vaulter local set PORT::3001                # service config (inferred from cwd in monorepo)
vaulter local set DB_URL=xxx -s api        # service secret
# In service directories, `-s` is usually auto-inferred.
# If the repo has only one service, `-s` is inferred automatically too.

# === GENERATE .ENV FILES [OFFLINE] ===
vaulter local pull
# Output: "svc-auth: 23 vars (21 shared + 2 service)"

# === SHARE WITH TEAM ===
vaulter local push --all                   # Upload entire structure

# === GET TEAM'S CHANGES ===
vaulter local sync                         # Download from backend
vaulter local pull                        # Generate .env files

# === OTHER ===
vaulter local diff                         # Show differences
vaulter local status                       # Show summary
```

### Section-Aware .env Management

Vaulter uses **section-aware mode** by default when writing `.env` files. This preserves your custom variables while managing backend variables separately.

```env
# Your variables (NEVER touched by vaulter)
MY_LOCAL_VAR=something
CUSTOM_DEBUG=true
MY_PORT_OVERRIDE=3001

# --- VAULTER MANAGED (do not edit below) ---
DATABASE_URL=postgres://...
API_KEY=sk-xxx
NODE_ENV=production
# --- END VAULTER ---
```

**How it works:**

| Location | Behavior |
|:---------|:---------|
| Above marker | **Preserved** - your custom vars, never modified |
| Between markers | **Managed** - vaulter controls this section |
| Below end marker | **Preserved** - any trailing content |

**CLI options:**

```bash
# Section-aware pull (default)
vaulter local pull

# Overwrite entire file (ignores sections)
vaulter local pull --overwrite
```

**Programmatic API:**

```typescript
import {
  syncVaulterSection,
  getUserVarsFromEnvFile,
  setInEnvFile
} from 'vaulter'

// Sync only the managed section (preserves user vars)
syncVaulterSection('/app/.env', {
  DATABASE_URL: 'postgres://...',
  API_KEY: 'sk-xxx'
})

// Read only user-defined vars (above the marker)
const userVars = getUserVarsFromEnvFile('/app/.env')
// { MY_LOCAL_VAR: 'something', CUSTOM_DEBUG: 'true' }

// Add var to user section (above marker)
setInEnvFile('/app/.env', 'MY_VAR', 'value', true)
```

**Use cases:**

- **Local debugging:** Add `DEBUG=true` above the marker, it stays after `vaulter local pull`
- **Port conflicts:** Override `PORT=3001` locally without affecting teammates
- **Feature flags:** Test with `FEATURE_X_ENABLED=true` without touching backend
- **Framework vars:** Keep `.env.local` compatible with Next.js/Vite expectations

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
| **Local** | Default | Load from `.vaulter/local/` (configs.env + secrets.env) |

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
// Option 1: Simple import (like dotenv/config)
import 'vaulter/load'

// Option 2: Side-effect import with full path
import 'vaulter/runtime/load'

// Option 3: With options
import { loadRuntime } from 'vaulter'

await loadRuntime({
  environment: 'prd',
  service: 'api',        // Optional: for monorepos
  required: true         // Default: true in prd, false otherwise
})

// Option 4: Using config() with backend source
import { config } from 'vaulter'

await config({ source: 'backend' })

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

Claude AI integration via Model Context Protocol. **17 Tools | 4 Resources | 5 Prompts.**

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

### Tools (17)

> **Tool Architecture:** Each tool is action-based (one tool per domain with `action` parameter).

| Category | Tool | Actions / Description |
|:---------|:-----|:---------------------|
| **Mutation Flow** | `vaulter_change` | set, delete, move, import (writes local state only) |
| | `vaulter_plan` | Compute diff local vs backend, generate plan artifact |
| | `vaulter_apply` | Execute plan, push changes to backend |
| | `vaulter_run` | Execute command with loaded variables |
| **Read** | `vaulter_get` | Get single var or multi-get via `keys[]` |
| | `vaulter_list` | List vars with optional filter |
| | `vaulter_search` | Search by pattern or compare environments |
| | `vaulter_diff` | Quick diff without plan artifacts |
| **Status** | `vaulter_status` | scorecard, vars, audit, drift, inventory |
| **Export** | `vaulter_export` | k8s-secret, k8s-configmap, helm, terraform, env, shell, json |
| **Keys** | `vaulter_key` | generate, list, show, export, import, rotate |
| **Local Dev** | `vaulter_local` | pull, push, push-all, sync, set, delete, diff, status, shared-set, shared-delete, shared-list |
| **Backup** | `vaulter_snapshot` | create, list, restore, delete |
| | `vaulter_versions` | list, get, rollback |
| **Setup** | `vaulter_init` | Initialize project |
| | `vaulter_services` | Discover monorepo services |
| **Danger** | `vaulter_nuke` | Preview backend deletion (CLI-only execution) |

### Resources (4)

Static data views (no input required). For actions with parameters, use tools.

| URI | Description |
|:----|:------------|
| `vaulter://instructions` | **Read first!** s3db.js architecture + tool overview |
| `vaulter://tools-guide` | Which tool to use for each scenario |
| `vaulter://config` | Project configuration (YAML) |
| `vaulter://services` | Monorepo services list |

### Prompts (5)

Pre-configured workflows for common tasks.

| Prompt | Description |
|:-------|:------------|
| `setup_project` | Initialize new vaulter project |
| `deploy_secrets` | Deploy to Kubernetes |
| `compare_environments` | Compare dev vs prd |
| `rotation_workflow` | Check/rotate/report on rotation |
| `local_dev_workflow` | Manage local dev overrides (shared + service) |

> **Full MCP documentation:** See [docs/MCP.md](docs/MCP.md) for complete tool reference with parameters.

---

## Shell (Interactive Terminal)

```bash
vaulter shell              # Secrets Explorer (default)
vaulter shell menu         # Menu
vaulter shell audit        # Audit log viewer
vaulter shell keys         # Key manager
```

### SYNC Column (Secrets Explorer)

Shows local `.env` sync status vs backend:

| Icon | Status | Meaning |
|:----:|:-------|:--------|
| `✓` | synced | Local value = backend value |
| `≠` | modified | Local value differs from backend |
| `−` | missing | Exists in backend, not in local .env |
| `+` | local-only | Exists only in local .env |

### Shortcuts

**Global**: `q` quit · `ESC` back · `↑↓` navigate

| Screen | Shortcuts |
|:-------|:----------|
| Menu | `1` `2` `3` quick access to screens |
| Explorer | `r` refresh · `v` toggle values · `Tab` cycle env · `j/k` vim nav |
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
