/**
 * Vaulter CLI - Export Command Group
 *
 * Export variables to various formats:
 * - shell: For eval $(vaulter export shell)
 * - k8s-secret: Kubernetes Secret YAML
 * - k8s-configmap: Kubernetes ConfigMap YAML
 * - helm: Helm values.yaml
 * - terraform: Terraform .tfvars
 * - docker: Docker --env-file format
 * - vercel: Vercel environment JSON (NEW)
 * - railway: Railway CLI format (NEW)
 * - fly: Fly.io secrets format (NEW)
 * - github-actions: GitHub Actions secrets (NEW)
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../../types.js'
import { SHARED_SERVICE } from '../../../lib/shared.js'

export interface ExportContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  jsonOutput: boolean
  // Export-specific options
  namespace?: string
  name?: string
  shared?: boolean
}

// Available export formats
export const EXPORT_FORMATS = [
  'shell',
  'k8s-secret',
  'k8s-configmap',
  'helm',
  'terraform',
  'docker',
  'vercel',
  'railway',
  'fly',
  'github-actions'
] as const

export type ExportFormat = typeof EXPORT_FORMATS[number]

/**
 * Router for export subcommands
 */
export async function runExportGroup(context: ExportContext): Promise<void> {
  const { args } = context
  const format = args._[1] as ExportFormat | undefined

  // If no format specified or format is a flag, default to shell
  if (!format || format.startsWith('-')) {
    const { runExport } = await import('../export.js')
    await runExport(context)
    return
  }

  switch (format) {
    case 'shell': {
      const { runExport } = await import('../export.js')
      const shiftedArgs = {
        ...args,
        _: ['export', ...args._.slice(2)]
      }
      await runExport({ ...context, args: shiftedArgs })
      break
    }

    case 'k8s-secret': {
      const { runK8sSecret } = await import('../integrations/kubernetes.js')
      const shiftedArgs = {
        ...args,
        _: ['k8s:secret', ...args._.slice(2)]
      }
      await runK8sSecret({ ...context, args: shiftedArgs })
      break
    }

    case 'k8s-configmap': {
      const { runK8sConfigMap } = await import('../integrations/kubernetes.js')
      const shiftedArgs = {
        ...args,
        _: ['k8s:configmap', ...args._.slice(2)]
      }
      await runK8sConfigMap({ ...context, args: shiftedArgs })
      break
    }

    case 'helm': {
      const { runHelmValues } = await import('../integrations/helm.js')
      const shiftedArgs = {
        ...args,
        _: ['helm:values', ...args._.slice(2)]
      }
      await runHelmValues({ ...context, args: shiftedArgs })
      break
    }

    case 'terraform': {
      const { runTfVars } = await import('../integrations/terraform.js')
      const shiftedArgs = {
        ...args,
        _: ['tf:vars', ...args._.slice(2)]
      }
      await runTfVars({ ...context, args: shiftedArgs })
      break
    }

    case 'docker': {
      await runDockerExport(context)
      break
    }

    case 'vercel': {
      await runVercelExport(context)
      break
    }

    case 'railway': {
      await runRailwayExport(context)
      break
    }

    case 'fly': {
      await runFlyExport(context)
      break
    }

    case 'github-actions': {
      await runGitHubActionsExport(context)
      break
    }

    default:
      console.error(`Unknown export format: ${format}`)
      console.error('')
      console.error('Available formats:')
      for (const f of EXPORT_FORMATS) {
        console.error(`  ${f}`)
      }
      process.exit(1)
  }
}

/**
 * Export to Docker --env-file format
 */
async function runDockerExport(context: ExportContext): Promise<void> {
  const { args, config, project, service, environment, verbose, shared } = context

  // Check for --shared flag
  const isShared = args.shared || shared
  const effectiveService = isShared ? SHARED_SERVICE : service

  if (!project) {
    console.error('Error: Project not specified and no config found')
    process.exit(1)
  }

  const { createClientFromConfig } = await import('../../lib/create-client.js')
  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()
    const vars = await client.export(project, environment, effectiveService)

    // Docker env-file format: KEY=value (no quotes, no export)
    for (const [key, value] of Object.entries(vars)) {
      console.log(`${key}=${value}`)
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Export to Vercel environment JSON format
 */
async function runVercelExport(context: ExportContext): Promise<void> {
  const { args, config, project, service, environment, verbose, shared } = context

  // Check for --shared flag
  const isShared = args.shared || shared
  const effectiveService = isShared ? SHARED_SERVICE : service

  if (!project) {
    console.error('Error: Project not specified and no config found')
    process.exit(1)
  }

  const { createClientFromConfig } = await import('../../lib/create-client.js')
  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()
    const vars = await client.export(project, environment, effectiveService)

    // Vercel env format
    const vercelEnv = Object.entries(vars).map(([key, value]) => ({
      key,
      value,
      target: mapEnvironmentToVercel(environment),
      type: 'encrypted'
    }))

    console.log(JSON.stringify(vercelEnv, null, 2))
  } finally {
    await client.disconnect()
  }
}

/**
 * Map vaulter environment to Vercel targets
 */
function mapEnvironmentToVercel(env: Environment): string[] {
  switch (env) {
    case 'prd':
      return ['production']
    case 'stg':
      return ['preview']
    case 'dev':
    default:
      return ['development']
  }
}

/**
 * Export to Railway CLI format
 */
async function runRailwayExport(context: ExportContext): Promise<void> {
  const { args, config, project, service, environment, verbose, shared } = context

  // Check for --shared flag
  const isShared = args.shared || shared
  const effectiveService = isShared ? SHARED_SERVICE : service

  if (!project) {
    console.error('Error: Project not specified and no config found')
    process.exit(1)
  }

  const { createClientFromConfig } = await import('../../lib/create-client.js')
  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()
    const vars = await client.export(project, environment, effectiveService)

    // Railway format: KEY=value (can be piped to railway variables set)
    for (const [key, value] of Object.entries(vars)) {
      // Escape values with special characters
      const escapedValue = value.includes(' ') || value.includes('"')
        ? `"${value.replace(/"/g, '\\"')}"`
        : value
      console.log(`${key}=${escapedValue}`)
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Export to Fly.io secrets format
 */
async function runFlyExport(context: ExportContext): Promise<void> {
  const { args, config, project, service, environment, verbose, shared } = context

  // Check for --shared flag
  const isShared = args.shared || shared
  const effectiveService = isShared ? SHARED_SERVICE : service

  if (!project) {
    console.error('Error: Project not specified and no config found')
    process.exit(1)
  }

  const { createClientFromConfig } = await import('../../lib/create-client.js')
  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()
    const vars = await client.export(project, environment, effectiveService)

    // Fly.io format: KEY=value (can be piped to fly secrets import)
    for (const [key, value] of Object.entries(vars)) {
      console.log(`${key}=${value}`)
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Export to GitHub Actions secrets format
 */
async function runGitHubActionsExport(context: ExportContext): Promise<void> {
  const { args, config, project, service, environment, verbose, shared } = context

  // Check for --shared flag
  const isShared = args.shared || shared
  const effectiveService = isShared ? SHARED_SERVICE : service

  if (!project) {
    console.error('Error: Project not specified and no config found')
    process.exit(1)
  }

  const repo = args.repo as string | undefined

  const { createClientFromConfig } = await import('../../lib/create-client.js')
  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()
    const vars = await client.export(project, environment, effectiveService)

    // GitHub Actions format: gh secret set commands
    console.log('# GitHub Actions secrets')
    console.log('# Run these commands to set secrets:')
    console.log('')

    for (const [key, value] of Object.entries(vars)) {
      // Escape value for shell
      const escapedValue = value.replace(/'/g, "'\\''")
      if (repo) {
        console.log(`gh secret set ${key} --body '${escapedValue}' --repo ${repo}`)
      } else {
        console.log(`gh secret set ${key} --body '${escapedValue}'`)
      }
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * Print help for export command group
 */
export function printExportHelp(): void {
  console.log('Usage: vaulter export <format> [options]')
  console.log('')
  console.log('Formats:')
  console.log('  shell            Shell eval format (default)')
  console.log('  k8s-secret       Kubernetes Secret YAML')
  console.log('  k8s-configmap    Kubernetes ConfigMap YAML')
  console.log('  helm             Helm values.yaml')
  console.log('  terraform        Terraform .tfvars')
  console.log('  docker           Docker --env-file format')
  console.log('  vercel           Vercel environment JSON')
  console.log('  railway          Railway CLI format')
  console.log('  fly              Fly.io secrets format')
  console.log('  github-actions   GitHub Actions gh secret commands')
  console.log('')
  console.log('Options:')
  console.log('  -e, --env        Environment (dev, stg, prd)')
  console.log('  -s, --service    Service name (for monorepos)')
  console.log('  -n, --namespace  Kubernetes namespace')
  console.log('  --repo           GitHub repository (for github-actions)')
  console.log('  --shared         Include shared variables (monorepo)')
  console.log('')
  console.log('Examples:')
  console.log('  eval $(vaulter export shell -e dev)')
  console.log('  vaulter export k8s-secret -e prd | kubectl apply -f -')
  console.log('  vaulter export vercel -e prd > vercel-env.json')
  console.log('  vaulter export railway -e prd | railway variables set')
}
