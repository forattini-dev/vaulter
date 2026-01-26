<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Vaulter - Environment Variables & Secrets Manager

## Quick Start

```bash
# Inicializar projeto
vaulter init

# Gerar chave de encriptação
vaulter key generate

# Set variáveis (secrets vs configs)
vaulter set DATABASE_URL=postgres://... -e dev    # secret (sensitive=true)
vaulter set LOG_LEVEL::debug -e dev               # config (sensitive=false)

# List variáveis (mostra TYPE: secret/config)
vaulter list -e dev

# Push para backend (S3)
vaulter sync push -e dev

# Pull do backend
vaulter sync pull -e dev

# Export para K8s (separação automática)
vaulter k8s:secret -e dev      # só secrets (sensitive=true)
vaulter k8s:configmap -e dev   # só configs (sensitive=false)
```

## Performance

Todas as operações são O(1) - lookups diretos sem scanning.

| Operação | Complexidade |
|----------|--------------|
| get/set/delete | O(1) direct lookup |
| batch (N vars) | N parallel O(1) ops |

---

## Secrets vs Configs (sensitive field)

Cada variável tem um campo `sensitive` que indica se é um **secret** (sensível) ou **config** (não sensível). Isso permite separação automática na exportação para Kubernetes.

### CLI - Sintaxe de separadores

```bash
# Secret (sensitive=true) - usa "="
vaulter set DATABASE_URL=postgres://... -e dev
vaulter set API_KEY=sk-xxx -e dev

# Config (sensitive=false) - usa "::"
vaulter set LOG_LEVEL::debug -e dev
vaulter set NODE_ENV::production -e dev

# Batch: mistura secrets e configs
vaulter set DB_URL=xxx LOG_LEVEL::info PORT::3000 -e dev
```

### List mostra o tipo

```bash
vaulter list -e dev
# ENV   TYPE     KEY           VALUE
# dev   secret   DATABASE_URL  post****ost
# dev   secret   API_KEY       sk-****xxx
# dev   config   LOG_LEVEL     debug
# dev   config   NODE_ENV      production
```

### Kubernetes Export

A separação é automática baseada no campo `sensitive`:

```bash
# Gera Secret YAML (só vars com sensitive=true)
vaulter k8s:secret -e dev

# Gera ConfigMap YAML (só vars com sensitive=false)
vaulter k8s:configmap -e dev
```

### MCP Tools

```json
// vaulter_set com sensitive
{ "key": "DATABASE_URL", "value": "postgres://...", "environment": "dev", "sensitive": true }
{ "key": "LOG_LEVEL", "value": "debug", "environment": "dev", "sensitive": false }

// vaulter_multi_set com sensitive por variável
{
  "variables": [
    { "key": "DB_URL", "value": "xxx", "sensitive": true },
    { "key": "LOG_LEVEL", "value": "info", "sensitive": false }
  ],
  "environment": "dev"
}

// vaulter_list retorna sensitive
[
  { "key": "DATABASE_URL", "value": "***", "sensitive": true },
  { "key": "LOG_LEVEL", "value": "debug", "sensitive": false }
]
```

### Default Behavior

- **Default:** `sensitive: false` (config)
- **CLI `=`:** `sensitive: true` (secret)
- **CLI `::`:** `sensitive: false` (config)
- **Vars existentes sem campo:** tratadas como config

---

## Encoding Detection (Dupla Encriptação)

Vaulter detecta automaticamente valores que parecem já estar codificados ou encriptados e exibe **warnings** para evitar dupla-encriptação.

### Padrões Detectados

| Tipo | Confiança | Exemplo |
|------|-----------|---------|
| bcrypt | Alta | `$2b$10$...` |
| argon2 | Alta | `$argon2id$v=19$...` |
| JWT | Alta | `eyJhbG...` |
| PGP | Alta | `-----BEGIN PGP MESSAGE-----` |
| SSH key | Alta | `ssh-rsa AAAA...` |
| AWS KMS | Média | `AQICAHh...` |
| base64 | Média | Strings longas com padding `=` |
| hex | Baixa | Strings longas só com `0-9a-f` |

### Comportamento

Ao salvar uma variável com valor que parece pré-codificado:

```bash
$ vaulter set PASSWORD=$2b$10$... -e dev
⚠️ Warning: PASSWORD - Value appears to be a bcrypt hash. Vaulter will encrypt it again.
  Vaulter automatically encrypts all values. Pre-encoding is usually unnecessary.
✓ Set secret PASSWORD in myproject/dev
```

**Importante:** O warning é apenas informativo. O valor é salvo normalmente. Se você realmente quer armazenar um hash bcrypt (ex: para validação), ignore o warning.

### MCP Tools

Os tools `vaulter_set` e `vaulter_multi_set` incluem warnings na resposta:

```
✓ Set API_KEY (secret) in myproject/dev

⚠️ Warning: Value appears to be a JWT token. Vaulter will encrypt it, which is fine for storage.
Vaulter automatically encrypts all values. Pre-encoding is usually unnecessary.
```

### Programático

```typescript
import { detectEncoding, checkValuesForEncoding } from 'vaulter'

// Checar um valor
const result = detectEncoding('$2b$10$...')
// { detected: true, type: 'bcrypt', confidence: 'high', message: '...' }

// Checar múltiplos valores
const warnings = checkValuesForEncoding([
  { key: 'PASSWORD', value: '$2b$10$...' },
  { key: 'API_KEY', value: 'sk-xxx' }
])
// [{ key: 'PASSWORD', result: { detected: true, type: 'bcrypt', ... } }]
```

---

## Client API

```typescript
import { createClient } from 'vaulter'

const client = createClient({ connectionString: 's3://bucket' })
await client.connect()

// Single operations - O(1)
await client.get('KEY', 'project', 'dev')
await client.set({
  key: 'KEY',
  value: 'val',
  project: 'project',
  environment: 'dev',
  sensitive: true  // secret (default: false = config)
})
await client.delete('KEY', 'project', 'dev')

// Com service (monorepo)
await client.get('KEY', 'project', 'dev', 'api')

// Batch operations - parallel
await client.setMany([
  { key: 'DB_URL', value: 'xxx', project: 'p', environment: 'dev', sensitive: true },
  { key: 'LOG_LEVEL', value: 'debug', project: 'p', environment: 'dev', sensitive: false }
])
await client.getMany(['VAR1', 'VAR2'], 'project', 'dev')
await client.deleteManyByKeys(['OLD1', 'OLD2'], 'project', 'dev')
```

---

## MCP Server

**30 Tools | 5 Resources | 8 Prompts**

### Tools (30)

| Category | Tools |
|----------|-------|
| **Core (5)** | `vaulter_get`, `vaulter_set`, `vaulter_delete`, `vaulter_list`, `vaulter_export` |
| **Batch (3)** | `vaulter_multi_get`, `vaulter_multi_set`, `vaulter_multi_delete` |
| **Sync (3)** | `vaulter_sync`, `vaulter_pull`, `vaulter_push` |
| **Analysis (2)** | `vaulter_compare`, `vaulter_search` |
| **Status (2)** | `vaulter_status`, `vaulter_audit_list` |
| **K8s (2)** | `vaulter_k8s_secret`, `vaulter_k8s_configmap` |
| **IaC (2)** | `vaulter_helm_values`, `vaulter_tf_vars` |
| **Keys (5)** | `vaulter_key_generate`, `vaulter_key_list`, `vaulter_key_show`, `vaulter_key_export`, `vaulter_key_import` |
| **Monorepo (5)** | `vaulter_init`, `vaulter_scan`, `vaulter_services`, `vaulter_shared_list`, `vaulter_inheritance_info` |
| **Other (1)** | `vaulter_categorize_vars` |

### Resources (5)

| URI | Description |
|-----|-------------|
| `vaulter://instructions` | **Read first!** s3db.js architecture |
| `vaulter://tools-guide` | Which tool for each scenario |
| `vaulter://mcp-config` | MCP settings sources |
| `vaulter://config` | Project YAML config |
| `vaulter://services` | Monorepo services |

### Prompts (8)

`setup_project`, `migrate_dotenv`, `deploy_secrets`, `compare_environments`, `security_audit`, `rotation_workflow`, `shared_vars_workflow`, `batch_operations`

**Full reference:** See [docs/MCP.md](docs/MCP.md)

---

## Monorepo vs Single Repo

Funciona para ambos cenários:

- **Single repo:** Apenas `project` + `environment`
- **Monorepo:** `project` + `environment` + `service`
- **Shared vars:** Variáveis que se aplicam a todos os services

### Shared Vars (Variáveis Compartilhadas)

Shared vars são variáveis que se aplicam a **todos os services** de um monorepo.

**CLI - Use `--shared`:**

```bash
# Set shared var
vaulter set LOG_LEVEL=debug -e dev --shared

# Get shared var
vaulter get LOG_LEVEL -e dev --shared

# List all shared vars
vaulter list -e dev --shared

# Delete shared var
vaulter delete LOG_LEVEL -e dev --shared
```

**MCP Tools - Use `shared: true`:**

```json
// vaulter_set com shared=true
{ "key": "LOG_LEVEL", "value": "debug", "environment": "dev", "shared": true }

// vaulter_list com shared=true
{ "environment": "dev", "shared": true }
```

### Herança de Shared Vars

Ao exportar variáveis de um service, as **shared vars são automaticamente herdadas**:

```bash
# Export api service (inclui shared vars automaticamente)
vaulter export -e dev -s api

# Export só shared vars
vaulter export -e dev --shared
```

**MCP Tool:** `vaulter_export` aceita `includeShared: boolean` (default: `true`)

### Encriptação de Shared Vars

Por padrão, cada environment tem sua própria chave de encriptação (`VAULTER_KEY_DEV`, `VAULTER_KEY_PRD`, etc.). Mas shared vars existem fora de qualquer environment específico - qual chave usar?

**`shared_key_environment`** define qual environment fornece a chave para encriptar shared vars:

```yaml
# .vaulter/config.yaml
encryption:
  mode: symmetric
  shared_key_environment: dev  # shared vars usam VAULTER_KEY_DEV
```

**Comportamento:**
- Se não configurado → usa `default_environment` ou `'dev'`
- A chave é resolvida como `VAULTER_KEY_{SHARED_KEY_ENVIRONMENT}`
- Exemplo: `shared_key_environment: prd` → usa `VAULTER_KEY_PRD`

**Quando configurar:**
- Se shared vars devem usar a chave de produção: `shared_key_environment: prd`
- Se preferir isolamento total de dev: deixe como `dev` (default)

**No CLI/MCP:** a resolução é automática - basta ter as env vars corretas.

---

## Output Targets (Framework-Agnostic)

Gera arquivos `.env` para múltiplos destinos. Funciona com Next.js, NestJS, Express, NX, Turborepo, etc.

### Config

```yaml
# .vaulter/config.yaml
outputs:
  web:
    path: apps/web
    filename: .env.local        # ou .env.{env} → .env.dev
    include: [NEXT_PUBLIC_*]    # glob patterns
    exclude: [*_SECRET]
    inherit: true               # herda shared vars (default)

  api: apps/api                 # shorthand: apenas path

shared:
  include: [LOG_LEVEL, NODE_ENV, SENTRY_*]
```

### CLI

```bash
# Pull para todos os outputs
vaulter sync pull --all

# Pull para output específico
vaulter sync pull --output web

# Dry-run (mostra o que seria escrito)
vaulter sync pull --all --dry-run
```

### Algoritmo de Filtragem

1. Se `include` vazio → inclui todas as vars
2. Se `include` especificado → só vars que match
3. Aplica `exclude` para filtrar

### Herança de Shared Vars em Output Targets

O `pullToOutputs` busca shared vars de **duas fontes**:

1. **Vars com `--shared`**: Variáveis criadas com a flag `--shared`
2. **Patterns `shared.include`**: Vars que matcham os patterns no config

```yaml
# Exemplo: ambas as abordagens funcionam juntas
shared:
  include: [LOG_LEVEL, SENTRY_*]  # Pattern-based (opcional)

# E vars criadas com --shared também são incluídas automaticamente
```

**Comportamento:**
- `inherit: true` (default) → shared vars são adicionadas ao output
- Service-specific vars sobrescrevem shared vars com mesmo nome

### Tipos

```typescript
import {
  pullToOutputs,
  filterVarsByPatterns,
  normalizeOutputTargets,
  validateOutputsConfig,
  getSharedVars,
  getSharedServiceVars
} from 'vaulter'

// Pull programático
const result = await pullToOutputs({
  client,
  config,
  environment: 'dev',
  projectRoot: '/path/to/project',
  all: true,
  dryRun: false
})

// result.files: { output, path, fullPath, varsCount, vars }[]
// result.warnings: string[]
```

---

## Runtime Loader (Zero ConfigMap/Secret)

Carrega secrets direto do backend no startup da aplicação, sem precisar de arquivos `.env` ou ConfigMaps/Secrets no Kubernetes.

### Quick Start

```typescript
// Opção 1: Side-effect import (mais simples)
import 'vaulter/runtime/load'
// process.env já tem todas as secrets!

// Opção 2: Programático
import { loadRuntime } from 'vaulter/runtime'
await loadRuntime()

// Com opções
await loadRuntime({
  environment: 'prd',
  service: 'api',
  required: true,
  filter: { include: ['DATABASE_*', 'REDIS_*'] }
})
```

### Configuração

```bash
# Backend
VAULTER_BACKEND=s3://bucket/envs?region=us-east-1

# Encryption key POR ENVIRONMENT (recomendado)
VAULTER_KEY_PRD=chave-producao-segura
VAULTER_KEY_DEV=chave-dev-menos-segura
VAULTER_KEY=chave-fallback-global

# Contexto
VAULTER_PROJECT=myproject
VAULTER_SERVICE=api
NODE_ENV=production

# Debug
VAULTER_VERBOSE=1
```

### Kubernetes Simplificado

**Antes** (N secrets + configmaps):
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: api-secrets
data:
  DATABASE_URL: base64...
  REDIS_URL: base64...
  # ... muitas secrets
---
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - envFrom:
            - secretRef:
                name: api-secrets
```

**Depois** (1 secret apenas):
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: vaulter-key
data:
  prd: base64-da-chave-prd
---
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - env:
            - name: NODE_ENV
              value: "production"
            - name: VAULTER_KEY_PRD
              valueFrom:
                secretKeyRef:
                  name: vaulter-key
                  key: prd
```

A app busca todas as outras secrets do S3 no startup.

### API

```typescript
interface RuntimeLoaderOptions {
  // Contexto
  project?: string        // Override config.project
  environment?: string    // Default: NODE_ENV ou 'dev'
  service?: string        // Para monorepos

  // Backend
  backend?: string        // Override VAULTER_BACKEND
  encryptionKey?: string  // Override VAULTER_KEY

  // Comportamento
  required?: boolean      // Falha se não carregar (default: true em prd)
  override?: boolean      // Sobrescreve process.env existente (default: false)
  includeShared?: boolean // Inclui shared vars (default: true)
  filter?: {
    include?: string[]    // Glob patterns para incluir
    exclude?: string[]    // Glob patterns para excluir
  }

  // Debug
  verbose?: boolean
  silent?: boolean

  // Callbacks
  onLoaded?: (result) => void
  onError?: (error) => void
}

interface RuntimeLoaderResult {
  varsLoaded: number
  environment: string
  project: string
  service?: string
  backend: string
  durationMs: number
  keys: string[]
}
```

### Helpers

```typescript
import { isRuntimeAvailable, getRuntimeInfo } from 'vaulter/runtime'

// Verifica se config existe
if (isRuntimeAvailable()) {
  await loadRuntime()
}

// Info sem carregar
const info = await getRuntimeInfo()
// { available: true, project: 'myapp', environment: 'dev', backend: 's3://...' }
```

---

## Estrutura

```
src/
├── client.ts          # VaulterClient com IDs determinísticos
├── index.ts           # Exports
├── types.ts           # Types
├── loader.ts          # dotenv loader
├── runtime/           # Runtime loader (sem .env)
│   ├── loader.ts      # loadRuntime()
│   ├── load.ts        # Side-effect import
│   └── types.ts       # RuntimeLoaderOptions, RuntimeLoaderResult
├── cli/               # CLI
├── lib/
│   ├── outputs.ts     # Output targets (pullToOutputs, filterVarsByPatterns)
│   ├── pattern-matcher.ts  # Glob pattern compilation
│   ├── encoding-detection.ts  # Detecção de valores pré-codificados
│   └── ...            # Outros utils
└── mcp/               # MCP server (tools, resources, prompts)
```

## Comandos

```bash
pnpm test      # Testes
pnpm build     # Build
```
