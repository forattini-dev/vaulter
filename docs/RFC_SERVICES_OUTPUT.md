# RFC: Services Output Targets

## Status: Draft

## Motivação

O Vaulter precisa funcionar bem com qualquer framework e monorepo tool. A solução atual (per-app config) funciona mas é trabalhosa de configurar.

## Proposta

Uma config na raiz que define onde cada service recebe seu `.env`:

```yaml
# .vaulter/config.yaml
version: '1'
project: my-monorepo
environments: [dev, stg, prd]

# NEW: Service outputs
outputs:
  web:
    path: apps/web           # Onde gerar o .env
    filename: .env.local     # Nome do arquivo (default: .env)
    include:                 # Quais vars incluir (glob patterns)
      - NEXT_PUBLIC_*
      - API_URL
    exclude:                 # Quais vars excluir (glob patterns)
      - DATABASE_*
      - REDIS_*
    inherit: true            # Herdar shared vars? (default: true)

  api:
    path: apps/api
    filename: .env
    include:
      - DATABASE_*
      - REDIS_*
      - JWT_*

  # Shorthand: só path
  worker: apps/worker

# Shared vars (herdados por todos os services)
shared:
  include:
    - LOG_LEVEL
    - NODE_ENV
    - SENTRY_DSN
```

## Tipos TypeScript

```typescript
/**
 * Output target for a service
 */
export interface OutputTarget {
  /** Directory path where .env will be generated (relative to project root) */
  path: string

  /** Filename to generate (default: '.env') */
  filename?: string

  /** Glob patterns for vars to include. If omitted, includes all. */
  include?: string[]

  /** Glob patterns for vars to exclude. Applied after include. */
  exclude?: string[]

  /** Inherit shared vars? (default: true) */
  inherit?: boolean
}

/**
 * Shorthand: string = just the path
 */
export type OutputTargetInput = string | OutputTarget

/**
 * Shared vars config
 */
export interface SharedConfig {
  /** Glob patterns for shared vars */
  include?: string[]
}

/**
 * Updated VaulterConfig
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
# Gera .env em todos os outputs
vaulter local pull --all

# Gera .env em um output específico
vaulter local pull --output web

# Alias: -s também funciona para output
vaulter local pull -s web

# Dry-run: mostra o que seria gerado
vaulter local pull --all --dry-run
```

### Programmatic

```typescript
import { createClient, pullToOutputs } from 'vaulter'

const client = createClient({ connectionString: '...' })
await client.connect()

// Pull para todos os outputs
await pullToOutputs({
  client,
  config,
  environment: 'dev',
  all: true
})

// Pull para um output específico
await pullToOutputs({
  client,
  config,
  environment: 'dev',
  output: 'web'
})
```

## Algoritmo

```
pullToOutputs(config, environment, output?):
  1. Carregar todas as vars do environment
  2. Buscar shared vars de DUAS fontes:
     - Vars com service='__shared__' (via --shared no CLI)
     - Vars que matcham patterns de shared.include
  3. Para cada output target:
     a. Se output específico, filtrar só esse
     b. Aplicar include patterns
     c. Aplicar exclude patterns
     d. Se inherit=true, merge shared vars (output sobrescreve)
     e. Escrever arquivo em {path}/{filename}
```

## Glob Pattern Matching

Usamos minimatch (já usado em outros lugares):

| Pattern | Matches |
|---------|---------|
| `DATABASE_*` | `DATABASE_URL`, `DATABASE_HOST`, etc |
| `NEXT_PUBLIC_*` | `NEXT_PUBLIC_API_URL`, etc |
| `*_KEY` | `API_KEY`, `SECRET_KEY`, etc |
| `LOG_LEVEL` | Exato match |

## Casos de Uso

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

### 2. Turborepo com 3 apps

```yaml
outputs:
  marketing: apps/marketing
  dashboard: apps/dashboard
  api: apps/api

shared:
  include: [SENTRY_DSN, LOG_LEVEL]
```

### 3. Single app com múltiplos environments

```yaml
outputs:
  app:
    path: .
    filename: .env.local
```

### 4. Frontend precisa de subset público

```yaml
outputs:
  web:
    path: apps/web
    include: [NEXT_PUBLIC_*]  # Só vars públicas

  api:
    path: apps/api
    exclude: [NEXT_PUBLIC_*]  # Tudo exceto públicas
```

## Migração

### De per-app config para outputs

Antes (apps/web/.vaulter/config.yaml):
```yaml
version: '1'
project: my-monorepo
service: web
extends: ../../../.vaulter/config.yaml
```

Depois (.vaulter/config.yaml na raiz):
```yaml
version: '1'
project: my-monorepo
outputs:
  web: apps/web
```

### Script de migração

```bash
# Detecta configs existentes e gera outputs
vaulter migrate-outputs
```

## Interação com Features Existentes

### `vaulter local pull` (existente)

```bash
# Comportamento atual (sem outputs)
vaulter local pull -e dev -f output.env

# Novo comportamento (com outputs)
vaulter local pull -e dev --all
```

### `vaulter plan` + `vaulter apply` (existente)

```bash
# Plan mostra diferenças local vs backend
vaulter plan -e dev

# Apply executa o plano, pushando mudanças
vaulter apply -e dev

# Apply com output específico
vaulter apply -e dev --from-output web
```

### `vaulter diff` (existente)

Diff mostra diferenças entre local e backend. Use `vaulter plan` + `vaulter apply` para sincronizar.

### `vaulter export` (existente)

```bash
# Export continua igual
vaulter export -e dev -f env

# Novo: export usando filters de um output
vaulter export -e dev --using-output web
```

## Questões em Aberto

1. **Conflito de var names**: Se `web.include` e `api.include` têm overlap, o que acontece?
   - **Resposta**: Não é conflito. Cada output é independente. A mesma var pode ir para múltiplos outputs.

2. **Vars não incluídas em nenhum output**: Warning? Ignore silently?
   - **Proposta**: Warning no --verbose

3. **Output path não existe**: Criar? Error?
   - **Proposta**: Criar automaticamente (mkdir -p)

4. **Filename com environment**: `.env.{env}` ou sempre fixo?
   - **Proposta**: Permitir placeholder: `filename: .env.{env}`

## Implementação

### Fase 1: Core
- [ ] Types em `src/types.ts`
- [ ] Validação de config em `src/lib/config-loader.ts`
- [ ] Glob matching em `src/lib/glob-matcher.ts`
- [ ] `pullToOutputs()` em `src/lib/outputs.ts`
- [ ] CLI flag `--all` e `--output` em `src/cli/commands/pull.ts`

### Fase 2: Polish
- [ ] `vaulter migrate-outputs` command
- [ ] `--using-output` flag no export
- [ ] `--from-output` flag no push
- [ ] MCP tools updates

### Fase 3: Documentation
- [ ] Update README
- [ ] Update MCP.md
- [ ] Migration guide
