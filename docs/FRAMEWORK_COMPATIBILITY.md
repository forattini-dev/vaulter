# Framework Compatibility Analysis

## O Problema Real

O Vaulter já é framework-agnostic porque trabalha via `.env` files. **O problema real é**:

1. **Onde cada framework espera encontrar o `.env`?**
2. **Que naming convention cada um usa?**
3. **Como integrar com o build/dev process?**

---

## Matriz de Frameworks

### Frameworks Standalone

| Framework | Env Location | Naming Convention | Auto-load? | Notes |
|-----------|--------------|-------------------|------------|-------|
| **Next.js** | App root | `.env`, `.env.local`, `.env.development`, `.env.production` | ✅ Built-in | `.env.local` tem prioridade |
| **NestJS** | App root | `.env` | ❌ Precisa ConfigModule | `ConfigModule.forRoot()` |
| **Express** | App root | `.env` | ❌ Precisa dotenv | `require('dotenv').config()` |
| **Hono** | App root | `.env` | ❌ Manual | Depende do runtime |
| **Fastify** | App root | `.env` | ❌ Precisa plugin | `@fastify/env` ou dotenv |
| **Remix** | App root | `.env` | ✅ Built-in | Similar ao Next.js |
| **Astro** | App root | `.env` | ✅ Built-in | Similar ao Next.js |
| **SvelteKit** | App root | `.env` | ✅ Built-in | Via Vite |
| **Nuxt** | App root | `.env` | ✅ Built-in | Via Vite |

### Monorepo Tools

| Tool | Workspace Config | Package Location | Env Strategy |
|------|------------------|------------------|--------------|
| **NX** | `nx.json` | `apps/*`, `libs/*` | Per-app ou root |
| **Turborepo** | `turbo.json` | `apps/*`, `packages/*` | Per-app (recomendado) |
| **pnpm workspaces** | `pnpm-workspace.yaml` | Flexível | Per-package |
| **Yarn workspaces** | `package.json` | Flexível | Per-package |
| **Lerna** | `lerna.json` | `packages/*` | Per-package |
| **Rush** | `rush.json` | Flexível | Per-project |

---

## O Insight Chave 🎯

**Todos os frameworks leem `.env` da raiz do app/package.**

A questão é: em monorepos, cada app tem sua própria raiz!

```
monorepo/
├── apps/
│   ├── web/          ← Next.js lê .env DAQUI
│   │   ├── .env
│   │   └── package.json
│   └── api/          ← NestJS lê .env DAQUI
│       ├── .env
│       └── package.json
├── packages/
│   └── shared/
└── package.json
```

---

## Estratégias Possíveis

### Estratégia 1: Per-App Config (Current)

Cada app tem seu próprio `.vaulter/config.yaml`:

```
monorepo/
├── .vaulter/
│   └── config.yaml         ← Shared config
├── apps/
│   ├── web/
│   │   ├── .vaulter/
│   │   │   └── config.yaml ← extends: ../../../.vaulter/config.yaml
│   │   └── .env            ← vaulter pull gera aqui
│   └── api/
│       ├── .vaulter/
│       │   └── config.yaml
│       └── .env
```

**Prós:**
- ✅ Cada app controla suas vars
- ✅ Funciona com qualquer framework
- ✅ Suporta herança via `extends`

**Contras:**
- ❌ Muitos arquivos de config
- ❌ Setup inicial trabalhoso

### Estratégia 2: Root-Only + Symlinks

Config só na raiz, symlinks para os apps:

```
monorepo/
├── .vaulter/
│   ├── config.yaml
│   └── apps/
│       ├── web.env
│       └── api.env
├── apps/
│   ├── web/
│   │   └── .env → ../../.vaulter/apps/web.env
│   └── api/
│       └── .env → ../../.vaulter/apps/api.env
```

**Prós:**
- ✅ Um único local de config
- ✅ Fácil de gerenciar

**Contras:**
- ❌ Symlinks podem dar problema em Windows
- ❌ Git não rastreia symlinks bem
- ❌ Docker COPY não segue symlinks

### Estratégia 3: Root Config + Output Targets 🎯 (PROPOSTA)

**Uma config na raiz define onde cada app recebe seu .env:**

```yaml
# .vaulter/config.yaml
version: '1'
project: my-monorepo
environments: [dev, stg, prd]

services:
  web:
    type: next           # Hint opcional
    output: apps/web     # Onde gerar o .env
    vars:
      - NEXT_PUBLIC_*    # Quais vars incluir (glob)
      - API_URL

  api:
    type: nest           # Hint opcional
    output: apps/api
    vars:
      - DATABASE_*
      - REDIS_*
      - JWT_*

shared:
  vars:
    - LOG_LEVEL
    - NODE_ENV
```

**Comando:**
```bash
# Gera .env em apps/web/ e apps/api/
vaulter local pull --all

# Ou específico
vaulter local pull -s web
```

**Prós:**
- ✅ Uma única config
- ✅ Controle granular de vars por service
- ✅ Sem symlinks
- ✅ Funciona em qualquer OS
- ✅ Framework hints são opcionais

**Contras:**
- ❌ Precisa implementar

### Estratégia 4: Framework Adapters

Adapters específicos que conhecem as convenções de cada framework:

```yaml
# .vaulter/config.yaml
services:
  web:
    adapter: nextjs      # Sabe que Next usa .env.local
    output: apps/web
```

O adapter `nextjs` sabe:
- Gerar `.env.local` (não `.env`)
- Prefixar vars públicas com `NEXT_PUBLIC_`
- Gerar `.env.development` e `.env.production` se necessário

**Prós:**
- ✅ Convenções automáticas
- ✅ Menos config manual

**Contras:**
- ❌ Manutenção de muitos adapters
- ❌ Pode ser over-engineering

---

## Recomendação: Estratégia 3 + Adapters Opcionais

### MVP (Estratégia 3)

1. **Root config com services e outputs**
2. **Shared vars com herança**
3. **Glob patterns para filtrar vars**
4. **`vaulter local pull --all` gera todos**

### Fase 2 (Adapters)

1. **Adapter opcional por service**
2. **Adapters built-in**: `nextjs`, `nestjs`, `vite`, `generic`
3. **Custom adapters via config**

---

## Convenções por Framework

### Next.js

```yaml
services:
  web:
    adapter: nextjs
    output: apps/web
```

Adapter gera:
- `.env.local` (vars locais, gitignored)
- `.env.development` (dev defaults)
- `.env.production` (prd defaults)

E automaticamente:
- Prefixar vars públicas com `NEXT_PUBLIC_` se não tiverem
- Warnings se vars sensíveis não tiverem prefix (seriam expostas)

### NestJS

```yaml
services:
  api:
    adapter: nestjs
    output: apps/api
```

Adapter gera:
- `.env` simples
- Opcionalmente `.env.development`, `.env.production`

### Vite-based (SvelteKit, Nuxt, Astro)

```yaml
services:
  app:
    adapter: vite
    output: apps/app
```

Adapter gera:
- `.env.local`
- `.env.development`
- `.env.production`

E automaticamente:
- Prefixar vars públicas com `VITE_` se necessário

---

## Integração com Build/Dev

### Option A: vaulter run

```bash
# Carrega vars e executa comando
vaulter run --service web -- pnpm dev
```

### Option B: vaulter pull + framework load

```bash
# Gera .env files
vaulter local pull --all

# Framework carrega automaticamente
pnpm dev
```

### Option C: dotenv-cli wrapper

```bash
# Usa dotenv-cli que já está no ecosystem
dotenv -e <(vaulter export -f env web) -- pnpm dev
```

### Option D: Native integration (futuro)

```typescript
// next.config.ts
import { loadEnv } from 'vaulter/next'

export default loadEnv({
  service: 'web',
  environment: process.env.NODE_ENV
})
```

---

## Decisões de Design

### 1. Onde fica o `.vaulter/`?

**Opções:**
- A) Root do monorepo apenas
- B) Root + cada app
- C) Cada app apenas

**Recomendação: A (Root apenas)**

Razão: Uma fonte de verdade, menos config, mais fácil de manter.

### 2. Como identificar services?

**Opções:**
- A) Listar explicitamente no config
- B) Auto-descobrir de workspace patterns
- C) Híbrido

**Recomendação: C (Híbrido)**

```yaml
services:
  # Explícito
  web:
    output: apps/web

  # Auto-discover (futuro)
  discover:
    pattern: apps/*
    exclude: [shared, utils]
```

### 3. Como lidar com vars compartilhadas?

**Opções:**
- A) Duplicar em cada service
- B) Shared section com herança
- C) Arquivo separado

**Recomendação: B (Shared section)**

```yaml
shared:
  vars: [LOG_LEVEL, NODE_ENV]

services:
  web:
    inherit: shared  # default: true
    vars: [NEXT_PUBLIC_*]
```

### 4. Como lidar com secrets vs configs?

**Já implementado:** Pattern matching para detectar secrets.

**Adicional:** Permitir override explícito:

```yaml
services:
  web:
    secrets: [DATABASE_URL]  # Força como secret
    configs: [LOG_LEVEL]     # Força como config
```

---

## Próximos Passos

1. [ ] Implementar Estratégia 3 (Root Config + Output Targets)
2. [ ] Adicionar `services` section ao config schema
3. [ ] Implementar `vaulter local pull --all`
4. [ ] Implementar `vaulter local pull -s <name>`
5. [ ] Adicionar glob patterns para filtrar vars
6. [ ] (Fase 2) Implementar framework adapters

---

## Questões em Aberto

1. **Como lidar com vars que precisam de transformação?**
   - Ex: `API_URL` → `NEXT_PUBLIC_API_URL`
   - Adapter? Config explícita? Ambos?

2. **Como lidar com vars ambiente-específicas?**
   - Ex: `DATABASE_URL` diferente em dev/prd
   - Já resolvido via environments, mas e a geração de múltiplos .env?

3. **Integração com CI/CD?**
   - GitHub Actions secrets
   - Kubernetes secrets
   - Terraform vars

4. **Migração de projetos existentes?**
   - `vaulter scan` → `vaulter init --from-scan`?
