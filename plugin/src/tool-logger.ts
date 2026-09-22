import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'tool-logger'
export const inject = ['tools']

const LOG_FULL_CONTENT =
  process.env.MYWRITING_LOG_CONTENT === '1'

const SENSITIVE_KEYS = new Set([
  'content',
  'text',
  'prompt',
  'patch',
  'prose',
  'draft',
  'body',
  'message',
  'messages',
  'input',
  'output',
  'command',
  'file_text',
  'old_string',
  'new_string',
  'old_str',
  'new_str',
])

function summarizeString(value: string): string {
  return `[REDACTED string length=${Array.from(value).length}]`
}

function sanitizeValue(
  value: unknown,
  key?: string,
): unknown {
  if (LOG_FULL_CONTENT) {
    return value
  }

  if (
    key !== undefined &&
    SENSITIVE_KEYS.has(key.toLowerCase())
  ) {
    if (typeof value === 'string') {
      return summarizeString(value)
    }

    if (Array.isArray(value)) {
      return `[REDACTED array length=${value.length}]`
    }

    if (
      typeof value === 'object' &&
      value !== null
    ) {
      return '[REDACTED object]'
    }

    return '[REDACTED]'
  }

  if (typeof value === 'string') {
    // Short operational strings such as paths, artifact names,
    // hashes and status values are useful for debugging.
    if (Array.from(value).length <= 160) {
      return value
    }

    return summarizeString(value)
  }

  if (Array.isArray(value)) {
    return value.map(
      item => sanitizeValue(item),
    )
  }

  if (
    typeof value === 'object' &&
    value !== null
  ) {
    const record =
      value as Record<string, unknown>

    return Object.fromEntries(
      Object.entries(record).map(
        ([childKey, childValue]) => [
          childKey,
          sanitizeValue(
            childValue,
            childKey,
          ),
        ],
      ),
    )
  }

  return value
}

function summarizeResult(
  result: any,
): string {
  if (LOG_FULL_CONTENT) {
    return result.content
      .map((block: any) => {
        if (block.type === 'text') {
          return block.text
        }

        return `[${block.type}]`
      })
      .join('')
  }

  const blocks = Array.isArray(result.content)
    ? result.content
    : []

  const parts = blocks.map((block: any) => {
    if (
      block !== null &&
      typeof block === 'object' &&
      block.type === 'text' &&
      typeof block.text === 'string'
    ) {
      return `[text length=${Array.from(block.text).length}]`
    }

    const type =
      block !== null &&
      typeof block === 'object' &&
      typeof block.type === 'string'
        ? block.type
        : 'unknown'

    return `[${type}]`
  })

  return (
    parts.length > 0
      ? parts.join(' ')
      : '[no result content]'
  )
}

export function apply(ctx: Context) {
  console.log('[tool-logger] plugin loaded!')
  console.log(
    `[tool-logger] content logging: ${
      LOG_FULL_CONTENT
        ? 'FULL (MYWRITING_LOG_CONTENT=1)'
        : 'REDACTED'
    }`,
  )

  ctx.on('tools/result', (exec, result) => {
    const sanitizedArgs =
      sanitizeValue(exec.arguments)

    const resultSummary =
      summarizeResult(result)

    console.log('')
    console.log('========== TOOL EXECUTION ==========')
    console.log(`[tool]   ${exec.name}`)
    console.log(
      `[args]   ${JSON.stringify(sanitizedArgs)}`,
    )
    console.log(`[result] ${resultSummary}`)
    console.log('====================================')
    console.log('')
  })
}
