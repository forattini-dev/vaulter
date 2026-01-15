<div align="center">

# 🔐 minienv

### Multi-Backend Environment & Secrets Manager

**One CLI to manage all your environment variables.**

</div>

## Quick Start

```bash
npm install -g minienv
```

```bash
# Initialize project
minienv init

# Set some secrets
minienv set DATABASE_URL "postgres://localhost/mydb" -e dev
minienv set API_KEY "sk-secret-key" -e dev

# Export to shell
eval $(minienv export -e dev)

# Deploy to Kubernetes
minienv k8s:secret -e prd | kubectl apply -f -
```

---

<div align="center">

[![npm version](https://img.shields.io/npm/v/minienv.svg?style=flat-square&color=F5A623)](https://www.npmjs.com/package/minienv)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/minienv.svg?style=flat-square&color=007AFF)](https://github.com/forattini-dev/minienv/blob/main/LICENSE)

Store secrets anywhere: AWS S3, MinIO, R2, Spaces, B2, or local filesystem.
<br>
AES-256-GCM encryption. Native K8s, Helm & Terraform integration.
<br>
MCP server for Claude AI. Zero config for dev, production-ready.

[📖 Documentation](#configuration) · [🔧 CLI](#commands) · [🚀 Highlights](#highlights)

</div>

---

## What's Inside

| Category | Features |
|:---------|:---------|
| **Backends** | AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, FileSystem, Memory |
| **Encryption** | AES-256-GCM via s3db.js, field-level encryption, key rotation |
| **Environments** | dev, stg, prd, sbx, dr (fully customizable) |
| **Integrations** | Kubernetes Secret/ConfigMap, Helm values.yaml, Terraform tfvars |
| **Monorepo** | Service discovery, batch operations, config inheritance |
| **MCP Server** | Claude AI integration via Model Context Protocol |
| **Unix Pipes** | Full stdin/stdout support for scripting |

## Highlights

### Multi-Backend with Fallback

Configure multiple backends - minienv tries each until one succeeds:

```yaml
backend:
  urls:
    - s3://bucket/envs?region=us-east-1     # Primary (CI/CD)
    - file:///home/user/.minienv-store       # Fallback (local dev)
```

### Native Integrations

```bash
# Kubernetes - deploy secrets directly
minienv k8s:secret -e prd | kubectl apply -f -

# Helm - generate values file
minienv helm:values -e prd | helm upgrade myapp ./chart -f -

# Terraform - export as tfvars
minienv tf:vars -e prd > terraform.tfvars
```

### Unix Pipes

```bash
# Import from Vault
vault kv get -format=json secret/app | \
  jq -r '.data.data | to_entries | .[] | "\(.key)=\(.value)"' | \
  minienv sync -e prd

# Export to kubectl
minienv export -e prd --format=env | \
  kubectl create secret generic myapp --from-env-file=/dev/stdin
```

### MCP Server for Claude

```bash
# Start MCP server
minienv mcp
```

```json
{
  "mcpServers": {
    "minienv": {
      "command": "npx",
      "args": ["minienv", "mcp"]
    }
  }
}
```

## Commands

### Core

| Command | Description | Example |
|:--------|:------------|:--------|
| `init` | Initialize project | `minienv init` |
| `get <key>` | Get a variable | `minienv get DATABASE_URL -e prd` |
| `set <key> <value>` | Set a variable | `minienv set API_KEY "sk-..." -e prd` |
| `delete <key>` | Delete a variable | `minienv delete OLD_KEY -e dev` |
| `list` | List all variables | `minienv list -e prd` |
| `export` | Export for shell | `eval $(minienv export -e dev)` |

### Sync

| Command | Description | Example |
|:--------|:------------|:--------|
| `sync` | Bidirectional sync | `minienv sync -f .env.local -e dev` |
| `pull` | Download to .env | `minienv pull -e prd -o .env.prd` |
| `push` | Upload from .env | `minienv push -f .env.local -e dev` |

### Integrations

| Command | Description | Example |
|:--------|:------------|:--------|
| `k8s:secret` | Kubernetes Secret | `minienv k8s:secret -e prd \| kubectl apply -f -` |
| `k8s:configmap` | Kubernetes ConfigMap | `minienv k8s:configmap -e prd` |
| `helm:values` | Helm values.yaml | `minienv helm:values -e prd` |
| `tf:vars` | Terraform .tfvars | `minienv tf:vars -e prd > terraform.tfvars` |
| `tf:json` | Terraform JSON | `minienv tf:json -e prd` |

### Utilities

| Command | Description | Example |
|:--------|:------------|:--------|
| `key generate` | Generate encryption key | `minienv key generate` |
| `services` | List monorepo services | `minienv services` |
| `mcp` | Start MCP server | `minienv mcp` |

## Global Options

```
-p, --project <name>    Project name
-s, --service <name>    Service name (monorepos)
-e, --env <env>         Environment: dev, stg, prd, sbx, dr
-b, --backend <url>     Backend URL override
-v, --verbose           Verbose output
--all                   All services (monorepo batch)
--dry-run               Preview without applying
--json                  JSON output
--force                 Skip confirmations
```

## Configuration

### Basic Config

```yaml
# .minienv/config.yaml
version: "1"

project: my-project
service: api  # optional

backend:
  # Single URL
  url: s3://bucket/envs?region=us-east-1

  # Or multiple with fallback
  urls:
    - s3://bucket/envs?region=us-east-1
    - file:///home/user/.minienv-store

encryption:
  key_source:
    - env: MINIENV_KEY           # 1. Environment variable
    - file: .minienv/.key        # 2. Local file
    - s3: s3://keys/minienv.key  # 3. Remote S3

environments:
  - dev
  - stg
  - prd

default_environment: dev
```

### Environment Variable Expansion

Config values support `${VAR}`, `${VAR:-default}`, and `$VAR`:

```yaml
backend:
  url: s3://${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}@bucket/envs
  # Or
  url: ${MINIENV_BACKEND_URL}
```

### Local Override (config.local.yaml)

For credentials that should **never** be committed:

```yaml
# .minienv/config.local.yaml (gitignored)
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
export MINIENV_KEY="base64-encoded-32-byte-key"
minienv export -e prd

# 2. Local file (development)
minienv key generate -o .minienv/.key

# 3. Remote S3 (production)
# Configured in config.yaml
```

## Monorepo Support

```
my-monorepo/
├── .minienv/
│   ├── config.yaml          # Root config
│   └── environments/
├── services/
│   ├── api/
│   │   └── .minienv/
│   │       ├── config.yaml  # extends: ../../../.minienv/config.yaml
│   │       └── environments/
│   └── worker/
│       └── .minienv/
```

```bash
# List services
minienv services

# Sync all services
minienv sync -e dev --all

# Sync specific services
minienv sync -e dev -s api,worker
```

## MCP Tools

| Tool | Description |
|:-----|:------------|
| `minienv_get` | Get a single variable |
| `minienv_set` | Set a variable |
| `minienv_delete` | Delete a variable |
| `minienv_list` | List all variables |
| `minienv_export` | Export in various formats |
| `minienv_sync` | Sync with .env file |

## CI/CD

### GitHub Actions

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy secrets
        env:
          MINIENV_KEY: ${{ secrets.MINIENV_KEY }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          npx minienv k8s:secret -e prd | kubectl apply -f -
```

### GitLab CI

```yaml
deploy:
  script:
    - npx minienv k8s:secret -e prd | kubectl apply -f -
  variables:
    MINIENV_KEY: $MINIENV_KEY
```

## Security Best Practices

| Practice | How |
|:---------|:----|
| Never commit credentials | Use `config.local.yaml` or env vars |
| Never commit encryption keys | Add `.minienv/.key` to `.gitignore` |
| Use env var expansion | `${AWS_ACCESS_KEY_ID}` instead of hardcoding |
| Use AWS credential chain | No credentials in URL, use IAM roles |
| Separate keys per environment | Different keys for dev/stg/prd |
| Restrict S3 bucket access | IAM policies to limit readers |

### Files to .gitignore

```gitignore
.minienv/.key
.minienv/config.local.yaml
**/config.local.yaml
.env
.env.*
```

## API Usage

```typescript
import { MiniEnvClient, loadConfig } from 'minienv'

const config = loadConfig()
const client = new MiniEnvClient({ config })

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

| Feature | minienv | dotenv | doppler | vault |
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
| MCP Tools | 6 |
| Integrations | 5 (K8s Secret, K8s ConfigMap, Helm, Terraform, tfvars) |

## Pre-built Binaries

Download from [Releases](https://github.com/forattini-dev/minienv/releases):

| Platform | Binary |
|:---------|:-------|
| Linux x64 | `minienv-linux` |
| Linux ARM64 | `minienv-linux-arm64` |
| macOS x64 | `minienv-macos` |
| macOS ARM64 | `minienv-macos-arm64` |
| Windows | `minienv-win.exe` |

## License

MIT © [Forattini](https://github.com/forattini-dev)

---

<div align="center">

**[Documentation](#configuration)** · **[Issues](https://github.com/forattini-dev/minienv/issues)** · **[Releases](https://github.com/forattini-dev/minienv/releases)**

</div>
