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
import { parseEnvFile } from '../../../lib/env-parser.js'
import {
  findConfigDir,
  getSecretsFilePath,
  getConfigsFilePath,
  isSplitMode
} from '../../../lib/config-loader.js'
import { print } from '../../lib/colors.js'
import * as ui from '../../ui.js'

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
    print.error('Project not specified')
    process.exit(1)
  }

  // Determine secret name and namespace
  const namespace = args.namespace ||
    config?.integrations?.kubernetes?.namespace ||
    `${project}-${environment}`

  const secretName = config?.integrations?.kubernetes?.secret_name ||
    (service ? `${service}-secrets` : `${project}-secrets`)

  ui.verbose(`Generating K8s Secret: ${namespace}/${secretName}`, verbose)

  // Check for local file mode (explicit -f or split mode)
  const localPath = resolveSecretsPath(config, environment, args.file)
  let secretVars: Record<string, string> = {}

  if (localPath) {
    // Read from local file (split mode or explicit -f)
    ui.verbose(`Reading secrets from local file: ${localPath}`, verbose)
    secretVars = getLocalVariables(localPath)
  } else {
    // Fetch from backend and filter by sensitive=true
    const client = await createClientFromConfig({ args, config, project, verbose })

    try {
      await client.connect()
      const allVars = await client.list({ project, environment, service })
      const secrets = allVars.filter(v => v.sensitive === true)

      for (const v of secrets) {
        secretVars[v.key] = v.value
      }
    } finally {
      await client.disconnect()
    }
  }

  if (Object.keys(secretVars).length === 0) {
    print.warning('No secret variables found (none marked as sensitive)')
    return
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
    ui.output(JSON.stringify({
      kind: 'Secret',
      name: secretName,
      namespace,
      variableCount: Object.keys(secretVars).length,
      source: localPath ? 'local' : 'backend'
    }))
  } else {
    ui.output(yaml)
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
    print.error('Project not specified')
    process.exit(1)
  }

  // Determine configmap name and namespace
  const namespace = args.namespace ||
    config?.integrations?.kubernetes?.namespace ||
    `${project}-${environment}`

  const configMapName = config?.integrations?.kubernetes?.configmap_name ||
    (service ? `${service}-config` : `${project}-config`)

  ui.verbose(`Generating K8s ConfigMap: ${namespace}/${configMapName}`, verbose)

  // Check for local file mode (explicit -f or split mode)
  const localPath = resolveConfigsPath(config, environment, args.file)
  let configVars: Record<string, string> = {}

  if (localPath) {
    // Read from local file (split mode or explicit -f)
    // In split mode, configs file contains only non-sensitive vars
    ui.verbose(`Reading configs from local file: ${localPath}`, verbose)
    configVars = getLocalVariables(localPath)
  } else {
    // Fetch from backend and filter by sensitive=false (configs only)
    const client = await createClientFromConfig({ args, config, project, verbose })

    try {
      await client.connect()
      const allVars = await client.list({ project, environment, service })
      const configs = allVars.filter(v => v.sensitive !== true)

      for (const v of configs) {
        configVars[v.key] = v.value
      }
    } finally {
      await client.disconnect()
    }
  }

  if (Object.keys(configVars).length === 0) {
    print.warning('No config variables found (all are marked as sensitive)')
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
    ui.output(JSON.stringify({
      kind: 'ConfigMap',
      name: configMapName,
      namespace,
      variableCount: Object.keys(configVars).length,
      source: localPath ? 'local' : 'backend'
    }))
  } else {
    ui.output(yaml)
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
