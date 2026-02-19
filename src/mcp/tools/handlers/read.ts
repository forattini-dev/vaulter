/**
 * vaulter_get + vaulter_list handlers — read from backend
 */

import type { VaulterClient } from '../../../client.js'
import type { HandlerContext } from '../index.js'
import type { ToolResponse } from '../config.js'
import { textResponse } from '../config.js'
import type { Environment } from '../../../types.js'

/**
 * vaulter_get — single key or multi-get via keys[]
 */
export async function handleGet(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const singleKey = args.key as string | undefined
  const multiKeys = args.keys as string[] | undefined

  if (multiKeys && multiKeys.length > 0) {
    // Multi-get (returns Map<string, EnvVar | null>)
    const results = await client.getMany(multiKeys, ctx.project, ctx.environment as Environment, ctx.service)
    const lines: string[] = []
    for (const key of multiKeys) {
      const found = results.get(key)
      lines.push(found ? `${key}=${found.value}` : `${key}=(not found)`)
    }
    return textResponse(lines.join('\n'))
  }

  if (!singleKey) {
    return textResponse('Error: key or keys[] is required')
  }

  const envVar = await client.get(singleKey, ctx.project, ctx.environment as Environment, ctx.service)
  return textResponse(
    envVar !== null
      ? envVar.value
      : `Variable ${singleKey} not found in ${ctx.project}/${ctx.environment}`
  )
}

/**
 * vaulter_list — list variables from backend
 */
export async function handleList(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const showValues = args.showValues === true
  const filter = args.filter as string | undefined
  const vars = await client.list({
    project: ctx.project,
    environment: ctx.environment as Environment,
    service: ctx.service
  })

  if (vars.length === 0) {
    return textResponse(`No variables found for ${ctx.project}/${ctx.environment}`)
  }

  let filtered = vars
  if (filter) {
    const regex = new RegExp('^' + filter.replace(/\*/g, '.*') + '$', 'i')
    filtered = vars.filter(v => regex.test(v.key))
  }

  const lines = filtered.map(v => {
    const typeLabel = v.sensitive ? '[secret]' : '[config]'
    return showValues ? `${v.key} ${typeLabel} = ${v.value}` : `${v.key} ${typeLabel}`
  })

  const header = `Variables in ${ctx.project}/${ctx.environment}${filter ? ` (filter: ${filter})` : ''}:`
  const secretCount = filtered.filter(v => v.sensitive).length
  const configCount = filtered.length - secretCount

  return textResponse(
    `${header}\n${lines.join('\n')}\n\nTotal: ${filtered.length} variable(s) (${configCount} config, ${secretCount} secret)`
  )
}
