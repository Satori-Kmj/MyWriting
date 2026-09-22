import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Canonical MyWriting workspace root derived from this plugin checkout. */
export const MYWRITING_ROOT = path.resolve(
  fileURLToPath(
    new URL('../..', import.meta.url),
  ),
)

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved
}

/**
 * Require a dedicated MyWriting tool to run from the canonical workspace root.
 * @param cwd - active agent session working directory.
 * @returns the canonical MyWriting root.
 */
export function requireMyWritingRoot(cwd: string): string {
  if (
    normalizeForCompare(cwd) !==
    normalizeForCompare(MYWRITING_ROOT)
  ) {
    throw new Error(
      'MyWriting pipeline tools require the agent workspace cwd to be the MyWriting root',
    )
  }

  return MYWRITING_ROOT
}
