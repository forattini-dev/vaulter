/**
 * Simple glob matcher for patterns using * and ?
 */

export function compileGlobPatterns(patterns: string[]): (value: string) => boolean {
  const regexes = patterns
    .map(pattern => pattern.trim())
    .filter(Boolean)
    .map(pattern => {
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      const source = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
      return new RegExp(source, 'i')
    })

  if (regexes.length === 0) {
    return () => false
  }

  return (value: string) => regexes.some(regex => regex.test(value))
}
