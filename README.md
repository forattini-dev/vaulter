<div align="center">

# 🔐 vaulter

### Multi-Backend Environment & Secrets Manager

**One CLI to manage all your environment variables.**

</div>

## Installation

### One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/forattini-dev/vaulter/main/install.sh | sh
```

### npm

```bash
npm install -g vaulter
```

### Specific version

```bash
VAULTER_VERSION=v1.0.0 curl -fsSL https://raw.githubusercontent.com/forattini-dev/vaulter/main/install.sh | sh
```

### Custom directory

```bash
VAULTER_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/forattini-dev/vaulter/main/install.sh | sh
```

## Quick Start

```bash
# Initialize project
vaulter init

# Set secrets (encrypted, synced to backend)
vaulter set DATABASE_URL="postgres://localhost/mydb" API_KEY="sk-secret-key" -e dev

# Set configs (plain text in split mode, synced in unified mode)
vaulter set PORT::3000 LOG_LEVEL::debug -e dev

# Export to shell
eval $(vaulter export -e dev)

# Deploy to Kubernetes
vaulter k8s:secret -e prd | kubectl apply -f -
```

---

<div align="center">

[![npm version](https://img.shields.io/npm/v/vaulter.svg?style=flat-square&color=F5A623)](https://www.npmjs.com/package/vaulter)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/vaulter.svg?style=flat-square&color=007AFF)](https://github.com/forattini-dev/vaulter/blob/main/LICENSE)

Store secrets anywhere: AWS S3, MinIO, R2, Spaces, B2, or local filesystem.
<br>
AES-256-GCM encryption. Native K8s, Helm & Terraform integration.
<br>
MCP server for Claude AI. Zero config for dev, production-ready.

[📖 Documentation](#configuration) · [🔧 CLI](#commands) · [🚀 Highlights](#highlights)

</div>

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [What's Inside](#whats-inside)
- [Highlights](#highlights)
- [Commands](#commands)
- [Configuration](#configuration)
  - [Directory Modes](#directory-modes)
- [Backend URLs](#backend-urls)
- [Encryption](#encryption)
- [Running Commands](#running-commands)
  - [Shell Scripts](#shell-scripts)
  - [Interactive Tools](#interactive-tools)
- [Integrations](#integrations)
  - [kubectl](#kubectl)
  - [Helm & Helmfile](#helm--helmfile)
  - [Terraform & Terragrunt](#terraform--terragrunt)
- [Monorepo Support](#monorepo-support)
  - [NX Monorepo](#nx-monorepo)
  - [Turborepo](#turborepo)
- [MCP Server](#mcp-server)
  - [MCP Tools](#mcp-tools-14)
  - [MCP Resources](#mcp-resources-5)
  - [MCP Prompts](#mcp-prompts-5)
- [CI/CD](#cicd)
  - [Developer Daily Workflow](#developer-daily-workflow)
  - [GitHub Actions](#github-actions)
  - [GitLab CI](#gitlab-ci)
  - [CircleCI](#circleci)
  - [Azure DevOps](#azure-devops)
- [Security Best Practices](#security-best-practices)
- [API Usage](#api-usage)
- [Pre-built Binaries](#pre-built-binaries)

---

## What's Inside

| Category | Features |
|:---------|:---------|
| **Backends** | AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, FileSystem, Memory |
| **Encryption** | AES-256-GCM via s3db.js, field-level encryption |
| **Environments** | dev, stg, prd, sbx, dr (configurable subset) |
| **Integrations** | Kubernetes Secret/ConfigMap, Helm values.yaml, Terraform tfvars |
| **Monorepo** | Service discovery, batch operations, config inheritance |
| **MCP Server** | Claude AI integration via Model Context Protocol |
| **Unix Pipes** | Full stdin/stdout support for scripting |
| **Dotenv** | Drop-in compatible: `import 'vaulter/load'` |

## Highlights

### Multi-Backend with Fallback

Configure multiple backends - vaulter tries each until one succeeds:

```yaml
backend:
  urls:
    - s3://bucket/envs?region=us-east-1     # Primary (CI/CD)
    - file:///home/user/.vaulter-store       # Fallback (local dev)
```

### Native Integrations

```bash
# Kubernetes - deploy secrets directly
vaulter k8s:secret -e prd | kubectl apply -f -

# Helm - generate values file
vaulter helm:values -e prd | helm upgrade myapp ./chart -f -

# Terraform - export as tfvars
vaulter tf:vars -e prd > terraform.tfvars
```

### Unix Pipes

```bash
# Import from Vault
vault kv get -format=json secret/app | \
  jq -r '.data.data | to_entries | .[] | "\(.key)=\(.value)"' | \
  vaulter sync -e prd

# Export to kubectl
vaulter export -e prd --format=env | \
  kubectl create secret generic myapp --from-env-file=/dev/stdin
```

### MCP Server for Claude

```bash
# Start MCP server
vaulter mcp
```

```json
{
  "mcpServers": {
    "vaulter": {
      "command": "npx",
      "args": ["vaulter", "mcp"]
    }
  }
}
```

### Dotenv Compatible

Drop-in replacement for dotenv - works with your existing setup:

```typescript
// Auto-load .env into process.env
import 'vaulter/load'

// Or programmatically with options
import { loader } from 'vaulter'
loader({ path: '.env.local', override: true })
```

## Commands

### Core

| Command | Description | Example |
|:--------|:------------|:--------|
| `init` | Initialize project | `vaulter init` |
| `get <key>` | Get a variable | `vaulter get DATABASE_URL -e prd` |
| `set KEY=val ...` | Set secrets (batch) | `vaulter set KEY1=v1 KEY2=v2 -e prd` |
| `set KEY::val ...` | Set configs (plain) | `vaulter set PORT::3000 HOST::0.0.0.0 -e dev` |
| `delete <key>` | Delete a variable | `vaulter delete OLD_KEY -e dev` |
| `list` | List all variables | `vaulter list -e prd` |
| `export` | Export for shell | `eval $(vaulter export -e dev)` |

### Sync

| Command | Description | Example |
|:--------|:------------|:--------|
| `sync` | Merge local .env and backend | `vaulter sync -f .env.local -e dev` |
| `pull` | Download to .env | `vaulter pull -e prd -o .env.prd` |
| `push` | Upload from .env | `vaulter push -f .env.local -e dev` |

### Integrations

| Command | Description | Example |
|:--------|:------------|:--------|
| `k8s:secret` | Kubernetes Secret | `vaulter k8s:secret -e prd \| kubectl apply -f -` |
| `k8s:configmap` | Kubernetes ConfigMap | `vaulter k8s:configmap -e prd` |
| `helm:values` | Helm values.yaml | `vaulter helm:values -e prd` |
| `tf:vars` | Terraform .tfvars | `vaulter tf:vars -e prd > terraform.tfvars` |
| `tf:json` | Terraform JSON | `vaulter tf:json -e prd` |

### Utilities

| Command | Description | Example |
|:--------|:------------|:--------|
| `key generate` | Generate encryption key | `vaulter key generate` |
| `services` | List monorepo services | `vaulter services` |
| `mcp` | Start MCP server | `vaulter mcp` |

### Set Command Syntax

HTTPie-style separators for differentiating secrets from configs:

```bash
# Secrets (encrypted, synced to backend)
vaulter set KEY=value                    # Single secret
vaulter set A=1 B=2 C=3 -e dev           # Batch secrets
vaulter set KEY:=123                     # Typed secret (number/boolean)

# Configs (plain text, file only in split mode, synced in unified mode)
vaulter set PORT::3000 HOST::localhost   # Configs

# With metadata
vaulter set DB_URL=postgres://... @tag:database,sensitive @owner:backend -e prd

# Legacy syntax (still works)
vaulter set KEY "value" -e dev           # Treated as secret
```

| Separator | Type | Backend Sync | Encryption (backend) |
|:----------|:-----|:-------------|:-----------|
| `=` | Secret | ✓ | ✓ |
| `:=` | Secret (typed) | ✓ | ✓ |
| `::` | Config | Split: ✗ / Unified: ✓ | ✓ |
| `@key:value` | Metadata | — | — |

Note: Config files remain plain text; backend storage is encrypted for all values.

## Global Options

```
-p, --project <name>    Project name
-s, --service <name>    Service name (monorepos)
-e, --env <env>         Environment: dev, stg, prd, sbx, dr
-b, --backend <url>     Backend URL override
-k, --key <path|value>  Encryption key file path or raw key
-v, --verbose           Verbose output
--all                   All services (monorepo batch)
--dry-run               Preview without applying
--json                  JSON output
--force                 Skip confirmations
```

## Configuration

### Basic Config

```yaml
# .vaulter/config.yaml
version: "1"

project: my-project
service: api  # optional

backend:
  # Single URL
  url: s3://bucket/envs?region=us-east-1

  # Or multiple with fallback
  urls:
    - s3://bucket/envs?region=us-east-1
    - file:///home/user/.vaulter-store

encryption:
  key_source:
    - env: VAULTER_KEY           # 1. Environment variable
    - file: .vaulter/.key        # 2. Local file
    - s3: s3://keys/vaulter.key  # 3. Remote S3

environments:
  - dev
  - stg
  - prd

default_environment: dev
```

### Sync Settings

Sync merges local and remote variables. Conflicts are resolved by `sync.conflict`.

```yaml
sync:
  conflict: local   # local | remote | error
  ignore:
    - "PUBLIC_*"
  required:
    dev:
      - DATABASE_URL
```

Notes:
- `local` (default): Local values win on conflict, remote-only keys are pulled to local
- `remote`: Remote values win on conflict
- `error`: Stop sync if any conflicts are detected
- When reading from stdin, sync only updates the backend (local file is not changed).

### Directory Modes

Vaulter supports two directory structures for organizing environment files:

#### Unified Mode (Default)

All environment files in a single directory:

```
my-project/
├── .vaulter/
│   ├── config.yaml
│   └── environments/
│       ├── dev.env        # All vars (secrets + configs)
│       ├── stg.env
│       └── prd.env
```

#### Split Mode

Separate directories for configs (committable) and secrets (gitignored):

```
my-project/
├── .vaulter/
│   └── config.yaml
└── deploy/
    ├── configs/           # ✅ Committable (non-sensitive)
    │   ├── dev.env        # NODE_ENV, PORT, LOG_LEVEL
    │   ├── stg.env
    │   └── prd.env
    └── secrets/           # ❌ Gitignored (sensitive)
        ├── dev.env        # DATABASE_URL, JWT_SECRET
        ├── stg.env
        └── prd.env
```

Configure split mode in `config.yaml`:

```yaml
directories:
  mode: split              # "unified" (default) or "split"
  configs: deploy/configs  # Non-sensitive vars (committable)
  secrets: deploy/secrets  # Sensitive vars (gitignored)
```

Tip: scaffold split mode with `vaulter init --split`.

**Behavior in split mode:**
- `sync`, `pull`, `push` operate on the **secrets** directory
- `k8s:secret` reads from local **secrets** file (no backend fetch)
- `k8s:configmap` reads from local **configs** file (no backend fetch)
- Configs are managed via git, secrets via vaulter

**When to use split mode:**
- Monorepos with deploy directories per service
- Teams that want configs reviewed in PRs
- Environments where non-sensitive configs should be in git

### Hooks

```yaml
hooks:
  pre_sync: "echo pre sync"
  post_sync: "echo post sync"
  pre_pull: "echo pre pull"
  post_pull: "echo post pull"
```

### Environment Variable Expansion

Config values support `${VAR}`, `${VAR:-default}`, and `$VAR`:

```yaml
backend:
  url: s3://${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}@bucket/envs
  # Or
  url: ${VAULTER_BACKEND_URL}
```

### Local Override (config.local.yaml)

For credentials that should **never** be committed:

```yaml
# .vaulter/config.local.yaml (gitignored)
backend:
  url: s3://real-key:real-secret@bucket/envs?region=us-east-1
```

## Backend URLs

| Provider | URL Format |
|:---------|:-----------|
| **AWS S3** | `s3://bucket/path?region=us-east-1` |
| **AWS S3 + Profile** | `s3://bucket/path?region=us-east-1&profile=myprofile` |
| **AWS S3 + Credentials** | `s3://${KEY}:${SECRET}@bucket/path` |
| **MinIO** | `http://${KEY}:${SECRET}@localhost:9000/bucket` |
| **Cloudflare R2** | `https://${KEY}:${SECRET}@${ACCOUNT}.r2.cloudflarestorage.com/bucket` |
| **DigitalOcean Spaces** | `https://${KEY}:${SECRET}@nyc3.digitaloceanspaces.com/bucket` |
| **Backblaze B2** | `https://${KEY}:${SECRET}@s3.us-west-002.backblazeb2.com/bucket` |
| **FileSystem** | `file:///path/to/storage` |
| **Memory** | `memory://bucket-name` |

## Encryption

All secrets are encrypted with **AES-256-GCM** before storage.

### Key Sources

```bash
# 1. Environment variable (CI/CD)
export VAULTER_KEY="base64-encoded-32-byte-key"
vaulter export -e prd

# 2. Local file (development)
vaulter key generate -o .vaulter/.key

# 3. Remote S3 (production)
# Configured in config.yaml
```

You can also pass a key directly:

```bash
vaulter list -e prd --key .vaulter/.key
```

### Security Settings

```yaml
security:
  paranoid: true  # Fail if no encryption key is found
  auto_encrypt:
    patterns:
      - "*_KEY"
      - "*_SECRET"
      - "DATABASE_URL"
```

`auto_encrypt.patterns` is used to classify secrets for integrations (K8s/Helm).

## Running Commands

Load environment variables into any command using `eval $(vaulter export)`.

### Shell Scripts

```bash
# Run a script with environment variables
eval $(vaulter export -e dev) ./myscript.sh

# Or in two steps
eval $(vaulter export -e dev)
./myscript.sh

# One-liner with subshell (vars don't persist after)
(eval $(vaulter export -e prd) && ./deploy.sh)

# Using env command (cleaner syntax)
env $(vaulter export -e dev --format=shell) ./myscript.sh
```

### Interactive Tools

```bash
# k9s with production credentials
eval $(vaulter export -e prd) k9s

# psql with database URL
eval $(vaulter export -e dev) psql $DATABASE_URL

# redis-cli
eval $(vaulter export -e dev) redis-cli -u $REDIS_URL

# AWS CLI with credentials
eval $(vaulter export -e prd) aws s3 ls

# Docker run with env vars
eval $(vaulter export -e dev) docker run --env-file <(vaulter export -e dev --format=env) myapp

# Any Node.js app
eval $(vaulter export -e dev) node server.js

# Python app
eval $(vaulter export -e dev) python app.py
```

### Shell Alias (Recommended)

Add to your `~/.bashrc` or `~/.zshrc`:

```bash
# Quick alias for common environments
alias vdev='eval $(vaulter export -e dev)'
alias vstg='eval $(vaulter export -e stg)'
alias vprd='eval $(vaulter export -e prd)'

# Usage
vdev ./myscript.sh
vprd k9s
vstg psql $DATABASE_URL
```

### One-liner Pattern

```bash
# Pattern: eval $(vaulter export -e ENV) COMMAND
eval $(vaulter export -e dev) npm run dev
eval $(vaulter export -e prd) kubectl get pods
eval $(vaulter export -e stg) terraform plan
```

## Integrations

### kubectl

```bash
# Create Secret from vaulter
vaulter k8s:secret -e prd | kubectl apply -f -

# Create ConfigMap (non-secret vars)
vaulter k8s:configmap -e prd | kubectl apply -f -

# With custom name and namespace
vaulter k8s:secret -e prd -n my-namespace --name my-app-secrets | kubectl apply -f -

# Dry-run to see YAML
vaulter k8s:secret -e prd --dry-run

# Create secret from export (alternative)
vaulter export -e prd --format=env | \
  kubectl create secret generic myapp --from-env-file=/dev/stdin --dry-run=client -o yaml | \
  kubectl apply -f -

# Run kubectl with vaulter vars
eval $(vaulter export -e prd) kubectl exec -it deploy/myapp -- env | grep DATABASE
```

### Helm & Helmfile

#### Helm

```bash
# Generate values.yaml and pipe to helm
vaulter helm:values -e prd | helm upgrade myapp ./chart -f -

# Save values to file
vaulter helm:values -e prd > values.prd.yaml
helm upgrade myapp ./chart -f values.prd.yaml

# With secrets separated (uses auto_encrypt.patterns)
vaulter helm:values -e prd --secrets  # Only secret vars
vaulter helm:values -e prd --config   # Only non-secret vars

# Install with inline values
helm install myapp ./chart \
  --set-string DATABASE_URL="$(vaulter get DATABASE_URL -e prd)" \
  --set-string API_KEY="$(vaulter get API_KEY -e prd)"
```

#### Helmfile

```yaml
# helmfile.yaml
repositories:
  - name: bitnami
    url: https://charts.bitnami.com/bitnami

releases:
  - name: myapp
    namespace: production
    chart: ./charts/myapp
    values:
      - values.yaml
      - values.prd.yaml  # Generated by: vaulter helm:values -e prd > values.prd.yaml
```

```bash
# Generate values before helmfile sync
vaulter helm:values -e prd > values.prd.yaml
helmfile sync

# Or use process substitution
helmfile sync --values <(vaulter helm:values -e prd)

# With environment variables for helmfile
eval $(vaulter export -e prd) helmfile apply
```

### Terraform & Terragrunt

#### Terraform

```bash
# Generate .tfvars file
vaulter tf:vars -e prd > terraform.tfvars
terraform plan

# Generate JSON format
vaulter tf:json -e prd > terraform.tfvars.json
terraform plan -var-file=terraform.tfvars.json

# Pass vars inline
terraform plan \
  -var="database_url=$(vaulter get DATABASE_URL -e prd)" \
  -var="api_key=$(vaulter get API_KEY -e prd)"

# Use TF_VAR_* environment variables
eval $(vaulter export -e prd --format=tfvars)
terraform plan

# Pipe directly (requires bash process substitution)
terraform plan -var-file=<(vaulter tf:vars -e prd)
```

#### Terragrunt

```bash
# Set env vars for terragrunt
eval $(vaulter export -e prd) terragrunt plan

# Generate inputs file
vaulter tf:vars -e prd > inputs.tfvars
terragrunt plan --terragrunt-config terragrunt.hcl

# In terragrunt.hcl - use environment variables
# terragrunt.hcl
inputs = {
  database_url = get_env("DATABASE_URL", "")
  api_key      = get_env("API_KEY", "")
}

# Then run:
eval $(vaulter export -e prd) terragrunt apply

# Or with inputs file
# terragrunt.hcl
terraform {
  extra_arguments "custom_vars" {
    commands = get_terraform_commands_that_need_vars()
    arguments = [
      "-var-file=inputs.tfvars"
    ]
  }
}
```

```bash
# Full workflow with terragrunt
vaulter pull -e prd                    # Get latest vars
vaulter tf:vars -e prd > inputs.tfvars # Generate tfvars
terragrunt plan                        # Plan with vars
terragrunt apply                       # Apply
```

### Integration Summary

| Tool | Command |
|:-----|:--------|
| **kubectl** | `vaulter k8s:secret -e prd \| kubectl apply -f -` |
| **helm** | `vaulter helm:values -e prd \| helm upgrade app ./chart -f -` |
| **helmfile** | `vaulter helm:values -e prd > values.prd.yaml && helmfile sync` |
| **terraform** | `vaulter tf:vars -e prd > terraform.tfvars && terraform plan` |
| **terragrunt** | `eval $(vaulter export -e prd) terragrunt apply` |
| **any command** | `eval $(vaulter export -e ENV) COMMAND` |

## Monorepo Support

Vaulter auto-discovers services with `.vaulter/` directories and supports config inheritance.

### NX Monorepo

```
my-nx-workspace/
├── .vaulter/
│   ├── config.yaml              # Shared config (backend, encryption)
│   └── environments/
│       └── dev.env              # Shared dev vars
├── apps/
│   ├── web/
│   │   └── .vaulter/
│   │       ├── config.yaml      # extends: ../../../.vaulter/config.yaml
│   │       └── environments/
│   │           └── dev.env      # App-specific vars
│   └── api/
│       └── .vaulter/
│           ├── config.yaml
│           └── environments/
├── libs/                        # No .vaulter needed for libs
├── nx.json
└── package.json
```

```bash
# From workspace root
vaulter services                 # List: web, api

# Sync all apps
vaulter sync -e dev --all

# Sync single app (from root or app dir)
vaulter sync -e dev -s api
cd apps/api && vaulter sync -e dev

# NX run with env vars
eval $(vaulter export -e dev -s api) && nx serve api
```

### Turborepo

```
my-turbo-monorepo/
├── .vaulter/
│   ├── config.yaml              # Root config
│   └── environments/
├── apps/
│   ├── web/
│   │   ├── .vaulter/
│   │   │   ├── config.yaml      # extends: ../../../.vaulter/config.yaml
│   │   │   └── environments/
│   │   └── package.json
│   └── docs/
│       └── .vaulter/
├── packages/                    # Shared packages (no .vaulter)
├── turbo.json
└── package.json
```

```bash
# List discovered services
vaulter services

# Batch sync before turbo build
vaulter sync -e prd --all && turbo build

# Export for specific app
cd apps/web && eval $(vaulter export -e dev)

# Turbo with env passthrough (turbo.json)
# { "pipeline": { "build": { "env": ["DATABASE_URL", "API_KEY"] } } }
vaulter export -e prd -s web --format=shell >> apps/web/.env
turbo build --filter=web
```

### Service Config Inheritance

```yaml
# apps/api/.vaulter/config.yaml
extends: ../../../.vaulter/config.yaml  # Inherit root config

service: api                            # Override service name

# Override or add service-specific settings
sync:
  required:
    prd:
      - DATABASE_URL
      - REDIS_URL
```

### Commands

```bash
# List services
vaulter services

# Sync all services
vaulter sync -e dev --all

# Sync specific services (glob supported)
vaulter sync -e dev -s api,worker
vaulter sync -e dev -s "svc-*"

# Batch export
vaulter export -e prd --all --format=json
```

## MCP Server

Vaulter includes a full-featured **Model Context Protocol (MCP)** server for AI assistant integration. Works with Claude, ChatGPT, and any MCP-compatible client.

### Quick Setup

```bash
# Start MCP server
vaulter mcp
```

Add to your Claude config (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "vaulter": {
      "command": "npx",
      "args": ["vaulter", "mcp"]
    }
  }
}
```

Or with the binary:

```json
{
  "mcpServers": {
    "vaulter": {
      "command": "/usr/local/bin/vaulter",
      "args": ["mcp"]
    }
  }
}
```

### MCP Tools (14)

The MCP server exposes 14 tools organized into categories:

#### Core Tools

| Tool | Description | Example Use |
|:-----|:------------|:------------|
| `vaulter_get` | Get a single variable | "Get the DATABASE_URL for production" |
| `vaulter_set` | Set a variable with tags | "Set API_KEY to sk-xxx for dev" |
| `vaulter_delete` | Delete a variable | "Remove the old LEGACY_KEY" |
| `vaulter_list` | List all variables | "Show all vars in staging" |
| `vaulter_export` | Export in various formats | "Export prod vars as JSON" |

#### Sync Tools

| Tool | Description | Example Use |
|:-----|:------------|:------------|
| `vaulter_sync` | Bidirectional sync | "Sync local .env with dev backend" |
| `vaulter_pull` | Download from backend | "Pull production vars to .env.prd" |
| `vaulter_push` | Upload to backend | "Push .env.local to dev" |

#### Analysis Tools

| Tool | Description | Example Use |
|:-----|:------------|:------------|
| `vaulter_compare` | Compare two environments | "What's different between stg and prd?" |
| `vaulter_search` | Search by key pattern | "Find all vars containing DATABASE" |

#### Monorepo Tools

| Tool | Description | Example Use |
|:-----|:------------|:------------|
| `vaulter_services` | List discovered services | "What services are in this monorepo?" |

#### Kubernetes Tools

| Tool | Description | Example Use |
|:-----|:------------|:------------|
| `vaulter_k8s_secret` | Generate K8s Secret YAML | "Generate a K8s secret for prod" |
| `vaulter_k8s_configmap` | Generate K8s ConfigMap | "Create a ConfigMap for non-secrets" |

#### Setup Tools

| Tool | Description | Example Use |
|:-----|:------------|:------------|
| `vaulter_init` | Initialize new project | "Set up vaulter in this project" |

### MCP Resources (5)

Resources provide read-only views of your secrets and configuration:

| Resource URI | Description | Content |
|:-------------|:------------|:--------|
| `vaulter://config` | Project configuration | YAML from .vaulter/config.yaml |
| `vaulter://services` | Monorepo services | JSON list of discovered services |
| `vaulter://project/env` | Environment variables | .env format for project/env |
| `vaulter://project/env/service` | Service-specific vars | .env format for service |
| `vaulter://compare/env1/env2` | Environment comparison | Diff between two environments |

**Example resource access:**
- `vaulter://config` → Current config.yaml content
- `vaulter://my-app/prd` → Production vars for my-app
- `vaulter://compare/dev/prd` → What's different between dev and prod

### MCP Prompts (5)

Pre-configured workflow prompts guide AI through complex operations:

| Prompt | Description | Arguments |
|:-------|:------------|:----------|
| `setup_project` | Initialize a new vaulter project | `project_name`, `mode?`, `backend?` |
| `migrate_dotenv` | Migrate existing .env to vaulter | `file_path`, `environment`, `dry_run?` |
| `deploy_secrets` | Deploy secrets to Kubernetes | `environment`, `namespace?`, `secret_name?` |
| `compare_environments` | Compare two environments | `source_env`, `target_env`, `show_values?` |
| `security_audit` | Audit secrets for security issues | `environment`, `strict?` |

**Example prompt usage in Claude:**
- "Use the setup_project prompt to create a new project called api-service"
- "Run the migrate_dotenv prompt for .env.local to dev environment"
- "Execute security_audit for production in strict mode"

### MCP Capabilities Summary

| Category | Count | Features |
|:---------|------:|:---------|
| **Tools** | 14 | CRUD, sync, compare, K8s, init |
| **Resources** | 5 | Config, services, vars, comparison |
| **Prompts** | 5 | Setup, migrate, deploy, compare, audit |
| **Formats** | 5 | shell, json, yaml, env, tfvars |

### Example AI Conversations

**Setting up a new project:**
> "Help me set up vaulter for my new api-service project using S3 backend"

The AI will use `vaulter_init`, guide through backend config, and set up encryption.

**Migrating from dotenv:**
> "I have a .env.production file with 50 variables. Help me migrate to vaulter"

The AI will analyze the file, identify secrets vs configs, and sync to backend.

**Deploying to Kubernetes:**
> "Generate Kubernetes secrets for production and show me how to deploy them"

The AI will use `vaulter_k8s_secret` and provide kubectl commands.

**Comparing environments:**
> "What variables are in staging but missing from production?"

The AI will use `vaulter_compare` and show the differences.

**Security review:**
> "Audit my production secrets for security issues"

The AI will analyze variable patterns, check for weak values, and provide recommendations.

## CI/CD

### Developer Daily Workflow

A typical day with vaulter:

#### 1. Morning Setup

```bash
# Pull latest secrets to your local .env
vaulter pull -e dev

# Start development with loaded vars
eval $(vaulter export -e dev) npm run dev

# Or use the alias (add to ~/.bashrc)
alias vdev='eval $(vaulter export -e dev)'
vdev npm run dev
```

#### 2. Adding New Variables

```bash
# Add a new secret (encrypted, synced to backend)
vaulter set NEW_API_KEY="sk-xxx" -e dev

# Add a config (plain text)
vaulter set LOG_LEVEL::debug -e dev

# Batch add multiple vars
vaulter set DB_HOST::localhost DB_PORT::5432 DB_PASSWORD="secret123" -e dev

# Check what you have
vaulter list -e dev
```

#### 3. Syncing with Team

```bash
# Your teammate added new vars - pull them
vaulter pull -e dev

# You made changes - push to backend
vaulter push -e dev

# Two-way sync (recommended)
vaulter sync -e dev

# Preview before sync
vaulter sync -e dev --dry-run
```

#### 4. Testing Different Environments

```bash
# Run with staging config
eval $(vaulter export -e stg) npm test

# Compare what's different in production
vaulter compare -e dev -e prd

# One-liner to check production
vdev npm run dev   # dev
vstg npm test      # stg
vprd npm run build # prd (be careful!)
```

#### 5. Before Code Review

```bash
# Make sure all required vars are documented
vaulter list -e dev --json | jq 'keys'

# Check nothing sensitive is in wrong place
vaulter search "*PASSWORD*" -e dev
vaulter search "*SECRET*" -e dev
```

#### 6. Deployment Prep

```bash
# Generate K8s secret and review
vaulter k8s:secret -e prd --dry-run

# Generate and apply
vaulter k8s:secret -e prd | kubectl apply -f -

# Or export for Helm
vaulter helm:values -e prd > values.prd.yaml
helm upgrade myapp ./chart -f values.prd.yaml
```

### Shell Aliases (Recommended)

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# Quick environment loading
alias vdev='eval $(vaulter export -e dev)'
alias vstg='eval $(vaulter export -e stg)'
alias vprd='eval $(vaulter export -e prd)'

# Common operations
alias vpull='vaulter pull -e dev'
alias vpush='vaulter push -e dev'
alias vsync='vaulter sync -e dev'
alias vlist='vaulter list -e dev'

# K8s shortcuts
alias vk8s='vaulter k8s:secret'
alias vhelm='vaulter helm:values'

# Usage
vdev npm run dev              # Dev with env vars
vstg npm test                 # Test with staging
vpull && vdev npm run dev     # Pull latest, then run
vk8s -e prd | kubectl apply -f -  # Deploy secrets
```

### GitHub Actions

#### Basic Deploy Secrets

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy secrets to K8s
        env:
          VAULTER_KEY: ${{ secrets.VAULTER_KEY }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          npx vaulter k8s:secret -e prd | kubectl apply -f -
```

#### Multi-Environment Deploy

```yaml
name: Deploy to Environment
on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        type: choice
        options: [dev, stg, prd]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - uses: actions/checkout@v4

      - name: Deploy secrets
        env:
          VAULTER_KEY: ${{ secrets.VAULTER_KEY }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          npx vaulter k8s:secret -e ${{ inputs.environment }} | kubectl apply -f -
          npx vaulter k8s:configmap -e ${{ inputs.environment }} | kubectl apply -f -
```

#### Monorepo with Matrix

```yaml
name: Deploy Services
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [api, web, worker]
    steps:
      - uses: actions/checkout@v4

      - name: Deploy ${{ matrix.service }} secrets
        env:
          VAULTER_KEY: ${{ secrets.VAULTER_KEY }}
        run: |
          cd apps/${{ matrix.service }}
          npx vaulter k8s:secret -e prd | kubectl apply -f -
```

#### PR Preview Environment

```yaml
name: PR Preview
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Create preview secrets
        env:
          VAULTER_KEY: ${{ secrets.VAULTER_KEY }}
        run: |
          # Use dev secrets for PR previews
          npx vaulter k8s:secret -e dev -n preview-pr-${{ github.event.number }} | \
            kubectl apply -f -
```

#### Validate Secrets Exist

```yaml
name: Validate Secrets
on:
  pull_request:
    paths:
      - '.vaulter/**'
      - 'deploy/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check required secrets exist
        env:
          VAULTER_KEY: ${{ secrets.VAULTER_KEY }}
        run: |
          # List and verify required secrets are set
          npx vaulter list -e prd --json | jq -e '.DATABASE_URL and .API_KEY'
```

### GitLab CI

```yaml
stages:
  - validate
  - deploy

variables:
  VAULTER_KEY: $VAULTER_KEY

validate-secrets:
  stage: validate
  script:
    - npx vaulter list -e $CI_ENVIRONMENT_NAME --json | jq -e 'keys | length > 0'
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

deploy-secrets:
  stage: deploy
  script:
    - npx vaulter k8s:secret -e prd | kubectl apply -f -
  environment:
    name: production
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
```

### CircleCI

```yaml
version: 2.1
jobs:
  deploy:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run:
          name: Deploy secrets
          command: |
            npx vaulter k8s:secret -e prd | kubectl apply -f -
          environment:
            VAULTER_KEY: ${VAULTER_KEY}

workflows:
  deploy:
    jobs:
      - deploy:
          filters:
            branches:
              only: main
```

### Azure DevOps

```yaml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: |
      npx vaulter k8s:secret -e prd | kubectl apply -f -
    displayName: 'Deploy secrets'
    env:
      VAULTER_KEY: $(VAULTER_KEY)
      AWS_ACCESS_KEY_ID: $(AWS_ACCESS_KEY_ID)
      AWS_SECRET_ACCESS_KEY: $(AWS_SECRET_ACCESS_KEY)
```

### CI/CD Best Practices

| Practice | Recommendation |
|:---------|:---------------|
| **Store VAULTER_KEY securely** | Use CI provider's secret management |
| **Use IAM roles when possible** | Prefer roles over hardcoded credentials |
| **Different keys per environment** | Don't share prd key with dev |
| **Validate before deploy** | Run `--dry-run` first in pipelines |
| **Use environment protection** | Require approval for prd deploys |
| **Cache vaulter binary** | Download once per pipeline, not per job |

### Caching Vaulter Binary

```yaml
# GitHub Actions
- uses: actions/cache@v3
  with:
    path: ~/.npm
    key: vaulter-${{ runner.os }}

# Or use the installer script
- name: Install vaulter
  run: |
    curl -fsSL https://raw.githubusercontent.com/forattini-dev/vaulter/main/install.sh | sh
    echo "$HOME/.local/bin" >> $GITHUB_PATH
```

## Security Best Practices

| Practice | How |
|:---------|:----|
| Never commit credentials | Use `config.local.yaml` or env vars |
| Never commit encryption keys | Add `.vaulter/.key` to `.gitignore` |
| Use env var expansion | `${AWS_ACCESS_KEY_ID}` instead of hardcoding |
| Use AWS credential chain | No credentials in URL, use IAM roles |
| Separate keys per environment | Different keys for dev/stg/prd |
| Restrict S3 bucket access | IAM policies to limit readers |

### Files to .gitignore

```gitignore
.vaulter/.key
.vaulter/config.local.yaml
**/config.local.yaml
deploy/secrets/
.env
.env.*
```

## API Usage

```typescript
import { VaulterClient, loadConfig } from 'vaulter'

const config = loadConfig()
const client = new VaulterClient({ config })

await client.connect()

// Get
const value = await client.get('DATABASE_URL', 'my-project', 'prd')

// Set
await client.set({
  key: 'API_KEY',
  value: 'sk-secret',
  project: 'my-project',
  environment: 'prd'
})

// List
const vars = await client.list({
  project: 'my-project',
  environment: 'prd'
})

// Export
const envVars = await client.export('my-project', 'prd')

await client.disconnect()
```

## Comparison

| Feature | vaulter | dotenv | doppler | vault |
|:--------|:-------:|:------:|:-------:|:-----:|
| Multi-backend | ✅ | ❌ | ❌ | ❌ |
| Encryption | AES-256-GCM | ❌ | ✅ | ✅ |
| K8s integration | Native | ❌ | Plugin | Plugin |
| Self-hosted | ✅ | N/A | ❌ | ✅ |
| Monorepo | Native | ❌ | Limited | ❌ |
| MCP/AI | ✅ | ❌ | ❌ | ❌ |
| Complexity | Low | Low | Medium | High |

## Numbers

| Metric | Value |
|:-------|:------|
| Backends | 7 (S3, MinIO, R2, Spaces, B2, FileSystem, Memory) |
| Environments | 5 (dev, stg, prd, sbx, dr) |
| Export Formats | 5 (shell, json, yaml, env, tfvars) |
| MCP Tools | 14 (core, sync, analysis, monorepo, k8s, setup) |
| MCP Resources | 5 (config, services, vars, service vars, compare) |
| MCP Prompts | 5 (setup, migrate, deploy, compare, audit) |
| Integrations | 5 (K8s Secret, K8s ConfigMap, Helm, Terraform, tfvars) |

## Pre-built Binaries

### Automatic Installation

```bash
# Installs to ~/.local/bin by default
curl -fsSL https://raw.githubusercontent.com/forattini-dev/vaulter/main/install.sh | sh
```

The installer auto-detects your OS and architecture.

### Manual Download

Download from [Releases](https://github.com/forattini-dev/vaulter/releases):

| Platform | Binary | Install |
|:---------|:-------|:--------|
| Linux x64 | `vaulter-linux-x64` | `chmod +x vaulter-linux-x64 && mv vaulter-linux-x64 ~/.local/bin/vaulter` |
| Linux ARM64 | `vaulter-linux-arm64` | `chmod +x vaulter-linux-arm64 && mv vaulter-linux-arm64 ~/.local/bin/vaulter` |
| macOS x64 | `vaulter-macos-x64` | `chmod +x vaulter-macos-x64 && mv vaulter-macos-x64 /usr/local/bin/vaulter` |
| macOS ARM64 | `vaulter-macos-arm64` | `chmod +x vaulter-macos-arm64 && mv vaulter-macos-arm64 /usr/local/bin/vaulter` |
| Windows x64 | `vaulter-win-x64.exe` | Add to PATH |

### CI/CD Installation

```bash
# GitHub Actions / GitLab CI / CircleCI
curl -fsSL https://raw.githubusercontent.com/forattini-dev/vaulter/main/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
vaulter --version
```

## License

MIT © [Forattini](https://github.com/forattini-dev)

---

<div align="center">

**[Documentation](#configuration)** · **[Issues](https://github.com/forattini-dev/vaulter/issues)** · **[Releases](https://github.com/forattini-dev/vaulter/releases)**

</div>
