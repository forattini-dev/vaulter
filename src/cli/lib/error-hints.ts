/**
 * Human-readable CLI operation hints for transient/backend failures.
 */

interface ErrorHintOptions {
  command: string[]
  environment?: string
  timeoutMs?: number
}

function normalizeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || ''
  }
  return typeof error === 'string' ? error : String(error)
}

function includesAny(message: string, tokens: string[]): boolean {
  return tokens.some(token => message.includes(token))
}

function isTimeoutError(message: string): boolean {
  return includesAny(message, [
    'timeout',
    'timed out',
    'operation timed out',
    'socket hang up',
    'econnreset',
    'etimedout',
    'econnrefused',
    'network timeout'
  ])
}

function isPermissionError(message: string): boolean {
  return includesAny(message, [
    'access denied',
    'permission',
    'forbidden',
    'unauthorized',
    'authentication',
    '401',
    '403',
    'not authorized',
    'not allowed'
  ])
}

function isConnectivityError(message: string): boolean {
  return includesAny(message, [
    'failed to connect',
    'connect',
    'econnrefused',
    'enotfound',
    'getaddrinfo',
    'network is unreachable',
    'no such host'
  ])
}

function nextTimeoutSuggestion(currentTimeoutMs: number | undefined): number {
  if (typeof currentTimeoutMs === 'number' && Number.isFinite(currentTimeoutMs) && currentTimeoutMs > 0) {
    return Math.min(currentTimeoutMs * 2, 300000)
  }

  return 60000
}

function isSyncCommand(command: string[]): boolean {
  return command[0] === 'sync' || command[0] === 'release'
}

/**
 * Build actionable CLI suggestions from a backend error.
 */
export function buildErrorHints(error: unknown, options: ErrorHintOptions): string[] {
  const message = normalizeMessage(error).toLowerCase()
  const commandLabel = options.command.join(' ')

  if (message.length === 0) {
    return []
  }

  const hints: string[] = []

  if (isTimeoutError(message)) {
    const suggestedTimeout = nextTimeoutSuggestion(options.timeoutMs)
    const environment = options.environment ? ` -e ${options.environment}` : ''
    hints.push(`Retry ${commandLabel} with a larger timeout: --timeout-ms ${suggestedTimeout}` + environment)
    if (isSyncCommand(options.command)) {
      hints.push('If instability persists, split into smaller groups and retry with --all=false or fewer services')
    }
  }

  if (isPermissionError(message)) {
    const env = options.environment ? ` -e ${options.environment}` : ''
    hints.push(`Permission denied was detected. Run ${commandLabel} -v -e ${options.environment ?? 'dev'} once to confirm auth context.`)
    hints.push('Check backend IAM policies/credentials and run doctor again before retrying.')
  }

  if (!isTimeoutError(message) && isConnectivityError(message)) {
    const env = options.environment ? ` -e ${options.environment}` : ''
    hints.push(`Connectivity issue detected. Verify backend URL and DNS/network, then retry with ${commandLabel}${env}.`)
    hints.push('A quick pre-check: vaulter doctor -e <env> should show connection status before retrying.')
  }

  if (hints.length === 0 && options.timeoutMs && isTimeoutError(message)) {
    const suggestedTimeout = nextTimeoutSuggestion(options.timeoutMs)
    hints.push(`Try retrying with --timeout-ms ${suggestedTimeout}`)
  }

  if (hints.length === 0) {
    if (isSyncCommand(options.command)) {
      hints.push('Use vaulter sync diff -e <env> --values to inspect drift before retrying.')
    }
    hints.push('Re-run with --verbose and share the full command output when reporting this issue.')
  }

  // Keep hints unique and short.
  return [...new Set(hints)]
}
