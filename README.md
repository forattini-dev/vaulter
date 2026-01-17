<div align="center">

# vaulter

### Multi-Backend Environment & Secrets Manager

[![npm version](https://img.shields.io/npm/v/vaulter.svg?style=flat-square&color=F5A623)](https://www.npmjs.com/package/vaulter)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Claude_AI-7C3AED?style=flat-square&logo=anthropic&logoColor=white)](https://modelcontextprotocol.io/)

Store secrets anywhere: AWS S3, MinIO, R2, Spaces, B2, or local filesystem.
<br>
AES-256-GCM encryption. Native K8s, Helm & Terraform integration.

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

## Why Vaulter?

| Problem | Solution |
|:--------|:---------|
| Secrets in plaintext `.env` | Encrypted at rest (AES-256-GCM) |
| Manual sync between devs | `vaulter sync pull` / `vaulter sync push` |
| Copy-paste to CI/CD | `eval $(vaulter export shell -e prd)` |
| No audit trail | Full history via audit log |
| Different files per machine | Single source of truth |

**Zero lock-in**: Your data lives in YOUR storage (S3, MinIO, R2, filesystem).

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
| `key generate --name <n> --asymmetric` | Generate RSA/EC key pair |
| `key list` | List all keys |
| `key export --name <n>` | Export encrypted bundle |

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
```

### Backend URLs

| Provider | URL |
|:---------|:----|
| AWS S3 | `s3://bucket/path?region=us-east-1` |
| MinIO | `http://KEY:SECRET@localhost:9000/bucket` |
| Cloudflare R2 | `https://KEY:SECRET@ACCOUNT.r2.cloudflarestorage.com/bucket` |
| DigitalOcean | `https://KEY:SECRET@nyc3.digitaloceanspaces.com/bucket` |
| FileSystem | `file:///path/to/storage` |

### Split Mode

Separate configs (committable) from secrets (gitignored):

```bash
vaulter init --split
```

```
deploy/
├── configs/    # Committable (PORT, HOST)
└── secrets/    # Gitignored (DATABASE_URL, API_KEY)
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
      - name: Deploy secrets
        env:
          VAULTER_KEY: ${{ secrets.VAULTER_KEY }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: npx vaulter export k8s-secret -e prd | kubectl apply -f -
```

### Other Platforms

```bash
# GitLab CI
npx vaulter export k8s-secret -e ${CI_ENVIRONMENT_NAME} | kubectl apply -f -

# Docker
vaulter export docker -e prd > .env.prd && docker run --env-file .env.prd myapp

# Terraform
vaulter export terraform -e prd > secrets.auto.tfvars

# Helm
vaulter export helm -e prd | helm upgrade myapp ./chart -f -
```

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

### Auto-load (dotenv compatible)

```typescript
import 'vaulter/load'  // Auto-loads .env into process.env
```

---

## MCP Server

Claude AI integration via Model Context Protocol.

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

### Tools

| Category | Tools |
|:---------|:------|
| **Variables** | `var_get`, `var_set`, `var_delete`, `var_list` |
| **Sync** | `sync_push`, `sync_pull`, `sync_merge`, `sync_diff` |
| **Export** | `export_shell`, `export_k8s_secret`, `export_k8s_configmap`, `export_helm`, `export_terraform` |
| **Discovery** | `compare`, `search`, `services`, `init` |
| **Keys** | `key_generate`, `key_list`, `key_show`, `key_export`, `key_import` |
| **Audit** | `audit_list`, `audit_stats` |
| **Rotation** | `rotation_list`, `rotation_run` |

### Resources (4)

Static data views (no input required). For actions with parameters, use tools.

| URI | Description |
|:----|:------------|
| `vaulter://instructions` | **Read first!** How vaulter stores data |
| `vaulter://mcp-config` | MCP settings sources |
| `vaulter://config` | Project configuration (YAML) |
| `vaulter://services` | Monorepo services list |

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
