/**
 * Vaulter MCP Prompts
 *
 * Pre-configured prompt templates for common workflows
 *
 * Prompts:
 *   setup_project        → Initialize a new vaulter project
 *   migrate_dotenv       → Migrate existing .env files to vaulter
 *   deploy_secrets       → Deploy secrets to Kubernetes
 *   compare_environments → Compare variables between environments
 *   security_audit       → Audit secrets for security issues
 */

import type { Prompt, GetPromptResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * Register all available prompts
 */
export function registerPrompts(): Prompt[] {
  return [
    {
      name: 'setup_project',
      description: 'Initialize a new vaulter project. Guides through backend selection, encryption setup, and environment configuration.',
      arguments: [
        {
          name: 'project_name',
          description: 'Name of the project (e.g., my-app, api-service)',
          required: true
        },
        {
          name: 'mode',
          description: 'Directory mode: "unified" (single .env per environment) or "split" (separate configs/secrets directories)',
          required: false
        },
        {
          name: 'backend',
          description: 'Storage backend: "s3", "minio", "r2", "file", or "memory"',
          required: false
        }
      ]
    },
    {
      name: 'migrate_dotenv',
      description: 'Migrate existing .env files to vaulter. Analyzes files, identifies secrets, and syncs to backend.',
      arguments: [
        {
          name: 'file_path',
          description: 'Path to the .env file to migrate (e.g., .env.local, .env.production)',
          required: true
        },
        {
          name: 'environment',
          description: 'Target environment: dev, stg, prd, sbx, or dr',
          required: true
        },
        {
          name: 'dry_run',
          description: 'Preview changes without applying them (true/false)',
          required: false
        }
      ]
    },
    {
      name: 'deploy_secrets',
      description: 'Deploy secrets to Kubernetes. Generates Secret YAML and provides deployment instructions.',
      arguments: [
        {
          name: 'environment',
          description: 'Environment to deploy: dev, stg, prd, sbx, or dr',
          required: true
        },
        {
          name: 'namespace',
          description: 'Kubernetes namespace (defaults to project-environment)',
          required: false
        },
        {
          name: 'secret_name',
          description: 'Name of the Kubernetes Secret (defaults to project-secrets)',
          required: false
        }
      ]
    },
    {
      name: 'compare_environments',
      description: 'Compare variables between two environments. Shows differences, missing keys, and value changes.',
      arguments: [
        {
          name: 'source_env',
          description: 'Source environment: dev, stg, prd, sbx, or dr',
          required: true
        },
        {
          name: 'target_env',
          description: 'Target environment: dev, stg, prd, sbx, or dr',
          required: true
        },
        {
          name: 'show_values',
          description: 'Show actual values (masked) in comparison (true/false)',
          required: false
        }
      ]
    },
    {
      name: 'security_audit',
      description: 'Audit environment variables for security issues. Checks for exposed secrets, weak patterns, and best practices.',
      arguments: [
        {
          name: 'environment',
          description: 'Environment to audit: dev, stg, prd, sbx, dr, or "all"',
          required: true
        },
        {
          name: 'strict',
          description: 'Enable strict mode with additional checks (true/false)',
          required: false
        }
      ]
    }
  ]
}

/**
 * Get a prompt by name with filled arguments
 */
export function getPrompt(name: string, args: Record<string, string>): GetPromptResult {
  switch (name) {
    case 'setup_project':
      return getSetupProjectPrompt(args)
    case 'migrate_dotenv':
      return getMigrateDotenvPrompt(args)
    case 'deploy_secrets':
      return getDeploySecretsPrompt(args)
    case 'compare_environments':
      return getCompareEnvironmentsPrompt(args)
    case 'security_audit':
      return getSecurityAuditPrompt(args)
    default:
      throw new Error(`Unknown prompt: ${name}`)
  }
}

function getSetupProjectPrompt(args: Record<string, string>): GetPromptResult {
  const projectName = args.project_name || 'my-project'
  const mode = args.mode || 'unified'
  const backend = args.backend || 's3'

  return {
    description: `Initialize vaulter project "${projectName}"`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me set up a new vaulter project with the following configuration:

**Project:** ${projectName}
**Mode:** ${mode}
**Backend:** ${backend}

Please:

1. **Initialize the project** using \`vaulter_init\` tool with mode="${mode}"

2. **Explain the directory structure** that will be created:
   ${mode === 'split'
    ? `- \`deploy/configs/\` - Non-sensitive configuration (committed to git)
   - \`deploy/secrets/\` - Sensitive secrets (git-ignored)`
    : `- \`.vaulter/environments/\` - All environment files`}

3. **Guide me through backend setup** for ${backend}:
   ${backend === 's3' ? '- AWS S3 bucket URL and credentials' : ''}
   ${backend === 'minio' ? '- MinIO endpoint, access key, and secret' : ''}
   ${backend === 'r2' ? '- Cloudflare R2 account ID and credentials' : ''}
   ${backend === 'file' ? '- Local directory path for storage' : ''}
   ${backend === 'memory' ? '- Memory backend (for testing only)' : ''}

4. **Generate encryption key** using \`vaulter key generate\`

5. **Show next steps** for:
   - Adding first variables
   - Setting up CI/CD integration
   - Team sharing best practices`
        }
      }
    ]
  }
}

function getMigrateDotenvPrompt(args: Record<string, string>): GetPromptResult {
  const filePath = args.file_path || '.env'
  const environment = args.environment || 'dev'
  const dryRun = args.dry_run === 'true'

  return {
    description: `Migrate ${filePath} to vaulter (${environment})`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me migrate an existing .env file to vaulter:

**Source file:** ${filePath}
**Target environment:** ${environment}
**Dry run:** ${dryRun ? 'Yes (preview only)' : 'No (apply changes)'}

Please:

1. **Read the .env file** and analyze its contents
   - Identify which variables look like secrets (passwords, keys, tokens)
   - Identify which are configuration (ports, URLs, flags)

2. **Check current vaulter state** using \`vaulter_list\` for ${environment}
   - Show what already exists
   - Highlight potential conflicts

3. **Preview the migration** using \`vaulter_sync\` with dry_run=${dryRun}
   - Variables that will be added
   - Variables that will be updated
   - Variables that will remain unchanged

${!dryRun ? `4. **Execute the migration** if preview looks good
   - Sync all variables to the ${environment} environment
   - Confirm successful migration

5. **Verify the migration** using \`vaulter_list\` again` : `4. **Explain what would happen** without dry run mode`}

6. **Provide recommendations:**
   - Should any variables be separated into configs (non-sensitive)?
   - Are there any security concerns with the current values?
   - Suggest tagging strategy for organization`
        }
      }
    ]
  }
}

function getDeploySecretsPrompt(args: Record<string, string>): GetPromptResult {
  const environment = args.environment || 'prd'
  const namespace = args.namespace || ''
  const secretName = args.secret_name || ''

  return {
    description: `Deploy secrets to Kubernetes (${environment})`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me deploy vaulter secrets to Kubernetes:

**Environment:** ${environment}
${namespace ? `**Namespace:** ${namespace}` : '**Namespace:** (auto-generate from project)'}
${secretName ? `**Secret Name:** ${secretName}` : '**Secret Name:** (auto-generate from project)'}

Please:

1. **List current secrets** using \`vaulter_list\` for ${environment}
   - Show the variables that will be included
   - Verify nothing sensitive is missing

2. **Generate Kubernetes Secret YAML** using \`vaulter_k8s_secret\`
   ${namespace ? `- Use namespace: ${namespace}` : '- Use auto-generated namespace'}
   ${secretName ? `- Use secret name: ${secretName}` : '- Use auto-generated secret name'}

3. **Review the generated YAML**
   - Verify all expected keys are present
   - Check the metadata is correct

4. **Provide deployment commands:**
   \`\`\`bash
   # Apply the secret
   vaulter k8s:secret -e ${environment}${namespace ? ` -n ${namespace}` : ''} | kubectl apply -f -

   # Verify deployment
   kubectl get secret ${secretName || '<project>-secrets'} -n ${namespace || '<namespace>'}

   # View secret keys (not values)
   kubectl describe secret ${secretName || '<project>-secrets'} -n ${namespace || '<namespace>'}
   \`\`\`

5. **Security recommendations:**
   - Enable RBAC for secret access
   - Consider using external-secrets-operator for production
   - Set up secret rotation schedule
   - Audit who has access to the namespace`
        }
      }
    ]
  }
}

function getCompareEnvironmentsPrompt(args: Record<string, string>): GetPromptResult {
  const sourceEnv = args.source_env || 'dev'
  const targetEnv = args.target_env || 'prd'
  const showValues = args.show_values === 'true'

  return {
    description: `Compare ${sourceEnv} vs ${targetEnv} environments`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me compare environment variables between two environments:

**Source:** ${sourceEnv}
**Target:** ${targetEnv}
**Show values:** ${showValues ? 'Yes (masked)' : 'No (keys only)'}

Please:

1. **Fetch variables from both environments** using \`vaulter_compare\`
   - Source: ${sourceEnv}
   - Target: ${targetEnv}

2. **Analyze the differences:**

   **Variables only in ${sourceEnv}:**
   - List keys that exist in ${sourceEnv} but not in ${targetEnv}
   - These might need to be added to ${targetEnv}

   **Variables only in ${targetEnv}:**
   - List keys that exist in ${targetEnv} but not in ${sourceEnv}
   - These might be environment-specific or leftover

   **Variables with different values:**
   - List keys present in both but with different values
   ${showValues ? '- Show masked values for comparison' : '- Indicate which differ without showing values'}

   **Variables that are identical:**
   - Count of matching variables
   - These might be candidates for shared configuration

3. **Provide recommendations:**
   - Which missing variables should be synced?
   - Which differences are expected (env-specific)?
   - Which differences might be configuration drift?

4. **Suggest actions:**
   - Commands to copy specific variables between environments
   - How to bulk sync if needed
   - Best practices for environment parity`
        }
      }
    ]
  }
}

function getSecurityAuditPrompt(args: Record<string, string>): GetPromptResult {
  const environment = args.environment || 'all'
  const strict = args.strict === 'true'

  return {
    description: `Security audit for ${environment} environment${strict ? ' (strict mode)' : ''}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Perform a security audit on vaulter secrets:

**Environment:** ${environment}
**Strict mode:** ${strict ? 'Enabled' : 'Disabled'}

Please:

1. **Fetch all variables** using \`vaulter_list\` for ${environment === 'all' ? 'each environment' : environment}

2. **Check for security issues:**

   **Naming patterns:**
   - Variables with "password", "secret", "key", "token" in name
   - Verify these are properly encrypted in backend

   **Value patterns:**
   ${strict ? `- Check for hardcoded localhost URLs in production
   - Check for default/weak values (admin, password123, etc.)
   - Check for exposed API keys in URLs` : '- Basic pattern checks for obvious issues'}

   **Best practices:**
   - Are secrets properly tagged?
   - Is there proper environment separation?
   - Are production credentials different from dev?

3. **Check for exposed secrets:**
   - Variables that might be in git history
   - Variables visible in logs
   - Variables in non-secret ConfigMaps

4. **Provide a security report:**

   | Category | Status | Details |
   |----------|--------|---------|
   | Encryption | ✓/✗ | Is AES-256-GCM enabled? |
   | Separation | ✓/✗ | Are prod secrets isolated? |
   | Rotation | ✓/✗ | Is key rotation configured? |
   | Access | ✓/✗ | Is access properly restricted? |

5. **Recommendations:**
   - Immediate actions for critical issues
   - Short-term improvements
   - Long-term security roadmap

${strict ? `6. **Strict mode additional checks:**
   - Certificate expiration dates
   - API key age and rotation
   - Compliance with security standards` : ''}`
        }
      }
    ]
  }
}
