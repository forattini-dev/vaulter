<div align="center">

# 🔐 vaulter

### Multi-Backend Environment & Secrets Manager

**One CLI to manage all your environment variables.**

[![npm version](https://img.shields.io/npm/v/vaulter.svg?style=flat-square&color=F5A623)](https://www.npmjs.com/package/vaulter)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Claude_AI-7C3AED?style=flat-square&logo=anthropic&logoColor=white)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/npm/l/vaulter.svg?style=flat-square&color=007AFF)](https://github.com/forattini-dev/vaulter/blob/main/LICENSE)

Store secrets anywhere: AWS S3, MinIO, R2, Spaces, B2, or local filesystem.
<br>
AES-256-GCM encryption. Native K8s, Helm & Terraform integration.
<br>
**MCP server for Claude AI** with 15 tools, 5 resources, and 5 prompts.

[📖 Documentation](#configuration) · [🔧 CLI](#commands) · [🤖 MCP Server](#mcp-server) · [🚀 Quick Start](#quick-start)

</div>

---

## Installation

### One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/forattini-dev/vaulter/main/install.sh | sh
```

### npm / pnpm

```bash
npm install -g vaulter
# or
pnpm add -g vaulter
```

### Specific version

```bash
VAULTER_VERSION=v1.0.0 curl -fsSL https://raw.githubusercontent.com/forattini-dev/vaulter/main/install.sh | sh
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

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [What's Inside](#whats-inside)
- [Highlights](#highlights)
- [Commands](#commands)
- [Configuration](#configuration)
- [Backend URLs](#backend-urls)
- [Encryption](#encryption)
- [Integrations](#integrations)
- [Monorepo Support](#monorepo-support)
- [**MCP Server for Claude AI**](#mcp-server)
  - [Quick Setup](#quick-setup)
  - [MCP Inspector](#mcp-inspector)
  - [MCP Tools (15)](#mcp-tools-15)
  - [MCP Resources (5)](#mcp-resources-5)
  - [MCP Prompts (5)](#mcp-prompts-5)
- [CI/CD](#cicd)
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
| **Monorepo** | NX, Turborepo, Lerna, pnpm, Yarn, Rush auto-detection |
| **MCP Server** | 15 tools, 5 resources, 5 prompts for Claude AI |
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

### Monorepo Auto-Detection

```bash
# Scan any monorepo (NX, Turborepo, Lerna, pnpm, Yarn, Rush)
vaulter scan

# Output:
# Monorepo: NX
# Patterns: apps/*, libs/*, packages/*
# Found 17 package(s):
#   ✓ Vaulter initialized: 3
#   ○ Not initialized: 14
#   📄 With .env files: 11
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

### MCP Server for Claude

```bash
# Start MCP server
vaulter mcp

# Test with MCP Inspector
npx @anthropic-ai/mcp-inspector vaulter mcp
```

### Dotenv Compatible

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

### Monorepo

| Command | Description | Example |
|:--------|:------------|:--------|
| `scan` | Scan monorepo for packages | `vaulter scan ~/my-monorepo` |
| `services` | List initialized services | `vaulter services` |

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
| `mcp` | Start MCP server | `vaulter mcp` |

### Set Command Syntax

Separators for differentiating secrets from configs:

```bash
# Secrets (encrypted, synced to backend)
vaulter set KEY=value                    # Single secret
vaulter set A=1 B=2 C=3 -e dev           # Batch secrets
vaulter set KEY:=123                     # Typed secret (number/boolean)

# Configs (plain text, file only in split mode)
vaulter set PORT::3000 HOST::localhost   # Configs

# With metadata
vaulter set DB_URL=postgres://... @tag:database,sensitive @owner:backend -e prd
```

| Separator | Type | Backend Sync | Encryption |
|:----------|:-----|:-------------|:-----------|
| `=` | Secret | ✓ | ✓ |
| `:=` | Secret (typed) | ✓ | ✓ |
| `::` | Config | Split: ✗ / Unified: ✓ | ✓ |
| `@key:value` | Metadata | — | — |

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

### Directory Modes

#### Unified Mode (Default)

```
my-project/
├── .vaulter/
│   ├── config.yaml
│   └── environments/
│       ├── dev.env
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
    ├── configs/           # ✅ Committable
    │   ├── dev.env
    │   └── prd.env
    └── secrets/           # ❌ Gitignored
        ├── dev.env
        └── prd.env
```

```yaml
# config.yaml
directories:
  mode: split
  configs: deploy/configs
  secrets: deploy/secrets
```

Initialize with: `vaulter init --split`

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

```bash
# Generate a key
vaulter key generate -o .vaulter/.key

# Use via environment variable (CI/CD)
export VAULTER_KEY="base64-encoded-32-byte-key"

# Or pass directly
vaulter list -e prd --key .vaulter/.key
```

## Integrations

### kubectl

```bash
vaulter k8s:secret -e prd | kubectl apply -f -
vaulter k8s:configmap -e prd | kubectl apply -f -
```

### Helm

```bash
vaulter helm:values -e prd | helm upgrade myapp ./chart -f -
```

### Terraform

```bash
vaulter tf:vars -e prd > terraform.tfvars
terraform plan
```

### Shell

```bash
eval $(vaulter export -e dev) npm run dev
eval $(vaulter export -e prd) kubectl get pods
```

## Monorepo Support

### Auto-Detection

Vaulter automatically detects and supports all major monorepo tools:

| Tool | Detection | Config File |
|:-----|:----------|:------------|
| **NX** | `nx.json` | `workspaceLayout` or default `apps/*`, `libs/*` |
| **Turborepo** | `turbo.json` | Uses pnpm/yarn workspaces |
| **Lerna** | `lerna.json` | `packages` array |
| **pnpm** | `pnpm-workspace.yaml` | `packages` array |
| **Yarn** | `package.json` workspaces | `workspaces` field |
| **Rush** | `rush.json` | `projects[].projectFolder` |

### Scan Command

```bash
# Scan monorepo to discover packages
vaulter scan

# Scan specific path
vaulter scan /path/to/monorepo

# JSON output for scripting
vaulter scan --json
```

**Output:**
```
Monorepo: NX
Root: /home/user/my-monorepo
Config: nx.json
Patterns: apps/*, libs/*, packages/*

Found 17 package(s):
  ✓ Vaulter initialized: 3
  ○ Not initialized: 14
  📄 With .env files: 11

Packages needing vaulter init:
  ○ apps/web (has 4 .env files) [deploy/]
  ○ apps/api (has 6 .env files) [deploy/]
  ○ apps/worker (has 3 .env files)
  ...

💡 Suggestions:
   Run "vaulter init" in these directories to start managing their secrets:
   • cd apps/web && vaulter init --project=my-monorepo --service=web
```

### Batch Operations

```bash
# Sync all services
vaulter sync -e dev --all

# Sync specific services (glob supported)
vaulter sync -e dev -s api,worker
vaulter sync -e dev -s "svc-*"
```

---

## MCP Server

Vaulter includes a full-featured **Model Context Protocol (MCP)** server for AI assistant integration. Works with Claude, ChatGPT, and any MCP-compatible client.

### Quick Setup

1. **Start MCP server:**

```bash
vaulter mcp
```

2. **Add to Claude Desktop** (`~/.config/claude/claude_desktop_config.json`):

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

Or with the installed binary:

```json
{
  "mcpServers": {
    "vaulter": {
      "command": "vaulter",
      "args": ["mcp"]
    }
  }
}
```

---

### MCP Inspector

**Test and explore the MCP server interactively** with the official MCP Inspector:

```bash
# 🔍 Launch MCP Inspector for vaulter
npx @anthropic-ai/mcp-inspector vaulter mcp
```

This opens a web interface where you can:
- **Browse all 15 tools** with their schemas
- **Test tool calls** interactively
- **Access 5 resources** and see their content
- **Try 5 prompts** with different arguments
- **Debug responses** in real-time

<div align="center">

**Try it now:**

```bash
npx @anthropic-ai/mcp-inspector vaulter mcp
```

</div>

---

### MCP Tools (15)

The MCP server exposes **15 tools** organized into categories:

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
| `vaulter_scan` | **Scan monorepo for packages** | "Scan this NX monorepo for services" |
| `vaulter_services` | List initialized services | "What services are in this monorepo?" |

#### Kubernetes Tools

| Tool | Description | Example Use |
|:-----|:------------|:------------|
| `vaulter_k8s_secret` | Generate K8s Secret YAML | "Generate a K8s secret for prod" |
| `vaulter_k8s_configmap` | Generate K8s ConfigMap | "Create a ConfigMap for non-secrets" |

#### Setup Tools

| Tool | Description | Example Use |
|:-----|:------------|:------------|
| `vaulter_init` | Initialize new project | "Set up vaulter with split mode" |

---

### MCP Resources (5)

Resources provide **read-only views** of your secrets and configuration:

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

---

### MCP Prompts (5)

Pre-configured **workflow prompts** guide AI through complex operations:

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

---

### MCP Capabilities Summary

| Category | Count | Features |
|:---------|------:|:---------|
| **Tools** | 15 | CRUD, sync, compare, scan, K8s, init |
| **Resources** | 5 | Config, services, vars, comparison |
| **Prompts** | 5 | Setup, migrate, deploy, compare, audit |
| **Formats** | 5 | shell, json, yaml, env, tfvars |
| **Monorepos** | 6 | NX, Turborepo, Lerna, pnpm, Yarn, Rush |

---

### Example AI Conversations

**Scanning a monorepo:**
> "Scan my NX monorepo and tell me which services need vaulter initialization"

The AI will use `vaulter_scan`, identify packages with .env files, and suggest init commands.

**Setting up a new project:**
> "Help me set up vaulter for my api-service using S3 backend with split mode"

The AI will use `vaulter_init` with `mode: split` and guide through the setup.

**Deploying to Kubernetes:**
> "Generate Kubernetes secrets for production and show me how to deploy them"

The AI will use `vaulter_k8s_secret` and provide kubectl commands.

**Comparing environments:**
> "What variables are in staging but missing from production?"

The AI will use `vaulter_compare` and show the differences.

---

## CI/CD

### GitHub Actions

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

### GitLab CI

```yaml
deploy-secrets:
  stage: deploy
  script:
    - npx vaulter k8s:secret -e prd | kubectl apply -f -
  environment:
    name: production
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
```

### Shell Aliases

Add to `~/.bashrc` or `~/.zshrc`:

```bash
alias vdev='eval $(vaulter export -e dev)'
alias vstg='eval $(vaulter export -e stg)'
alias vprd='eval $(vaulter export -e prd)'

# Usage
vdev npm run dev
vprd kubectl get pods
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

## Pre-built Binaries

### Automatic Installation

```bash
curl -fsSL https://raw.githubusercontent.com/forattini-dev/vaulter/main/install.sh | sh
```

### Manual Download

Download from [Releases](https://github.com/forattini-dev/vaulter/releases):

| Platform | Binary |
|:---------|:-------|
| Linux x64 | `vaulter-linux-x64` |
| Linux ARM64 | `vaulter-linux-arm64` |
| macOS x64 | `vaulter-macos-x64` |
| macOS ARM64 | `vaulter-macos-arm64` |
| Windows x64 | `vaulter-win-x64.exe` |

## Numbers

| Metric | Value |
|:-------|:------|
| Backends | 7 (S3, MinIO, R2, Spaces, B2, FileSystem, Memory) |
| Environments | 5 (dev, stg, prd, sbx, dr) |
| Export Formats | 5 (shell, json, yaml, env, tfvars) |
| MCP Tools | 15 |
| MCP Resources | 5 |
| MCP Prompts | 5 |
| Monorepo Tools | 6 (NX, Turborepo, Lerna, pnpm, Yarn, Rush) |
| Integrations | 5 (K8s Secret, K8s ConfigMap, Helm, Terraform, tfvars) |

## License

MIT © [Forattini](https://github.com/forattini-dev)

---

<div align="center">

**[📖 Documentation](#configuration)** · **[🤖 MCP Server](#mcp-server)** · **[Issues](https://github.com/forattini-dev/vaulter/issues)** · **[Releases](https://github.com/forattini-dev/vaulter/releases)**

</div>
