# Vaulter Backends

Vaulter usa [s3db.js](https://github.com/s3db/s3db.js) como engine de armazenamento. Qualquer backend suportado pelo s3db.js funciona com vaulter — basta configurar a connection string.

## Backends Disponíveis

| Backend | Protocolo | Ideal para |
|---------|-----------|------------|
| AWS S3 | `s3://` | Produção, datasets grandes |
| S3-Compatible | `http://`, `https://` | MinIO, R2, DigitalOcean Spaces |
| SQLite local | `sqlite://` | Dev local, CI, zero infra |
| Turso / libsql | `sqlite+libsql://` | Edge, réplicas distribuídas |
| Cloudflare D1 | `sqlite+d1://` | Serverless, Workers |
| Filesystem | `file://` | Debug, offline |
| Memory | `memory://` | Testes (100-1000x mais rápido) |

## Configuração

### `config.yaml`

```yaml
backend:
  # URL única
  url: s3://ACCESS_KEY:SECRET@bucket?region=us-east-1

  # Ou múltiplas URLs com fallback (tenta em ordem, usa a primeira que conectar)
  urls:
    - s3://primary-bucket?region=us-east-1
    - s3://backup-bucket?region=us-east-1
```

> **Nota:** `urls` é para **alta disponibilidade** — o vaulter usa apenas um backend por vez (o primeiro que conectar com sucesso). Não é possível gravar em múltiplos backends simultaneamente.

## Padrão Recomendado: SQLite local + S3 em produção

A forma mais simples de usar backends diferentes por ambiente é via `config.local.yaml`, que é **carregado por cima do `config.yaml`** e deve ficar no `.gitignore`:

**`.vaulter/config.yaml`** (commitado):
```yaml
project: myproject

backend:
  url: s3://ACCESS_KEY:SECRET@tetis-vaulter?region=us-east-1

encryption:
  mode: symmetric
```

**`.vaulter/config.local.yaml`** (gitignored, cada dev tem o seu):
```yaml
backend:
  url: sqlite://${HOME}/.vaulter/myproject.db
```

Com isso:
- Dev local → SQLite, sem precisar de MinIO ou acesso à AWS
- CI/produção → S3, com as credenciais reais

### Alternativa: variável de ambiente

```bash
# Dev local
export VAULTER_BACKEND=sqlite:///tmp/myproject.db

# CI/produção (via secrets)
export VAULTER_BACKEND=s3://KEY:SECRET@bucket?region=us-east-1
```

> `VAULTER_BACKEND` só é lido pelo `loadRuntime()` (runtime loader). Para os comandos CLI, use `--backend` ou `config.local.yaml`.

## Formatos de Connection String

### AWS S3

```
s3://ACCESS_KEY:SECRET@bucket-name?region=us-east-1
s3://ACCESS_KEY:SECRET@bucket-name/path/prefix?region=us-east-1

# IAM role (sem credenciais na URL)
s3://bucket-name?region=us-east-1

# Com session token (STS)
s3://KEY:SECRET@bucket?region=us-east-1&sessionToken=TOKEN
```

### S3-Compatible (MinIO, Cloudflare R2, DigitalOcean Spaces)

```
# MinIO local
http://minioadmin:minioadmin@localhost:9000/bucket

# Cloudflare R2
https://ACCESS_KEY:SECRET@ACCOUNT_ID.r2.cloudflarestorage.com/bucket

# DigitalOcean Spaces
https://KEY:SECRET@nyc3.digitaloceanspaces.com/bucket
```

### SQLite local

```
sqlite:///absolute/path/to/database.db
sqlite://./relative/path/to/database.db

# Conveniência: home do usuário
sqlite://${HOME}/.vaulter/myproject.db
```

### Turso / libsql

```
sqlite+libsql://my-db-my-org.turso.io?authToken=TOKEN

# Self-hosted
sqlite+libsql://localhost:8080
```

### Cloudflare D1

```
sqlite+d1://ACCOUNT_ID/DATABASE_ID?apiToken=CF_API_TOKEN
```

### Filesystem (debug)

```
file:///absolute/path/to/directory
file://./relative/path
```

### Memory (testes)

```
memory://bucket-name
```

## Parâmetros de Query

Todos os backends aceitam parâmetros adicionais na query string:

```
s3://key:secret@bucket?region=us-east-1&compression.enabled=true&executorPool.concurrency=50
```

Parâmetros comuns:

| Parâmetro | Descrição |
|-----------|-----------|
| `region` | Região AWS (default: `us-east-1`) |
| `maxObjectSize` | Limite de tamanho por objeto (bytes) |
| `compression.enabled` | Habilitar compressão |
| `compression.level` | Nível de compressão (0-9) |
| `executorPool.concurrency` | Concorrência de operações |

## Criptografia

A criptografia é configurada separadamente da connection string:

```yaml
encryption:
  mode: symmetric  # Usa VAULTER_KEY_{ENV} ou VAULTER_KEY
```

A chave de criptografia nunca vai na connection string — use variáveis de ambiente:

```bash
VAULTER_KEY_PRD=chave-producao
VAULTER_KEY_DEV=chave-dev
```

Funciona com todos os backends da mesma forma.
