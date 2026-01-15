/**
 * Vaulter - .env File Parser
 *
 * Robust parser for .env files with support for:
 * - Single, double, and backtick quotes
 * - Escape sequences in double quotes
 * - Variable expansion (${VAR} and $VAR)
 * - Multiline values
 * - Comments
 */

import fs from 'node:fs'

const MAX_LINES_PER_VALUE = 100

export interface ParsedEnv {
  [key: string]: string
}

export interface ParseOptions {
  expand?: boolean // Enable variable expansion (default: true)
  env?: Record<string, string> // Environment for expansion (default: process.env)
}

/**
 * Parse a .env file from path
 */
export function parseEnvFile(filePath: string, options: ParseOptions = {}): ParsedEnv {
  const content = fs.readFileSync(filePath, 'utf-8')
  return parseEnvString(content, options)
}

/**
 * Parse a .env string
 */
export function parseEnvString(content: string, options: ParseOptions = {}): ParsedEnv {
  const { expand = true, env = process.env as Record<string, string> } = options

  const result: ParsedEnv = {}
  const lines = content.split(/\r?\n/)

  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    i++

    // Skip empty lines and comments
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue
    }

    // Parse KEY=VALUE
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*)$/)
    if (!match) {
      continue
    }

    const key = match[1]
    let value = match[2]

    // Handle different quote styles
    if (value.startsWith('"')) {
      // Double quotes - process escape sequences
      const parsed = parseDoubleQuoted(value, lines, i)
      value = parsed.value
      i = parsed.nextIndex
    } else if (value.startsWith("'")) {
      // Single quotes - literal, no escapes
      const parsed = parseSingleQuoted(value, lines, i)
      value = parsed.value
      i = parsed.nextIndex
    } else if (value.startsWith('`')) {
      // Backticks
      const parsed = parseBacktickQuoted(value, lines, i)
      value = parsed.value
      i = parsed.nextIndex
    } else {
      // Unquoted - trim trailing comments
      const commentIndex = value.indexOf('#')
      if (commentIndex > 0) {
        value = value.substring(0, commentIndex).trim()
      }
    }

    // Variable expansion
    if (expand) {
      value = expandVariables(value, { ...env, ...result })
    }

    result[key] = value
  }

  return result
}

/**
 * Parse double-quoted value with escape sequences
 */
function parseDoubleQuoted(
  startValue: string,
  lines: string[],
  currentIndex: number
): { value: string; nextIndex: number } {
  let value = startValue.substring(1) // Remove opening quote
  let lineCount = 0

  // Find closing quote, handling escapes
  let result = ''
  let i = 0
  let index = currentIndex

  while (lineCount < MAX_LINES_PER_VALUE) {
    while (i < value.length) {
      const char = value[i]

      if (char === '\\' && i + 1 < value.length) {
        // Escape sequence
        const next = value[i + 1]
        switch (next) {
          case 'n':
            result += '\n'
            break
          case 'r':
            result += '\r'
            break
          case 't':
            result += '\t'
            break
          case '"':
            result += '"'
            break
          case '\\':
            result += '\\'
            break
          case '$':
            result += '$'
            break
          default:
            result += char + next
        }
        i += 2
      } else if (char === '"') {
        // Closing quote found
        return { value: result, nextIndex: index }
      } else {
        result += char
        i++
      }
    }

    // Need more lines
    if (index >= lines.length) {
      break
    }

    result += '\n'
    value = lines[index]
    index++
    i = 0
    lineCount++
  }

  // No closing quote found, return what we have
  return { value: result, nextIndex: index }
}

/**
 * Parse single-quoted value (literal, no escapes)
 */
function parseSingleQuoted(
  startValue: string,
  lines: string[],
  currentIndex: number
): { value: string; nextIndex: number } {
  let value = startValue.substring(1) // Remove opening quote
  let lineCount = 0

  let result = ''
  let i = 0
  let index = currentIndex

  while (lineCount < MAX_LINES_PER_VALUE) {
    while (i < value.length) {
      const char = value[i]

      if (char === "'" && value[i + 1] !== "'") {
        // Closing quote (not escaped '')
        return { value: result, nextIndex: index }
      } else if (char === "'" && value[i + 1] === "'") {
        // Escaped single quote ('')
        result += "'"
        i += 2
      } else {
        result += char
        i++
      }
    }

    // Need more lines
    if (index >= lines.length) {
      break
    }

    result += '\n'
    value = lines[index]
    index++
    i = 0
    lineCount++
  }

  return { value: result, nextIndex: index }
}

/**
 * Parse backtick-quoted value
 */
function parseBacktickQuoted(
  startValue: string,
  lines: string[],
  currentIndex: number
): { value: string; nextIndex: number } {
  let value = startValue.substring(1) // Remove opening quote
  let lineCount = 0

  let result = ''
  let i = 0
  let index = currentIndex

  while (lineCount < MAX_LINES_PER_VALUE) {
    const closeIndex = value.indexOf('`', i)
    if (closeIndex !== -1) {
      result += value.substring(i, closeIndex)
      return { value: result, nextIndex: index }
    }

    result += value.substring(i)

    // Need more lines
    if (index >= lines.length) {
      break
    }

    result += '\n'
    value = lines[index]
    index++
    i = 0
    lineCount++
  }

  return { value: result, nextIndex: index }
}

/**
 * Expand variables in a value
 * Supports ${VAR}, ${VAR:-default}, $VAR
 */
function expandVariables(value: string, env: Record<string, string>): string {
  // ${VAR:-default} pattern
  value = value.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*):-([^}]*)\}/g, (_, key, defaultVal) => {
    return env[key] ?? defaultVal
  })

  // ${VAR} pattern
  value = value.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key) => {
    return env[key] ?? ''
  })

  // $VAR pattern (word boundary)
  value = value.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
    return env[key] ?? ''
  })

  return value
}

/**
 * Serialize a ParsedEnv object to .env format
 */
export function serializeEnv(env: ParsedEnv): string {
  const lines: string[] = []

  for (const [key, value] of Object.entries(env)) {
    // Determine if we need quotes
    const needsQuotes = value.includes('\n') ||
      value.includes(' ') ||
      value.includes('#') ||
      value.includes('"') ||
      value.includes("'") ||
      value.includes('$') ||
      value.includes('=')

    if (needsQuotes) {
      // Use double quotes and escape special chars
      const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')

      lines.push(`${key}="${escaped}"`)
    } else {
      lines.push(`${key}=${value}`)
    }
  }

  return lines.join('\n')
}

/**
 * Read stdin as .env content
 */
export async function parseEnvFromStdin(options: ParseOptions = {}): Promise<ParsedEnv> {
  return new Promise((resolve, reject) => {
    let data = ''

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      data += chunk
    })
    process.stdin.on('end', () => {
      try {
        const result = parseEnvString(data, options)
        resolve(result)
      } catch (err) {
        reject(err)
      }
    })
    process.stdin.on('error', reject)
  })
}

/**
 * Check if stdin has data (is piped)
 */
export function hasStdinData(): boolean {
  return !process.stdin.isTTY
}
