/**
 * Vaulter MCP - Versioning Tool Handlers
 *
 * Handlers for version history and rollback operations
 */

import type { VaulterClient } from '../../../client.js'
import type { VaulterConfig } from '../../../types.js'
import type { ToolResponse } from '../config.js'
import { maskValue } from '../../../lib/masking.js'

/**
 * List version history for a variable
 */
export async function handleListVersions(
  args: any,
  context: { client: VaulterClient; project: string; config: VaulterConfig }
): Promise<ToolResponse> {
  const { client, project, config } = context
  const { key, environment = 'dev', service, showValues = false } = args

  if (!config.versioning?.enabled) {
    return {
      content: [{
        type: 'text',
        text: `⚠️ Versioning is not enabled in config.yaml

Add the following to .vaulter/config.yaml to enable version tracking:

\`\`\`yaml
versioning:
  enabled: true
  retention_mode: count  # or 'days' or 'both'
  max_versions: 10       # keep last 10 versions
\`\`\``
      }]
    }
  }

  try {
    const versions = await client.listVersions(key, project, environment, service)

    if (versions.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No version history found for ${key} in ${environment}

This may mean:
- The variable doesn't exist
- The variable was created before versioning was enabled
- The variable doesn't match versioning patterns in config`
        }]
      }
    }

    // Format output
    const scope = service ? `${project}/${service}/${environment}` : `${project}/${environment}`
    let output = `## Version History: ${key}\n`
    output += `**Scope:** ${scope}\n`
    output += `**Total Versions:** ${versions.length}\n\n`

    for (const v of versions) {
      const isCurrent = v.version === versions[0].version
      const marker = isCurrent ? '●' : '○'
      const label = isCurrent ? `v${v.version} (current)` : `v${v.version}`

      output += `${marker} **${label}**\n`
      output += `  - **Timestamp:** ${formatDate(v.timestamp)}\n`
      output += `  - **User:** ${v.user}\n`
      output += `  - **Operation:** ${v.operation}\n`
      output += `  - **Source:** ${v.source}\n`

      if (showValues) {
        output += `  - **Value:** \`${v.value}\`\n`
      } else {
        output += `  - **Value:** ${maskValue(v.value)}\n`
      }

      output += `  - **Checksum:** ${v.checksum.slice(0, 16)}...\n\n`
    }

    if (!showValues) {
      output += `\n_Use showValues=true to see decrypted values_`
    }

    return { content: [{ type: 'text', text: output }] }
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ Failed to list versions: ${error.message}`
      }]
    }
  }
}

/**
 * Get a specific version of a variable
 */
export async function handleGetVersion(
  args: any,
  context: { client: VaulterClient; project: string; config: VaulterConfig }
): Promise<ToolResponse> {
  const { client, project, config } = context
  const { key, version, environment = 'dev', service } = args

  if (!config.versioning?.enabled) {
    return {
      content: [{
        type: 'text',
        text: `⚠️ Versioning is not enabled. Add versioning.enabled: true to config.yaml`
      }]
    }
  }

  try {
    const versionInfo = await client.getVersion(key, project, environment, version, service)

    if (!versionInfo) {
      return {
        content: [{
          type: 'text',
          text: `❌ Version ${version} not found for key ${key}

Run vaulter_list_versions to see available versions`
        }]
      }
    }

    const scope = service ? `${project}/${service}/${environment}` : `${project}/${environment}`

    const output = `## Version ${version} of ${key}

**Scope:** ${scope}
**Value:** \`${versionInfo.value}\`
**Timestamp:** ${formatDate(versionInfo.timestamp)}
**User:** ${versionInfo.user}
**Operation:** ${versionInfo.operation}
**Source:** ${versionInfo.source}
**Checksum:** ${versionInfo.checksum}`

    return { content: [{ type: 'text', text: output }] }
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ Failed to get version: ${error.message}`
      }]
    }
  }
}

/**
 * Rollback a variable to a previous version
 */
export async function handleRollback(
  args: any,
  context: { client: VaulterClient; project: string; config: VaulterConfig }
): Promise<ToolResponse> {
  const { client, project, config } = context
  const { key, version, environment = 'dev', service, dryRun = false } = args

  if (!config.versioning?.enabled) {
    return {
      content: [{
        type: 'text',
        text: `⚠️ Versioning is not enabled. Add versioning.enabled: true to config.yaml`
      }]
    }
  }

  try {
    // Get target version info
    const versionInfo = await client.getVersion(key, project, environment, version, service)

    if (!versionInfo) {
      return {
        content: [{
          type: 'text',
          text: `❌ Version ${version} not found for key ${key}

Run vaulter_list_versions to see available versions`
        }]
      }
    }

    // Get current value for comparison
    const current = await client.get(key, project, environment, service)
    const currentVersion = current?.metadata?.currentVersion || 0

    if (dryRun) {
      const output = `## 🔄 Rollback Preview (Dry Run)

**Variable:** ${key}
**Environment:** ${environment}
${service ? `**Service:** ${service}\n` : ''}
**From:** v${currentVersion} → \`${maskValue(current?.value || '')}\`
**To:** v${version} → \`${maskValue(versionInfo.value)}\`
**User:** ${versionInfo.user}
**Original Date:** ${formatDate(versionInfo.timestamp)}

_No changes made. Remove dryRun=true to apply rollback._`

      return { content: [{ type: 'text', text: output }] }
    }

    // Perform rollback
    const result = await client.rollback(key, project, environment, version, service, 'mcp')

    const scope = service ? `${project}/${service}/${environment}` : `${project}/${environment}`

    const output = `✓ Rolled back ${key} in ${scope}

**From:** v${currentVersion}
**To:** v${version}
**New Version:** v${result.metadata?.currentVersion} (rollback operation)

Run vaulter_list_versions to see updated history`

    return { content: [{ type: 'text', text: output }] }
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ Failed to rollback: ${error.message}`
      }]
    }
  }
}

// === HELPERS ===

function formatDate(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffHours < 1) return 'just now'
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toISOString().split('T')[0]
}
