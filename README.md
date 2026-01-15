<div align="center">

# 🔐 vaulter

### Multi-Backend Environment & Secrets Manager

**One CLI to manage all your environment variables.**

</div>

## Quick Start

```bash
npm install -g vaulter
```

```bash
# Initialize project
vaulter init

# Set some secrets
vaulter set DATABASE_URL "postgres://localhost/mydb" -e dev
vaulter set API_KEY "sk-secret-key" -e dev

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
| `set <key> <value>` | Set a variable | `vaulter set API_KEY "sk-..." -e prd` |
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
  conflict: local   # local | remote | prompt | error
  ignore:
    - "PUBLIC_*"
  required:
    dev:
      - DATABASE_URL
```

Notes:
- `prompt` and `error` will stop the sync if conflicts are detected.
- When reading from stdin, sync only updates the backend (local file is not changed).

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

## Monorepo Support

```
my-monorepo/
├── .vaulter/
│   ├── config.yaml          # Root config
│   └── environments/
├── services/
│   ├── api/
│   │   └── .vaulter/
│   │       ├── config.yaml  # extends: ../../../.vaulter/config.yaml
│   │       └── environments/
│   └── worker/
│       └── .vaulter/
```

```bash
# List services
vaulter services

# Sync all services
vaulter sync -e dev --all

# Sync specific services
vaulter sync -e dev -s api,worker
```

## MCP Tools

| Tool | Description |
|:-----|:------------|
| `vaulter_get` | Get a single variable |
| `vaulter_set` | Set a variable |
| `vaulter_delete` | Delete a variable |
| `vaulter_list` | List all variables |
| `vaulter_export` | Export in various formats |
| `vaulter_sync` | Sync with .env file |

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
          VAULTER_KEY: ${{ secrets.VAULTER_KEY }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          npx vaulter k8s:secret -e prd | kubectl apply -f -
```

### GitLab CI

```yaml
deploy:
  script:
    - npx vaulter k8s:secret -e prd | kubectl apply -f -
  variables:
    VAULTER_KEY: $VAULTER_KEY
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
| MCP Tools | 6 |
| Integrations | 5 (K8s Secret, K8s ConfigMap, Helm, Terraform, tfvars) |

## Pre-built Binaries

Download from [Releases](https://github.com/forattini-dev/vaulter/releases):

| Platform | Binary |
|:---------|:-------|
| Linux x64 | `vaulter-linux` |
| Linux ARM64 | `vaulter-linux-arm64` |
| macOS x64 | `vaulter-macos` |
| macOS ARM64 | `vaulter-macos-arm64` |
| Windows | `vaulter-win.exe` |

## License

MIT © [Forattini](https://github.com/forattini-dev)

---

<div align="center">

**[Documentation](#configuration)** · **[Issues](https://github.com/forattini-dev/vaulter/issues)** · **[Releases](https://github.com/forattini-dev/vaulter/releases)**

</div>
