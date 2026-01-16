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
AES-256-GCM encryption. RSA/EC hybrid encryption. Native K8s, Helm & Terraform integration.

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
- [Audit & Compliance](#audit--compliance)
- [Secret Rotation](#secret-rotation)
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

Vaulter stores keys in `~/.vaulter/` directory (outside project) for security:

```
~/.vaulter/
├── projects/
│   └── <project-name>/
│       └── keys/
│           ├── master           # Private key (mode 600)
│           └── master.pub       # Public key (mode 644)
└── global/
    └── keys/                    # Shared across all projects
        ├── shared
        └── shared.pub
```

#### Key Commands

```bash
# Generate keys
vaulter key generate --name master                    # Symmetric key
vaulter key generate --name master --asymmetric       # RSA-4096 key pair
vaulter key generate --name master --asym --alg ec-p256  # EC P-256 key pair
vaulter key generate --name shared --global           # Global key (all projects)

# List and show keys
vaulter key list                      # List all keys (project + global)
vaulter key show --name master        # Show key details

# Export/import for deployment
vaulter key export --name master -o keys.enc    # Export encrypted bundle
vaulter key import -f keys.enc                  # Import on another machine

# Set VAULTER_EXPORT_PASSPHRASE to encrypt the bundle with custom passphrase
```

#### Configuration with key_name

The simplest way to use keys is via `key_name` resolution:

```yaml
# .vaulter/config.yaml
encryption:
  mode: asymmetric
  asymmetric:
    algorithm: rsa-4096
    key_name: master           # → ~/.vaulter/projects/<project>/keys/master[.pub]
    # Or for global key:
    # key_name: global:master  # → ~/.vaulter/global/keys/master[.pub]
```

#### Legacy Key Sources (still supported)

You can also specify explicit key sources:

```yaml
encryption:
  key_source:
    - env: VAULTER_KEY           # 1. Environment variable (CI/CD)
    - file: .vaulter/.key        # 2. Local file (development)
    - s3: s3://keys/vaulter.key  # 3. Remote S3 (shared teams)
```

##### Option 1: Environment Variable (Recommended for CI/CD)

```bash
# Generate a key
vaulter key generate --name master

# Set in CI/CD secrets from the generated key
export VAULTER_KEY=$(cat ~/.vaulter/projects/myproject/keys/master)
```

**Pros**: Key never in project directory, rotates easily via CI/CD secret rotation
**Use case**: GitHub Actions, GitLab CI, Jenkins

##### Option 2: key_name Resolution (Recommended for Development)

```yaml
encryption:
  mode: asymmetric
  asymmetric:
    key_name: master    # Auto-resolves to ~/.vaulter/projects/<project>/keys/
```

**Pros**: Simple, keys stored securely outside project
**Use case**: Local development, team workflows

##### Option 3: Remote S3 (Team Shared)

```yaml
encryption:
  key_source:
    - s3: s3://company-keys/vaulter/project.key?region=us-east-1
```

**Pros**: Centralized key management, IAM-controlled access
**Use case**: Teams, multiple developers needing same key

### Asymmetric Key Encryption (RSA/EC)

For enhanced security with separate encrypt/decrypt permissions, Vaulter supports hybrid encryption using RSA or Elliptic Curve key pairs.

#### How It Works

```
┌────────────────────────────────────────────────────────────────┐
│                     Hybrid Encryption                          │
│                                                                │
│  Your secret ──► AES-256-GCM ──► Encrypted data               │
│                      │                                         │
│                      │ (random AES key)                        │
│                      ▼                                         │
│  Public key ──► RSA/EC encrypt ──► Encrypted AES key          │
│                                                                │
│  Stored: { encrypted_key + encrypted_data + metadata }        │
│                                                                │
│  Decryption requires: Private key + Encrypted blob            │
└────────────────────────────────────────────────────────────────┘
```

**Benefits:**
- **Separation of duties**: Public key can only encrypt, private key can decrypt
- **CI/CD security**: Give CI/CD only the public key - it can write but not read secrets
- **Production isolation**: Only production has the private key for decryption

#### Generate Key Pair

```bash
# RSA 4096-bit (default, most compatible)
vaulter key generate --name master --asymmetric

# RSA 2048-bit (faster, less secure)
vaulter key generate --name master --asym --algorithm rsa-2048

# Elliptic Curve P-256 (modern, fast)
vaulter key generate --name master --asym --alg ec-p256

# Elliptic Curve P-384 (stronger EC)
vaulter key generate --name master --asym --alg ec-p384

# Global key (shared across all projects)
vaulter key generate --name shared --global --asymmetric
```

Output:
```
✓ Generated rsa-4096 key pair: master
  Private: ~/.vaulter/projects/my-project/keys/master (mode 600 - keep secret!)
  Public:  ~/.vaulter/projects/my-project/keys/master.pub (mode 644)

To use these keys in config.yaml:
  encryption:
    mode: asymmetric
    asymmetric:
      algorithm: rsa-4096
      key_name: master
```

#### Configuration

```yaml
# .vaulter/config.yaml
encryption:
  mode: asymmetric              # Enable asymmetric mode
  asymmetric:
    algorithm: rsa-4096         # or rsa-2048, ec-p256, ec-p384
    key_name: master            # Uses ~/.vaulter/projects/<project>/keys/master[.pub]
    # Or for global keys:
    # key_name: global:master   # Uses ~/.vaulter/global/keys/master[.pub]

# Alternative: explicit key sources (for CI/CD or custom paths)
# encryption:
#   mode: asymmetric
#   asymmetric:
#     algorithm: rsa-4096
#     public_key:
#       - file: /path/to/master.pub
#       - env: VAULTER_PUBLIC_KEY
#     private_key:
#       - file: /path/to/master
#       - env: VAULTER_PRIVATE_KEY
```

#### Supported Algorithms

| Algorithm | Key Size | Performance | Use Case |
|:----------|:---------|:------------|:---------|
| `rsa-4096` | 4096 bits | Slower | Maximum security, wide compatibility |
| `rsa-2048` | 2048 bits | Medium | Good balance, legacy systems |
| `ec-p256` | 256 bits | Fast | Modern systems, smaller keys |
| `ec-p384` | 384 bits | Medium | Higher security EC |

#### Use Case: Secure CI/CD Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ Development                                                  │
│   Developers have BOTH keys → can read and write secrets    │
│   vaulter set API_KEY="..." -e dev                          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ CI/CD (GitHub Actions, Jenkins, etc.)                        │
│   Only PUBLIC key → can write NEW secrets, cannot read      │
│   Useful for automated secret rotation scripts              │
│                                                             │
│   env:                                                      │
│     VAULTER_PUBLIC_KEY: ${{ secrets.VAULTER_PUBLIC_KEY }}   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Production                                                   │
│   Only PRIVATE key → can read secrets at runtime            │
│                                                             │
│   env:                                                      │
│     VAULTER_PRIVATE_KEY: ${{ secrets.VAULTER_PRIVATE_KEY }} │
│                                                             │
│   # Application reads secrets at startup                    │
│   eval $(vaulter export -e prd)                             │
└─────────────────────────────────────────────────────────────┘
```

#### Environment Variables

| Variable | Purpose |
|:---------|:--------|
| `VAULTER_PUBLIC_KEY` | Public key PEM content (for encryption) |
| `VAULTER_PRIVATE_KEY` | Private key PEM content (for decryption) |

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
| `list --all-envs` | List across all envs | `vaulter list --all-envs` |
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

#### Audit Commands

| Command | Description | Example |
|:--------|:------------|:--------|
| `audit list` | List audit entries | `vaulter audit list -e prd` |
| `audit show` | Show entry details | `vaulter audit show <id>` |
| `audit stats` | Show statistics | `vaulter audit stats -e prd` |
| `audit cleanup` | Delete old entries | `vaulter audit cleanup --retention 30` |

#### Rotation Commands

| Command | Description | Example |
|:--------|:------------|:--------|
| `rotation list` | Show rotation status | `vaulter rotation list -e prd` |
| `rotation run` | Run rotation check | `vaulter rotation run -e prd --clear` |

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
-e, --env <env>         Environment name (as defined in config)
-b, --backend <url>     Backend URL override
-k, --key <path|value>  Encryption key
-f, --file <path>       Input file path
-o, --output <path>     Output file path
-n, --namespace <name>  Kubernetes namespace
    --format <fmt>      Output format (shell/json/yaml/env/tfvars/docker-args)
-v, --verbose           Verbose output (shows values)
    --dry-run           Preview without applying
    --json              JSON output
    --force             Skip confirmations
    --all               Apply to all services in monorepo
```

### Flexible Environment Names

Vaulter lets you define your own environment names. Use whatever convention fits your workflow:

```yaml
# Short names (default)
environments: [dev, stg, prd]

# Full names
environments: [development, staging, production]

# Custom names
environments: [local, homolog, qa, uat, prod]

# Brazilian pattern
environments: [dev, homolog, prd]
```

All commands use `-e` with your custom names:

```bash
vaulter list -e homolog
vaulter pull -e development
vaulter k8s:secret -e uat | kubectl apply -f -
```

---

## Audit & Compliance

Vaulter includes built-in audit logging to track every change to your secrets. Essential for compliance (SOC2, HIPAA, PCI-DSS) and debugging "who changed what, when".

### Why Audit?

```
┌─────────────────────────────────────────────────────────────────┐
│                    Without Audit Logging                        │
│                                                                 │
│  Developer: "Who deleted the API_KEY in production?"            │
│  Team: 🤷 "No idea, check git blame? It's not in the repo..."  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     With Vaulter Audit                          │
│                                                                 │
│  $ vaulter audit list -e prd --pattern "API_KEY"                │
│                                                                 │
│  TIMESTAMP            USER      OP      KEY      ENV   SRC      │
│  2025-01-15 14:32:01  john      delete  API_KEY  prd   cli      │
│  2025-01-10 09:15:22  jane      set     API_KEY  prd   sync     │
│  2025-01-05 11:00:00  deploy    set     API_KEY  prd   ci       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Configuration

```yaml
# .vaulter/config.yaml
audit:
  enabled: true              # Enable audit logging (default: true)
  retention_days: 90         # Auto-cleanup entries older than N days
  user_source: env           # User detection: 'env' (from USER/USERNAME) or custom
```

| Option | Default | Description |
|:-------|:--------|:------------|
| `enabled` | `true` | Enable/disable audit logging |
| `retention_days` | `90` | Auto-cleanup old entries |
| `user_source` | `'env'` | How to detect current user |

### Commands

#### List Audit Entries

```bash
# List recent entries (default: 50)
vaulter audit list -e prd

# Filter by user
vaulter audit list -e prd --user john

# Filter by operation
vaulter audit list -e prd --operation delete

# Filter by key pattern (supports wildcards)
vaulter audit list -e prd --pattern "DATABASE_*"

# Filter by date range
vaulter audit list -e prd --since "2025-01-01" --until "2025-01-15"

# Filter by source (cli, mcp, api, loader)
vaulter audit list -e prd --source cli

# Show all environments
vaulter audit list --all-envs

# JSON output for scripting
vaulter audit list -e prd --json

# Combine filters
vaulter audit list -e prd --user deploy --operation set --limit 100
```

**Output:**
```
TIMESTAMP            USER          OP        KEY                       ENV   SRC
2025-01-15 14:32:01  john          delete    API_KEY                   prd   cli
2025-01-15 14:30:00  jane          set       DATABASE_URL              prd   cli
2025-01-15 10:00:00  claude        set       JWT_SECRET                prd   mcp
2025-01-14 16:45:22  jane          sync      *                         prd   cli

Showing 4 entries
```

#### Show Entry Details

```bash
# Get full details of a specific entry
vaulter audit show <entry-id>
```

**Output:**
```
  ID:          abc123def456
  Timestamp:   2025-01-15 14:32:01
  User:        john
  Operation:   delete
  Key:         API_KEY
  Project:     my-project
  Environment: prd
  Source:      cli
  Previous:    sk-1234****5678
  Metadata:    {"reason": "rotating key"}
```

#### Audit Statistics

```bash
# View summary statistics
vaulter audit stats -e prd
```

**Output:**
```
Audit Statistics for my-project/prd
════════════════════════════════════════
Total entries: 1,247
Date range:    2024-10-15 09:00:00 to 2025-01-15 14:32:01

By Operation:
  set          892
  delete       124
  sync         156
  push         75

By User:
  jane                 456
  john                 321
  github-ci            470

By Source:
  cli        645
  mcp        470
  api        132
```

#### Cleanup Old Entries

```bash
# Cleanup entries older than retention_days (from config)
vaulter audit cleanup

# Override retention period
vaulter audit cleanup --retention 30

# Dry-run to see what would be deleted
vaulter audit cleanup --retention 30 --dry-run
```

### Automatic Audit Logging

Audit entries are created automatically for all write operations:

| Operation | Logged Info |
|:----------|:------------|
| `set` | Key, previous value (masked), new value (masked) |
| `delete` | Key, previous value (masked) |
| `sync` | Keys added, updated, deleted |
| `push` | Keys added, updated, deleted |
| `deleteAll` | All deleted keys |

### Sources

The `source` field indicates where the operation originated:

| Source | Description |
|:-------|:------------|
| `cli` | Manual CLI command |
| `mcp` | MCP server (AI assistant) |
| `api` | Programmatic API usage |
| `loader` | Auto-load from `vaulter/load` |

### Compliance Tips

```bash
# Export audit log for compliance review
vaulter audit list --all-envs --json > audit-report-$(date +%Y%m).json

# Monitor production changes
vaulter audit list -e prd --since "$(date -d 'yesterday' +%Y-%m-%d)"

# Alert on deletions
vaulter audit list -e prd --operation delete --json | jq '.entries | length'
```

---

## Secret Rotation

Regular secret rotation is a security best practice. Vaulter tracks rotation schedules and helps you identify secrets that need attention.

### Why Rotate?

- **Limit exposure**: If a key is compromised, damage is time-limited
- **Compliance**: Many standards require periodic rotation (PCI-DSS: 90 days)
- **Access control**: Rotated keys invalidate old access
- **Audit trail**: Clear history of when credentials changed

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    Rotation Workflow                            │
│                                                                 │
│  1. vaulter rotation list        → See what needs rotation      │
│                                                                 │
│  KEY            ENV   LAST ROTATED    ROTATE AFTER    STATUS    │
│  DATABASE_URL   prd   45 days ago     90 days         ✓ OK      │
│  API_KEY        prd   120 days ago    90 days         ⚠ OVERDUE │
│  JWT_SECRET     prd   never           90 days         ⚠ OVERDUE │
│                                                                 │
│  2. Manually rotate the credential in the external service      │
│                                                                 │
│  3. vaulter set API_KEY="new-value" -e prd                      │
│     → Automatically updates rotatedAt timestamp                 │
│                                                                 │
│  4. vaulter rotation run -e prd --overdue                       │
│     → CI/CD gate: fails if secrets are overdue                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Configuration

```yaml
# .vaulter/config.yaml
encryption:
  rotation:
    enabled: true          # Enable rotation tracking
    interval_days: 90      # Default rotation interval
    patterns:              # Keys that should be rotated
      - "*_KEY"
      - "*_SECRET"
      - "*_TOKEN"
      - "*_PASSWORD"
      - "DATABASE_URL"
      - "REDIS_URL"
```

| Option | Default | Description |
|:-------|:--------|:------------|
| `enabled` | `true` | Enable rotation tracking |
| `interval_days` | `90` | Default rotation period |
| `patterns` | `["*_KEY", "*_SECRET", ...]` | Keys to track (glob patterns) |

### Commands

#### Check Rotation Status

```bash
# Check which secrets need rotation
vaulter rotation check -e prd

# Check all environments
vaulter rotation check --all-envs

# Custom threshold (default: 90 days)
vaulter rotation check -e prd --days 30

# JSON output
vaulter rotation check -e prd --json
```

**Output:**
```
Rotation check for my-project/prd
Default rotation interval: 90 days

⚠️  Secrets needing rotation (2):
  • API_KEY - 120 days old
  • JWT_SECRET - never rotated

Summary: 2 need rotation, 2 up to date
```

#### List Rotation Policies

```bash
# List secrets with rotation policies
vaulter rotation list -e prd

# Check all environments
vaulter rotation list --all-envs

# Verbose output with dates
vaulter rotation list -e prd -v
```

**Output:**
```
Secrets with rotation policies (3):

  • DATABASE_URL - due in 45 days
  • API_KEY - ⚠️  OVERDUE
  • REDIS_URL - due in 34 days
```

#### Set Rotation Policy

```bash
# Set rotation policy for a secret
vaulter rotation set API_KEY --interval 90d -e prd

# Clear rotation policy
vaulter rotation set API_KEY --clear -e prd

# Set with different intervals
vaulter rotation set JWT_SECRET --interval 30d -e prd
vaulter rotation set DATABASE_URL --interval 6m -e prd
```

**Supported intervals:** `Nd` (days), `Nw` (weeks), `Nm` (months), `Ny` (years)

#### Run Rotation Workflow (CI/CD)

```bash
# CI/CD gate - exits with code 1 if secrets are overdue
vaulter rotation run -e prd

# Only check overdue secrets
vaulter rotation run -e prd --overdue

# Filter by pattern
vaulter rotation run -e prd --pattern "*_KEY"

# Custom threshold
vaulter rotation run -e prd --days 30

# Don't fail even if overdue (for reports)
vaulter rotation run -e prd --fail=false

# JSON output for scripting
vaulter rotation run -e prd --json
```

**Output:**
```
Rotation workflow: my-project

⚠️  Secrets requiring rotation (2):
  • API_KEY - 32 days overdue (matched: *_KEY)
  • JWT_SECRET - 120 days overdue

To rotate a secret:
  vaulter set <KEY> "<new-value>" -e prd

The rotatedAt timestamp will be updated automatically.

Summary: 2 overdue, 2 up to date
```

#### Automatic rotatedAt Update

When you set a new value, Vaulter automatically tracks when it was last changed:

```bash
# Set new value (automatically updates rotatedAt)
vaulter set API_KEY="sk-new-rotated-key" -e prd

# Verify rotation was tracked
vaulter rotation check -e prd
```

**Output:**
```
Rotation check for my-project/prd

✓ Secrets up to date (1):
  • API_KEY - 0 days old

Summary: 0 need rotation, 1 up to date
```

### Rotation Metadata

Each secret tracks rotation metadata:

| Field | Description |
|:------|:------------|
| `rotatedAt` | ISO timestamp of last rotation |
| `rotateAfter` | ISO timestamp when rotation is due |

View with:
```bash
vaulter get API_KEY -e prd --json | jq '.metadata'
```

### CI/CD Integration

```yaml
# GitHub Actions - Weekly rotation check
name: Secret Rotation Check
on:
  schedule:
    - cron: '0 9 * * 1'  # Every Monday at 9am

jobs:
  check-rotation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check for overdue secrets
        env:
          VAULTER_KEY: ${{ secrets.VAULTER_KEY }}
        run: |
          # rotation run exits with code 1 if any secrets are overdue
          npx vaulter rotation run -e prd --overdue || {
            echo "::warning::Some secrets are overdue for rotation!"
            exit 1
          }
          echo "✓ All secrets are within rotation policy"

      # Optional: Filter by pattern for specific checks
      - name: Check API keys specifically
        run: |
          npx vaulter rotation run -e prd --pattern "*_KEY" --overdue
```

### Compliance Matrix

| Standard | Requirement | Vaulter Config |
|:---------|:------------|:---------------|
| PCI-DSS | 90 days | `interval_days: 90` |
| SOC2 | Regular rotation | `interval_days: 90` |
| HIPAA | Periodic | `interval_days: 180` |
| Internal | Custom | `interval_days: N` |

---

## CI/CD

### GitHub Actions (Quick Start)

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

### GitHub Actions (Complete Example)

```yaml
name: Deploy to Kubernetes
on:
  push:
    branches: [main, develop]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        default: 'dev'
        type: choice
        options: [dev, stg, prd]

env:
  VAULTER_VERSION: '1.0.1'

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment || (github.ref == 'refs/heads/main' && 'prd') || 'dev' }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install Vaulter
        run: npm install -g vaulter@${{ env.VAULTER_VERSION }}

      - name: Configure kubectl
        uses: azure/k8s-set-context@v4
        with:
          kubeconfig: ${{ secrets.KUBECONFIG }}

      - name: Deploy Secrets
        env:
          VAULTER_KEY: ${{ secrets.VAULTER_KEY }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          ENV=${{ github.event.inputs.environment || (github.ref == 'refs/heads/main' && 'prd') || 'dev' }}

          # Deploy K8s Secret
          vaulter k8s:secret -e $ENV -n my-namespace | kubectl apply -f -

          # Deploy ConfigMap (non-sensitive config)
          vaulter k8s:configmap -e $ENV -n my-namespace | kubectl apply -f -

          # Verify deployment
          kubectl get secret,configmap -n my-namespace

      - name: Restart Deployment
        run: |
          kubectl rollout restart deployment/my-app -n my-namespace
          kubectl rollout status deployment/my-app -n my-namespace --timeout=120s
```

### GitHub Actions (Monorepo with Services)

```yaml
name: Deploy Service
on:
  push:
    branches: [main]
    paths:
      - 'apps/svc-*/**'

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      services: ${{ steps.changes.outputs.services }}
    steps:
      - uses: actions/checkout@v4
      - id: changes
        run: |
          # Detect which services changed
          SERVICES=$(git diff --name-only HEAD~1 | grep '^apps/svc-' | cut -d'/' -f2 | sort -u | jq -R -s -c 'split("\n")[:-1]')
          echo "services=$SERVICES" >> $GITHUB_OUTPUT

  deploy:
    needs: detect-changes
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: ${{ fromJson(needs.detect-changes.outputs.services) }}
    steps:
      - uses: actions/checkout@v4

      - name: Deploy ${{ matrix.service }}
        env:
          VAULTER_KEY: ${{ secrets.VAULTER_KEY }}
        run: |
          # Deploy secrets for specific service
          vaulter k8s:secret -e prd -s ${{ matrix.service }} | kubectl apply -f -
```

### GitHub Actions (Using Binary for Speed)

```yaml
name: Deploy (Fast)
on: [push]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Download Vaulter Binary
        run: |
          curl -sL https://github.com/forattini-dev/vaulter/releases/latest/download/vaulter-linux -o vaulter
          chmod +x vaulter
          sudo mv vaulter /usr/local/bin/

      - name: Deploy
        env:
          VAULTER_KEY: ${{ secrets.VAULTER_KEY }}
        run: |
          vaulter k8s:secret -e prd | kubectl apply -f -
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

### Docker Integration

```bash
# Recommended: Use --env-file for production (handles all values safely)
vaulter export -e prd --format=env > .env.prd
docker run --env-file .env.prd myapp

# For simple values only: command substitution (no spaces/newlines in values)
docker run $(vaulter export -e prd --format=docker-args) myapp
```

> **Note**: The `docker-args` format outputs `-e "KEY=VALUE"` flags. Due to shell word-splitting,
> values containing spaces or special characters won't work correctly with `$(...)` substitution.
> Use `--env-file` for complex values or production deployments.

For `docker build` with build args, use shell format:

```bash
# Export to shell and use in build
eval $(vaulter export -e prd)
docker build \
  --build-arg DATABASE_URL="$DATABASE_URL" \
  --build-arg API_KEY="$API_KEY" \
  -t myapp .
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
vaulter helm:values -e prd > values.secrets.yaml
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
  # Secret rotation settings
  rotation:
    enabled: true
    interval_days: 90
    patterns:
      - "*_KEY"
      - "*_SECRET"
      - "*_TOKEN"

# Audit logging
audit:
  enabled: true
  retention_days: 90

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
```

Note: Custom secret/configmap names are configured in `.vaulter/config.yaml`:

```yaml
integrations:
  kubernetes:
    secret_name: my-app-secrets
    configmap_name: my-app-config
```

### Helm

```bash
# Pass as values
vaulter helm:values -e prd | helm upgrade myapp ./chart -f -

# Save to file
vaulter helm:values -e prd > values.secrets.yaml
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

### MCP Configuration

The MCP server uses a priority chain to resolve defaults:

1. **Tool arguments** (explicit in each call)
2. **Project config** (`.vaulter/config.yaml`)
3. **Project MCP config** (`.vaulter/config.yaml` → `mcp:` section)
4. **Global MCP config** (`~/.vaulter/config.yaml` → `mcp:` section)
5. **Hardcoded defaults**

#### Project MCP Defaults

Add an `mcp:` section to your project's `.vaulter/config.yaml`:

```yaml
# .vaulter/config.yaml
version: "1"
project: my-project

backend:
  url: s3://bucket/envs?region=us-east-1

# MCP defaults (used when MCP server runs in this project)
mcp:
  default_backend: s3://bucket/envs?region=us-east-1
  default_project: my-project
  default_environment: dev
  default_key: master    # Key name for encryption
```

#### Global MCP Defaults

For MCP clients that don't support `cwd`, create `~/.vaulter/config.yaml`:

```yaml
# ~/.vaulter/config.yaml
mcp:
  default_backend: s3://bucket/envs?region=us-east-1
  default_project: my-project
  default_environment: dev
  default_key: master
```

#### Working Directory

MCP clients need to know which project to use. Options:

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

Or use the `VAULTER_CWD` environment variable:

```json
{
  "mcpServers": {
    "vaulter": {
      "command": "vaulter",
      "args": ["mcp"],
      "env": {
        "VAULTER_CWD": "/path/to/project"
      }
    }
  }
}
```

### Available Tools (22)

#### Core Operations

| Tool | Description |
|:-----|:------------|
| `vaulter_get` | Get a variable |
| `vaulter_set` | Set a variable |
| `vaulter_delete` | Delete a variable |
| `vaulter_list` | List variables |
| `vaulter_export` | Export in various formats (shell, env, json, yaml, tfvars, docker-args) |
| `vaulter_sync` | Bidirectional sync |
| `vaulter_pull` | Download from backend |
| `vaulter_push` | Upload to backend |

#### Discovery & Analysis

| Tool | Description |
|:-----|:------------|
| `vaulter_compare` | Compare environments |
| `vaulter_search` | Search by pattern |
| `vaulter_scan` | Scan monorepo |
| `vaulter_services` | List services |
| `vaulter_init` | Initialize project |

#### Integrations

| Tool | Description |
|:-----|:------------|
| `vaulter_k8s_secret` | Generate K8s Secret |
| `vaulter_k8s_configmap` | Generate K8s ConfigMap |
| `vaulter_helm_values` | Generate Helm values.yaml |
| `vaulter_tf_vars` | Generate Terraform .tfvars |

#### Key Management

| Tool | Description |
|:-----|:------------|
| `vaulter_key_generate` | Generate encryption key (symmetric or asymmetric) |
| `vaulter_key_list` | List all keys (project + global) |
| `vaulter_key_show` | Show key details |
| `vaulter_key_export` | Export key to encrypted bundle |
| `vaulter_key_import` | Import key from encrypted bundle |

### Resources (9)

| URI Pattern | Description |
|:------------|:------------|
| `vaulter://instructions` | ⚠️ **CRITICAL**: How vaulter stores data (read first!) |
| `vaulter://config` | Project configuration |
| `vaulter://services` | Monorepo services |
| `vaulter://keys` | List all encryption keys |
| `vaulter://keys/<name>` | Specific key details |
| `vaulter://keys/global/<name>` | Global key details |
| `vaulter://project/env` | Environment variables |
| `vaulter://project/env/service` | Service-specific vars |
| `vaulter://compare/env1/env2` | Environment diff

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
