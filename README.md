# minienv

> Multi-backend environment variable and secrets manager with AES-256-GCM encryption

[![npm version](https://img.shields.io/npm/v/minienv.svg)](https://www.npmjs.com/package/minienv)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**minienv** is a powerful CLI tool for managing environment variables and secrets across multiple storage backends. It provides seamless encryption, multi-environment support, and native integrations with Kubernetes, Helm, and Terraform.

## Features

- **Multi-Backend Storage** - AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, FileSystem, Memory
- **AES-256-GCM Encryption** - All secrets encrypted at rest with industry-standard encryption
- **Multi-Environment** - Built-in support for dev, stg, prd, sbx, dr environments
- **Native Integrations** - Generate Kubernetes Secrets, Helm values, Terraform tfvars
- **Monorepo Support** - Service discovery and batch operations across multiple services
- **Unix-Friendly** - Full stdin/stdout support for piping
- **MCP Server** - Claude AI integration via Model Context Protocol

## Installation

```bash
# Using npm
npm install -g minienv

# Using pnpm
pnpm add -g minienv

# Or run directly with npx
npx minienv --help
```

### Pre-built Binaries

Download pre-built binaries from [Releases](https://github.com/forattini-dev/minienv/releases):

- `minienv-linux` (x64)
- `minienv-linux-arm64`
- `minienv-macos` (x64)
- `minienv-macos-arm64`
- `minienv-win.exe`

## Quick Start

```bash
# 1. Initialize a new project
minienv init

# 2. Set some variables
minienv set DATABASE_URL "postgres://localhost/mydb" -e dev
minienv set API_KEY "sk-secret-key" -e dev

# 3. List variables
minienv list -e dev

# 4. Export to shell
eval $(minienv export -e dev)

# 5. Use in your app
echo $DATABASE_URL
```

## Commands

### Core Commands

| Command | Description | Example |
|---------|-------------|---------|
| `init` | Initialize .minienv configuration | `minienv init` |
| `get <key>` | Get a single variable | `minienv get DATABASE_URL -e prd` |
| `set <key> <value>` | Set a variable | `minienv set API_KEY "sk-..." -e prd` |
| `delete <key>` | Delete a variable | `minienv delete OLD_KEY -e dev` |
| `list` | List all variables | `minienv list -e prd` |
| `export` | Export for shell evaluation | `eval $(minienv export -e dev)` |

### Sync Commands

| Command | Description | Example |
|---------|-------------|---------|
| `sync` | Bidirectional sync with .env file | `minienv sync -f .env.local -e dev` |
| `pull` | Download from backend to .env | `minienv pull -e prd -o .env.prd` |
| `push` | Upload .env to backend | `minienv push -f .env.local -e dev` |

### Integration Commands

| Command | Description | Example |
|---------|-------------|---------|
| `k8s:secret` | Generate Kubernetes Secret YAML | `minienv k8s:secret -e prd \| kubectl apply -f -` |
| `k8s:configmap` | Generate Kubernetes ConfigMap | `minienv k8s:configmap -e prd` |
| `helm:values` | Generate Helm values.yaml | `minienv helm:values -e prd` |
| `tf:vars` | Generate Terraform .tfvars | `minienv tf:vars -e prd > terraform.tfvars` |
| `tf:json` | Generate Terraform JSON | `minienv tf:json -e prd` |

### Utility Commands

| Command | Description | Example |
|---------|-------------|---------|
| `key generate` | Generate encryption key | `minienv key generate` |
| `services` | List services in monorepo | `minienv services` |
| `mcp` | Start MCP server for Claude | `minienv mcp` |

## Global Options

```
-p, --project <name>    Project name (default: from config)
-s, --service <name>    Service name (for monorepos)
-e, --env <env>         Environment: dev, stg, prd, sbx, dr
-b, --backend <url>     Backend URL override
-k, --key <path>        Encryption key path
-v, --verbose           Enable verbose output
--all                   Apply to all services (monorepo)
--dry-run               Preview changes without applying
--json                  Output in JSON format
--no-color              Disable colored output
```

## Configuration

minienv uses a `.minienv/config.yaml` file for project configuration:

```yaml
version: "1"

project: my-project
service: api  # optional, for monorepos

backend:
  # AWS S3
  url: s3://my-bucket/envs?region=us-east-1

  # MinIO
  # url: http://minioadmin:minioadmin@localhost:9000/envs

  # Cloudflare R2
  # url: https://KEY:SECRET@ACCOUNT.r2.cloudflarestorage.com/envs

  # Local filesystem (development)
  # url: file:///home/user/.minienv-store

  # In-memory (testing)
  # url: memory://test

encryption:
  key_source:
    - env: MINIENV_KEY           # 1. Environment variable
    - file: .minienv/.key        # 2. Local file
    - s3: s3://keys/minienv.key  # 3. Remote S3

environments:
  - dev
  - stg
  - prd
  - sbx
  - dr

default_environment: dev

# For monorepos - inherit from parent config
# extends: ../../.minienv/config.yaml
```

## Backend URLs

minienv supports multiple storage backends via connection URLs:

### AWS S3
```
s3://bucket-name/path?region=us-east-1
s3://ACCESS_KEY:SECRET_KEY@bucket-name/path?region=us-east-1
```

### MinIO / S3-Compatible
```
http://ACCESS_KEY:SECRET_KEY@localhost:9000/bucket
https://ACCESS_KEY:SECRET_KEY@minio.example.com/bucket
```

### Cloudflare R2
```
https://ACCESS_KEY:SECRET_KEY@ACCOUNT_ID.r2.cloudflarestorage.com/bucket
```

### Local Development
```
file:///path/to/storage    # FileSystem backend
memory://bucket-name       # In-memory (testing)
```

## Encryption

All secrets are encrypted using AES-256-GCM before storage. Keys can be loaded from multiple sources:

### 1. Environment Variable (recommended for CI/CD)
```bash
export MINIENV_KEY="base64-encoded-32-byte-key"
minienv export -e prd
```

### 2. Local File (development)
```bash
# Generate a new key
minienv key generate -o .minienv/.key

# Add to .gitignore
echo ".minienv/.key" >> .gitignore
```

### 3. Remote S3 (production)
```yaml
# config.yaml
encryption:
  key_source:
    - s3: s3://secure-keys-bucket/minienv/master.key
```

## Integrations

### Kubernetes

```bash
# Deploy secrets directly to cluster
minienv k8s:secret -e prd -n my-namespace | kubectl apply -f -

# Generate ConfigMap for non-sensitive values
minienv k8s:configmap -e prd | kubectl apply -f -
```

### Helm

```bash
# Generate values file
minienv helm:values -e prd > values.prd.yaml

# Use in helm install
helm install my-app ./chart -f values.prd.yaml

# Or pipe directly
minienv helm:values -e prd | helm upgrade my-app ./chart -f -
```

### Terraform

```bash
# Generate tfvars file
minienv tf:vars -e prd > terraform.tfvars
terraform plan

# Or JSON format
minienv tf:json -e prd > terraform.tfvars.json
```

## Monorepo Support

minienv supports monorepos with multiple services, each with their own environment variables:

```
my-monorepo/
├── .minienv/
│   ├── config.yaml          # Root config
│   └── environments/
│       └── dev.env          # Shared variables
├── services/
│   ├── api/
│   │   └── .minienv/
│   │       ├── config.yaml  # extends: ../../../.minienv/config.yaml
│   │       └── environments/
│   │           └── dev.env
│   └── worker/
│       └── .minienv/
│           └── ...
```

### Batch Operations

```bash
# List all services
minienv services

# Sync all services at once
minienv sync -e dev --all

# Sync specific services
minienv sync -e dev -s api,worker

# Export from specific service
minienv export -e prd -s api
```

## Unix Pipes

minienv is designed for Unix pipelines:

```bash
# Import from another tool
vault kv get -format=json secret/app | \
  jq -r '.data.data | to_entries | .[] | "\(.key)=\(.value)"' | \
  minienv sync -e prd

# Export to kubectl
minienv k8s:secret -e prd | kubectl apply -f -

# Chain with other commands
minienv export -e dev | grep "^DATABASE" | sort
```

## MCP Server (Claude Integration)

minienv includes an MCP (Model Context Protocol) server for Claude AI integration:

```bash
# Start MCP server
minienv mcp
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/.config/claude/claude_desktop_config.json`):

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

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `minienv_get` | Get a single environment variable |
| `minienv_set` | Set an environment variable |
| `minienv_delete` | Delete an environment variable |
| `minienv_list` | List all variables for a project/environment |
| `minienv_export` | Export variables in various formats |
| `minienv_sync` | Sync variables with a .env file |

### MCP Resources

Access environment variables as resources:

```
minienv://project/environment
minienv://project/environment/service
```

## CI/CD Examples

### GitHub Actions

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy secrets to Kubernetes
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

## API Usage

minienv can also be used as a library:

```typescript
import { createClient, loadConfig } from 'minienv'

const config = loadConfig()
const client = await createClient(config)

// Get a variable
const value = await client.get('DATABASE_URL', {
  project: 'my-project',
  environment: 'prd'
})

// Set a variable
await client.set({
  key: 'API_KEY',
  value: 'sk-secret',
  project: 'my-project',
  environment: 'prd'
})

// List all variables
const vars = await client.list({
  project: 'my-project',
  environment: 'prd'
})
```

## Security Best Practices

1. **Never commit encryption keys** - Add `.minienv/.key` to `.gitignore`
2. **Use environment variables in CI/CD** - Set `MINIENV_KEY` as a secret
3. **Rotate keys periodically** - Use `minienv key generate` and re-encrypt
4. **Separate keys per environment** - Use different keys for dev/stg/prd
5. **Restrict S3 bucket access** - Use IAM policies to limit who can read secrets

## Comparison

| Feature | minienv | dotenv | doppler | vault |
|---------|---------|--------|---------|-------|
| Multi-backend | Yes | No | No | No |
| Encryption at rest | AES-256-GCM | No | Yes | Yes |
| K8s integration | Native | No | Plugin | Plugin |
| Self-hosted | Yes | N/A | No | Yes |
| Monorepo support | Native | No | Limited | No |
| MCP/AI integration | Yes | No | No | No |
| Complexity | Low | Low | Medium | High |

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Made with love by [Forattini](https://github.com/forattini-dev)
