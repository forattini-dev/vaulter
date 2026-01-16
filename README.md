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

[Quick Start](#quick-start) · [Security](#security) · [CI/CD](#cicd) · [Commands](#commands)

</div>

---

## Installation

```bash
# One-liner (recommended)
curl -fsSL https://raw.githubusercontent.com/forattini-dev/vaulter/main/install.sh | sh

# Or via npm/pnpm
npm install -g vaulter
pnpm add -g vaulter
```

## Quick Start

```bash
# Initialize project
vaulter init

# Set secrets (encrypted, synced to backend)
vaulter set DATABASE_URL="postgres://localhost/mydb" -e dev

# Export to shell
eval $(vaulter export -e dev)

# Deploy to Kubernetes
vaulter k8s:secret -e prd | kubectl apply -f -
```

---

## Table of Contents

- [Why Vaulter?](#why-vaulter)
- [Security](#security)
- [Daily Use](#daily-use)
- [CI/CD](#cicd)
- [Configuration](#configuration)
- [Integrations](#integrations)
- [Monorepo Support](#monorepo-support)
- [API Usage](#api-usage)
- [MCP Server](#mcp-server)

---

## Why Vaulter?

### The Problem

Environment variables and secrets are scattered across `.env` files, CI/CD settings, cloud consoles, and team Slack messages. This creates:

- **Security gaps**: Secrets in plaintext files, git history, or shared docs
- **Sync issues**: "Works on my machine" because `.env` files differ
- **Deploy friction**: Manual copy-paste between environments
- **Audit blindness**: No idea who changed what, when

### The Solution

Vaulter centralizes all environment variables in encrypted storage (S3-compatible) while maintaining the simplicity of `.env` files:

| Traditional | With Vaulter |
|:------------|:-------------|
| Secrets in plaintext `.env` | Encrypted at rest (AES-256-GCM) |
| Manual sync between devs | `vaulter pull` / `vaulter push` |
| Copy-paste to CI/CD | `eval $(vaulter export -e prd)` |
| No audit trail | Full history via S3 versioning |
| Different files per machine | Single source of truth |

### Why Trust Vaulter?

1. **Open source**: All code is auditable
2. **No lock-in**: Your data lives in YOUR storage (S3, MinIO, R2, filesystem)
3. **Standard encryption**: AES-256-GCM, the same used by AWS, Google, and banks
4. **Zero external dependencies**: No SaaS, no API keys, no third-party services
5. **Offline capable**: Works with local filesystem backend

---

## Security

### Encryption Model

Every secret is encrypted **before** leaving your machine using **AES-256-GCM**:

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Machine                            │
│                                                             │
│  .env file ──► vaulter encrypt ──► encrypted blob ──► S3   │
│               (AES-256-GCM)         (unreadable)           │
│                                                             │
│  S3 ──► encrypted blob ──► vaulter decrypt ──► .env file   │
│         (unreadable)       (AES-256-GCM)                   │
└─────────────────────────────────────────────────────────────┘
```

**What this means:**
- The backend (S3, MinIO, etc.) only sees encrypted data
- Even with S3 access, secrets are unreadable without the key
- Each value is encrypted individually (field-level encryption)
- Authenticated encryption prevents tampering (GCM mode)

### Key Management

Vaulter supports multiple key sources with priority fallback:

```yaml
# .vaulter/config.yaml
encryption:
  key_source:
    - env: VAULTER_KEY           # 1. Environment variable (CI/CD)
    - file: .vaulter/.key        # 2. Local file (development)
    - s3: s3://keys/vaulter.key  # 3. Remote S3 (shared teams)
```

#### Option 1: Environment Variable (Recommended for CI/CD)

```bash
# Generate a key
vaulter key generate
# Output: VAULTER_KEY=base64-encoded-32-byte-key

# Set in CI/CD secrets
export VAULTER_KEY="dGhpcyBpcyBhIDMyIGJ5dGUga2V5IGZvciBhZXM="
```

**Pros**: Key never touches disk, rotates easily via CI/CD secret rotation
**Use case**: GitHub Actions, GitLab CI, Jenkins

#### Option 2: Local File (Development)

```bash
# Generate and save
vaulter key generate -o .vaulter/.key

# Add to .gitignore (CRITICAL!)
echo ".vaulter/.key" >> .gitignore
```

**Pros**: Simple, works offline
**Use case**: Local development, small teams

#### Option 3: Remote S3 (Team Shared)

```yaml
encryption:
  key_source:
    - s3: s3://company-keys/vaulter/project.key?region=us-east-1
```

**Pros**: Centralized key management, IAM-controlled access
**Use case**: Teams, multiple developers needing same key

### Advanced Security Configurations

#### AWS KMS Integration (Planned)

For enterprises requiring HSM-backed keys:

```yaml
encryption:
  kms:
    key_id: arn:aws:kms:us-east-1:123456789:key/abc-123
    # Key never leaves AWS KMS
    # Envelope encryption: KMS encrypts the data key
```

**How it works:**
1. Vaulter generates a data encryption key (DEK)
2. DEK encrypts your secrets locally
3. AWS KMS encrypts the DEK (envelope encryption)
4. Only encrypted DEK + encrypted secrets are stored
5. Decryption requires both KMS access AND S3 access

#### Certificate-Based Encryption (Planned)

For X.509/PKI environments:

```yaml
encryption:
  certificate:
    public: ./certs/vaulter.pub    # Encrypt (anyone)
    private: ./certs/vaulter.key   # Decrypt (restricted)
```

**Use cases:**
- Separate encrypt/decrypt permissions
- CI/CD can read (decrypt) but not write new secrets
- Developers can write (encrypt) but production keys decrypt

#### Asymmetric Key Scenarios

**Scenario 1: Read-Only CI/CD**
```
Developer (has private key) → encrypts secrets → S3
CI/CD (has public key) → CANNOT decrypt, only verify
Production (has private key) → decrypts at runtime
```

**Scenario 2: Multi-Team Isolation**
```
Team A (key A) → encrypts → S3/team-a/
Team B (key B) → encrypts → S3/team-b/
Neither team can read the other's secrets
```

### Threat Model

| Threat | Protection |
|:-------|:-----------|
| S3 bucket breach | Data encrypted, key required |
| Key file leaked | Rotate key, re-encrypt |
| Man-in-middle | TLS + authenticated encryption |
| Malicious insider | Audit logs via S3 versioning |
| Accidental git commit | Secrets encrypted in .env |

### Security Best Practices

```bash
# ✅ DO
vaulter key generate                    # Random 256-bit key
echo ".vaulter/.key" >> .gitignore      # Never commit keys
export VAULTER_KEY="${{ secrets.KEY }}" # CI/CD secrets

# ❌ DON'T
echo "password123" > .vaulter/.key      # Weak key
git add .vaulter/.key                   # Exposed key
vaulter set KEY=val --key "hardcoded"   # Key in command history
```

---

## Daily Use

### Workflow Overview

```bash
# Morning: sync with team's changes
vaulter pull -e dev

# During development: add new variable
vaulter set NEW_API_KEY="sk-xxx" -e dev

# End of day: push changes
vaulter push -e dev

# Deploy: export to production
vaulter k8s:secret -e prd | kubectl apply -f -
```

### Commands Reference

#### Core Commands

| Command | Description | Example |
|:--------|:------------|:--------|
| `init` | Initialize project | `vaulter init` |
| `get <key>` | Get a variable | `vaulter get DATABASE_URL -e prd` |
| `set KEY=val` | Set secrets (batch) | `vaulter set A=1 B=2 -e prd` |
| `set KEY::val` | Set configs (plain) | `vaulter set PORT::3000 -e dev` |
| `delete <key>` | Delete a variable | `vaulter delete OLD_KEY -e dev` |
| `list` | List all variables | `vaulter list -e prd` |
| `export` | Export for shell | `eval $(vaulter export -e dev)` |

#### Sync Commands

| Command | Description | Example |
|:--------|:------------|:--------|
| `sync` | Merge local and backend | `vaulter sync -e dev` |
| `pull` | Download from backend | `vaulter pull -e prd` |
| `push` | Upload to backend | `vaulter push -e dev` |

#### Integration Commands

| Command | Description | Example |
|:--------|:------------|:--------|
| `k8s:secret` | Kubernetes Secret | `vaulter k8s:secret -e prd` |
| `k8s:configmap` | Kubernetes ConfigMap | `vaulter k8s:configmap -e prd` |
| `helm:values` | Helm values.yaml | `vaulter helm:values -e prd` |
| `tf:vars` | Terraform .tfvars | `vaulter tf:vars -e prd` |
| `scan` | Scan monorepo | `vaulter scan` |

### Set Command Syntax

```bash
# Secrets (encrypted, synced to backend)
vaulter set KEY=value                    # Single secret
vaulter set A=1 B=2 C=3 -e dev           # Batch secrets
vaulter set KEY:=123                     # Typed (number/boolean)

# Configs (plain text in split mode)
vaulter set PORT::3000 HOST::localhost   # Configs
```

| Separator | Type | Backend Sync | Encrypted |
|:----------|:-----|:-------------|:----------|
| `=` | Secret | ✓ | ✓ |
| `:=` | Secret (typed) | ✓ | ✓ |
| `::` | Config | Split: ✗ / Unified: ✓ | ✓ |

### Global Options

```
-p, --project <name>    Project name
-s, --service <name>    Service name (monorepos)
-e, --env <env>         Environment: dev, stg, prd, sbx, dr
-k, --key <path|value>  Encryption key
-v, --verbose           Verbose output
--dry-run               Preview without applying
--json                  JSON output
```

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

      - name: Deploy secrets to Kubernetes
        env:
          VAULTER_KEY: ${{ secrets.VAULTER_KEY }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          npx vaulter k8s:secret -e prd | kubectl apply -f -
```

### GitHub Actions (Matrix Deploy)

```yaml
name: Deploy All Environments
on:
  workflow_dispatch:
    inputs:
      environment:
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
        run: |
          npx vaulter k8s:secret -e ${{ inputs.environment }} | kubectl apply -f -

      - name: Deploy configmaps
        run: |
          npx vaulter k8s:configmap -e ${{ inputs.environment }} | kubectl apply -f -
```

### GitLab CI

```yaml
stages:
  - deploy

deploy-secrets:
  stage: deploy
  image: node:22-alpine
  script:
    - npx vaulter k8s:secret -e ${CI_ENVIRONMENT_NAME} | kubectl apply -f -
  environment:
    name: $CI_COMMIT_REF_NAME
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      variables:
        CI_ENVIRONMENT_NAME: prd
    - if: $CI_COMMIT_BRANCH == "develop"
      variables:
        CI_ENVIRONMENT_NAME: dev
```

### Jenkins Pipeline

```groovy
pipeline {
    agent any

    environment {
        VAULTER_KEY = credentials('vaulter-key')
        AWS_ACCESS_KEY_ID = credentials('aws-access-key')
        AWS_SECRET_ACCESS_KEY = credentials('aws-secret-key')
    }

    stages {
        stage('Deploy Secrets') {
            steps {
                sh 'npx vaulter k8s:secret -e prd | kubectl apply -f -'
            }
        }
    }
}
```

### Docker Build Args

```dockerfile
# Dockerfile
ARG DATABASE_URL
ARG API_KEY
ENV DATABASE_URL=$DATABASE_URL
ENV API_KEY=$API_KEY
```

```bash
# Build with secrets
eval $(vaulter export -e prd --format=docker-args)
docker build $VAULTER_DOCKER_ARGS -t myapp .
```

### Terraform Integration

```bash
# Generate tfvars
vaulter tf:vars -e prd > secrets.auto.tfvars

# Or inline
terraform plan -var-file=<(vaulter tf:vars -e prd)
```

### Helm Integration

```bash
# Upgrade with secrets as values
vaulter helm:values -e prd | helm upgrade myapp ./chart -f -

# Or save to file
vaulter helm:values -e prd -o values.secrets.yaml
helm upgrade myapp ./chart -f values.yaml -f values.secrets.yaml
```

### Shell Aliases (Development)

```bash
# Add to ~/.bashrc or ~/.zshrc
alias vdev='eval $(vaulter export -e dev)'
alias vstg='eval $(vaulter export -e stg)'
alias vprd='eval $(vaulter export -e prd)'

# Usage
vdev npm run dev
vstg npm run test:integration
```

---

## Configuration

### Basic Config

```yaml
# .vaulter/config.yaml
version: "1"

project: my-project
service: api  # optional, for monorepos

backend:
  url: s3://bucket/envs?region=us-east-1
  # Or multiple with fallback
  urls:
    - s3://bucket/envs?region=us-east-1
    - file:///home/user/.vaulter-store

encryption:
  key_source:
    - env: VAULTER_KEY
    - file: .vaulter/.key

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

Separates configs (committable) from secrets (gitignored):

```
my-project/
├── .vaulter/config.yaml
└── deploy/
    ├── configs/           # ✅ Committable (PORT, HOST, LOG_LEVEL)
    │   ├── dev.env
    │   └── prd.env
    └── secrets/           # ❌ Gitignored (DATABASE_URL, API_KEY)
        ├── dev.env
        └── prd.env
```

```yaml
directories:
  mode: split
  configs: deploy/configs
  secrets: deploy/secrets
```

Initialize with: `vaulter init --split`

### Backend URLs

| Provider | URL Format |
|:---------|:-----------|
| AWS S3 | `s3://bucket/path?region=us-east-1` |
| AWS S3 + Profile | `s3://bucket/path?profile=myprofile` |
| MinIO | `http://KEY:SECRET@localhost:9000/bucket` |
| Cloudflare R2 | `https://KEY:SECRET@ACCOUNT.r2.cloudflarestorage.com/bucket` |
| DigitalOcean Spaces | `https://KEY:SECRET@nyc3.digitaloceanspaces.com/bucket` |
| Backblaze B2 | `https://KEY:SECRET@s3.us-west-002.backblazeb2.com/bucket` |
| FileSystem | `file:///path/to/storage` |
| Memory | `memory://bucket-name` |

---

## Integrations

### Kubernetes

```bash
# Deploy Secret
vaulter k8s:secret -e prd -n my-namespace | kubectl apply -f -

# Deploy ConfigMap
vaulter k8s:configmap -e prd | kubectl apply -f -

# With custom name
vaulter k8s:secret -e prd --name my-app-secrets | kubectl apply -f -
```

### Helm

```bash
# Pass as values
vaulter helm:values -e prd | helm upgrade myapp ./chart -f -

# Save to file
vaulter helm:values -e prd -o values.secrets.yaml
```

### Terraform

```bash
# Generate tfvars
vaulter tf:vars -e prd > terraform.tfvars

# Generate JSON
vaulter tf:json -e prd > terraform.tfvars.json
```

---

## Monorepo Support

Vaulter auto-detects all major monorepo tools:

| Tool | Detection File | Workspace Config |
|:-----|:---------------|:-----------------|
| NX | `nx.json` | `workspaceLayout` |
| Turborepo | `turbo.json` | Uses pnpm/yarn workspaces |
| Lerna | `lerna.json` | `packages` array |
| pnpm | `pnpm-workspace.yaml` | `packages` array |
| Yarn | `package.json` | `workspaces` field |
| Rush | `rush.json` | `projects[].projectFolder` |

### Scan Command

```bash
# Discover all packages
vaulter scan

# Output:
# Monorepo: NX
# Found 17 package(s):
#   ✓ Initialized: 3
#   ○ Not initialized: 14
#   📄 With .env files: 11
```

### Batch Operations

```bash
# Sync all services
vaulter sync -e dev --all

# Sync specific services
vaulter sync -e dev -s api,worker
```

---

## API Usage

```typescript
import { VaulterClient, loadConfig } from 'vaulter'

const config = loadConfig()
const client = new VaulterClient({ config })

await client.connect()

// CRUD operations
const value = await client.get('DATABASE_URL', 'my-project', 'prd')
await client.set({ key: 'API_KEY', value: 'sk-xxx', project: 'my-project', environment: 'prd' })
const vars = await client.list({ project: 'my-project', environment: 'prd' })

await client.disconnect()
```

### Dotenv Compatible

```typescript
// Auto-load .env into process.env
import 'vaulter/load'

// Or with options
import { loader } from 'vaulter'
loader({ path: '.env.local', override: true })
```

---

## MCP Server

Vaulter includes a **Model Context Protocol (MCP)** server for AI assistant integration.

### Setup

```bash
# Start server
vaulter mcp

# Test with MCP Inspector
npx @anthropic-ai/mcp-inspector vaulter mcp
```

### Claude Desktop Config

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

### Available Tools (15)

| Tool | Description |
|:-----|:------------|
| `vaulter_get` | Get a variable |
| `vaulter_set` | Set a variable |
| `vaulter_delete` | Delete a variable |
| `vaulter_list` | List variables |
| `vaulter_export` | Export in various formats |
| `vaulter_sync` | Bidirectional sync |
| `vaulter_pull` | Download from backend |
| `vaulter_push` | Upload to backend |
| `vaulter_compare` | Compare environments |
| `vaulter_search` | Search by pattern |
| `vaulter_scan` | Scan monorepo |
| `vaulter_services` | List services |
| `vaulter_k8s_secret` | Generate K8s Secret |
| `vaulter_k8s_configmap` | Generate K8s ConfigMap |
| `vaulter_init` | Initialize project |

### Resources (5)

- `vaulter://config` — Project configuration
- `vaulter://services` — Monorepo services
- `vaulter://project/env` — Environment variables
- `vaulter://project/env/service` — Service-specific vars
- `vaulter://compare/env1/env2` — Environment diff

### Prompts (5)

- `setup_project` — Initialize a new project
- `migrate_dotenv` — Migrate existing .env
- `deploy_secrets` — Deploy to Kubernetes
- `compare_environments` — Compare two environments
- `security_audit` — Audit for security issues

---

## Pre-built Binaries

Download from [Releases](https://github.com/forattini-dev/vaulter/releases):

| Platform | Binary |
|:---------|:-------|
| Linux x64 | `vaulter-linux-x64` |
| Linux ARM64 | `vaulter-linux-arm64` |
| macOS x64 | `vaulter-macos-x64` |
| macOS ARM64 | `vaulter-macos-arm64` |
| Windows x64 | `vaulter-win-x64.exe` |

---

## License

MIT © [Forattini](https://github.com/forattini-dev)
