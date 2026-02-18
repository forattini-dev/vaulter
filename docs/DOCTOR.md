# Vaulter Doctor - Health Checks

O `vaulter doctor` é uma ferramenta de diagnóstico completa que executa **até 18 checks** para identificar problemas de configuração, performance e segurança.
`vaulter status` é um atalho de CLI para o mesmo fluxo de diagnóstico (texto + visão de risco) e mantém a saída em sintonia com `doctor`.

## Quick Start

```bash
# CLI
vaulter doctor -e dev
vaulter status -e dev

# MCP Tool
vaulter_doctor environment="dev" format="text"
vaulter_doctor environment="dev" format="json"  # saída estruturada para automação/IA

# Com service (monorepo)
vaulter doctor -e dev -s api
```

## Os Checks

### ✅ Checks Básicos (1-10)

#### 1. Config File
Verifica se `.vaulter/config.yaml` existe.

```
✓ config: found at /project/.vaulter/config.yaml
✗ config: config.yaml not found
  → Run "vaulter init" to create .vaulter/config.yaml
```

#### 2. Project Name
Verifica se o projeto está configurado.

```
✓ project: myproject
✗ project: project not set
  → Set project in config.yaml or pass project parameter
```

#### 3. Environment
Valida se o environment existe no config.

```
✓ environment: dev
⚠ environment: prd not listed in config.environments
  → Add "prd" to config.environments or use a valid environment
```

#### 4. Service (Monorepo)
Verifica se o service existe.

```
✓ service: api
⚠ service: monorepo with 5 services but no service selected
  → Use service parameter to specify which service to work with
```

#### 5. Backend URLs
Verifica configuração do backend.

```
✓ backend: 1 backend(s) configured (remote)
⚠ backend: no backend configured (using default local store)
  → Set backend.url in config.yaml to use remote storage (S3, MinIO, etc.)
```

#### 6. Encryption Keys
Verifica se chaves de encriptação existem.

```
✓ encryption: symmetric (from env)
⚠ encryption: no encryption key found
  → Set VAULTER_KEY_DEV or run "vaulter key generate -e dev"
✓ encryption: asymmetric (rsa-4096)
```

#### 7. Shared Key Environment
Verifica chave para shared variables (monorepo).

```
✓ shared-key: dev
⚠ shared-key: no key for shared_key_environment=prd
  → Set VAULTER_KEY_PRD for shared variables
```

#### 8. Local Env Files
Verifica se arquivos `.env` locais existem.

```
✓ local-files: env file present
⚠ local-files: missing local env file
  → Run "vaulter sync pull -e dev" to create local file
```

#### 9. Outputs Config
Valida configuração de outputs.

```
✓ outputs: 3 output file(s) present
⚠ outputs: 2/3 output file(s) missing
  → Run "vaulter sync pull --all" to populate outputs
○ outputs: no outputs configured
```

#### 10. Gitignore Coverage
Valida se entradas críticas do `.vaulter` estão no `.gitignore`.

```
✓ gitignore: required Vaulter entries present in .gitignore
⚠ gitignore: missing 2 required .gitignore entries (would add with --fix)
  → Run "vaulter doctor --fix" to update .gitignore
○ gitignore: project root not resolved for .gitignore checks
```

---

### ⚡ Checks Avançados (11-18)

#### 11. Backend Connection
Testa conexão com o backend e lista variáveis.

```
✓ connection: connected (15 vars in dev)
✗ connection: failed to connect
  → Check backend URL, credentials, and encryption keys
✗ connection: Operation timed out after 30000ms
  → Backend not responding, check network or increase timeout_ms
```

**O que testa:**
- Conecta ao backend (com retry automático)
- Lista variáveis do environment
- Valida que o backend está acessível

#### 12. Performance & Latency
Mede velocidade das operações no backend.

```
✓ latency: read=45ms, list=67ms
⚠ latency: operations slower than ideal (avg: 1234ms)
  → Consider using a backend in a closer region
⚠ latency: slow operations (avg: 2567ms)
  → Check network connectivity, backend region, or consider using a closer backend
```

**Thresholds:**
- **Ideal:** < 1000ms average
- **OK:** 1000-2000ms
- **Slow:** > 2000ms

**O que causa lentidão:**
- Backend em região distante (cross-region)
- Rede lenta ou com alta latência
- Backend sobrecarregado
- Rate limiting

#### 13. Write Permissions
Testa se consegue escrever, ler e deletar no backend.

```
✓ permissions: read/write/delete OK
✗ permissions: no write permissions
  → Check AWS IAM permissions or MinIO policies
⚠ permissions: write test failed: Access Denied
  → Check backend permissions and credentials
```

**O que testa:**
1. Escreve uma chave temporária `vaulter-healthcheck-*` com timestamp
2. Lê de volta para validar
3. Deleta a var de teste
4. Confirma que tudo funcionou

**Erros comuns:**
- IAM policy sem `s3:PutObject`
- MinIO policy sem `write` permission
- Bucket read-only

#### 14. Encryption Round-Trip
Valida que encriptação e descriptografia funcionam corretamente.

```
✓ encryption: round-trip successful (encrypt → decrypt → match)
✗ encryption: round-trip failed (value mismatch)
  → Wrong encryption key or corrupted data - check VAULTER_KEY
✗ encryption: round-trip failed (value not found)
  → Check encryption configuration
```

**O que testa:**
1. Encripta valor aleatório
2. Salva no backend
3. Lê de volta
4. Descriptografa
5. Compara se voltou igual

**Detecta:**
- Chave de encriptação errada (VAULTER_KEY_DEV != chave usada pra encriptar)
- Dados corrompidos no backend
- Modo de encriptação incompatível

#### 15. Sync Status
Compara variáveis locais vs remotas.

```
✓ sync-status: local and remote in sync
⚠ sync-status: 5 local-only, 3 remote-only, 2 conflicts
  → Run "vaulter sync diff -e dev --values" to see details
⚠ sync-status: 10 difference(s) detected
  → Run "vaulter sync diff -e dev" for details
○ sync-status: no local file to compare
```

**O que verifica:**
- **Local-only:** Vars que existem só no `.env` local (seriam adicionadas no push)
- **Remote-only:** Vars que existem só no backend (seriam adicionadas no pull)
- **Conflicts:** Vars que existem nos dois mas com valores diferentes

**Próximos passos:**
```bash
# Ver detalhes das diferenças
vaulter sync diff -e dev --values

# Push local para remoto
vaulter sync push -e dev

# Pull remoto para local
vaulter sync pull -e dev

# Merge (escolhe estratégia de conflito)
vaulter sync merge -e dev --strategy local
```

#### 16. Security Issues
Detecta problemas de segurança.

```
✓ security: no security issues detected
✗ security: 3 .env file(s) tracked in git: .vaulter/local/configs.env, deploy/secrets/prd.env
  → Add .env files to .gitignore immediately and remove from git history
⚠ security: weak encryption key (< 32 chars); local override file has weak permissions (644)
  → Fix security issues: generate stronger keys, fix permissions
```

**O que detecta:**

**1. Arquivos .env commitados no git** (CRÍTICO):
```bash
# Verifica se algum arquivo .env está tracked
git ls-files "*.env" ".vaulter/**/*.env"

# Se encontrar → FAIL
# Para monorepo:
git ls-files ".vaulter/local/services/*/configs.env" ".vaulter/local/services/*/secrets.env"
```

**Como corrigir:**
```bash
# 1. Adicionar ao .gitignore
echo "*.env" >> .gitignore
echo ".vaulter/local/*.env" >> .gitignore
echo ".vaulter/local/services/*/configs.env" >> .gitignore
echo ".vaulter/local/services/*/secrets.env" >> .gitignore
echo ".vaulter/deploy/secrets/*.env" >> .gitignore
echo ".vaulter/deploy/shared/secrets/*.env" >> .gitignore
echo ".vaulter/deploy/services/*/secrets/*.env" >> .gitignore

# 2. Remover do histórico do git
git rm --cached .vaulter/local/{configs,secrets}.env
git rm --cached .vaulter/deploy/secrets/*.env .vaulter/deploy/shared/secrets/*.env .vaulter/deploy/services/*/secrets/*.env
git rm --cached .vaulter/local/services/*/configs.env .vaulter/local/services/*/secrets.env
git commit -m "Remove sensitive .env files from git"

# 3. Se já foi pusheado, precisa limpar histórico
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch .vaulter/local/{configs,secrets}.env .vaulter/local/services/*/configs.env .vaulter/local/services/*/secrets.env .vaulter/deploy/secrets/*.env .vaulter/deploy/shared/secrets/*.env .vaulter/deploy/services/*/secrets/*.env' \
  --prune-empty --tag-name-filter cat -- --all
```

**2. Chave de encriptação fraca** (< 32 caracteres):
```bash
# Gerar nova chave forte
vaulter key generate -e dev

# Ou manualmente
export VAULTER_KEY_DEV=$(openssl rand -base64 32)
```

**3. Permissões de arquivo inseguras** (não 600 ou 400):
```bash
# Corrigir permissões (somente owner pode ler/escrever)
chmod 600 .vaulter/local/configs.env
chmod 600 .vaulter/local/services/${SERVICE_NAME}/configs.env
chmod 600 .vaulter/local/services/${SERVICE_NAME}/secrets.env

# Ou read-only
chmod 400 .vaulter/local/secrets.env
chmod 400 .vaulter/local/services/${SERVICE_NAME}/secrets.env
```

---

#### 17. Scope Policy Validation

Valida políticas de escopo de variáveis (shared x service) com base em regras configuráveis de domínio.

```
✓ scope-policy: no scope-policy issues detected
⚠ scope-policy: 2 scope-policy issue(s) detected
  → MAILGUN_API_KEY: expected service svc-notifications (rule mailgun-service-owned); currently targeting __shared__. MAILGUN_* variables must stay service-owned (svc-notifications)
  → APP_URL: expected shared scope (rule svc-url-shared-default); currently targeting svc-app
✗ scope-policy: 1 scope-policy issue(s) detected
  → GITHUB_TOKEN: expected service svc-repositories (rule github-service-owned); currently targeting __shared__. GITHUB_* variables should be service-owned (svc-repositories)
```

**Regras padrão:**
- `MAILGUN_*` → `svc-notifications` (service)
- `GITHUB_*` → `svc-repositories` (service)
- `SVC_*_URL` → `shared` (por padrão)

**Comportamento:**
- `warn` (padrão): o check mostra os erros sem bloquear o `doctor`
- `strict` ou `error`: o check falha se houver violações
- `off`: desativa validação

**Configuração sugerida no `config.yaml`:**

```yaml
scope_policy:
  mode: strict # off | warn | strict
  inherit_defaults: true
  rules:
    - name: api-keys-service
      pattern: '^API_'
      expected_scope: service
      expected_service: svc-app
      reason: 'API_* vars are service-owned'
```

#### 18. Perf Config
Sugestões de tunning quando o ambiente permite:

```
⚠ perf-config: performance tuning available
  → Enable S3DB cache, warmup, or increase search concurrency
○ perf-config: no performance suggestions
```

**O que sugere:**
- Cache do s3db (reduz leituras repetidas)
- Warmup do MCP (remove a latência do primeiro call)
- Concurrency do `vaulter_search` em monorepos grandes

---

## `format: "json"` (machine-readable)

Com `format: "json"`, a saída retorna um objeto estruturado com:
`project`, `service`, `environment`, `backend`, `encryption`, `environments`, `checks`, `summary`, `risk`, `suggestions`.

```json
{
  "project": "myproject",
  "service": "svc-api",
  "environment": "dev",
  "configPath": "/project/.vaulter/config.yaml",
  "backend": { "urls": ["s3://..."], "type": "remote" },
  "encryption": { "mode": "symmetric", "keyFound": true, "source": "env:VAULTER_KEY_DEV" },
  "environments": { "dev": { "varsCount": 120, "isEmpty": false } },
  "services": ["svc-api", "svc-web"],
  "checks": [{ "name": "config", "status": "ok", "details": "found at /project/.vaulter/config.yaml" }],
  "summary": { "ok": 13, "warn": 1, "fail": 1, "skip": 0, "healthy": false },
  "risk": { "score": 30, "level": "medium", "reasons": ["sync-status mismatch"] },
  "suggestions": ["Add .env files to .gitignore immediately", "Run \"vaulter sync diff -e dev --values\" to see details"]
}
```

## Output Completo - Exemplo (texto)

```
# Vaulter Doctor Report

**Project:** myproject
**Environment:** dev
**Backend:** remote (s3://mybucket/envs?region=us-east-1)
**Encryption:** symmetric (key found: true)

## Checks

✓ **config**: found at /project/.vaulter/config.yaml
✓ **project**: myproject
✓ **environment**: dev
✓ **service**: api
✓ **backend**: 1 backend(s) configured (remote)
✓ **encryption**: symmetric (from env)
✓ **shared-key**: dev
✓ **local-files**: env file present
✓ **outputs**: 3 output file(s) present
✓ **gitignore**: required Vaulter entries present in .gitignore
✓ **connection**: connected (24 vars in dev)
✓ **latency**: read=45ms, list=67ms
✓ **permissions**: read/write/delete OK
✓ **encryption**: round-trip successful (encrypt → decrypt → match)
⚠ **sync-status**: 5 local-only, 3 remote-only, 2 conflicts
  → Run "vaulter sync diff -e dev --values" to see details
✗ **security**: 2 .env file(s) tracked in git: .vaulter/local/configs.env
  → Add .env files to .gitignore immediately and remove from git history

## Summary
✓ ok: 15 | ⚠ warn: 1 | ✗ fail: 1 | ○ skip: 0

## Suggestions
- ⚠️ Fix failing checks before proceeding
- Add .env files to .gitignore immediately and remove from git history
- Run "vaulter sync diff -e dev --values" to see details
```

## Interpretando o Summary

```
✓ ok: 15 | ⚠ warn: 1 | ✗ fail: 1 | ○ skip: 0
```

- **✓ ok:** Checks que passaram - tudo certo
- **⚠ warn:** Avisos - funciona mas pode melhorar
- **✗ fail:** Falhas críticas - precisa corrigir
- **○ skip:** Checks que foram pulados (pré-requisito falhou)

**Healthy:** `fail === 0` (nenhuma falha crítica)

## Quando Usar

### 🆕 Setup Inicial
```bash
# Depois de rodar vaulter init
vaulter doctor -e dev

# Verifica:
# - Config está correto
# - Backend conecta
# - Chaves funcionam
```

### 🐛 Debugging
```bash
# Quando algo não funciona
vaulter doctor -e prd

# Identifica:
# - Problemas de conexão
# - Chaves erradas
# - Permissões faltando
```

### 🚀 Pre-Deploy
```bash
# Antes de fazer deploy
vaulter doctor -e prd

# Garante:
# - Todas as vars sincronizadas
# - Performance OK
# - Sem issues de segurança
```

### 🔄 Rotina
```bash
# Periodicamente (ex: toda semana)
vaulter doctor -e dev
vaulter doctor -e prd

# Monitora:
# - Performance degradando
# - Arquivos .env vazando pro git
# - Sync drift entre local/remoto
```

## Troubleshooting

### Check falha mas não sei o porquê

Use verbose mode:
```bash
vaulter doctor -e dev -v
```

Saída mostrará detalhes dos erros:
```
[vaulter] Trying backend: s3://****:****@mybucket
[vaulter] Connection attempt 1 failed, retrying... Connection timeout
[vaulter] Connection attempt 2 failed, retrying... Connection timeout
```

### Todos os checks passam mas operações falham

Execute checks individuais:
```bash
# Test write permissions
vaulter set TEST_VAR=123 -e dev
vaulter get TEST_VAR -e dev
vaulter delete TEST_VAR -e dev

# Test latency
time vaulter list -e dev

# Test encryption
vaulter set SECRET=xyz -e dev
vaulter get SECRET -e dev  # Should return "xyz"
```

### Doctor trava/timeout

Reduza timeout para fail-fast:
```yaml
mcp:
  timeout_ms: 5000  # 5 segundos
```

Se ainda travar, problema é no backend (não responde).

## CI/CD Integration

```yaml
# .github/workflows/vaulter-health.yml
name: Vaulter Health Check

on:
  schedule:
    - cron: '0 9 * * 1'  # Toda segunda às 9h
  workflow_dispatch:

jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Run vaulter doctor
        run: |
          npx vaulter doctor -e dev
          npx vaulter doctor -e prd
        env:
          VAULTER_KEY_DEV: ${{ secrets.VAULTER_KEY_DEV }}
          VAULTER_KEY_PRD: ${{ secrets.VAULTER_KEY_PRD }}

      - name: Check for security issues
        run: |
          # Fail if any .env files are tracked
          if git ls-files | grep -E '\.env$'; then
            echo "❌ .env files are tracked in git!"
            exit 1
          fi
```

## API Usage

```typescript
import { createClient } from 'vaulter'

const client = createClient({ connectionString: 's3://...' })
await client.connect()

// Check latency
const start = Date.now()
await client.list({ project: 'myproject', environment: 'dev', limit: 10 })
const latency = Date.now() - start
console.log(`Latency: ${latency}ms`)

// Check permissions
try {
  await client.set({
    key: '_healthcheck',
    value: 'test',
    project: 'myproject',
    environment: 'dev'
  })

  const read = await client.get('_healthcheck', 'myproject', 'dev')
  await client.delete('_healthcheck', 'myproject', 'dev')

  console.log('✓ Permissions OK')
} catch (error) {
  console.error('✗ Permission error:', error)
}

// Check encryption
const testValue = 'test-' + Math.random()
await client.set({ key: '_enc_test', value: testValue, project: 'myproject', environment: 'dev' })
const retrieved = await client.get('_enc_test', 'myproject', 'dev')
await client.delete('_enc_test', 'myproject', 'dev')

if (retrieved?.value === testValue) {
  console.log('✓ Encryption OK')
} else {
  console.error('✗ Encryption failed')
}
```

## See Also

- [Timeout Configuration](TIMEOUT.md) - Timeout e retry logic
- [MCP Tools](MCP.md) - Todos os MCP tools disponíveis
- [Security Best Practices](../README.md#security) - Práticas de segurança
