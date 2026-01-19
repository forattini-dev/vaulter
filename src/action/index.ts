/**
 * Vaulter GitHub Action Entry Point
 *
 * Pulls environment variables from Vaulter backend and generates
 * outputs in multiple formats for different IaC tools.
 *
 * Supported outputs:
 * - env: .env file
 * - json: JSON file
 * - k8s-secret: Kubernetes Secret YAML
 * - k8s-configmap: Kubernetes ConfigMap YAML
 * - helm-values: Helm values.yaml
 * - tfvars: Terraform .tfvars
 * - shell: Shell export script
 */

// Force silent logging BEFORE importing s3db.js (via VaulterClient)
// This prevents pino-pretty transport errors in bundled action
process.env.S3DB_LOG_LEVEL = 'silent'
process.env.S3DB_LOG_FORMAT = 'json'

import fs from 'node:fs'
import path from 'node:path'
import { getInputs, type ActionInputs } from './inputs.js'
import {
  generateEnvFile,
  generateJsonFile,
  generateK8sSecret,
  generateK8sConfigMap,
  generateHelmValues,
  generateTfVars,
  generateShellExport
} from './formats.js'
import { VaulterClient } from '../client.js'

// GitHub Actions core functions (inline to avoid dependency)
function getInput(name: string): string {
  return process.env[`INPUT_${name.replace(/-/g, '_').toUpperCase()}`] || ''
}

function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT
  if (outputFile) {
    fs.appendFileSync(outputFile, `${name}=${value}\n`)
  } else {
    // Fallback for local testing
    console.log(`::set-output name=${name}::${value}`)
  }
}

function setFailed(message: string): void {
  console.error(`::error::${message}`)
  process.exitCode = 1
}

function info(message: string): void {
  console.log(message)
}

function warning(message: string): void {
  console.log(`::warning::${message}`)
}

function setSecret(value: string): void {
  console.log(`::add-mask::${value}`)
}

function exportVariable(name: string, value: string): void {
  const envFile = process.env.GITHUB_ENV
  if (envFile) {
    // Handle multiline values with delimiter
    if (value.includes('\n')) {
      const delimiter = `ghadelimiter_${Date.now()}`
      fs.appendFileSync(envFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
    } else {
      fs.appendFileSync(envFile, `${name}=${value}\n`)
    }
  }
}

async function run(): Promise<void> {
  try {
    // Parse inputs
    const inputs = getInputs()

    info(`🔐 Vaulter Action`)
    info(`   Project: ${inputs.project}`)
    info(`   Environment: ${inputs.environment}`)
    if (inputs.service) {
      info(`   Service: ${inputs.service}`)
    }
    info(`   Outputs: ${inputs.outputs.join(', ')}`)
    info('')

    // Create client
    const clientOptions: any = {
      connectionString: inputs.backend,
      passphrase: inputs.passphrase,
      encryptionMode: inputs.encryptionMode,
      verbose: false // Disable verbose logging in action
    }

    if (inputs.encryptionMode === 'asymmetric') {
      clientOptions.publicKey = inputs.publicKey
      clientOptions.privateKey = inputs.privateKey
      clientOptions.asymmetricAlgorithm = inputs.asymmetricAlgorithm
    }

    const client = new VaulterClient(clientOptions)

    info('📡 Connecting to backend...')
    await client.connect()
    info('✓ Connected')

    // Export variables
    info('📥 Fetching variables...')
    const vars = await client.export(
      inputs.project,
      inputs.environment,
      inputs.service,
      { includeShared: inputs.includeShared }
    )

    const varCount = Object.keys(vars).length
    info(`✓ Found ${varCount} variables`)

    if (varCount === 0) {
      warning('No variables found for the specified project/environment/service')
      setOutput('vars-count', '0')
      setOutput('vars-json', '[]')
      await client.disconnect()
      return
    }

    // Mask values if requested
    if (inputs.maskValues) {
      for (const value of Object.values(vars)) {
        if (value && value.length > 3) {
          setSecret(value)
        }
      }
    }

    // Generate requested outputs
    info('')
    info('📝 Generating outputs...')

    const generatedOutputs: Record<string, string> = {}

    for (const output of inputs.outputs) {
      let filePath: string
      let content: string

      switch (output) {
        case 'env':
          filePath = inputs.envPath
          content = generateEnvFile(vars)
          generatedOutputs['env-file'] = filePath
          break

        case 'json':
          filePath = inputs.jsonPath
          content = generateJsonFile(vars)
          generatedOutputs['json-file'] = filePath
          break

        case 'k8s-secret':
          filePath = inputs.k8sSecretPath
          content = generateK8sSecret(vars, {
            name: inputs.k8sSecretName || `${inputs.project}-secrets`,
            namespace: inputs.k8sNamespace,
            environment: inputs.environment
          })
          generatedOutputs['k8s-secret-file'] = filePath
          break

        case 'k8s-configmap':
          filePath = inputs.k8sConfigMapPath
          content = generateK8sConfigMap(vars, {
            name: inputs.k8sConfigMapName || `${inputs.project}-config`,
            namespace: inputs.k8sNamespace,
            environment: inputs.environment
          })
          generatedOutputs['k8s-configmap-file'] = filePath
          break

        case 'helm-values':
          filePath = inputs.helmValuesPath
          content = generateHelmValues(vars, {
            project: inputs.project,
            environment: inputs.environment,
            service: inputs.service
          })
          generatedOutputs['helm-values-file'] = filePath
          break

        case 'tfvars':
          filePath = inputs.tfvarsPath
          content = generateTfVars(vars, {
            project: inputs.project,
            environment: inputs.environment,
            service: inputs.service
          })
          generatedOutputs['tfvars-file'] = filePath
          break

        case 'shell':
          filePath = inputs.shellPath
          content = generateShellExport(vars)
          generatedOutputs['shell-file'] = filePath
          break

        default:
          warning(`Unknown output type: ${output}`)
          continue
      }

      // Ensure directory exists
      const dir = path.dirname(filePath)
      if (dir && dir !== '.' && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // Write file
      fs.writeFileSync(filePath, content)
      info(`   ✓ ${output} → ${filePath}`)
    }

    // Set outputs
    for (const [name, value] of Object.entries(generatedOutputs)) {
      setOutput(name, value)
    }
    setOutput('vars-count', String(varCount))
    setOutput('vars-json', JSON.stringify(Object.keys(vars)))

    // Export to GITHUB_ENV if requested
    if (inputs.exportToEnv) {
      info('')
      info('📤 Exporting to GITHUB_ENV...')
      for (const [key, value] of Object.entries(vars)) {
        exportVariable(key, value)
      }
      info(`✓ Exported ${varCount} variables to GITHUB_ENV`)
    }

    // Disconnect
    await client.disconnect()

    info('')
    info('✅ Done!')

  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message)
    } else {
      setFailed(String(error))
    }
  }
}

// Run the action
run()
