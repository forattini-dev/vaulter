/**
 * Vaulter CLI - Kubernetes Integration Commands
 *
 * Generate Kubernetes Secret and ConfigMap YAML
 *
 * Supports two modes:
 * - Backend mode (default): Fetch variables from backend storage
 * - Local mode (-f/--file): Read variables from local .env file
 *
 * In split mode (directories.mode=split):
 * - k8s:secret can read from deploy/secrets/<env>.env
 * - k8s:configmap can read from deploy/configs/<env>.env
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, VaulterConfig, Environment } from '../../../types.js'
import { createClientFromConfig } from '../../lib/create-client.js'
import { getSecretPatterns, splitVarsBySecret } from '../../../lib/secret-patterns.js'
import { parseEnvFile } from '../../../lib/env-parser.js'
import {
  findConfigDir,
  getSecretsFilePath,
  getConfigsFilePath,
  isSplitMode
} from '../../../lib/config-loader.js'

interface K8sContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  jsonOutput: boolean
}

/**
 * Encode value to base64
 */
function base64Encode(value: string): string {
  return Buffer.from(value).toString('base64')
}

/**
 * Get variables from local file
 */
function getLocalVariables(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }
  return parseEnvFile(filePath)
}

/**
 * Resolve the file path for secrets in split mode
 */
function resolveSecretsPath(
  config: VaulterConfig | null,
  environment: Environment,
  explicitFile?: string
): string | null {
  if (explicitFile) {
    return path.resolve(explicitFile)
  }

  if (config && isSplitMode(config)) {
    const configDir = findConfigDir()
    if (configDir) {
      return getSecretsFilePath(config, configDir, environment)
    }
  }

  return null
}

/**
 * Resolve the file path for configs in split mode
 */
function resolveConfigsPath(
  config: VaulterConfig | null,
  environment: Environment,
  explicitFile?: string
): string | null {
  if (explicitFile) {
    return path.resolve(explicitFile)
  }

  if (config && isSplitMode(config)) {
    const configDir = findConfigDir()
    if (configDir) {
      return getConfigsFilePath(config, configDir, environment)
    }
  }

  return null
}

/**
 * Sanitize name for Kubernetes (lowercase, alphanumeric, hyphens)
 */
function sanitizeK8sName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Generate Kubernetes Secret YAML
 *
 * In split mode (directories.mode=split), reads from local secrets file.
 * Otherwise, fetches from backend storage.
 */
export async function runK8sSecret(context: K8sContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  if (!project) {
    console.error('Error: Project not specified')
    process.exit(1)
  }

  // Determine secret name and namespace
  const namespace = args.namespace || args.n ||
    config?.integrations?.kubernetes?.namespace ||
    `${project}-${environment}`

  const secretName = config?.integrations?.kubernetes?.secret_name ||
    (service ? `${service}-secrets` : `${project}-secrets`)

  if (verbose) {
    console.error(`Generating K8s Secret: ${namespace}/${secretName}`)
  }

  // Check for local file mode (explicit -f or split mode)
  const localPath = resolveSecretsPath(config, environment, args.file || args.f)
  let vars: Record<string, string>

  if (localPath) {
    // Read from local file (split mode or explicit -f)
    if (verbose) {
      console.error(`Reading secrets from local file: ${localPath}`)
    }
    vars = getLocalVariables(localPath)
  } else {
    // Fetch from backend
    const client = await createClientFromConfig({ args, config, verbose })

    try {
      await client.connect()
      vars = await client.export(project, environment, service)
    } finally {
      await client.disconnect()
    }
  }

  if (Object.keys(vars).length === 0) {
    console.error('Warning: No variables found')
    return
  }

  // In split mode, all vars are secrets (no filtering needed)
  // In unified mode, filter by secret patterns
  let secretVars: Record<string, string>

  if (localPath && config && isSplitMode(config)) {
    // Split mode: all vars in secrets file are secrets
    secretVars = vars
  } else {
    // Unified mode: filter by patterns
    const patterns = getSecretPatterns(config)
    const { secrets } = splitVarsBySecret(vars, patterns)
    secretVars = Object.keys(secrets).length > 0 ? secrets : vars

    if (Object.keys(secrets).length === 0 && patterns.length > 0) {
      console.error('Warning: No variables matched secret patterns, exporting all variables')
    }
  }

  // Generate YAML
  const yaml = generateSecretYaml(
    sanitizeK8sName(secretName),
    sanitizeK8sName(namespace),
    secretVars,
    {
      project,
      service,
      environment,
      managedBy: 'vaulter'
    }
  )

  if (jsonOutput) {
    console.log(JSON.stringify({
      kind: 'Secret',
      name: secretName,
      namespace,
      variableCount: Object.keys(secretVars).length,
      source: localPath ? 'local' : 'backend'
    }))
  } else {
    console.log(yaml)
  }
}

/**
 * Generate Kubernetes ConfigMap YAML
 *
 * In split mode (directories.mode=split), reads from local configs file.
 * Otherwise, fetches from backend and filters out secrets.
 */
export async function runK8sConfigMap(context: K8sContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  if (!project) {
    console.error('Error: Project not specified')
    process.exit(1)
  }

  // Determine configmap name and namespace
  const namespace = args.namespace || args.n ||
    config?.integrations?.kubernetes?.namespace ||
    `${project}-${environment}`

  const configMapName = config?.integrations?.kubernetes?.configmap_name ||
    (service ? `${service}-config` : `${project}-config`)

  if (verbose) {
    console.error(`Generating K8s ConfigMap: ${namespace}/${configMapName}`)
  }

  // Check for local file mode (explicit -f or split mode)
  const localPath = resolveConfigsPath(config, environment, args.file || args.f)
  let configVars: Record<string, string>

  if (localPath) {
    // Read from local file (split mode or explicit -f)
    if (verbose) {
      console.error(`Reading configs from local file: ${localPath}`)
    }
    const allVars = getLocalVariables(localPath)

    // SECURITY: Filter out secrets even when reading from local file
    // This prevents accidental secret exposure if user points to a unified .env
    const patterns = getSecretPatterns(config)
    const { plain } = splitVarsBySecret(allVars, patterns)

    if (Object.keys(plain).length === 0 && Object.keys(allVars).length > 0) {
      console.error('Warning: All variables matched secret patterns, none available for ConfigMap')
      console.error('Hint: Use k8s:secret for sensitive variables')
      return
    }
    configVars = plain
  } else {
    // Fetch from backend and filter out secrets
    const client = await createClientFromConfig({ args, config, verbose })

    try {
      await client.connect()
      const vars = await client.export(project, environment, service)

      if (Object.keys(vars).length === 0) {
        console.error('Warning: No variables found')
        return
      }

      const patterns = getSecretPatterns(config)
      const { plain } = splitVarsBySecret(vars, patterns)
      if (Object.keys(plain).length === 0) {
        console.error('Warning: No non-secret variables found for ConfigMap')
        return
      }
      configVars = plain
    } finally {
      await client.disconnect()
    }
  }

  if (Object.keys(configVars).length === 0) {
    console.error('Warning: No variables found for ConfigMap')
    return
  }

  // Generate YAML
  const yaml = generateConfigMapYaml(
    sanitizeK8sName(configMapName),
    sanitizeK8sName(namespace),
    configVars,
    {
      project,
      service,
      environment,
      managedBy: 'vaulter'
    }
  )

  if (jsonOutput) {
    console.log(JSON.stringify({
      kind: 'ConfigMap',
      name: configMapName,
      namespace,
      variableCount: Object.keys(configVars).length,
      source: localPath ? 'local' : 'backend'
    }))
  } else {
    console.log(yaml)
  }
}

/**
 * Generate Secret YAML string
 */
function generateSecretYaml(
  name: string,
  namespace: string,
  data: Record<string, string>,
  labels: Record<string, string | undefined>
): string {
  const lines: string[] = [
    '# Generated by vaulter',
    '# DO NOT EDIT - changes will be overwritten',
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    `  name: ${name}`,
    `  namespace: ${namespace}`,
    '  labels:'
  ]

  // Add labels
  for (const [key, value] of Object.entries(labels)) {
    if (value) {
      lines.push(`    app.kubernetes.io/${key}: "${value}"`)
    }
  }

  lines.push('type: Opaque')
  lines.push('data:')

  // Add base64-encoded data
  for (const [key, value] of Object.entries(data)) {
    lines.push(`  ${key}: ${base64Encode(value)}`)
  }

  return lines.join('\n')
}

/**
 * Generate ConfigMap YAML string
 */
function generateConfigMapYaml(
  name: string,
  namespace: string,
  data: Record<string, string>,
  labels: Record<string, string | undefined>
): string {
  const lines: string[] = [
    '# Generated by vaulter',
    '# DO NOT EDIT - changes will be overwritten',
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    `  name: ${name}`,
    `  namespace: ${namespace}`,
    '  labels:'
  ]

  // Add labels
  for (const [key, value] of Object.entries(labels)) {
    if (value) {
      lines.push(`    app.kubernetes.io/${key}: "${value}"`)
    }
  }

  lines.push('data:')

  // Add string data (quote values that need it)
  for (const [key, value] of Object.entries(data)) {
    const needsQuote = value.includes(':') ||
      value.includes('#') ||
      value.includes('\n') ||
      value.startsWith(' ') ||
      value.endsWith(' ')

    if (needsQuote) {
      lines.push(`  ${key}: "${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
    } else {
      lines.push(`  ${key}: ${value}`)
    }
  }

  return lines.join('\n')
}
