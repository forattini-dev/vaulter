/**
 * Secret detection utilities based on glob patterns.
 */

import type { MiniEnvConfig } from '../types.js'
import { DEFAULT_SECRET_PATTERNS } from '../types.js'
import { compileGlobPatterns } from './pattern-matcher.js'

export function getSecretPatterns(config?: MiniEnvConfig | null): string[] {
  const patterns = config?.security?.auto_encrypt?.patterns
  if (patterns && patterns.length > 0) {
    return patterns
  }
  return DEFAULT_SECRET_PATTERNS
}

export function splitVarsBySecret(
  vars: Record<string, string>,
  patterns: string[]
): { secrets: Record<string, string>; plain: Record<string, string> } {
  const isSecret = compileGlobPatterns(patterns)
  const secrets: Record<string, string> = {}
  const plain: Record<string, string> = {}

  for (const [key, value] of Object.entries(vars)) {
    if (isSecret(key)) {
      secrets[key] = value
    } else {
      plain[key] = value
    }
  }

  return { secrets, plain }
}
