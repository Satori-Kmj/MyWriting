import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import type { Context } from '@deepseek-ai/cordis'

import { apply as applyCommitDraft } from '../src/commit-story-draft.ts'
import {
  apply as applyCommitUpdate,
  isCharacterStateFilename,
} from '../src/commit-story-update.ts'
import {
  WRITING_TOOL_ALLOWLIST,
  apply as applyToolFilter,
} from '../src/mywriting-tool-filter.ts'
import { MYWRITING_ROOT } from '../src/mywriting-root.ts'
import { apply as applySaveArtifact } from '../src/save-story-artifact.ts'

type CapturedTool = {
  name: string
  parameters: Record<string, unknown>
  execute(args: unknown, exec: unknown): Promise<unknown>
}

type ToolApply = (ctx: Context) => void

type Target = {
  displayPath: string
}

function normalized(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function captureTool(apply: ToolApply, services: Record<string, unknown> = {}): CapturedTool {
  let captured: CapturedTool | undefined
  const ctx = {
    ...services,
    tools: {
      register(tool: CapturedTool) {
        captured = tool
      },
    },
  }

  apply(ctx as unknown as Context)
  assert.ok(captured, 'plugin did not register a tool')
  return captured
}

function executionAt(cwd: string): unknown {
  return {
    agent: {
      session: {
        header: { cwd },
      },
    },
    signal: undefined,
  }
}

function createMemoryFs(
  initialFiles: Readonly<Record<string, string>> = {},
  initialDirectories: readonly string[] = [],
) {
  const files = new Map<string, string>()
  const directories = new Set<string>()

  const absolute = (value: string): string =>
    normalized(path.isAbsolute(value) ? value : path.resolve(MYWRITING_ROOT, value))

  for (const [filePath, content] of Object.entries(initialFiles)) {
    files.set(absolute(filePath), content)
  }
  for (const directoryPath of initialDirectories) {
    directories.add(absolute(directoryPath))
  }

  const targetPath = (target: Target): string => normalized(target.displayPath)

  return {
    files,
    service: {
      async resolve(value: string, options?: { cwd?: string }): Promise<Target> {
        return {
          displayPath: path.resolve(options?.cwd ?? MYWRITING_ROOT, value),
        }
      },

      contains(parent: Target, candidate: Target): boolean {
        const relative = path.relative(targetPath(parent), targetPath(candidate))
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
      },

      async stat(target: Target): Promise<{ type: 'file' | 'directory' } | undefined> {
        const key = targetPath(target)
        if (files.has(key)) return { type: 'file' }
        if (directories.has(key)) return { type: 'directory' }
        return undefined
      },

      async readText(target: Target): Promise<string> {
        const key = targetPath(target)
        const content = files.get(key)
        if (content === undefined) throw new Error(`missing in-memory file: ${target.displayPath}`)
        return content
      },

      async writeText(target: Target, content: string): Promise<{ operation: 'create' | 'update' }> {
        const key = targetPath(target)
        const operation = files.has(key) ? 'update' : 'create'
        files.set(key, content)
        return { operation }
      },

      async listDir(target: Target): Promise<Array<{ name: string; type: 'directory' }>> {
        const parent = targetPath(target)
        const result: Array<{ name: string; type: 'directory' }> = []
        for (const directory of directories) {
          if (directory === parent) continue
          const relative = path.relative(parent, directory)
          if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && !relative.includes(path.sep)) {
            result.push({ name: path.basename(directory), type: 'directory' })
          }
        }
        return result
      },
    },
  }
}

test('save_story_artifact accepts and saves rough-outline', async () => {
  const memory = createMemoryFs()
  const tool = captureTool(applySaveArtifact, {
    fs: memory.service,
    sandboxPolicy: {
      resolve: () => ({ mode: 'workspace-write' }),
    },
  })

  const properties = tool.parameters.properties as Record<string, Record<string, unknown>>
  const artifactEnum = properties.artifact.enum as unknown[]
  assert.ok(artifactEnum.includes('rough-outline'))

  const result = await tool.execute(
    { artifact: 'rough-outline', content: 'outline fixture' },
    executionAt(MYWRITING_ROOT),
  ) as Record<string, unknown>

  assert.equal(result.path, 'input/rough-outline.md')
  assert.equal(result.transaction_bound, false)
  assert.equal(
    memory.files.get(normalized(path.join(MYWRITING_ROOT, 'input/rough-outline.md'))),
    'outline fixture',
  )
})

test('only real character state cards are eligible for the initial state snapshot', () => {
  assert.equal(isCharacterStateFilename('example状态.md'), true)
  assert.equal(isCharacterStateFilename('EXAMPLE状态文件.md'), false)
  assert.equal(isCharacterStateFilename('.gitkeep'), false)
  assert.equal(isCharacterStateFilename('状态.md'), false)
})

test('dedicated mutation tools reject a session outside the exact MyWriting root', async () => {
  const outside = path.dirname(MYWRITING_ROOT)
  const save = captureTool(applySaveArtifact)
  const draft = captureTool(applyCommitDraft)
  const update = captureTool(applyCommitUpdate)

  await assert.rejects(
    save.execute({ artifact: 'rough-outline', content: 'fixture' }, executionAt(outside)),
    /MyWriting root/,
  )
  await assert.rejects(draft.execute({}, executionAt(outside)), /MyWriting root/)
  await assert.rejects(update.execute({}, executionAt(outside)), /MyWriting root/)
})

test('Writing Agent allowlist is minimal and the mutation guard remains active', () => {
  const handlers = new Map<string, (payload: unknown) => void>()
  let guard: ((execution: { name: string; arguments: unknown }) => string | undefined) | undefined
  let restriction: { allow?: readonly string[]; deny?: readonly string[] } | undefined

  const ctx = {
    agents: { list: () => [] },
    on(event: string, handler: (payload: unknown) => void) {
      handlers.set(event, handler)
    },
    effect() {
      return undefined
    },
  }

  applyToolFilter(ctx as unknown as Context)

  const created = handlers.get('agent/created')
  assert.ok(created)
  created({
    agent: {
      id: 'test-agent',
      session: { header: { cwd: MYWRITING_ROOT } },
      ctx: {
        tools: {
          restrict(filter: typeof restriction) {
            restriction = filter
            return () => undefined
          },
          guard(callback: typeof guard) {
            guard = callback
            return () => undefined
          },
        },
      },
    },
  })

  assert.ok(restriction)
  assert.deepEqual(restriction.allow, WRITING_TOOL_ALLOWLIST)
  assert.equal(restriction.deny, undefined)
  assert.ok(guard)
  assert.match(
    guard({ name: 'write', arguments: { file_path: 'work/draft.md' } }) ?? '',
    /protected path/,
  )
  assert.equal(
    guard({ name: 'write', arguments: { file_path: 'plugin/notes.txt' } }),
    undefined,
  )
  assert.equal(
    guard({ name: 'str_replace_editor', arguments: { command: 'view', path: 'state/current-scene.md' } }),
    undefined,
  )
  assert.match(guard({ name: 'pwsh', arguments: { command: 'Set-Content work/draft.md x' } }) ?? '', /shell tools are disabled/)
  assert.match(guard({ name: 'bash', arguments: { command: 'touch work/draft.md' } }) ?? '', /shell tools are disabled/)
})

test('a corrupt published snapshot is an integrity error, not committed_needs_sync', async () => {
  const draftSha = sha256('approved draft fixture')
  const transactionId = 'transaction-fixture'
  const manifest = `${JSON.stringify({
    schema_version: 1,
    commit_id: 1,
    parent_commit_id: null,
    status: 'committed',
    created_at: '2026-01-01T00:00:00.000Z',
    character_state_schema_version: 1,
    transaction_id: transactionId,
    source_draft_sha256: draftSha,
    base_manifest_sha256: null,
    files: {
      'accepted-draft.md': {
        sha256: sha256('expected immutable content'),
        characters: 26,
      },
    },
  }, null, 2)}\n`
  const intent = `${JSON.stringify({
    schema_version: 1,
    transaction_id: transactionId,
    status: 'approved',
    draft_path: 'work/draft.md',
    draft_sha256: draftSha,
    base_commit_id: null,
    base_manifest_sha256: null,
    created_at: '2026-01-01T00:00:00.000Z',
  }, null, 2)}\n`
  const memory = createMemoryFs(
    {
      'work/commit-intent.json': intent,
      'history/0001/manifest.json': manifest,
      'history/0001/accepted-draft.md': 'tampered content',
    },
    ['history', 'history/0001'],
  )
  const tool = captureTool(applyCommitUpdate, {
    fs: memory.service,
    sandboxPolicy: {
      resolve: () => ({ mode: 'workspace-write' }),
    },
  })

  await assert.rejects(
    tool.execute({}, executionAt(MYWRITING_ROOT)),
    /history snapshot integrity failure/,
  )
})

test('pipeline discovery, stage order, acceptance, and commit invariants stay intact', () => {
  const skillPath = path.join(MYWRITING_ROOT, '.dsh/skills/candidate-revision/SKILL.md')
  const obsoleteSkillPath = path.join(
    MYWRITING_ROOT,
    '.dsh/skills/candidate-revision/candidate-revision.SKILL.md',
  )
  assert.equal(existsSync(skillPath), true)
  assert.equal(existsSync(obsoleteSkillPath), false)

  const pipelinePath = path.join(MYWRITING_ROOT, '.dsh/skills/story-pipeline/SKILL.md')
  const pipeline = readFileSync(pipelinePath, 'utf8')
  const agents = readFileSync(path.join(MYWRITING_ROOT, 'AGENTS.md'), 'utf8')

  let previousStage = -1
  for (let stage = 0; stage <= 7; stage += 1) {
    const currentStage = pipeline.indexOf(`## Stage ${stage} `)
    assert.ok(currentStage > previousStage, `Stage ${stage} is missing or out of order`)
    previousStage = currentStage
  }

  assert.match(pipeline, /Only explicit acceptance/)
  assert.match(pipeline, /generic continuation instruction\s+is not acceptance/)
  assert.match(pipeline, /require fresh explicit\s+acceptance/)
  assert.match(pipeline, /transaction_bound: true/)
  assert.match(pipeline, /committed_needs_sync/)
  assert.match(pipeline, /materialized: true/)
  assert.match(pipeline, /verified: true/)
  assert.match(pipeline, /apply_memory_patch/)
  assert.match(pipeline, /snapshot_story_commit/)
  assert.doesNotMatch(pipeline, /B1\/B2 replacement/)
  assert.doesNotMatch(pipeline, /Until B3/)
  assert.doesNotMatch(pipeline, /exactly once/i)
  assert.match(pipeline, /DSH goal/)

  assert.match(agents, /All writes under `input\/`, `work\/`, `output\/`, `state\/`, and `history\/`/)
  assert.match(agents, /commit_story_draft/)
  assert.match(agents, /commit_story_update/)
  assert.match(agents, /latest valid `history\/<commit_id>\/` snapshot is canonical/)
})
