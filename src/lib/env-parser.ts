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
import path from 'node:path'

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

// ============================================================================
// Section-Aware .env Management
// ============================================================================

/** Marker line that separates user vars from Vaulter-managed vars */
export const VAULTER_SECTION_MARKER = '# --- VAULTER MANAGED (do not edit below) ---'
export const VAULTER_SECTION_END = '# --- END VAULTER ---'

export interface EnvFileSections {
  /** Lines before the marker (user-managed) */
  userLines: string[]
  /** Key-value pairs in Vaulter section */
  vaulterVars: Map<string, string>
  /** Whether the file had a Vaulter section */
  hadMarker: boolean
}

/**
 * Parse .env file into user section and Vaulter-managed section
 */
export function parseEnvFileSections(filePath: string): EnvFileSections {
  const result: EnvFileSections = {
    userLines: [],
    vaulterVars: new Map(),
    hadMarker: false,
  }

  if (!fs.existsSync(filePath)) {
    return result
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  let inVaulterSection = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Check for section markers
    if (trimmed.startsWith('# --- VAULTER')) {
      inVaulterSection = true
      result.hadMarker = true
      continue
    }
    if (trimmed === VAULTER_SECTION_END) {
      inVaulterSection = false
      continue
    }

    if (inVaulterSection) {
      // Skip comments and empty lines in Vaulter section (they're metadata)
      if (!trimmed || trimmed.startsWith('#')) continue

      // Parse key=value
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim()
        let value = trimmed.substring(eqIndex + 1).trim()
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        result.vaulterVars.set(key, value)
      }
    } else {
      // User section - keep all lines as-is
      result.userLines.push(line)
    }
  }

  // Remove trailing empty lines from user section
  while (result.userLines.length > 0 && !result.userLines[result.userLines.length - 1].trim()) {
    result.userLines.pop()
  }

  return result
}

/**
 * Format a value for .env file (add quotes if needed)
 */
function formatEnvValue(value: string): string {
  const needsQuotes = value.includes(' ') || value.includes('"') || value.includes("'") || value.includes('\n') || value.includes('#') || value.includes('$')
  if (needsQuotes) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
  }
  return value
}

/**
 * Write .env file with separate user and Vaulter sections
 */
export function writeEnvFileSections(filePath: string, sections: EnvFileSections): void {
  const lines: string[] = []

  // User section
  lines.push(...sections.userLines)

  // Add blank line before Vaulter section if we have user content
  if (sections.userLines.length > 0 && sections.userLines[sections.userLines.length - 1]?.trim()) {
    lines.push('')
  }

  // Vaulter section (only if we have vars)
  if (sections.vaulterVars.size > 0) {
    lines.push(VAULTER_SECTION_MARKER)
    lines.push(`# Synced: ${new Date().toISOString()}`)
    lines.push('')

    // Sort keys for consistent output
    const sortedKeys = Array.from(sections.vaulterVars.keys()).sort()
    for (const key of sortedKeys) {
      const value = sections.vaulterVars.get(key)!
      lines.push(`${key}=${formatEnvValue(value)}`)
    }

    lines.push(VAULTER_SECTION_END)
  }

  // Ensure directory exists
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(filePath, lines.join('\n') + '\n')
}

/**
 * Get all variables from an .env file as a flat object
 * Combines user section + Vaulter section
 */
export function getAllVarsFromEnvFile(filePath: string): Record<string, string> {
  const sections = parseEnvFileSections(filePath)
  const result: Record<string, string> = {}

  // Parse user section
  for (const line of sections.userLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.substring(0, eqIndex).trim()
    let value = trimmed.substring(eqIndex + 1).trim()
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }

  // Add Vaulter section (overwrites user section if same key)
  for (const [key, value] of sections.vaulterVars) {
    result[key] = value
  }

  return result
}

/**
 * Get only user-defined variables from an .env file
 */
export function getUserVarsFromEnvFile(filePath: string): Record<string, string> {
  const sections = parseEnvFileSections(filePath)
  const result: Record<string, string> = {}

  for (const line of sections.userLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.substring(0, eqIndex).trim()
    let value = trimmed.substring(eqIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }

  return result
}

/**
 * Sync multiple vars to the Vaulter section of a .env file
 * Replaces all Vaulter-managed vars while preserving user section
 */
export function syncVaulterSection(filePath: string, vars: Record<string, string>): void {
  const sections = parseEnvFileSections(filePath)

  // Get user-defined keys to avoid duplicating them in Vaulter section
  const userKeys = new Set<string>()
  for (const line of sections.userLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    userKeys.add(trimmed.substring(0, eqIndex).trim())
  }

  // Replace Vaulter section with new vars (excluding user-defined keys)
  sections.vaulterVars.clear()
  for (const [key, value] of Object.entries(vars)) {
    if (!userKeys.has(key)) {
      sections.vaulterVars.set(key, value)
    }
  }

  writeEnvFileSections(filePath, sections)
}

/**
 * Delete a key from a local .env file (section-aware)
 * Returns true if key was found and deleted
 */
export function deleteFromEnvFile(filePath: string, key: string): boolean {
  if (!fs.existsSync(filePath)) return false

  const sections = parseEnvFileSections(filePath)

  // Check if key is in Vaulter section
  if (sections.vaulterVars.has(key)) {
    sections.vaulterVars.delete(key)
    writeEnvFileSections(filePath, sections)
    return true
  }

  // Check if key is in user section
  let found = false
  sections.userLines = sections.userLines.filter(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return true
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) return true
    const lineKey = trimmed.substring(0, eqIndex).trim()
    if (lineKey === key) {
      found = true
      return false
    }
    return true
  })

  if (found) {
    writeEnvFileSections(filePath, sections)
    return true
  }

  return false
}

/**
 * Add or update a key in a local .env file (section-aware)
 * - Keys in user section stay in user section (updated in place)
 * - New keys go to Vaulter section unless inUserSection=true
 */
export function setInEnvFile(filePath: string, key: string, value: string, inUserSection = false): void {
  const sections = parseEnvFileSections(filePath)

  // Check if key exists in user section
  let foundInUser = false
  sections.userLines = sections.userLines.map(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) return line
    const lineKey = trimmed.substring(0, eqIndex).trim()
    if (lineKey === key) {
      foundInUser = true
      return `${key}=${formatEnvValue(value)}`
    }
    return line
  })

  if (foundInUser) {
    writeEnvFileSections(filePath, sections)
    return
  }

  // Key not in user section - add to appropriate section
  if (inUserSection) {
    sections.userLines.push(`${key}=${formatEnvValue(value)}`)
  } else {
    sections.vaulterVars.set(key, value)
  }

  writeEnvFileSections(filePath, sections)
}
