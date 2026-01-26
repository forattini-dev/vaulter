/**
 * Vaulter MCP Prompts
 *
 * Pre-configured prompt templates for common workflows
 *
 * Prompts (10):
 *   setup_project        → Initialize a new vaulter project
 *   migrate_dotenv       → Migrate existing .env files to vaulter
 *   deploy_secrets       → Deploy secrets to Kubernetes
 *   compare_environments → Compare variables between environments
 *   security_audit       → Audit secrets for security issues
 *   rotation_workflow    → Check and manage secret rotation (check/rotate/report)
 *   shared_vars_workflow → Manage monorepo shared variables (list/promote/override/audit)
 *   batch_operations     → Batch set/get/delete operations
 *   copy_environment     → Copy variables between environments
 *   sync_workflow        → Sync local files with remote backend (diff/push/pull/merge)
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
    },
    {
      name: 'rotation_workflow',
      description: 'Check and manage secret rotation. Identifies overdue secrets, helps with rotation, and updates rotation timestamps.',
      arguments: [
        {
          name: 'environment',
          description: 'Environment to check: dev, stg, prd, sbx, dr, or "all"',
          required: true
        },
        {
          name: 'action',
          description: 'Action to perform: "check" (list overdue), "rotate" (interactive rotation), or "report" (full status report)',
          required: false
        },
        {
          name: 'key_pattern',
          description: 'Optional pattern to filter keys (e.g., "*_KEY", "API_*")',
          required: false
        }
      ]
    },
    {
      name: 'shared_vars_workflow',
      description: 'Manage monorepo shared variables. Shared vars apply to all services and can be overridden per-service.',
      arguments: [
        {
          name: 'action',
          description: 'Action: "list" (show inheritance), "promote" (service→shared), "override" (create service override), or "audit" (check consistency)',
          required: true
        },
        {
          name: 'environment',
          description: 'Environment: dev, stg, prd, sbx, or dr',
          required: true
        },
        {
          name: 'service',
          description: 'Service name (required for promote/override actions)',
          required: false
        }
      ]
    },
    {
      name: 'batch_operations',
      description: 'Perform batch operations on multiple environment variables at once. Supports multi-set, multi-get, and multi-delete.',
      arguments: [
        {
          name: 'operation',
          description: 'Operation type: "set" (create/update multiple), "get" (read multiple), "delete" (remove multiple)',
          required: true
        },
        {
          name: 'environment',
          description: 'Environment: dev, stg, prd, sbx, or dr',
          required: true
        },
        {
          name: 'variables',
          description: 'For "set": JSON object like {"VAR1": "val1", "VAR2": "val2"}. For "get"/"delete": comma-separated keys like "VAR1,VAR2,VAR3"',
          required: true
        },
        {
          name: 'shared',
          description: 'For "set" only: set as shared variables (true/false)',
          required: false
        }
      ]
    },
    {
      name: 'copy_environment',
      description: 'Copy variables from one environment to another. Useful for promoting configs from dev to staging/production.',
      arguments: [
        {
          name: 'source',
          description: 'Source environment: dev, stg, prd, sbx, or dr',
          required: true
        },
        {
          name: 'target',
          description: 'Target environment: dev, stg, prd, sbx, or dr',
          required: true
        },
        {
          name: 'filter',
          description: 'Filter pattern (e.g., "DATABASE_*", "*_URL") or "all" for everything',
          required: false
        },
        {
          name: 'overwrite',
          description: 'Overwrite existing variables in target (true/false)',
          required: false
        }
      ]
    },
    {
      name: 'sync_workflow',
      description: 'Synchronize local .env files with remote backend. Covers diff, push, pull, and merge operations with conflict resolution.',
      arguments: [
        {
          name: 'action',
          description: 'Action: "diff" (preview changes), "push" (local→remote), "pull" (remote→local), "merge" (bidirectional)',
          required: true
        },
        {
          name: 'environment',
          description: 'Environment: dev, stg, prd, sbx, or dr',
          required: true
        },
        {
          name: 'strategy',
          description: 'Conflict resolution: "local" (local wins), "remote" (remote wins), "error" (fail on conflict)',
          required: false
        },
        {
          name: 'prune',
          description: 'For push: delete remote vars not in local (true/false)',
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
    case 'rotation_workflow':
      return getRotationWorkflowPrompt(args)
    case 'shared_vars_workflow':
      return getSharedVarsWorkflowPrompt(args)
    case 'batch_operations':
      return getBatchOperationsPrompt(args)
    case 'copy_environment':
      return getCopyEnvironmentPrompt(args)
    case 'sync_workflow':
      return getSyncWorkflowPrompt(args)
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

function getRotationWorkflowPrompt(args: Record<string, string>): GetPromptResult {
  const environment = args.environment || 'prd'
  const action = args.action || 'check'
  const keyPattern = args.key_pattern || ''

  return {
    description: `Secret rotation ${action} for ${environment}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me manage secret rotation:

**Environment:** ${environment}
**Action:** ${action}
${keyPattern ? `**Key Pattern:** ${keyPattern}` : '**Key Pattern:** (all secrets)'}

${action === 'check' ? `## Check Overdue Secrets

Please:

1. **Get rotation status** using \`vaulter_rotation_status\` tool
   - Environment: ${environment}
   ${keyPattern ? `- Filter by pattern: ${keyPattern}` : ''}

2. **List overdue secrets:**
   - Show secrets past their rotation date
   - Show days overdue for each
   - Highlight critical secrets (passwords, API keys)

3. **List upcoming rotations:**
   - Secrets due within 7 days
   - Secrets due within 30 days

4. **Provide a summary:**
   | Status | Count |
   |--------|-------|
   | Overdue | X |
   | Due soon (7 days) | X |
   | Healthy | X |
   | No rotation configured | X |

5. **Recommendations:**
   - Priority order for rotation
   - Which secrets are most critical` : ''}

${action === 'rotate' ? `## Interactive Rotation

Please help me rotate secrets step by step:

1. **Get current rotation status** using \`vaulter_rotation_status\`

2. **For each overdue secret:**
   - Show current masked value
   - Ask for new value (or help generate one)
   - Update using \`vaulter_set\` with rotation metadata
   - Confirm rotation timestamp updated

3. **Rotation checklist:**
   \`\`\`
   [ ] Generate new secret value
   [ ] Update in vaulter
   [ ] Update in dependent services
   [ ] Verify services work with new secret
   [ ] Revoke old secret (if applicable)
   \`\`\`

4. **After rotation:**
   - Show updated rotation status
   - Confirm next rotation date` : ''}

${action === 'report' ? `## Full Rotation Report

Please generate a comprehensive rotation report:

1. **Fetch all data:**
   - Use \`vaulter_rotation_status\` for ${environment}
   - Use \`vaulter_list\` to get all variables

2. **Generate report sections:**

   ### Summary
   - Total secrets tracked: X
   - With rotation configured: X
   - Healthy: X
   - Needs attention: X

   ### Overdue Secrets (CRITICAL)
   | Key | Last Rotated | Days Overdue | Rotation Interval |
   |-----|--------------|--------------|-------------------|

   ### Upcoming Rotations (7 days)
   | Key | Last Rotated | Due In | Rotation Interval |
   |-----|--------------|--------|-------------------|

   ### Secrets Without Rotation
   | Key | Recommendation |
   |-----|----------------|

3. **Recommendations:**
   - Enable rotation for critical secrets
   - Suggested rotation intervals
   - Automation opportunities (CI/CD integration)

4. **Commands to fix:**
   \`\`\`bash
   # Set rotation for a secret
   vaulter set API_KEY "value" -e ${environment} --rotate-after 90d

   # Check what needs rotation
   vaulter rotation:check -e ${environment} --overdue
   \`\`\`` : ''}`
        }
      }
    ]
  }
}

function getSharedVarsWorkflowPrompt(args: Record<string, string>): GetPromptResult {
  const action = args.action || 'list'
  const environment = args.environment || 'dev'
  const service = args.service || ''

  return {
    description: `Shared variables ${action} for ${environment}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me manage monorepo shared variables:

**Action:** ${action}
**Environment:** ${environment}
${service ? `**Service:** ${service}` : '**Service:** (all services)'}

## Understanding Shared Variables

Vaulter supports variable inheritance in monorepos:
- **Shared vars** (service=\`__shared__\`): Apply to ALL services
- **Service vars**: Apply to specific service only
- **Overrides**: Service vars override shared vars with same key

**Resolution order:**
1. Shared variables (base)
2. Service-specific variables (override)

${action === 'list' ? `## List Inheritance

Please:

1. **Get shared variables** using \`vaulter_shared_list\`
   - Environment: ${environment}

2. **Get service inheritance stats** using \`vaulter_inheritance_stats\`
   ${service ? `- Service: ${service}` : '- For all services in the project'}

3. **Display inheritance map:**

   ### Shared Variables (Base)
   | Key | Value (masked) |
   |-----|----------------|

   ### Per-Service Inheritance
   | Service | Total Vars | Inherited | Overrides | Local Only |
   |---------|------------|-----------|-----------|------------|

4. **For ${service ? service : 'each service'}, show:**
   - Variables inherited from shared (using base value)
   - Variables overriding shared (different from base)
   - Variables unique to service (not in shared)

5. **Recommendations:**
   - Candidates for promotion to shared (same value across services)
   - Potential override conflicts` : ''}

${action === 'promote' ? `## Promote to Shared

${!service ? '⚠️ **Service name required** - Please specify a service to promote from.\n\n' : ''}Please help me promote a service variable to shared:

1. **List service variables** for \`${service || '<service>'}\` using \`vaulter_list\`

2. **Check if variable exists in shared** using \`vaulter_shared_list\`

3. **Promotion process:**
   - Show current value in service
   - Check if other services have same key
   - Show impact (which services will inherit)

4. **Execute promotion:**
   \`\`\`bash
   # Set as shared variable
   vaulter set KEY "value" -e ${environment} --shared

   # Remove from service (optional, keeps as override)
   vaulter delete KEY -e ${environment} -s ${service || '<service>'}
   \`\`\`

5. **Verify promotion:**
   - Use \`vaulter_inheritance_stats\` to confirm
   - Check all services now inherit the value` : ''}

${action === 'override' ? `## Create Override

${!service ? '⚠️ **Service name required** - Please specify a service for the override.\n\n' : ''}Please help me create a service-specific override:

1. **Check current shared value** using \`vaulter_shared_list\`
   - Verify the key exists in shared

2. **Show inheritance impact:**
   - Current: Service inherits shared value
   - After: Service will use its own value

3. **Create override:**
   \`\`\`bash
   # Set service-specific value (overrides shared)
   vaulter set KEY "service-specific-value" -e ${environment} -s ${service || '<service>'}
   \`\`\`

4. **Verify override:**
   - Use \`vaulter_inheritance_stats -s ${service || '<service>'}\`
   - Confirm override count increased

5. **Document reason for override** (recommended):
   - Why does this service need a different value?
   - Is this temporary or permanent?` : ''}

${action === 'audit' ? `## Audit Consistency

Please perform a shared variables audit:

1. **Get all shared variables** using \`vaulter_shared_list\`

2. **Get inheritance stats for all services** using \`vaulter_inheritance_stats\`

3. **Check for issues:**

   ### Orphaned Overrides
   Service vars that override a shared var that no longer exists:
   | Service | Key | Status |
   |---------|-----|--------|

   ### Duplicate Values
   Same value in multiple services (candidate for shared):
   | Key | Value (masked) | Services |
   |-----|----------------|----------|

   ### Override Conflicts
   Different values across services for same key:
   | Key | Shared Value | Service Overrides |
   |-----|--------------|-------------------|

4. **Recommendations:**
   - Variables to promote to shared
   - Overrides to review/remove
   - Missing shared variables

5. **Cleanup commands:**
   \`\`\`bash
   # Remove orphaned override
   vaulter delete KEY -e ${environment} -s <service>

   # Promote to shared
   vaulter set KEY "value" -e ${environment} --shared
   \`\`\`` : ''}`
        }
      }
    ]
  }
}

function getBatchOperationsPrompt(args: Record<string, string>): GetPromptResult {
  const operation = args.operation || 'set'
  const environment = args.environment || 'dev'
  const variables = args.variables || ''
  const shared = args.shared === 'true'

  const operationDescriptions: Record<string, string> = {
    set: 'create/update',
    get: 'retrieve',
    delete: 'remove'
  }

  return {
    description: `Batch ${operationDescriptions[operation] || operation} variables in ${environment}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me perform batch operations on environment variables:

**Operation:** ${operation}
**Environment:** ${environment}
**Variables:** ${variables}
${operation === 'set' && shared ? '**Shared:** Yes (applies to all services)' : ''}

## Batch Operations Overview

Vaulter supports three batch operations to reduce round-trips:

| Tool | Purpose | Input Format |
|------|---------|--------------|
| \`vaulter_multi_get\` | Read multiple vars | \`keys: ["VAR1", "VAR2"]\` |
| \`vaulter_multi_set\` | Set multiple vars | \`variables: {"VAR1": "val1"}\` or \`[{key, value}]\` |
| \`vaulter_multi_delete\` | Delete multiple vars | \`keys: ["VAR1", "VAR2"]\` |

${operation === 'set' ? `## Batch Set Operation

Please:

1. **Parse the variables** from: \`${variables}\`
   - Expected format: JSON object like \`{"VAR1": "val1", "VAR2": "val2"}\`
   - Or comma-separated: \`VAR1=val1,VAR2=val2\`

2. **Validate the variables:**
   - Check for empty keys or values
   - Verify key naming conventions (uppercase, underscores)
   - Identify potential secrets vs configs

3. **Execute batch set** using \`vaulter_multi_set\`:
   \`\`\`json
   {
     "variables": ${variables || '{"VAR1": "value1", "VAR2": "value2"}'},
     "environment": "${environment}"${shared ? ',\n     "shared": true' : ''}
   }
   \`\`\`

4. **Verify the results:**
   - Show which variables were created/updated
   - Confirm final state with \`vaulter_list\`

5. **Recommendations:**
   - Tag sensitive variables appropriately
   - Consider if any should be shared variables` : ''}

${operation === 'get' ? `## Batch Get Operation

Please:

1. **Parse the keys** from: \`${variables}\`
   - Expected format: comma-separated like \`VAR1,VAR2,VAR3\`
   - Or JSON array: \`["VAR1", "VAR2", "VAR3"]\`

2. **Execute batch get** using \`vaulter_multi_get\`:
   \`\`\`json
   {
     "keys": ${variables.startsWith('[') ? variables : `["${variables.split(',').join('", "')}"]`},
     "environment": "${environment}"
   }
   \`\`\`

3. **Display the results:**
   | Key | Value | Status |
   |-----|-------|--------|
   | VAR1 | *** | Found |
   | VAR2 | - | Not found |

4. **Summary:**
   - Total requested: X
   - Found: X
   - Not found: X (list them)` : ''}

${operation === 'delete' ? `## Batch Delete Operation

Please:

1. **Parse the keys** from: \`${variables}\`
   - Expected format: comma-separated like \`VAR1,VAR2,VAR3\`

2. **Verify before deletion:**
   - Use \`vaulter_multi_get\` to confirm these variables exist
   - Show which will be deleted

3. **⚠️ Confirm with user** before executing deletion

4. **Execute batch delete** using \`vaulter_multi_delete\`:
   \`\`\`json
   {
     "keys": ${variables.startsWith('[') ? variables : `["${variables.split(',').join('", "')}"]`},
     "environment": "${environment}"
   }
   \`\`\`

5. **Display results:**
   - ✓ Deleted: VAR1, VAR2
   - ⚠ Not found: VAR3

6. **Verify cleanup:**
   - Confirm variables are removed with \`vaulter_list\`` : ''}

## Best Practices

- **For large batches** (>50 variables): Consider using \`vaulter_push\` with a .env file
- **For shared variables**: Use \`shared: true\` in multi_set to apply to all services
- **For production**: Always preview with \`vaulter_list\` before and after
- **For auditing**: Check \`vaulter_audit_list\` to see batch operation logs`
        }
      }
    ]
  }
}

function getCopyEnvironmentPrompt(args: Record<string, string>): GetPromptResult {
  const source = args.source || 'dev'
  const target = args.target || 'stg'
  const filter = args.filter || 'all'
  const overwrite = args.overwrite === 'true'

  return {
    description: `Copy variables from ${source} to ${target}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me copy environment variables from **${source}** to **${target}**.

## Configuration
- **Source:** ${source}
- **Target:** ${target}
- **Filter:** ${filter === 'all' ? 'All variables' : `Pattern: ${filter}`}
- **Overwrite existing:** ${overwrite ? 'Yes' : 'No'}

## Workflow

Please:

1. **Preview the copy** (dry run first):
   \`\`\`json
   {
     "source": "${source}",
     "target": "${target}",
     ${filter !== 'all' ? `"pattern": "${filter}",` : ''}
     "overwrite": ${overwrite},
     "dryRun": true
   }
   \`\`\`

2. **Show what will be copied:**
   - List variables that will be copied
   - Highlight any that will be skipped (already exist in target)

3. **Confirm with user** before executing

4. **Execute the copy** using \`vaulter_copy\`:
   \`\`\`json
   {
     "source": "${source}",
     "target": "${target}",
     ${filter !== 'all' ? `"pattern": "${filter}",` : ''}
     "overwrite": ${overwrite},
     "dryRun": false
   }
   \`\`\`

5. **Verify the result:**
   - Use \`vaulter_compare\` to show differences
   - Confirm variables were copied correctly

## Safety Tips

- **Always preview first** with dryRun=true
- **Be careful with overwrite=true** - it will replace existing values
- **For production copies**: Consider copying only specific keys instead of all
- **Check audit log** after copy with \`vaulter_audit_list\``
        }
      }
    ]
  }
}

function getSyncWorkflowPrompt(args: Record<string, string>): GetPromptResult {
  const action = args.action || 'diff'
  const environment = args.environment || 'dev'
  const strategy = args.strategy || 'local'
  const prune = args.prune === 'true'

  return {
    description: `Sync workflow: ${action} for ${environment}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me synchronize local .env files with the remote backend.

## Configuration
- **Action:** ${action}
- **Environment:** ${environment}
- **Strategy:** ${strategy} (for conflicts)
${prune ? '- **Prune:** Yes (delete remote vars not in local)\n' : ''}

## Sync Workflow Overview

The recommended workflow for daily operations:

1. **Check what's different** with \`vaulter sync diff\` or \`vaulter_diff\` tool
2. **Push local changes** with \`vaulter sync push\`
3. **Or pull remote changes** with \`vaulter sync pull\`
4. **Or merge bidirectionally** with \`vaulter sync merge\`

---

${action === 'diff' ? `## Diff: Preview Changes

Please:

1. **Show diff** using CLI or MCP tool:

   **CLI:**
   \`\`\`bash
   vaulter sync diff -e ${environment} --values
   \`\`\`

   **MCP Tool:**
   \`\`\`json
   {
     "tool": "vaulter_diff",
     "args": {
       "environment": "${environment}",
       "showValues": true
     }
   }
   \`\`\`

2. **Analyze the output:**

   | Symbol | Meaning |
   |--------|---------|
   | \`+\` | Local only (will be pushed) |
   | \`-\` | Remote only (will be pulled or deleted with --prune) |
   | \`~\` | Different values (conflict - strategy decides winner) |
   | \`=\` | Identical (no action needed) |

3. **Suggest next steps:**
   - If local changes need to go remote: \`vaulter sync push -e ${environment}\`
   - If remote changes need to come local: \`vaulter sync pull -e ${environment}\`
   - If bidirectional sync needed: \`vaulter sync merge -e ${environment} --strategy ${strategy}\`
` : ''}

${action === 'push' ? `## Push: Local → Remote

Please:

1. **Preview first** (always):
   \`\`\`bash
   vaulter sync diff -e ${environment} --values
   \`\`\`

2. **Execute push:**
   \`\`\`bash
   vaulter sync push -e ${environment}${prune ? ' --prune' : ''}
   \`\`\`

   ${prune ? `**⚠️ WARNING:** \`--prune\` will DELETE remote variables not in local!` : ''}

3. **What happens:**
   - Local variables are pushed to remote
   - ${prune ? 'Remote-only variables are DELETED' : 'Remote-only variables are kept'}
   - Conflicts: local value wins (always, push is authoritative)

4. **Verify result:**
   \`\`\`bash
   vaulter sync diff -e ${environment}
   # Should show "All variables are in sync"
   \`\`\`
` : ''}

${action === 'pull' ? `## Pull: Remote → Local

Please:

1. **Preview first:**
   \`\`\`bash
   vaulter sync diff -e ${environment} --values
   \`\`\`

2. **Execute pull:**
   \`\`\`bash
   vaulter sync pull -e ${environment}
   \`\`\`

3. **What happens:**
   - Remote variables are written to local .env file
   - If outputs are configured, writes to output targets too
   - Local-only variables are kept (pull doesn't delete)

4. **For specific output target:**
   \`\`\`bash
   vaulter sync pull -e ${environment} --output web
   \`\`\`

5. **For all outputs:**
   \`\`\`bash
   vaulter sync pull -e ${environment} --all
   \`\`\`
` : ''}

${action === 'merge' ? `## Merge: Bidirectional Sync

Please:

1. **Preview first:**
   \`\`\`bash
   vaulter sync diff -e ${environment} --values
   \`\`\`

2. **Execute merge:**
   \`\`\`bash
   vaulter sync merge -e ${environment} --strategy ${strategy}
   \`\`\`

3. **Strategy options:**

   | Strategy | Behavior |
   |----------|----------|
   | \`local\` | Local value wins on conflict (default) |
   | \`remote\` | Remote value wins on conflict |
   | \`error\` | Fail if any conflicts exist |

4. **What happens:**
   - Local-only vars → pushed to remote
   - Remote-only vars → pulled to local
   - Conflicts → resolved by strategy

5. **To always use remote values:**
   \`\`\`bash
   vaulter sync merge -e ${environment} --strategy remote
   \`\`\`

6. **To fail on conflicts (CI/CD safe):**
   \`\`\`bash
   vaulter sync merge -e ${environment} --strategy error
   \`\`\`
` : ''}

## Safety Tips

- **Always diff first** before push/pull/merge
- **Use \`--dry-run\`** to preview without changes
- **For production:** Consider \`--strategy error\` to catch unexpected conflicts
- **Backup:** \`vaulter export -e ${environment} > backup.env\` before major changes
- **Audit:** Check \`vaulter_audit_list\` after operations`
        }
      }
    ]
  }
}
