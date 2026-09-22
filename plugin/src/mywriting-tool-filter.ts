import path from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

import { MYWRITING_ROOT } from './mywriting-root.ts'

export const name = 'mywriting-tool-filter'

export const inject = [
  'tools',
  'agents',
]

// The Writing Agent is deliberately smaller than the standard coding agent.
// These global tools are sufficient to discover and read project context,
// load workflow skills, ask for missing user-owned information, and perform
// the three guarded pipeline mutations. Agent-scoped tools remain visible by
// ToolRuntime design and are not affected by this allowlist.
export const WRITING_TOOL_ALLOWLIST = [
  'read',
  'glob',
  'grep',
  'skill',
  'ask_user_question',
  'save_story_artifact',
  'commit_story_draft',
  'commit_story_update',
] as const

const PROTECTED_EXACT_PATHS = [
  'input/rough-outline.md',

  'work/expanded-outline.md',
  'work/draft.md',
  'work/draft.meta.json',
  'work/commit-intent.json',
  'work/memory-patch.json',
  'work/memory-patch.meta.json',
  'work/scene-checkpoint.md',
  'work/scene-checkpoint.meta.json',

  'output/accepted-draft.md',

  'state/current-scene.md',
  'state/recent-prose.md',
  'state/current-commit.json',
] as const

const PROTECTED_DIRECTORY_PATHS = [
  'input',
  'work',
  'output',
  'state',
  'history',
] as const

const protectedExact =
  new Set(
    PROTECTED_EXACT_PATHS.map(
      relative =>
        normalizeForCompare(
          path.resolve(
            MYWRITING_ROOT,
            relative,
          ),
        ),
    ),
  )

const protectedDirectories =
  PROTECTED_DIRECTORY_PATHS.map(
    relative =>
      normalizeForCompare(
        path.resolve(
          MYWRITING_ROOT,
          relative,
        ),
      ),
  )

function normalizeForCompare(
  value: string,
): string {
  const resolved = path.resolve(value)

  // Windows paths are case-insensitive in the normal MyWriting setup.
  // Lower-casing is harmless on Windows and keeps comparisons stable.
  return process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved
}

function isWithin(
  parent: string,
  candidate: string,
): boolean {
  const relative =
    path.relative(
      parent,
      candidate,
    )

  return (
    relative === '' ||
    (
      !relative.startsWith('..') &&
      !path.isAbsolute(relative)
    )
  )
}

function isMyWritingCwd(
  cwd: string | undefined,
): boolean {
  if (
    cwd === undefined ||
    cwd.length === 0
  ) {
    return false
  }

  const normalizedRoot =
    normalizeForCompare(
      MYWRITING_ROOT,
    )

  const normalizedCwd =
    normalizeForCompare(
      cwd,
    )

  return isWithin(
    normalizedRoot,
    normalizedCwd,
  )
}

function isProtectedPath(
  cwd: string,
  rawPath: string,
): boolean {
  const resolved =
    normalizeForCompare(
      path.isAbsolute(rawPath)
        ? rawPath
        : path.resolve(
            cwd,
            rawPath,
          ),
    )

  if (
    protectedExact.has(resolved)
  ) {
    return true
  }

  return protectedDirectories.some(
    directory =>
      isWithin(
        directory,
        resolved,
      ),
  )
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function mutationPathFromExecution(
  exec: Readonly<ToolExecution>,
): string | undefined {
  if (!isRecord(exec.arguments)) {
    return undefined
  }

  if (
    exec.name === 'write' ||
    exec.name === 'edit'
  ) {
    return (
      typeof exec.arguments.file_path ===
        'string'
        ? exec.arguments.file_path
        : undefined
    )
  }

  if (
    exec.name ===
    'str_replace_editor'
  ) {
    const command =
      exec.arguments.command

    // "view" is read-only and remains allowed
    // even for protected MyWriting paths.
    if (command === 'view') {
      return undefined
    }

    if (
      command === 'create' ||
      command === 'str_replace' ||
      command === 'insert'
    ) {
      return (
        typeof exec.arguments.path ===
          'string'
          ? exec.arguments.path
          : undefined
      )
    }
  }

  return undefined
}

function guardReason(
  cwd: string,
  exec: Readonly<ToolExecution>,
): string | undefined {
  if (
    exec.name === 'pwsh' ||
    exec.name === 'bash'
  ) {
    return (
      'MyWriting workspace: shell tools are disabled because shell commands ' +
      'can bypass protected-path enforcement. Use read/search tools or the ' +
      'dedicated MyWriting pipeline tool required by story-pipeline.'
    )
  }

  const mutationPath =
    mutationPathFromExecution(
      exec,
    )

  if (
    mutationPath === undefined
  ) {
    return undefined
  }

  if (
    !isProtectedPath(
      cwd,
      mutationPath,
    )
  ) {
    return undefined
  }

  return (
    'MyWriting protected path: generic filesystem mutation is not allowed here. ' +
    'Use the dedicated MyWriting pipeline tool required by story-pipeline. ' +
    'Do not retry this write/edit with different arguments or sandbox permissions.'
  )
}

export function apply(ctx: Context) {
  const installed =
    new Map<
      string,
      () => void
    >()

  const installForAgent =
    (agent: Agent) => {
      const cwd =
        agent.session.header.cwd

      if (
        !isMyWritingCwd(cwd)
      ) {
        return
      }

      if (
        installed.has(agent.id)
      ) {
        return
      }

      if (
        cwd === undefined
      ) {
        return
      }

      // Remove the standard coding-agent tools that the writing workflow does
      // not need. Keeping them merely guarded would still send their schemas to
      // the model on every request.
      const disposeRestriction =
        agent.ctx.tools.restrict({
          allow: WRITING_TOOL_ALLOWLIST,
        })

      let disposeGuard: () => void

      try {
        // Keep the path guard as a second line of defence if a future scoped
        // tool or catalog change exposes a generic mutation capability.
        disposeGuard = agent.ctx.tools.guard(
          exec =>
            guardReason(
              cwd,
              exec,
            ),
        )
      } catch (error: unknown) {
        disposeRestriction()
        throw error
      }

      const dispose = () => {
        try {
          disposeGuard()
        } finally {
          disposeRestriction()
        }
      }

      installed.set(
        agent.id,
        dispose,
      )

      console.log(
        `[mywriting-tool-filter] writing allowlist and protected-path guard installed for agent ${agent.id}`,
      )
    }

  const forgetAgent =
    (agentId: string) => {
      installed.delete(agentId)
    }

  ctx.on(
    'agent/created',
    ({ agent }) => {
      installForAgent(agent)
    },
  )

  ctx.on(
    'agent/disposed',
    ({ agent }) => {
      forgetAgent(agent.id)
    },
  )

  // Cover agents that already existed before this plugin activated.
  for (
    const agent of
      ctx.agents.list()
  ) {
    installForAgent(agent)
  }

  // agent.ctx owns each guard during normal agent disposal.
  // This additional cleanup handles plugin hot-reload/unload while agents stay alive.
  ctx.effect(
    () => () => {
      for (
        const dispose of
          installed.values()
      ) {
        try {
          dispose()
        } catch {
          // Best-effort cleanup only.
          // Agent-scoped teardown may already have disposed the guard.
        }
      }

      installed.clear()
    },
    'mywriting-tool-filter.cleanup',
  )

  console.log(
    `[mywriting-tool-filter] plugin loaded for workspace ${MYWRITING_ROOT}`,
  )
}
