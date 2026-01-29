/**
 * Centralized value masking for secrets
 *
 * Replaces 10 scattered implementations with consistent behavior.
 * Use this module for all secret/sensitive value display.
 */

export interface MaskOptions {
  /** Show complete value without masking */
  showFull?: boolean
  /** Maximum length before truncating (default: 30) */
  maxLength?: number
  /** Characters visible at start (default: 4) */
  visibleStart?: number
  /** Characters visible at end (default: 4) */
  visibleEnd?: number
  /** Character used for masking (default: '*') */
  maskChar?: string
  /** Minimum length to apply masking (default: 8) */
  minLengthToMask?: number
}

const DEFAULT_OPTIONS: Required<MaskOptions> = {
  showFull: false,
  maxLength: 30,
  visibleStart: 4,
  visibleEnd: 4,
  maskChar: '*',
  minLengthToMask: 8
}

/**
 * Mask a sensitive value for display
 *
 * @example
 * maskValue('sk-abc123xyz789')
 * // => 'sk-a****789'
 *
 * maskValue('short')
 * // => '***' (too short to show edges)
 *
 * maskValue('secret', { showFull: true })
 * // => 'secret'
 *
 * maskValue('very-long-secret-key-here', { maxLength: 15 })
 * // => 'very****here...'
 */
export function maskValue(
  value: string | undefined | null,
  options: MaskOptions = {}
): string {
  if (value === undefined || value === null || value === '') {
    return ''
  }

  const opts = { ...DEFAULT_OPTIONS, ...options }

  if (opts.showFull) {
    // Even with showFull, respect maxLength for display
    if (opts.maxLength > 0 && value.length > opts.maxLength) {
      return value.slice(0, opts.maxLength - 3) + '...'
    }
    return value
  }

  // Too short to show edges meaningfully
  if (value.length < opts.minLengthToMask) {
    return opts.maskChar.repeat(3)
  }

  const start = value.slice(0, opts.visibleStart)
  const end = value.slice(-opts.visibleEnd)
  const maskLength = Math.min(4, Math.max(1, value.length - opts.visibleStart - opts.visibleEnd))
  const mask = opts.maskChar.repeat(maskLength)

  let result = `${start}${mask}${end}`

  // Truncate if too long
  if (opts.maxLength > 0 && result.length > opts.maxLength) {
    result = result.slice(0, opts.maxLength - 3) + '...'
  }

  return result
}

/**
 * Convenience wrapper for showing/hiding based on boolean flag
 *
 * @example
 * maskValueToggle(secret, showSecrets)
 */
export function maskValueToggle(value: string | undefined | null, show: boolean): string {
  return maskValue(value, { showFull: show })
}

/**
 * Mask value for secret vs config display
 * Secrets are always masked, configs shown in full
 *
 * @example
 * maskValueBySensitivity(value, true)  // masked
 * maskValueBySensitivity(value, false) // full value
 */
export function maskValueBySensitivity(
  value: string | undefined | null,
  isSensitive: boolean
): string {
  return maskValue(value, { showFull: !isSensitive })
}
