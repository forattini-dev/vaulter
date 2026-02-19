# RFC: Service Output Targets

## Status: Draft

## Motivation

Vaulter needs to work well with any framework and monorepo tool. The current per-app config approach works, but can be too verbose.

## Proposal

A root config should define where each service receives its generated `.env`:

```yaml
# .vaulter/config.yaml
version: '1'
project: my-monorepo
environments: [dev, stg, prd]

outputs:
  web:
    path: apps/web
    filename: .env.local
    include:                 # Optional glob patterns to include
      - NEXT_PUBLIC_*
      - API_URL
    exclude:                 # Optional glob patterns to exclude
      - DATABASE_*
      - REDIS_*
    inherit: true            # Inherit shared vars? (default: true)

  api:
    path: apps/api
    filename: .env
    include:
      - DATABASE_*
      - REDIS_*
      - JWT_*

  # Shorthand: path only
  worker: apps/worker

shared:
  include:
    - LOG_LEVEL
    - NODE_ENV
    - SENTRY_DSN
```

## TypeScript Types

```typescript
/**
 * Output target for a service.
 */
export interface OutputTarget {
  /** Directory path where .env will be generated (relative to project root). */
  path: string

  /** Filename to generate (default: '.env'). */
  filename?: string

  /** Glob patterns to include. If omitted, includes all. */
  include?: string[]

  /** Glob patterns to exclude. Applied after include. */
  exclude?: string[]

  /** Inherit shared vars? (default: true). */
  inherit?: boolean
}

/**
 * Shorthand notation: string means path only.
 */
export type OutputTargetInput = string | OutputTarget

/**
 * Shared vars configuration.
 */
export interface SharedConfig {
  /** Glob patterns for vars inherited by all outputs. */
  include?: string[]
}

/**
 * Updated VaulterConfig.
 */
export interface VaulterConfig {
  // ... existing fields ...

  /** Output targets per service */
  outputs?: Record<string, OutputTargetInput>

  /** Shared vars configuration */
  shared?: SharedConfig
}
```

## API

### CLI

```bash
# Generate .env for all outputs
vaulter local pull --all

# Generate .env for one output
vaulter local pull --output web

# Alias: -s works for output too
vaulter local pull -s web

# Dry run preview
vaulter local pull --all --dry-run
```

### Programmatic

```typescript
import { createClient, pullToOutputs } from 'vaulter'

const client = createClient({ connectionString: '...' })
await client.connect()

// Pull for all outputs
await pullToOutputs({
  client,
  config,
  environment: 'dev',
  all: true
})

// Pull for one output
await pullToOutputs({
  client,
  config,
  environment: 'dev',
  output: 'web'
})
```

## Algorithm

```text
pullToOutputs(config, environment, output?):
  1. Load all vars from environment
  2. Collect shared vars from two sources:
     - vars with service='__shared__' (set via --shared)
     - vars that match shared.include patterns
  3. For each output target:
     a. If output is restricted, filter only that output
     b. Apply include patterns
     c. Apply exclude patterns
     d. If inherit=true, merge shared vars (output-specific wins)
     e. Write file to {path}/{filename}
```

## Glob Pattern Matching

Vaulter uses minimatch (already used in other parts of the codebase):

| Pattern | Matches |
|---------|---------|
| `DATABASE_*` | `DATABASE_URL`, `DATABASE_HOST`, etc |
| `NEXT_PUBLIC_*` | `NEXT_PUBLIC_API_URL`, etc |
| `*_KEY` | `API_KEY`, `SECRET_KEY`, etc |
| `LOG_LEVEL` | exact match |

## Use Cases

### 1. Next.js + NestJS Monorepo

```yaml
outputs:
  web:
    path: apps/web
    filename: .env.local
    include: [NEXT_PUBLIC_*, API_URL]

  api:
    path: apps/api
    include: [DATABASE_*, REDIS_*, JWT_*]

shared:
  include: [LOG_LEVEL, NODE_ENV]
```

### 2. Turborepo with 3 apps

```yaml
outputs:
  marketing: apps/marketing
  dashboard: apps/dashboard
  api: apps/api

shared:
  include: [SENTRY_DSN, LOG_LEVEL]
```

### 3. Single app with multiple env files

```yaml
outputs:
  app:
    path: .
    filename: .env.local
```

### 4. Public-only frontend subset

```yaml
outputs:
  web:
    path: apps/web
    include: [NEXT_PUBLIC_*]   # public vars only

  api:
    path: apps/api
    exclude: [NEXT_PUBLIC_*]   # everything except public vars
```

## Migration

### From per-app config to outputs

Before (`apps/web/.vaulter/config.yaml`):
```yaml
version: '1'
project: my-monorepo
service: web
extends: ../../../.vaulter/config.yaml
```

After (root `.vaulter/config.yaml`):
```yaml
version: '1'
project: my-monorepo
outputs:
  web: apps/web
```

### Migration script

```bash
vaulter migrate-outputs
```

## Interaction with Existing Features

### `vaulter local pull` (existing)

```bash
# Current behavior (without outputs)
vaulter local pull -e dev -f output.env

# New behavior (with outputs)
vaulter local pull -e dev --all
```

### `vaulter plan` + `vaulter apply` (existing)

```bash
vaulter plan -e dev
vaulter apply -e dev
vaulter apply -e dev --from-output web
```

### `vaulter diff` (existing)

Diff remains unchanged and compares local vs backend. Use `vaulter plan` + `vaulter apply` for sync.

### `vaulter export` (existing)

```bash
vaulter export -e dev -f env
vaulter export -e dev --using-output web
```

## Open Questions

1. **Var name overlap between outputs:** if `web.include` and `api.include` overlap, what happens?
   - **Answer:** No conflict. Outputs are independent and can receive the same variable.
2. **Vars not included in any output:** should we warn or ignore silently?
   - **Proposed:** warn in `--verbose`.
3. **Missing output path:** auto-create or error?
   - **Proposed:** create automatically (`mkdir -p`).
4. **Filename per environment:** `.env.{env}` or fixed filename?
   - **Proposed:** support placeholder `filename: .env.{env}`.

## Implementation Plan

### Phase 1: Core
- [ ] Add types in `src/types.ts`
- [ ] Validate config in `src/lib/config-loader.ts`
- [ ] Add glob matching in `src/lib/glob-matcher.ts`
- [ ] Implement `pullToOutputs()` in `src/lib/outputs.ts`
- [ ] Add CLI flags `--all` and `--output` in `src/cli/commands/pull.ts`

### Phase 2: Polish
- [ ] Add `vaulter migrate-outputs` command
- [ ] Add `--using-output` flag to export
- [ ] Add `--from-output` flag to apply/push
- [ ] Update MCP tools

### Phase 3: Documentation
- [ ] Update README
- [ ] Update MCP.md
- [ ] Add migration guide
