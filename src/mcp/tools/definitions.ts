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
      description: 'Set an environment variable in the backend (encrypted). Use shared=true for monorepo variables that apply to all services.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable name' },
          value: { type: 'string', description: 'Value to set' },
          environment: { type: 'string', description: 'Environment name (as defined in config)', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name for monorepos' },
          shared: { type: 'boolean', description: 'Set as shared variable (applies to all services in monorepo)', default: false },
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
          service: { type: 'string', description: 'Service name for monorepos' }
        },
        required: ['keys']
      }
    },
    {
      name: 'vaulter_multi_set',
      description: 'Set multiple environment variables in a single call. Accepts an array of key-value pairs or an object with variables.',
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
                    tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' }
                  },
                  required: ['key', 'value']
                },
                description: 'Array of variables: [{ key: "VAR1", value: "val1" }, { key: "VAR2", value: "val2" }]'
              },
              {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'Object with key-value pairs: { "VAR1": "val1", "VAR2": "val2" }'
              }
            ],
            description: 'Variables to set. Can be array of {key, value, tags?} objects or a simple {key: value} object'
          },
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name for monorepos' },
          shared: { type: 'boolean', description: 'Set as shared variables (applies to all services in monorepo)', default: false }
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
          service: { type: 'string', description: 'Service name' }
        },
        required: ['keys']
      }
    },

    // === SYNC TOOLS ===
    {
      name: 'vaulter_sync',
      description: 'Bidirectional sync between local .env file and backend. Local values win on conflict.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          dryRun: { type: 'boolean', description: 'Preview changes without applying', default: false }
        }
      }
    },
    {
      name: 'vaulter_pull',
      description: 'Download variables from backend to local .env file. Overwrites local file.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          output: { type: 'string', description: 'Output file path (default: auto-detected from config)' }
        }
      }
    },
    {
      name: 'vaulter_push',
      description: 'Upload local .env file to backend. Overwrites backend values.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Environment name', default: 'dev' },
          project: { type: 'string', description: 'Project name' },
          service: { type: 'string', description: 'Service name' },
          file: { type: 'string', description: 'Input file path (default: auto-detected from config)' }
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
      description: 'List all services discovered in the monorepo (directories with .vaulter/config.yaml)',
      inputSchema: {
        type: 'object',
        properties: {
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
          environments: { type: 'array', items: { type: 'string' }, description: 'Environments to create', default: ['dev', 'sdx', 'prd'] }
        }
      }
    },

    // === KEY MANAGEMENT TOOLS ===
    {
      name: 'vaulter_key_generate',
      description: 'Generate a new encryption key. Supports symmetric (AES-256) and asymmetric (RSA/EC) keys. Keys are stored in ~/.vaulter/',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Key name (e.g., master, deploy)' },
          project: { type: 'string', description: 'Project name (auto-detected from config if omitted)' },
          global: { type: 'boolean', description: 'Store in global scope (~/.vaulter/global/) instead of project scope', default: false },
          asymmetric: { type: 'boolean', description: 'Generate asymmetric key pair instead of symmetric', default: false },
          algorithm: { type: 'string', description: 'Algorithm for asymmetric keys', enum: ['rsa-4096', 'rsa-2048', 'ec-p256', 'ec-p384'], default: 'rsa-4096' },
          force: { type: 'boolean', description: 'Overwrite existing key', default: false }
        },
        required: ['name']
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
      description: 'Categorize variables by secret patterns. Shows which variables would be treated as secrets vs configs based on naming patterns.',
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
    }
  ]
}
