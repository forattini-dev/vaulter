/**
 * Vaulter MCP Prompts
 *
 * 5 workflow prompts for common scenarios.
 */

interface McpPrompt {
  name: string
  description: string
  arguments?: Array<{
    name: string
    description: string
    required?: boolean
  }>
}

interface PromptResult {
  description: string
  messages: Array<{
    role: 'user' | 'assistant'
    content: { type: 'text'; text: string }
  }>
  _meta?: Record<string, unknown>
}

/**
 * List available prompts
 */
export function registerPrompts(): McpPrompt[] {
  return [
    {
      name: 'setup_project',
      description: 'Initialize a new vaulter project with best practices',
      arguments: [
        { name: 'project', description: 'Project name', required: false },
        { name: 'monorepo', description: 'Is monorepo (true/false)', required: false }
      ]
    },
    {
      name: 'deploy_secrets',
      description: 'Generate deployment artifacts (K8s secrets, configmaps, Helm values)',
      arguments: [
        { name: 'environment', description: 'Target environment', required: true },
        { name: 'format', description: 'Output format (k8s-secret, k8s-configmap, helm, terraform)', required: false }
      ]
    },
    {
      name: 'compare_environments',
      description: 'Compare variables across environments and identify gaps',
      arguments: [
        { name: 'source', description: 'Source environment', required: true },
        { name: 'target', description: 'Target environment', required: true }
      ]
    },
    {
      name: 'rotation_workflow',
      description: 'Rotate encryption keys with backup and re-encryption',
      arguments: [
        { name: 'key', description: 'Key name to rotate', required: false }
      ]
    },
    {
      name: 'local_dev_workflow',
      description: 'Set up local development with shared vars and service overrides',
      arguments: [
        { name: 'service', description: 'Service name (for monorepo)', required: false }
      ]
    }
  ]
}

/**
 * Get a prompt by name
 */
export function getPrompt(name: string, args: Record<string, string>): PromptResult {
  switch (name) {
    case 'setup_project':
      return promptSetupProject(args)
    case 'deploy_secrets':
      return promptDeploySecrets(args)
    case 'compare_environments':
      return promptCompareEnvironments(args)
    case 'rotation_workflow':
      return promptRotationWorkflow(args)
    case 'local_dev_workflow':
      return promptLocalDevWorkflow(args)
    default:
      throw new Error(`Unknown prompt: ${name}`)
  }
}

function promptSetupProject(args: Record<string, string>): PromptResult {
  const project = args.project || '<project-name>'
  const isMonorepo = args.monorepo === 'true'

  return {
    description: 'Initialize a vaulter project',
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Set up a new vaulter project "${project}"${isMonorepo ? ' (monorepo)' : ''}.

Steps:
1. Run \`vaulter_init\`${args.project ? ` with project="${project}"` : ''}${isMonorepo ? ' monorepo=true' : ''}
2. Generate encryption key: \`vaulter_key\` action="generate" name="master"
3. Set initial variables using \`vaulter_change\` action="set"
4. Plan changes: \`vaulter_plan\`
5. Apply to backend: \`vaulter_apply\`

After setup, verify with \`vaulter_status\` action="scorecard".`
      }
    }]
  }
}

function promptDeploySecrets(args: Record<string, string>): PromptResult {
  const environment = args.environment || 'prd'
  const format = args.format || 'k8s-secret'

  return {
    description: 'Generate deployment artifacts',
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Generate deployment artifacts for ${environment} environment.

Steps:
1. Check current state: \`vaulter_list\` environment="${environment}"
2. Look for drift: \`vaulter_diff\` environment="${environment}"
3. Generate artifacts: \`vaulter_export\` environment="${environment}" format="${format}"

Available formats: k8s-secret, k8s-configmap, helm, terraform, env, shell, json

For Kubernetes:
- Secrets (sensitive=true): \`vaulter_export\` format="k8s-secret"
- ConfigMap (sensitive=false): \`vaulter_export\` format="k8s-configmap"`
      }
    }]
  }
}

function promptCompareEnvironments(args: Record<string, string>): PromptResult {
  const source = args.source || 'dev'
  const target = args.target || 'prd'

  return {
    description: 'Compare environments',
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Compare ${source} and ${target} environments.

Steps:
1. Compare: \`vaulter_search\` source="${source}" target="${target}" showValues=true
2. Check overall health: \`vaulter_status\` action="inventory"
3. For missing vars, copy from source: \`vaulter_change\` action="set" in the target environment

This will show:
- Variables only in ${source}
- Variables only in ${target}
- Variables with different values
- Variables that are identical`
      }
    }]
  }
}

function promptRotationWorkflow(args: Record<string, string>): PromptResult {
  const keyName = args.key || 'master'

  return {
    description: 'Key rotation workflow',
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Rotate encryption key "${keyName}".

Steps:
1. Preview: \`vaulter_key\` action="rotate" name="${keyName}" dryRun=true
2. Create backup snapshot: \`vaulter_snapshot\` action="create"
3. Execute rotation: \`vaulter_key\` action="rotate" name="${keyName}"
4. Verify: \`vaulter_key\` action="show" name="${keyName}"
5. Check health: \`vaulter_status\` action="scorecard"

The rotation process:
1. Exports all variables (decrypted)
2. Backs up the old key
3. Generates a new key
4. Re-encrypts all variables with the new key`
      }
    }]
  }
}

function promptLocalDevWorkflow(args: Record<string, string>): PromptResult {
  const service = args.service

  return {
    description: 'Local development setup',
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Set up local development${service ? ` for service "${service}"` : ''}.

Steps:
1. Check status: \`vaulter_local\` action="status"
2. Sync from backend: \`vaulter_local\` action="sync"
3. Set shared vars: \`vaulter_local\` action="shared-set" key="DEBUG" value="true"
${service ? `4. Set service override: \`vaulter_local\` action="set" key="PORT" value="3000" service="${service}"` : '4. Set local override: \`vaulter_local\` action="set" key="PORT" value="3000"'}
5. Generate .env files: \`vaulter_local\` action="pull" all=true
6. View shared vars: \`vaulter_local\` action="shared-list"
7. View diff: \`vaulter_local\` action="diff"

Structure:
  .vaulter/local/configs.env  — shared non-sensitive
  .vaulter/local/secrets.env  — shared sensitive
${service ? `  .vaulter/local/services/${service}/configs.env  — service configs\n  .vaulter/local/services/${service}/secrets.env  — service secrets` : ''}`
      }
    }]
  }
}
