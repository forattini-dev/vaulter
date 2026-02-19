/**
 * Vaulter MCP Tool Definitions
 *
 * 16 action-based tools that delegate to the domain layer.
 */

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export function registerTools(): ToolDefinition[] {
  return [
    // ─── 1. vaulter_change ─────────────────────────────────────────────
    {
      name: 'vaulter_change',
      description:
        'Mutate local state (set, delete, move, import). Writes to .vaulter/local/ only — does NOT touch backend. Use vaulter_plan + vaulter_apply to push changes.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['set', 'delete', 'move', 'import'],
            description: 'Mutation action'
          },
          key: { type: 'string', description: 'Variable key (required for set/delete/move)' },
          value: { type: 'string', description: 'Variable value (required for set)' },
          sensitive: { type: 'boolean', description: 'Mark as secret (default: false)', default: false },
          scope: {
            type: 'string',
            description: 'Target scope: "shared" or service name (e.g. "svc-auth")'
          },
          from: { type: 'string', description: 'Source scope for move action' },
          to: { type: 'string', description: 'Target scope for move action' },
          overwrite: { type: 'boolean', description: 'Overwrite target in move (default: false)', default: false },
          deleteOriginal: { type: 'boolean', description: 'Delete source after move (default: true)', default: true },
          vars: {
            type: 'object',
            description: 'Key-value pairs for import action',
            additionalProperties: { type: 'string' }
          },
          environment: { type: 'string', description: 'Target environment (default: from config)' }
        },
        required: ['action']
      }
    },

    // ─── 2. vaulter_plan ───────────────────────────────────────────────
    {
      name: 'vaulter_plan',
      description:
        'Compute a plan: diff local state vs backend. Shows what would change if you apply. Writes plan artifacts (JSON + Markdown) for review.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Target environment' },
          service: { type: 'string', description: 'Filter by service (monorepo)' },
          scope: { type: 'string', description: 'Filter by scope: "shared" or service name' },
          prune: { type: 'boolean', description: 'Include delete actions for remote-only vars', default: false }
        }
      }
    },

    // ─── 3. vaulter_apply ──────────────────────────────────────────────
    {
      name: 'vaulter_apply',
      description:
        'Execute a plan: push local changes to backend. Requires a prior vaulter_plan. Use force=true for production environments.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Target environment' },
          service: { type: 'string', description: 'Filter by service' },
          scope: { type: 'string', description: 'Filter by scope' },
          prune: { type: 'boolean', description: 'Delete remote-only vars', default: false },
          force: { type: 'boolean', description: 'Required for production environments', default: false },
          dryRun: { type: 'boolean', description: 'Preview without applying', default: false }
        }
      }
    },

    // ─── 4. vaulter_get ────────────────────────────────────────────────
    {
      name: 'vaulter_get',
      description:
        'Read variable(s) from backend. Supports single key or multi-get via keys[].',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Single key to get' },
          keys: { type: 'array', items: { type: 'string' }, description: 'Multiple keys to get' },
          environment: { type: 'string', description: 'Target environment' },
          service: { type: 'string', description: 'Service scope' },
          shared: { type: 'boolean', description: 'Get from shared scope' }
        }
      }
    },

    // ─── 5. vaulter_list ───────────────────────────────────────────────
    {
      name: 'vaulter_list',
      description:
        'List variables from backend for a project/environment.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Target environment' },
          service: { type: 'string', description: 'Filter by service' },
          shared: { type: 'boolean', description: 'List shared vars only' },
          showValues: { type: 'boolean', description: 'Show decrypted values', default: false },
          filter: { type: 'string', description: 'Glob pattern filter (e.g. "DATABASE_*")' }
        }
      }
    },

    // ─── 6. vaulter_status ─────────────────────────────────────────────
    {
      name: 'vaulter_status',
      description:
        'Health check and status overview. Actions: scorecard (default), vars, audit, drift, inventory.',
      inputSchema: {
        type: 'object',
        properties: {
          offline: {
            type: 'boolean',
            description: 'Run status from local cache only (no backend connection for scorecard/drift/inventory)'
          },
          action: {
            type: 'string',
            enum: ['scorecard', 'vars', 'audit', 'drift', 'inventory'],
            description: 'Status view (default: scorecard)',
            default: 'scorecard'
          },
          environment: { type: 'string', description: 'Target environment' },
          service: { type: 'string', description: 'Filter by service' },
          pattern: { type: 'string', description: 'Filter audit entries by key pattern' },
          source: { type: 'string', description: 'Filter audit entries by source' },
          operation: { type: 'string', description: 'Filter audit entries by operation' },
          since: { type: 'string', description: 'Audit entries since ISO timestamp' },
          until: { type: 'string', description: 'Audit entries before ISO timestamp' },
          environments: {
            type: 'array',
            items: { type: 'string' },
            description: 'Environments for inventory action'
          },
          limit: { type: 'number', description: 'Limit results for audit action' }
        }
      }
    },

    // ─── 7. vaulter_search ─────────────────────────────────────────────
    {
      name: 'vaulter_search',
      description:
        'Search variables by pattern across environments, or compare two environments.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern to search (e.g. "DATABASE_*")' },
          source: { type: 'string', description: 'Source environment for compare' },
          target: { type: 'string', description: 'Target environment for compare' },
          environments: { type: 'array', items: { type: 'string' }, description: 'Environments to search' },
          service: { type: 'string', description: 'Filter by service' },
          showValues: { type: 'boolean', description: 'Show values in compare', default: false }
        }
      }
    },

    // ─── 8. vaulter_diff ───────────────────────────────────────────────
    {
      name: 'vaulter_diff',
      description:
        'Quick diff: shows what changed locally vs backend without writing plan artifacts.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: { type: 'string', description: 'Target environment' },
          service: { type: 'string', description: 'Filter by service' },
          scope: { type: 'string', description: 'Filter by scope' },
          showValues: { type: 'boolean', description: 'Show actual values', default: false }
        }
      }
    },

    // ─── 9. vaulter_export ─────────────────────────────────────────────
    {
      name: 'vaulter_export',
      description:
        'Export variables in various formats: k8s-secret, k8s-configmap, helm, terraform, env, shell, json.',
      inputSchema: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['k8s-secret', 'k8s-configmap', 'helm', 'terraform', 'env', 'shell', 'json'],
            description: 'Export format (default: shell)',
            default: 'shell'
          },
          environment: { type: 'string', description: 'Target environment' },
          service: { type: 'string', description: 'Filter by service' },
          shared: { type: 'boolean', description: 'Export shared vars' },
          includeShared: { type: 'boolean', description: 'Include shared vars in service export', default: true },
          namespace: { type: 'string', description: 'K8s namespace override' },
          name: { type: 'string', description: 'K8s resource name override' },
          tfFormat: { type: 'string', enum: ['tfvars', 'json'], description: 'Terraform sub-format', default: 'tfvars' }
        }
      }
    },

    // ─── 10. vaulter_key ───────────────────────────────────────────────
    {
      name: 'vaulter_key',
      description:
        'Encryption key management. Actions: generate, list, show, export, import, rotate.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['generate', 'list', 'show', 'export', 'import', 'rotate'],
            description: 'Key action'
          },
          name: { type: 'string', description: 'Key name' },
          environment: { type: 'string', description: 'Environment for key generation' },
          global: { type: 'boolean', description: 'Use global key scope', default: false },
          asymmetric: { type: 'boolean', description: 'Generate asymmetric key pair', default: false },
          algorithm: { type: 'string', enum: ['rsa-4096', 'rsa-2048', 'ec-p256', 'ec-p384'], description: 'Asymmetric algorithm' },
          force: { type: 'boolean', description: 'Overwrite existing key', default: false },
          output: { type: 'string', description: 'Export output path' },
          file: { type: 'string', description: 'Import file path' },
          service: { type: 'string', description: 'Service for rotation' },
          dryRun: { type: 'boolean', description: 'Preview rotation', default: false }
        },
        required: ['action']
      }
    },

    // ─── 11. vaulter_snapshot ──────────────────────────────────────────
    {
      name: 'vaulter_snapshot',
      description:
        'Snapshot management. Actions: create, list, restore, delete.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'list', 'restore', 'delete'],
            description: 'Snapshot action'
          },
          environment: { type: 'string', description: 'Target environment' },
          service: { type: 'string', description: 'Filter by service' },
          id: { type: 'string', description: 'Snapshot ID for restore/delete' },
          name: { type: 'string', description: 'Custom snapshot name' },
          source: { type: 'string', enum: ['cloud', 'local', 'merged'], description: 'Snapshot source', default: 'cloud' }
        },
        required: ['action']
      }
    },

    // ─── 12. vaulter_versions ──────────────────────────────────────────
    {
      name: 'vaulter_versions',
      description:
        'Version history and rollback. Actions: list, get, rollback.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'get', 'rollback'],
            description: 'Versioning action'
          },
          key: { type: 'string', description: 'Variable key' },
          version: { type: 'number', description: 'Version number (for get/rollback)' },
          environment: { type: 'string', description: 'Target environment' },
          service: { type: 'string', description: 'Service scope' },
          showValues: { type: 'boolean', description: 'Show decrypted values', default: false },
          dryRun: { type: 'boolean', description: 'Preview rollback', default: false }
        },
        required: ['action', 'key']
      }
    },

    // ─── 13. vaulter_local ─────────────────────────────────────────────
    {
      name: 'vaulter_local',
      description:
        'Local overrides management. Actions: pull, push, push-all, sync, set, delete, diff, status, shared-set, shared-delete, shared-list.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'pull', 'push', 'push-all', 'sync',
              'set', 'delete', 'diff', 'status',
              'shared-set', 'shared-delete', 'shared-list'
            ],
            description: 'Local action'
          },
          key: { type: 'string', description: 'Variable key (for set/delete/shared-set/shared-delete)' },
          value: { type: 'string', description: 'Variable value (for set/shared-set)' },
          sensitive: { type: 'boolean', description: 'Mark as secret', default: false },
          service: { type: 'string', description: 'Target service' },
          environment: { type: 'string', description: 'Target environment' },
          output: { type: 'string', description: 'Specific output target for pull' },
          all: { type: 'boolean', description: 'Pull/push all outputs', default: true },
          shared: { type: 'boolean', description: 'Push shared vars only' },
          dryRun: { type: 'boolean', description: 'Preview changes', default: false },
          overwrite: { type: 'boolean', description: 'Overwrite backend on push-all', default: false },
          targetEnvironment: { type: 'string', description: 'Override target environment for push' },
          sourceEnvironment: { type: 'string', description: 'Override source environment for sync' }
        },
        required: ['action']
      }
    },

    // ─── 14. vaulter_init ──────────────────────────────────────────────
    {
      name: 'vaulter_init',
      description:
        'Initialize a vaulter project. Detects monorepo and generates .vaulter/ structure.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name override' },
          monorepo: { type: 'boolean', description: 'Force monorepo mode' },
          environments: { type: 'array', items: { type: 'string' }, description: 'Custom environments' },
          backend: { type: 'string', description: 'Backend URL' }
        }
      }
    },

    // ─── 15. vaulter_services ──────────────────────────────────────────
    {
      name: 'vaulter_services',
      description:
        'Discover and list services in a monorepo.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Root path to scan' },
          detailed: { type: 'boolean', description: 'Show detailed info per service', default: false }
        }
      }
    },

    // ─── 16. vaulter_nuke ──────────────────────────────────────────────
    {
      name: 'vaulter_nuke',
      description:
        'Preview what would be deleted from backend. Actual deletion requires CLI confirmation.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    }
  ]
}
