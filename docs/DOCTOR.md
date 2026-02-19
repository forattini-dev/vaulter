# Vaulter Status - Health Checks

`vaulter status` is a full diagnostic command that runs up to 18 checks to detect configuration, performance, and security issues.
In `--offline`, it validates local structure and project security without touching the backend (useful for daily development workflow).

## Quick Start

```bash
# CLI
vaulter status -e dev
vaulter status -e dev --offline

# MCP Tool
vaulter_status action="scorecard" environment="dev" format="text"
vaulter_status action="scorecard" environment="dev" format="json"  # machine-readable output for automation/AI

# With service (monorepo)
vaulter status -e dev -s api
```

## Checks

### ✅ Basic Checks (1-10)

#### 1. Config File
Verifies `.vaulter/config.yaml` exists.

```
✓ config: found at /project/.vaulter/config.yaml
✗ config: config.yaml not found
  → Run "vaulter init" to create .vaulter/config.yaml
```

#### 2. Project Name
Checks whether the project name is configured.

```
✓ project: myproject
✗ project: project not set
  → Set project in config.yaml or pass project parameter
```

#### 3. Environment
Validates whether the environment exists in config.

```
✓ environment: dev
⚠ environment: prd not listed in config.environments
  → Add "prd" to config.environments or use a valid environment
```

#### 4. Service (Monorepo)
Checks whether the service exists.

```
✓ service: api
⚠ service: monorepo with 5 services but no service selected
  → Use service parameter to specify which service to work with
```

#### 5. Backend URLs
Validates backend configuration.

```
✓ backend: 1 backend(s) configured (remote)
⚠ backend: no backend configured (using default local store)
  → Set backend.url in config.yaml to use remote storage (S3, MinIO, etc.)
```

#### 6. Encryption Keys
Checks whether encryption keys exist.

```
✓ encryption: symmetric (from env)
⚠ encryption: no encryption key found
  → Set VAULTER_KEY_DEV or run "vaulter key generate -e dev"
✓ encryption: asymmetric (rsa-4096)
```

#### 7. Shared Key Environment
Checks key settings for shared variables (monorepo).

```
✓ shared-key: dev
⚠ shared-key: no key for shared_key_environment=prd
  → Set VAULTER_KEY_PRD for shared variables
```

#### 8. Local Env Files
Checks whether local `.env` files exist.

```
✓ local-files: env file present
⚠ local-files: missing local env file
  → Run "vaulter local sync" then "vaulter local pull --all" to create local file
```

#### 9. Outputs Config
Validates output configuration.

```
✓ outputs: 3 output file(s) present
⚠ outputs: 2/3 output file(s) missing
  → Run "vaulter local pull --all" to populate outputs
○ outputs: no outputs configured
```

#### 10. Gitignore Coverage
Checks whether critical `.vaulter` entries are in `.gitignore`.

```
✓ gitignore: required Vaulter entries present in .gitignore
⚠ gitignore: missing 2 required .gitignore entries
  → Manually add missing entries to .gitignore
○ gitignore: project root not resolved for .gitignore checks
```

---

### ⚡ Advanced Checks (11-18)

#### 11. Backend Connection
Tests backend connection and variable listing.

In `--offline`, this check appears as `skip` and suggests running without offline mode.

```
✓ connection: connected (15 vars in dev)
✗ connection: failed to connect
  → Check backend URL, credentials, and encryption keys
✗ connection: Operation timed out after 30000ms
  → Backend not responding, check network or increase timeout_ms
```

What it does:
- Connects to backend (with automatic retry)
- Lists environment variables
- Confirms backend accessibility

In offline mode, `latency`, `permissions`, `encryption` round-trip, `sync-status`, and `perf-config` checks also appear as `skip` automatically.

#### 12. Performance & Latency
Measures operation speed against backend.

```
✓ latency: read=45ms, list=67ms
⚠ latency: operations slower than ideal (avg: 1234ms)
  → Consider using a backend in a closer region
⚠ latency: slow operations (avg: 2567ms)
  → Check network connectivity, backend region, or consider using a closer backend
```

Thresholds:
- **Ideal:** < 1000ms average
- **OK:** 1000-2000ms
- **Slow:** > 2000ms

Common causes:
- Backend in a distant region (cross-region)
- Slow network or high latency
- Overloaded backend
- Rate limiting

#### 13. Write Permissions
Checks read/write/delete capabilities on the backend.

```
✓ permissions: read/write/delete OK
✗ permissions: no write permissions
  → Check AWS IAM permissions or MinIO policies
⚠ permissions: write test failed: Access Denied
  → Check backend permissions and credentials
```

Validation steps:
1. Writes temporary key `vaulter-healthcheck-*` with timestamp
2. Reads it back
3. Deletes the test key
4. Confirms all operations succeed

Common errors:
- IAM policy missing `s3:PutObject`
- MinIO policy missing write permissions
- Bucket is read-only

#### 14. Encryption Round-Trip
Validates encryption and decryption correctness.

```
✓ encryption: round-trip successful (encrypt → decrypt → match)
✗ encryption: round-trip failed (value mismatch)
  → Wrong encryption key or corrupted data - check VAULTER_KEY
✗ encryption: round-trip failed (value not found)
  → Check encryption configuration
```

What it does:
1. Encrypts random value
2. Stores it on backend
3. Reads it back
4. Decrypts
5. Verifies equality

Detects:
- Wrong encryption key (`VAULTER_KEY_DEV` differs from key used to encrypt)
- Corrupted backend data
- Encryption mode mismatch

#### 15. Sync Status
Compares local and remote variables.

```
✓ sync-status: local and remote in sync
⚠ sync-status: 5 local-only, 3 remote-only, 2 conflicts
  → Run "vaulter diff -e dev --values" to see details
⚠ sync-status: 10 difference(s) detected
  → Run "vaulter diff -e dev" for details
○ sync-status: no local vars to compare
```

What it validates:
- **Local-only:** Vars that exist only in local `.env` (would be added on push)
- **Remote-only:** Vars that exist only in backend (would be added on pull)
- **Conflicts:** Vars with values in both places but different values

Next steps:
```bash
# Inspect differences
vaulter diff -e dev --values

# Push local to remote
vaulter plan -e dev && vaulter apply -e dev

# Pull remote to local
vaulter local sync -e dev && vaulter local pull --all

# Merge with a conflict strategy
vaulter plan -e dev && vaulter apply -e dev
```

#### 16. Security Issues
Detects security problems.

```
✓ security: no security issues detected
✗ security: 3 .env file(s) tracked in git: .vaulter/local/configs.env, deploy/secrets/prd.env
  → Add .env files to .gitignore immediately and remove from git history
⚠ security: weak encryption key (< 32 chars); local override file has weak permissions (644)
  → Fix security issues: generate stronger keys, fix permissions
```

What it detects:

1. `.env` files tracked by git (CRITICAL):
```bash
# Check for tracked env files
git ls-files "*.env" ".vaulter/**/*.env"

# For monorepo:
git ls-files ".vaulter/local/services/*/configs.env" ".vaulter/local/services/*/secrets.env"
```

How to fix:
```bash
# 1. Add to .gitignore
echo "*.env" >> .gitignore
echo ".vaulter/local/*.env" >> .gitignore
echo ".vaulter/local/services/*/configs.env" >> .gitignore
echo ".vaulter/local/services/*/secrets.env" >> .gitignore
echo ".vaulter/deploy/secrets/*.env" >> .gitignore
echo ".vaulter/deploy/shared/secrets/*.env" >> .gitignore
echo ".vaulter/deploy/services/*/secrets/*.env" >> .gitignore

# 2. Untrack from git
git rm --cached .vaulter/local/{configs,secrets}.env
git rm --cached .vaulter/deploy/secrets/*.env .vaulter/deploy/shared/secrets/*.env .vaulter/deploy/services/*/secrets/*.env
git rm --cached .vaulter/local/services/*/configs.env .vaulter/local/services/*/secrets.env
git commit -m "Remove sensitive .env files from git"

# 3. If already pushed, scrub history
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch .vaulter/local/{configs,secrets}.env .vaulter/local/services/*/configs.env .vaulter/local/services/*/secrets.env .vaulter/deploy/secrets/*.env .vaulter/deploy/shared/secrets/*.env .vaulter/deploy/services/*/secrets/*.env' \
  --prune-empty --tag-name-filter cat -- --all
```

2. Weak encryption key (<32 chars):
```bash
vaulter key generate -e dev
# Or
export VAULTER_KEY_DEV=$(openssl rand -base64 32)
```

3. Insecure file permissions (not 600 or 400):
```bash
chmod 600 .vaulter/local/configs.env
chmod 600 .vaulter/local/services/${SERVICE_NAME}/configs.env
chmod 600 .vaulter/local/services/${SERVICE_NAME}/secrets.env

# Or read-only
chmod 400 .vaulter/local/secrets.env
chmod 400 .vaulter/local/services/${SERVICE_NAME}/secrets.env
```

---

#### 17. Scope Policy Validation

Validates variable scope ownership (`shared` vs `service`) based on configurable domain rules.

```
✓ scope-policy: no scope-policy issues detected
⚠ scope-policy: 2 scope-policy issue(s) detected
  → MAILGUN_API_KEY: expected service svc-notifications (rule mailgun-service-owned); currently targeting __shared__. MAILGUN_* variables must stay service-owned (svc-notifications)
  → APP_URL: expected shared scope (rule svc-url-shared-default); currently targeting svc-app
✗ scope-policy: 1 scope-policy issue(s) detected
  → GITHUB_TOKEN: expected service svc-repositories (rule github-service-owned); currently targeting __shared__. GITHUB_* variables should be service-owned (svc-repositories)
```

Default rules:
- `MAILGUN_*` → `svc-notifications` (service)
- `GITHUB_*` → `svc-repositories` (service)
- `SVC_*_URL` → `shared` (default)

Behavior:
- `warn` (default): reports issues without failing `status`
- `strict` or `error`: fails when violations exist
- `off`: disables validation

Suggested config (`config.yaml`):

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
Provides tuning suggestions when possible.

```
⚠ perf-config: performance tuning available
  → Enable S3DB cache, warmup, or increase search concurrency
○ perf-config: no performance suggestions
```

Suggestions may include:
- S3DB cache (reduces repeated reads)
- MCP warmup (removes first-call latency)
- `vaulter_search` concurrency for large monorepos

---

## `format: "json"` (machine-readable)

With `format: "json"`, output returns a structured object containing:
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
  "suggestions": ["Add .env files to .gitignore immediately", "Run \"vaulter diff -e dev --values\" to see details"]
}
```

## Full Text Output Example

```
# Vaulter Status Report

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
  → Run "vaulter diff -e dev --values" to see details
✗ **security**: 2 .env file(s) tracked in git: .vaulter/local/configs.env
  → Add .env files to .gitignore immediately and remove from git history

## Summary
✓ ok: 15 | ⚠ warn: 1 | ✗ fail: 1 | ○ skip: 0

## Suggestions
- ⚠️ Fix failing checks before proceeding
- Add .env files to .gitignore immediately and remove from git history
- Run "vaulter diff -e dev --values" to see details
```

## Interpreting the Summary

```
✓ ok: 15 | ⚠ warn: 1 | ✗ fail: 1 | ○ skip: 0
```

- **✓ ok:** Checks passed.
- **⚠ warn:** Warning - should still be reviewed.
- **✗ fail:** Critical issues that should be fixed.
- **○ skip:** Checks skipped due to precondition failures.

**Healthy:** `fail === 0`

## When to Use

### 🆕 Initial Setup
```bash
# After running vaulter init
vaulter status -e dev

# Verify:
# - Config is correct
# - Backend connects
# - Keys work
```

### 🐛 Debugging
```bash
# When something breaks
vaulter status -e prd

# Identify:
# - Connection issues
# - Bad keys
# - Missing permissions
```

### 🚀 Pre-Deploy
```bash
# Before deployment
vaulter status -e prd

# Ensure:
# - Variables are synchronized
# - Performance is acceptable
# - No security issues
```

### 🔄 Routine
```bash
# Weekly check
vaulter status -e dev
vaulter status -e prd

# Track:
# - Performance degradation
# - Env files leaking into git
# - Sync drift between local and remote
```

## Troubleshooting

### A check fails and you need details

Use verbose mode:
```bash
vaulter status -e dev -v
```

Output includes detailed error context:
```
[vaulter] Trying backend: s3://****:****@mybucket
[vaulter] Connection attempt 1 failed, retrying... Connection timeout
[vaulter] Connection attempt 2 failed, retrying... Connection timeout
```

### All checks pass but operations still fail

Run checks individually:
```bash
# Test write permissions
vaulter change set TEST_VAR=123 -e dev
vaulter list -e dev --filter TEST_VAR
vaulter change delete TEST_VAR -e dev

# Test latency
time vaulter list -e dev

# Test encryption
vaulter change set SECRET=xyz -e dev
vaulter list -e dev --filter SECRET  # Should return "xyz"
```

### Status stalls or times out

Reduce timeout for fail-fast:
```yaml
mcp:
  timeout_ms: 5000  # 5 seconds
```

If it still hangs, the issue is likely backend-related.

## CI/CD Integration

```yaml
# .github/workflows/vaulter-health.yml
name: Vaulter Health Check

on:
  schedule:
    - cron: '0 9 * * 1'  # Every Monday at 9:00
  workflow_dispatch:

jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run vaulter status
        run: |
          npx vaulter status -e dev
          npx vaulter status -e prd
        env:
          VAULTER_KEY_DEV: ${{ secrets.VAULTER_KEY_DEV }}
          VAULTER_KEY_PRD: ${{ secrets.VAULTER_KEY_PRD }}

      - name: Check for security issues
        run: |
          # Fail if any .env files are tracked in git
          if git ls-files | grep -E '\\.env$'; then
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

- [Timeout Configuration](TIMEOUT.md) - Timeout and retry settings
- [MCP Tools](MCP.md) - All available MCP tools
- [Security Best Practices](../README.md#security) - Security guidance
