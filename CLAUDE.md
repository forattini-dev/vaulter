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

## IDs Determinísticos

O vaulter usa **IDs determinísticos** em formato **base64url** para armazenamento de variáveis, permitindo lookups O(1).

### Formato do ID

**Input:** `{project}|{environment}|{service}|{key}`
**Output:** base64url (URL-safe, S3 path safe, reversível)

**Exemplos:**

| Cenário | Input | ID Gerado (base64url) |
|---------|-------|----------------------|
| Single repo | `myproject\|dev\|\|DATABASE_URL` | `bXlwcm9qZWN0fGRldnx8REFUQUJBU0VfVVJM` |
| Monorepo com service | `myproject\|dev\|api\|DATABASE_URL` | `bXlwcm9qZWN0fGRldnxhcGl8REFUQUJBU0VfVVJM` |
| Shared (sem service) | `myproject\|dev\|\|SHARED_KEY` | `bXlwcm9qZWN0fGRldnx8U0hBUkVEX0tFWQ` |

### Performance

| Operação | Complexidade |
|----------|--------------|
| get | O(1) direct lookup |
| set | O(1) direct upsert |
| delete | O(1) direct delete |
| batch (N) | N parallel O(1) ops |

---

## Arquitetura

### Storage Backend (s3db.js)

- Dados em **metadados S3**, não no body
- Cada variável = um objeto S3
- Valor encriptado nos headers `x-amz-meta-*`
- idGenerator customizado para IDs determinísticos

### Funções Auxiliares

```typescript
import { generateVarId, parseVarId } from 'vaulter'

// Gerar ID (retorna base64url)
const id = generateVarId('project', 'dev', 'api', 'KEY')
// => "cHJvamVjdHxkZXZ8YXBpfEtFWQ"

// Sem service
const id2 = generateVarId('project', 'dev', undefined, 'KEY')
// => "cHJvamVjdHxkZXZ8fEtFWQ"

// Parse (reversível!)
const parsed = parseVarId('cHJvamVjdHxkZXZ8YXBpfEtFWQ')
// => { project: 'project', environment: 'dev', service: 'api', key: 'KEY' }
```

### Client API

```typescript
import { createClient } from 'vaulter'

const client = createClient({ connectionString: 's3://bucket' })
await client.connect()

// Single operations - O(1)
await client.get('KEY', 'project', 'dev')
await client.set({ key: 'KEY', value: 'val', project: 'project', environment: 'dev' })
await client.delete('KEY', 'project', 'dev')

// Com service (monorepo)
await client.get('KEY', 'project', 'dev', 'api')

// Batch operations - parallel
await client.setMany([...])
await client.getMany(['VAR1', 'VAR2'], 'project', 'dev')
await client.deleteManyByKeys(['OLD1', 'OLD2'], 'project', 'dev')
```

---

## MCP Server (30 Tools)

**Core (8):** `vaulter_get`, `vaulter_set`, `vaulter_delete`, `vaulter_list`, `vaulter_export`, `vaulter_sync`, `vaulter_pull`, `vaulter_push`

**Batch (3):** `vaulter_multi_get`, `vaulter_multi_set`, `vaulter_multi_delete`

**Analysis (3):** `vaulter_compare`, `vaulter_search`, `vaulter_scan`

**Status (2):** `vaulter_status`, `vaulter_audit_list`

**K8s (2):** `vaulter_k8s_secret`, `vaulter_k8s_configmap`

**IaC (2):** `vaulter_helm_values`, `vaulter_tf_vars`

**Keys (5):** `vaulter_key_generate`, `vaulter_key_list`, `vaulter_key_show`, `vaulter_key_export`, `vaulter_key_import`

**Monorepo (5):** `vaulter_services`, `vaulter_init`, `vaulter_shared_list`, `vaulter_inheritance_info`, `vaulter_categorize_vars`

---

## Monorepo vs Single Repo

Funciona para ambos cenários. O campo `service` é opcional:

- **Single repo:** input `project|env||key` → base64url
- **Monorepo:** input `project|env|service|key` → base64url
- **Shared vars:** `service: '__shared__'` → aplica a todos os services

O formato base64url é **S3 path safe** (usa `-` e `_` ao invés de `+` e `/`).

### Herança de Shared Vars

Ao exportar variáveis de um service, as **shared vars são automaticamente herdadas**:

```typescript
// Export com herança (default)
await client.export('project', 'dev', 'api')
// Retorna: shared vars + api vars (merged, api sobrescreve)

// Export sem herança
await client.export('project', 'dev', 'api', { includeShared: false })
// Retorna: apenas api vars

// Export só shared
await client.export('project', 'dev', '__shared__')
// Retorna: apenas shared vars
```

**MCP Tool:** `vaulter_export` aceita `includeShared: boolean` (default: `true`)

---

## Estrutura

```
src/
├── client.ts          # VaulterClient com IDs determinísticos
├── index.ts           # Exports
├── types.ts           # Types
├── loader.ts          # dotenv loader
├── cli/               # CLI
├── lib/               # Utils
└── mcp/               # MCP server (tools, resources, prompts)
```

## Comandos

```bash
pnpm test      # Testes
pnpm build     # Build
```
