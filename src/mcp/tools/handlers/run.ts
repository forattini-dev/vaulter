/**
 * vaulter_run handler — execute a command with env vars loaded by vaulter
 *
 * Behavior mirrors `vaulter run`:
 * - Loads environment using config() with optional override settings.
 * - Executes command in a child process with loaded vars applied.
 * - Supports dry-run preview and timeout handling.
 */

import { spawn } from 'node:child_process'
import { config } from '../../../config.js'
import type { ConfigResult } from '../../../config.js'
import type { HandlerContext } from '../index.js'
import type { ToolResponse } from '../config.js'
import { errorResponse, textResponse } from '../config.js'

const DEFAULT_OUTPUT_LIMIT = 8000
const DEFAULT_TIMEOUT_MS = 30000

function truncateText(text: string, max = DEFAULT_OUTPUT_LIMIT): string {
  if (text.length <= max) {
    return text
  }
  const half = Math.floor((max - 24) / 2)
  return `${text.slice(0, half)}\n... [truncated] ...\n${text.slice(-half)}`
}

function parseTimeout(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(100, value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.max(100, parsed)
  }
  return undefined
}

function normalizeSource(source: unknown): 'auto' | 'local' | 'backend' {
  if (source === 'local' || source === 'backend') {
    return source
  }
  return 'auto'
}

export async function handleRun(
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const command = typeof args.command === 'string' ? args.command.trim() : ''
  const commandArgs = Array.isArray(args.args)
    ? args.args.map((arg) => String(arg))
    : []
  const useShell = args.shell === true
  const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : process.cwd()
  const environment = typeof args.environment === 'string' && args.environment.trim()
    ? args.environment.trim()
    : ctx.environment
  const service = typeof args.service === 'string' && args.service.trim()
    ? args.service.trim()
    : ctx.service
  const source = normalizeSource(args.source)
  const override = args.override === true
  const verbose = args.verbose === true
  const dryRun = args['dry-run'] === true || args.dryRun === true
  const timeoutMs = parseTimeout(args.timeout_ms) ?? DEFAULT_TIMEOUT_MS
  const outputLimit = parseTimeout(args.output_limit) ?? DEFAULT_OUTPUT_LIMIT
  const quiet = args.quiet === true

  if (!command) {
    return errorResponse(
      'command is required',
      [
        'Use "command": "pnpm" and "args": ["build"]',
        'For shell expressions, use "command": "pnpm build && pnpm test", "shell": true'
      ]
    )
  }

  if (!useShell && commandArgs.length === 0 && /\s/.test(command)) {
    return errorResponse(
      'Ambiguous command format: command contains spaces but args is empty and shell=false',
      [
        'Set "shell": true for shell expressions',
        'Or split as command/args: "command": "pnpm", "args": ["build"]'
      ]
    )
  }

  const originalEnv = { ...process.env }
  let loadResult: ConfigResult

  try {
    loadResult = await config({
      source,
      environment,
      service,
      cwd,
      override,
      verbose
    })
  } catch (err) {
    return errorResponse(
      `Failed to load env vars: ${err instanceof Error ? err.message : String(err)}`,
      [
        'Verify .vaulter/config.yaml is present',
        'Check backend connectivity (if source=backend)',
        'Retry with source="auto" to fallback to local files'
      ]
    )
  }

  if (dryRun) {
    const commandDisplay = commandArgs.length > 0 ? `${command} ${commandArgs.join(' ')}` : command
    const lines = [
      'Dry run preview',
      `- Command: ${commandDisplay}`,
      `- Service: ${service || '(not set)'}`,
      `- Environment: ${environment}`,
      `- Source: ${source}`,
      `- CWD: ${cwd}`,
      `- Vars loaded: ${loadResult.varsLoaded}`,
      `- Mode: ${loadResult.mode}`,
      `- Source mode: ${loadResult.source}`
    ]
    if (loadResult.skipReason) {
      lines.push(`- Skipped: ${loadResult.skipReason}`)
    }
    if (!quiet && loadResult.loadedFiles.length > 0) {
      lines.push('- Loaded files:')
      lines.push(...loadResult.loadedFiles.map((file) => `  - ${file}`))
    }
    return textResponse(lines.join('\n'))
  }

  const commandEnv = { ...process.env }
  const execCommand = useShell || commandArgs.length === 0
    ? command
    : command

  return await new Promise<ToolResponse>((resolve) => {
    let stdout = ''
    let stderr = ''
    let timeoutHandle: NodeJS.Timeout | null = null
    let timedOut = false

    const child = spawn(execCommand, commandArgs, {
      cwd,
      env: commandEnv,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    if (timeoutMs) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, timeoutMs)
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf-8')
    })

    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      process.env = originalEnv
      resolve(errorResponse(`Failed to execute command: ${err.message}`, [
        'Ensure the command exists in PATH',
        'Check command arguments and permissions',
        'If this is a shell command, set shell=true'
      ]))
    })

    child.on('close', (code, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      process.env = originalEnv

      const summary = [
        `Command: ${commandArgs.length > 0 ? `${command} ${commandArgs.join(' ')}` : command}`,
        `CWD: ${cwd}`,
        `Environment: ${environment}`,
        `Mode: ${loadResult.mode} (${loadResult.source})`,
        `Vars loaded: ${loadResult.varsLoaded}`
      ]

      if (signal) {
        summary.push(`Signal: ${signal}`)
      }

      if (timedOut) {
        resolve(errorResponse(
          `Command timed out after ${timeoutMs}ms`,
          [
            'Increase timeout_ms',
            'Simplify command workload',
            'Check remote dependencies for slow startup'
          ]
        ))
        return
      }

      if ((code ?? 0) !== 0) {
        const failLines = [
          `Command failed with exit code ${code}`,
          ...summary
        ]
        if (stderr.trim()) {
          failLines.push('')
          failLines.push('STDERR:')
          failLines.push(truncateText(stderr, outputLimit))
        }
        resolve(errorResponse(failLines.join('\n')))
        return
      }

      const output = stdout.trim()
      const lines = [
        `✓ Executed successfully`,
        ...summary
      ]
      if (output) {
        lines.push('')
        lines.push('STDOUT:')
        lines.push(truncateText(output, outputLimit))
      }

      if (!quiet && !output && stderr.trim()) {
        lines.push('')
        lines.push('STDERR:')
        lines.push(truncateText(stderr, outputLimit))
      }

      resolve(textResponse(lines.join('\n')))
    })
  })
}
