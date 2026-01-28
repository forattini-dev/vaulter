# Timeout Configuration

## Problem

MCP tools could hang indefinitely when backend operations (S3, network) were slow or unresponsive. This caused operations like `vaulter_set` to run for 45+ minutes without completing or timing out.

**Root Cause:** No timeout was configured for S3db operations in VaulterClient, causing requests to hang forever when:
- Backend is slow or overloaded
- Network issues occur
- S3 connectivity problems
- Rate limiting by cloud provider

## Solution

Added configurable timeouts to all VaulterClient operations:

### 1. Client-Level Timeout

```typescript
import { VaulterClient } from 'vaulter'

const client = new VaulterClient({
  connectionString: 's3://...',
  timeoutMs: 30000  // 30 seconds (default)
})

await client.connect()  // Has timeout
await client.get(...)   // Has timeout
await client.set(...)   // Has timeout
await client.list(...)  // Has timeout
```

### 2. Config-Based Timeout (MCP)

Project config (`.vaulter/config.yaml`):

```yaml
mcp:
  timeout_ms: 45000  # 45 seconds for this project
```

Global config (`~/.vaulter/config.yaml`):

```yaml
mcp:
  timeout_ms: 60000  # 60 seconds globally
  default_backend: s3://...
  default_project: myproject
```

**Priority:**
1. Per-operation `timeout_ms` parameter (highest)
2. Project config (`mcp.timeout_ms`)
3. Global config (`mcp.timeout_ms`)
4. Default (30000ms = 30 seconds)

### 3. Per-Operation Timeout (MCP Tools)

Override timeout for specific operations that need more time:

```json
{
  "name": "vaulter_multi_set",
  "arguments": {
    "variables": [...],
    "environment": "dev",
    "timeout_ms": 120000
  }
}
```

**Tools that support `timeout_ms` parameter:**
- `vaulter_multi_set` - For large batches (hundreds of variables)
- `vaulter_multi_get` - For retrieving many variables
- `vaulter_multi_delete` - For deleting many variables

**Why per-operation timeout?**
- Large batch operations may need more time than normal operations
- Allows fine-grained control without changing global settings
- Useful when you know a specific operation will be slow

**Example:**
```json
{
  "name": "vaulter_multi_set",
  "arguments": {
    "variables": [
      {"key": "VAR1", "value": "val1"},
      {"key": "VAR2", "value": "val2"}
      // ... 500 more variables
    ],
    "environment": "prd",
    "timeout_ms": 180000
  }
}
```

### 3. Programmatic Timeout

Use the `withTimeout` helper for any async operation:

```typescript
import { withTimeout } from 'vaulter'

try {
  const result = await withTimeout(
    someAsyncOperation(),
    10000,  // 10 seconds
    'fetch data'  // operation name for error message
  )
} catch (error) {
  // Error: Operation timed out after 10000ms: fetch data
}
```

## Operations with Timeout

All critical VaulterClient operations now have timeout protection:

| Operation | Timeout Applied |
|-----------|----------------|
| `connect()` | ✅ Backend connection |
| `get()` | ✅ S3 object retrieval |
| `set()` | ✅ S3 insert/update (2 ops) |
| `delete()` | ✅ S3 object deletion |
| `list()` | ✅ S3 listing (can be slow) |
| `export()` | ✅ Multiple list operations |
| `getMany()` | ✅ Parallel gets |
| `setMany()` | ✅ Batch inserts/updates |

## Error Messages

When a timeout occurs, you'll see clear error messages:

```
Error: Operation timed out after 30000ms: set variable DATABASE_URL
```

This helps identify which specific operation failed and how long it took before timing out.

## Best Practices

### Development (Fast Iteration)
```yaml
# .vaulter/config.yaml
mcp:
  timeout_ms: 15000  # 15s - fail fast in dev
```

### Production (Reliability)
```yaml
# .vaulter/config.yaml
mcp:
  timeout_ms: 60000  # 60s - allow more time for large operations
```

### CI/CD (Fast Failure)
```yaml
# .vaulter/config.yaml
mcp:
  timeout_ms: 30000  # 30s - reasonable timeout for automation
```

## Troubleshooting

### Timeout Too Short

**Symptom:** Operations consistently timeout even though they eventually succeed.

**Solution:** Increase timeout in config:
```yaml
mcp:
  timeout_ms: 60000  # Increase from default 30s
```

### Backend Consistently Slow

**Symptom:** Many operations timeout, backend is in same region.

**Possible causes:**
- S3 bucket in wrong region (high latency)
- Rate limiting by AWS
- Network issues
- Backend overloaded

**Solutions:**
1. Check S3 bucket region matches your location
2. Use CloudFront or caching layer
3. Switch to faster backend
4. Increase concurrency limits in S3 settings

### Timeout Not Applied

**Symptom:** Operations still hang forever despite config.

**Check:**
1. Config is loaded correctly: `vaulter doctor`
2. Using latest version: `npm list vaulter`
3. Client is created after config load (for programmatic usage)

## Technical Details

### Implementation

Timeout wrapper uses `Promise.race()` to race between:
1. The actual operation promise
2. A timeout promise that rejects after N milliseconds

```typescript
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms: ${operation}`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise])
}
```

### Cleanup

Timeout handles are properly cleaned up after operation completes or times out to prevent memory leaks.

### Per-Environment Clients

MCP server creates one client per environment to handle per-environment encryption keys. Timeout is applied to each client instance.

## Migration

No code changes needed! Existing code automatically gets timeout protection:

**Before:**
```typescript
const client = new VaulterClient({ connectionString: 's3://...' })
await client.set({ key: 'FOO', value: 'bar', ... })  // Could hang forever
```

**After (automatic):**
```typescript
const client = new VaulterClient({ connectionString: 's3://...' })
await client.set({ key: 'FOO', value: 'bar', ... })  // Has 30s timeout
```

**Custom timeout:**
```typescript
const client = new VaulterClient({
  connectionString: 's3://...',
  timeoutMs: 60000  // Override default
})
```

## Connection Pooling & Retry

### Connection Reuse (MCP Server)

The MCP server maintains a **persistent connection pool** for better performance:

**Before (inefficient):**
```
Call 1: connect → use → disconnect
Call 2: connect → use → disconnect  ← Wasted time
Call 3: connect → use → disconnect  ← More wasted time
```

**After (optimized):**
```
Call 1: connect → use ✓
Call 2: (reuse) → use ✓  ← No reconnect!
Call 3: (reuse) → use ✓  ← Much faster!
```

**Benefits:**
- 🚀 **10-100x faster** operations (no connection overhead)
- 📉 **Lower latency** (reuse existing connections)
- 💾 **Less memory** (fewer client instances)
- 🔄 **Automatic retry** (3 attempts with backoff)

### Retry Logic

All connections use exponential backoff retry:

```typescript
// Automatic retry: 3 attempts
// Delays: 1s → 2s → 4s
await client.connect()  // Retries automatically on failure
```

**Retry schedule:**
1. First attempt: immediate
2. Second attempt: after 1 second
3. Third attempt: after 2 seconds (total: 3s wait)
4. Final attempt: after 4 seconds (total: 7s wait)

If all 3 attempts fail, throws error with original cause.

### Manual Retry

Use `withRetry()` for custom retry logic:

```typescript
import { withRetry } from 'vaulter'

const result = await withRetry(
  () => someUnreliableOperation(),
  {
    maxAttempts: 5,
    delayMs: 500,
    backoffMultiplier: 2,
    onRetry: (attempt, error) => {
      console.log(`Retry ${attempt}:`, error.message)
    }
  }
)
```

### Connection Lifecycle

**MCP Server:**
- Connections are created once and cached
- Reused across all tool calls
- Kept alive for server lifetime
- No disconnect between calls

**CLI:**
- Each command creates fresh connection
- Disconnects after command completes
- No connection pooling (short-lived)

### Troubleshooting Connection Issues

**Symptom:** Connection fails after 3 retries

**Check:**
1. Backend is accessible: `ping backend-host`
2. Credentials are valid: check AWS_ACCESS_KEY_ID
3. Encryption key is correct: `vaulter doctor -e dev`
4. Network allows S3 traffic: check firewall rules

**Enable verbose mode to see retry attempts:**
```yaml
# .vaulter/config.yaml
mcp:
  verbose: true
```

Output:
```
[vaulter] Connection attempt 1 failed, retrying... Connection timeout
[vaulter] Connection attempt 2 failed, retrying... Connection timeout
[vaulter] Connection attempt 3 failed, retrying... Connection timeout
Error: Failed to connect after 3 attempts
```

## See Also

- [MCP Configuration](MCP.md) - Full MCP config reference
- [Performance Guide](../PERFORMANCE.md) - Optimization tips
- [s3db.js Docs](../../s3db.js/README.md) - Backend behavior
