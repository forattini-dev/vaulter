# MiniEnv Project Context

## Purpose
MiniEnv is a secure, multi-backend environment variable and secrets manager designed for modern cloud-native workflows. It provides a small, fast binary that integrates seamlessly with Kubernetes (kubectl, helm), Infrastructure as Code tools (terraform, terragrunt), and CI/CD pipelines.

Unlike AWS-specific tools like awsenv, MiniEnv leverages s3db.js to support multiple storage backends (AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces, local filesystem, memory) while providing enterprise-grade AES-256-GCM encryption.

## Tech Stack

### Runtime
- **Language**: TypeScript compiled to JavaScript
- **Node.js**: >= 22.0.0
- **Build**: esbuild for bundling + pkg for cross-platform binaries
- **Package Manager**: pnpm

### Core Dependencies
- **s3db.js**: Multi-backend document storage with built-in encryption
- **commander**: Modern CLI framework
- **dotenv-expand**: Extended .env parsing with variable expansion
- **p-limit**: Concurrency control for batch operations

### Storage Backends (via s3db.js)
- AWS S3 (with IAM role support)
- MinIO (self-hosted S3-compatible)
- Cloudflare R2
- DigitalOcean Spaces
- Backblaze B2
- Local FileSystem (development)
- Memory (testing)

## Project Conventions

### Code Style
```
src/
├── index.ts              # CLI entry point
├── client.ts             # s3db.js client wrapper
├── types.ts              # TypeScript definitions
├── commands/             # CLI commands
├── lib/                  # Core utilities
└── integrations/         # External tool integrations
```

**Conventions:**
- Use ESM modules (import/export)
- Prefer async/await over callbacks
- Use descriptive variable names
- No `console.log()` in source - use proper logging
- All secrets use `secret` field type (auto-encrypted)
- Error messages must be actionable (include fix suggestions)
- Emoji indicators: ❌ error, ✅ success, ⚠️ warning, 💡 tip

### Architecture Patterns

**Storage Model:**
```typescript
// Environment variables stored as documents in s3db.js
{
  id: "uuid",
  key: "DATABASE_URL",           // Variable name
  value: "encrypted-value",      // AES-256-GCM encrypted
  project: "apps-lair",          // Project/monorepo name
  service: "svc-auth",           // Service name (monorepo)
  environment: "prd",            // dev/stg/prd/sbx/dr
  tags: ["database"],            // Optional tags
  createdAt: Date,
  updatedAt: Date
}
```

**Partition Strategy (O(1) queries):**
- `byProject`: All vars for a project
- `byProjectAndEnv`: All vars for project + environment
- `byProjectServiceEnv`: Specific service in specific env

**Directory Convention:**
```
project-root/
├── .minienv/
│   ├── config.yaml          # Connection and settings
│   ├── .key                 # Encryption key (git-ignored)
│   └── environments/        # Local .env files for sync
│       ├── dev.env
│       ├── stg.env
│       └── prd.env
└── apps/                    # Monorepo apps (optional)
    └── svc-auth/
        └── .minienv/        # Service-specific config
```

### Testing Strategy
- **Framework**: Vitest
- **Coverage target**: 80%+
- **Unit tests**: Mock s3db.js clients
- **Integration**: MemoryClient or FileSystemClient
- **E2E**: Real S3 (CI-only, optional)

### Git Workflow
- Conventional commits
- Feature branches
- PR required for main

## Domain Context

### Environments
| Name | Short | Description |
|------|-------|-------------|
| development | dev | Local development |
| staging | stg | Pre-production testing |
| production | prd | Live systems |
| sandbox | sbx | Experimental features |
| disaster-recovery | dr | DR site configuration |

### Security Model
1. **Encryption at rest**: AES-256-GCM via s3db.js
2. **Key management**: Master key in S3, local file, or env var
3. **Access control**: S3 bucket policies / IAM roles
4. **Audit trail**: Optional AuditPlugin
5. **No local caching**: Secrets never on disk unencrypted

### Integration Points
- **Kubernetes**: kubectl, helm, kustomize
- **IaC**: terraform, terragrunt, opentofu
- **CI/CD**: GitHub Actions, GitLab CI
- **Shell**: eval $(minienv export)

## Important Constraints

### Performance
- CLI startup: < 100ms
- Single var fetch: < 500ms (cold), < 50ms (cached)
- Batch sync (100 vars): < 5s

### Binary Size
- Target: < 30MB per platform
- Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win-x64

### Compatibility
- Node.js 22+
- S3-compatible APIs only
- POSIX shell compatibility

## External Dependencies

### Required
- s3db.js ^19.2.x - Core storage
- commander ^12.x - CLI
- dotenv-expand ^11.x - .env parsing
- p-limit ^6.x - Concurrency

### Optional
- @aws-sdk/client-s3 - AWS backend
- @aws-sdk/credential-providers - IAM roles

## Glossary
| Term | Definition |
|------|------------|
| **Project** | Top-level container (monorepo or single repo) |
| **Service** | Individual app within a project |
| **Environment** | Deployment context (dev/stg/prd/sbx/dr) |
| **Backend** | Storage provider (S3, MinIO, R2, etc.) |
| **Passphrase** | Master key for encryption |
