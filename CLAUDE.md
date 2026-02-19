
# Vaulter - Environment Variables & Secrets Manager

## 🤖 Para AI Agents - Leia Primeiro!

### 🎯 Quando Usar `vaulter_status action="scorecard"`

**USE `vaulter_status` nestes cenários:**

#### ✅ 1. Início de Conversa (Uma vez)
```
User inicia conversa pela primeira vez
  → Agent: vaulter_status action="scorecard" environment="dev"
  → Entende o contexto atual
  → Prossegue com operações normais
```

#### ✅ 2. Quando Operação Falha (Diagnóstico)
```
Agent: vaulter_change action="set" ← Tenta normalmente
  ↓ FALHA (timeout, erro, etc)
Agent: vaulter_status action="scorecard" ← AGORA SIM, diagnostica
  → Identifica problema
  → Informa user com sugestões
```

#### ✅ 3. User Pergunta Status
```
User: "Meu setup está ok?"
User: "Por que está lento?"
User: "Variáveis sincronizadas?"
  → Agent: vaulter_status action="scorecard"
```

#### ❌ NÃO use antes de toda operação
```
❌ ERRADO (muito lento):
  vaulter_status → vaulter_change
  vaulter_status → vaulter_get
  vaulter_status → vaulter_list

✅ CORRETO (rápido):
  vaulter_change action="set" (tenta direto)
    ↓ se falhar
  vaulter_status action="scorecard" (diagnostica)
```

**Estratégia de Retry Inteligente:**

```typescript
// Pseudo-código do workflow ideal:

try {
  // 1. Tentar operação normalmente (timeout: 30s)
  await vaulter_change({ action: 'set', key, value, environment })
  return "✓ Success"

} catch (error) {
  if (error.message.includes("timeout")) {
    // 2. Retry com timeout maior (60s)
    try {
      await vaulter_change({ action: 'set', key, value, environment, timeout_ms: 60000 })
      return "✓ Success (slower than expected)"

    } catch (retryError) {
      // 3. AGORA SIM - diagnosticar com status
      const diagnosis = await vaulter_status({ action: 'scorecard', environment })

      // 4. Informar user com diagnóstico
      return `❌ Operation failed. Diagnosis:\n${formatDiagnosis(diagnosis)}`
    }
  }

  // Se não foi timeout, diagnosticar direto
  const diagnosis = await vaulter_status({ action: 'scorecard', environment })
  return `❌ ${error.message}\n\nDiagnosis:\n${formatDiagnosis(diagnosis)}`
}
```

**Por que essa estratégia é melhor:**
- ⚡ **Rápido** - Não adiciona latência quando tudo funciona
- 🎯 **Eficiente** - Status check só quando necessário
- 🔍 **Diagnóstico preciso** - Quando falha, mostra o porquê
- 📊 **Retry inteligente** - Aumenta timeout antes de desistir

### ⏱️ Timeouts

Todas as operações têm timeout de 30s por padrão. Se operações estão falhando por timeout:

```yaml
# .vaulter/config.yaml ou ~/.vaulter/config.yaml
mcp:
  timeout_ms: 60000  # Aumentar para 60s se necessário
```

Ver [docs/TIMEOUT.md](docs/TIMEOUT.md) para detalhes.

### 🩺 Vaulter Status Scorecard - Checks Completos

O `vaulter_status action="scorecard"` executa **15 checks** para diagnosticar problemas:

**Checks Básicos:**
1. ✅ Config file - `.vaulter/config.yaml` existe
2. ✅ Project name - Configurado
3. ✅ Environment - Válido
4. ✅ Service - Existe (monorepo)
5. ✅ Backend URLs - Configurado
6. ✅ Encryption keys - Existem e são válidas
7. ✅ Shared key env - Chave para shared vars
8. ✅ Local env files - Arquivos locais existem
9. ✅ Outputs config - Outputs configurados

**Checks Avançados (novos!):**
10. ✅ **Backend connection** - Conecta e lista vars
11. ✅ **Performance/Latency** - Mede velocidade das operações (read, list)
12. ✅ **Write permissions** - Testa read/write/delete no backend
13. ✅ **Encryption round-trip** - Encripta → descriptografa → valida
14. ✅ **Sync status** - Compara local vs remoto (diferenças)
15. ✅ **Security issues** - Detecta .env no git, chaves fracas, permissões

**Exemplo de saída:**
```
✓ latency: read=45ms, list=67ms
✓ permissions: read/write/delete OK
✓ encryption: round-trip successful
⚠ sync-status: 5 local-only, 3 remote-only, 2 conflicts
✗ security: 2 .env file(s) tracked in git
  → Add to .gitignore immediately
```

### Tarefas Comuns (MCP Tools)

| Tarefa | Tool | Exemplo |
|--------|------|---------|
| Diagnosticar setup | `vaulter_status` | `action="scorecard" environment="dev"` |
| Ver diferenças local/remoto | `vaulter_diff` | `environment="prd" showValues=true` |
| Comparar environments | `vaulter_search` | `source="dev" target="prd" showValues=true` |
| Setar variável | `vaulter_change` | `action="set" key="DB_URL" value="xxx" sensitive=true` |
| Listar vars | `vaulter_list` | `environment="dev" showValues=true` |
| **Versioning** | | |
| Ver histórico de versões | `vaulter_versions` | `action="list" key="API_KEY" environment="dev" showValues=true` |
| Ver versão específica | `vaulter_versions` | `action="get" key="API_KEY" version=2 environment="dev"` |
| Rollback para versão anterior | `vaulter_versions` | `action="rollback" key="API_KEY" version=2 environment="dev" dryRun=true` |
| **Local Overrides** | | |
| Shared var (todos services) | `vaulter_local` | `action="shared-set" key="DEBUG" value="true"` |
| Listar shared vars | `vaulter_local` | `action="shared-list"` |
| Deletar shared var | `vaulter_local` | `action="shared-delete" key="DEBUG"` |
| Override por service | `vaulter_local` | `action="set" key="PORT" value="3001" service="web"` |
| Pull local + overrides | `vaulter_local` | `action="pull" all=true` |
| Diff overrides vs base | `vaulter_local` | `action="diff"` |
| Status local | `vaulter_local` | `action="status"` |
| Snapshot backup | `vaulter_snapshot` | `action="create" environment="dev"` |
| Listar snapshots | `vaulter_snapshot` | `action="list" environment="dev"` |
| Restaurar snapshot | `vaulter_snapshot` | `action="restore" id="dev_2026..." environment="dev"` |

### Workflow: Local Overrides (Dev) - OFFLINE FIRST

**ARQUITETURA OFFLINE-FIRST:**

| Comando | O que faz | Backend? |
|---------|-----------|----------|
| `vaulter local pull --all` | Gera .env files de `.vaulter/local/` | ❌ OFFLINE |
| `vaulter local push --all` | Envia `.vaulter/local/` → backend | ✅ Usa backend |
| `vaulter local push --all --overwrite` | **Substitui backend** pelo local (apaga extras) | ✅ Usa backend |
| `vaulter local sync` | Baixa backend → `.vaulter/local/` | ✅ Usa backend |

**Fluxo típico de desenvolvimento:**

```
┌─────────────────────────────────────────────────────────────────┐
│                     DESENVOLVIMENTO LOCAL                        │
│  1. Editar .vaulter/local/configs.env                           │
│  2. vaulter local pull --all  → Gera .env files [OFFLINE]       │
│  3. Desenvolver...                                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   COMPARTILHAR COM TIME                          │
│  vaulter local push --all     → Envia para backend              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    NOVO DEV DO TIME                              │
│  1. git clone <repo>                                             │
│  2. vaulter local sync        → Baixa backend → .vaulter/local/ │
│  3. vaulter local pull --all  → Gera .env files                 │
└─────────────────────────────────────────────────────────────────┘
```

**Estrutura de arquivos:**

```
.vaulter/local/
├── configs.env                 # shared configs (todos services)
├── secrets.env                 # shared secrets (todos services)
└── services/                   # monorepo: configs por service
    ├── svc-auth/
    │   ├── configs.env         # configs específicos do svc-auth
    │   └── secrets.env         # secrets específicos do svc-auth
    └── svc-api/
        ├── configs.env
        └── secrets.env
```

**Separação por Sensitive:**
- `KEY=value` → **secrets.env** (sensitive=true)
- `KEY::value` → **configs.env** (sensitive=false)

**Merge para cada output:** `shared vars + service-specific vars`
- Service vars sobrescrevem shared vars com mesmo nome

**Exemplo prático:**
```
# .vaulter/local/configs.env (20 vars shared)
NODE_ENV=local
LOG_LEVEL=debug
...

# .vaulter/local/services/svc-auth/configs.env (2 vars específicos)
PORT=28000
S3DB_CONNECTION_STRING=...

# Resultado para svc-auth: 20 shared + 2 service = 22 vars
# (NÃO 38 vars misturados de todos os services!)
```

**CLI:**
```bash
# === EDITAR LOCALMENTE ===
# Shared vars (todos services)
vaulter local set DEBUG::true             # → configs.env
vaulter local set JWT_SECRET=xxx          # → secrets.env

# Service-specific (monorepo)
vaulter local set PORT::3001 -s web       # → services/web/configs.env
vaulter local set API_KEY=xxx -s web      # → services/web/secrets.env

# === GERAR .ENV FILES [OFFLINE] ===
vaulter local pull --all
# Output: "svc-auth: 23 vars (21 shared + 2 service)"

# === COMPARTILHAR COM TIME ===
vaulter local push --all                  # Envia tudo para backend (merge)
vaulter local push --all --overwrite      # SUBSTITUI backend pelo local (apaga extras!)

# === RECEBER DO TIME ===
vaulter local sync                        # Baixa backend → .vaulter/local/
vaulter local pull --all                  # Gera .env files

# Ver status
vaulter local status
```

**MCP Tools:**
```bash
# === EDITAR LOCALMENTE ===
vaulter_local action="shared-set" key="DEBUG" value="true"     # shared config
vaulter_local action="set" key="PORT" value="3001" service="web"  # service config

# === GERAR .ENV [OFFLINE] ===
vaulter_local action="pull" all=true

# === COMPARTILHAR COM TIME ===
vaulter_local action="push-all"           # Envia tudo para backend

# === RECEBER DO TIME ===
vaulter_local action="sync"               # Baixa backend → .vaulter/local/
vaulter_local action="pull" all=true      # Gera .env files
```

**JSON Output:**
```json
{
  "success": true,
  "localSharedCount": 21,
  "totalServiceVarsCount": 33,
  "files": [
    { "output": "svc-auth", "varsCount": 23, "sharedCount": 21, "serviceCount": 2 }
  ]
}
```

### Workflow: Snapshots

Snapshots suportam dois drivers configuráveis via `.vaulter/config.yaml`:

```yaml
snapshots:
  driver: filesystem          # 'filesystem' (default) | 's3db'
  # filesystem-specific:
  path: .vaulter/snapshots    # default, só se driver=filesystem
  # s3db-specific:
  s3_path: backups/           # path template no S3 (default: 'vaulter-snapshots/')
```

**filesystem** (default): Backups comprimidos (gzip) com verificação SHA256 e manifest JSON.
Armazenados em `.vaulter/snapshots/<id>/` com `data.jsonl.gz` + `manifest.json`.

**s3db**: Usa o `BackupPlugin` do s3db.js, reusando a mesma connection string do backend.
Restore é direto no backend via plugin (sem load+setMany intermediário).

```bash
# Backup antes de mudanças
vaulter snapshot create -e dev
# → Cria dir com data.jsonl.gz + manifest.json (checksum SHA256)

# Listar snapshots (mostra checksum e compression)
vaulter snapshot list

# Restaurar snapshot (verifica SHA256 antes de restaurar)
vaulter snapshot restore <id> -e dev

# Restaurar interativo (sem ID → abre selector TUI com tuiuiu.js)
vaulter snapshot restore -e dev

# Deletar snapshot
vaulter snapshot delete <id>
```

**Formato do snapshot:**
```
.vaulter/snapshots/
└── dev_2026-01-27T15-30-00Z/
    ├── data.jsonl.gz       # vars como JSONL comprimido
    └── manifest.json       # metadata + checksum SHA256
```

### Workflow: Versioning (History & Rollback)

Vaulter mantém histórico automático de versões para rastreabilidade e rollback de mudanças.

**Configuração** (`.vaulter/config.yaml`):
```yaml
versioning:
  enabled: true
  retention_mode: count  # 'count' | 'days' | 'both'
  max_versions: 10       # keep last 10 versions
  retention_days: 30     # keep versions from last 30 days
  include: ['*']         # patterns to version
  exclude: ['TEMP_*']    # patterns to skip
```

**CLI Workflow:**
```bash
# 1. Ver histórico de mudanças
vaulter versions API_KEY -e prd
# ● latest (current)
#   └─ 2h ago - admin
#      Operation: set Source: cli
#      Value: sk-****xxx
# ○ v2
#   └─ 1d ago - deploy
#      Operation: rotate Source: automation
#      Value: sk-****yyy
# ○ v1
#   └─ 7d ago - admin
#      Operation: set Source: cli
#      Value: sk-****zzz

# 2. Ver valores completos (decrypted)
vaulter versions API_KEY -e prd --values

# 3. Visualizar versão específica
vaulter versions API_KEY --get 2 -e prd

# 4. Rollback (dry-run primeiro)
vaulter versions API_KEY --rollback 2 -e prd --dry-run
# From: latest → sk-****xxx
# To:   v2 → sk-****yyy

# 5. Executar rollback
vaulter versions API_KEY --rollback 2 -e prd
# ✓ Rolled back API_KEY
# From: latest
# To:   previous
# New:  rollback
```

**MCP Tools:**
```bash
# Ver histórico
vaulter_versions action="list" key="API_KEY" environment="prd" showValues=false

# Ver versão específica
vaulter_versions action="get" key="API_KEY" version=2 environment="prd"

# Rollback
vaulter_versions action="rollback" key="API_KEY" version=2 environment="prd" dryRun=true
```

**Comportamento:**
- ✅ Cada `set`, `rotate`, `copy`, `rename`, `rollback` cria nova versão
- ✅ Retention policy remove versões antigas automaticamente
- ✅ Rollback cria nova versão (não deleta histórico)
- ✅ Valores são encriptados por versão
- ✅ Checksum SHA256 garante integridade

### Workflow: Editar Local → Push Remoto

```bash
# 1. Ver diferenças (com valores mascarados)
vaulter diff -e prd --values

# 2. Editar arquivo local (.vaulter/local/prd.env)
# ... editar no seu editor ...

# 3. Ver diferenças novamente
vaulter diff -e prd --values

# 4. Gerar plano de mudanças
vaulter plan -e prd

# 5. Aplicar plano no backend
vaulter apply -e prd

# Ou aplicar + deletar vars remotas que não existem local
vaulter apply -e prd --prune
```

### Conflict Resolution via Plan/Apply

```bash
# Gerar plano com estratégia de conflito
vaulter plan -e dev --strategy local     # Local ganha (default)
vaulter plan -e dev --strategy remote    # Remoto ganha
vaulter plan -e dev --strategy error     # Erro em conflitos (não faz nada)

# Revisar plano e aplicar
vaulter apply -e dev
```

### Sync com Directory Mode (--dir)

O modo `--dir` sincroniza a estrutura completa `.vaulter/{env}/`:

```bash
# Push: .vaulter/dev/ → backend (plan + apply)
vaulter plan --dir -e dev
vaulter apply -e dev

# Pull: backend → .vaulter/dev/
vaulter plan --dir --pull -e dev
vaulter apply -e dev

# Dry-run para ver o que seria feito
vaulter plan --dir -e dev --dry-run
```

**Estrutura sincronizada:**
```
.vaulter/dev/
├── configs.env       # → __shared__ (sensitive=false)
├── secrets.env       # → __shared__ (sensitive=true)
└── services/
    └── api/
        ├── configs.env   # → api (sensitive=false)
        └── secrets.env   # → api (sensitive=true)
```

**Importante:** Arquivos locais **nunca são deletados** pelo CLI. Use `vaulter nuke --confirm=<project>` apenas para deletar dados do backend.

---

## Quick Start

```bash
# Inicializar projeto
vaulter init

# Gerar chave de encriptação
vaulter key generate

# Set variáveis (secrets vs configs)
vaulter change set DATABASE_URL=postgres://... -e dev    # secret (sensitive=true)
vaulter change set LOG_LEVEL::debug -e dev               # config (sensitive=false)

# List variáveis (mostra TYPE: secret/config)
vaulter list -e dev

# Gerar plano e aplicar no backend (S3)
vaulter plan -e dev
vaulter apply -e dev

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
vaulter change set DATABASE_URL=postgres://... -e dev
vaulter change set API_KEY=sk-xxx -e dev

# Config (sensitive=false) - usa "::"
vaulter change set LOG_LEVEL::debug -e dev
vaulter change set NODE_ENV::production -e dev

# Batch: mistura secrets e configs
vaulter change set DB_URL=xxx LOG_LEVEL::info PORT::3000 -e dev
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
// vaulter_change action="set" com sensitive
{ "action": "set", "key": "DATABASE_URL", "value": "postgres://...", "environment": "dev", "sensitive": true }
{ "action": "set", "key": "LOG_LEVEL", "value": "debug", "environment": "dev", "sensitive": false }

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
$ vaulter change set PASSWORD=$2b$10$... -e dev
⚠️ Warning: PASSWORD - Value appears to be a bcrypt hash. Vaulter will encrypt it again.
  Vaulter automatically encrypts all values. Pre-encoding is usually unnecessary.
✓ Set secret PASSWORD in myproject/dev
```

**Importante:** O warning é apenas informativo. O valor é salvo normalmente. Se você realmente quer armazenar um hash bcrypt (ex: para validação), ignore o warning.

### MCP Tools

O tool `vaulter_change action="set"` inclui warnings na resposta:

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

**16 Tools | 4 Resources | 5 Prompts**

### Tools (16)

| Category | Tool | Actions / Description |
|----------|------|----------------------|
| **Mutation Flow** | `vaulter_change` | set, delete, move, import (writes local state only) |
| | `vaulter_plan` | Compute diff local vs backend, generate plan artifact |
| | `vaulter_apply` | Execute plan, push changes to backend |
| **Read** | `vaulter_get` | Get single var or multi-get via `keys[]` |
| | `vaulter_list` | List vars with optional filter |
| | `vaulter_search` | Search by pattern or compare environments |
| | `vaulter_diff` | Quick diff without plan artifacts |
| **Status** | `vaulter_status` | scorecard, vars, audit, drift, inventory |
| **Export** | `vaulter_export` | k8s-secret, k8s-configmap, helm, terraform, env, shell, json |
| **Keys** | `vaulter_key` | generate, list, show, export, import, rotate |
| **Local Dev** | `vaulter_local` | pull, push, push-all, sync, set, delete, diff, status, shared-set, shared-delete, shared-list |
| **Backup** | `vaulter_snapshot` | create, list, restore, delete |
| | `vaulter_versions` | list, get, rollback |
| **Setup** | `vaulter_init` | Initialize project |
| | `vaulter_services` | Discover monorepo services |
| **Danger** | `vaulter_nuke` | Preview backend deletion (CLI-only execution) |

> **Tool Architecture:** Each tool is action-based (one tool per domain with `action` parameter).
> Use `vaulter_status action="scorecard"` for health checks.

### Resources (4)

| URI | Description |
|-----|-------------|
| `vaulter://instructions` | s3db.js architecture + tool overview |
| `vaulter://tools-guide` | Which tool to use for each scenario |
| `vaulter://config` | Project YAML config |
| `vaulter://services` | Monorepo services |

### Prompts (5)

`setup_project`, `deploy_secrets`, `compare_environments`, `rotation_workflow`, `local_dev_workflow`

**Full reference:** See [docs/MCP.md](docs/MCP.md)

---

## Interactive Shell (TUI)

Vaulter inclui uma interface TUI interativa construída com `tuiuiu.js`.

### Iniciar o Shell

```bash
# Abre o Secrets Explorer (padrão)
vaulter shell

# Alias alternativos
vaulter tui
vaulter ui

# Com diretório específico
vaulter shell --cwd /path/to/project

# Abrir tela específica
vaulter shell menu      # Menu principal
vaulter shell audit     # Audit Log Viewer
vaulter shell keys      # Key Manager
```

### Telas Disponíveis

| Tela | Comando | Descrição |
|------|---------|-----------|
| **Secrets Explorer** | `vaulter shell` | Visualizar/gerenciar secrets por environment e service |
| **Launcher (Menu)** | `vaulter shell menu` | Menu principal para escolher telas |
| **Audit Viewer** | `vaulter shell audit` | Visualizar logs de auditoria |
| **Key Manager** | `vaulter shell keys` | Gerenciar chaves de encriptação |

### Secrets Explorer - Hotkeys

**Navegação:**
| Tecla | Ação |
|-------|------|
| `↑` / `↓` | Navegar entre services (monorepo) |
| `j` / `k` | Navegar na lista de secrets (vim-style) |
| `tab` / `shift+tab` | Alternar entre environments |
| `1-5` | Selecionar environment por número |

**Ações:**
| Tecla | Ação |
|-------|------|
| `v` | Toggle mostrar/ocultar valores |
| `r` | Refresh (força reload do backend) |
| `d` | Deletar secret selecionado |
| `c` | Copiar secret para outro environment |
| `m` | Mover secret para outro environment |
| `enter` | Confirmar ação no modal |
| `escape` | Cancelar modal / sair |
| `q` | Sair |

**Modais (Copy/Move):**
| Tecla | Ação |
|-------|------|
| `←` / `→` | Selecionar environment destino |
| `enter` | Confirmar |
| `escape` | Cancelar |

### Features do Secrets Explorer

- **Splash screen** com loading steps animado
- **Detecção automática** de monorepo (nx, turbo, lerna, pnpm)
- **Cache local** (30 min TTL) para performance
- **Filtro por service** com herança de shared vars
- **Source tracking** (`shared`, `service`, `override`, `local`)
- **Sync status column** - mostra se local .env está sincronizado:
  - `✓` synced - valor igual ao backend
  - `≠` modified - valor diferente do backend
  - `−` missing - existe no backend mas não local
  - `+` local-only - existe apenas localmente
- **Operações locais** em arquivos `.env` (não toca backend)
- **Theme** Tokyo Night (via tuiuiu.js)

### Arquitetura TUI

```
src/cli/tui/
├── index.ts           # Exports
├── secrets-explorer.ts # Tela principal (48KB)
├── launcher.ts        # Menu principal
├── dashboard.ts       # Dashboard de secrets
├── audit-viewer.ts    # Visualizador de audit logs
└── key-manager.ts     # Gerenciador de chaves
```

---

## Monorepo vs Single Repo

Funciona para ambos cenários:

- **Single repo:** Apenas `project` + `environment`
- **Monorepo:** `project` + `environment` + `service`
- **Shared vars:** Variáveis que se aplicam a todos os services

### Shared Vars (Variáveis Compartilhadas)

Shared vars são variáveis que se aplicam a **todos os services** de um monorepo.

**CLI - Use `--shared` ou `--scope shared`:**

```bash
# Set shared var
vaulter change set LOG_LEVEL=debug -e dev --scope shared

# List all shared vars
vaulter list -e dev --shared

# Delete shared var
vaulter change delete LOG_LEVEL -e dev --scope shared
```

**MCP Tools - Use `shared: true` ou `scope: "shared"`:**

```json
// vaulter_change action="set" com scope="shared"
{ "action": "set", "key": "LOG_LEVEL", "value": "debug", "scope": "shared" }

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
vaulter local pull --all

# Pull para output específico
vaulter local pull --output web

# Dry-run (mostra o que seria escrito)
vaulter local pull --all --dry-run
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

### Section-Aware .env Management

O Vaulter usa um sistema de **seções** para preservar variáveis definidas pelo usuário:

```env
# Variáveis definidas pelo usuário (nunca tocadas pelo vaulter)
MY_LOCAL_VAR=something
CUSTOM_DEBUG=true

# --- VAULTER MANAGED (do not edit below) ---
DATABASE_URL=postgres://...
API_KEY=sk-xxx
NODE_ENV=production
# --- END VAULTER ---
```

**Comportamento:**
- ✅ Variáveis acima do marcador são **preservadas**
- ✅ Vaulter só edita a seção entre os marcadores
- ✅ Funciona com Next.js, NestJS, Express, Vite, etc.
- ✅ Compatível com qualquer biblioteca dotenv

**CLI:**
```bash
# Pull section-aware (default)
vaulter local pull --all

# Sobrescrever arquivo inteiro (ignora seções)
vaulter local pull --all --overwrite
```

**Programático:**
```typescript
import {
  parseEnvFileSections,
  syncVaulterSection,
  setInEnvFile,
  deleteFromEnvFile,
  getUserVarsFromEnvFile
} from 'vaulter'

// Sync apenas a seção do vaulter (preserva user vars)
syncVaulterSection('/path/.env', { DATABASE_URL: 'xxx', API_KEY: 'yyy' })

// Adicionar var na seção do usuário
setInEnvFile('/path/.env', 'MY_VAR', 'value', true)  // inUserSection=true

// Ler apenas vars do usuário
const userVars = getUserVarsFromEnvFile('/path/.env')
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
│   ├── local.ts       # Local overrides logic
│   ├── snapshot.ts    # Snapshots (gzip + SHA256 + manifest)
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
