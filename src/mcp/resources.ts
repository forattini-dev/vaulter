/**
 * Vaulter MCP Resources
 *
 * Resource definitions and handlers for the MCP server
 *
 * Resources:
 *   vaulter://instructions         → CRITICAL: How vaulter works (READ THIS FIRST!)
 *   vaulter://config               → Current project configuration
 *   vaulter://services             → List of services in monorepo
 *   vaulter://keys                 → List all encryption keys
 *   vaulter://keys/<name>          → Show specific key info
 *   vaulter://project/env          → Environment variables for project/env
 *   vaulter://project/env/service  → Environment variables for service
 *   vaulter://compare/env1/env2    → Comparison between two environments
 */

import type { Resource } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import { VaulterClient } from '../client.js'
import {
  loadConfig,
  loadEncryptionKey,
  loadPublicKey,
  loadPrivateKey,
  getEncryptionMode,
  getAsymmetricAlgorithm,
  findConfigDir,
  getProjectKeysDir,
  getGlobalKeysDir
} from '../lib/config-loader.js'
import { detectAlgorithm } from '../lib/crypto.js'
import type { Environment, VaulterConfig, AsymmetricAlgorithm } from '../types.js'
import { DEFAULT_ENVIRONMENTS } from '../types.js'
import { resolveBackendUrls } from '../index.js'

/**
 * Get current config and client
 * Supports both symmetric and asymmetric encryption modes
 */
async function getClientAndConfig(): Promise<{ client: VaulterClient; config: VaulterConfig | null }> {
  let config: VaulterConfig | null = null
  try {
    config = loadConfig()
  } catch {
    // Config not found is OK
  }

  const connectionStrings = config ? resolveBackendUrls(config) : []

  // Determine encryption mode
  const encryptionMode = config ? getEncryptionMode(config) : 'symmetric'

  // For asymmetric mode, load public/private keys
  if (encryptionMode === 'asymmetric' && config) {
    const publicKey = await loadPublicKey(config, config.project)
    const privateKey = await loadPrivateKey(config, config.project)
    const algorithm = getAsymmetricAlgorithm(config) as AsymmetricAlgorithm

    const client = new VaulterClient({
      connectionStrings: connectionStrings.length > 0 ? connectionStrings : undefined,
      encryptionMode: 'asymmetric',
      publicKey: publicKey || undefined,
      privateKey: privateKey || undefined,
      asymmetricAlgorithm: algorithm
    })

    return { client, config }
  }

  // Symmetric mode (default)
  const passphrase = config ? await loadEncryptionKey(config) : undefined

  const client = new VaulterClient({
    connectionStrings: connectionStrings.length > 0 ? connectionStrings : undefined,
    encryptionMode: 'symmetric',
    passphrase: passphrase || undefined
  })

  return { client, config }
}

/**
 * Parse a vaulter:// URI
 *
 * Formats:
 *   vaulter://config
 *   vaulter://services
 *   vaulter://keys
 *   vaulter://keys/<name>
 *   vaulter://project/environment
 *   vaulter://project/environment/service
 *   vaulter://compare/env1/env2
 */
type ParsedUri =
  | { type: 'instructions' }
  | { type: 'config' }
  | { type: 'services' }
  | { type: 'keys' }
  | { type: 'key'; name: string; global?: boolean }
  | { type: 'env'; project: string; environment: Environment; service?: string }
  | { type: 'compare'; env1: Environment; env2: Environment }
  | null

function parseResourceUri(uri: string): ParsedUri {
  // vaulter://instructions (CRITICAL - must read first!)
  if (uri === 'vaulter://instructions') {
    return { type: 'instructions' }
  }

  // vaulter://config
  if (uri === 'vaulter://config') {
    return { type: 'config' }
  }

  // vaulter://services
  if (uri === 'vaulter://services') {
    return { type: 'services' }
  }

  // vaulter://keys (list all)
  if (uri === 'vaulter://keys') {
    return { type: 'keys' }
  }

  // vaulter://keys/<name> or vaulter://keys/global/<name>
  const keyMatch = uri.match(/^vaulter:\/\/keys\/(?:(global)\/)?([^/]+)$/)
  if (keyMatch) {
    const [, isGlobal, name] = keyMatch
    return { type: 'key', name, global: isGlobal === 'global' }
  }

  // vaulter://compare/env1/env2
  // Accept any environment names (custom envs supported)
  const compareMatch = uri.match(/^vaulter:\/\/compare\/([^/]+)\/([^/]+)$/)
  if (compareMatch) {
    const [, env1, env2] = compareMatch
    return { type: 'compare', env1: env1 as Environment, env2: env2 as Environment }
  }

  // vaulter://project/environment[/service]
  // Accept any environment name (custom envs supported)
  const envMatch = uri.match(/^vaulter:\/\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/)
  if (envMatch) {
    const [, project, env, service] = envMatch
    return {
      type: 'env',
      project,
      environment: env as Environment,
      service
    }
  }

  return null
}

/**
 * Discover services in a monorepo
 * Looks for directories with .vaulter/config.yaml or deploy/configs or deploy/secrets
 */
function discoverServices(rootDir: string): Array<{ name: string; path: string; hasVaulterConfig: boolean }> {
  const services: Array<{ name: string; path: string; hasVaulterConfig: boolean }> = []

  // Common monorepo patterns
  const searchDirs = ['apps', 'services', 'packages', 'libs']

  for (const dir of searchDirs) {
    const fullPath = path.join(rootDir, dir)
    if (!fs.existsSync(fullPath)) continue

    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const servicePath = path.join(fullPath, entry.name)

        // Check for vaulter config
        const hasVaulterConfig = fs.existsSync(path.join(servicePath, '.vaulter', 'config.yaml'))

        // Check for deploy/configs or deploy/secrets (split mode pattern)
        const hasDeployConfigs = fs.existsSync(path.join(servicePath, 'deploy', 'configs'))
        const hasDeploySecrets = fs.existsSync(path.join(servicePath, 'deploy', 'secrets'))

        if (hasVaulterConfig || hasDeployConfigs || hasDeploySecrets) {
          services.push({
            name: entry.name,
            path: servicePath,
            hasVaulterConfig
          })
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return services
}

/**
 * List available resources
 * Returns resources for config, services, and each project/environment combination
 */
export async function listResources(): Promise<Resource[]> {
  const { config } = await getClientAndConfig()
  const resources: Resource[] = []

  // CRITICAL: Instructions resource - MUST BE READ FIRST
  resources.push({
    uri: 'vaulter://instructions',
    name: '⚠️ CRITICAL: How Vaulter Works',
    description: 'IMPORTANT: Read this FIRST before using any vaulter tools. Explains how data is stored and what NOT to do.',
    mimeType: 'text/markdown'
  })

  // Always include config resource
  resources.push({
    uri: 'vaulter://config',
    name: 'Project Configuration',
    description: 'Current vaulter project configuration (from .vaulter/config.yaml)',
    mimeType: 'application/yaml'
  })

  // Always include services resource (even if empty)
  resources.push({
    uri: 'vaulter://services',
    name: 'Monorepo Services',
    description: 'List of services discovered in this monorepo',
    mimeType: 'application/json'
  })

  // Always include keys resource
  resources.push({
    uri: 'vaulter://keys',
    name: 'Encryption Keys',
    description: 'List all encryption keys (project and global)',
    mimeType: 'application/json'
  })

  if (!config?.project) {
    return resources
  }

  const project = config.project
  const environments = config.environments || DEFAULT_ENVIRONMENTS
  const service = config.service

  // Add environment resources
  for (const env of environments) {
    const uri = service
      ? `vaulter://${project}/${env}/${service}`
      : `vaulter://${project}/${env}`

    resources.push({
      uri,
      name: `${project}/${env}${service ? `/${service}` : ''}`,
      description: `Environment variables for ${project} in ${env}`,
      mimeType: 'text/plain'
    })
  }

  // Add comparison resources for common pairs
  const comparisonPairs: Array<[Environment, Environment]> = [
    ['dev', 'stg'],
    ['stg', 'prd'],
    ['dev', 'prd']
  ]

  for (const [env1, env2] of comparisonPairs) {
    if (environments.includes(env1) && environments.includes(env2)) {
      resources.push({
        uri: `vaulter://compare/${env1}/${env2}`,
        name: `Compare ${env1} vs ${env2}`,
        description: `Comparison of variables between ${env1} and ${env2} environments`,
        mimeType: 'text/plain'
      })
    }
  }

  return resources
}

/**
 * Read a resource by URI
 */
export async function handleResourceRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const parsed = parseResourceUri(uri)

  if (!parsed) {
    throw new Error(`Invalid resource URI: ${uri}. Expected format: vaulter://config, vaulter://services, vaulter://project/environment, or vaulter://compare/env1/env2`)
  }

  switch (parsed.type) {
    case 'instructions':
      return handleInstructionsRead(uri)
    case 'config':
      return handleConfigRead(uri)
    case 'services':
      return handleServicesRead(uri)
    case 'keys':
      return handleKeysRead(uri)
    case 'key':
      return handleKeyRead(uri, parsed.name, parsed.global)
    case 'compare':
      return handleCompareRead(uri, parsed.env1, parsed.env2)
    case 'env':
      return handleEnvRead(uri, parsed.project, parsed.environment, parsed.service)
  }
}

/**
 * Read instructions resource - CRITICAL: How vaulter works
 */
async function handleInstructionsRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const instructions = `# ⚠️ CRITICAL: How Vaulter Works

## Data Storage Architecture

Vaulter uses **s3db.js** internally, which stores data in **S3 OBJECT METADATA**,
NOT in the object body. This is crucial to understand before using any tools.

## ❌ NEVER DO THESE THINGS

1. **NEVER upload files directly to S3**
   \`\`\`bash
   # ❌ WRONG - This creates empty/corrupted data
   aws s3 cp .env s3://bucket/path/file.json
   \`\`\`

2. **NEVER create JSON files manually in S3**
   \`\`\`bash
   # ❌ WRONG - s3db.js doesn't read the object body
   echo '{"KEY": "value"}' | aws s3 cp - s3://bucket/path/vars.json
   \`\`\`

3. **NEVER modify S3 objects using AWS CLI/SDK directly**

## ✅ ALWAYS USE VAULTER CLI

\`\`\`bash
# Push local .env to backend
npx vaulter push -e dev

# Pull from backend to local .env
npx vaulter pull -e dev

# Set individual variable
npx vaulter set DATABASE_URL="postgres://..." -e dev

# Bidirectional sync
npx vaulter sync -e dev

# List variables
npx vaulter list -e dev
\`\`\`

## How s3db.js Stores Data

- Each variable is stored as an S3 object
- The **value is encrypted** and stored in \`x-amz-meta-*\` headers
- The object **body is empty** (or contains overflow data for very large values)
- Keys, project, environment are stored as metadata fields

## Diagnosing Issues

If you see **empty metadata** (\`"Metadata": {}\`) when inspecting S3 objects:
\`\`\`bash
aws s3api head-object --bucket my-bucket --key path/to/object
\`\`\`

This means the data was uploaded WRONG (manually), not through vaulter.

## Correct Workflow

1. **Initialize project**: \`npx vaulter init\`
2. **Generate key**: \`npx vaulter key generate\`
3. **Set variables**: \`npx vaulter set KEY=value -e dev\`
4. **Or push existing .env**: \`npx vaulter push -e dev\`
5. **Pull to new machine**: \`npx vaulter pull -e dev\`

Never bypass the CLI. The CLI handles encryption, metadata formatting, and s3db.js protocol.

---

## 🔧 MCP Server Configuration

### Option 1: Use Project Config (Recommended)

Configure MCP with \`--cwd\` to point to your project directory:

\`\`\`json
{
  "vaulter": {
    "command": "npx",
    "args": ["vaulter", "mcp", "--cwd", "/path/to/your/project"]
  }
}
\`\`\`

The MCP will automatically read \`.vaulter/config.yaml\` from that directory.

### Option 2: Direct Backend Override

\`\`\`json
{
  "vaulter": {
    "command": "npx",
    "args": ["vaulter", "mcp", "--backend", "s3://your-bucket"]
  }
}
\`\`\`

### Option 3: Project MCP Config (Recommended for teams)

Add \`mcp:\` section to your project's \`.vaulter/config.yaml\`:

\`\`\`yaml
# .vaulter/config.yaml (in your project)
version: "1"
project: apps-lair

mcp:
  default_backend: s3://tetis-vaulter
  default_project: apps-lair
  default_environment: dev
\`\`\`

Then configure MCP with \`cwd\` pointing to your project:

\`\`\`json
{
  "vaulter": {
    "command": "npx",
    "args": ["vaulter", "mcp"],
    "cwd": "/path/to/your/project"
  }
}
\`\`\`

### Option 4: Global MCP Config (User-level defaults)

Create \`~/.vaulter/config.yaml\` with global MCP defaults:

\`\`\`yaml
# ~/.vaulter/config.yaml (global)
mcp:
  default_backend: s3://your-bucket
  default_project: your-project
  default_environment: dev
\`\`\`

### Priority Order

Backend resolution priority (first match wins):
1. CLI \`--backend\` flag
2. Project config backend (\`.vaulter/config.yaml\` → \`backend.url\`)
3. Project MCP config (\`.vaulter/config.yaml\` → \`mcp.default_backend\`)
4. Global MCP config (\`~/.vaulter/config.yaml\` → \`mcp.default_backend\`)
5. Default (\`file://$HOME/.vaulter/store\`)
`

  return {
    contents: [{
      uri,
      mimeType: 'text/markdown',
      text: instructions
    }]
  }
}

/**
 * Read config resource
 */
async function handleConfigRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const configDir = findConfigDir()

  if (!configDir) {
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: '# No .vaulter directory found\n# Run `vaulter init` to create a new project'
      }]
    }
  }

  const configPath = path.join(configDir, 'config.yaml')

  if (!fs.existsSync(configPath)) {
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: '# No config.yaml found in .vaulter directory\n# Run `vaulter init` to create a new project'
      }]
    }
  }

  const content = fs.readFileSync(configPath, 'utf-8')

  return {
    contents: [{
      uri,
      mimeType: 'application/yaml',
      text: `# Vaulter Configuration\n# Path: ${configPath}\n\n${content}`
    }]
  }
}

/**
 * Read services resource
 */
async function handleServicesRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const cwd = process.cwd()
  const services = discoverServices(cwd)

  if (services.length === 0) {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          discovered: false,
          message: 'No services found. This may not be a monorepo or services are not configured.',
          searchedDirs: ['apps', 'services', 'packages', 'libs'],
          hint: 'Services are detected by .vaulter/config.yaml or deploy/configs or deploy/secrets directories'
        }, null, 2)
      }]
    }
  }

  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        discovered: true,
        count: services.length,
        services: services.map(s => ({
          name: s.name,
          path: s.path,
          configured: s.hasVaulterConfig
        }))
      }, null, 2)
    }]
  }
}

/**
 * Read keys resource - list all encryption keys
 */
async function handleKeysRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  let config: VaulterConfig | null = null
  try {
    config = loadConfig()
  } catch {
    // Config not found is OK
  }

  const projectKeysDir = config?.project ? getProjectKeysDir(config.project) : null
  const globalKeysDir = getGlobalKeysDir()

  interface KeyInfo {
    name: string
    scope: 'project' | 'global'
    type: 'symmetric' | 'asymmetric'
    algorithm?: string
    path: string
  }

  const keys: KeyInfo[] = []

  // Scan project keys
  if (projectKeysDir && fs.existsSync(projectKeysDir)) {
    try {
      const files = fs.readdirSync(projectKeysDir)
      for (const file of files) {
        if (file.endsWith('.key') || file.endsWith('.pub') || file.endsWith('.pem')) {
          const keyPath = path.join(projectKeysDir, file)
          const baseName = file.replace(/\.(key|pub|pem)$/, '')

          // Skip if already added (e.g., .key and .pub for same key)
          if (keys.some(k => k.name === baseName && k.scope === 'project')) continue

          try {
            const content = fs.readFileSync(keyPath, 'utf-8')
            const isAsymmetric = content.includes('BEGIN') && content.includes('KEY')
            const algorithm = isAsymmetric ? (detectAlgorithm(content) || undefined) : undefined

            keys.push({
              name: baseName,
              scope: 'project',
              type: isAsymmetric ? 'asymmetric' : 'symmetric',
              algorithm,
              path: keyPath
            })
          } catch {
            // Skip unreadable keys
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  // Scan global keys
  if (fs.existsSync(globalKeysDir)) {
    try {
      const files = fs.readdirSync(globalKeysDir)
      for (const file of files) {
        if (file.endsWith('.key') || file.endsWith('.pub') || file.endsWith('.pem')) {
          const keyPath = path.join(globalKeysDir, file)
          const baseName = file.replace(/\.(key|pub|pem)$/, '')

          // Skip if already added
          if (keys.some(k => k.name === baseName && k.scope === 'global')) continue

          try {
            const content = fs.readFileSync(keyPath, 'utf-8')
            const isAsymmetric = content.includes('BEGIN') && content.includes('KEY')
            const algorithm = isAsymmetric ? (detectAlgorithm(content) || undefined) : undefined

            keys.push({
              name: baseName,
              scope: 'global',
              type: isAsymmetric ? 'asymmetric' : 'symmetric',
              algorithm,
              path: keyPath
            })
          } catch {
            // Skip unreadable keys
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  if (keys.length === 0) {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          found: false,
          message: 'No encryption keys found',
          projectKeysDir,
          globalKeysDir,
          hint: 'Use vaulter_key_generate tool to create a new key'
        }, null, 2)
      }]
    }
  }

  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        found: true,
        count: keys.length,
        project: config?.project || null,
        projectKeysDir,
        globalKeysDir,
        keys: keys.map(k => ({
          name: k.name,
          scope: k.scope,
          type: k.type,
          algorithm: k.algorithm,
          uri: k.scope === 'global'
            ? `vaulter://keys/global/${k.name}`
            : `vaulter://keys/${k.name}`
        }))
      }, null, 2)
    }]
  }
}

/**
 * Read specific key resource
 */
async function handleKeyRead(
  uri: string,
  name: string,
  global?: boolean
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  let config: VaulterConfig | null = null
  try {
    config = loadConfig()
  } catch {
    // Config not found is OK for global keys
  }

  // Determine key directory
  let keyDir: string
  if (global) {
    keyDir = getGlobalKeysDir()
  } else {
    if (!config?.project) {
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            error: 'No project configured',
            hint: 'Use --global flag for global keys or run vaulter init to configure a project'
          }, null, 2)
        }]
      }
    }
    keyDir = getProjectKeysDir(config.project)
  }

  // Check if key exists (try different extensions)
  const extensions = ['.key', '.pem', '.pub']
  let keyPath: string | null = null
  let keyContent: string | null = null

  for (const ext of extensions) {
    const tryPath = path.join(keyDir, `${name}${ext}`)
    if (fs.existsSync(tryPath)) {
      keyPath = tryPath
      try {
        keyContent = fs.readFileSync(tryPath, 'utf-8')
      } catch {
        // Continue to next extension
      }
      break
    }
  }

  if (!keyPath || !keyContent) {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          error: `Key not found: ${name}`,
          scope: global ? 'global' : 'project',
          searchedDir: keyDir,
          hint: 'Use vaulter://keys to list available keys'
        }, null, 2)
      }]
    }
  }

  // Analyze key
  const isAsymmetric = keyContent.includes('BEGIN') && keyContent.includes('KEY')
  const keyType = isAsymmetric ? 'asymmetric' : 'symmetric'
  const algorithm = isAsymmetric ? (detectAlgorithm(keyContent) || undefined) : undefined
  const stats = fs.statSync(keyPath)

  // For asymmetric keys, check for public key pair
  let publicKeyPath: string | null = null
  let hasPublicKey = false
  if (isAsymmetric) {
    const pubPath = path.join(keyDir, `${name}.pub`)
    if (fs.existsSync(pubPath)) {
      publicKeyPath = pubPath
      hasPublicKey = true
    }
  }

  // Mask the key content for security (show only structure)
  let maskedContent: string
  if (!isAsymmetric) {
    // For symmetric keys, show length and hash info
    const keyLength = keyContent.trim().length
    maskedContent = `[Symmetric key: ${keyLength} characters]`
  } else {
    // For asymmetric keys, show header/footer only
    const lines = keyContent.trim().split('\n')
    if (lines.length > 2) {
      maskedContent = `${lines[0]}\n[... ${lines.length - 2} lines ...]\n${lines[lines.length - 1]}`
    } else {
      maskedContent = '[Asymmetric key content]'
    }
  }

  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        name,
        scope: global ? 'global' : 'project',
        project: global ? null : config?.project,
        type: keyType,
        algorithm: algorithm || 'aes-256-gcm',
        path: keyPath,
        publicKeyPath: hasPublicKey ? publicKeyPath : undefined,
        hasPublicKey,
        size: stats.size,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        preview: maskedContent
      }, null, 2)
    }]
  }
}

/**
 * Read environment comparison resource
 */
async function handleCompareRead(
  uri: string,
  env1: Environment,
  env2: Environment
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const { client, config } = await getClientAndConfig()

  if (!config?.project) {
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: '# No project configured\n# Run `vaulter init` to create a new project'
      }]
    }
  }

  const project = config.project
  const service = config.service

  try {
    await client.connect()

    const [vars1, vars2] = await Promise.all([
      client.export(project, env1, service),
      client.export(project, env2, service)
    ])

    const allKeys = new Set([...Object.keys(vars1), ...Object.keys(vars2)])
    const sorted = Array.from(allKeys).sort()

    const onlyIn1: string[] = []
    const onlyIn2: string[] = []
    const different: string[] = []
    const same: string[] = []

    for (const key of sorted) {
      const v1 = vars1[key]
      const v2 = vars2[key]

      if (v1 !== undefined && v2 === undefined) {
        onlyIn1.push(key)
      } else if (v1 === undefined && v2 !== undefined) {
        onlyIn2.push(key)
      } else if (v1 !== v2) {
        different.push(key)
      } else {
        same.push(key)
      }
    }

    const lines: string[] = [
      `# Comparison: ${env1} vs ${env2}`,
      `# Project: ${project}${service ? `/${service}` : ''}`,
      '',
      `Total keys: ${allKeys.size}`,
      `  Same: ${same.length}`,
      `  Different: ${different.length}`,
      `  Only in ${env1}: ${onlyIn1.length}`,
      `  Only in ${env2}: ${onlyIn2.length}`,
      ''
    ]

    if (onlyIn1.length > 0) {
      lines.push(`## Only in ${env1}`)
      for (const key of onlyIn1) {
        lines.push(`  ${key}`)
      }
      lines.push('')
    }

    if (onlyIn2.length > 0) {
      lines.push(`## Only in ${env2}`)
      for (const key of onlyIn2) {
        lines.push(`  ${key}`)
      }
      lines.push('')
    }

    if (different.length > 0) {
      lines.push(`## Different values`)
      for (const key of different) {
        lines.push(`  ${key}:`)
        lines.push(`    ${env1}: ${maskValue(vars1[key])}`)
        lines.push(`    ${env2}: ${maskValue(vars2[key])}`)
      }
      lines.push('')
    }

    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: lines.join('\n')
      }]
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Read environment variables resource
 */
async function handleEnvRead(
  uri: string,
  project: string,
  environment: Environment,
  service?: string
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const { client } = await getClientAndConfig()

  try {
    await client.connect()

    const vars = await client.export(project, environment, service)
    const entries = Object.entries(vars)

    if (entries.length === 0) {
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: `# No variables found for ${project}/${environment}${service ? `/${service}` : ''}`
        }]
      }
    }

    // Format as .env file content
    const envContent = entries
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: `# Environment: ${project}/${environment}${service ? `/${service}` : ''}\n# Variables: ${entries.length}\n\n${envContent}`
      }]
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Mask a value for safe display (show first 3 chars + ... + last 3 chars if > 10 chars)
 */
function maskValue(value: string | undefined): string {
  if (!value) return '(undefined)'
  if (value.length <= 10) return value
  return `${value.slice(0, 3)}...${value.slice(-3)}`
}
