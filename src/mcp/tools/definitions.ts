/**
 * Vaulter MCP Tools - Tool Definitions
 *
 * All tool schema definitions for the MCP server
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'

/**
 * Register all available tools
 */
export function registerTools(): Tool[] {
  return [
    // === CORE TOOLS ===
    {
      name: 'vaulter_get',
      description: 'Get the value of a single environment variable from the backend',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name to retrieve' },
          environment: { type: 'string', description: 'Environment name (as defined in config)', default: 'dev' },
          project: { type: 'string', description: 'Project name (auto-detected from config if omitted)' },
          service: { type: 'string', description: 'Service name for monorepos' }
        },
        required: ['key']
      }
    },
    {
      name: 'vaulter_set',
      description: 'Set an environment variable in the backend (encrypted). Applies scope-policy checks and optional value guardrails before write.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name' },
          value: { type: 'string', description: 'Value to set' },
          environment: { type: 'string', description: 'Environment name (as defined in config)', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name for monorepos' },
          shared: { type: 'boolean', description: 'Set as shared variable (applies to all services in monorepo)', default: false },
          sensitive: { type: 'boolean', description: 'Mark as sensitive (secret) or not (config). Affects K8s export (Secret vs ConfigMap)', default: false },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization (e.g., ["database", "sensitive"])' }
        },
        required: ['key', 'value']
      }
    },
    {
      name: 'vaulter_delete',
      description: 'Delete an environment variable from the backend',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name to delete' },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' }
        },
        required: ['key']
      }
    },
    {
      name: 'vaulter_list',
      description: 'List all environment variables for a project/environment. By default hides values for security.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          showValues: { type: 'boolean', description: 'Show actual values (default: false for security)', default: false },
          filter: { type: 'string', description: 'Filter keys by pattern (e.g., "DATABASE_*", "*_URL")' }
        }
      }
    },
    {
      name: 'vaulter_export',
      description: 'Export all environment variables in various formats (shell, env, json, yaml, tfvars, docker-args). When a service is specified, shared variables are automatically included (inheritance).',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          format: { type: 'string', description: 'Output format', enum: ['shell', 'env', 'json', 'yaml', 'tfvars', 'docker-args'], default: 'shell' },
          includeShared: { type: 'boolean', description: 'Include shared variables when service is specified (default: true)', default: true }
        }
      }
    },

    // === BATCH OPERATIONS ===
    {
      name: 'vaulter_multi_get',
      description: 'Get multiple environment variables by keys in a single call. Returns key-value pairs for found variables.',
      inputSchema: {
        type: 'object',
        properties: {
          keys: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of variable names to retrieve (e.g., ["DATABASE_URL", "API_KEY", "SECRET"])'
          },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name (auto-detected from config if omitted)' },
          service: { type: 'string', description: 'Service name for monorepos' },
          timeout_ms: { type: 'number', description: 'Override timeout for this operation in milliseconds (default: 30000 = 30s)', minimum: 1000, maximum: 300000 }
        },
        required: ['keys']
      }
    },
    {
      name: 'vaulter_multi_set',
      description: 'Set multiple environment variables in a single call. Applies scope-policy checks and optional value guardrails before write.',
      inputSchema: {
        type: 'object',
        properties: {
          variables: {
            oneOf: [
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string', description: 'Variable name' },
                    value: { type: 'string', description: 'Variable value' },
                    sensitive: { type: 'boolean', description: 'Mark as sensitive (secret) or not (config)', default: false },
                    tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' }
                  },
                  required: ['key', 'value']
                },
                description: 'Array of variables: [{ key: "VAR1", value: "val1", sensitive: true }, { key: "VAR2", value: "val2" }]'
              },
              {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'Object with key-value pairs: { "VAR1": "val1", "VAR2": "val2" } (all marked as config/not sensitive)'
              }
            ],
            description: 'Variables to set. Can be array of {key, value, sensitive?, tags?} objects or a simple {key: value} object'
          },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name for monorepos' },
          shared: { type: 'boolean', description: 'Set as shared variables (applies to all services in monorepo)', default: false },
          sensitive: { type: 'boolean', description: 'Default sensitive flag for all variables (overridden by per-variable sensitive)', default: false },
          timeout_ms: { type: 'number', description: 'Override timeout for this operation in milliseconds (default: 30000 = 30s). Useful for large batches.', minimum: 1000, maximum: 300000 }
        },
        required: ['variables']
      }
    },
    {
      name: 'vaulter_multi_delete',
      description: 'Delete multiple environment variables by keys in a single call.',
      inputSchema: {
        type: 'object',
        properties: {
          keys: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of variable names to delete (e.g., ["OLD_VAR1", "OLD_VAR2", "DEPRECATED_KEY"])'
          },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          timeout_ms: { type: 'number', description: 'Override timeout for this operation in milliseconds (default: 30000 = 30s)', minimum: 1000, maximum: 300000 }
        },
        required: ['keys']
      }
    },

    // === SYNC TOOLS ===
    {
      name: 'vaulter_pull',
      description: 'Download variables from backend. Use all=true for output targets, dir=true for .vaulter/{env}/ directory structure.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          output: { type: 'string', description: 'Output target name (e.g., web, api)' },
          all: { type: 'boolean', description: 'Pull to ALL output targets defined in config', default: false },
          dir: { type: 'boolean', description: 'Pull to .vaulter/{env}/ directory structure', default: false },
          dryRun: { type: 'boolean', description: 'Preview changes without applying', default: false }
        }
      }
    },
    {
      name: 'vaulter_push',
      description: 'Upload to backend. Use dir=true to push .vaulter/{env}/ directory structure.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          file: { type: 'string', description: 'Input file path (default: auto-detected from config)' },
          dir: { type: 'boolean', description: 'Push .vaulter/{env}/ directory structure', default: false },
          prune: { type: 'boolean', description: 'Delete remote vars not in local source', default: false },
          dryRun: { type: 'boolean', description: 'Preview changes without applying', default: false }
        }
      }
    },
    {
      name: 'vaulter_sync_plan',
      description: 'Plan/apply a sync flow (merge/push/pull) with preview-first workflow.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Sync action to run',
            enum: ['merge', 'push', 'pull']
          },
          apply: { type: 'boolean', description: 'Apply planned changes (default: false, preview only)', default: false },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          file: { type: 'string', description: 'Input file path (default: auto-detected from config)' },
          output: { type: 'string', description: 'Output path when pulling' },
          prune: { type: 'boolean', description: 'For push: delete remote vars not present in local source', default: false },
          strategy: { type: 'string', description: 'For merge conflict strategy: local, remote, error', enum: ['local', 'remote', 'error'] },
          dryRun: { type: 'boolean', description: 'Explicit preview mode (default: true when apply=false)', default: false },
          shared: { type: 'boolean', description: 'Target shared variables for push (monorepo)', default: false }
        },
        required: ['action']
      }
    },
    {
      name: 'vaulter_release',
      description: 'High-level release workflow (plan/apply + direct push/pull/merge/diff/status) for AI-friendly operations.',
      inputSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            description: 'Release operation: plan, apply, push, pull, merge, diff, status',
            enum: ['plan', 'apply', 'push', 'pull', 'merge', 'diff', 'status'],
            default: 'plan'
          },
          action: {
            type: 'string',
            description: 'Action used with plan/apply/push/pull/merge',
            enum: ['merge', 'push', 'pull']
          },
          apply: {
            type: 'boolean',
            description: 'Alias for applying a plan when operation=plan (default: false).',
            default: false
          },
          environment: {
            type: 'string',
            description: 'Environment name',
            default: 'dev'
          },
          project: {
            type: 'string',
            description: 'Project name'
          },
          service: {
            type: 'string',
            description: 'Service name'
          },
          file: {
            type: 'string',
            description: 'Input file path (default: auto-detected from config)'
          },
          output: {
            type: 'string',
            description: 'Output path when pulling'
          },
          all: {
            type: 'boolean',
            description: 'For pull operations: pull to all output targets',
            default: false
          },
          dir: {
            type: 'boolean',
            description: 'Push/pull using .vaulter/{env}/ directory structure',
            default: false
          },
          prune: {
            type: 'boolean',
            description: 'For push: delete remote vars not present in local source',
            default: false
          },
          strategy: {
            type: 'string',
            description: 'For merge conflict strategy: local, remote, error',
            enum: ['local', 'remote', 'error']
          },
          dryRun: {
            type: 'boolean',
            description: 'Preview only (mainly for plan/status-driven flows)',
            default: false
          },
          shared: {
            type: 'boolean',
            description: 'Target shared vars for push (monorepo)',
            default: false
          },
          values: {
            type: 'boolean',
            description: 'Show masked values in diff output',
            default: false
          }
        }
      }
    },

    // === ANALYSIS TOOLS ===
    {
      name: 'vaulter_compare',
      description: 'Compare environment variables between two environments. Shows added, removed, and changed variables.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Source environment name', default: 'dev' },
          target: { type: 'string', description: 'Target environment name', default: 'prd' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          showValues: { type: 'boolean', description: 'Show actual values in diff', default: false }
        },
        required: ['source', 'target']
      }
    },
    {
      name: 'vaulter_search',
      description: 'Search for variables by key pattern across all environments',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (e.g., "DATABASE_*", "*_SECRET", "*redis*")' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          environments: { type: 'array', items: { type: 'string' }, description: 'Environments to search (default: from config or dev/stg/prd)' }
        },
        required: ['pattern']
      }
    },

    // === MONOREPO TOOLS ===
    {
      name: 'vaulter_scan',
      description: 'Scan monorepo to discover all packages/apps. Detects NX, Turborepo, Lerna, pnpm workspaces, Yarn workspaces, and Rush. Shows which packages have .env files and which need vaulter initialization.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Root directory to scan (default: current directory)' },
          format: { type: 'string', description: 'Output format', enum: ['text', 'json'], default: 'text' }
        }
      }
    },
    {
      name: 'vaulter_services',
      description: 'List monorepo services discovered from local service configs and/or config.services declarations',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Root directory to scan for services (default: current directory)' },
          detailed: { type: 'boolean', description: 'Show detailed info (environments, backend URLs)', default: false }
        }
      }
    },

    // === KUBERNETES TOOLS ===
    {
      name: 'vaulter_k8s_secret',
      description: 'Generate Kubernetes Secret YAML from environment variables. Ready to pipe to kubectl apply.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          namespace: { type: 'string', description: 'K8s namespace (default: project-environment)' },
          name: { type: 'string', description: 'Secret name (default: project-secrets or service-secrets)' }
        }
      }
    },
    {
      name: 'vaulter_k8s_configmap',
      description: 'Generate Kubernetes ConfigMap YAML from non-secret variables. Automatically filters out sensitive vars.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          namespace: { type: 'string', description: 'K8s namespace' },
          name: { type: 'string', description: 'ConfigMap name' }
        }
      }
    },

    // === TERRAFORM TOOLS ===
    {
      name: 'vaulter_helm_values',
      description: 'Generate Helm values.yaml from environment variables. Separates variables into env (plain) and secrets sections.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' }
        }
      }
    },
    {
      name: 'vaulter_tf_vars',
      description: 'Generate Terraform .tfvars file from environment variables. Converts names to lowercase and includes an env_vars map.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          format: { type: 'string', description: 'Output format', enum: ['tfvars', 'json'], default: 'tfvars' }
        }
      }
    },

    // === SETUP TOOLS ===
    {
      name: 'vaulter_init',
      description: 'Initialize a new vaulter project. Creates .vaulter/ directory with config.yaml, local/ for development, and deploy/ for CI/CD.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name (auto-detected from directory name if omitted)' },
          backend: { type: 'string', description: 'Backend URL (e.g., s3://bucket/path, file:///path)' },
          monorepo: { type: 'boolean', description: 'Force monorepo mode (auto-detected from nx.json, turbo.json, etc.)', default: false },
          environments: { type: 'array', items: { type: 'string' }, description: 'Environments to create', default: ['dev', 'stg', 'sdx', 'prd'] }
        }
      }
    },

    // === KEY MANAGEMENT TOOLS ===
    {
      name: 'vaulter_key_generate',
      description: 'Generate a new encryption key. Supports per-environment keys for complete isolation. Keys are stored in ~/.vaulter/projects/{project}/keys/',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Key name (e.g., master, deploy). If not provided, uses environment name or "master"' },
          environment: { type: 'string', description: 'Target environment (creates key named after env, e.g., dev, stg, prd)' },
          project: { type: 'string', description: 'Project name (auto-detected from config if omitted)' },
          global: { type: 'boolean', description: 'Store in global scope (~/.vaulter/global/) instead of project scope', default: false },
          asymmetric: { type: 'boolean', description: 'Generate asymmetric key pair instead of symmetric', default: false },
          algorithm: { type: 'string', description: 'Algorithm for asymmetric keys', enum: ['rsa-4096', 'rsa-2048', 'ec-p256', 'ec-p384'], default: 'rsa-4096' },
          force: { type: 'boolean', description: 'Overwrite existing key', default: false }
        }
      }
    },
    {
      name: 'vaulter_key_list',
      description: 'List all encryption keys (project and global). Shows key type, algorithm, and status.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name (auto-detected from config if omitted)' }
        }
      }
    },
    {
      name: 'vaulter_key_show',
      description: 'Show detailed information about a specific key.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Key name to show' },
          project: { type: 'string', description: 'Project name' },
          global: { type: 'boolean', description: 'Look in global scope', default: false }
        },
        required: ['name']
      }
    },
    {
      name: 'vaulter_key_export',
      description: 'Export a key to an encrypted bundle file. Use VAULTER_EXPORT_PASSPHRASE env var to set encryption passphrase.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Key name to export' },
          output: { type: 'string', description: 'Output file path for the encrypted bundle' },
          project: { type: 'string', description: 'Project name' },
          global: { type: 'boolean', description: 'Export from global scope', default: false }
        },
        required: ['name', 'output']
      }
    },
    {
      name: 'vaulter_key_import',
      description: 'Import a key from an encrypted bundle file. Use VAULTER_EXPORT_PASSPHRASE env var to decrypt.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Input bundle file path' },
          name: { type: 'string', description: 'New name for the imported key (optional, uses original name from bundle)' },
          project: { type: 'string', description: 'Project name' },
          global: { type: 'boolean', description: 'Import to global scope', default: false },
          force: { type: 'boolean', description: 'Overwrite existing key', default: false }
        },
        required: ['file']
      }
    },
    {
      name: 'vaulter_key_rotate',
      description: 'Rotate encryption key. Exports all variables (decrypted), generates new key, re-encrypts all variables, and backs up old key. Safe operation with automatic rollback on failure.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name (for monorepos)' },
          keyName: { type: 'string', description: 'Key name to rotate (default: master or from config)' },
          dryRun: { type: 'boolean', description: 'Preview what would be rotated without making changes', default: false }
        }
      }
    },

    // === AUDIT TOOLS ===
    {
      name: 'vaulter_audit_list',
      description: 'List audit log entries showing who changed what and when. Supports filtering by user, operation, date range, and key pattern.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          user: { type: 'string', description: 'Filter by user name' },
          operation: { type: 'string', description: 'Filter by operation type', enum: ['set', 'delete', 'sync', 'push', 'rotate', 'deleteAll'] },
          key: { type: 'string', description: 'Filter by key pattern (supports * wildcards, e.g., "DATABASE_*")' },
          since: { type: 'string', description: 'Filter entries after this date (ISO 8601 format)' },
          until: { type: 'string', description: 'Filter entries before this date (ISO 8601 format)' },
          limit: { type: 'number', description: 'Maximum number of entries to return (default: 50)', default: 50 }
        }
      }
    },

    // === CATEGORIZATION TOOLS ===
    {
      name: 'vaulter_categorize_vars',
      description: 'Categorize variables by their sensitive flag. Shows which variables are secrets (sensitive=true, encrypted) vs configs (sensitive=false, plain).',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' }
        }
      }
    },

    // === SHARED VARIABLES TOOLS (MONOREPO) ===
    {
      name: 'vaulter_shared_list',
      description: 'List shared variables that apply to all services in a monorepo. Shared vars are inherited by all services unless overridden.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          showValues: { type: 'boolean', description: 'Show actual values', default: false }
        }
      }
    },
    {
      name: 'vaulter_inheritance_info',
      description: 'Show inheritance information for a service. Displays which variables are inherited from shared, which are overridden, and which are service-only.',
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Service name (required)' },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' }
        },
        required: ['service']
      }
    },

    // === DANGEROUS OPERATIONS (preview only) ===
    {
      name: 'vaulter_nuke_preview',
      description: 'Preview what would be deleted by a nuke operation. Returns summary of data and CLI command to execute. IMPORTANT: The actual nuke must be executed via CLI for safety - this tool only shows the preview.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name' }
        }
      }
    },

    // === STATUS TOOL (consolidated) ===
    {
      name: 'vaulter_status',
      description: 'Get comprehensive status including encryption config, rotation status, and audit summary. Use include parameter to select sections.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          include: {
            type: 'array',
            items: { type: 'string', enum: ['encryption', 'rotation', 'audit', 'all'] },
            description: 'Sections to include (default: all)',
            default: ['all']
          },
          overdue_only: { type: 'boolean', description: 'For rotation: only show overdue secrets', default: false }
        }
      }
    },

    // === UTILITY TOOLS (for full autonomy) ===
    {
      name: 'vaulter_copy',
      description: 'Copy variables from one environment to another. Useful for promoting configs from dev to stg/prd. Can copy all vars or filter by pattern.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Source environment (e.g., dev)' },
          target: { type: 'string', description: 'Target environment (e.g., stg, prd)' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name (for monorepos)' },
          keys: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific keys to copy. If omitted, copies all vars.'
          },
          pattern: { type: 'string', description: 'Pattern to filter keys (e.g., "DATABASE_*", "*_URL"). Ignored if keys is provided.' },
          overwrite: { type: 'boolean', description: 'Overwrite existing vars in target (default: false)', default: false },
          dryRun: { type: 'boolean', description: 'Preview what would be copied without making changes', default: false }
        },
        required: ['source', 'target']
      }
    },
    {
      name: 'vaulter_move',
      description: 'Move/copy a variable between scopes in one operation. Applies scope-policy checks and atomic rollback on write failures.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name to move' },
          from: { type: 'string', description: 'Source scope (shared or service:<name>)' },
          to: { type: 'string', description: 'Destination scope (shared or service:<name>)' },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          overwrite: { type: 'boolean', description: 'Overwrite destination value if it exists', default: false },
          dryRun: { type: 'boolean', description: 'Preview action without applying', default: false },
          deleteOriginal: { type: 'boolean', description: 'Delete source variable after move (default: true). Set false to copy.', default: true }
        },
        required: ['key', 'from', 'to']
      }
    },
    {
      name: 'vaulter_rename',
      description: 'Rename a variable (atomic operation). Copies value to new key and deletes old key.',
      inputSchema: {
        type: 'object',
        properties: {
          oldKey: { type: 'string', description: 'Current variable name' },
          newKey: { type: 'string', description: 'New variable name' },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name (for monorepos)' }
        },
        required: ['oldKey', 'newKey']
      }
    },
    {
      name: 'vaulter_promote_shared',
      description: 'Promote a service-specific variable to shared (applies to all services). Applies scope-policy checks and atomic rollback on write failures.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name to promote' },
          fromService: { type: 'string', description: 'Service where the var currently exists' },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          deleteOriginal: { type: 'boolean', description: 'Delete the original service var after promoting (default: true)', default: true }
        },
        required: ['key', 'fromService']
      }
    },
    {
      name: 'vaulter_demote_shared',
      description: 'Demote a shared variable to a specific service. Applies scope-policy checks and atomic rollback on write failures.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name to demote' },
          toService: { type: 'string', description: 'Target service for the var' },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          deleteShared: { type: 'boolean', description: 'Delete the shared var after demoting (default: true)', default: true }
        },
        required: ['key', 'toService']
      }
    },

    // === DIAGNOSTIC TOOLS (for AI agents) ===
    {
      name: 'vaulter_doctor',
      description: 'IMPORTANT: Call this FIRST to diagnose vaulter configuration health. Returns comprehensive status including config, backend, encryption, local files, and connection. Provides actionable suggestions for issues found. Essential for AI agents to understand current state before performing operations.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment to check (default: dev)', default: 'dev' },
          project: { type: 'string', description: 'Project name (auto-detected from config if omitted)' },
          service: { type: 'string', description: 'Service name (for monorepos)' },
          fix: { type: 'boolean', description: 'Apply safe repository fixes (currently .gitignore hygiene)', default: false }
        }
      }
    },
    {
      name: 'vaulter_clone_env',
      description: 'Clone ALL variables from one environment to another. Simpler than vaulter_copy when you want to duplicate an entire environment. Use dryRun=true to preview first. Perfect for populating empty environments (e.g., clone dev to stg before first deploy).',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Source environment to clone from (e.g., dev)' },
          target: { type: 'string', description: 'Target environment to clone to (e.g., stg, prd)' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name (for monorepos)' },
          includeShared: { type: 'boolean', description: 'Include shared variables (default: true)', default: true },
          overwrite: { type: 'boolean', description: 'Overwrite existing vars in target (default: false)', default: false },
          dryRun: { type: 'boolean', description: 'Preview what would be cloned without making changes (RECOMMENDED: use this first)', default: false }
        },
        required: ['source', 'target']
      }
    },
    // === LOCAL OVERRIDES TOOLS ===
    {
      name: 'vaulter_local_pull',
      description: 'Pull base environment + local shared vars + service overrides to output targets (.env files). Merge order: backend < local shared < service overrides. Local files never touch the backend. Single repo: configs.env/secrets.env at root. Monorepo: shared/ and services/<name>/ with configs.env/secrets.env.',
      inputSchema: {
        type: 'object',
        properties: {
          output: { type: 'string', description: 'Specific output target name' },
          all: { type: 'boolean', description: 'Pull to all output targets', default: false },
          service: { type: 'string', description: 'Service name (for monorepos)' }
        }
      }
    },
    {
      name: 'vaulter_local_push',
      description: 'Push local overrides to remote backend. This allows sharing local development configs with the team. In monorepos, service is required unless shared=true. Compares local vars with remote and pushes only changed values.',
      inputSchema: {
        type: 'object',
        properties: {
          shared: { type: 'boolean', description: 'Push shared vars instead of service-specific', default: false },
          service: { type: 'string', description: 'Service name (for monorepos)' },
          targetEnvironment: { type: 'string', description: 'Target environment (defaults to base env from config)' },
          dryRun: { type: 'boolean', description: 'Preview changes without applying', default: false }
        }
      }
    },
    {
      name: 'vaulter_local_set',
      description: 'Set a service-specific local override. Routes to configs.env (sensitive=false) or secrets.env (sensitive=true). In monorepo, service is required. Local files never touch the backend. Single repo: .vaulter/local/[configs|secrets].env. Monorepo: .vaulter/local/services/<svc>/[configs|secrets].env',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name' },
          value: { type: 'string', description: 'Value to set' },
          service: { type: 'string', description: 'Service name (for monorepos)' },
          sensitive: { type: 'boolean', description: 'If true, writes to secrets.env. If false (default), writes to configs.env', default: false }
        },
        required: ['key', 'value']
      }
    },
    {
      name: 'vaulter_local_delete',
      description: 'Remove a service-specific local override (removes from both configs.env and secrets.env). In monorepo, service is required.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name to remove' },
          service: { type: 'string', description: 'Service name (for monorepos)' }
        },
        required: ['key']
      }
    },
    {
      name: 'vaulter_local_shared_set',
      description: 'Set a local shared variable. Routes to shared/configs.env (sensitive=false) or shared/secrets.env (sensitive=true). Shared vars apply to ALL services in a monorepo. Use for vars like DEBUG, LOG_LEVEL that should be the same everywhere.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name' },
          value: { type: 'string', description: 'Value to set' },
          sensitive: { type: 'boolean', description: 'If true, writes to secrets.env. If false (default), writes to configs.env', default: false }
        },
        required: ['key', 'value']
      }
    },
    {
      name: 'vaulter_local_shared_delete',
      description: 'Remove a local shared variable (removes from both shared/configs.env and shared/secrets.env).',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name to remove' }
        },
        required: ['key']
      }
    },
    {
      name: 'vaulter_local_shared_list',
      description: 'List all local shared variables (from both shared/configs.env and shared/secrets.env). These vars apply to ALL services in the monorepo.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'vaulter_local_push_all',
      description: 'Push ENTIRE .vaulter/local/ structure to backend. This pushes shared vars AND all service-specific vars at once. Use overwrite=true to DELETE backend vars that don\'t exist locally (makes backend match local exactly).',
      inputSchema: {
        type: 'object',
        properties: {
          targetEnvironment: { type: 'string', description: 'Target environment (defaults to base env from config)' },
          dryRun: { type: 'boolean', description: 'Preview changes without applying', default: false },
          overwrite: { type: 'boolean', description: 'Delete backend vars that don\'t exist locally (destructive!)', default: false }
        }
      }
    },
    {
      name: 'vaulter_local_sync',
      description: 'Pull from backend to .vaulter/local/. This syncs the team\'s shared variables to your local environment. The opposite of vaulter_local_push_all. After sync, run vaulter_local_pull all=true to generate .env files.',
      inputSchema: {
        type: 'object',
        properties: {
          sourceEnvironment: { type: 'string', description: 'Source environment to pull from (defaults to base env from config)' },
          dryRun: { type: 'boolean', description: 'Preview changes without applying', default: false }
        }
      }
    },
    {
      name: 'vaulter_local_diff',
      description: 'Show local overrides vs base environment. Shows which variables are added or modified locally (both shared and service-specific). In monorepo, service is required.',
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Service name (for monorepos)' }
        }
      }
    },
    {
      name: 'vaulter_local_status',
      description: 'Show local status: base environment, shared vars count, service overrides count, snapshots count.',
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Service name (for monorepos)' }
        }
      }
    },

    // === SNAPSHOT TOOLS ===
    {
      name: 'vaulter_snapshot_create',
      description: 'Create a timestamped snapshot. Sources: cloud (remote backend, default), local (local overrides only), merged (cloud + local). Useful for backup before making changes or sharing configurations.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment to snapshot', default: 'dev' },
          name: { type: 'string', description: 'Optional name suffix for the snapshot' },
          service: { type: 'string', description: 'Service name (for monorepos)' },
          source: { type: 'string', enum: ['cloud', 'local', 'merged'], description: 'Source for snapshot data: cloud (remote backend), local (local overrides), merged (cloud + local)', default: 'cloud' }
        },
        required: ['environment']
      }
    },
    {
      name: 'vaulter_snapshot_list',
      description: 'List all snapshots, optionally filtered by environment.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Filter by environment' }
        }
      }
    },
    {
      name: 'vaulter_snapshot_restore',
      description: 'Restore a snapshot to the backend. Pushes all variables from the snapshot to the specified environment.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Snapshot ID (from snapshot list)' },
          environment: { type: 'string', description: 'Target environment to restore to' },
          service: { type: 'string', description: 'Service name (for monorepos)' }
        },
        required: ['id', 'environment']
      }
    },

    {
      name: 'vaulter_diff',
      description: 'Show differences between local file and remote backend. Essential for understanding what will change before push/pull operations. Use showValues=true to see masked values.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment to compare (default: dev)', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name (for monorepos)' },
          showValues: { type: 'boolean', description: 'Show masked values in diff (e.g., pg://us***)', default: false }
        }
      }
    },

    // === VERSIONING TOOLS ===
    {
      name: 'vaulter_list_versions',
      description: 'List version history for a variable (requires versioning enabled in config). Shows all previous values with timestamps, users, and operations.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name' },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name (for monorepos)' },
          showValues: { type: 'boolean', description: 'Show decrypted values (default: masked for security)', default: false }
        },
        required: ['key']
      }
    },
    {
      name: 'vaulter_get_version',
      description: 'Get a specific version of a variable by version number (requires versioning enabled in config)',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name' },
          version: { type: 'number', description: 'Version number to retrieve' },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name (for monorepos)' }
        },
        required: ['key', 'version']
      }
    },
    {
      name: 'vaulter_rollback',
      description: 'Rollback a variable to a previous version (requires versioning enabled in config). Creates a new version with the old value.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name to rollback' },
          version: { type: 'number', description: 'Target version number to rollback to' },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name (for monorepos)' },
          dryRun: { type: 'boolean', description: 'Preview changes without applying', default: false }
        },
        required: ['key', 'version']
      }
    }
  ]
}
