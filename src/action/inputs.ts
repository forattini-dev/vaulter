/**
 * Vaulter GitHub Action - Input Parser
 *
 * Parses and validates inputs from GitHub Actions environment variables.
 * Inputs are available as INPUT_<NAME> environment variables.
 */

import type { AsymmetricAlgorithm, Environment } from '../types.js'

export type OutputFormat = 'env' | 'json' | 'k8s-secret' | 'k8s-configmap' | 'helm-values' | 'tfvars' | 'shell'

export interface ActionInputs {
  // Connection
  backend: string
  passphrase: string

  // Filters
  project: string
  environment: Environment
  service?: string

  // Outputs
  outputs: OutputFormat[]

  // Output paths
  envPath: string
  jsonPath: string
  k8sSecretPath: string
  k8sConfigMapPath: string
  helmValuesPath: string
  tfvarsPath: string
  shellPath: string

  // K8s options
  k8sSecretName?: string
  k8sConfigMapName?: string
  k8sNamespace: string

  // Encryption
  encryptionMode: 'symmetric' | 'asymmetric'
  publicKey?: string
  privateKey?: string
  asymmetricAlgorithm: AsymmetricAlgorithm

  // Shared vars
  includeShared: boolean

  // Export options
  exportToEnv: boolean
  maskValues: boolean
}

/**
 * Get input from GitHub Actions environment
 * INPUT_<NAME> with dashes converted to underscores
 */
function getInput(name: string, required: boolean = false): string {
  const envName = `INPUT_${name.replace(/-/g, '_').toUpperCase()}`
  const value = process.env[envName] || ''

  if (required && !value) {
    throw new Error(`Input required and not supplied: ${name}`)
  }

  return value.trim()
}

/**
 * Get boolean input
 */
function getBooleanInput(name: string, defaultValue: boolean = false): boolean {
  const value = getInput(name).toLowerCase()
  if (!value) return defaultValue
  return value === 'true' || value === 'yes' || value === '1'
}

/**
 * Parse and validate all inputs
 */
export function getInputs(): ActionInputs {
  // Connection - check env vars as fallback
  const backend = getInput('backend') ||
    process.env.VAULTER_BACKEND ||
    process.env.VAULTER_CONNECTION_STRING ||
    ''

  if (!backend) {
    throw new Error('Backend is required. Set "backend" input or VAULTER_BACKEND environment variable.')
  }

  const passphrase = getInput('passphrase') ||
    process.env.VAULTER_PASSPHRASE ||
    ''

  // Required filters
  const project = getInput('project', true)
  const environment = getInput('environment', true) as Environment
  const service = getInput('service') || undefined

  // Parse outputs
  const outputsRaw = getInput('outputs') || 'env'
  const validOutputs: OutputFormat[] = ['env', 'json', 'k8s-secret', 'k8s-configmap', 'helm-values', 'tfvars', 'shell']
  const outputs = outputsRaw
    .split(',')
    .map(o => o.trim().toLowerCase() as OutputFormat)
    .filter(o => validOutputs.includes(o))

  if (outputs.length === 0) {
    outputs.push('env')
  }

  // Output paths
  const envPath = getInput('env-path') || '.env'
  const jsonPath = getInput('json-path') || 'vaulter-vars.json'
  const k8sSecretPath = getInput('k8s-secret-path') || 'k8s-secret.yaml'
  const k8sConfigMapPath = getInput('k8s-configmap-path') || 'k8s-configmap.yaml'
  const helmValuesPath = getInput('helm-values-path') || 'helm-values.yaml'
  const tfvarsPath = getInput('tfvars-path') || 'terraform.auto.tfvars'
  const shellPath = getInput('shell-path') || 'vaulter-env.sh'

  // K8s options
  const k8sSecretName = getInput('k8s-secret-name') || undefined
  const k8sConfigMapName = getInput('k8s-configmap-name') || undefined
  const k8sNamespace = getInput('k8s-namespace') || 'default'

  // Encryption
  const encryptionMode = (getInput('encryption-mode') || 'symmetric') as 'symmetric' | 'asymmetric'
  const publicKey = getInput('public-key') || undefined
  const privateKey = getInput('private-key') || undefined
  const asymmetricAlgorithm = (getInput('asymmetric-algorithm') || 'rsa-4096') as AsymmetricAlgorithm

  // Validate asymmetric mode
  if (encryptionMode === 'asymmetric' && !publicKey && !privateKey) {
    throw new Error('Asymmetric mode requires at least public-key or private-key')
  }

  // Shared vars
  const includeShared = getBooleanInput('include-shared', true)

  // Export options
  const exportToEnv = getBooleanInput('export-to-env', false)
  const maskValues = getBooleanInput('mask-values', true)

  return {
    backend,
    passphrase,
    project,
    environment,
    service,
    outputs,
    envPath,
    jsonPath,
    k8sSecretPath,
    k8sConfigMapPath,
    helmValuesPath,
    tfvarsPath,
    shellPath,
    k8sSecretName,
    k8sConfigMapName,
    k8sNamespace,
    encryptionMode,
    publicKey,
    privateKey,
    asymmetricAlgorithm,
    includeShared,
    exportToEnv,
    maskValues
  }
}
